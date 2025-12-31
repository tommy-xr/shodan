# Function Node

## Overview

A new `function` node type that executes pure TypeScript functions with typed inputs and outputs. Unlike the shell-based `script` node, functions have clean semantics: inputs object in, outputs object out.

This enables:
- **Logic operators** (`not`, `and`, `or`, `equals`, etc.) as simple inline functions
- **Data transformations** without shell overhead
- **Reusable function libraries** for common operations

## Motivation

The current `script` node has shell semantics (stdout/stderr/exitCode) which is awkward for pure computations. A function node provides:

1. **Cleaner mental model**: `inputs → function → outputs` vs subprocess spawning
2. **Type safety**: Inputs/outputs are structured objects, not string parsing
3. **Inline code**: No separate file needed for simple operations
4. **Performance**: No subprocess spawn overhead for simple functions

## Design

### Two modes: Inline vs File

**Inline mode** - code directly in the node:
```yaml
- id: negate
  type: function
  data:
    nodeType: function
    label: Not
    code: "return { result: !inputs.value }"
    inputs:
      - name: value
        type: boolean
    outputs:
      - name: result
        type: boolean
```

**File mode** - reference an external TypeScript file:
```yaml
- id: transform
  type: function
  data:
    nodeType: function
    label: Transform Data
    file: scripts/transforms/parse-json.ts
    inputs:
      - name: raw
        type: string
    outputs:
      - name: data
        type: object
```

### Function contract

For **inline code**, the executor uses esbuild to strip TypeScript types, then evaluates in-process with `AsyncFunction`:

```typescript
import { transform } from 'esbuild';

// AsyncFunction constructor (supports await in body)
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// User writes (can include TS types and await):
code: "return { result: (inputs.a as boolean) && inputs.b }"

// Executor transforms TS → JS (strips types, ~1ms):
const { code: jsCode } = await transform(userCode, { loader: 'ts' });

// Then evaluates as async function in the Node process:
const fn = new AsyncFunction('inputs', jsCode);
const outputs = await fn(inputValues);
```

**Why esbuild:**
- Self-contained, no `typescript` dependency needed
- Very fast (~1ms for small snippets)
- Just strips types, no type checking (that's fine for runtime)
- Runs in-process, no subprocess overhead

**Dependency:** Add `esbuild` to server package: `pnpm -F server add esbuild`

For **file mode**, the file must export a default function:
```typescript
// scripts/logic/and.ts
export default function(inputs: { a: boolean, b: boolean }): { result: boolean } {
  return { result: inputs.a && inputs.b };
}

// Or async:
export default async function(inputs: { url: string }): Promise<{ data: object }> {
  const response = await fetch(inputs.url);
  return { data: await response.json() };
}
```

**File loading strategy:** Node.js cannot directly `import()` TypeScript files without a loader. We use esbuild to compile the file to JS first:

```typescript
import { build } from 'esbuild';
import { pathToFileURL } from 'url';

// Compile TS to JS in memory, write to temp location
const result = await build({
  entryPoints: [absolutePath],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const jsCode = result.outputFiles[0].text;

// Write to temp file and import (or use data URL)
const tempFile = `/tmp/robomesh-fn-${hash}.mjs`;
await fs.writeFile(tempFile, jsCode);
const module = await import(pathToFileURL(tempFile).href);
```

Alternatively, if we require Node 22.6+, we could use `--experimental-strip-types` flag, but esbuild gives us more control and works with older Node versions.

### Async support

**File mode:** Async functions work naturally - the executor awaits the result:
```typescript
const result = await Promise.resolve(fn(inputValues));
```

**Inline mode:** `new Function()` creates a synchronous function, so `await` would be a syntax error. To support async inline code, we use the `AsyncFunction` constructor:

```typescript
// Get the AsyncFunction constructor
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// Wrap user code in async function
const fn = new AsyncFunction('inputs', userCode);  // Can now use await
const result = await fn(inputValues);
```

This allows inline code like:
```typescript
code: |
  const response = await fetch(inputs.url);
  return { data: await response.json() };
```

---

## Security Model

**Current assumption: Single-tenant, trusted workflows.**

Function nodes execute arbitrary TypeScript/JavaScript with full Node.js process access. This includes:
- File system access (`fs`)
- Network access (`fetch`, `http`)
- Environment variables (`process.env`)
- Child process spawning (`child_process`)
- Any installed npm packages

**This is acceptable when:**
- Workflows are authored by the user running the server
- The server runs on the user's local machine
- There's no multi-tenant or shared workflow execution

**NOT acceptable when:**
- Untrusted users can submit workflows
- The server is exposed publicly
- Workflows are shared between users with different trust levels

### Future sandboxing options (if needed)

If Robomesh expands to support untrusted workflows, consider:

1. **`isolated-vm`** - V8 isolates with memory limits, no Node APIs
2. **`vm2`** - Sandboxed VM with configurable access (deprecated, security issues)
3. **Deno subprocess** - Run code in Deno with explicit permissions
4. **WebAssembly** - Compile to WASM and run in sandboxed runtime
5. **Docker/container** - Execute each function in isolated container

For MVP, we document the trust requirement and defer sandboxing.

---

## Implementation

### 1. Core types (`packages/core/src/function-types.ts`)

```typescript
export interface FunctionNodeData {
  nodeType: 'function';
  label?: string;

  // Inline mode - code string executed directly
  code?: string;

  // File mode - path to TypeScript file with default export
  file?: string;

  // Explicit I/O definitions (required for proper port rendering)
  inputs?: Array<{ name: string; type: string; required?: boolean }>;
  outputs?: Array<{ name: string; type: string }>;
}
```

- Export from `packages/core/src/index.ts`
- Either `code` or `file` must be specified (validation)

### 2. Input Collection from Edges

The existing executor uses template interpolation (`{{ node.output }}`) for shell nodes. Function nodes need structured input values collected from connected edges.

**How it works:**

1. Before executing a node, find all incoming edges to this node
2. For each edge, extract the source node's output value
3. Map to the correct input name based on the edge's `targetHandle` (e.g., `input:a` → input name `a`)
4. Build an `inputValues` object: `{ a: <value from source>, b: <value from other source> }`

**Implementation** (add to executor before node execution):

```typescript
function collectInputValues(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodeResults: Map<string, NodeResult>
): Record<string, unknown> {
  const inputValues: Record<string, unknown> = {};

  // Find edges where this node is the target
  const incomingEdges = edges.filter(e => e.target === node.id);

  for (const edge of incomingEdges) {
    // Parse target handle to get input name: "input:myInput" → "myInput"
    const targetHandle = edge.targetHandle || '';
    const match = targetHandle.match(/^input:(.+)$/);
    if (!match) continue;

    const inputName = match[1];

    // Get source node's result
    const sourceResult = nodeResults.get(edge.source);
    if (!sourceResult || sourceResult.status !== 'success') continue;

    // Parse source handle to get output name: "output:value" → "value"
    const sourceHandle = edge.sourceHandle || '';
    const sourceMatch = sourceHandle.match(/^output:(.+)$/);
    if (!sourceMatch) continue;

    const outputName = sourceMatch[1];

    // Get the specific output value
    const outputValue = sourceResult.outputs?.[outputName];
    inputValues[inputName] = outputValue;
  }

  return inputValues;
}
```

**Edge handle format:**
- Source handle: `output:<outputName>` (e.g., `output:value`, `output:result`)
- Target handle: `input:<inputName>` (e.g., `input:a`, `input:b`)

This is consistent with how other nodes already define handles in the designer.

### 3. Type Coercion

Values passed between nodes may need type coercion. For example, a shell node outputs strings, but a function node may expect a boolean.

**Coercion rules based on declared input type:**

```typescript
function coerceValue(value: unknown, targetType: string): unknown {
  if (value === undefined || value === null) return value;

  switch (targetType) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
      }
      return Boolean(value);

    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const num = parseFloat(value);
        if (!isNaN(num)) return num;
      }
      return value; // Can't coerce, leave as-is

    case 'string':
      if (typeof value === 'string') return value;
      return String(value);

    case 'object':
      if (typeof value === 'object') return value;
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;

    case 'any':
    default:
      return value; // No coercion for 'any'
  }
}

// Apply coercion to all inputs based on declared types
function coerceInputs(
  inputValues: Record<string, unknown>,
  declaredInputs: Array<{ name: string; type: string }>
): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...inputValues };

  for (const input of declaredInputs) {
    if (input.name in coerced) {
      coerced[input.name] = coerceValue(coerced[input.name], input.type);
    }
  }

  return coerced;
}
```

**Usage in executor:**
```typescript
const rawInputs = collectInputValues(node, edges, nodeResults);
const inputValues = coerceInputs(rawInputs, fnData.inputs || []);
const result = await fn(inputValues);
```

### 4. Executor (`packages/server/src/engine/executor.ts`)

Add case for `function` node type:

```typescript
import { transform, build } from 'esbuild';
import { pathToFileURL } from 'url';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

// AsyncFunction constructor for inline async support
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// ... in executeNode():

if (nodeType === 'function') {
  const fnData = node.data as FunctionNodeData;
  const { code, file } = fnData;
  const startTime = new Date().toISOString();

  try {
    let fn: (inputs: Record<string, unknown>) => unknown | Promise<unknown>;

    if (code) {
      // Inline mode: strip TS types with esbuild, then eval with AsyncFunction
      const { code: jsCode } = await transform(code, { loader: 'ts' });
      fn = new AsyncFunction('inputs', jsCode);
    } else if (file) {
      // File mode: compile with esbuild, then dynamic import
      const absolutePath = path.resolve(cwd, file);

      // Bundle and compile to JS
      const buildResult = await build({
        entryPoints: [absolutePath],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
      });
      const jsCode = buildResult.outputFiles[0].text;

      // Write to temp file for import (Node requires file URL for ESM)
      // Use content hash to bust Node's ESM cache when source changes
      const contentHash = crypto.createHash('md5').update(jsCode).digest('hex').slice(0, 8);
      const tempFile = path.join(os.tmpdir(), `robomesh-fn-${contentHash}.mjs`);

      // Only write if file doesn't exist (content-addressed)
      try {
        await fs.access(tempFile);
      } catch {
        await fs.writeFile(tempFile, jsCode);
      }

      const module = await import(pathToFileURL(tempFile).href);
      fn = module.default;

      if (typeof fn !== 'function') {
        throw new Error(`File ${file} must export a default function`);
      }
    } else {
      throw new Error('Function node requires either code or file');
    }

    // Execute function with input values
    const result = await fn(inputValues);

    // Validate result is an object
    if (typeof result !== 'object' || result === null) {
      throw new Error('Function must return an object, got: ' + typeof result);
    }

    // Validate outputs match declared outputs
    const declaredOutputs = fnData.outputs || [];
    const resultObj = result as Record<string, unknown>;
    const missingOutputs = declaredOutputs
      .filter(o => !(o.name in resultObj))
      .map(o => o.name);

    if (missingOutputs.length > 0) {
      throw new Error(`Function missing declared outputs: ${missingOutputs.join(', ')}`);
    }

    // Safe serialization (handles undefined, but not circular refs)
    const safeStringify = (obj: unknown): string => {
      try {
        return JSON.stringify(obj, (_, v) => v === undefined ? null : v);
      } catch (e) {
        // Circular reference or BigInt - return a descriptive placeholder
        return '[Complex object - not serializable]';
      }
    };

    return {
      nodeId: node.id,
      status: 'success',
      output: safeStringify(result),
      outputs: resultObj,
      startTime,
      endTime: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'failed',
      output: '',
      error: error instanceof Error ? error.message : String(error),
      startTime,
      endTime: new Date().toISOString(),
    };
  }
}
```

Update `getNodeIO()` to handle function nodes:
```typescript
} else if (nodeType === 'function') {
  // Function nodes use explicit inputs/outputs from data
  const fnData = nodeData as FunctionNodeData;
  return {
    inputs: fnData.inputs || [],
    outputs: fnData.outputs || []
  };
}
```

### 5. Designer UI

The designer uses a unified `BaseNode` component for all node types. No new component file is needed - just register `function` in the nodeTypes map and update supporting files.

**`packages/designer/src/nodes/index.ts`**:
```typescript
// Add to nodeTypes map - BaseNode handles all types
export const nodeTypes = {
  // ... existing types
  function: BaseNode,  // Uses unified BaseNode component
};
```

**`packages/designer/src/nodes/BaseNode.tsx`**:
- Add `'function'` to the `NodeType` union
- Add to `nodeIcons`: `function: 'ƒ'` or `'λ'`
- Add to `nodeLabels`: `function: 'Function'`
- Add to `nodeColors`: `function: '#8b5cf6'` (purple/violet for logic)
- Update `getDefaultIO()` to return explicit inputs/outputs from `FunctionNodeData`

**`packages/designer/src/components/Sidebar.tsx`**:
- Add "Function" node under "Logic" category (create category if needed)
- Default node data for drag-to-create

**`packages/designer/src/components/ConfigPanel.tsx`**:
- Add `function` case with:
  - Mode toggle: Inline / File
  - **Inline mode**: Code textarea (monospace font, consider CodeMirror later)
  - **File mode**: File path text input
  - Inputs section: Add/remove/edit input ports (name, type dropdown)
  - Outputs section: Add/remove/edit output ports (name, type dropdown)

**`packages/core/src/node-defaults.ts`**:
- Add default data for new function nodes:
```typescript
function: {
  nodeType: 'function',
  label: 'Function',
  code: 'return { result: inputs.value }',
  inputs: [{ name: 'value', type: 'any' }],
  outputs: [{ name: 'result', type: 'any' }],
}
```

### 6. Validation

Add to workflow validation:
- Function node must have either `code` or `file` (not both, not neither)
- If `file`, warn if file doesn't exist (non-blocking)
- Inputs/outputs should be defined for proper wiring

---

## Built-in Logic Operators

Create `scripts/logic/` directory with reusable operators:

### Boolean operators

```typescript
// scripts/logic/not.ts
export default function({ value }: { value: boolean }): { result: boolean } {
  return { result: !value };
}

// scripts/logic/and.ts
export default function({ a, b }: { a: boolean, b: boolean }): { result: boolean } {
  return { result: a && b };
}

// scripts/logic/or.ts
export default function({ a, b }: { a: boolean, b: boolean }): { result: boolean } {
  return { result: a || b };
}
```

### Comparison operators

```typescript
// scripts/logic/equals.ts
export default function({ a, b }: { a: unknown, b: unknown }): { result: boolean } {
  return { result: a === b };
}

// scripts/logic/not-equals.ts
export default function({ a, b }: { a: unknown, b: unknown }): { result: boolean } {
  return { result: a !== b };
}

// scripts/logic/greater-than.ts
export default function({ a, b }: { a: number, b: number }): { result: boolean } {
  return { result: a > b };
}

// scripts/logic/less-than.ts
export default function({ a, b }: { a: number, b: number }): { result: boolean } {
  return { result: a < b };
}
```

### Utility operators

```typescript
// scripts/logic/coalesce.ts
export default function({ a, b }: { a: unknown, b: unknown }): { result: unknown } {
  return { result: a ?? b };
}

// scripts/logic/ternary.ts
export default function({ condition, ifTrue, ifFalse }: {
  condition: boolean,
  ifTrue: unknown,
  ifFalse: unknown
}): { result: unknown } {
  return { result: condition ? ifTrue : ifFalse };
}
```

---

## Migration: Deprecate `script` node

The `script` node becomes redundant:

| Old `script` usage | New approach |
|-------------------|--------------|
| `.ts` file | `function` node with `file: "path.ts"` |
| `.js` file | `function` node with `file: "path.js"` (executor supports both) |
| `.sh` file | `shell` node with `script: "bash path.sh"` |

### Migration steps

1. **Phase 1**: Add `function` node alongside `script` (this plan)
2. **Phase 2**: Add deprecation warning when `script` nodes are used
3. **Phase 3**: Create migration script to convert `script` → `function`/`shell`
4. **Phase 4**: Remove `script` node type

### Conversion examples

```yaml
# OLD: script node with .ts file
- id: transform
  type: script
  data:
    nodeType: script
    scriptFile: scripts/transform.ts
    scriptArgs: "{{ inputs.data }}"

# NEW: function node
- id: transform
  type: function
  data:
    nodeType: function
    file: scripts/transform.ts
    inputs:
      - name: data
        type: string
    outputs:
      - name: result
        type: object
```

The key difference: inputs come from edges, not scriptArgs string interpolation.

---

## Test Workflows

### Basic inline function (`workflows/test-function-inline.yaml`)

```yaml
version: 2
metadata:
  name: Function Node Test (Inline)
  description: Tests inline function code

nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start

  - id: num-a
    type: constant
    position: { x: 200, y: 100 }
    data:
      nodeType: constant
      label: A
      valueType: number
      value: 10
      outputs:
        - name: value
          type: number

  - id: num-b
    type: constant
    position: { x: 200, y: 200 }
    data:
      nodeType: constant
      label: B
      valueType: number
      value: 3
      outputs:
        - name: value
          type: number

  - id: add
    type: function
    position: { x: 400, y: 150 }
    data:
      nodeType: function
      label: Add
      code: "return { sum: inputs.a + inputs.b }"
      inputs:
        - name: a
          type: number
        - name: b
          type: number
      outputs:
        - name: sum
          type: number

  - id: log
    type: shell
    position: { x: 600, y: 150 }
    data:
      nodeType: shell
      label: Log Result
      script: "echo \"Sum: {{ inputs.value }}\""
      inputs:
        - name: value
          type: number

edges:
  - id: e1
    source: num-a
    target: add
    sourceHandle: "output:value"
    targetHandle: "input:a"
  - id: e2
    source: num-b
    target: add
    sourceHandle: "output:value"
    targetHandle: "input:b"
  - id: e3
    source: add
    target: log
    sourceHandle: "output:sum"
    targetHandle: "input:value"
```

**Expected output:** `Sum: 13`

### Logic operators with file (`workflows/test-function-logic.yaml`)

```yaml
version: 2
metadata:
  name: Function Node Test (Logic Operators)
  description: Tests boolean logic operators

nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start

  - id: flag-a
    type: constant
    position: { x: 200, y: 100 }
    data:
      nodeType: constant
      label: Flag A
      valueType: boolean
      value: true
      outputs:
        - name: value
          type: boolean

  - id: flag-b
    type: constant
    position: { x: 200, y: 200 }
    data:
      nodeType: constant
      label: Flag B
      valueType: boolean
      value: false
      outputs:
        - name: value
          type: boolean

  - id: and-op
    type: function
    position: { x: 400, y: 150 }
    data:
      nodeType: function
      label: AND
      file: scripts/logic/and.ts
      inputs:
        - name: a
          type: boolean
        - name: b
          type: boolean
      outputs:
        - name: result
          type: boolean

  - id: log
    type: shell
    position: { x: 600, y: 150 }
    data:
      nodeType: shell
      label: Log Result
      script: "echo \"A AND B = {{ inputs.value }}\""
      inputs:
        - name: value
          type: boolean

edges:
  - id: e1
    source: flag-a
    target: and-op
    sourceHandle: "output:value"
    targetHandle: "input:a"
  - id: e2
    source: flag-b
    target: and-op
    sourceHandle: "output:value"
    targetHandle: "input:b"
  - id: e3
    source: and-op
    target: log
    sourceHandle: "output:result"
    targetHandle: "input:value"
```

**Expected output:** `A AND B = false`

---

## Open Questions

1. ~~**Security**: `new Function()` has similar risks to `eval()`.~~ **RESOLVED**: See Security Model section. Acceptable for single-tenant/trusted workflows. Sandboxing deferred to future if needed.

2. **Module imports**: Should inline code support `import`? Initially no - keep inline simple. Use file mode for complex functions needing imports.

3. **Error stack traces**: `AsyncFunction()` creates anonymous functions. May need to add source mapping for debugging. Consider wrapping code with try/catch that captures line numbers.

4. **Code editor**: Should ConfigPanel have syntax highlighting? Monaco is heavy but great UX. Start simple (textarea), enhance later.

5. **Auto-infer I/O**: Could we parse the TypeScript code to auto-detect input/output types? Nice-to-have, not MVP.

6. ~~**Temp file cleanup**~~ **RESOLVED**: Using content-addressed filenames (`robomesh-fn-{contentHash}.mjs`). Files are naturally deduplicated and can be reused across executions. OS will clean `/tmp` periodically.

7. ~~**Caching compiled files**~~ **RESOLVED**: Content-addressed temp files provide automatic caching. Same source → same hash → same file → reused by Node's ESM cache.

---

## Implementation Order

1. **Add esbuild** - `pnpm -F server add esbuild`
2. **Core types** - Add `FunctionNodeData` to `packages/core`
3. **Executor** - Add `function` case to `executeNode()`
4. **Designer** - Add to Sidebar, ConfigPanel, node rendering
5. **Test workflows** - Create test cases
6. **Built-in operators** - Add `scripts/logic/*.ts` files
7. **Documentation** - Update CLAUDE.md with function node docs
8. **(Future)** Deprecate and migrate `script` node
