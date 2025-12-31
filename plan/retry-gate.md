# Retry Gate Primitive

## Summary

A gate node for multi-stage validation pipelines that can re-trigger upstream nodes on failure.

## Problem

When modeling validation pipelines (review → test → de-dup), the current loop primitive requires nesting or complex wiring. A retry gate would enable flat, readable graphs:

```
                                    ┌───────────┐
Coder ──► Review ──► Test ──► Gate ─┤ all pass? ├──► done
  ▲                            │    └───────────┘
  │                            │
  └──── retry (with feedback) ─┘
```

## Proposed Behavior

**Gate node:**
- Collects pass/fail signals from upstream validators
- If all pass → emit `done` signal, workflow continues downstream
- If any fail → emit `retry` signal with aggregated feedback
- Retry signal re-triggers a specified upstream node (e.g., Coder)
- Tracks retry count, fails after `maxRetries`

## Interface

```yaml
- id: validation-gate
  type: gate
  data:
    label: All Checks Pass
    retryTarget: coder  # Node ID to re-trigger on failure
    maxRetries: 5
    inputs:
      - name: review_ok
        type: boolean
      - name: test_ok
        type: boolean
      - name: review_feedback
        type: string
      - name: test_feedback
        type: string
    outputs:
      - name: passed
        type: boolean
      - name: retry_feedback
        type: string
        description: Aggregated feedback from failed validators
      - name: retry_count
        type: number
```

## Execution Semantics

```typescript
interface GateExecution {
  // Check all boolean inputs
  const allPassed = inputs.every(i => i.type === 'boolean' && i.value === true);

  if (allPassed) {
    emit('passed', true);
    // Workflow continues downstream
  } else {
    retryCount++;
    if (retryCount > maxRetries) {
      emit('passed', false);
      emit('error', 'Max retries exceeded');
    } else {
      // Aggregate feedback from failed validators
      const feedback = aggregateFeedback(inputs);
      emit('retry_feedback', feedback);
      // Re-trigger the retryTarget node
      executor.retrigger(retryTarget, { feedback, retryCount });
    }
  }
}
```

## Implementation Considerations

### 1. Executor Support for Re-triggering

The executor needs to support "backtracking" - re-executing a node that already completed:

```typescript
interface Executor {
  // New method
  retrigger(nodeId: string, inputs: Record<string, unknown>): Promise<void>;
}
```

This would:
- Clear the node's previous result
- Re-queue the node for execution with new inputs
- Re-execute all downstream nodes after it completes

### 2. Execution Graph Tracking

Need to track which nodes depend on the retry target so they can be re-executed:

```
Coder → Review → Test → Gate
  │        │       │
  └────────┴───────┴── all need re-execution on retry
```

### 3. Session Persistence Integration

When re-triggering a resumable agent:
- Pass the existing `sessionId` so conversation continues
- Include aggregated feedback in the prompt

### 4. Visual Representation

The retry edge should be visually distinct (dashed? different color?) to indicate it's a backtracking edge, not a normal data flow.

## Alternative: Gate as Special Loop

Instead of new execution semantics, implement gate as a loop that wraps multiple nodes:

```
┌─ Gate (implicit loop) ────────────────────────┐
│                                               │
│  Coder ──► Review ──► Test ──► all passed? ──┼──► done
│    ▲                              │           │
│    └────── feedback ──────────────┘           │
│                                               │
│  continue ◄── NOT(all_passed)                 │
└───────────────────────────────────────────────┘
```

This uses existing loop execution but with a higher-level abstraction.

**Pros:** No new execution primitives needed
**Cons:** Still visually complex, nodes must be inside container

## Open Questions

1. **Partial re-execution:** Should only failed paths re-execute, or everything from Coder forward?

2. **State preservation:** Should Review's result be preserved if only Test failed?

3. **Retry strategy:** Linear backoff? Exponential? Configurable?

4. **Multiple retry targets:** Can gate retry different nodes based on which validator failed?

## Phases

### Phase 1: Basic Gate
- [ ] Gate node type with boolean aggregation
- [ ] Simple retry to single target node
- [ ] Executor support for retrigger()

### Phase 2: Advanced Features
- [ ] Configurable retry strategies
- [ ] Partial re-execution (only failed paths)
- [ ] Visual styling for retry edges

### Phase 3: Integration
- [ ] Combine with session persistence for resumable retries
- [ ] Designer UI for configuring gate nodes
