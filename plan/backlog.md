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

### Logic Operators (see [operators.md](./operators.md))
- [ ] Add `not`, `and`, `or` sidebar primitives (function nodes with preset configs)
- [ ] Consider compact visual styling for operators

### Retry Gate Primitive (see [retry-gate.md](./retry-gate.md))
- [ ] Gate node for multi-stage validation with upstream retry

### Other
- Workspace / orchestration of multiple flows:
	- Get trigger conditions working
	- Record results for a 'run'
	- Cron trigger
- Trigger: Add cli mode to manually trigger a workflow and report output on the CLI
- Add a concept of tools - specifically, the ability to directly talk to an agent (ie, queue an additional prompt)
- Implement plan/operators.md
- Implement plan/output-visualization-improvements.
- Add green grid background to designer - evoking like a circuit builder paradigm.
- Fix the animation when output travels along the edges
- Experiment with reactive paradigms - can we use our primitives or set to implement a 'first' logic node (multiple inputs a, b, c, and a single output - whichever value comes _first_ gets sent to output)
- Header improvement: bread crumb UI showing working directory -> active workflow
- When the workflow is running, and a new workflow is imported, the current running session isn't stopped
- Implement plan/retry-gate.md
- Save and view workflow results
- Add screenshot of tool
- Add refactor -> extract tool. Highlight an area, pull the inputs/outputs, and extract to a component
- Fix agent models - we might want to make an API request and query each tool respectively?
- Coercing agent output to JSON to fit output requirements - can we rely on the agents to do that, or does it require a GPT call to coalesce?
- Higher-order components
- --working-directory (run workflows in other projects)
- Planning workflow
- UX: Move workflow name, +new, and execution into header, to free up header (probably import/export via a drop down menu too)

- Deploy to robomesh.ai, w/o ability to run workflows
- Set up to run locally - whats the best way to open UI from CLI?

- 3d view when running - flatten out the 'map' and overlay live terminal, output, etc in the third dimension

- Implement component library plan (component-library.md)
- Component versioning/history
- 90 degree edges?
- Auto-layout?
- Workspace / orchestration of multiple flows:
	- Get trigger conditions working
	- Record results for a 'run'
