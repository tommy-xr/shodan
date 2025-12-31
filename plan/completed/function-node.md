# Function Node

**Status: COMPLETED** (2025-12-31)

## Summary

Implemented a new `function` node type that executes pure TypeScript functions with typed inputs and outputs. Supports both inline code and external file references.

### What was implemented:
- **Core types** (`packages/core/src/function-types.ts`) - FunctionNodeData interface, coerceValue, coerceInputs utilities
- **Executor** (`packages/server/src/engine/executor.ts`) - Function node execution with esbuild for TS transpilation
- **Designer UI** - BaseNode updates, ConfigPanel with inline/file mode toggle, I/O editor, Sidebar entry
- **Validation** (`packages/core/src/validation.ts`) - Added function/constant to dynamic port types
- **Test workflows** - test-function-inline.yaml, test-function-logic.yaml
- **Test suite** - Added to test-workflows.ts (20 tests, all passing)

### Key technical decisions:
- **esbuild** for TypeScript transpilation (~1ms, no typescript runtime dependency)
- **AsyncFunction constructor** for async inline code support
- **Content-addressed temp files** for ESM cache busting with file mode
- **Type coercion** for values passed between nodes
- **Single-tenant security model** documented (sandboxing deferred)

---

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

For **file mode**, the file must export a default function:
```typescript
// scripts/logic/and.ts
export default function(inputs: { a: boolean, b: boolean }): { result: boolean } {
  return { result: inputs.a && inputs.b };
}
```

---

## Security Model

**Current assumption: Single-tenant, trusted workflows.**

Function nodes execute arbitrary TypeScript/JavaScript with full Node.js process access. This is acceptable when workflows are authored by the user running the server on their local machine.

---

## Test Workflows

- `workflows/test-function-inline.yaml` - Tests inline code (10 + 3 = 13)
- `workflows/test-function-logic.yaml` - Tests logic operators with inline code (true AND false = false)

Both are included in the test suite (`pnpm run test:workflows`).
