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

### Data Model: Flat `parentId` Approach

Instead of nesting workflows inside loop nodes, we use ReactFlow's native `parentId` pattern. Child nodes reference their parent loop, keeping a flat structure:

```typescript
interface LoopNodeData extends BaseNodeData {
  nodeType: 'loop';

  // Safety limit to prevent infinite loops
  maxIterations: number;  // Default: 10

  // Container dimensions (for visual rendering)
  width?: number;   // Default: 500
  height?: number;  // Default: 400
}

// Child nodes use parentId to belong to a loop:
interface ChildNode extends Node {
  parentId?: string;  // References loop node ID
  extent?: 'parent';  // Constrains movement within parent
  position: { x: number; y: number };  // Relative to parent
}

// The loop MUST contain these child nodes (identified by parentId):
// - Exactly one interface-input node (provides outer inputs + iteration + prev.*)
// - Exactly one interface-output node (defines loop's output ports)
// - Exactly one interface-continue node (controls iteration)
```

**Benefits of flat model:**
- Mirrors ReactFlow's native sub-flow pattern
- No syncing between visual state and nested data
- Single source of truth (nodes array)
- Extensible to future container types (parallel, conditional, retry)
- Simpler executor logic (filter by parentId)

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

## Example: Code Review Loop (Flat parentId Model)

```yaml
version: 2
metadata:
  name: Code Review Loop Example
  description: Demonstrates a loop that iterates until code review is approved

nodes:
  # === Loop Container ===
  - id: review-loop
    type: loop
    position: { x: 100, y: 100 }
    style: { width: 600, height: 500 }
    data:
      label: Code Review Loop
      nodeType: loop
      maxIterations: 5

  # === Child Nodes (inside the loop) ===
  # Note: All child nodes have parentId referencing the loop

  # Interface nodes
  - id: loop-input
    type: interface-input
    parentId: review-loop
    extent: parent
    position: { x: 20, y: 50 }
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

  - id: loop-output
    type: interface-output
    parentId: review-loop
    extent: parent
    position: { x: 400, y: 350 }
    data:
      nodeType: interface-output
      label: Output
      inputs:
        - name: approved
          type: boolean
        - name: final_code
          type: string
        - name: feedback
          type: string

  - id: loop-continue
    type: interface-continue
    parentId: review-loop
    extent: parent
    position: { x: 20, y: 350 }
    data:
      nodeType: interface-continue
      label: Continue?
      inputs:
        - name: continue
          type: boolean

  # Logic nodes
  - id: not-gate
    type: shell
    parentId: review-loop
    extent: parent
    position: { x: 200, y: 350 }
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
    parentId: review-loop
    extent: parent
    position: { x: 200, y: 50 }
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

  - id: reviewer
    type: agent
    parentId: review-loop
    extent: parent
    position: { x: 400, y: 150 }
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
  - { source: loop-input, target: coder, sourceHandle: "output:task", targetHandle: "input:task" }
  - { source: loop-input, target: coder, sourceHandle: "output:guidelines", targetHandle: "input:guidelines" }
  - { source: loop-input, target: coder, sourceHandle: "output:prev.feedback", targetHandle: "input:feedback" }

  # Coder → Review
  - { source: coder, target: reviewer, sourceHandle: "output:code", targetHandle: "input:code" }

  # Review → Output
  - { source: reviewer, target: loop-output, sourceHandle: "output:approved", targetHandle: "input:approved" }
  - { source: reviewer, target: loop-output, sourceHandle: "output:feedback", targetHandle: "input:feedback" }
  - { source: coder, target: loop-output, sourceHandle: "output:code", targetHandle: "input:final_code" }

  # Review → NOT → Continue
  - { source: reviewer, target: not-gate, sourceHandle: "output:approved", targetHandle: "input:value" }
  - { source: not-gate, target: loop-continue, sourceHandle: "output:result", targetHandle: "input:continue" }
```

> **Note**: All edges are at the top level - the executor identifies inner edges by checking if both source and target have `parentId` matching the loop. The `interface-input` auto-exposes `prev.*` outputs for each `interface-output` input from the previous iteration.

---

## Simple Test Example (Shell-Only, Flat parentId Model)

A minimal loop example using only shell nodes for quick testing during development:

```yaml
version: 2
metadata:
  name: Counter Loop Test
  description: Simple loop that counts up to a target number

nodes:
  # === Trigger (outside loop) ===
  - id: trigger
    type: trigger
    position: { x: 50, y: 200 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual
      outputs:
        - name: text
          type: string

  # === Loop Container ===
  - id: count-loop
    type: loop
    position: { x: 250, y: 100 }
    style: { width: 450, height: 350 }
    data:
      label: Count to 5
      nodeType: loop
      maxIterations: 10

  # === Child Nodes (inside loop) ===
  - id: loop-input
    type: interface-input
    parentId: count-loop
    extent: parent
    position: { x: 20, y: 50 }
    data:
      nodeType: interface-input
      label: Input
      outputs:
        - name: target
          type: string
        - name: iteration
          type: number
        # prev.count auto-generated from interface-output

  - id: loop-output
    type: interface-output
    parentId: count-loop
    extent: parent
    position: { x: 300, y: 200 }
    data:
      nodeType: interface-output
      label: Output
      inputs:
        - name: count
          type: number

  - id: loop-continue
    type: interface-continue
    parentId: count-loop
    extent: parent
    position: { x: 20, y: 200 }
    data:
      nodeType: interface-continue
      label: Continue?
      inputs:
        - name: continue
          type: boolean

  - id: counter
    type: shell
    parentId: count-loop
    extent: parent
    position: { x: 180, y: 50 }
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
  # External: Trigger → Loop (connects to loop's input port)
  - { source: trigger, target: count-loop, sourceHandle: "output:text", targetHandle: "input:target" }

  # Internal: Input → Counter
  - { source: loop-input, target: counter, sourceHandle: "output:target", targetHandle: "input:target" }
  - { source: loop-input, target: counter, sourceHandle: "output:prev.count", targetHandle: "input:prev_count" }

  # Internal: Counter → Output
  - { source: counter, target: loop-output, sourceHandle: "output:count", targetHandle: "input:count" }

  # Internal: Counter → Continue
  - { source: counter, target: loop-continue, sourceHandle: "output:should_continue", targetHandle: "input:continue" }
```

This example:
- Trigger starts workflow; connects to loop's external input port
- Run via CLI: `shodan run counter-loop.yaml --input "5"`
- Uses shell nodes only (no API keys needed)
- All nodes are flat in the `nodes` array - child nodes have `parentId: count-loop`
- All edges are flat in the `edges` array - executor filters by parentId to find inner edges
- Uses `interface-input.prev.count` to access previous iteration's count

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
│   │   ├── nodes.css       # Loop and interface node styling ✅
│   │   └── index.ts        # Node type registry ✅
│   ├── index.css           # CSS variables for loop colors ✅
│   └── components/
│       ├── ConfigPanel.tsx # LoopConfig + InterfaceConfig (interface-continue) ✅
│       └── Sidebar.tsx     # Loop node in palette ✅
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

### Phase 2: UI Support (Basic) ✅
- [x] Loop node styling (purple color scheme)
- [x] Interface node styling (dashed cyan borders)
- [x] Execution progress indicator ("Iteration 3/5")
- [x] Configuration panel (maxIterations, workflow source picker)
- [x] Loop node in sidebar palette

**Phase 2 completion notes:**
- Added loop node styling with purple color scheme (`--node-loop: #a855f7`)
- Interface nodes (`interface-input`, `interface-output`, `interface-continue`) have dashed cyan borders
- Loop node added to sidebar palette for drag-and-drop creation
- Created `LoopConfig` component in ConfigPanel
- Execution progress shows "Iteration X/Y" during loop execution with pulse animation
- Added `currentIteration` field to `BaseNodeData` for tracking loop progress

**Note:** Phase 2 implemented basic styling but NOT the container/sub-flow behavior. The loop currently acts as a regular node. Phases 3a-3d implement the visual container using ReactFlow's sub-flow pattern.

---

### Phase 3a: Loop as Sub-Flow Container

**Goal:** Transform the loop node into a visual container using ReactFlow's `parentId` pattern.

**Key Concepts (from ReactFlow docs):**
- Child nodes use `parentId` to reference parent
- Child positions are **relative** to parent (not absolute)
- `extent: 'parent'` constrains children within parent bounds
- Parent nodes must appear **before** children in the nodes array

**Tasks:**
- [ ] Create `LoopContainerNode` component (renders as resizable frame)
- [ ] Update node type registry to use container node for loops
- [ ] Add minimum dimensions for loop container (e.g., 400x300)
- [ ] Style container with header bar (label, max iterations badge) and content area
- [ ] Auto-create interface nodes when loop is dropped:
  - `interface-input` (top-left of container)
  - `interface-output` (bottom-right of container)
  - `interface-continue` (bottom-center of container)
- [ ] Set `parentId` on interface nodes to link them to loop
- [ ] Ensure parent nodes sorted before children in nodes array

**Data Structure Changes:**
```typescript
// Loop container node
{
  id: 'loop-1',
  type: 'loop',
  position: { x: 100, y: 100 },
  style: { width: 500, height: 400 },  // Container dimensions
  data: {
    nodeType: 'loop',
    label: 'Code Review Loop',
    maxIterations: 5,
  }
}

// Child interface node (auto-created)
{
  id: 'loop-1-input',
  type: 'interface-input',
  parentId: 'loop-1',              // Links to parent
  extent: 'parent',                 // Constrained to parent
  position: { x: 20, y: 50 },       // Relative to parent
  data: {
    nodeType: 'interface-input',
    label: 'Input',
    outputs: [...]
  }
}
```

---

### Phase 3b: Drag-and-Drop into Loop Container

**Goal:** Allow users to drag nodes from palette into loop, and move existing nodes into/out of loops.

**Tasks:**
- [ ] Detect when node is dropped inside loop container bounds
- [ ] Auto-set `parentId` and convert position to relative coordinates
- [ ] Handle dragging node out of loop (remove `parentId`, convert to absolute)
- [ ] Visual feedback when dragging over loop (highlight drop zone)
- [ ] Prevent interface nodes from being dragged out of their parent loop
- [ ] Update edge connections when nodes move into/out of loops

**Drop Detection Logic:**
```typescript
const onNodeDragStop = (event, node) => {
  // Find if node is inside any loop container
  const loopContainers = nodes.filter(n => n.data.nodeType === 'loop');

  for (const loop of loopContainers) {
    if (isInsideBounds(node.position, loop)) {
      // Convert to relative position and set parentId
      node.parentId = loop.id;
      node.extent = 'parent';
      node.position = {
        x: node.position.x - loop.position.x,
        y: node.position.y - loop.position.y
      };
    }
  }
};
```

---

### Phase 3c: Visual Frame and Interface Node Layout

**Goal:** Clear visual indication of loop boundary with organized interface node placement.

**Visual Design:**
```
┌─────────────────────────────────────────────────────────────────┐
│ 🔁 Code Review Loop                                   [max: 5]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐                                                │
│  │ ⊕ Input     │─────────────────────┐                         │
│  │   task ●    │                     │                         │
│  │   prev.* ●  │                     ▼                         │
│  │   iter ●    │              ┌──────────────┐                 │
│  └─────────────┘              │  [User adds  │                 │
│                               │   nodes here]│                 │
│                               └──────┬───────┘                 │
│                                      │                         │
│  ┌─────────────┐              ┌──────▼───────┐                 │
│  │ ⊕ Continue  │◀─────────────│ ⊕ Output     │                 │
│  │ ○ continue  │              │ ○ result     │                 │
│  └─────────────┘              └──────────────┘                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tasks:**
- [ ] Loop header bar with icon, label, and max iterations badge
- [ ] Dashed or double border to distinguish from regular nodes
- [ ] Resize handles on loop container
- [ ] Minimum size enforcement (must fit interface nodes)
- [ ] Interface nodes positioned at semantic locations:
  - Input: top-left (data flows in)
  - Output: bottom-right (data flows out)
  - Continue: bottom-left (loop control)
- [ ] Visual guides/snap lines for alignment inside loop
- [ ] Different background color/pattern for loop interior

---

### Phase 3d: Executor Support for Flat parentId Model

**Goal:** Update the loop executor to find inner nodes/edges by filtering on `parentId` instead of reading `inlineWorkflow`.

**Tasks:**
- [ ] Remove `inlineWorkflow` and `workflowRef` from `LoopNodeData` type
- [ ] Update `executeLoop()` to filter nodes by `parentId`
- [ ] Update `executeLoop()` to filter edges where both endpoints are inside loop
- [ ] Validate required interface nodes exist (interface-input, interface-output, interface-continue)
- [ ] Show validation warnings if required nodes are missing
- [ ] Update workflow YAML schema to support `parentId` and `extent` on nodes

**Executor Logic:**
```typescript
const executeLoop = async (
  loopNode: WorkflowNode,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
  context: ExecutionContext
) => {
  // Get child nodes by filtering on parentId
  const innerNodes = allNodes.filter(n => n.parentId === loopNode.id);

  // Get inner edges (both endpoints inside loop)
  const innerNodeIds = new Set(innerNodes.map(n => n.id));
  const innerEdges = allEdges.filter(e =>
    innerNodeIds.has(e.source) && innerNodeIds.has(e.target)
  );

  // Validate required interface nodes
  const interfaceInput = innerNodes.find(n => n.data.nodeType === 'interface-input');
  const interfaceOutput = innerNodes.find(n => n.data.nodeType === 'interface-output');
  const interfaceContinue = innerNodes.find(n => n.data.nodeType === 'interface-continue');

  if (!interfaceInput || !interfaceOutput || !interfaceContinue) {
    throw new Error('Loop missing required interface nodes');
  }

  // Execute iterations using innerNodes and innerEdges...
};
```

---

### Phase 3e: Loop I/O Ports on Container

**Goal:** Loop container shows input/output ports based on interface nodes inside.

**Tasks:**
- [ ] Loop container has input handles on left (from interface-input outputs)
- [ ] Loop container has output handles on right (from interface-output inputs)
- [ ] Ports update automatically when interface nodes change
- [ ] External nodes can connect to loop's ports
- [ ] Connections to loop ports map to interface node connections internally

**Visual:**
```
                    ┌─────────────────────────────────────┐
     ○ task ────────│ 🔁 Code Review Loop                 │──────── approved ●
     ○ guidelines ──│                                     │──────── final_code ●
                    │   [interface-input]──▶[...]──▶[interface-output]
                    │                         │
                    │                    [interface-continue]
                    └─────────────────────────────────────┘
```

---

### Phase 4: Polish
- [ ] Iteration history view (see each iteration's outputs in logs)
- [ ] Validation error messages for missing interface nodes (visual indicators)
- [ ] Copy/paste nodes into loops
- [ ] Undo/redo support for loop operations
- [ ] Support `workflowRef` (reference external workflow file as loop body) - lower priority since inline is default

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
