# Shodan

AI Agentic Orchestration Tool - easily define, visualize, and debug workflows spanning multiple coding agents

## Technical Foundation

- **Language:** TypeScript
- **Runtime:** Node.js
- **UI Framework:** React + React Flow
- **Build Tool:** Vite

---

## Phase 1: Designer UI Shell

### Goals
- Get a working React Flow canvas up and running
- Establish core interaction patterns before solidifying the data model

### Tasks
1. Scaffold Vite + React + TypeScript project
2. Integrate React Flow with basic canvas
3. Implement node palette (sidebar with draggable node types):
   - Agent node (placeholder)
   - Shell node (placeholder)
   - Trigger node (placeholder)
   - Working Directory node (placeholder)
4. Basic node interactions:
   - Drag from palette to canvas
   - Select, move, delete nodes
   - Connect nodes via handles (inputs/outputs)
5. Placeholder node configuration panel:
   - Click node → show properties panel
   - Editable fields (hardcoded for now)

### Deliverables
- Functional canvas where you can add/connect/configure nodes visually
- No persistence yet - state lives in React only

---

## Phase 2: Node UX Refinement

### Goals
- Flesh out the UI for each node type
- Discover what configuration each node actually needs

### Tasks
1. **Agent Node UI:**
   - Model selector dropdown (gpt-4, opus, gemini, etc.)
   - Runner selector dropdown (claude-code, codex, gemini-cli, etc.)
   - Prompt editor (textarea or file picker)
   - Input handles (dynamic based on available upstream outputs)
   - Output schema editor (JSON schema builder or raw JSON)
2. **Shell Node UI:**
   - Command input field
   - Working directory selector
   - Output extraction config (regex patterns, JSON path, etc.)
   - Dynamic output handles based on defined extractions
3. **Trigger Node UI:**
   - Trigger type selector (manual, periodic, file watch, PR, idle, webhook)
   - Type-specific config (cron expression, file patterns, etc.)
4. **Working Directory Node UI:**
   - Path picker/input
   - Lock indicator (for later execution state)
5. **Connection validation:**
   - Visual feedback for valid/invalid connections
   - Type hints on handles

### Deliverables
- Fully designed node configuration experience
- Clear understanding of what data each node needs

---

## Phase 3: Data Model & Persistence

### Goals
- Define the workflow schema based on UI learnings
- Save/load workflows to `.shodan/` folder

### Tasks
1. Define TypeScript types for workflow schema:
   - Workflow (id, name, nodes, edges, metadata)
   - Node types (discriminated union)
   - Edge type (source, target, sourceHandle, targetHandle)
   - Trigger configurations
2. Implement serialization:
   - React Flow state → Workflow schema
   - Workflow schema → React Flow state
3. File format:
   - YAML as primary (human-readable/editable)
   - JSON as alternative
   - Zod validation for loaded files
4. Persistence UI:
   - Save workflow button
   - Load workflow picker
   - Workflow list/browser
   - New workflow creation
5. File structure:
   ```
   .shodan/
   ├── workflows/
   │   ├── review-pr.yaml
   │   └── deploy-staging.yaml
   └── config.yaml
   ```

### Deliverables
- Workflows persist to disk and reload correctly
- Schema is validated on load

---

## Phase 4: Nested/Composite Components

### Goals
- Enable reusable workflow components
- Double-click to drill into nested workflows

### Tasks
1. **Composite Node type:**
   - References another workflow file
   - Exposes defined input/output interface
2. **UI for composites:**
   - Render as single node with interface handles
   - Double-click opens nested workflow in canvas
   - Breadcrumb navigation for depth
3. **Interface definition:**
   - Mark nodes as "exposed inputs" or "exposed outputs"
   - Auto-generate composite handles from these
4. **Component library UI:**
   - List of saved workflows usable as components
   - Drag composite from library onto canvas

### Deliverables
- Build a "Multi-Reviewer" composite with 3 agents + coalesce
- Drill in and out of nested workflows smoothly

---

## Phase 5: Execution Engine

### Goals
- Actually run workflows
- Display execution state in the UI

### Tasks
1. **Backend service:**
   - Node.js server (Express or Fastify)
   - WebSocket for real-time updates to UI
   - Workflow execution API
2. **Execution runtime:**
   - Load workflow from file
   - Build execution DAG
   - Topological sort for execution order
   - Parallel execution where no dependencies
3. **Shell node executor:**
   - Spawn child process
   - Capture stdout/stderr
   - Parse outputs per configuration
4. **Working directory locking:**
   - File-based lock
   - Queue workflows targeting same directory
5. **Execution state in UI:**
   - Node status indicators (pending, running, completed, failed)
   - Live log streaming per node
   - Execution progress view

### Deliverables
- Run a workflow from the UI and watch it execute
- Shell nodes execute and pass outputs downstream

---

## Phase 6: Agent Node Execution

### Goals
- Integrate with AI runners
- Complete the agent execution loop

### Tasks
1. **Runner adapter interface:**
   - Abstract interface for all runners
   - Input: prompt + context, Output: structured response
2. **Implement adapters:**
   - Claude Code (subprocess)
   - Codex CLI
   - Gemini CLI
   - Direct API calls (OpenAI, Anthropic, Google)
3. **Prompt templating:**
   - Variable interpolation from upstream outputs
   - File includes
4. **Output handling:**
   - Parse response against JSON schema
   - Validation and error surfacing
5. **Streaming:**
   - Stream agent output to UI in real-time
   - Progressive updates as agent works

### Deliverables
- Full agent workflows execute end-to-end
- Watch agent output stream in the designer

---

## Phase 7: Triggers & Daemon Mode

### Goals
- Enable autonomous workflow execution
- React to events without manual invocation

### Tasks
1. **Daemon process:**
   - `shodan start` runs background server
   - Serves designer UI
   - Listens for triggers
2. **Trigger implementations:**
   - Manual (UI button, CLI command)
   - Periodic (node-cron)
   - File watch (chokidar)
   - Git/PR events (webhook endpoint)
   - Idle detection
3. **Trigger → Workflow binding:**
   - UI to configure which triggers start which workflows
   - Trigger context passed as workflow inputs

### Deliverables
- Workflows run automatically based on triggers
- Full autonomous operation mode

---

## Phase 8: Polish & Developer Experience

### Goals
- Production-ready tool
- Great developer experience

### Tasks
1. **CLI commands:**
   - `shodan init` - create `.shodan/` folder
   - `shodan start` - run daemon + UI
   - `shodan run <workflow>` - execute workflow directly
   - `shodan validate` - check workflow files
   - `shodan status` - show running executions
2. **Debugging:**
   - Breakpoints on nodes
   - Step-through execution
   - Input/output inspection panel
3. **Error handling:**
   - Retry policies
   - Failure notifications
   - Fallback paths
4. **History & logs:**
   - Execution history browser
   - Persistent logs
   - Re-run from history

### Deliverables
- Complete, polished orchestration tool

---

## Node Types Reference

| Node Type | Purpose | Key Config |
|-----------|---------|------------|
| **Agent** | Run AI model via runner | Model, runner, prompt, input bindings, output schema |
| **Shell** | Execute command | Command, working dir, output extractions |
| **Trigger** | Start workflow on event | Trigger type, type-specific config |
| **Working Directory** | Set context + lock | Path |
| **Coalesce** | Combine parallel outputs | Merge strategy |
| **Conditional** | Branch on condition | Condition expression |
| **Composite** | Nested workflow | Workflow reference, interface |

---

## Open Questions

- [ ] Auth for AI providers - env vars, config file, or keychain?
- [ ] Rate limiting strategy for concurrent agent calls?
- [ ] Should composite components support parameters/generics?
- [ ] Workflow versioning strategy?

---

## Success Criteria

1. Designer UI feels intuitive - can build workflows without docs
2. Workflows persist correctly and are human-readable in YAML
3. Execution is reliable with clear status feedback
4. Nested components enable powerful reuse patterns
5. Triggers enable fully autonomous operation

