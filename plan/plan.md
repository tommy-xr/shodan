# Shodan Roadmap

## Completed

### Script Node (JS/TS/Bash)
- [x] Added unified "Script" node type that executes file-based scripts
- [x] Supports `.ts` (via tsx), `.js` (via node), `.sh` (via bash)
- [x] File picker integration for script selection
- [x] Arguments field for passing parameters
- [x] Template variable support in paths and arguments

### Project Root Discovery
- [x] `.shodan/` folder marks project root
- [x] Auto-discovery walks up directory tree (`.shodan` > `.git` > `package.json`)
- [x] CLI and UI both use discovered root for relative paths
- [x] Removed manual Root Directory field from UI
- [x] Workflows no longer store `rootDirectory` - it's inferred

### Shell Node Simplification
- [x] Removed "Script Files" from Shell node (now handled by Script node)
- [x] Shell node is now purely for inline scripts

### Node I/O Ports (Phase 5)
- [x] Shell nodes have `stdout`, `stderr`, `exitCode` output ports
- [x] Trigger nodes have `timestamp`, `type`, `text`, `params` output ports
- [x] Edge connections use `sourceHandle`/`targetHandle` for port-to-port wiring
- [x] Template interpolation supports port names: `{{ node_id.stdout }}`
- [x] PortEditor component for adding/editing/removing ports in ConfigPanel

### Components/Composition (Phase 6) - COMPLETE
- [x] **Component workflow format**: `interface:` section in YAML defining inputs/outputs
- [x] **Interface proxy nodes**: `interface-input` and `interface-output` node types
  - `interface-input`: Exposes workflow inputs internally (has outputs matching interface inputs)
  - `interface-output`: Collects internal outputs to expose externally (has inputs matching interface outputs)
- [x] **Component node execution**: Executor recursively executes component workflows
- [x] **Designer UI for components**:
  - Components appear in sidebar under "Components" section
  - Drag components to canvas to create component nodes
  - Component nodes display their interface ports (inputs on left, outputs on right)
  - `GET /api/components/list` and `GET /api/components/info` endpoints
- [x] **Create New Component dialog**: Creates skeleton component YAML with interface-input/output nodes
- [x] **Breadcrumb navigation**: Shows navigation path when drilling into components
- [x] **Save component edits**: `PUT /api/components/workflow` saves changes back to YAML
- [x] **Interface port editing**: PortEditor allows adding/removing ports on interface nodes
- [x] **Component instance refresh**: Parent workflow component nodes update when interface changes
- [x] **Nested component support**: Components can contain other components (3+ levels deep tested)
- [x] **Edge restoration fix**: Reloads from YAML when navigating back via breadcrumb (fixes React Flow handle registration issue)

### Loop Primitive (Phases 0-3) - COMPLETE
- [x] **Data model**: `LoopNodeData` with dock slots (iteration, continue, feedback types)
- [x] **Loop container node**: ReactFlow group node with child containment (`parentId`, `extent: 'parent'`)
- [x] **Dock slots UI**: Visual dock component showing iteration output, continue input, feedback bidirectional
- [x] **Handle ID conventions**: `dock:{name}:output`, `dock:{name}:input`, `dock:{name}:prev`, `dock:{name}:current`
- [x] **Internal handles**: `:internal` suffix for UI-generated edges from loop inputs to inner nodes
- [x] **Loop executor**: `loop-executor.ts` with iteration control, feedback value passing, edge categorization
- [x] **Nested loop support**: Parent/child loops with proper edge filtering and execution isolation
- [x] **Executor integration**: Main executor detects loop nodes, delegates to loop executor, handles outputs
- [x] **Example workflows**: `test-loop-dock.yaml` (simple counter), `test-loop-nested.yaml` (i/j nested loops)

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

## Pending

### Loop Primitive Phase 4 (Polish) - Backlog
- [ ] **Iteration history view**: Show history of all iterations with expandable details
- [ ] **Dock slot configuration UI**: Add/remove/rename feedback slots in ConfigPanel
- [ ] **Type selection for feedback slots**: UI to configure `valueType` for feedback slots
- [ ] **Visual validation indicators**: Highlight missing required connections (e.g., continue slot unconnected)
- [ ] **Copy/paste support**: Copy nodes into/out of loop containers
- [ ] **Undo/redo support**: Proper undo/redo for loop operations (add child, move, resize)
- [ ] **Arrow indicators for port direction**: Visual cues showing input vs output direction on dock slots

### Other
- Rebrand to robomesh.ai
- Implement component library plan (component-library.md)
- Fix agent models - we might want to make an API request and query each tool respectively?
- Coercing agent output to JSON to fit output requirements - can we rely on the agents to do that, or does it require a GPT call to coalesce?
- Add clearly defined input/output for the agent blocks - the inputs can be used as template variables, and the output can be added to the prompt we send the agent. We can then wire the output directly elsewhere
- How to use / re-use session id?
- Consider adding "unsaved changes" warning when navigating away from edited component
- Component versioning/history
