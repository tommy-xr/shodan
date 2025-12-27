# Loop Primitive Design

This document outlines the design for a Loop node that enables iterative workflows with feedback loops.

**Prerequisites**: Phases 1-5 of the I/O system must be complete (see `plan/completed/input-output.md`).

## Design Decisions

Key decisions made for consistency and simplicity:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Continue condition | `interface-continue` node with boolean input | Consistent with component pattern; visual; logic is explicit in graph |
| Loop interior | Visible (container), not abstracted | Unlike components; use component inside loop if abstraction needed |
| Previous iteration access | `interface-input` exposes `prev.*` outputs | Auto-generated from `interface-output` inputs; null on first iteration |
| Built-in outputs | `iteration` on `interface-input` | Available as wirable output, not magic variable |
| `workflowRef` when using inline | Omit field entirely | Cleaner than `null`; TypeScript optional field handles this |
| Type coercion | Not supported (strict matching) | Per I/O system design; types must match exactly |

## Motivation

Some workflows require iteration until a condition is met:
- Code review loops: write code → review → revise until approved
- Refinement loops: generate → evaluate → improve until quality threshold
- Retry patterns: attempt → check → retry until success or max attempts

A pure DAG cannot express these patterns. We need a loop primitive.

---

## Design

The Loop node uses the same **interface node pattern** as components, but with key differences:

| Aspect | Component | Loop |
|--------|-----------|------|
| Inner workflow | Hidden (abstracted) | Visible (container/frame) |
| Drill-down needed | Yes, to see internals | No, always visible |
| Abstraction | Yes, shows as single node | No, shows inner workflow |
| If you want to abstract loop contents | N/A | Put a component inside the loop |

**Interface nodes (inside the loop's inner workflow):**

| Node Type | Purpose | Ports |
|-----------|---------|-------|
| `interface-input` | Receives outer inputs | Outputs: each outer input + `iteration` (number) + `prev.*` (previous iteration outputs) |
| `interface-output` | Sends outputs to loop's outer ports | Inputs: values to expose as loop outputs |
| `interface-continue` | Controls iteration | Input: `continue` (boolean) - `true` = run another iteration |

**Execution flow:**

1. Loop receives inputs via edges (like a component)
2. Inner workflow executes with `interface-input` providing values
3. After inner workflow completes, check `interface-continue.continue`:
   - `true` → run another iteration (interface-input gets `prev.*` from this iteration's interface-output)
   - `false` → stop, apply interface-output values to loop's output ports
4. Safety: `maxIterations` on loop node prevents infinite loops

### Visual Representation

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔁 Loop: Code Review                                                    │
│                                                                         │
│  ○ task              approved ●                                         │
│  ○ guidelines        final_code ●                                       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Inner Workflow                                                  │    │
│  │                                                                 │    │
│  │ ┌─────────────┐      ┌──────────┐      ┌──────────┐            │    │
│  │ │ ⊕ Input     │      │ 🤖 Coder │      │ 🤖 Review│            │    │
│  │ │             │      │          │      │          │            │    │
│  │ │   task ●────┼─────▶│          │      │          │            │    │
│  │ │   guidelines●─────▶│          │─────▶│          │            │    │
│  │ │   iteration ●      │          │      │          │            │    │
│  │ │   prev.* ●─────────│──────────│─────▶│          │            │    │
│  │ └─────────────┘      └──────────┘      └────┬─────┘            │    │
│  │                                             │                   │    │
│  │                     ┌───────────────────────┼───────────────┐   │    │
│  │                     │                       │               │   │    │
│  │                     ▼                       ▼               │   │    │
│  │              ┌─────────────┐         ┌─────────────┐        │   │    │
│  │              │ ⊕ Output    │         │ ⊕ Continue  │        │   │    │
│  │              │             │         │             │        │   │    │
│  │              │ ○ approved  │         │ ○ continue  │◀── NOT(approved)
│  │              │ ○ final_code│         └─────────────┘        │   │    │
│  │              └─────────────┘                                │   │    │
│  │                                                             │   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  max iterations: 5                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Iteration 1:
  interface-input provides:
    task ← from outer edge
    guidelines ← from outer edge
    iteration = 1
    prev.approved = null (no previous iteration)
    prev.feedback = null

  [inner workflow executes: coder → review]

  interface-output receives:
    approved ← review.approved (false)
    final_code ← coder.code

  interface-continue receives:
    continue ← NOT(review.approved) = true → CONTINUE

Iteration 2:
  interface-input provides:
    task ← from outer edge
    guidelines ← from outer edge
    iteration = 2
    prev.approved = false (from iteration 1)
    prev.feedback = "needs error handling" (from iteration 1)

  [inner workflow executes: coder uses prev.feedback → review]

  interface-output receives:
    approved ← review.approved (true)
    final_code ← coder.code

  interface-continue receives:
    continue ← NOT(review.approved) = false → STOP

Final:
  Loop outputs ← interface-output values from last iteration
```

---

## Loop Node Configuration

```typescript
interface LoopNodeData extends BaseNodeData {
  nodeType: 'loop';

  // Inner workflow - either reference or inline (exactly one must be provided)
  workflowRef?: string;            // Path to workflow file
  inlineWorkflow?: WorkflowSchema; // Or embedded workflow

  // Safety limit to prevent infinite loops
  maxIterations: number;  // Default: 10
}

// The inner workflow MUST contain these interface nodes:
// - Exactly one interface-input node (provides outer inputs + iteration + prev.*)
// - Exactly one interface-output node (defines loop's output ports)
// - Exactly one interface-continue node (controls iteration)
```

### Interface Node Types

```typescript
// Same as component - receives values from outer edges
interface InterfaceInputNodeData extends BaseNodeData {
  nodeType: 'interface-input';
  // Outputs are derived from loop's input ports + built-ins
  // Built-in outputs (auto-added):
  //   - iteration: number (1-based)
  //   - prev.*: previous iteration's interface-output values (null on first iteration)
}

// Same as component - sends values to outer edges
interface InterfaceOutputNodeData extends BaseNodeData {
  nodeType: 'interface-output';
  // Inputs become the loop's output ports
  // These values also become available as prev.* on next iteration
}

// Loop-specific - controls whether to continue iterating
interface InterfaceContinueNodeData extends BaseNodeData {
  nodeType: 'interface-continue';
  // Single input:
  //   - continue: boolean (true = run another iteration, false = stop)
}
```

---

## Example: Code Review Loop

```yaml
version: 2
metadata:
  name: Code Review Loop Example
  description: Demonstrates a loop that iterates until code review is approved

nodes:
  - id: review-loop
    type: loop
    data:
      label: Code Review Loop
      nodeType: loop
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

      inlineWorkflow:
        nodes:
          # Interface nodes
          - id: input
            type: interface-input
            data:
              nodeType: interface-input
              label: Input
              outputs:
                - name: task
                  type: string
                - name: guidelines
                  type: string
                - name: iteration
                  type: number
                # prev.* outputs auto-generated from interface-output

          - id: output
            type: interface-output
            data:
              nodeType: interface-output
              label: Output
              inputs:
                - name: approved
                  type: boolean
                - name: final_code
                  type: string
                - name: feedback
                  type: string  # Available as prev.feedback on next iteration

          - id: continue
            type: interface-continue
            data:
              nodeType: interface-continue
              label: Continue?
              inputs:
                - name: continue
                  type: boolean

          # Logic nodes
          - id: not-gate
            type: shell
            data:
              nodeType: shell
              label: NOT
              script: |
                if [ "{{ inputs.value }}" = "true" ]; then
                  echo "false"
                else
                  echo "true"
                fi
              inputs:
                - name: value
                  type: boolean
              outputs:
                - name: result
                  type: boolean
                  extract:
                    type: regex
                    pattern: '(true|false)'

          # Agent nodes
          - id: coder
            type: agent
            data:
              label: Coder
              nodeType: agent
              runner: openai
              model: gpt-4o
              prompt: |
                Task: {{ inputs.task }}

                {% if inputs.feedback %}
                Previous feedback to address:
                {{ inputs.feedback }}
                {% else %}
                Guidelines: {{ inputs.guidelines }}
                {% endif %}

                Write code to complete this task.
              inputs:
                - name: task
                  type: string
                - name: guidelines
                  type: string
                - name: feedback
                  type: string
              outputs:
                - name: code
                  type: string

          - id: review
            type: agent
            data:
              label: Reviewer
              nodeType: agent
              runner: openai
              model: gpt-4o
              prompt: |
                Review this code:
                {{ inputs.code }}

                Evaluate the code quality and determine if it meets the requirements.
              outputSchema: |
                {
                  "type": "object",
                  "properties": {
                    "approved": { "type": "boolean" },
                    "feedback": { "type": "string" }
                  },
                  "required": ["approved", "feedback"]
                }
              inputs:
                - name: code
                  type: string
              outputs:
                - name: approved
                  type: boolean
                - name: feedback
                  type: string

        edges:
          # Input → Coder
          - { source: input, target: coder, sourceHandle: "output:task", targetHandle: "input:task" }
          - { source: input, target: coder, sourceHandle: "output:guidelines", targetHandle: "input:guidelines" }
          - { source: input, target: coder, sourceHandle: "output:prev.feedback", targetHandle: "input:feedback" }

          # Coder → Review
          - { source: coder, target: review, sourceHandle: "output:code", targetHandle: "input:code" }

          # Review → Output
          - { source: review, target: output, sourceHandle: "output:approved", targetHandle: "input:approved" }
          - { source: review, target: output, sourceHandle: "output:feedback", targetHandle: "input:feedback" }
          - { source: coder, target: output, sourceHandle: "output:code", targetHandle: "input:final_code" }

          # Review → NOT → Continue
          - { source: review, target: not-gate, sourceHandle: "output:approved", targetHandle: "input:value" }
          - { source: not-gate, target: continue, sourceHandle: "output:result", targetHandle: "input:continue" }

edges: []  # Loop is standalone in this example
```

> **Note**: The inner workflow explicitly wires everything - including the continue condition. The `interface-input` auto-exposes `prev.*` outputs for each `interface-output` input from the previous iteration.

---

## Simple Test Example (Shell-Only)

A minimal loop example using only shell nodes for quick testing during development:

```yaml
version: 2
metadata:
  name: Counter Loop Test
  description: Simple loop that counts up to a target number

nodes:
  - id: trigger
    type: trigger
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
      outputs:
        - name: text
          type: string

  - id: count-loop
    type: loop
    data:
      label: Count to 5
      nodeType: loop
      maxIterations: 10

      inputs:
        - name: target
          type: string
          default: "5"

      outputs:
        - name: final_count
          type: number

      inlineWorkflow:
        nodes:
          # Interface nodes
          - id: input
            type: interface-input
            data:
              nodeType: interface-input
              label: Input
              outputs:
                - name: target
                  type: string
                - name: iteration
                  type: number
                # prev.count auto-generated from interface-output

          - id: output
            type: interface-output
            data:
              nodeType: interface-output
              label: Output
              inputs:
                - name: count
                  type: number

          - id: continue
            type: interface-continue
            data:
              nodeType: interface-continue
              label: Continue?
              inputs:
                - name: continue
                  type: boolean

          # Counter logic
          - id: counter
            type: shell
            data:
              nodeType: shell
              label: Increment Counter
              script: |
                TARGET={{ inputs.target }}
                PREV={{ inputs.prev_count }}
                PREV=${PREV:-0}
                COUNT=$((PREV + 1))
                echo "Count: $COUNT / $TARGET"
                if [ $COUNT -lt $TARGET ]; then
                  echo "CONTINUE=true"
                else
                  echo "CONTINUE=false"
                fi
              inputs:
                - name: target
                  type: string
                - name: prev_count
                  type: number
              outputs:
                - name: count
                  type: number
                  extract:
                    type: regex
                    pattern: 'Count: (\d+)'
                - name: should_continue
                  type: boolean
                  extract:
                    type: regex
                    pattern: 'CONTINUE=(true|false)'

        edges:
          # Input → Counter
          - { source: input, target: counter, sourceHandle: "output:target", targetHandle: "input:target" }
          - { source: input, target: counter, sourceHandle: "output:prev.count", targetHandle: "input:prev_count" }

          # Counter → Output
          - { source: counter, target: output, sourceHandle: "output:count", targetHandle: "input:count" }

          # Counter → Continue
          - { source: counter, target: continue, sourceHandle: "output:should_continue", targetHandle: "input:continue" }

edges:
  - { source: trigger, target: count-loop, sourceHandle: "output:text", targetHandle: "input:target" }
```

This example:
- Trigger starts workflow; its `text` output wires to loop's `target` input
- Run via CLI: `shodan run counter-loop.yaml --input "5"`
- Uses shell nodes only (no API keys needed)
- Demonstrates the `extract` field for parsing structured data from shell output
- Uses `interface-input.prev.count` to access previous iteration's count
- Wires `should_continue` boolean directly to `interface-continue`

---

## Execution Semantics

### Iteration Lifecycle

```
1. Initialize
   - iteration = 0
   - Resolve outer inputs from incoming edges

2. Prepare interface-input
   - iteration++
   - Populate outputs from outer edges (task, guidelines, etc.)
   - Set iteration = current iteration number
   - Set prev.* = interface-output values from previous iteration (null if iteration == 1)

3. Execute inner workflow
   - Run topological sort and execute all nodes
   - interface-output collects values
   - interface-continue receives boolean

4. Check continuation
   - Read interface-continue.continue value
   - If true AND iteration < maxIterations: goto step 2
   - If false OR iteration >= maxIterations: goto step 5

5. Finalize
   - Loop's output ports ← interface-output values from last iteration
```

### Error Handling

- If inner workflow fails: loop terminates with error
- If max iterations reached: loop terminates with warning, outputs last successful iteration
- All iteration outputs are available in execution logs for debugging

### Validation

The executor must validate:
- Exactly one `interface-input` node exists
- Exactly one `interface-output` node exists
- Exactly one `interface-continue` node exists
- `interface-continue` has an incoming edge to its `continue` input

---

## UI Considerations

### Loop Node Display

Unlike components, loops show their inner workflow directly:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔁 Loop: Code Review                              [max: 5]     │
│ ○ task                                        approved ●       │
│ ○ guidelines                                  final_code ●     │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                                                             │ │
│ │   ⊕ Input ──▶ 🤖 Coder ──▶ 🤖 Review ──▶ ⊕ Output          │ │
│ │       │                         │                           │ │
│ │       └─────────────────────────┼──▶ NOT ──▶ ⊕ Continue     │ │
│ │                                 │                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ During execution: "Iteration 3/5"                               │
└─────────────────────────────────────────────────────────────────┘
```

- Inner workflow is always visible (not hidden like components)
- Interface nodes (⊕) have distinct styling
- Iteration progress shown during execution
- Max iterations displayed in header

### Configuration Panel

```
┌─────────────────────────────────────────────────┐
│ Loop: Code Review                               │
├─────────────────────────────────────────────────┤
│ Max Iterations: [5    ]                         │
├─────────────────────────────────────────────────┤
│ Inner Workflow:                                 │
│   ○ Inline (edit in canvas)                     │
│   ○ Reference: [________________] [Browse...]   │
├─────────────────────────────────────────────────┤
│ Inputs (from interface-input):                  │
│   • task (string, required)                     │
│   • guidelines (string)                         │
├─────────────────────────────────────────────────┤
│ Outputs (from interface-output):                │
│   • approved (boolean)                          │
│   • final_code (string)                         │
└─────────────────────────────────────────────────┘
```

- No mappings UI needed - wiring is visual in the inner workflow
- Inputs/outputs derived from interface nodes
- Config panel is simpler than before

---

## Relationship to Components

**A Loop is a Component with iteration semantics.** The inner workflow is treated exactly like a component's internal workflow, with the addition of:
- **Iteration**: Re-executes the inner workflow multiple times
- **Feedback**: Previous iteration outputs can feed into the next iteration via `inputMappings`
- **Termination**: `continueWhile` condition evaluated after each iteration

| Aspect | Component | Loop |
|--------|-----------|------|
| Contains workflow | Yes | Yes |
| Has I/O interface | Yes | Yes |
| Executes once | Yes | No (iterates) |
| Previous outputs → next inputs | No | Yes (`inputMappings` with `iterations: subsequent`) |
| Termination condition | No | Yes (`continueWhile`) |

**Implementation sharing** - Loops should reuse component infrastructure:
- Workflow embedding (`inlineWorkflow`) and referencing (`workflowRef`)
- I/O port display and configuration
- Drill-down navigation to view/edit inner workflow
- Input/output mapping UI (extended with iteration controls)

---

## Project Structure

Loop implementation files in the monorepo structure:

```
src/
├── core/src/
│   ├── loop-types.ts       # LoopNodeData, InterfaceContinueNodeData ✅
│   ├── workflow-types.ts   # WorkflowNode, WorkflowEdge, WorkflowSchema, InlineWorkflow ✅
│   └── index.ts            # Re-exports all types ✅
├── server/src/engine/
│   └── loop-executor.ts    # Loop execution logic, iteration management ✅
├── designer/src/
│   ├── nodes/
│   │   ├── BaseNode.tsx    # Extended with loop, interface-continue types ✅
│   │   └── index.ts        # Node type registry ✅
│   └── components/
│       └── LoopConfigPanel.tsx  # Loop-specific configuration UI (Phase 2)
└── cli/
    └── (no changes needed - uses server executor)
```

---

## Template Syntax

The loop system uses the same template syntax as the I/O system. All values are accessed via wired edges, not magic variables:

| Source | How to Access | Example |
|--------|---------------|---------|
| Outer inputs | Wire from `interface-input` outputs | `interface-input.task → coder.task` |
| Iteration number | Wire from `interface-input.iteration` | Can be used in prompts via edge |
| Previous iteration | Wire from `interface-input.prev.*` | `interface-input.prev.feedback → coder.feedback` |

**No special loop template syntax** - everything is explicit wiring through interface nodes.

---

## Implementation Phases

> **Prerequisite**: The I/O system (Phases 1-5) and Component system (Phase 6) must be complete. This provides:
> - Typed input/output ports on nodes
> - Interface nodes (`interface-input`, `interface-output`)
> - Edge-based data flow between nodes

### Phase 0: Type Definitions ✅
- [x] Add `LoopNodeData` interface to `@shodan/core` (`src/core/src/loop-types.ts`)
- [x] Add `InterfaceContinueNodeData` interface (`src/core/src/loop-types.ts`)
- [x] Add `loop` and `interface-continue` to node type unions (`src/designer/src/nodes/index.ts`, `BaseNode.tsx`)
- [x] Update workflow schema types - moved to `@shodan/core` (`src/core/src/workflow-types.ts`)

### Phase 1: Core Loop Execution ✅
- [x] Loop node executor implementation (`src/server/src/engine/loop-executor.ts`)
- [x] Validate inner workflow has required interface nodes
- [x] Implement iteration lifecycle (prepare → execute → check → repeat)
- [x] `interface-input`: populate with outer inputs + `iteration` + `prev.*`
- [x] `interface-output`: collect values, make available as `prev.*` next iteration
- [x] `interface-continue`: read boolean to decide continuation
- [x] Respect `maxIterations` limit

**Phase 1 completion notes:**
- Created `loop-executor.ts` with `executeLoop()` function and `validateLoopWorkflow()` helper
- Integrated into main `executor.ts` via `loop` nodeType handler
- Added `interface-continue` node handling (reads boolean input for continuation)
- Test workflow: `workflows/test-loop-counter.yaml` demonstrates counting loop with shell nodes
- All existing tests pass

### Phase 2: UI Support
- [ ] Loop node as visible container (not abstracted like components)
- [ ] Interface node styling (distinct from regular nodes)
- [ ] Execution progress indicator ("Iteration 3/5")
- [ ] Configuration panel (just `maxIterations` + workflow source)

### Phase 3: Polish
- [ ] Iteration history view (see each iteration's outputs in logs)
- [ ] Validation error messages for missing interface nodes
- [ ] Support `workflowRef` (reference external workflow file as loop body)

---

## Open Questions

1. **Parallel loops (map/forEach)**: Should we support running iterations in parallel over a collection? This would be a different primitive - more like a "map" node than a feedback loop.

2. **Nested loops**: Loops containing loops should work naturally since the inner workflow can contain any nodes. Worth testing.

3. **Session resumption**: For CLI agents (claude-code, codex), should we support resuming the same conversation across iterations?
   - Pro: Agent remembers previous attempts, reduces token usage
   - Con: Adds complexity, session cleanup needed
   - Decision: Defer to future enhancement

4. **Logic nodes**: The examples use a shell-based NOT gate. Should we add built-in logic nodes (NOT, AND, OR, comparison)?
   - Pro: Cleaner than shell workarounds
   - Con: Scope creep
   - Decision: Start with shell-based logic; add built-ins if patterns emerge
