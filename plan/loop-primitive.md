# Loop Primitive Design

This document outlines the design for a Loop node that enables iterative workflows with feedback loops.

## Motivation

Some workflows require iteration until a condition is met:
- Code review loops: write code → review → revise until approved
- Refinement loops: generate → evaluate → improve until quality threshold
- Retry patterns: attempt → check → retry until success or max attempts

A pure DAG cannot express these patterns. We need a loop primitive.

---

## Design

The Loop node is a special container that:
1. Contains an inner workflow (like a component)
2. Executes the inner workflow repeatedly
3. Passes outputs from one iteration as inputs to the next
4. Terminates when a condition becomes false (or max iterations reached)

### Visual Representation

```
┌──────────────────────────────────────────────────┐
│ 🔁 Loop: Code Review                             │
│                                                  │
│  ○ task              approved ●                  │
│  ○ guidelines        final_code ●                │
│                      iterations ●                │
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  │  ┌──────────┐        ┌──────────┐         │  │
│  │  │ 🤖 Coder │───────▶│ 🤖 Review│         │  │
│  │  └──────────┘        └──────────┘         │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  continue while: review.approved == false        │
│  max iterations: 5                               │
└──────────────────────────────────────────────────┘
```

### Data Flow

```
Iteration 1:
  outer.task ──────────────▶ coder.task
  outer.guidelines ─────────▶ coder.guidelines
  coder.code ───────────────▶ review.code
  review.approved ──────────▶ [check: false, continue]
  review.feedback ──────────▶ [store for next iteration]

Iteration 2:
  outer.task ──────────────▶ coder.task
  outer.guidelines ─────────▶ coder.guidelines
  review.feedback (prev) ───▶ coder.feedback    ← feedback loop
  coder.code ───────────────▶ review.code
  review.approved ──────────▶ [check: true, stop]

Final:
  review.approved ──────────▶ outer.approved
  coder.code ───────────────▶ outer.final_code
  iteration_count ──────────▶ outer.iterations
```

---

## Loop Node Configuration

```typescript
interface LoopNodeData extends BaseNodeData {
  nodeType: 'loop';

  // Inner workflow - either reference or inline
  workflowRef?: string;           // Path to workflow file
  inlineWorkflow?: WorkflowSchema; // Or embedded workflow

  // Continuation condition
  continueWhile: {
    output: string;      // Which inner output to check
    operator: '==' | '!=' | '<' | '>' | '<=' | '>=';
    value: unknown;      // Value to compare against
  };

  // Safety limits
  maxIterations: number;  // Default: 10

  // Input mappings: how outer inputs feed into inner workflow
  // On first iteration: outer input → inner input
  // On subsequent iterations: can also use previous iteration outputs
  inputMappings: InputMapping[];

  // Output mappings: which inner outputs become loop outputs
  outputMappings: OutputMapping[];
}

interface InputMapping {
  // Source: either an outer input or a previous iteration output
  source:
    | { type: 'outer'; name: string }
    | { type: 'previous'; node: string; output: string };

  // Target: inner workflow input
  target: { node: string; input: string };

  // When to use this mapping
  iterations: 'first' | 'subsequent' | 'all';
}

interface OutputMapping {
  // Source: inner workflow output
  source: { node: string; output: string };

  // Target: loop node output
  target: string;

  // Which iteration's value to use
  take: 'last' | 'first' | 'all';  // 'all' produces array
}
```

---

## Example: Code Review Loop

```yaml
- id: review-loop
  type: loop
  data:
    label: Code Review Loop
    nodeType: loop
    workflowRef: null  # inline workflow below

    continueWhile:
      output: review.approved
      operator: "=="
      value: false

    maxIterations: 5

    inputs:
      - name: task
        type: string
        required: true
      - name: guidelines
        type: string

    outputs:
      - name: approved
        type: boolean
      - name: final_code
        type: string
      - name: iterations
        type: number

    inputMappings:
      # First iteration: task comes from outer input
      - source: { type: outer, name: task }
        target: { node: coder, input: task }
        iterations: all

      # First iteration: no feedback yet
      - source: { type: outer, name: guidelines }
        target: { node: coder, input: context }
        iterations: first

      # Subsequent iterations: include review feedback
      - source: { type: previous, node: review, output: feedback }
        target: { node: coder, input: context }
        iterations: subsequent

    outputMappings:
      - source: { node: review, output: approved }
        target: approved
        take: last

      - source: { node: coder, output: code }
        target: final_code
        take: last

      # Built-in: iteration count
      - source: { type: builtin, name: iteration_count }
        target: iterations

    # Inner workflow (inline)
    inlineWorkflow:
      nodes:
        - id: coder
          type: agent
          data:
            label: Coder
            nodeType: agent
            runner: claude-code
            prompt: |
              Task: {{ task }}
              Context: {{ context }}

              Write code to complete this task.
            inputs:
              - name: task
                type: string
              - name: context
                type: string
            outputs:
              - name: code
                type: string

        - id: review
          type: agent
          data:
            label: Reviewer
            nodeType: agent
            runner: claude-code
            prompt: |
              Review this code:
              {{ coder.code }}

              Respond with JSON: { "approved": boolean, "feedback": string }
            inputs:
              - name: code
                type: string
            outputs:
              - name: approved
                type: boolean
              - name: feedback
                type: string

      edges:
        - source: coder
          target: review
          sourceHandle: output:code
          targetHandle: input:code
```

---

## Execution Semantics

### Iteration Lifecycle

```
1. Initialize
   - Set iteration_count = 0
   - Resolve outer inputs

2. Execute iteration
   - iteration_count++
   - Apply input mappings (outer or previous outputs)
   - Execute inner workflow
   - Store outputs for potential next iteration

3. Check continuation
   - Evaluate continueWhile condition
   - If true AND iteration_count < maxIterations: goto step 2
   - If false OR iteration_count >= maxIterations: goto step 4

4. Finalize
   - Apply output mappings
   - Produce loop node outputs
   - Include iteration_count as built-in output
```

### Error Handling

- If inner workflow fails: loop terminates with error
- If max iterations reached: loop terminates with warning, outputs last successful iteration
- All iteration outputs are available in execution logs for debugging

---

## UI Considerations

### Loop Node Display

- Collapsed view: shows as single node with I/O ports
- Expanded view: shows inner workflow (like drilling into a component)
- Iteration indicator during execution: "Iteration 3/5"
- Progress visualization: show which iteration is running

### Configuration Panel

```
┌─────────────────────────────────────────────────┐
│ Loop: Code Review                               │
├─────────────────────────────────────────────────┤
│ Inner Workflow: [Edit Inline] [Select File ▼]  │
├─────────────────────────────────────────────────┤
│ Continue While:                                 │
│   Output: [review.approved ▼]                   │
│   Operator: [== ▼]                              │
│   Value: [false]                                │
├─────────────────────────────────────────────────┤
│ Max Iterations: [5    ]                         │
├─────────────────────────────────────────────────┤
│ Input Mappings                          [+ Add] │
│ ┌─────────────────────────────────────────────┐ │
│ │ task (outer) → coder.task [all      ▼]     │ │
│ │ guidelines → coder.context [first   ▼]     │ │
│ │ review.feedback → coder.context [after ▼]  │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ Output Mappings                         [+ Add] │
│ ┌─────────────────────────────────────────────┐ │
│ │ review.approved → approved [last ▼]        │ │
│ │ coder.code → final_code [last ▼]           │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Relationship to Components

The Loop node is similar to a Component node but with iteration:

| Aspect | Component | Loop |
|--------|-----------|------|
| Contains workflow | Yes | Yes |
| Executes once | Yes | No (multiple) |
| Has I/O interface | Yes | Yes |
| Feeds outputs back | No | Yes |
| Has termination condition | No | Yes |

Implementation can share infrastructure:
- Workflow embedding/referencing
- I/O port display
- Drill-down navigation
- Input/output mapping UI

---

## Implementation Phases

### Phase 1: Core Loop Execution
- [ ] Loop node type definition
- [ ] Basic execution: run inner workflow N times
- [ ] Continuation condition evaluation
- [ ] Input mapping (outer → inner, previous → inner)
- [ ] Output mapping (inner → outer)

### Phase 2: UI Support
- [ ] Loop node rendering (collapsed)
- [ ] Configuration panel
- [ ] Execution progress indicator

### Phase 3: Drill-Down
- [ ] Expand to view inner workflow
- [ ] Edit inner workflow inline
- [ ] Iteration history view (see each iteration's outputs)

---

## Open Questions

1. **Parallel loops**: Should we support map/forEach patterns where the loop runs in parallel over a collection?

2. **Break conditions**: Besides the continue condition, should there be explicit break/early-exit outputs?

3. **Iteration state access**: Should inner nodes be able to access `iteration_count` as a template variable?

4. **Nested loops**: Should loops be nestable? (Probably yes, but adds complexity)

5. **Session resumption**: For CLI tools that support session IDs (claude-code, codex, etc.), loops could resume the same conversation across iterations rather than starting fresh. This would:
   - Preserve context (agent remembers previous attempts)
   - Reduce token usage (no need to re-send full history)
   - Enable more natural "revise based on feedback" flows

   Considerations:
   - Agent node would need `sessionId` output that persists across iterations
   - Runner adapters need `--resume <session-id>` support detection
   - How to handle session cleanup after loop completes?
   - Should session resumption be opt-in per agent node?
