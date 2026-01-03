# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Robomesh is an AI agentic orchestration tool that allows you to define, visualize, and debug workflows spanning multiple coding agents. The project consists of five workspaces under `packages/`:
- **core**: Shared TypeScript types for workflows, nodes, I/O ports, and validation
- **server**: Node.js/Express backend that executes workflows and provides APIs
- **designer**: React-based visual workflow designer using ReactFlow
- **cli**: Command-line interface for running and validating workflows
- **migrations**: Schema migration scripts for updating existing workflows

## Development Commands

### Setup
```bash
# Enable pnpm (required)
corepack enable pnpm

# Install dependencies
pnpm install
```

### Development
```bash
# Run both server and designer in dev mode
pnpm run dev

# Run individually
pnpm run -F server dev    # Server only (tsx watch)
pnpm run -F designer dev  # Designer only (vite)
```

### Build
```bash
# Build both workspaces
pnpm run build

# Build individually
pnpm run -F server build    # TypeScript compilation
pnpm run -F designer build  # Vite build
```

### Testing & CLI
```bash
# Run workflow tests
pnpm run test:workflows

# Run e2e tests (Playwright - tests designer UI)
pnpm run test:e2e

# Use CLI directly (from root)
pnpm run robomesh -- run workflows/hello-world.yaml
pnpm run robomesh -- validate workflows/*.yaml

# Use CLI from server workspace
pnpm run -F server robomesh -- run workflows/hello-world.yaml
```

### Migrations
```bash
# Preview what migrations would change (dry run)
pnpm run -F @robomesh/migrations migrate:dry-run

# Apply migrations to all workflows
pnpm run -F @robomesh/migrations migrate
```

Migrations are used when the workflow schema changes in a way that requires updating existing YAML files. Each migration is a separate file in `packages/migrations/src/` with documentation explaining why it was needed. See `packages/migrations/README.md` for details.

## Architecture

### Workflow Execution Model

Workflows are defined in YAML files with nodes and edges. The execution engine (`packages/server/src/engine/executor.ts`) performs:

1. **Topological sorting**: Orders nodes based on dependencies (edges)
2. **Parallel execution**: Nodes with no dependencies run concurrently
3. **Template interpolation**: Outputs from completed nodes can be referenced in downstream nodes using `{{ node_id.output }}` or `{{ node_label.output }}` syntax
4. **Execution context**: Maintains a map of node outputs and labels for template resolution

### Node Types

The system supports several node types (defined in `packages/core/src/workflow-types.ts`):

- **trigger**: Entry point for workflow execution (manual trigger)
- **shell**: Executes shell commands or multi-line scripts
  - Supports both `script` (multi-line string) and legacy `commands` (array of commands)
  - Template variables are interpolated before execution
- **script**: Executes external script files (.ts, .js, .sh)
  - Uses `scriptFile` for the path and `scriptArgs` for arguments
  - TypeScript files run with `npx tsx`, JavaScript with `node`, shell scripts with `sh`
- **agent**: Invokes AI agents via different runners
  - Supported runners: `openai`, `claude-code`, `codex`, `gemini-cli`
  - Configured with `runner`, `model`, and `prompt` fields
- **loop**: Container node for iterative execution (see Loop Architecture below)
  - Child nodes use `parentId` to belong to the loop
  - Dock slots control iteration, continue condition, and feedback values
- **component**: Embedded workflow that can be reused
  - References a component YAML file from `workflows/components/`
  - Exposes input/output ports defined in the component's interface
- **interface-input** / **interface-output**: Used inside components to define their interface
  - `interface-input`: Exposes component inputs to internal nodes
  - `interface-output`: Collects internal outputs for the component

### Agent Runners

Agent execution is abstracted through the runner pattern (`packages/server/src/engine/agents/`):

- Each runner implements the `AgentRunner` interface with an `execute()` method
- Runners are registered in `packages/server/src/engine/agents/index.ts` and dispatched based on `config.runner`
- Available runners spawn CLI processes or make API calls:
  - `claude-code`: Uses Claude Code CLI
  - `openai`: OpenAI API client
  - `codex`: Codex CLI wrapper
  - `gemini-cli`: Google Gemini CLI wrapper

### Project Root Discovery

The system uses a priority-based project root discovery mechanism (`packages/server/src/utils/project-root.ts`):

1. **Primary marker**: `.robomesh` directory (highest priority)
2. **Fallback markers**: `.git` directory or `package.json` file
3. **Search strategy**: Walks up directory tree from starting point

This root directory is used as the default `cwd` for workflow execution unless overridden by `--cwd` or in the workflow metadata.

### Designer Architecture

The designer (`packages/designer/src/`) is a React Flow-based visual editor:

- **App.tsx**: Main ReactFlow wrapper with state management
- **nodes/BaseNode.tsx**: Single unified node component that renders differently based on node type
- **nodes/LoopContainerNode.tsx**: Loop container with dock slots UI
- **components/**: Sidebar (node palette), ConfigPanel (node properties), Breadcrumb (component navigation)
- **lib/**: API client and localStorage persistence

State is persisted to localStorage, including nodes, edges, viewport, workflow name, and root directory. The designer communicates with the server via REST APIs (`/api/files`, `/api/execute`, `/api/config`, `/api/components`).

### Operator Presets

The Sidebar includes pre-configured function node presets (`packages/designer/src/components/Sidebar.tsx`):

- **NOT** (¬): Boolean negation - `!inputs.value`
- **AND** (∧): Boolean AND - `inputs.a && inputs.b`
- **OR** (∨): Boolean OR - `inputs.a || inputs.b`
- **CONCAT** (+): String concatenation with separator - `inputs.values.join(inputs.separator)`

Presets are defined in `operatorPresets` and automatically configure inputs, outputs, and code.

### Array Input Ports

Array inputs allow a single port to accept multiple connections (`packages/core/src/io-types.ts`):

- **PortDefinition extensions**:
  - `array: boolean` - Marks the port as accepting multiple values
  - `arrayIndex: number` - The slot index (0, 1, 2, ...)
  - `arrayParent: string` - The base port name (e.g., "values" for "values[0]")

- **Designer behavior** (`App.tsx`):
  - Array ports start with `[0]` slot (e.g., `values[0]`)
  - Connecting to the last slot auto-adds a new slot (e.g., `values[1]`)
  - Deleting edges auto-removes empty trailing slots
  - Array handles have square styling (`.handle-array` class)

- **Executor behavior** (`executor.ts`):
  - Collects all array slot values into an array grouped by `arrayParent`
  - Passes the array to the function code (e.g., `inputs.values = ["a", "b", "c"]`)

### Loop Architecture

Loops use a dock-based model (`packages/server/src/engine/loop-executor.ts`):

- **Container node**: Loop nodes are ReactFlow group nodes; child nodes have `parentId` set to loop ID
- **Dock slots**: Control iteration via three slot types:
  - `iteration`: Output (●→) provides current iteration number (1-based)
  - `continue`: Input (→●) receives boolean to control looping
  - `feedback`: Bidirectional (●→ + →●) passes values between iterations
- **Handle IDs**: `dock:{name}:output`, `dock:{name}:input`, `dock:{name}:prev`, `dock:{name}:current`
- **Internal handles**: Edges from loop inputs to inner nodes use `:internal` suffix (e.g., `input:target:internal`)
- **Nested loops**: Parent/child loops supported; each loop filters its own children by `parentId`

### Component Architecture

Components enable workflow reuse (`packages/server/src/routes/components.ts`):

- **Component files**: Stored in `workflows/components/` as YAML with `interface:` section
- **Interface nodes**: `interface-input` exposes inputs, `interface-output` collects outputs
- **Executor**: Recursively executes component workflows, mapping inputs/outputs through interface nodes
- **Designer**: Components appear in sidebar, support drill-down editing with breadcrumb navigation

### Workspace Architecture

Workspaces allow managing workflows across multiple projects from a single server:

**Concept**: A workspace is a project directory containing workflows. Identified by a `.robomesh/` directory (primary) or `workflows/` directory.

**CLI Commands** (`packages/cli/index.ts`):
```bash
robomesh serve [--port 3000]  # Start server with registered workspaces
robomesh add [path]           # Register workspace (default: cwd)
robomesh remove [path]        # Unregister workspace
robomesh list                 # Show registered workspaces
robomesh init [path]          # Initialize workspace with .robomesh/ directory
```

**Configuration**: Workspaces stored in `~/.robomesh/config.yaml`:
```yaml
workspaces:
  - /path/to/project1
  - /path/to/project2
```

**Server Routes**:
- `/api/workspaces` - List registered workspaces
- `/api/workflows` - Discover workflows across all workspaces (`packages/server/src/routes/workflows.ts`)
- `/api/execution/*` - Execution management (`packages/server/src/routes/execution.ts`)

**Dashboard** (`packages/designer/src/pages/Dashboard.tsx`):
- Lists all workflows grouped by workspace
- Shows trigger info (manual, cron, idle badges)
- Start/Stop workflow execution
- Last run status with relative time ("✔ 5m ago")
- Click to view run details with per-node output

**Execution History** (`packages/server/src/routes/execution.ts`):
- Tracks running workflow state (one per server currently)
- Records history per workflow (last 10 runs)
- Persists to `~/.robomesh/`:
  - `history.json` - Index of all runs (summaries)
  - `runs/<run-id>.json` - Full results for each run
- History loads on server startup

**Routing** (`packages/designer/src/main.tsx`):
- `/` - Dashboard page
- `/workflow/:workspace/:path` - Designer with workflow loaded from URL
- `/designer` - Designer (uses localStorage state)

## Key Technical Details

### TypeScript Configuration
- Server uses ESM modules (`"type": "module"` in package.json)
- All imports must use `.js` extensions (TypeScript convention for ESM)
- Target: ES2022, module: ESNext, moduleResolution: bundler

### Template Variable System
Templates use mustache-like syntax: `{{ identifier.output }}`
- Identifiers can match either node IDs or normalized labels (lowercase, spaces→underscores)
- The executor replaces templates before executing nodes
- Only `rawOutput` (clean output without command prefixes) is used for interpolation

### Workflow Schema Version
Current versions are `1` (basic workflows) and `2` (components and loops). All workflow YAML files must include:
```yaml
version: 1  # or 2 for components/loops
metadata:
  name: Workflow Name
  description: Optional description
```

Component workflows (version 2) also include an `interface:` section defining inputs/outputs.

**NOTE: Schema migration is currently disabled** during early development while the data model is being stabilized. When making schema changes:
- Update existing workflow YAML files inline (don't rely on migrations)
- Update example workflows in `workflows/` directory
- When schema is stable, implement migrations in a **shared location** (e.g., `packages/core`) so both CLI/executor and UI/designer use the same upgrade logic

### Error Handling
- Shell nodes fail on first non-zero exit code
- Failed nodes stop downstream execution
- Node results include `status`, `output`, `error`, `exitCode`, and timestamps

## Common Patterns

### Adding a New Node Type
1. Add type definitions to `packages/core/src/workflow-types.ts`
2. Add node type to `packages/designer/src/nodes/index.ts` nodeTypes map
3. Update executor logic in `packages/server/src/engine/executor.ts` executeNode()
4. Add node to designer sidebar palette in `packages/designer/src/components/Sidebar.tsx`

### Adding a New Agent Runner
1. Create runner file in `packages/server/src/engine/agents/`
2. Implement `AgentRunner` interface with `execute()` method
3. Register in `packages/server/src/engine/agents/index.ts` runners Map
4. Update RunnerType union in `packages/server/src/engine/agents/types.ts`

### Workflow Development
1. Create YAML file in `workflows/` directory
2. Define nodes with unique IDs and appropriate types
3. Connect nodes with edges (source/target IDs)
4. Use template variables to pass outputs between nodes
5. Validate with `pnpm run robomesh -- validate workflows/your-file.yaml`
6. Test with `pnpm run robomesh -- run workflows/your-file.yaml`

## Additional Documentation

- **plan/backlog.md**: Pending features and incoming work
- **plan/completed/**: Completed feature plans (for reference)
- **KNOWN_ISSUES.md**: Known bugs and limitations with potential fixes
