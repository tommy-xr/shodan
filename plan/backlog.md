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

- [ ] **Arrow indicators for port direction**: Visual cues showing input vs output direction on dock slots

### Retry Gate Primitive (see [retry-gate.md](./retry-gate.md))
- [ ] Gate node for multi-stage validation with upstream retry

### Other
Bryan:
- Understand how the 'raw' claude code and codex JSON streaming output looks
	- Can we better summarize it?
	- What are the tags?
	- Can we hvae a tool to describe it?

Add blog notes:
- Architectural super-powers
	- Modularity
	- Functional design
	- Testing at the correct layers
	- Data model as CLI

Workstream 1:
- When running `robomesh serve --yolo`, the runners _are not_ run in --yolo
- Run history: Instead of showing _only_ the state of the _last_ run, we should allow seeing all the recent runs (30d, or perhaps configurable) when clicking on a workflow in the dashboard. Then, each individual run can be opened with our modal.

Workstream 2:
- Improved nested components:
	- Allow for 'inline' nested components that don't need a separate file. From a UX perspective, this is essentially the same flow - create a component, specify inputs and outputs, double-click to enter it. However, it does not need to require a separate file - we can keep the definition for it in-line with the workflow. When a component is inline, it is only reusable in the current workflow. This should actually be the default.
	- Allow existing workflows to be 'nested' in a workflow. These would pick all the inputs from trigger components, and map all the outputs from leaf nodes (or _just_ the output components, if present). These would function essentially like a nested component - just a convenient way to call into other workflows from the xisting workflow. Behavior, they should behave a lot like our 'file system' components - except they are actual workflows that could be run independently. In fact, this could replace our existing file system components.


Workstream 3:
- Remove 'script' block for now and associated tests - functionality superceded by function and shell scripts.
- Upgrade AND/OR to N-ary operators (requires array inputs)
- Add retry-gate
- Implement 'wire node' - just a small, pass-through node that can be used for routing wires. These should be nameable with an id (but can be left empty), and if they are named, we should show the 'input' passing through in the logs.

- Improve UX of the 'prompt' for the agent. If there is a wire connected, we should gray out the 'prompt' input box and note that it is overridden by the prompt wire.
- Multi-agent CLI output isn't ideal - especially when there is only one item running. We should maybe constrain to a single sentence / line (ideally a summary) - we may be able to pick specific events to pull out like CLaude Code. The test plan.yaml one is a good example of this.
- Workspaces view: show run live progress in the 'status' sidebar pane - need a concept of 'selected' workflow, and to ensure that runners (CLI/UI may need to implement streaming)
- Streaming UI bug - the live streaming on canvas stops working after initial run
- For the plan.yml workflow - why can I not create an edge from trigger.text -> agent?
- The node ids are implicit - we should make these editable. Seeing 'trigger_0' and 'shell_0' in the output / run history is jarring. We could default them to a lowercase, alphanumeric with hyphen form of the node name.
- For constant node, for string, it could be useful to be able to point to a file as well.  When refering the file system, it'd be useful to have a different icon.
	- Verify that templates work correctly here
- Autocomplete: would be helpful to have autocomplete for {{ inputs.| }} input, as well as for the typescript function input
- Implement plan/output-visualization-improvements.
- Output node: a node that defines the final output of the workflow (ie, whether it passes/fails) and any output values it exposes
- Input node: a node that defines the incoming input. Used when a workflow is nested in another workflow (ie, sa a component), to define the input surface area. This allows specifying different behavior when a workflow is run 'top-level' vs when a workflow is run nested/in a component.
- Fix the animation when output travels along the edges - we're not actually seeing the 'dot' travel across the wires, which is what I wanted to see. It looks like the 'dot' gets rendered at a fix position and doesn't move.
- Experiment with reactive paradigms - can we use our primitives or set to implement a 'first' logic node (multiple inputs a, b, c, and a single output - whichever value comes _first_ gets sent to output). This could be either exposing/allowing RxJS style primitives, or creating an AsyncNode that provides two functions ("input", inputValue, oldState) -> newState, newState -> {outputs} | null. This could easily implement primitives like first, last, etc. Our current model only supports _logic_ primitives but not _time-based_ or _streaming_ primitives.
- When the workflow is running, and a new workflow is imported, the current running session isn't stopped
- Implement plan/retry-gate.md
- Area Selection
	- We should allow selecting via area by dragging. This could support several operations, like copy/paste, bulk delete, or even tools like
	- Add refactor -> extract tool. Highlight an area, pull the inputs/outputs, and extract to a component
- Higher-order components - a generalized version of the loop. Essentially, we'd create a simpler experience to creeting a nested component _except_ we'd also hhave the ability to add some 'state' input and outputs that the internals would map to. From a design perspective, we'd have the inputs on the left, outputs on the right, and state input/output on the top. The state input/output would be customizable, and would allow us to build primitives like loop but also other sorts of logic that can interact with a customizable set of 'inner components'. It's basically extending our loop to be a primitive that is modifiable.
- Implement auto-layout - add a tool that will automatically lay-out the canvas, such that no nodes overlap, and there is minimal wiring overlap. We'd need to explore some different algorithm choices.
- Deploy to robomesh.ai, w/o ability to run workflows
- 3d view when running - flatten out the 'map' and overlay live terminal, output, etc in the third dimension
- Duplicate node shortcut key when clicking and dragging - we should add a shortcut key that allows for quickly duplicating nodes
- Copy/paste 
- Undo/redo

### MVP - create a usable workflow for this project and others
1. Triage - can pick and output a specific task to work
2. Plan - pick up the item, expand a plan
3. Execute - write code 
4. Submit - Commit and submit PR
5. Monitor - watch PR state

Optional step:
# 3. Prototype - take a plan, and try writing code
4. Test - write testsPlea:w
