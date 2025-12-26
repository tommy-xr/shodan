# Input/Output System Design

This document outlines the design for a unified input/output system for Shodan workflow nodes.

**Status:** Phase 1 (Core Data Model) completed ✅
**Project Structure:** Restructured to monorepo with `src/core`, `src/server`, `src/designer`, `src/cli`
**Schema Version:** v2 (with v1→v2 migration)

---

## Current State

Currently, data flows between nodes via:
- **Template variables**: `{{ node_id.output }}` - string interpolation in prompts, scripts, etc.
- **Implicit outputs**: Each node produces a single `output` string captured from execution
- **No typed inputs**: Nodes don't declare what inputs they expect

### Limitations
1. No schema validation for inputs or outputs
2. Single unstructured output per node
3. No way to define multiple named outputs
4. Trigger nodes can't pass input data to workflows
5. Can't compose workflows into reusable components with defined interfaces

---

## Goals

1. **Explicit Inputs**: Nodes declare what inputs they accept (name, type, required/optional)
2. **Explicit Outputs**: Nodes declare what outputs they produce (name, type, schema)
3. **Type Safety**: Validate connections between compatible input/output types
4. **Trigger Data**: Allow triggers to inject data into workflows (e.g., manual trigger with text input)
5. **Component Interfaces**: Enable workflows to be wrapped as reusable components with defined I/O

---

## Design Decisions

- **Strict type checking**: Types must match exactly; we can loosen later if needed
- **`any` type is bidirectional**: `any` outputs can connect to typed inputs, and typed outputs can connect to `any` inputs
- **Single edge per input**: Each input port accepts exactly one inbound edge (no fan-in). UI and executor enforce this.
- **No array ports**: Single value per port for now
- **No streaming**: Wait for full output before passing downstream
- **Conditional outputs via nodes**: Use if/conditional/script nodes for branching logic rather than conditional ports
- **Port ordering**: Definition order (the order they were defined in the configuration)
- **Component versioning**: Interface-based compatibility - as long as inputs/outputs match, internals can change freely
- **Implementation order**: Start with trigger/shell/script nodes for faster testing, then add agent I/O

---

## Core Types

```typescript
// Basic value types that can flow between nodes
type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'      // Arbitrary JSON object
  | 'file'      // File path reference
  | 'files'     // Array of file paths
  | 'any';      // Accepts anything (for backwards compat)

interface PortDefinition {
  name: string;           // Unique identifier within the node
  label?: string;         // Human-readable label
  type: ValueType;
  required?: boolean;     // For inputs: is this required?
  default?: unknown;      // For inputs: default value if not connected
  description?: string;   // Help text
  schema?: object;        // JSON Schema for 'json' type validation
  extract?: {             // For outputs: how to extract value from execution result
    type: 'regex' | 'json_path' | 'full';
    pattern?: string;     // Regex pattern (capture group 1) or JSONPath expression
  };
}

interface NodeIO {
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
}
```

### Node Data Updates

```typescript
interface BaseNodeData {
  // ... existing fields ...

  // New I/O definition (persisted)
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
}

// Runtime-only state (NOT persisted to workflow files)
// These live in ExecutionContext or a separate runtime store
interface NodeRuntimeState {
  inputValues?: Record<string, unknown>;
  outputValues?: Record<string, unknown>;
  executionStatus?: ExecutionStatus;
}
```

**Note:** `inputValues`/`outputValues` are runtime-only and must be excluded from workflow serialization. They exist in the execution context, not in BaseNodeData.

### Edge Updates

```typescript
interface EnhancedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;  // Now required: "output:outputName"
  targetHandle: string;  // Now required: "input:inputName"
}
```

---

## Node-Specific I/O

### Agent Node

**Inputs:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `context` | `string` | No | Additional context to append to prompt |
| `files` | `files` | No | Files to include in context |
| *dynamic* | `any` | No | User-defined inputs available as template vars |

**Outputs:**
| Name | Type | Description |
|------|------|-------------|
| `response` | `string` | Full agent response text |
| `structured` | `json` | Parsed JSON if outputSchema is defined |
| `exitCode` | `number` | 0 for success, non-zero for failure |
| *dynamic* | `any` | User-defined outputs extracted from response |

**Example:**
```yaml
# Agent node configuration
inputs:
  - name: pr_diff
    type: string
    required: true
    description: The diff to review
  - name: guidelines
    type: string
    default: "Use conventional commits"

outputs:
  - name: review
    type: json
    schema:
      type: object
      properties:
        approved: { type: boolean }
        comments: { type: array, items: { type: string } }
  - name: summary
    type: string
```

### Shell Node

**Inputs:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `stdin` | `string` | No | Standard input to pipe to script |
| `env` | `json` | No | Environment variables to set |
| *dynamic* | `any` | No | User-defined inputs available as `$INPUT_NAME` |

**Outputs:**
| Name | Type | Description |
|------|------|-------------|
| `stdout` | `string` | Standard output from script |
| `stderr` | `string` | Standard error from script |
| `exitCode` | `number` | Exit code from script |
| *dynamic* | `any` | User-defined outputs via extraction patterns |

**Output Extraction:**
```yaml
outputs:
  - name: version
    type: string
    extract:
      type: regex
      pattern: 'version:\s*(\d+\.\d+\.\d+)'
  - name: config
    type: json
    extract:
      type: json_path
      path: $.config
```

### Script Node

Same as Shell node, but with file-based script execution.

### Trigger Node

**Outputs only** (triggers don't receive inputs):
| Name | Type | Description |
|------|------|-------------|
| `timestamp` | `string` | ISO timestamp when trigger fired |
| `type` | `string` | Trigger type identifier |
| *type-specific* | varies | Data specific to trigger type |

**Trigger-specific outputs:**

#### Manual Trigger
| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | Optional text input from user |
| `params` | `json` | Optional parameters passed via CLI/UI |

#### File Watch Trigger
| Name | Type | Description |
|------|------|-------------|
| `path` | `file` | Path to changed file |
| `event` | `string` | 'add', 'change', 'unlink' |

#### Webhook Trigger
| Name | Type | Description |
|------|------|-------------|
| `body` | `json` | Request body |
| `headers` | `json` | Request headers |
| `method` | `string` | HTTP method |

#### Periodic Trigger
| Name | Type | Description |
|------|------|-------------|
| `scheduledTime` | `string` | When this execution was scheduled |

### Working Directory Node

**Outputs:**
| Name | Type | Description |
|------|------|-------------|
| `path` | `string` | Absolute path to working directory |
| `exists` | `boolean` | Whether directory exists |

---

## UI Changes

### Handle Display

Replace single input/output handles with multiple named ports:

```
┌─────────────────────────┐
│ 🤖 Agent                │
├─────────────────────────┤
│                         │
│ ○ context      response ●│
│ ○ files       exitCode ●│
│ ○ pr_diff               │
│                         │
└─────────────────────────┘
```

- Input handles (○) on left, displayed in definition order
- Output handles (●) on right, displayed in definition order
- Labels visible on hover or always for small port count
- Color-coded by type (string=blue, json=green, etc.)

### Port Configuration UI

In the node configuration panel:

```
┌─────────────────────────────────────────┐
│ Inputs                            [+ Add]│
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ Name: [pr_diff    ] Type: [string▼] │ │
│ │ Required: [✓]  Default: [        ] │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ Name: [context    ] Type: [string▼] │ │
│ │ Required: [ ]  Default: [        ] │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Outputs                           [+ Add]│
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ Name: [review     ] Type: [json  ▼] │ │
│ │ Schema: [Edit...]                   │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Connection Validation

When dragging a connection:
- Valid targets highlight green
- Invalid targets (type mismatch) show red with tooltip
- `any` type accepts all connections

---

## Execution Changes

### Template Variable Updates

Current: `{{ node.output }}`
New: `{{ node.outputName }}` (shorthand for named outputs)

**Resolution rules:**
1. `{{ node.output }}` - Legacy syntax, maps to the first defined output (primary output)
2. `{{ node.outputName }}` - Looks up output by name
3. If a node has an output literally named `output`, it takes precedence for `{{ node.output }}`
4. Shorthand `{{ node.outputName }}` only works if `outputName` is a defined output; otherwise template is left unchanged

**Precedence:** Named output lookup → first output fallback → unchanged template

### Execution Context

```typescript
interface ExecutionContext {
  // Map of nodeId -> { outputName -> value }
  outputs: Map<string, Record<string, unknown>>;

  // For quick access to node labels
  nodeLabels: Map<string, string>;

  // Global workflow inputs (from trigger)
  workflowInputs: Record<string, unknown>;
}
```

### Trigger → Workflow Input Wiring

Trigger nodes are special: they produce outputs but receive no inputs. Their outputs become available to downstream nodes via normal edge connections.

```
┌─────────────┐     ┌─────────────┐
│ ⚡ Manual    │     │ 📜 Script   │
│   Trigger   │────▶│             │
│        text ●     ● input       │
└─────────────┘     └─────────────┘
```

When a trigger fires (e.g., manual trigger with user-provided text):
1. Trigger's `text` output is populated with the user input
2. Edge connects trigger's `text` output to script's `input` input
3. Script receives the value via normal input resolution

For CLI execution: `shodan run workflow.yaml --input "some text"` populates the trigger's outputs.

### Input Resolution

Before executing a node:
1. Collect incoming edge (exactly one per input port - enforced by UI/executor)
2. Read source node's output value from the edge
3. Build `inputValues` map (one value per input)
4. Validate types match exactly (strict checking)
5. Apply defaults for missing optional inputs
6. Fail execution if required inputs are missing or type mismatches
7. Inject into execution (template vars, env vars, etc.)

---

## Composite Nodes / Components

### Workflow Interface Definition

A workflow can define its external interface:

```yaml
version: 2
metadata:
  name: PR Reviewer
  description: Reviews a pull request and provides feedback

interface:
  inputs:
    - name: diff
      type: string
      required: true
      description: The PR diff to review
    - name: title
      type: string
      description: PR title for context

  outputs:
    - name: approved
      type: boolean
    - name: comments
      type: json
      schema:
        type: array
        items: { type: string }

nodes:
  # ... internal nodes ...

edges:
  # ... internal edges ...
```

### Mapping Interface to Internal Nodes

Special "interface" nodes mark where external I/O connects:

```yaml
nodes:
  - id: input-proxy
    type: interface-input
    data:
      # Maps external inputs to this node's outputs
      mappings:
        - external: diff
          internal: pr_diff
        - external: title
          internal: pr_title

  - id: output-proxy
    type: interface-output
    data:
      # Maps internal inputs to external outputs
      mappings:
        - internal: is_approved
          external: approved
        - internal: review_comments
          external: comments
```

### Using Components

When a workflow is used as a component in another workflow:

1. Appears as a single node with the defined interface
2. Double-click to drill into internal structure
3. Breadcrumb navigation for nested depth
4. Input/output ports match interface definition
5. Internal changes don't break parent workflows as long as interface stays compatible

```
┌─────────────────────────┐
│ 📦 PR Reviewer          │
│ (component)             │
├─────────────────────────┤
│ ○ diff        approved ●│
│ ○ title       comments ●│
└─────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Data Model ✅ COMPLETED
- [x] Add `inputs`/`outputs` to BaseNodeData type
- [x] Add `extract` field to PortDefinition
- [x] Create NodeRuntimeState for execution-time values (separate from persisted data)
- [x] Update edge serialization for handle names
- [x] Schema migration for existing workflows (v1 → v2)
- [x] **BONUS:** Restructured project to monorepo with `src/core`, `src/server`, `src/designer`, `src/cli`

**Implementation Notes:**
- Created `@shodan/core` workspace with shared types in `src/core/src/io-types.ts`
- Updated `BaseNodeData` in `src/designer/src/nodes/BaseNode.tsx` with I/O fields
- Bumped `WORKFLOW_SCHEMA_VERSION` from 1 to 2
- Implemented migration in `src/designer/src/lib/workflow.ts:upgradeWorkflow()`
- All existing workflows will auto-migrate on load
- Default ports: all nodes get `output` (string), non-triggers get `input` (any)
- Default edge handles: `output:output` and `input:input`

### Phase 2: Trigger/Shell/Script I/O (testable without agents) ✅ COMPLETED
- [x] Trigger node: outputs for manual trigger (`text`, `params`, `timestamp`)
- [x] Shell node: `input` input port, `stdout`/`stderr`/`exitCode` outputs
- [x] Script node: inherit shell I/O behavior
- [x] Update executor to resolve inputs from edges (single edge per input)
- [x] Implement strict type validation
- [x] Update template system for named outputs with resolution rules
- [x] CLI support: `shodan run workflow.yaml --input "text"`
- [x] **BONUS:** Add `continueOnFailure` flag for nodes to continue execution after failures

**Test Coverage:**
- `test-phase2-io.yaml` - Trigger inputs, stdout/stderr/exitCode, template variables
- `test-stderr-exitcode.yaml` - continueOnFailure with non-zero exit codes
- `test-failure-stops-workflow.yaml` - Negative test for workflow stopping on failure

**Key Files Modified:**
- `src/server/src/engine/executor.ts` - Core I/O system implementation
- `src/cli/index.ts` - CLI --input flag support
- `src/server/src/test-workflows.ts` - Phase 2 test suite
- `src/designer/src/nodes/BaseNode.tsx` - BaseNodeData with continueOnFailure

### Phase 3: UI - Port Display
- [ ] Multiple handles per node (definition order)
- [ ] Handle labels and type indicators
- [ ] Connection validation: single edge per input, type matching
- [ ] Update edge rendering for named handles

### Phase 4: UI - Configuration
- [ ] Input/output port editor (add/remove/reorder)
- [ ] Type selector dropdown
- [ ] Extraction pattern builder for shell outputs
- [ ] JSON schema editor for `json` type

### Phase 5: Agent Node I/O
- [ ] Agent node: input ports for context injection
- [ ] Agent node: structured outputs from outputSchema
- [ ] Output extraction from agent response

### Phase 6: Components
- [ ] Interface definition schema in workflow files
- [ ] Interface-input/output proxy nodes
- [ ] Component node type
- [ ] Drill-down navigation
- [ ] Component library UI

---

## Migration Strategy

### Backwards Compatibility

Existing workflows without explicit I/O:
1. Nodes get implicit `output` output port (type: `string`)
2. Existing `{{ node.output }}` syntax continues to work
3. Edges without handles assume default input/output

### Schema Version Bump

Increment `WORKFLOW_SCHEMA_VERSION` and add migration:

```typescript
function upgradeWorkflow(workflow: WorkflowSchema): WorkflowSchema {
  if (workflow.version === 1) {
    // Add default I/O ports based on node type
    workflow.nodes = workflow.nodes.map(node => {
      const nodeType = node.data.nodeType || node.type;

      // All nodes get a default 'output' output port
      const outputs = [{ name: 'output', type: 'string' }];

      // Non-trigger nodes get a default 'input' input port
      const inputs = nodeType === 'trigger'
        ? []
        : [{ name: 'input', type: 'any' }];

      return {
        ...node,
        data: { ...node.data, inputs, outputs }
      };
    });

    // Add default handles to edges
    // Source always uses 'output', target always uses 'input'
    workflow.edges = workflow.edges.map(edge => ({
      ...edge,
      sourceHandle: edge.sourceHandle || 'output:output',
      targetHandle: edge.targetHandle || 'input:input'
    }));

    workflow.version = 2;
  }
  return workflow;
}
```

**Key changes from naive approach:**
- Target handle defaults to `input:input` (not `input:context`) - a generic input all non-trigger nodes will have
- Trigger nodes get no input ports (they only produce outputs)
- All nodes get a default `input` input port of type `any` to accept any legacy connection

---

## Project Structure (Updated)

The project has been restructured into a clean monorepo with separate workspaces:

```
src/
├── core/       @shodan/core     - Shared types and utilities
├── server/     @shodan/server   - Backend execution engine
├── designer/   @shodan/designer - React-based visual workflow designer
└── cli/        @shodan/cli      - Command-line interface
```

### Workspace Dependencies

- `@shodan/core` - No dependencies (base layer)
  - Exports: I/O types, shared interfaces

- `@shodan/server` - Depends on: `@shodan/core`
  - Exports: Workflow executor, node runners, utilities

- `@shodan/designer` - Depends on: `@shodan/core`
  - Exports: React components, visual editor

- `@shodan/cli` - Depends on: `@shodan/core`, `@shodan/server`
  - Exports: CLI commands for running workflows

### Key Files for I/O System

- `src/core/src/io-types.ts` - Core I/O type definitions (PortDefinition, ValueType, etc.)
- `src/designer/src/nodes/BaseNode.tsx` - Node UI component with I/O fields
- `src/designer/src/lib/workflow.ts` - Serialization and migration logic
- `src/server/src/engine/executor.ts` - Workflow execution engine (to be updated in Phase 2)
