# Robomesh Backlog

See also: [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) for bugs and limitations.

## Known Issues / Technical Debt

### React Flow Handle Registration Bug (Workaround Applied)
When restoring nodes from cached state (navigation stack), React Flow sometimes fails to recognize handles even though the data is correct. The workaround is to reload component workflows from YAML when navigating back via breadcrumb. This works but means unsaved changes are lost when navigating away then back. A proper fix would involve:
- Investigating React Flow's handle registration lifecycle
- Possibly using `useNodesInitialized` hook or forcing re-mount with key changes
- File: `src/designer/src/App.tsx` - `onNavigateBreadcrumb` function

### Component-related files
- `src/server/src/routes/components.ts` - Component API endpoints
- `src/designer/src/lib/api.ts` - API client functions (`getComponentWorkflow`, `saveComponentWorkflow`)
- `src/designer/src/components/Breadcrumb.tsx` - Breadcrumb navigation component
- `src/designer/src/components/CreateComponentDialog.tsx` - New component creation dialog
- `src/designer/src/App.tsx` - Navigation stack, drill-down, save functionality
- `workflows/components/` - Component workflow YAML files

### Schema Migration Disabled
Schema migration (`upgradeWorkflow`) is disabled during early development. When making schema changes:
- Update existing workflow YAML files inline
- Don't rely on automatic migrations
- When stable, implement migrations in `packages/core` so CLI and UI share the same logic

## Pending

### Loop Primitive Phase 4 (Polish) - Backlog
- [ ] **Iteration history view**: Show history of all iterations with expandable details
- [ ] **Dock slot configuration UI**: Add/remove/rename feedback slots in ConfigPanel
- [ ] **Type selection for feedback slots**: UI to configure `valueType` for feedback slots
- [ ] **Visual validation indicators**: Highlight missing required connections (e.g., continue slot unconnected)
- [ ] **Copy/paste support**: Copy nodes into/out of loop containers
- [ ] **Undo/redo support**: Proper undo/redo for loop operations (add child, move, resize)
- [ ] **Arrow indicators for port direction**: Visual cues showing input vs output direction on dock slots

### Retry Gate Primitive (see [retry-gate.md](./retry-gate.md))
- [ ] Gate node for multi-stage validation with upstream retry

### Other
- Multi-agent CLI output isn't ideal - especially when there is only one item running. We should maybe constrain to a single sentence / line (ideally a summary) - we may be able to pick specific events to pull out like CLaude Code. The test plan.yaml one is a good example of this.
- Workspaces view: show run live progress in the 'status' sidebar pane - need a concept of 'selected' workflow
- Improved nested components:
	- Allow for 'inline' nested components that don't need a separate file.
	- Allow existing workflows to be 'mapped' to a compopnent. The 'inputs' can be any of the trigger values, and the 'outputs' could be pulled from any terminal node. 
- Upgrade AND/OR to N-ary operators (requires array inputs)
- For the plan.yml workflow - why can I not create an edge from trigger.text -> agent?
- The node ids are implicit - can we make those editable?
- For constant node, for string, it could be useful to be able to point to a file as well. 
- Autocomplete: would be helpful to have autocomplete for {{ inputs.| }} input, as well as for the typescript function input
- Implement 'wire node' - just a small, pass-through node that can be used for routing wires
- Implement plan/output-visualization-improvements.
- Output node: a node that defines the final output of the workflow (ie, whether it passes/fails) and any output values it exposes
- Allow bringing in 'nested' workflows (inputs correspond to triggers, outputs correspond to output node).
- Fix the animation when output travels along the edges
- Experiment with reactive paradigms - can we use our primitives or set to implement a 'first' logic node (multiple inputs a, b, c, and a single output - whichever value comes _first_ gets sent to output). This could be either exposing/allowing RxJS style primitives, or creating an AsyncNode that provides two functions ("input", inputValue, oldState) -> newState, newState -> {outputs} | null. This could easily implement primitives like first, last, etc
- When the workflow is running, and a new workflow is imported, the current running session isn't stopped
- Implement plan/retry-gate.md
- Add refactor -> extract tool. Highlight an area, pull the inputs/outputs, and extract to a component
- Higher-order components - a generalized version of the loop. Essentially, we'd create a simpler experience to creeting a nested component _except_ we'd also hhave the ability to add some 'state' input and outputs that the internals would map to. From a design perspective, we'd have the inputs on the left, outputs on the right, and state input/output on the top. The state input/output would be customizable, and would allow us to build primitives like loop but also other sorts of logic that can interact with a customizable set of 'inner components'. It's basically extending our loop to be a primitive that is modifiable.
- Planning workflow
- UX: Move workflow name, +new, and execution into header, to free up header (probably import/export via a drop down menu too)
- Implement auto-layout
- Deploy to robomesh.ai, w/o ability to run workflows
- Set up to run locally - whats the best way to open UI from CLI?
- 3d view when running - flatten out the 'map' and overlay live terminal, output, etc in the third dimension
- Are selection
- Duplicate node shortcut key when clicking and dragging?
- Copy/paste 
- Auto-layout? Can we add an auto-layout command for a selection?
- Add a concept of tools - specifically, the ability to directly talk to an agent (ie, queue an additional prompt)

### MVP
1. Triage - can pick and output a specific task to work
2. Plan - pick up the item, expand a plan
3. Execute - write code 
4. Test - write testsPlea:w

Optional step:
# 3. Prototype - take a plan, and try writing code

