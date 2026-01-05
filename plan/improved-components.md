# Improved Nested Components

This document outlines the design for improved component nesting: inline components that don't require separate files, and the ability to nest existing workflows as components.

## Motivation

Current limitations with file-based components:
- Every component requires a separate YAML file in `workflows/components/`
- Friction when creating small, workflow-specific helper components
- No way to reuse existing workflows as components without refactoring them

**Goal 1: Inline Components**
- Allow components to be defined inline within a workflow
- Same UX: create, specify inputs/outputs, double-click to enter
- No separate file required - definition stored within the parent workflow
- Only reusable within the current workflow
- Should be the default when creating components

**Goal 2: Workflow Nesting**
- Allow existing workflows to be nested as components
- Inputs derived from trigger outputs
- Outputs derived from leaf nodes (or interface-output nodes if present)
- Workflows can be run independently or nested in other workflows
- Could replace/supersede file-based components

---

## Part 1: Inline Components

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage location | Top-level `components:` section | Allows reuse within workflow, cleaner than embedding in node |
| Component reference | `componentRef` field on node | Distinguishes from `workflowPath` (file) |
| Default behavior | Inline (not file) | Reduces friction for common case |
| Scope | Current workflow only | File-based for cross-workflow sharing |
| Drill-down editing | Edit parent workflow state | No separate file to manage |

### Schema Design

Inline components are stored in a top-level `components:` section within the workflow:

```yaml
version: 3
metadata:
  name: Workflow with Inline Components

# NEW: Top-level section for inline component definitions
components:
  text-transform:
    interface:
      inputs:
        - name: text
          type: string
      outputs:
        - name: result
          type: string
    nodes:
      - id: input-proxy
        type: interface-input
        position: { x: 100, y: 100 }
        data:
          nodeType: interface-input
          label: Input
          outputs:
            - name: text
              type: string
      - id: transform
        type: shell
        position: { x: 300, y: 100 }
        data:
          nodeType: shell
          label: Uppercase
          script: echo "{{ input }}" | tr '[:lower:]' '[:upper:]'
          inputs:
            - name: input
              type: string
          outputs:
            - name: output
              type: string
      - id: output-proxy
        type: interface-output
        position: { x: 500, y: 100 }
        data:
          nodeType: interface-output
          label: Output
          inputs:
            - name: result
              type: string
    edges:
      - { source: input-proxy, target: transform, sourceHandle: "output:text", targetHandle: "input:input" }
      - { source: transform, target: output-proxy, sourceHandle: "output:output", targetHandle: "input:result" }

nodes:
  - id: trigger
    type: trigger
    ...
  - id: component-1
    type: component
    data:
      nodeType: component
      label: Text Transform
      componentRef: text-transform  # NEW: reference to inline component
      inputs:
        - name: text
          type: string
      outputs:
        - name: result
          type: string

edges:
  - { source: trigger, target: component-1, sourceHandle: "output:text", targetHandle: "input:text" }
```

### Type Definitions

```typescript
interface WorkflowSchema {
  version: 3;
  metadata: { name: string; description?: string };
  interface?: WorkflowInterface;           // For file-based components
  components?: Record<string, InlineComponent>;  // NEW
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface InlineComponent {
  interface: WorkflowInterface;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface ComponentNodeData extends BaseNodeData {
  nodeType: 'component';
  // One of these must be set:
  workflowPath?: string;      // File-based component (existing)
  componentRef?: string;      // Inline component reference (NEW)
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}
```

### Component Resolution Priority

When executing a component node, resolve in order:
1. `componentRef` - look up in `workflow.components[ref]`
2. `workflowPath` - load from filesystem

### Designer UX

**Creating an Inline Component:**
1. User drags "Component" from sidebar → opens Create Component dialog
2. Dialog fields: name, description, inputs, outputs
3. **Default behavior**: creates inline component (no file)
4. **Optional checkbox**: "Save as reusable file" (creates in `workflows/components/`)
5. Component node appears on canvas with configured I/O

**Drill-Down Editing:**
1. Double-click inline component → push to navigation stack
2. **Key difference from file components**: editing the parent workflow's state
3. Changes are saved when parent workflow is saved
4. Breadcrumb shows: `Parent Workflow > Component Name`

**Navigation Stack Updates:**
```typescript
interface NavigationItem {
  name: string;
  path?: string;              // Only for file-based components
  componentRef?: string;      // NEW: for inline components
  nodes: Node[];
  edges: Edge[];
  viewport?: Viewport;
  interface?: WorkflowInterface;
}
```

**Visual Differentiation:**
- All component types use same icon (📦) and styling
- Treat components as "microchip/IC" abstraction - implementation details hidden
- Config panel shows source type (inline, file, workflow) for debugging if needed

**Refactoring Actions:**
- "Extract to file" - move inline component to `workflows/components/`
- "Convert to inline" - pull file component into workflow

---

## Part 2: Workflow Nesting

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interface derivation | Auto-inferred from triggers/outputs | Zero friction to use existing workflows |
| Trigger handling | Skip execution, use outputs as inputs | Triggers define the "entry point" |
| Multiple triggers | Union all trigger outputs | Support complex workflows |
| Output discovery | interface-output if present, else leaf nodes | Explicit > implicit |
| Execution cwd | Inherit from workflow file location | Consistent with current component behavior |
| Drill-down | Opens workflow in designer | Edit affects all usages |

### Interface Derivation

**Inputs (from triggers):**
- Find all trigger nodes in the workflow
- Collect their output port definitions
- Union them as the nested workflow's inputs
- If multiple triggers have same-named output, use first occurrence

```typescript
function deriveWorkflowInputs(workflow: WorkflowSchema): PortDefinition[] {
  const triggers = workflow.nodes.filter(n => n.data.nodeType === 'trigger');
  const inputs: PortDefinition[] = [];
  const seen = new Set<string>();

  for (const trigger of triggers) {
    for (const output of trigger.data.outputs || []) {
      if (!seen.has(output.name)) {
        inputs.push(output);
        seen.add(output.name);
      }
    }
  }
  return inputs;
}
```

**Outputs (from leaf nodes or interface-output):**
- If workflow has `interface-output` nodes → use those
- Otherwise, find leaf nodes (no outgoing edges) → use their outputs
- Combine all into workflow's outputs

```typescript
function deriveWorkflowOutputs(workflow: WorkflowSchema): PortDefinition[] {
  // Prefer explicit interface-output nodes
  const interfaceOutputs = workflow.nodes.filter(
    n => n.data.nodeType === 'interface-output'
  );
  if (interfaceOutputs.length > 0) {
    return interfaceOutputs.flatMap(n => n.data.inputs || []);
  }

  // Fall back to leaf nodes
  const targetNodes = new Set(workflow.edges.map(e => e.target));
  const leafNodes = workflow.nodes.filter(n => !targetNodes.has(n.id));
  return leafNodes.flatMap(n => n.data.outputs || []);
}
```

### Execution Semantics

When executing a nested workflow:

1. **Skip trigger nodes** - they provide the interface, not actual execution
2. **Map inputs** - parent workflow passes inputs that map to trigger outputs
3. **Execute internal nodes** - normal topological execution
4. **Collect outputs** - from interface-output nodes or leaf nodes
5. **Return to parent** - outputs available for downstream nodes

```typescript
const executeNestedWorkflow = async (
  node: WorkflowNode,
  workflow: WorkflowSchema,
  inputValues: Record<string, unknown>,
  context: ExecutionContext
) => {
  // 1. Get execution-ready nodes (exclude triggers)
  const executableNodes = workflow.nodes.filter(
    n => n.data.nodeType !== 'trigger'
  );

  // 2. Create context with trigger outputs pre-populated
  const subContext: ExecutionContext = {
    ...context,
    rootDirectory: getWorkflowDirectory(node.data.workflowPath, context.rootDirectory),
    workflowInputs: inputValues,  // Available as {{ trigger.output }}
  };

  // 3. Execute workflow
  const result = await executeWorkflow(executableNodes, workflow.edges, subContext);

  // 4. Extract outputs from interface-output or leaf nodes
  return extractOutputs(result, workflow);
};
```

### Designer UX

**Sidebar Integration:**
- New section: "Workflows" (below Components)
- Lists all workflows from all registered workspaces
- Shows inferred inputs/outputs on hover
- Draggable to canvas

**Discovery API:**
```typescript
// GET /api/workflows/nestable
// Returns workflows that can be nested (have at least one trigger)
interface NestableWorkflow {
  name: string;
  description?: string;
  path: string;
  workspace: string;
  inputs: PortDefinition[];   // Derived from triggers
  outputs: PortDefinition[];  // Derived from interface-output or leaf nodes
}
```

**Component Node for Nested Workflows:**
```yaml
- id: nested-1
  type: component
  data:
    nodeType: component
    label: Code Review Workflow
    workflowPath: workflows/code-review.yaml  # Points to actual workflow, not component
    # NOTE: Not using componentRef or explicit interface - derived automatically
    inputs:
      - name: code
        type: string
      - name: guidelines
        type: string
    outputs:
      - name: approved
        type: boolean
      - name: feedback
        type: string
```

**Drill-Down Editing:**
- Double-click opens the workflow file in designer
- Changes saved to the workflow file
- **Warning**: Changes affect all workflows that nest this one

**Visual Differentiation:**
- Same icon (📦) and styling as all components - "microchip/IC" abstraction
- Config panel shows "Source: Workflow" with path
- Tooltip could show "Nested Workflow" for context, but visual treatment is identical

### Relationship to File-Based Components

**Option A: Coexistence**
- File components (`workflows/components/`) = explicit interface, reusable
- Nested workflows = inferred interface, runnable independently
- Both continue to work

**Option B: Migration/Deprecation**
- Nested workflows replace file components over time
- File components deprecated in favor of:
  - Inline components (for workflow-specific helpers)
  - Nested workflows (for cross-workflow reuse)

**Recommendation**: Start with Option A, evaluate if Option B makes sense later.

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Schema version | Version 3 (clean break) |
| Persistence timing | Auto-save while editing inline component (matches parent workflow auto-save) |
| Multiple triggers | Union all outputs, unless dedicated output node exists |
| Execution identity | Single run ID (nested is part of parent execution) - simplest approach |
| Visual differentiation | Reuse component icon/styling (📦) - treat all as "microchip/IC" abstraction |

---

## Handling Interface Changes (Breaking Changes)

When a component's interface changes (inline, file-based, or nested workflow), existing connections may become invalid. Here's the strategy for handling this gracefully:

### Detection

**On workflow load/validation:**
1. For each component node, resolve its current interface (from source)
2. Compare against the node's cached `inputs`/`outputs`
3. Identify mismatches:
   - **Removed ports**: Port existed on node but no longer in source
   - **Added ports**: Port exists in source but not on node
   - **Type changes**: Port exists but type differs

### User Experience

**Validation failure with actionable feedback:**
```
Error: Component 'text-transform' interface has changed
  - Removed input: 'text' (string) - 2 edges affected
  - Added input: 'content' (string)
  - Type change: output 'result' changed from string to json
```

**Config panel indicator:**
- Show warning icon on component node when interface is stale
- Tooltip: "Interface has changed. Click to refresh."

**"Refresh Interface" action:**
1. User clicks refresh in config panel (or context menu)
2. System updates node's `inputs`/`outputs` from source
3. System identifies edges that are now invalid:
   - Edge targets removed port → mark edge for deletion
   - Edge source type changed → warn about type mismatch
4. Show confirmation dialog:
   ```
   Refreshing interface will:
   - Remove 2 edges connected to deleted port 'text'
   - Update types on 1 edge (may cause runtime errors)

   [Cancel] [Refresh]
   ```
5. Apply changes, remove invalid edges

**Auto-refresh option (future):**
- Setting to auto-refresh interfaces on workflow load
- Would auto-remove orphaned edges with a toast notification

### Prevention

**Soft deprecation for ports:**
- When removing a port from a component, consider keeping it with `deprecated: true`
- Deprecated ports still work but show warning in designer
- Allows gradual migration

**Interface versioning (future consideration):**
- Components could have interface version numbers
- Parent workflow stores expected version
- Mismatch triggers refresh prompt

### Implementation

```typescript
interface InterfaceDiff {
  removedInputs: PortDefinition[];
  addedInputs: PortDefinition[];
  removedOutputs: PortDefinition[];
  addedOutputs: PortDefinition[];
  typeChanges: Array<{
    port: string;
    direction: 'input' | 'output';
    oldType: ValueType;
    newType: ValueType;
  }>;
}

function diffInterfaces(
  cached: { inputs: PortDefinition[]; outputs: PortDefinition[] },
  current: { inputs: PortDefinition[]; outputs: PortDefinition[] }
): InterfaceDiff {
  // Compare port names and types
  // Return structured diff
}

function findAffectedEdges(
  diff: InterfaceDiff,
  nodeId: string,
  edges: WorkflowEdge[]
): { toRemove: WorkflowEdge[]; toWarn: WorkflowEdge[] } {
  // Find edges connected to removed ports → toRemove
  // Find edges with type mismatches → toWarn
}
```

---

## Resolved Questions (Batch 2)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Component naming | Validate unique names at load time | Standard collision handling |
| Circular references | **Allow with max depth limit** | Useful for recursion/co-recursion; treat like loops with `maxDepth` safety limit (e.g., 100). Return `depth_limit_exceeded` error if hit. |
| Copy/paste components | Yes - paste creates new inline definition | Natural UX |
| Trigger parameters | Expose `params` as `json` type input | Consistent with trigger output structure |
| cwd inheritance | **Inherit parent's working directory** | Component is part of parent workflow, not independent entity. Supports "microchip/IC" mental model. |
| What's nestable | Workflows with **manual triggers** only | Cron/idle triggers don't make sense as component inputs. Manual trigger outputs become component inputs. |
| Editing implications | Show "Used in N workflows" indicator | Helps users understand impact of changes |

### Recursion/Co-recursion Support

Cycles in component references are allowed and can model recursive patterns:

```yaml
components:
  factorial:
    interface:
      inputs: [{ name: n, type: number }]
      outputs: [{ name: result, type: number }]
    nodes:
      - id: check
        type: function
        data:
          code: |
            if (inputs.n <= 1) return { result: 1, recurse: false };
            return { n_minus_1: inputs.n - 1, recurse: true };
      - id: recurse
        type: component
        data:
          componentRef: factorial  # Self-reference
          inputs: [{ name: n, type: number }]
      - id: multiply
        type: function
        data:
          code: return { result: inputs.n * inputs.sub_result };
    # ... edges for conditional execution
```

**Safety mechanism:**
- Track call depth during execution
- Default `maxDepth: 100` (configurable per component)
- On limit exceeded: return error result with `depth_limit_exceeded` status
- Execution log shows recursion depth for debugging

---

## Implementation Phases

### Phase 1: Inline Component Schema (No UI) ✅

- [x] Add `components:` section to workflow schema types
- [x] Add `componentRef` field to ComponentNodeData
- [x] Update workflow loader to parse inline components
- [x] Update executor to resolve inline components
- [x] Update CLI validation for new schema
- [x] Schema version bump to 3

**Files Changed:**
- `packages/core/src/workflow-types.ts` - Added `InlineComponent` interface, `components?` to schema, `componentRef?` to node data, version → 3
- `packages/server/src/engine/workflow-loader.ts` - Added inline component validation
- `packages/server/src/engine/executor.ts` - Added `inlineComponents` to ExecuteOptions, component resolution priority (componentRef → workflowPath)
- `packages/core/src/validation.ts` - Added `validateInlineComponent()` function

**Testing**: `pnpm run test:workflows` ✅ (22/22 passing)
```
workflows/test-inline-component.yaml          # Basic inline component with shell node ✅
workflows/test-inline-component-reuse.yaml    # Same inline component used twice in one workflow ✅
workflows/test-inline-component-nested.yaml   # Inline component containing another inline component ✅
```

**Implementation Notes:**
- Inline components inherit parent's working directory (per design decision)
- Nested inline component support works - components can reference sibling inline components
- `inlineComponents` passed through ExecuteOptions to support nested resolution

### Phase 2: Inline Component Designer UX
- [ ] Update CreateComponentDialog with "Save as file" checkbox
- [ ] Implement inline component creation (default)
- [ ] Update navigation stack for inline components
- [ ] Implement drill-down editing for inline components
- [ ] Implement "Extract to file" refactoring action
- [ ] Implement "Convert to inline" refactoring action
- [ ] Update config panel to show inline vs file indicator

**Testing**: `pnpm run test:e2e` (Playwright)
```
e2e/inline-component.spec.ts
  - Create inline component via dialog
  - Double-click to drill down, verify breadcrumb
  - Edit inside component, navigate back, verify changes persisted
  - Extract to file action creates file and updates reference
  - Convert file component to inline
```

### Phase 3: Workflow Nesting Schema
- [ ] Implement `deriveWorkflowInputs()` - extract from triggers
- [ ] Implement `deriveWorkflowOutputs()` - from interface-output or leaves
- [ ] Add `/api/workflows/nestable` endpoint
- [ ] Update executor for nested workflow execution (skip triggers)
- [ ] Handle input mapping (parent inputs → trigger outputs)
- [ ] Handle output collection (interface-output or leaf nodes)

**Testing**: `pnpm run test:workflows`
```
workflows/test-nested-workflow.yaml           # Workflow that nests another workflow
workflows/test-nested-workflow-outputs.yaml   # Nested workflow with interface-output node
workflows/test-nested-workflow-leaf.yaml      # Nested workflow using leaf node outputs
workflows/helpers/nestable-transform.yaml     # Simple workflow with manual trigger (used by above)
```

### Phase 4: Workflow Nesting Designer UX
- [ ] Add "Workflows" section to sidebar
- [ ] Show nestable workflows with derived I/O
- [ ] Implement drag-drop of workflows as components
- [ ] Visual differentiation (icon, tooltip)
- [ ] Drill-down opens workflow editor
- [ ] Warning indicator for shared workflow editing

**Testing**: `pnpm run test:e2e` (Playwright)
```
e2e/workflow-nesting.spec.ts
  - Workflows section shows in sidebar
  - Only manual trigger workflows appear
  - Drag workflow to canvas creates component node
  - Derived inputs/outputs match trigger outputs
  - Double-click opens workflow in designer
```

### Phase 5: Interface Change Handling
- [ ] Implement `diffInterfaces()` function
- [ ] Implement `findAffectedEdges()` function
- [ ] Add interface staleness detection on workflow load
- [ ] Add warning indicator on component nodes with stale interfaces
- [ ] Implement "Refresh Interface" action in config panel
- [ ] Confirmation dialog showing edges to be removed
- [ ] Toast notification for auto-removed edges

**Testing**: Unit tests + `pnpm run test:e2e`
```
packages/core/src/__tests__/interface-diff.test.ts
  - diffInterfaces() detects added/removed/changed ports
  - findAffectedEdges() identifies edges to remove

e2e/interface-changes.spec.ts
  - Warning indicator appears when interface is stale
  - Refresh action shows confirmation with edge count
  - Confirming refresh removes orphaned edges
```

### Phase 6: Recursion Support
- [ ] Add `callDepth` to execution context
- [ ] Add `maxDepth` field to component node data (default: 100)
- [ ] Increment depth on component entry, decrement on exit
- [ ] Return `depth_limit_exceeded` error when limit hit
- [ ] Show recursion depth in execution logs

**Testing**: `pnpm run test:workflows`
```
workflows/test-recursive-component.yaml       # Self-referencing component (countdown)
workflows/test-recursive-depth-limit.yaml     # Intentionally exceeds depth limit, expects error
workflows/test-corecursive-components.yaml    # A calls B, B calls A (mutual recursion)
```

### Phase 7: Schema Migration & Polish
- [ ] Migration script: version 2 → version 3
- [ ] Update existing component cwd behavior (inherit parent's cwd)
- [ ] Type checking for interface compatibility
- [ ] Migration tooling: convert file components to inline
- [ ] Documentation updates

**Testing**: Migration tests
```
packages/migrations/src/__tests__/v2-to-v3.test.ts
  - Migrates version 2 workflow to version 3
  - Preserves all nodes, edges, metadata
  - Updates component cwd resolution behavior
  - Handles edge cases (empty workflows, nested loops with components)
```

---

## Appendix: Comparison with Loop Architecture

The loop primitive (dock-based, parentId for children, visible container) differs from components:

| Aspect | Loop | Component |
|--------|------|-----------|
| Visibility | Always visible (container) | Abstracted (drill-down) |
| Interface | Dock slots + external ports | Interface nodes |
| Children | Use parentId | Separate node/edge arrays |
| Iteration | Yes (feedback loop) | No (single execution) |
| Reusability | Not reusable as unit | Reusable by reference |

Inline components should follow the component pattern (abstracted, interface nodes) rather than the loop pattern (visible container, dock-based). This maintains the mental model that components encapsulate their internals.

---

## Related Files

**Core Types:**
- `packages/core/src/workflow-types.ts` - WorkflowSchema, ComponentNodeData

**Server:**
- `packages/server/src/engine/executor.ts` - Component execution
- `packages/server/src/engine/workflow-loader.ts` - Loading workflows
- `packages/server/src/routes/components.ts` - Component API endpoints
- `packages/server/src/routes/workflows.ts` - Workflow discovery

**Designer:**
- `packages/designer/src/components/Sidebar.tsx` - Component/workflow palette
- `packages/designer/src/components/CreateComponentDialog.tsx` - Component creation
- `packages/designer/src/App.tsx` - Navigation stack, drill-down
- `packages/designer/src/lib/api.ts` - API client

**Current Components:**
- `workflows/components/` - File-based component definitions
