# Parallel Workflow Execution

**Status: ✅ COMPLETED**

## Overview

Enable concurrent execution of independent workflow nodes to improve performance, particularly for workflows with multiple agents that don't depend on each other.

## Current State

The executor (`packages/server/src/engine/executor.ts:1171-1282`) processes nodes sequentially:

```typescript
while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const result = await executeNode(...);  // Sequential - blocks until complete
    // ...
}
```

Even when multiple nodes are ready (all dependencies satisfied), they execute one at a time.

## Example Workflow

`workflows/test-agent-stream-long.yaml` has two agents that both depend only on the trigger:

```
trigger ──┬──> claude-agent
          └──> codex-agent
```

Currently these run sequentially (~2x the time). With parallelization, they'd run concurrently.

## Implementation

### Core Algorithm Change

Replace sequential processing with batch-based parallel execution:

```typescript
while (queue.length > 0) {
    // 1. Partition queue into ready (deps met) vs pending (deps not met)
    const { ready, pending } = partitionByReadiness(queue, edges, context);

    // 2. Apply concurrency limit
    const batch = ready.slice(0, maxConcurrent);
    const deferred = ready.slice(maxConcurrent);

    // 3. Execute batch in parallel
    const results = await Promise.all(
        batch.map(id => executeNodeWithTracking(id, ...))
    );

    // 4. Process results, handle failures
    for (const result of results) {
        // Update context.outputs
        // Check for failures and continueOnFail
    }

    // 5. Rebuild queue: pending + deferred + new downstream nodes
    queue = [...pending, ...deferred, ...getDownstreamNodes(batch)];
}
```

### Dependency Check Function

```typescript
function isNodeReady(
    nodeId: string,
    edges: WorkflowEdge[],
    context: ExecutionContext
): boolean {
    // Get all incoming edges (excluding dock feedback edges)
    const incomingEdges = edges.filter(e => {
        if (e.target !== nodeId) return false;
        const handle = e.targetHandle || '';
        // Exclude dock feedback edges
        if (handle.startsWith('dock:') &&
            (handle.endsWith(':input') || handle.endsWith(':current'))) {
            return false;
        }
        return true;
    });

    // All source nodes must have completed (have outputs in context)
    return incomingEdges.every(e => context.outputs.has(e.source));
}
```

### Configuration Options

Add to `ExecuteOptions`:

```typescript
interface ExecuteOptions {
    // ... existing options ...

    /** Maximum nodes to execute concurrently. Default: 3 */
    maxConcurrent?: number;

    /** Default behavior when a node fails. Default: true */
    continueOnFailDefault?: boolean;
}
```

Node-level override via `data.continueOnFail`:
- If `continueOnFail: false` on a node, workflow stops when that node fails
- If `continueOnFail: true` (or unset, using default), workflow continues

### Error Handling Behavior

When a node fails during parallel execution:

1. **Check `continueOnFail`**: If the failed node has `continueOnFail: false`, mark workflow for termination
2. **Wait for batch**: Let other nodes in the current batch complete (don't kill in-flight processes)
3. **Skip downstream**: Don't queue nodes that depend on the failed node
4. **Report clearly**: Include which node failed and why in the final result

```typescript
// In batch processing loop
for (const result of batchResults) {
    if (result.status === 'failed') {
        const node = nodeMap.get(result.nodeId);
        const shouldContinue = node?.data.continueOnFail ?? continueOnFailDefault;

        if (!shouldContinue) {
            // Mark for termination after batch completes
            terminateAfterBatch = true;
            terminationReason = `Node '${result.nodeId}' failed`;
        }

        // Track failed nodes to skip their downstream
        failedNodes.add(result.nodeId);
    }
}
```

### Concurrency Limit

Start with a default of `maxConcurrent: 3`. Rationale:
- Agents are resource-intensive (spawn CLI processes, make API calls)
- 3-5 concurrent agents is reasonable for most machines
- Prevents overwhelming the system or hitting API rate limits

Future: Make configurable via:
- CLI flag: `--max-concurrent 5`
- Workflow metadata: `metadata.execution.maxConcurrent: 5`
- Environment variable: `SHODAN_MAX_CONCURRENT=5`

## Streaming & Event Improvements

### Problem

Current `onNodeOutput` callback doesn't identify which node produced the output:

```typescript
onNodeOutput?: (nodeId: string, chunk: string) => void;
```

Wait, it does include `nodeId`! But the downstream consumers (CLI, server SSE) need to handle interleaved output properly.

### Required Changes

1. **CLI Output** (`packages/cli/src/commands/run.ts`):
   - Prefix output lines with node label/id when multiple nodes are running
   - Or use separate "channels" with clear demarcation

2. **Server SSE** (`packages/server/src/routes/execute.ts`):
   - Already sends `nodeId` in events - should work correctly
   - Verify client handles interleaved events properly

3. **Designer UI** (`packages/designer/src/`):
   - Update node output display to handle concurrent updates
   - Consider showing "running" indicator on multiple nodes simultaneously

### New Events for Validation

Add events to track parallel execution for testing/debugging:

```typescript
interface ExecuteOptions {
    // ... existing ...

    /** Called when a batch of nodes starts executing in parallel */
    onBatchStart?: (nodeIds: string[], batchNumber: number) => void;

    /** Called when a batch completes */
    onBatchComplete?: (nodeIds: string[], batchNumber: number, duration: number) => void;
}
```

These events enable:
- Logging which nodes ran in parallel
- Verifying parallelization is working
- Performance profiling

## Testing & Validation

### Test Workflows

Create dedicated test workflows in `workflows/test-parallel/`:

#### 1. `test-parallel-shell.yaml` - Basic parallel shell commands

```yaml
version: 1
metadata:
  name: Parallel Shell Test
  description: Verify parallel execution of independent shell nodes

nodes:
  - id: trigger
    type: trigger
    data:
      nodeType: trigger
      label: Start

  - id: shell-1
    type: shell
    data:
      nodeType: shell
      label: Sleep 2s (A)
      script: |
        echo "Starting A at $(date +%s)"
        sleep 2
        echo "Finished A at $(date +%s)"

  - id: shell-2
    type: shell
    data:
      nodeType: shell
      label: Sleep 2s (B)
      script: |
        echo "Starting B at $(date +%s)"
        sleep 2
        echo "Finished B at $(date +%s)"

  - id: shell-3
    type: shell
    data:
      nodeType: shell
      label: Sleep 2s (C)
      script: |
        echo "Starting C at $(date +%s)"
        sleep 2
        echo "Finished C at $(date +%s)"

edges:
  - id: e1
    source: trigger
    target: shell-1
  - id: e2
    source: trigger
    target: shell-2
  - id: e3
    source: trigger
    target: shell-3
```

**Validation**:
- Sequential: ~6 seconds total
- Parallel: ~2 seconds total (all 3 run concurrently)
- Check timestamps in output overlap

#### 2. `test-parallel-with-join.yaml` - Parallel with downstream join

```yaml
# trigger -> [shell-1, shell-2] -> join-node
```

**Validation**:
- shell-1 and shell-2 run in parallel
- join-node waits for both to complete
- Verify join-node receives outputs from both

#### 3. `test-parallel-failure.yaml` - Error handling

```yaml
# trigger -> [success-node, fail-node (continueOnFail: false), another-node]
```

**Validation**:
- Verify workflow stops after batch when fail-node fails
- Verify success-node and another-node complete (in-flight)
- Verify downstream of fail-node is skipped

#### 4. `test-parallel-failure-continue.yaml` - Continue on failure

```yaml
# trigger -> [success-node, fail-node (continueOnFail: true)] -> downstream
```

**Validation**:
- Workflow continues despite fail-node failure
- downstream node receives output from success-node
- Final result marked as failed but all nodes attempted

### Automated Test Runner Integration

Add to `pnpm run test:workflows`:

```typescript
// In test runner
describe('Parallel Execution', () => {
    it('executes independent nodes concurrently', async () => {
        const startTime = Date.now();
        const events: Array<{ type: string; nodeId: string; time: number }> = [];

        const result = await executeWorkflowSchema(workflow, {
            onNodeStart: (nodeId) => {
                events.push({ type: 'start', nodeId, time: Date.now() - startTime });
            },
            onNodeComplete: (nodeId) => {
                events.push({ type: 'complete', nodeId, time: Date.now() - startTime });
            },
        });

        // Verify parallelism via event timing
        const shell1Start = events.find(e => e.nodeId === 'shell-1' && e.type === 'start');
        const shell2Start = events.find(e => e.nodeId === 'shell-2' && e.type === 'start');

        // Both should start within ~100ms of each other (allowing for overhead)
        expect(Math.abs(shell1Start.time - shell2Start.time)).toBeLessThan(100);

        // Total time should be ~2s, not ~4s
        const totalTime = Date.now() - startTime;
        expect(totalTime).toBeLessThan(3000);  // With overhead buffer
    });

    it('respects continueOnFail: false', async () => {
        const result = await executeWorkflowSchema(failureWorkflow, {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('fail-node');

        // Downstream of fail-node should not have executed
        const downstreamResult = result.results.find(r => r.nodeId === 'downstream-of-fail');
        expect(downstreamResult).toBeUndefined();
    });

    it('continues when continueOnFail: true', async () => {
        const result = await executeWorkflowSchema(continueWorkflow, {});

        expect(result.success).toBe(false);  // Overall failed

        // But other branches completed
        const otherResult = result.results.find(r => r.nodeId === 'other-branch');
        expect(otherResult?.status).toBe('completed');
    });
});
```

### Manual Validation

1. **Timing Check**:
   ```bash
   time pnpm run shodan -- run workflows/test-parallel/test-parallel-shell.yaml
   ```
   - Before: ~6+ seconds
   - After: ~2-3 seconds

2. **Event Log Check**:
   ```bash
   pnpm run shodan -- run workflows/test-parallel/test-parallel-shell.yaml --verbose
   ```
   - Should show multiple "Node started" events at similar timestamps
   - Should show interleaved output from concurrent nodes

3. **Designer Visual Check**:
   - Open workflow in designer
   - Execute and verify multiple nodes show "running" state simultaneously

## Implementation Steps

1. ✅ **Add `onBatchStart`/`onBatchComplete` events** to `ExecuteOptions`
2. ✅ **Implement `isNodeReady()` helper** function
3. ✅ **Refactor main loop** to batch-based parallel execution
4. ✅ **Add `maxConcurrent` option** with default of 3
5. ✅ **Update error handling** for `continueOnFail` in parallel context
6. ✅ **Create test workflows** in `workflows/test-parallel/`
7. ✅ **Add automated tests** to test runner (4 tests in "Parallel Execution" suite)
8. ✅ **Update CLI output** to handle interleaved node output (prefixes with `[NodeLabel]`)
9. ✅ **Fix Codex streaming** to parse JSONL and extract text (Designer/SSE already correct)

## Future Enhancements

- **Dynamic concurrency**: Adjust based on node type (agents: 3, shell: 10)
- **Priority queue**: Allow nodes to specify execution priority
- **Resource tagging**: Tag nodes with resource requirements, schedule accordingly
- **Distributed execution**: Run nodes on different machines (longer term)
