# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shodan is an AI agentic orchestration tool that allows you to define, visualize, and debug workflows spanning multiple coding agents. The project consists of two main workspaces:
- **server**: Node.js/Express backend that executes workflows and provides APIs
- **designer**: React-based visual workflow designer using ReactFlow

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

# Use CLI directly (from root)
pnpm run shodan -- run workflows/hello-world.yaml
pnpm run shodan -- validate workflows/*.yaml

# Use CLI from server workspace
pnpm run -F server shodan -- run workflows/hello-world.yaml
```

## Architecture

### Workflow Execution Model

Workflows are defined in YAML files with nodes and edges. The execution engine (`server/src/engine/executor.ts`) performs:

1. **Topological sorting**: Orders nodes based on dependencies (edges)
2. **Parallel execution**: Nodes with no dependencies run concurrently
3. **Template interpolation**: Outputs from completed nodes can be referenced in downstream nodes using `{{ node_id.output }}` or `{{ node_label.output }}` syntax
4. **Execution context**: Maintains a map of node outputs and labels for template resolution

### Node Types

The system supports several node types (defined in both server executor and designer):

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
- **workdir**: Sets working directory for downstream operations

### Agent Runners

Agent execution is abstracted through the runner pattern (`server/src/engine/agents/`):

- Each runner implements the `AgentRunner` interface with an `execute()` method
- Runners are registered in `agents/index.ts` and dispatched based on `config.runner`
- Available runners spawn CLI processes or make API calls:
  - `claude-code`: Uses Claude Code CLI
  - `openai`: OpenAI API client
  - `codex`: Codex CLI wrapper
  - `gemini-cli`: Google Gemini CLI wrapper

### Project Root Discovery

The system uses a priority-based project root discovery mechanism (`server/src/utils/project-root.ts`):

1. **Primary marker**: `.shodan` directory (highest priority)
2. **Fallback markers**: `.git` directory or `package.json` file
3. **Search strategy**: Walks up directory tree from starting point

This root directory is used as the default `cwd` for workflow execution unless overridden by `--cwd` or in the workflow metadata.

### Designer Architecture

The designer (`designer/src/`) is a React Flow-based visual editor:

- **App.tsx**: Main ReactFlow wrapper with state management
- **nodes/BaseNode.tsx**: Single unified node component that renders differently based on node type
- **components/**: Sidebar (node palette), ConfigPanel (node properties)
- **lib/**: API client and localStorage persistence

State is persisted to localStorage, including nodes, edges, viewport, workflow name, and root directory. The designer communicates with the server via REST APIs (`/api/files`, `/api/execute`, `/api/config`).

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
Current version is `1`. All workflow YAML files must include:
```yaml
version: 1
metadata:
  name: Workflow Name
  description: Optional description
  rootDirectory: Optional root path (defaults to project root discovery)
```

### Error Handling
- Shell nodes fail on first non-zero exit code
- Failed nodes stop downstream execution
- Node results include `status`, `output`, `error`, `exitCode`, and timestamps

## Common Patterns

### Adding a New Node Type
1. Add node type to `designer/src/nodes/index.ts` nodeTypes map
2. Update executor logic in `server/src/engine/executor.ts` executeNode()
3. Update TypeScript interfaces for WorkflowNode data shape
4. Add node to designer sidebar palette

### Adding a New Agent Runner
1. Create runner file in `server/src/engine/agents/`
2. Implement `AgentRunner` interface with `execute()` method
3. Register in `agents/index.ts` runners Map
4. Update RunnerType union in `agents/types.ts`

### Workflow Development
1. Create YAML file in `workflows/` directory
2. Define nodes with unique IDs and appropriate types
3. Connect nodes with edges (source/target IDs)
4. Use template variables to pass outputs between nodes
5. Validate with `pnpm run shodan -- validate workflows/your-file.yaml`
6. Test with `pnpm run shodan -- run workflows/your-file.yaml`
