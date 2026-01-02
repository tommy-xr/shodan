# Workspace Mode

## Goal

Add a `robomesh serve` command that starts the server for a specific working directory, making the designer UI available and enabling workspace-aware features like trigger evaluation and workflow discovery.

## Current State

- **CLI** (`packages/cli/index.ts`): Has `run` and `validate` commands, no `serve`
- **Server** (`packages/server/src/index.ts`): Has `createServer()` that can serve designer UI
- **Trigger types** (in ConfigPanel): manual, periodic (cron), file-watch, pr, webhook
  - Only "manual" is actually implemented in the executor

## Concepts

### Workspace
A workspace is a project directory containing workflows. It is identified by:
1. A `.robomesh/` directory (primary marker), or
2. A `workflows/` directory, or
3. A `.git` directory with workflow files

A workspace contains:
- Workflow files (`.yaml` in `workflows/` or configured location)
- Configuration (`.robomesh/config.yaml` - future)
- State (`.robomesh/state.json` - trigger schedules, last run times)

### Multi-Workspace Support

A single robomesh server can manage multiple workspaces (e.g., sdcanvas, robomesh, shock2quest). Each workspace:
- Has its own set of workflows
- Can run one workflow at a time (parallelism is per-workspace, not global)
- Has independent trigger schedules and state

**Registration options:**
1. Config file: `~/.robomesh/workspaces.yaml` lists registered workspace paths
2. CLI: `robomesh workspace add /path/to/project`
3. Auto-discovery: Scan common locations or parent directories

**Dashboard implications:**
- Group workflows by workspace
- Show workspace health/status
- Allow starting/stopping workflows in different workspaces simultaneously
- Filter view by workspace or show all

```
+--------------------------------------------------+
| Robomesh                                         |
+--------------------------------------------------+
| Workspaces          | Activity                   |
|---------------------|----------------------------|
| > sdcanvas          | [sdcanvas] build RUNNING   |
|   [>] build.yaml    | [robomesh] test completed  |
|   [ ] deploy.yaml   | [shock2quest] idle started |
|                     |                            |
| > robomesh          |                            |
|   [ ] test.yaml     |                            |
|   [ ] publish.yaml  |                            |
|                     |                            |
| > shock2quest       |                            |
|   [>] convert.yaml  |                            |
+--------------------------------------------------+
```

### Trigger Types

**Keep:**
- `manual` - User-initiated, can only be started explicitly
- `cron` - Scheduled execution based on cron expression
- `idle` - Runs when system/user has been idle for a duration

**Remove (for now):**
- `file-watch` - Requires file system watcher infrastructure
- `pr` - Requires GitHub integration
- `webhook` - Requires persistent server with public endpoint

## Testing Strategy

Each phase should be testable before moving to the next. Tests live in `packages/server/src/test/`.

**Run tests:**
```bash
pnpm run -F @robomesh/server test:serve    # API integration tests
```

### Phase 1 Tests (DONE)
- [x] `GET /api/health` returns ok
- [x] `GET /api/workspaces` returns registered workspaces
- [x] `GET /api/config` returns configuration
- [x] `GET /api/files/list` with root param returns files
- [x] `GET /api/components/list` returns components
- [x] `POST /api/execute` without body returns error

### Phase 2 Tests (DONE)
- [x] `GET /api/workflows` returns workflows for each workspace
- [x] `GET /api/workflows/workspace/:workspace` returns workspace workflows
- [x] `GET /api/workflows/workspace/:invalid` returns 404
- [x] `GET /api/workflows/detail` requires params
- [x] `GET /api/workflows/detail` returns workflow with schema
- [x] `POST /api/workflows/refresh` clears cache

### Phase 3 Tests
- [ ] CronTrigger schedules jobs correctly
- [ ] IdleTrigger fires when no other workflows are running
- [ ] TriggerManager respects priority (cron > idle)
- [ ] `GET /api/triggers` returns trigger status

### Phase 4 Tests (DONE)
- [x] GET /api/execution/status returns status
- [x] POST /api/execution/start requires workspace and workflowPath
- [x] POST /api/execution/start with invalid workspace returns 404
- [x] POST /api/execution/cancel when not running returns error
- [x] GET /api/execution/history returns empty array

### Phase 5 Tests
- [ ] Trigger config removes unsupported types
- [ ] Cron trigger shows next scheduled run
- [ ] Navigation between dashboard and designer works

### Phase 6 Tests
- [ ] State file persists after workflow run
- [ ] State restores on server restart
- [ ] Trigger schedules survive restart

## Implementation Plan

### Phase 1: `robomesh serve` Command (DONE)

Add serve command to CLI that starts the server with designer UI.

**CLI changes** (`packages/cli/index.ts`):
```
robomesh serve [--port 3000]     # Start server with registered workspaces
robomesh add [path]              # Register workspace (default: current dir)
robomesh remove [path]           # Unregister workspace
robomesh list                    # Show registered workspaces
robomesh init [path]             # Initialize a new workspace
```

- [x] Add `serve` command to CLI
- [x] Accept `--port` option (default 3000)
- [x] Load registered workspaces from config
- [x] Import and use `createServer` from `@robomesh/server`
- [x] Pass designer path (need to resolve from CLI package location)
- [x] Print startup message with URLs

**Workspace management**:
- [x] Store registered workspaces in `~/.robomesh/config.yaml`
- [x] `robomesh add [path]` - register workspace (defaults to cwd)
- [x] `robomesh list` - show registered workspaces
- [x] `robomesh remove [path]` - unregister workspace
- [x] Validate path has workflows or `.robomesh/` directory
- [ ] `robomesh init [path]` - create `.robomesh/` directory
- [ ] If `add` fails validation, offer to run `init` first

**Server changes**:
- [x] Export `createServer` properly for CLI consumption
- [x] Accept `workspaces: string[]` in config (array of root directories)
- [x] Add `/api/workspaces` endpoint
- [ ] Create WorkspaceManager to handle multiple workspaces (Phase 2)

### Phase 2: Workflow Discovery (DONE)

Scan workspace for workflow files and expose via API.

**New route** (`packages/server/src/routes/workflows.ts`):
- [x] `GET /api/workflows` - List all workflows across all workspaces
- [x] `GET /api/workflows/workspace/:workspace` - List workflows for specific workspace
- [x] `GET /api/workflows/detail?workspace=&path=` - Get single workflow with full schema
- [x] `POST /api/workflows/refresh` - Clear cache and rescan
- [x] Parse each workflow to extract trigger information

**Workspace scanner** (`packages/server/src/workspace/scanner.ts`):
- [x] `scanWorkflows(rootDir)` - Find all `.yaml` workflow files
- [x] `getWorkflowTriggers(workflow)` - Extract trigger nodes and their types
- [x] Cache results with file mtime invalidation

### Phase 3: Trigger System

Implement trigger evaluation and scheduling.

**Trigger types** (`packages/server/src/triggers/`):
- [ ] `TriggerManager` class - Central coordinator
- [ ] `ManualTrigger` - No-op, waits for explicit execution
- [ ] `CronTrigger` - Uses node-cron or similar for scheduling
- [ ] `IdleTrigger` - Monitors system/user activity

**Trigger node data**:
```yaml
nodes:
  - id: trigger-1
    type: trigger
    data:
      label: Daily Build
      triggerType: cron
      cron: "0 9 * * *"  # 9 AM daily

  - id: trigger-2
    type: trigger
    data:
      label: Idle Cleanup
      triggerType: idle
      idleMinutes: 30  # After 30 min idle
```

**TriggerManager responsibilities**:
- [ ] On startup: scan workflows, register triggers
- [ ] Maintain cron schedules (persist next-run times)
- [ ] Monitor idle state (keyboard/mouse activity or simpler heuristic)
- [ ] Execute workflows when triggers fire
- [ ] Expose status via API: `GET /api/triggers`

### Phase 4: Workflow Dashboard (DONE)

Add an overview page to manage all workflows in the workspace.

**Dashboard view** (`packages/designer/src/pages/Dashboard.tsx`):
- [x] List all workflows discovered in workspace
- [x] Show status for each: idle, running, completed, failed
- [x] Show trigger type and schedule info
- [x] Actions: Start (manual), Stop (cancel running), View (open in designer)
- [x] Real-time updates via polling or SSE

**Execution tracking**:
- [x] Limit to one running workflow per workspace (initially)
- [x] Track running workflow ID and progress in server state
- [x] `GET /api/execution/status` - Current execution state
- [x] `POST /api/execution/cancel` - Cancel running workflow
- [x] Show node-by-node progress on dashboard

**Dashboard layout**:
```
+------------------------------------------+
| Robomesh - my-project                    |
+------------------------------------------+
| Workflows                    | Activity  |
|------------------------------|-----------|
| [>] build.yaml      RUNNING  | 10:30 ... |
|     Daily Build     ⏰ 9AM   | 10:15 ... |
|                              | 09:00 ... |
| [ ] deploy.yaml     IDLE     |           |
|     Manual Deploy   🖐       |           |
|                              |           |
| [ ] cleanup.yaml    IDLE     |           |
|     Idle Cleanup    💤 30m   |           |
+------------------------------------------+
```

**Routing**:
- [x] `/` - Dashboard (workflow list + status)
- [x] `/workflow/:workspace/:path` - Designer view for specific workflow
- [x] Use React Router for navigation

### Phase 5: Designer Integration

Update designer to support workspace mode.

**Trigger config updates** (`ConfigPanel.tsx`):
- [ ] Remove file-watch, pr, webhook options
- [ ] Add idle trigger configuration (idle duration)
- [ ] Show next scheduled run for cron triggers

**Navigation**:
- [ ] Add breadcrumb: Dashboard > workflow-name
- [ ] Back button to return to dashboard
- [ ] Show current workflow status in header

### Phase 6: State Persistence

Track trigger state across restarts.

**State file** (`.robomesh/state.json`):
```json
{
  "triggers": {
    "workflows/build.yaml:trigger-1": {
      "lastRun": "2024-01-15T09:00:00Z",
      "nextRun": "2024-01-16T09:00:00Z",
      "runCount": 45
    }
  }
}
```

- [ ] Save state on trigger execution
- [ ] Restore schedules on startup
- [ ] Handle workflow file changes (re-scan, update triggers)

## File Structure

```
packages/
  cli/
    index.ts           # Add 'serve' command
  server/
    src/
      index.ts         # Update exports
      routes/
        workflows.ts   # NEW: Workflow discovery API
      workspace/
        scanner.ts     # NEW: Workflow scanner
      triggers/
        index.ts       # NEW: TriggerManager
        cron.ts        # NEW: Cron trigger
        idle.ts        # NEW: Idle trigger
        types.ts       # NEW: Trigger interfaces
  core/
    src/
      workflow-types.ts  # Add idle trigger fields
  designer/
    src/
      components/
        ConfigPanel.tsx  # Update trigger options
        Sidebar.tsx      # Add workspace workflows section
```

## Design Decisions

### Idle Trigger Behavior (DECIDED)

"Idle" means the **scheduler is idle**, not the system. When no cron jobs or other triggers are pending, pick a random idle-triggered workflow to run. This enables continuous background processing loops.

**Priority order:**
1. Cron triggers (and future event-based triggers) always take priority
2. When nothing else is scheduled, pick a random idle workflow
3. If an idle workflow is running when a cron job fires, let idle finish first (queue the cron job)

**Use case:** Continuous development loop - an idle workflow could run code review, tests, or cleanup tasks whenever the system isn't doing scheduled work.

### Future Considerations

**Remote Access**
Access the dashboard from mobile or other devices:
- Authentication (API keys, OAuth, etc.)
- HTTPS / secure connection
- Expose server beyond localhost (ngrok, tailscale, or public hosting)
- Mobile-friendly dashboard UI

**Notifications**
Alert when scheduled/idle workflows complete or fail:
- Terminal output (for foreground server)
- System notifications (macOS/Windows)
- Push notifications (mobile)

**Dedicated Apps**
Long-term: Electron desktop app with system tray integration (notification pane), and/or mobile app for always-on dashboard and notifications.

**Server Lifecycle (DECIDED)**
For now: foreground terminal process (simpler). Long-term: Electron app manages the server lifecycle and lives in the system tray.

Not in scope for initial implementation, but keep API design RESTful and stateless to support these later.

## Open Questions

1. **Idle scope**: Should idle triggers be per-workspace or global?
   - Option A: Per-workspace - each workspace has its own idle pool
   - Option B: Global - one idle pool across all workspaces
   - Leaning toward per-workspace for isolation

2. **Idle cooldown**: Should we avoid running the same idle workflow twice in a row?
   - Option A: Random selection (could repeat)
   - Option B: Round-robin through idle workflows
   - Option C: Configurable cooldown per workflow

3. **Idle workflow interruption**: If a cron job fires while idle workflow runs:
   - Option A: Queue cron, let idle finish (simpler, current plan)
   - Option B: Cancel idle, run cron immediately (more responsive)

4. **Multiple triggers per workflow**: Should a workflow support multiple trigger nodes?
   - Currently: One trigger node is the entry point
   - Consider: Allow multiple triggers that all start the same workflow

5. **Designer bundling**: How to locate designer dist from CLI?
   - Option A: Relative path from CLI package
   - Option B: Separate `@robomesh/designer` package
   - Option C: Inline designer in server package

## Priority Order

1. **Phase 1** - `robomesh serve` (enables testing everything else)
2. **Phase 2** - Workflow discovery (foundation for dashboard)
3. **Phase 4** - Workflow dashboard (overview page with start/stop)
4. **Phase 3** - Cron triggers (scheduled execution)
5. **Phase 5** - Designer integration (trigger config cleanup)
6. **Phase 3b** - Idle triggers
7. **Phase 6** - State persistence
