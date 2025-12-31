# Constants Node

## Overview

A constant node that outputs a configured value (boolean, number, or string). This is the foundation for logic primitives - a simple, pure node that demonstrates the pattern before adding operators.

## Design

### Single node with type selector
Rather than three separate nodes (`boolean-constant`, `number-constant`, `string-constant`), use a single `constant` node with a type dropdown in ConfigPanel.

### Pill shape
Constants use a **pill shape** (rounded rectangle) to visually differentiate them from rectangular operation nodes. Pill shape chosen over circle because string values need horizontal space.

```
   ╭───────────╮
   │   true    │● value (boolean - pink)
   ╰───────────╯

   ╭───────────╮
   │    42     │● value (number - purple)
   ╰───────────╯

   ╭───────────╮
   │  "hello"  │● value (string - blue)
   ╰───────────╯
```

### Styling
- Shape: Pill (rounded rectangle with large border-radius)
- Color: Gray background (neutral, as it's just a value holder)
- No input ports (left side empty)
- Single output port: `value` (right side)
  - Port type matches `valueType` (boolean/number/string)
  - Handle color reflects type via existing `typeColors` mapping

### Defaults
When creating a new constant node:
- `valueType`: `'string'` (most common use case)
- `value`: `''` (empty string), `0` (number), `false` (boolean) based on type

### Value display
- Truncate long strings to ~20 characters with ellipsis
- Show `"quotes"` around string values for clarity
- Booleans display as `true` / `false`
- Numbers display as-is

---

## Implementation

### 1. Core types (`packages/core/src/constant-types.ts`)

```typescript
export type ConstantValueType = 'boolean' | 'number' | 'string';

export interface ConstantNodeData {
  nodeType: 'constant';
  label?: string;
  valueType: ConstantValueType;
  value: boolean | number | string;
  outputs?: Array<{ name: string; type: string }>;
}
```

- Export from `packages/core/src/index.ts`

### 2. Executor (`packages/server/src/engine/executor.ts`)

Handle `constant` node type in `executeNode()`:

```typescript
case 'constant': {
  const constantData = node.data as ConstantNodeData;
  const { valueType, value } = constantData;

  // Runtime type validation
  if (valueType === 'boolean' && typeof value !== 'boolean') {
    return { success: false, error: `Expected boolean, got ${typeof value}` };
  }
  if (valueType === 'number' && typeof value !== 'number') {
    return { success: false, error: `Expected number, got ${typeof value}` };
  }
  if (valueType === 'string' && typeof value !== 'string') {
    return { success: false, error: `Expected string, got ${typeof value}` };
  }

  return {
    success: true,
    outputs: { value },
  };
}
```

Synchronous, no side effects, instant execution.

### 3. Designer UI

**`packages/designer/src/nodes/ConstantNode.tsx`**:
- Pill shape using CSS `border-radius: 9999px` (fully rounded ends)
- Display the value centered in the node
- Single output handle on the right, colored by type
- Gray background color
- Truncate long strings with ellipsis

**`packages/designer/src/nodes/BaseNode.tsx`**:
- Add `'constant'` to `NodeType` union (line 6)
- Add to `nodeIcons`: `constant: '◆'` (or similar)
- Add to `nodeLabels`: `constant: 'Constant'`
- Add case to `getDefaultIO()`:
  ```typescript
  } else if (nodeType === 'constant') {
    const constantData = nodeData as ConstantNodeData;
    return {
      inputs: [],
      outputs: [
        { name: 'value', type: constantData?.valueType || 'any' }
      ]
    };
  }
  ```

**`packages/designer/src/nodes/index.ts`**:
- Add `constant: ConstantNode` to nodeTypes map

**`packages/designer/src/components/Sidebar.tsx`**:
- Add "Logic" category
- Add "Constant" node type under Logic

**`packages/designer/src/components/ConfigPanel.tsx`**:
- Type dropdown: boolean | number | string
- Value input that changes based on type:
  - Boolean: checkbox/toggle
  - Number: number input
  - String: text input
- When type changes, reset value to type-appropriate default

### 4. Test workflows

#### Basic test (`workflows/test-constant.yaml`)

Tests all three value types wired to a shell node:

```yaml
version: 2
metadata:
  name: Constant Node Test
  description: Tests constant values passing to shell nodes

nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual

  - id: greeting
    type: constant
    position: { x: 200, y: 100 }
    data:
      nodeType: constant
      label: Greeting
      valueType: string
      value: "Hello, Robomesh!"
      outputs:
        - name: value
          type: string

  - id: count
    type: constant
    position: { x: 200, y: 200 }
    data:
      nodeType: constant
      label: Count
      valueType: number
      value: 42
      outputs:
        - name: value
          type: number

  - id: enabled
    type: constant
    position: { x: 200, y: 300 }
    data:
      nodeType: constant
      label: Enabled
      valueType: boolean
      value: true
      outputs:
        - name: value
          type: boolean

  - id: echo-all
    type: shell
    position: { x: 450, y: 150 }
    data:
      nodeType: shell
      label: Echo Values
      script: |
        echo "String: {{ inputs.msg }}"
        echo "Number: {{ inputs.num }}"
        echo "Boolean: {{ inputs.flag }}"
      inputs:
        - name: msg
          type: string
        - name: num
          type: number
        - name: flag
          type: boolean

edges:
  - id: e1
    source: greeting
    target: echo-all
    sourceHandle: "output:value"
    targetHandle: "input:msg"

  - id: e2
    source: count
    target: echo-all
    sourceHandle: "output:value"
    targetHandle: "input:num"

  - id: e3
    source: enabled
    target: echo-all
    sourceHandle: "output:value"
    targetHandle: "input:flag"
```

**Expected output:**
```
String: Hello, Robomesh!
Number: 42
Boolean: true
```

#### Loop with constant true (`workflows/test-loop-constant-true.yaml`)

Tests that a constant `true` causes loop to run until max iterations:

```yaml
version: 2
metadata:
  name: Loop with Constant True
  description: Loop continues until max iterations

nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual

  - id: loop
    type: loop
    position: { x: 200, y: 100 }
    style: { width: 400, height: 250 }
    data:
      nodeType: loop
      label: Always Loop
      maxIterations: 3
      dockSlots:
        - name: iteration
          type: iteration
          valueType: number
        - name: continue
          type: continue
          valueType: boolean

  - id: keep-going
    type: constant
    parentId: loop
    position: { x: 50, y: 50 }
    data:
      nodeType: constant
      label: Keep Going
      valueType: boolean
      value: true
      outputs:
        - name: value
          type: boolean

  - id: log
    type: shell
    parentId: loop
    position: { x: 200, y: 50 }
    data:
      nodeType: shell
      label: Log Iteration
      script: echo "Iteration {{ inputs.i }}"
      inputs:
        - name: i
          type: number

edges:
  - id: iter-to-log
    source: loop
    target: log
    sourceHandle: "dock:iteration:output"
    targetHandle: "input:i"

  - id: const-to-continue
    source: keep-going
    target: loop
    sourceHandle: "output:value"
    targetHandle: "dock:continue:input"
```

**Expected output:** Runs 3 iterations (hits max), prints "Iteration 1", "Iteration 2", "Iteration 3"

#### Loop with constant false (`workflows/test-loop-constant-false.yaml`)

Tests that a constant `false` causes loop to stop after first iteration:

```yaml
version: 2
metadata:
  name: Loop with Constant False
  description: Loop stops after first iteration

nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 150 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual

  - id: loop
    type: loop
    position: { x: 200, y: 100 }
    style: { width: 400, height: 250 }
    data:
      nodeType: loop
      label: Run Once
      maxIterations: 10
      dockSlots:
        - name: iteration
          type: iteration
          valueType: number
        - name: continue
          type: continue
          valueType: boolean

  - id: stop-now
    type: constant
    parentId: loop
    position: { x: 50, y: 50 }
    data:
      nodeType: constant
      label: Stop
      valueType: boolean
      value: false
      outputs:
        - name: value
          type: boolean

  - id: log
    type: shell
    parentId: loop
    position: { x: 200, y: 50 }
    data:
      nodeType: shell
      label: Log Iteration
      script: echo "Iteration {{ inputs.i }}"
      inputs:
        - name: i
          type: number

edges:
  - id: iter-to-log
    source: loop
    target: log
    sourceHandle: "dock:iteration:output"
    targetHandle: "input:i"

  - id: const-to-continue
    source: stop-now
    target: loop
    sourceHandle: "output:value"
    targetHandle: "dock:continue:input"
```

**Expected output:** Runs 1 iteration only, prints "Iteration 1"

---

## Testing

### CLI tests
```bash
pnpm run robomesh -- run workflows/test-constant.yaml
# Expected: String/Number/Boolean values printed

pnpm run robomesh -- run workflows/test-loop-constant-true.yaml
# Expected: 3 iterations (hits maxIterations)

pnpm run robomesh -- run workflows/test-loop-constant-false.yaml
# Expected: 1 iteration (stops immediately)
```

### Manual tests
1. Create constant node in designer
2. Configure with each type (boolean, number, string)
3. Verify output port color matches type
4. Wire to shell node
5. Execute and verify value passes through
6. Verify YAML export/import works correctly
7. Test inside loop container with continue wiring
