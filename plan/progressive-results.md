# Progressive Results & Real-time Visualization

## Overview

Transform the workflow execution model from synchronous request-response to real-time streaming, enabling:
- Live node status updates as execution progresses
- Edge execution counters and animations
- Streaming agent output
- Loop iteration visualization

## Implementation Progress

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Complete | SSE Infrastructure - event types, parser, streaming endpoint, client |
| Phase 2 | ✅ Complete | Node Status Updates - App.tsx handlers, loop callback forwarding |
| Phase 3 | ✅ Complete | Edge Visualization - AnimatedEdge component |
| Phase 4 | ✅ Complete | Agent Output Streaming - Claude Code & Codex runners stream stdout |
| Phase 5 | ✅ Complete | Loop Iteration Display - iteration badge on LoopContainerNode |
| Testing | ✅ Complete | E2E visual test workflows created |

## Current State (Before Implementation)

| Aspect | Current Implementation |
|--------|------------------------|
| Execution model | Synchronous POST, blocks until complete |
| State updates | Single bulk update at workflow end |
| Edge rendering | ReactFlow default (static lines) |
| Agent output | Blocking - waits for full completion |
| Loop status | Never updates; inner nodes always "pending" |

**Key limitation**: The entire workflow must complete before any state is returned to the client.

---

## Goals

1. **Incremental node status** - Update node states (pending→running→completed/failed) in real-time
2. **Edge execution tracking** - Show execution count per edge; animate when data flows
3. **Agent streaming** - Stream tokens as they're generated (OpenAI, Anthropic)
4. **Loop visualization** - Display current iteration number; update inner node states per iteration

---

## Architecture Decision: Streaming HTTP Response

Use streaming `fetch` POST over EventSource or WebSockets because:
- **POST required**: We need to send potentially large workflow data (nodes, edges, inputs) in the request body; EventSource only supports GET
- **One-shot execution**: Workflow execution is a single operation, not a persistent connection; auto-reconnect isn't meaningful (you wouldn't want to restart mid-workflow)
- **Simpler implementation**: No upgrade handshake (vs WebSockets), standard HTTP semantics
- **Unidirectional**: Server→client matches our use case

The response uses SSE format (`data: {...}\n\n`) for easy parsing, but the transport is a standard streaming HTTP response.

**Note**: Since we use `fetch` instead of `EventSource`, we must implement our own chunk buffering for partial reads (see SSE Parser below).

---

## Implementation Phases

### Phase 1: SSE Infrastructure

**Goal**: Establish real-time communication channel between server and designer.

#### 1.1 Server: SSE Endpoint (`packages/server/src/routes/execute-stream.ts`)

New endpoint that streams execution events:

```typescript
router.post('/stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Helper to send SSE events
  const sendEvent = (event: ExecutionEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Execute with callbacks
    const result = await executeWorkflow(nodes, edges, {
      onNodeStart: (nodeId, node) => {
        sendEvent({ type: 'node-start', nodeId, timestamp: Date.now() });
      },
      onNodeComplete: (nodeId, result) => {
        sendEvent({ type: 'node-complete', nodeId, result, timestamp: Date.now() });
      },
      onNodeOutput: (nodeId, chunk) => {
        sendEvent({ type: 'node-output', nodeId, chunk, timestamp: Date.now() });
      },
      onEdgeExecuted: (edgeId, sourceNodeId, data) => {
        sendEvent({ type: 'edge-executed', edgeId, sourceNodeId, timestamp: Date.now() });
      },
      onIterationStart: (loopId, iteration) => {
        sendEvent({ type: 'iteration-start', loopId, iteration, timestamp: Date.now() });
      },
      onIterationComplete: (loopId, iteration, success) => {
        sendEvent({ type: 'iteration-complete', loopId, iteration, success, timestamp: Date.now() });
      },
    });

    sendEvent({
      type: 'workflow-complete',
      success: result.success,
      error: result.error,
      timestamp: Date.now(),
    });
  } catch (error) {
    sendEvent({
      type: 'workflow-complete',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    });
  }

  res.end();
});
```

#### 1.2 Event Types (`packages/core/src/execution-events.ts`)

```typescript
export type ExecutionEvent =
  | { type: 'node-start'; nodeId: string; timestamp: number }
  | { type: 'node-complete'; nodeId: string; result: NodeResult; timestamp: number }
  | { type: 'node-output'; nodeId: string; chunk: string; timestamp: number }  // For streaming
  | { type: 'edge-executed'; edgeId: string; sourceNodeId: string; timestamp: number }
  | { type: 'iteration-start'; loopId: string; iteration: number; timestamp: number }
  | { type: 'iteration-complete'; loopId: string; iteration: number; success: boolean; timestamp: number }
  | { type: 'workflow-complete'; success: boolean; error?: string; timestamp: number };
```

#### 1.3 SSE Parser (`packages/designer/src/lib/sse-parser.ts`)

Stateful parser that handles partial chunks across reads:

```typescript
export class SSEParser {
  private buffer = '';

  /**
   * Feed a chunk of data and return any complete events.
   * Incomplete data is buffered for the next chunk.
   */
  parse(chunk: string): ExecutionEvent[] {
    this.buffer += chunk;
    const events: ExecutionEvent[] = [];

    // Split on double newline (SSE event boundary)
    const parts = this.buffer.split('\n\n');

    // Last part may be incomplete - keep in buffer
    this.buffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      try {
        const json = trimmed.slice(6); // Remove 'data: ' prefix
        events.push(JSON.parse(json));
      } catch (e) {
        console.warn('Failed to parse SSE event:', trimmed, e);
      }
    }

    return events;
  }

  /** Reset buffer (call on stream end or error) */
  reset() {
    this.buffer = '';
  }
}
```

#### 1.4 Designer: SSE Client (`packages/designer/src/lib/execute-stream.ts`)

```typescript
import { SSEParser } from './sse-parser.js';

export interface StreamHandlers {
  onNodeStart: (nodeId: string) => void;
  onNodeComplete: (nodeId: string, result: NodeResult) => void;
  onNodeOutput: (nodeId: string, chunk: string) => void;
  onEdgeExecuted: (edgeId: string) => void;
  onIterationStart: (loopId: string, iteration: number) => void;
  onIterationComplete: (loopId: string, iteration: number, success: boolean) => void;
  onComplete: (success: boolean, error?: string) => void;
}

export function executeWorkflowStream(
  request: ExecuteRequest,
  handlers: StreamHandlers
): () => void {  // Returns cancel function
  const controller = new AbortController();
  const parser = new SSEParser();

  fetch(`${API_BASE}/execute/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: controller.signal,
  }).then(async (response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const events = parser.parse(text);

        for (const event of events) {
          switch (event.type) {
            case 'node-start':
              handlers.onNodeStart(event.nodeId);
              break;
            case 'node-complete':
              handlers.onNodeComplete(event.nodeId, event.result);
              break;
            case 'node-output':
              handlers.onNodeOutput(event.nodeId, event.chunk);
              break;
            case 'edge-executed':
              handlers.onEdgeExecuted(event.edgeId);
              break;
            case 'iteration-start':
              handlers.onIterationStart(event.loopId, event.iteration);
              break;
            case 'iteration-complete':
              handlers.onIterationComplete(event.loopId, event.iteration, event.success);
              break;
            case 'workflow-complete':
              handlers.onComplete(event.success, event.error);
              break;
          }
        }
      }
    } finally {
      parser.reset();
    }
  }).catch((error) => {
    if (error.name !== 'AbortError') {
      handlers.onComplete(false, error.message);
    }
    parser.reset();
  });

  return () => controller.abort();
}
```

#### 1.4 Executor Callbacks (`packages/server/src/engine/executor.ts`)

Expand `ExecuteOptions` to include streaming callbacks:

```typescript
export interface ExecuteOptions {
  // ... existing options
  onNodeStart?: (nodeId: string, node: WorkflowNode) => void;
  onNodeComplete?: (nodeId: string, result: NodeResult) => void;
  onNodeOutput?: (nodeId: string, chunk: string) => void;
  onEdgeExecuted?: (edgeId: string, sourceNodeId: string, data: unknown) => void;
  onIterationStart?: (loopId: string, iteration: number) => void;
  onIterationComplete?: (loopId: string, iteration: number, success: boolean) => void;
}
```

Call `onNodeStart` before executing each node; call `onNodeComplete` after. Call `onEdgeExecuted` when resolving inputs from a source node.

---

### Phase 2: Node Status Updates

**Goal**: Show real-time node execution status in designer.

#### 2.1 Update App.tsx State Handler

```typescript
const handleExecute = async () => {
  // Reset all nodes to pending
  setNodes((nds) => nds.map((n) => ({
    ...n,
    data: { ...n.data, executionStatus: 'pending', output: undefined }
  })));

  const cancel = executeWorkflowStream(request, {
    onNodeStart: (nodeId) => {
      setNodes((nds) => nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, executionStatus: 'running' } } : n
      ));
    },
    onNodeComplete: (nodeId, result) => {
      setNodes((nds) => nds.map((n) =>
        n.id === nodeId ? {
          ...n,
          data: {
            ...n.data,
            executionStatus: result.status === 'completed' ? 'completed' : 'failed',
            output: result.rawOutput,
            error: result.error,
          }
        } : n
      ));
    },
    onComplete: (success, error) => {
      setIsExecuting(false);
      if (error) toast.error(error);
    },
  });

  // Store cancel function for abort button
  setCancelExecution(() => cancel);
};
```

#### 2.2 Loop Inner Node Status

The loop executor calls `executeWorkflow` for inner nodes, which already invokes `onNodeStart`/`onNodeComplete` callbacks. However, the callbacks must be passed through from the outer execution context.

Modify loop executor to forward callbacks:

```typescript
// In loop-executor.ts executeLoop()
const workflowResult = await executeWorkflowFn(innerNodes, innerEdges, {
  ...options,  // Forward all callbacks including onNodeStart, onNodeComplete
  workflowInputs: iterationInputs,
  startNodeIds: innerNodeIds,
  loopId: loopNode.id,
  dockContext: { dockOutputs, dockOutputEdges },
});

// Callbacks are already invoked by executeWorkflowFn for each inner node.
// No additional forwarding needed here - just ensure options are passed through.
```

The key fix: ensure `executeLoop` passes the callback options to the recursive `executeWorkflowFn` call. This way inner nodes fire `onNodeStart` (transitions to "running") and `onNodeComplete` (transitions to "completed"/"failed") naturally.

If inner nodes still don't transition, verify the executor calls callbacks:

```typescript
// In executor.ts executeNode() - must call BEFORE execution
options.onNodeStart?.(node.id, node);

// ... execute node ...

// Must call AFTER execution with result
options.onNodeComplete?.(node.id, result);
```

---

### Phase 3: Edge Visualization

**Goal**: Show execution count badges and animated data flow on edges.

#### 3.1 Custom Edge Component (`packages/designer/src/edges/AnimatedEdge.tsx`)

```tsx
import { BaseEdge, EdgeProps, getSmoothStepPath, useStore } from 'reactflow';

interface AnimatedEdgeData {
  executionCount: number;
  isAnimating: boolean;
}

export function AnimatedEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data,
}: EdgeProps<AnimatedEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });

  const { executionCount = 0, isAnimating = false } = data || {};

  return (
    <>
      {/* Base edge */}
      <BaseEdge id={id} path={edgePath} />

      {/* Execution count badge */}
      {executionCount > 0 && (
        <foreignObject
          x={labelX - 12}
          y={labelY - 12}
          width={24}
          height={24}
          className="edge-count-badge"
        >
          <div className="edge-count">
            {executionCount}
          </div>
        </foreignObject>
      )}

      {/* Animated dot */}
      {isAnimating && (
        <circle r={4} fill="#3b82f6">
          <animateMotion
            dur="0.5s"
            repeatCount="1"
            path={edgePath}
          />
        </circle>
      )}
    </>
  );
}
```

#### 3.2 Edge State Management

```typescript
// In App.tsx - track edge execution
const [edgeData, setEdgeData] = useState<Map<string, { count: number; animating: boolean }>>(new Map());

// SSE handler
onEdgeExecuted: (edgeId) => {
  setEdgeData((prev) => {
    const next = new Map(prev);
    const current = next.get(edgeId) || { count: 0, animating: false };
    next.set(edgeId, { count: current.count + 1, animating: true });
    return next;
  });

  // Clear animation after duration
  setTimeout(() => {
    setEdgeData((prev) => {
      const next = new Map(prev);
      const current = next.get(edgeId);
      if (current) next.set(edgeId, { ...current, animating: false });
      return next;
    });
  }, 500);
},

// Apply to edges
const edgesWithData = edges.map((e) => ({
  ...e,
  type: 'animated',
  data: edgeData.get(e.id) || { count: 0, animating: false },
}));
```

#### 3.3 Edge Styles (`packages/designer/src/edges/AnimatedEdge.css`)

```css
.edge-count-badge {
  overflow: visible;
  pointer-events: none;
}

.edge-count {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #1e40af;
  color: white;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

.edge-count.animate {
  animation: pulse 0.3s ease-in-out;
}
```

#### 3.4 Register Edge Type

```typescript
// packages/designer/src/edges/index.ts
export const edgeTypes = {
  animated: AnimatedEdge,
};

// In App.tsx ReactFlow component
<ReactFlow
  nodes={nodes}
  edges={edgesWithData}
  edgeTypes={edgeTypes}
  defaultEdgeOptions={{ type: 'animated' }}
  // ...
/>
```

---

### Phase 4: Agent Output Streaming

**Goal**: Stream agent output tokens as they're generated.

#### 4.1 OpenAI Runner Streaming (`packages/server/src/engine/agents/openai.ts`)

```typescript
export const openaiRunner: AgentRunner = {
  name: 'openai',
  async execute(config, options) {
    const openai = new OpenAI();

    if (options?.onOutput) {
      // Streaming mode
      const stream = await openai.chat.completions.create({
        model: config.model || 'gpt-4',
        messages: [{ role: 'user', content: config.prompt }],
        stream: true,
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullContent += content;
        options.onOutput(content);
      }

      return { success: true, output: fullContent };
    } else {
      // Non-streaming (existing behavior)
      const response = await openai.chat.completions.create({
        model: config.model || 'gpt-4',
        messages: [{ role: 'user', content: config.prompt }],
      });
      return { success: true, output: response.choices[0].message.content };
    }
  }
};
```

#### 4.2 Claude Code Runner Streaming (`packages/server/src/engine/agents/claude-code.ts`)

Claude Code CLI outputs to stdout progressively. Capture and stream:

```typescript
export const claudeCodeRunner: AgentRunner = {
  name: 'claude-code',
  async execute(config, options) {
    return new Promise((resolve) => {
      const proc = spawn('claude', buildArgs(config));
      let output = '';

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        options?.onOutput?.(chunk);
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
          exitCode: code,
        });
      });
    });
  }
};
```

#### 4.3 Executor Integration

Pass streaming callback through to agent runners:

```typescript
// In executeNode for 'agent' type
case 'agent': {
  const result = await runner.execute(agentConfig, {
    onOutput: (chunk) => {
      options.onNodeOutput?.(node.id, chunk);
    },
  });
  // ...
}
```

#### 4.4 Designer: Streaming Output Display

Update node to show streaming output:

```typescript
// In BaseNode.tsx or separate OutputPanel
const [streamingOutput, setStreamingOutput] = useState('');

// In App.tsx SSE handler
onNodeOutput: (nodeId, chunk) => {
  // Append to node's streaming output
  setNodes((nds) => nds.map((n) =>
    n.id === nodeId ? {
      ...n,
      data: {
        ...n.data,
        streamingOutput: (n.data.streamingOutput || '') + chunk
      }
    } : n
  ));
},
```

Consider a collapsible output panel on nodes to show live output without cluttering the canvas.

---

### Phase 5: Loop Iteration Display

**Goal**: Show current iteration number on loop container nodes.

#### 5.1 Loop Container State

```typescript
// In LoopContainerNode.tsx
interface LoopContainerData {
  // ... existing fields from schema
  maxIterations: number;  // Already exists in schema

  // Runtime state (set during execution)
  currentIteration?: number;
  iterationStatus?: 'idle' | 'running' | 'completed' | 'failed';
  finalIteration?: number;  // Set on completion for display
}
```

#### 5.2 Iteration Badge UI

Badge persists after completion showing final count:

```tsx
// In LoopContainerNode.tsx
const showBadge = data.iterationStatus && data.iterationStatus !== 'idle';
const isComplete = data.iterationStatus === 'completed' || data.iterationStatus === 'failed';

{showBadge && (
  <div className={`iteration-badge ${data.iterationStatus}`}>
    <span className="iteration-current">
      {isComplete ? data.finalIteration : data.currentIteration}
    </span>
    {data.maxIterations && (
      <span className="iteration-max">/ {data.maxIterations}</span>
    )}
    {isComplete && (
      <span className="iteration-status-icon">
        {data.iterationStatus === 'completed' ? '✓' : '✗'}
      </span>
    )}
  </div>
)}
```

```css
.iteration-badge {
  position: absolute;
  top: -10px;
  right: -10px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.iteration-badge.running { background: #fbbf24; color: #78350f; }
.iteration-badge.completed { background: #22c55e; color: white; }
.iteration-badge.failed { background: #ef4444; color: white; }
```

#### 5.3 SSE Handler

```typescript
onIterationStart: (loopId, iteration) => {
  setNodes((nds) => nds.map((n) =>
    n.id === loopId ? {
      ...n,
      data: {
        ...n.data,
        currentIteration: iteration,
        iterationStatus: 'running',
      }
    } : n
  ));
},

onIterationComplete: (loopId, iteration, success) => {
  // Update iteration but stay in 'running' until workflow-complete
  // (next iteration will start, or loop will end)
  setNodes((nds) => nds.map((n) =>
    n.id === loopId ? {
      ...n,
      data: {
        ...n.data,
        currentIteration: iteration,
        // Don't change status here - wait for next iteration-start or workflow-complete
      }
    } : n
  ));
},

// In onComplete handler, finalize loop states
onComplete: (success, error) => {
  setNodes((nds) => nds.map((n) => {
    if (n.data.nodeType === 'loop' && n.data.iterationStatus === 'running') {
      return {
        ...n,
        data: {
          ...n.data,
          iterationStatus: success ? 'completed' : 'failed',
          finalIteration: n.data.currentIteration,
        }
      };
    }
    return n;
  }));
  setIsExecuting(false);
  if (error) toast.error(error);
},
```

#### 5.4 Iteration History

Store iteration history for post-execution review:

```typescript
interface LoopContainerData {
  // ... existing
  iterations?: Array<{
    number: number;
    success: boolean;
    nodeResults: NodeResult[];
  }>;
}
```

---

## File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `packages/core/src/execution-events.ts` | Event type definitions |
| `packages/server/src/routes/execute-stream.ts` | SSE streaming endpoint |
| `packages/designer/src/lib/sse-parser.ts` | Stateful SSE parser with chunk buffering |
| `packages/designer/src/lib/execute-stream.ts` | Streaming execution client |
| `packages/designer/src/edges/AnimatedEdge.tsx` | Custom edge with animation |
| `packages/designer/src/edges/AnimatedEdge.css` | Edge styles |
| `packages/designer/src/edges/index.ts` | Edge type exports |

### Modified Files

| File | Changes |
|------|---------|
| `packages/server/src/engine/executor.ts` | Add callback invocations |
| `packages/server/src/engine/loop-executor.ts` | Add iteration callbacks |
| `packages/server/src/engine/agents/openai.ts` | Add streaming support |
| `packages/server/src/engine/agents/claude-code.ts` | Add output streaming |
| `packages/server/src/engine/agents/types.ts` | Add `onOutput` callback |
| `packages/designer/src/App.tsx` | SSE integration, edge state |
| `packages/designer/src/nodes/LoopContainerNode.tsx` | Iteration badge |
| `packages/designer/src/nodes/BaseNode.tsx` | Streaming output display |

---

## Testing

Add tests to `packages/server/src/test-progressive.ts` using Node's built-in test runner.

### Test File Structure

```typescript
// packages/server/src/test-progressive.ts
import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import { executeWorkflowSchema } from './engine/executor.js';
import type { ExecutionEvent } from '@shodan/core';

// Test helpers
function createMockCallbacks() {
  return {
    nodeStarts: [] as string[],
    nodeCompletes: [] as Array<{ nodeId: string; status: string }>,
    edgesExecuted: [] as string[],
    iterationStarts: [] as Array<{ loopId: string; iteration: number }>,
    iterationCompletes: [] as Array<{ loopId: string; iteration: number; success: boolean }>,
    outputChunks: [] as Array<{ nodeId: string; chunk: string }>,

    onNodeStart(nodeId: string) { this.nodeStarts.push(nodeId); },
    onNodeComplete(nodeId: string, result: any) {
      this.nodeCompletes.push({ nodeId, status: result.status });
    },
    onEdgeExecuted(edgeId: string) { this.edgesExecuted.push(edgeId); },
    onIterationStart(loopId: string, iteration: number) {
      this.iterationStarts.push({ loopId, iteration });
    },
    onIterationComplete(loopId: string, iteration: number, success: boolean) {
      this.iterationCompletes.push({ loopId, iteration, success });
    },
    onNodeOutput(nodeId: string, chunk: string) {
      this.outputChunks.push({ nodeId, chunk });
    },
  };
}
```

### Phase 1: Executor Callback Tests

```typescript
describe('Executor Callbacks', () => {
  test('onNodeStart fires before each node execution', async () => {
    const callbacks = createMockCallbacks();
    const result = await runWorkflow('hello-world.yaml', callbacks);

    assert.strictEqual(result.success, true);
    assert.ok(callbacks.nodeStarts.includes('trigger'));
    assert.ok(callbacks.nodeStarts.includes('shell_1'));

    // Verify order: trigger before shell
    const triggerIdx = callbacks.nodeStarts.indexOf('trigger');
    const shellIdx = callbacks.nodeStarts.indexOf('shell_1');
    assert.ok(triggerIdx < shellIdx, 'trigger should start before shell');
  });

  test('onNodeComplete fires after each node with result', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('hello-world.yaml', callbacks);

    const shell = callbacks.nodeCompletes.find(n => n.nodeId === 'shell_1');
    assert.ok(shell, 'shell_1 should have completed');
    assert.strictEqual(shell.status, 'completed');
  });

  test('onNodeStart and onNodeComplete pair correctly', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('multi-line-demo.yaml', callbacks);

    // Every node that started should have completed
    for (const nodeId of callbacks.nodeStarts) {
      const completed = callbacks.nodeCompletes.some(n => n.nodeId === nodeId);
      assert.ok(completed, `${nodeId} started but never completed`);
    }
  });

  test('onNodeComplete includes failure status on error', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-failure-stops-workflow.yaml', callbacks);

    const failed = callbacks.nodeCompletes.find(n => n.nodeId === 'shell-fail');
    assert.ok(failed, 'shell-fail should have completed');
    assert.strictEqual(failed.status, 'failed');
  });
});
```

### Phase 2: Edge Execution Tracking Tests

```typescript
describe('Edge Execution Tracking', () => {
  test('onEdgeExecuted fires when data flows through edge', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-phase2-io.yaml', {
      ...callbacks,
      triggerInputs: { text: 'test' }
    });

    // Should have edges from trigger to shell-1, shell-1 to shell-2
    assert.ok(callbacks.edgesExecuted.length >= 2,
      `Expected at least 2 edge executions, got ${callbacks.edgesExecuted.length}`);
  });

  test('edge execution count matches expected for linear workflow', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('project-info.yaml', callbacks);

    // Count unique edges
    const uniqueEdges = new Set(callbacks.edgesExecuted);
    assert.ok(uniqueEdges.size >= 2, 'Should have executed multiple edges');
  });

  test('loop edges execute multiple times', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-constant-true.yaml', callbacks);

    // Loop runs 3 iterations - internal edges should fire 3 times
    const edgeCounts = new Map<string, number>();
    for (const edgeId of callbacks.edgesExecuted) {
      edgeCounts.set(edgeId, (edgeCounts.get(edgeId) || 0) + 1);
    }

    // Find an edge that runs inside the loop
    let foundMultipleExecutions = false;
    for (const [edgeId, count] of edgeCounts) {
      if (count === 3) {
        foundMultipleExecutions = true;
        break;
      }
    }
    assert.ok(foundMultipleExecutions,
      'At least one edge should execute 3 times for 3 iterations');
  });
});
```

### Phase 3: Loop Iteration Callback Tests

```typescript
describe('Loop Iteration Callbacks', () => {
  test('onIterationStart fires for each iteration', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-constant-true.yaml', callbacks);

    assert.strictEqual(callbacks.iterationStarts.length, 3,
      'Should have 3 iteration starts');

    // Verify iteration numbers
    assert.deepStrictEqual(
      callbacks.iterationStarts.map(i => i.iteration),
      [1, 2, 3]
    );
  });

  test('onIterationComplete fires after each iteration', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-constant-true.yaml', callbacks);

    assert.strictEqual(callbacks.iterationCompletes.length, 3);

    // All should be successful
    for (const iter of callbacks.iterationCompletes) {
      assert.strictEqual(iter.success, true,
        `Iteration ${iter.iteration} should succeed`);
    }
  });

  test('iteration callbacks include correct loopId', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-constant-true.yaml', callbacks);

    for (const iter of callbacks.iterationStarts) {
      assert.strictEqual(iter.loopId, 'loop',
        'Loop ID should match workflow definition');
    }
  });

  test('nested loops fire callbacks for both levels', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-nested.yaml', callbacks);

    // Outer loop runs 3 times, inner loop runs 2 times each = 6 inner iterations
    const outerStarts = callbacks.iterationStarts.filter(i => i.loopId === 'outer-loop');
    const innerStarts = callbacks.iterationStarts.filter(i => i.loopId === 'inner-loop');

    assert.strictEqual(outerStarts.length, 3, 'Outer loop should run 3 times');
    assert.strictEqual(innerStarts.length, 6, 'Inner loop should run 6 times total');
  });

  test('loop inner nodes trigger onNodeStart/onNodeComplete per iteration', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-constant-true.yaml', callbacks);

    // Inner node 'log' should complete 3 times (once per iteration)
    const logCompletes = callbacks.nodeCompletes.filter(n => n.nodeId === 'log');
    assert.strictEqual(logCompletes.length, 3,
      'Inner node should complete once per iteration');
  });

  test('early loop termination reports correct iteration count', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-loop-constant-false.yaml', callbacks);

    // Loop should only run 1 iteration
    assert.strictEqual(callbacks.iterationStarts.length, 1);
    assert.strictEqual(callbacks.iterationCompletes.length, 1);
    assert.strictEqual(callbacks.iterationCompletes[0].iteration, 1);
  });
});
```

### Phase 4: SSE Parser Tests

```typescript
import { SSEParser } from '../designer/src/lib/sse-parser.js';

describe('SSE Parser', () => {
  test('parse handles single complete event', () => {
    const parser = new SSEParser();
    const input = 'data: {"type":"node-start","nodeId":"shell_1","timestamp":123}\n\n';
    const events = parser.parse(input);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'node-start');
    assert.strictEqual(events[0].nodeId, 'shell_1');
  });

  test('parse handles multiple events in one chunk', () => {
    const parser = new SSEParser();
    const input = [
      'data: {"type":"node-start","nodeId":"a","timestamp":1}',
      '',
      'data: {"type":"node-complete","nodeId":"a","result":{"status":"completed"},"timestamp":2}',
      '',
    ].join('\n');

    const events = parser.parse(input);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'node-start');
    assert.strictEqual(events[1].type, 'node-complete');
  });

  test('parse ignores non-data lines', () => {
    const parser = new SSEParser();
    const input = [
      ':comment',
      'data: {"type":"node-start","nodeId":"a","timestamp":1}',
      '',
      'retry: 1000',
      '',
    ].join('\n');

    const events = parser.parse(input);
    assert.strictEqual(events.length, 1);
  });

  test('parse buffers incomplete data across chunks', () => {
    const parser = new SSEParser();

    // First chunk: incomplete event
    const chunk1 = 'data: {"type":"node-sta';
    const events1 = parser.parse(chunk1);
    assert.strictEqual(events1.length, 0, 'Should buffer incomplete event');

    // Second chunk: completes the event
    const chunk2 = 'rt","nodeId":"a","timestamp":1}\n\n';
    const events2 = parser.parse(chunk2);
    assert.strictEqual(events2.length, 1);
    assert.strictEqual(events2[0].type, 'node-start');
  });

  test('parse handles event split across multiple chunks', () => {
    const parser = new SSEParser();

    // Split JSON across 3 chunks
    const events1 = parser.parse('data: {"type":');
    assert.strictEqual(events1.length, 0);

    const events2 = parser.parse('"node-start","nodeId":');
    assert.strictEqual(events2.length, 0);

    const events3 = parser.parse('"x","timestamp":1}\n\n');
    assert.strictEqual(events3.length, 1);
    assert.strictEqual(events3[0].nodeId, 'x');
  });

  test('parse handles multiple events with one incomplete', () => {
    const parser = new SSEParser();

    // Complete event followed by partial
    const chunk = 'data: {"type":"node-start","nodeId":"a","timestamp":1}\n\ndata: {"type":"node-com';
    const events = parser.parse(chunk);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'node-start');

    // Complete the partial event
    const events2 = parser.parse('plete","nodeId":"a","result":{},"timestamp":2}\n\n');
    assert.strictEqual(events2.length, 1);
    assert.strictEqual(events2[0].type, 'node-complete');
  });

  test('reset clears buffer', () => {
    const parser = new SSEParser();

    parser.parse('data: {"type":"incomplete');
    parser.reset();

    // After reset, new data should parse fresh
    const events = parser.parse('data: {"type":"node-start","nodeId":"a","timestamp":1}\n\n');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'node-start');
  });
});
```

### Phase 5: Agent Streaming Tests

```typescript
describe('Agent Output Streaming', { skip: process.env.TEST_AGENTS !== '1' }, () => {
  test('OpenAI runner streams output chunks', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-openai-simple.yaml', callbacks);

    // Should have received multiple output chunks
    const openaiOutputs = callbacks.outputChunks.filter(c => c.nodeId === 'agent');
    assert.ok(openaiOutputs.length > 1,
      `Expected multiple output chunks, got ${openaiOutputs.length}`);

    // Concatenated output should form complete response
    const fullOutput = openaiOutputs.map(c => c.chunk).join('');
    assert.ok(fullOutput.length > 0, 'Should have non-empty output');
  });

  test('Claude Code runner streams stdout', async () => {
    const callbacks = createMockCallbacks();
    await runWorkflow('test-claude-simple.yaml', callbacks);

    const claudeOutputs = callbacks.outputChunks.filter(c => c.nodeId === 'agent');
    assert.ok(claudeOutputs.length >= 1, 'Should receive output from Claude');
  });
});
```

### Test Workflow Files

Create minimal test workflows:

**`workflows/test-progressive-linear.yaml`**
```yaml
version: 1
metadata:
  name: Progressive Linear Test
  description: Simple 3-node linear workflow for testing callbacks
nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 100 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
  - id: step1
    type: shell
    position: { x: 200, y: 100 }
    data:
      nodeType: shell
      label: Step 1
      script: echo "Step 1"
  - id: step2
    type: shell
    position: { x: 350, y: 100 }
    data:
      nodeType: shell
      label: Step 2
      script: echo "Step 2"
  - id: step3
    type: shell
    position: { x: 500, y: 100 }
    data:
      nodeType: shell
      label: Step 3
      script: echo "Step 3"
edges:
  - id: e1
    source: trigger
    target: step1
  - id: e2
    source: step1
    target: step2
  - id: e3
    source: step2
    target: step3
```

**`workflows/test-progressive-parallel.yaml`**
```yaml
version: 1
metadata:
  name: Progressive Parallel Test
  description: Parallel branches for testing concurrent callbacks
nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
  - id: branch-a
    type: shell
    position: { x: 200, y: 50 }
    data:
      nodeType: shell
      label: Branch A
      script: echo "A"
  - id: branch-b
    type: shell
    position: { x: 200, y: 150 }
    data:
      nodeType: shell
      label: Branch B
      script: echo "B"
  - id: branch-c
    type: shell
    position: { x: 200, y: 250 }
    data:
      nodeType: shell
      label: Branch C
      script: echo "C"
  - id: merge
    type: shell
    position: { x: 400, y: 150 }
    data:
      nodeType: shell
      label: Merge
      script: echo "Merged"
edges:
  - id: e1
    source: trigger
    target: branch-a
  - id: e2
    source: trigger
    target: branch-b
  - id: e3
    source: trigger
    target: branch-c
  - id: e4
    source: branch-a
    target: merge
  - id: e5
    source: branch-b
    target: merge
  - id: e6
    source: branch-c
    target: merge
```

### E2E Visual Test Workflows (with sleeps)

These workflows use `sleep` to simulate longer-running nodes, making it easy to visually verify the UX of progressive updates.

**`workflows/test-progressive-slow-linear.yaml`**
```yaml
version: 1
metadata:
  name: Slow Linear Test
  description: Linear workflow with sleeps for visual UX testing
nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 100 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
  - id: step1
    type: shell
    position: { x: 200, y: 100 }
    data:
      nodeType: shell
      label: Step 1 (2s)
      script: |
        echo "Starting step 1..."
        sleep 2
        echo "Step 1 complete"
  - id: step2
    type: shell
    position: { x: 400, y: 100 }
    data:
      nodeType: shell
      label: Step 2 (1s)
      script: |
        echo "Starting step 2..."
        sleep 1
        echo "Step 2 complete"
  - id: step3
    type: shell
    position: { x: 600, y: 100 }
    data:
      nodeType: shell
      label: Step 3 (1.5s)
      script: |
        echo "Starting step 3..."
        sleep 1.5
        echo "Step 3 complete"
edges:
  - id: e1
    source: trigger
    target: step1
  - id: e2
    source: step1
    target: step2
  - id: e3
    source: step2
    target: step3
```

**`workflows/test-progressive-slow-parallel.yaml`**
```yaml
version: 1
metadata:
  name: Slow Parallel Test
  description: Parallel branches with varying sleeps for visual UX testing
nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
  - id: fast
    type: shell
    position: { x: 200, y: 50 }
    data:
      nodeType: shell
      label: Fast (0.5s)
      script: |
        echo "Fast branch..."
        sleep 0.5
        echo "Fast done"
  - id: medium
    type: shell
    position: { x: 200, y: 150 }
    data:
      nodeType: shell
      label: Medium (1.5s)
      script: |
        echo "Medium branch..."
        sleep 1.5
        echo "Medium done"
  - id: slow
    type: shell
    position: { x: 200, y: 250 }
    data:
      nodeType: shell
      label: Slow (3s)
      script: |
        echo "Slow branch..."
        sleep 3
        echo "Slow done"
  - id: merge
    type: shell
    position: { x: 450, y: 150 }
    data:
      nodeType: shell
      label: Merge
      script: echo "All branches complete!"
edges:
  - id: e1
    source: trigger
    target: fast
  - id: e2
    source: trigger
    target: medium
  - id: e3
    source: trigger
    target: slow
  - id: e4
    source: fast
    target: merge
  - id: e5
    source: medium
    target: merge
  - id: e6
    source: slow
    target: merge
```

**`workflows/test-progressive-slow-loop.yaml`**
```yaml
version: 2
metadata:
  name: Slow Loop Test
  description: Loop with sleep per iteration for visual UX testing
nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual

  - id: loop
    type: loop
    position: { x: 200, y: 50 }
    style: { width: 350, height: 200 }
    data:
      nodeType: loop
      label: Slow Loop
      maxIterations: 5
      dockSlots:
        - name: iteration
          type: iteration
          valueType: number
        - name: continue
          type: continue
          valueType: boolean

  - id: work
    type: shell
    parentId: loop
    position: { x: 50, y: 50 }
    data:
      nodeType: shell
      label: Do Work (1s)
      script: |
        echo "Iteration {{ inputs.i }}: working..."
        sleep 1
        echo "Iteration {{ inputs.i }}: done"
      inputs:
        - name: i
          type: number

  - id: keep-going
    type: constant
    parentId: loop
    position: { x: 200, y: 50 }
    data:
      nodeType: constant
      label: Continue
      valueType: boolean
      value: true
      outputs:
        - name: value
          type: boolean

edges:
  - id: iter-to-work
    source: loop
    target: work
    sourceHandle: "dock:iteration:output"
    targetHandle: "input:i"

  - id: const-to-continue
    source: keep-going
    target: loop
    sourceHandle: "output:value"
    targetHandle: "dock:continue:input"
```

**`workflows/test-progressive-slow-failure.yaml`**
```yaml
version: 1
metadata:
  name: Slow Failure Test
  description: Workflow that fails mid-execution for visual UX testing
nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 100 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
  - id: step1
    type: shell
    position: { x: 200, y: 100 }
    data:
      nodeType: shell
      label: Step 1 (OK)
      script: |
        echo "Step 1 running..."
        sleep 1
        echo "Step 1 success"
  - id: step2
    type: shell
    position: { x: 400, y: 100 }
    data:
      nodeType: shell
      label: Step 2 (FAIL)
      script: |
        echo "Step 2 running..."
        sleep 1.5
        echo "Step 2 failing!" >&2
        exit 1
  - id: step3
    type: shell
    position: { x: 600, y: 100 }
    data:
      nodeType: shell
      label: Step 3 (skip)
      script: echo "This should never run"
edges:
  - id: e1
    source: trigger
    target: step1
  - id: e2
    source: step1
    target: step2
  - id: e3
    source: step2
    target: step3
```

#### Visual UX Test Checklist

Run each workflow in the designer and verify:

| Workflow | What to Verify |
|----------|----------------|
| `test-progressive-slow-linear.yaml` | Nodes turn yellow (running) one at a time, then green (complete) in sequence |
| `test-progressive-slow-parallel.yaml` | All 3 branches turn yellow simultaneously; fast finishes first, slow last; merge waits for all |
| `test-progressive-slow-loop.yaml` | Iteration badge updates 1→2→3→4→5; inner node flashes yellow/green 5 times; edge counter shows "5" |
| `test-progressive-slow-failure.yaml` | Step 1 green, Step 2 red, Step 3 stays gray (never ran) |

### Running Tests

```bash
# Run all progressive results tests
pnpm run -F @shodan/server test:progressive

# Run with agent tests (requires API keys)
TEST_AGENTS=1 pnpm run -F @shodan/server test:progressive
```

Add to `packages/server/package.json`:
```json
{
  "scripts": {
    "test:progressive": "tsx --test src/test-progressive.ts"
  }
}
```

### Test Coverage Matrix

| Feature | Unit Test | Integration Test | E2E Test |
|---------|-----------|------------------|----------|
| onNodeStart callback | ✓ | ✓ | - |
| onNodeComplete callback | ✓ | ✓ | - |
| onEdgeExecuted callback | ✓ | ✓ | - |
| onIterationStart callback | ✓ | ✓ | - |
| onIterationComplete callback | ✓ | ✓ | - |
| onNodeOutput callback | ✓ | ✓ (agents) | - |
| SSE event parsing | ✓ | - | - |
| Loop inner node status | - | ✓ | - |
| Nested loop callbacks | - | ✓ | - |
| Execution order verification | - | ✓ | - |
| Edge count per iteration | - | ✓ | - |

---

## Future Enhancements

- **Cancel execution**: Add abort button that calls `controller.abort()`
- **Execution timeline**: Side panel showing event log with timestamps
- **Replay mode**: Re-animate past execution from stored events
- **Edge highlighting**: Color edges based on data type or execution recency
- **Parallel execution visualization**: Show concurrent node execution

---

## Dependencies

- No new npm dependencies required
- Uses native browser `fetch` with streaming response
- Uses SVG `animateMotion` for dot animation (no animation library)
