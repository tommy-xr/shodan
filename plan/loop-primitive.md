# Loop Primitive Design

This document outlines the design for a Loop node that enables iterative workflows with feedback loops.

**Prerequisites**: Phases 1-5 of the I/O system must be complete (see `plan/completed/input-output.md`).

## Design Decisions

Key decisions made for consistency and simplicity:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Continue condition | Dock slot with boolean input | Simple, always visible in loop dock |
| Loop interior | Visible (container), not abstracted | Unlike components; use component inside loop if abstraction needed |
| Previous iteration access | Dock feedback slots with bidirectional ports | Left port = prev value, Right port = current value |
| Built-in outputs | `iteration` dock slot | Always available, outputs current iteration number |
| Interface approach | **Dock-based** (not interface nodes) | Simpler model, no child nodes to manage |
| External edges from loop body | Fire only after loop completes | Internal→external edges are deferred until continue=false |
| Type coercion | Not supported (strict matching) | Per I/O system design; types must match exactly |

## Motivation

Some workflows require iteration until a condition is met:
- Code review loops: write code → review → revise until approved
- Refinement loops: generate → evaluate → improve until quality threshold
- Retry patterns: attempt → check → retry until success or max attempts

A pure DAG cannot express these patterns. We need a loop primitive.

---

## Design

The Loop node uses a **dock-based** UI for managing iteration data flow:

| Aspect | Component | Loop |
|--------|-----------|------|
| Inner workflow | Hidden (abstracted) | Visible (container/frame) |
| Drill-down needed | Yes, to see internals | No, always visible |
| Abstraction | Yes, shows as single node | No, shows inner workflow |
| Interface mechanism | Interface nodes | **Dock with slots** |
| If you want to abstract loop contents | N/A | Put a component inside the loop |

**Dock slots (built into the loop container):**

| Slot Type | Direction | Purpose |
|-----------|-----------|---------|
| `iteration` | Output only (`●→`) | Provides current iteration number (1-based) |
| `continue` | Input only (`→●`) | Receives boolean - `true` continues, `false` stops |
| Feedback slots | Bidirectional (`●→` + `→●`) | Left port: prev iteration value, Right port: current iteration value |

**Execution flow:**

1. Loop receives inputs via edges to external input ports (standard node ports)
2. Inner workflow executes:
   - Dock `iteration` slot outputs current iteration number
   - Dock feedback slots output previous iteration values (null on first iteration)
3. After inner workflow completes, check `continue` slot:
   - `true` → store feedback slot inputs as next iteration's outputs, run again
   - `false` → fire all edges from internal nodes to external nodes
4. Safety: `maxIterations` on loop node prevents infinite loops

### Visual Representation

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔁 Loop: Code Review                              [max: 5]      │
├─────────────────────────────────────────────────────────────────┤
│  ○ task                                      final_code ●       │
│  ○ guidelines                                                   │
│                                                                 │
│    ┌──────────────┐              ┌──────────────┐               │
│    │  🤖 Coder    │    code      │  🤖 Reviewer │               │
│    │              │─────────────▶│              │               │
│    │              │              │              │               │
│    └───────▲──────┘              └───────┬──────┘               │
│            │                             │                      │
│            │ feedback.prev               │ approved, feedback   │
│            │                             ▼                      │
├────────────┼─────────────────────────────┼──────────────────────┤
│  ┌─────────┴──┐   ┌──────────────────────▼───┐   ┌──────────┐   │
│  │ iteration  │   │        feedback          │   │ continue │   │
│  │    ●→      │   │   ●→               →●    │   │   →●     │   │
│  └────────────┘   └──────────────────────────┘   └────▲─────┘   │
│    (output)         (prev out)    (curr in)     (input)│        │
│                                                    NOT(approved)│
├─────────────────────────────────────────────────────────────────┤
│                    Iteration 3/5                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (edges fire after loop completes)
                        [External Node]
```

**Key visual elements:**
- **Header bar**: Loop icon, label, max iterations badge
- **External ports**: Left side (inputs), Right side (outputs) - standard node ports
- **Content area**: Where user places workflow nodes
- **Dock bar**: Bottom section with iteration/feedback/continue slots
- **Status bar**: Shows current iteration during execution

### Data Flow

```
Iteration 1:
  Dock slots provide:
    iteration ●→ outputs: 1
    feedback ●→ outputs: null (no previous iteration)

  Loop external inputs provide:
    task ← from outer edge
    guidelines ← from outer edge

  [inner workflow executes: coder → reviewer]

  Dock slots receive:
    feedback →● receives: "needs error handling" (from reviewer)
    continue →● receives: true (NOT approved)

  → CONTINUE to iteration 2

Iteration 2:
  Dock slots provide:
    iteration ●→ outputs: 2
    feedback ●→ outputs: "needs error handling" (stored from iteration 1)

  Loop external inputs provide:
    task ← from outer edge
    guidelines ← from outer edge

  [inner workflow executes: coder uses feedback.prev → reviewer]

  Dock slots receive:
    feedback →● receives: "looks good" (from reviewer)
    continue →● receives: false (NOT approved = NOT true = false)

  → STOP

After loop completes:
  All edges from internal nodes to external nodes fire
  e.g., coder.code → external-node.input
```

---

## Loop Node Configuration

### Data Model: Dock-Based Approach

The loop uses a dock-based model where iteration control is handled by slots in a dock bar at the bottom of the loop container:

```typescript
interface DockSlot {
  name: string;                              // Slot identifier
  type: 'iteration' | 'continue' | 'feedback';
  valueType: ValueType;                      // For feedback slots: string, number, json, etc.
}

interface LoopNodeData extends BaseNodeData {
  nodeType: 'loop';

  // Safety limit to prevent infinite loops
  maxIterations: number;  // Default: 10

  // Container dimensions (for visual rendering)
  width?: number;   // Default: 500
  height?: number;  // Default: 400

  // Dock configuration
  dockSlots: DockSlot[];
  // Built-in slots (always present):
  //   - { name: 'iteration', type: 'iteration', valueType: 'number' }
  //   - { name: 'continue', type: 'continue', valueType: 'boolean' }
  // User-defined feedback slots:
  //   - { name: 'feedback', type: 'feedback', valueType: 'string' }
}

// Child nodes still use parentId to belong to a loop:
interface ChildNode extends Node {
  parentId?: string;  // References loop node ID
  extent?: 'parent';  // Constrains movement within parent
  position: { x: number; y: number };  // Relative to parent
}
```

**Benefits of dock-based model:**
- No interface nodes to manage - dock is part of loop container
- Clear visual distinction between iteration control and workflow nodes
- Bidirectional feedback slots handle prev/current in one place
- Simpler mental model for users
- Still uses ReactFlow's `parentId` for workflow nodes inside loop

### Dock Slot Types

```typescript
// Iteration slot - provides current iteration number
// Port: ●→ (output only)
// Handle ID: dock:iteration:output

// Continue slot - receives boolean to control looping
// Port: →● (input only)
// Handle ID: dock:continue:input

// Feedback slot - bidirectional for iteration data
// Ports: ●→ (left, outputs prev value) and →● (right, receives current value)
// Handle IDs: dock:{name}:prev (output) and dock:{name}:current (input)
```

**Handle ID format for dock slots:**
- `dock:iteration:output` - iteration number output
- `dock:continue:input` - continue boolean input
- `dock:{name}:prev` - feedback slot's previous iteration output
- `dock:{name}:current` - feedback slot's current iteration input

---

## Example: Code Review Loop (Dock-Based Model)

```yaml
version: 2
metadata:
  name: Code Review Loop Example
  description: Demonstrates a loop that iterates until code review is approved

nodes:
  # === Loop Container with Dock Slots ===
  - id: review-loop
    type: loop
    position: { x: 100, y: 100 }
    style: { width: 600, height: 400 }
    data:
      label: Code Review Loop
      nodeType: loop
      maxIterations: 5
      # External I/O ports (standard node ports)
      inputs:
        - { name: task, type: string }
        - { name: guidelines, type: string }
      outputs:
        - { name: final_code, type: string }
      # Dock slots for iteration control
      dockSlots:
        - { name: iteration, type: iteration, valueType: number }
        - { name: continue, type: continue, valueType: boolean }
        - { name: feedback, type: feedback, valueType: string }

  # === Child Nodes (inside the loop) ===
  # Note: All child nodes have parentId referencing the loop
  # No interface nodes needed - dock handles iteration data

  # Logic nodes
  - id: not-gate
    type: shell
    parentId: review-loop
    extent: parent
    position: { x: 250, y: 280 }
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
    position: { x: 50, y: 50 }
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
    position: { x: 350, y: 50 }
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
  # External: Loop inputs → child nodes
  - { source: review-loop, target: coder, sourceHandle: "input:task", targetHandle: "input:task" }
  - { source: review-loop, target: coder, sourceHandle: "input:guidelines", targetHandle: "input:guidelines" }

  # Dock: feedback.prev → Coder
  - { source: review-loop, target: coder, sourceHandle: "dock:feedback:prev", targetHandle: "input:feedback" }

  # Internal: Coder → Reviewer
  - { source: coder, target: reviewer, sourceHandle: "output:code", targetHandle: "input:code" }

  # Dock: Reviewer → feedback.current
  - { source: reviewer, target: review-loop, sourceHandle: "output:feedback", targetHandle: "dock:feedback:current" }

  # Logic: Reviewer.approved → NOT → continue
  - { source: reviewer, target: not-gate, sourceHandle: "output:approved", targetHandle: "input:value" }
  - { source: not-gate, target: review-loop, sourceHandle: "output:result", targetHandle: "dock:continue:input" }

  # External output: Coder.code → Loop.final_code (fires after loop completes)
  - { source: coder, target: review-loop, sourceHandle: "output:code", targetHandle: "output:final_code" }
```

**Key differences from interface-node model:**
- No `interface-input`, `interface-output`, or `interface-continue` nodes
- Dock slots defined in `data.dockSlots` on the loop node
- Dock handles use `dock:{name}:{port}` format
- External I/O uses standard `input:` and `output:` handles on the loop node
- Edges from internal nodes to loop's output ports fire only after loop completes

---

## Simple Test Example (Shell-Only, Dock-Based Model)

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

  # === Loop Container with Dock ===
  - id: count-loop
    type: loop
    position: { x: 250, y: 100 }
    style: { width: 350, height: 250 }
    data:
      label: Count to 5
      nodeType: loop
      maxIterations: 10
      # External input
      inputs:
        - { name: target, type: string }
      # External output (fires after loop)
      outputs:
        - { name: final_count, type: number }
      # Dock slots
      dockSlots:
        - { name: iteration, type: iteration, valueType: number }
        - { name: continue, type: continue, valueType: boolean }
        - { name: count, type: feedback, valueType: number }

  # === Child Node (inside loop) ===
  - id: counter
    type: shell
    parentId: count-loop
    extent: parent
    position: { x: 50, y: 50 }
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
  # External: Trigger → Loop input
  - { source: trigger, target: count-loop, sourceHandle: "output:text", targetHandle: "input:target" }

  # Loop input → Counter
  - { source: count-loop, target: counter, sourceHandle: "input:target", targetHandle: "input:target" }

  # Dock: count.prev → Counter
  - { source: count-loop, target: counter, sourceHandle: "dock:count:prev", targetHandle: "input:prev_count" }

  # Counter → Dock slots
  - { source: counter, target: count-loop, sourceHandle: "output:count", targetHandle: "dock:count:current" }
  - { source: counter, target: count-loop, sourceHandle: "output:should_continue", targetHandle: "dock:continue:input" }

  # External output (fires after loop completes)
  - { source: counter, target: count-loop, sourceHandle: "output:count", targetHandle: "output:final_count" }
```

This example:
- Trigger starts workflow; connects to loop's external input port
- Run via CLI: `shodan run counter-loop.yaml --input "5"`
- Uses shell nodes only (no API keys needed)
- **No interface nodes** - dock slots handle iteration data
- Dock's `count.prev` outputs previous iteration's count (null on first iteration)
- Dock's `count.current` receives current iteration's count
- External output edge fires only after loop completes

---

## Execution Semantics

### Iteration Lifecycle

```
1. Initialize
   - iteration = 0
   - feedbackValues = {} (empty map for each feedback slot)
   - Resolve outer inputs from incoming edges to loop

2. Prepare dock outputs
   - iteration++
   - iteration slot outputs: iteration number
   - For each feedback slot:
     - prev port outputs: feedbackValues[slot] (null if iteration == 1)

3. Execute inner workflow
   - Run topological sort and execute all nodes inside loop
   - Nodes receive values from dock's output ports (iteration, feedback.prev)
   - Nodes send values to dock's input ports (feedback.current, continue)

4. Check continuation
   - Read continue slot input value
   - Store feedback slot inputs: feedbackValues[slot] = input value
   - If true AND iteration < maxIterations: goto step 2
   - If false OR iteration >= maxIterations: goto step 5

5. Finalize
   - Fire all deferred edges (internal node → external node)
   - Loop's output ports receive values from connected internal nodes
```

### Deferred Edge Execution

Edges from internal nodes to external nodes (or to loop's output ports) are **deferred**:
- During iteration, these edges are tracked but not executed
- After the loop completes (continue=false or maxIterations reached), all deferred edges fire
- This allows internal workflow to complete fully before outputs are sent downstream

### Error Handling

- If inner workflow fails: loop terminates with error
- If max iterations reached: loop terminates with warning, outputs last successful iteration
- All iteration outputs are available in execution logs for debugging

### Validation

The executor must validate:
- Loop has a `dockSlots` array with required slots
- `iteration` slot exists (type: iteration)
- `continue` slot exists (type: continue)
- `continue` slot has an incoming edge from internal workflow

---

## UI Considerations

### Loop Node Display - Dock-Based Design

The loop uses a **dock-based UI** instead of separate interface nodes. This simplifies the model:
- No separate child nodes to manage
- Cleaner visual design with more space for workflow
- Bidirectional slots handle both input and output in one place

**Visual Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔁 Loop: Code Review                              [max: 5]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [Coder] ─────────────▶ [Reviewer]                             │
│      ▲         code           │                                 │
│      │                        │ feedback, approved              │
│      │                        ▼                                 │
├──────┼────────────────────────┼─────────────────────────────────┤
│      │                        │                                 │
│  ┌───┴──────┐   ┌─────────────▼──────────┐   ┌────────────┐     │
│  │iteration │   │       feedback         │   │  continue  │     │
│  │   ●→     │   │  ●→              →●    │   │    →●      │     │
│  └──────────┘   └────────────────────────┘   └─────▲──────┘     │
│   (output)       (prev out)    (curr in)      (input) │         │
│                                                   NOT(approved) │
├─────────────────────────────────────────────────────────────────┤
│                    Iteration 3/5                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (after loop completes)
                        [External Node]
```

**Dock Slot Types:**

| Slot Type | Ports | Description |
|-----------|-------|-------------|
| `iteration` | `●→` (output only) | Provides current iteration number (1-based) |
| `continue` | `→●` (input only) | Receives boolean to control looping |
| Feedback slots | `●→` + `→●` (bidirectional) | Left: prev value, Right: current value |

**Key Concepts:**

1. **Bidirectional feedback slots**: A single slot like `feedback` has two ports:
   - Left port (`●→`): OUTPUT - provides value from **previous** iteration to internal nodes
   - Right port (`→●`): INPUT - receives value from **current** iteration

2. **No result dock needed**: Internal nodes wire directly to external nodes. These edges only fire after the loop completes.

3. **Arrow indicators**:
   - `●→` = Output port (data flows OUT to internal nodes)
   - `→●` = Input port (data flows IN from internal nodes)

### Data Flow Example: Code Review Loop

```
Iteration 1:
  iteration dock (●→) provides: 1
  feedback dock (●→) provides: null (no previous)

  Coder receives: task, feedback=null
  Coder outputs: code

  Reviewer receives: code
  Reviewer outputs: approved=false, feedback="add error handling"

  feedback dock (→●) receives: "add error handling"
  continue dock (→●) receives: true (NOT approved)

  → Loop continues

Iteration 2:
  iteration dock (●→) provides: 2
  feedback dock (●→) provides: "add error handling" (from prev iteration)

  Coder receives: task, feedback="add error handling"
  Coder outputs: improved_code

  Reviewer receives: improved_code
  Reviewer outputs: approved=true, feedback="looks good"

  feedback dock (→●) receives: "looks good"
  continue dock (→●) receives: false (NOT approved = false)

  → Loop stops

After loop:
  Edges from internal nodes to external nodes fire with final values
```

### Configuration Panel

```
┌─────────────────────────────────────────────────┐
│ Loop: Code Review                               │
├─────────────────────────────────────────────────┤
│ Max Iterations: [5    ]                         │
├─────────────────────────────────────────────────┤
│ Dock Slots:                                     │
│   iteration (output) - built-in                 │
│   continue (input) - built-in                   │
│   ─────────────────────────────────────         │
│   + Add feedback slot                           │
│   [feedback] (bidirectional) [×]                │
│   [code] (bidirectional) [×]                    │
└─────────────────────────────────────────────────┘
```

- Built-in slots: `iteration` and `continue`
- User can add custom bidirectional feedback slots
- Each feedback slot appears in the dock with both ports

---

## Relationship to Components

**A Loop is a visual container with iteration semantics.** Unlike components which abstract away their internals, loops show their contents directly:

| Aspect | Component | Loop |
|--------|-----------|------|
| Contains workflow | Yes (hidden) | Yes (visible) |
| Has I/O interface | Interface nodes | **Dock slots** + standard ports |
| Executes once | Yes | No (iterates) |
| Previous outputs → next inputs | No | Yes (dock feedback slots) |
| Termination condition | No | Yes (dock continue slot) |
| Visual representation | Single node | Container with dock bar |

**Key differences from components:**
- Loop contents are always visible (no drill-down needed)
- Dock-based iteration control instead of interface nodes
- Feedback slots handle prev/current values automatically
- External output edges are deferred until loop completes

---

## Project Structure

Loop implementation files in the monorepo structure:

```
src/
├── core/src/
│   ├── loop-types.ts       # LoopNodeData, DockSlot types (needs update for dock)
│   ├── workflow-types.ts   # WorkflowNode, WorkflowEdge, WorkflowSchema ✅
│   └── index.ts            # Re-exports all types ✅
├── server/src/engine/
│   └── loop-executor.ts    # Loop execution logic (needs update for dock model)
├── designer/src/
│   ├── nodes/
│   │   ├── LoopContainerNode.tsx  # Loop container with dock bar (needs dock UI)
│   │   ├── BaseNode.tsx    # Extended with loop type ✅
│   │   ├── nodes.css       # Loop container styling ✅
│   │   └── index.ts        # Node type registry ✅
│   ├── index.css           # CSS variables for loop colors ✅
│   └── components/
│       ├── ConfigPanel.tsx # LoopConfig with dock slot management (needs update)
│       └── Sidebar.tsx     # Loop node in palette ✅
└── cli/
    └── (no changes needed - uses server executor)
```

---

## Template Syntax

The loop system uses the same template syntax as the I/O system. All values are accessed via wired edges, not magic variables:

| Source | How to Access | Example |
|--------|---------------|---------|
| Outer inputs | Wire from loop's input ports | `loop:input:task → coder:input:task` |
| Iteration number | Wire from dock's iteration slot | `loop:dock:iteration:output → node:input:iter` |
| Previous iteration | Wire from dock's feedback prev port | `loop:dock:feedback:prev → coder:input:feedback` |

**No special loop template syntax** - everything is explicit wiring through dock slots and standard ports.

---

## Implementation Phases

> **Prerequisite**: The I/O system (Phases 1-5) and Component system (Phase 6) must be complete. This provides:
> - Typed input/output ports on nodes
> - Edge-based data flow between nodes
>
> **Note**: Phases 1-2 were implemented with interface nodes. Starting Phase 3, we pivoted to a **dock-based** approach which is simpler and doesn't require managing child interface nodes.

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

### Phase 3a: Loop as Sub-Flow Container ✅

**Goal:** Transform the loop node into a visual container using ReactFlow's `parentId` pattern.

**Key Concepts (from ReactFlow docs):**
- Child nodes use `parentId` to reference parent
- Child positions are **relative** to parent (not absolute)
- `extent: 'parent'` constrains children within parent bounds
- Parent nodes must appear **before** children in the nodes array

**Tasks:**
- [x] Create `LoopContainerNode` component (renders as resizable frame)
- [x] Update node type registry to use container node for loops
- [x] Add minimum dimensions for loop container (400x300)
- [x] Style container with header bar (label, max iterations badge) and content area
- [x] Auto-create interface nodes when loop is dropped:
  - `interface-input` (top-left of container)
  - `interface-output` (top-right of container)
  - `interface-continue` (bottom-center of container)
- [x] Set `parentId` on interface nodes to link them to loop
- [x] Ensure parent nodes sorted before children in nodes array

**Phase 3a completion notes:**
- Created `LoopContainerNode.tsx` with `NodeResizer` for resizable frame
- Purple dashed border container with header showing loop icon, label, and max iterations badge
- Added comprehensive CSS styling for loop container (`.loop-container`, `.loop-header`, etc.)

**Design Pivot:** After Phase 3a, we pivoted from interface nodes to a **dock-based** approach:
- Instead of auto-creating interface nodes inside the loop, the loop container has a "dock" bar at the bottom
- Dock contains slots for iteration, continue, and user-defined feedback values
- This simplifies the model - no child nodes to manage, cleaner visual design
- The `onDrop` handler now creates just the loop container (no interface nodes)

**Data Structure (Dock-Based):**
```typescript
// Loop container node with dock slots
{
  id: 'loop-1',
  type: 'loop',
  position: { x: 100, y: 100 },
  style: { width: 500, height: 400 },
  data: {
    nodeType: 'loop',
    label: 'Code Review Loop',
    maxIterations: 5,
    inputs: [...],   // External input ports
    outputs: [...],  // External output ports (fire after loop)
    dockSlots: [
      { name: 'iteration', type: 'iteration', valueType: 'number' },
      { name: 'continue', type: 'continue', valueType: 'boolean' },
      { name: 'feedback', type: 'feedback', valueType: 'string' },
    ]
  }
}
```

---

### Phase 3b: Drag-and-Drop into Loop Container ✅

**Goal:** Allow users to drag nodes from palette into loop, and move existing nodes into/out of loops.

**Status:** Complete.

**Tasks:**
- [x] Detect when node is dropped inside loop container bounds
- [x] Auto-set `parentId` and convert position to relative coordinates
- [x] Handle dragging node out of loop (remove `parentId`, convert to absolute)
- [x] Visual feedback when dragging over loop (highlight drop zone with cyan glow)
- [x] Keep dropped nodes above dock area (leave space at bottom for dock)
- [x] Handle moving nodes from one loop to another

**Phase 3b completion notes:**
- Implemented `onNodeDragStop` handler with `findContainingLoop` helper
- Nodes inside loops get `parentId` set and positions converted to relative coordinates
- `isDropTarget` state on loop nodes triggers cyan highlight styling
- Bounds checking ensures nodes stay above dock area (40px header, 70px dock)

---

### Phase 3c: Dock Rendering and Slot Management ✅

**Goal:** Render the dock bar at the bottom of the loop container with slots for iteration control.

**Status:** Complete (core rendering done, config panel slot management pending).

**Tasks:**
- [x] Dock bar component at bottom of loop container
- [x] Render dock slots based on `dockSlots` array in node data
- [x] Built-in slots: `iteration` (output) and `continue` (input)
- [x] User-defined feedback slots with bidirectional ports
- [x] Handles for dock ports (for edge connections) with proper handle IDs
- [x] Status bar showing current iteration during execution
- [ ] Arrow indicators for port direction (visual only, handles work)
- [ ] Slot configuration in config panel (add/remove feedback slots)

**Phase 3c completion notes:**
- `LoopContainerNode.tsx` implements dock bar with `renderDockSlot()` function
- Handle IDs follow pattern: `dock:{name}:output`, `dock:{name}:input`, `dock:{name}:prev`, `dock:{name}:current`
- Feedback slots render with bidirectional handles (25%/75% positioning)
- Slots colored by `valueType` using type color mapping

---

### Phase 3d: Executor Support for Dock-Based Model ✅

**Goal:** Update the loop executor to work with dock slots instead of interface nodes.

**Status:** Complete.

**Completed Tasks (parentId model):**
- [x] Remove `inlineWorkflow` and `workflowRef` from `LoopNodeData` type
- [x] Update `executeLoop()` to filter nodes by `parentId`
- [x] Update `executeLoop()` to filter edges where both endpoints are inside loop
- [x] Update workflow YAML schema to support `parentId` and `extent` on nodes

**Completed Tasks (dock-based model):**
- [x] Add `dockSlots` field to `LoopNodeData` type
- [x] Update executor to read dock slot definitions from loop node
- [x] Implement dock slot value management (feedbackValues map)
- [x] Handle `dock:*` handle IDs in edge resolution
- [x] Implement deferred edge execution (internal→external fires after loop)
- [x] Remove interface node validation (no longer needed)
- [x] Update test workflows to use dock-based format
- [x] Add `loopId` to ExecuteOptions for proper nested loop support
- [x] Filter dock input edges from adjacency map (prevent infinite recursion)
- [x] Support dynamic continue slot names (not just "continue")

**Phase 3d completion notes:**
- Rewrote `loop-executor.ts` for dock-based model with edge categorization (innerEdges, dockOutputEdges, dockInputEdges, deferredEdges)
- Added `DockContext` interface for passing dock slot values to inner workflow
- Extended `resolveInputs` to handle `input:*` and `dock:*` handles
- Added `outputs` Map to `ExecuteResult` for proper value extraction
- Created test workflows: `test-loop-dock.yaml` (simple counter) and `test-loop-nested.yaml` (i/j nested loop pattern)
- Fixed nested loop issues: added `loopId` option to only execute direct children, filter dock input edges from adjacency to prevent re-execution
- All loop tests added to test corpus and passing

**Executor Logic (Dock-Based):**
```typescript
const executeLoop = async (
  loopNode: WorkflowNode,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
  context: ExecutionContext
) => {
  const dockSlots = loopNode.data.dockSlots || [];
  const feedbackValues: Record<string, unknown> = {};

  // Get child nodes by filtering on parentId
  const innerNodes = allNodes.filter(n => n.parentId === loopNode.id);

  // Categorize edges
  const innerNodeIds = new Set(innerNodes.map(n => n.id));
  const innerEdges = allEdges.filter(e =>
    innerNodeIds.has(e.source) && innerNodeIds.has(e.target)
  );
  const dockEdges = allEdges.filter(e =>
    e.sourceHandle?.startsWith('dock:') || e.targetHandle?.startsWith('dock:')
  );
  const deferredEdges = allEdges.filter(e =>
    innerNodeIds.has(e.source) && !innerNodeIds.has(e.target) &&
    !e.targetHandle?.startsWith('dock:')
  );

  // Iteration loop
  let iteration = 0;
  let shouldContinue = true;

  while (shouldContinue && iteration < loopNode.data.maxIterations) {
    iteration++;

    // 1. Prepare dock outputs (iteration, feedback.prev)
    const dockOutputs = {
      'dock:iteration:output': iteration,
      ...Object.fromEntries(
        dockSlots
          .filter(s => s.type === 'feedback')
          .map(s => [`dock:${s.name}:prev`, feedbackValues[s.name] ?? null])
      )
    };

    // 2. Execute inner workflow with dock outputs available

    // 3. Collect dock inputs (feedback.current, continue)
    // Store feedback values for next iteration
    // Read continue value

    shouldContinue = /* continue dock input value */;
  }

  // 4. Fire deferred edges (internal → external)
};
```

---

### Phase 3e: Loop I/O Ports on Container ✅

**Goal:** Loop container shows external input/output ports (standard ports) plus dock slot ports.

**Status:** Complete.

**Tasks:**
- [x] Loop container has external input handles on left (from `data.inputs`)
- [x] Loop container has external output handles on right (from `data.outputs`)
- [x] Dock slot handles rendered at bottom (dock bar area)
- [x] Handle ID format distinguishes external ports from dock ports:
  - External: `input:{name}`, `output:{name}`
  - Dock: `dock:{name}:prev`, `dock:{name}:current`, `dock:iteration:output`, `dock:continue:input`
- [x] External output edges are deferred (fire only after loop completes) - handled in executor

**Phase 3e completion notes:**
- External ports rendered in `LoopContainerNode.tsx` with port labels
- Ports positioned on left (inputs) and right (outputs) sides of container
- Port coloring follows type color mapping for visual type indication
- Fixed `workflow.ts` serialization to preserve `parentId`, `extent`, and `style` fields for proper loop container display when importing YAML workflows

**Visual:**
```
                                                                      ┌── (deferred)
     ○ task ────────┌─────────────────────────────────────┐           ▼
     ○ guidelines ──│ 🔁 Code Review Loop                 │──────── final_code ●
                    │                                     │
                    │   [Coder] ──────▶ [Reviewer]        │
                    │       ▲                │            │
                    │       │                ▼            │
                    ├───────┼────────────────┼────────────┤
                    │  [iter ●→]  [feedback ●→ →●]  [continue →●]
                    └─────────────────────────────────────┘
```

---

### Phase 4: Polish
- [ ] Iteration history view (see each iteration's outputs in logs)
- [ ] Validation error messages for missing dock connections (visual indicators)
- [ ] Copy/paste nodes into loops
- [ ] Undo/redo support for loop operations
- [ ] Dock slot configuration UI (add/remove/rename feedback slots)
- [ ] Type selection for feedback slots (string, number, json, etc.)
- [ ] Visual indicators when dock slots have required connections missing

---

## Open Questions

1. **Parallel loops (map/forEach)**: Should we support running iterations in parallel over a collection? This would be a different primitive - more like a "map" node than a feedback loop.

2. **Nested loops**: ✅ Tested and working. The `test-loop-nested.yaml` workflow demonstrates an outer loop (i=1-3) containing an inner loop (j=1-2), producing pairs (1,1), (1,2), (2,1), (2,2), (3,1), (3,2). Key implementation details:
   - Added `loopId` to `ExecuteOptions` to filter child nodes by their direct parent
   - Dock input edges filtered from adjacency map to prevent infinite recursion

3. **Session resumption**: For CLI agents (claude-code, codex), should we support resuming the same conversation across iterations?
   - Pro: Agent remembers previous attempts, reduces token usage
   - Con: Adds complexity, session cleanup needed
   - Decision: Defer to future enhancement

4. **Logic nodes**: The examples use a shell-based NOT gate. Should we add built-in logic nodes (NOT, AND, OR, comparison)?
   - Pro: Cleaner than shell workarounds
   - Con: Scope creep
   - Decision: Start with shell-based logic; add built-ins if patterns emerge

5. **Dock slot types**: Should feedback slots support different value types (string, number, json, array)?
   - Current design: Yes, `valueType` field on DockSlot
   - Need to determine how type checking works for dock connections

6. **Multiple feedback slots**: How many feedback slots should a loop support?
   - Current design: No limit, user adds as needed
   - Consider: Should there be a default "result" slot for simple cases?
