# Constants Node

## Overview

A constant node that outputs a configured value (boolean, number, or string). This is the foundation for logic primitives - a simple, pure node that demonstrates the pattern before adding operators.

## Design

### Single node with type selector
Rather than three separate nodes (`boolean-constant`, `number-constant`, `string-constant`), use a single `constant` node with a type dropdown in ConfigPanel.

### Circular shape
Constants use a **circular shape** to visually differentiate them from rectangular operation nodes:

```
     ╭─────╮          ╭─────╮          ╭───────╮
     │true │●         │ 42  │●         │"hello"│●
     ╰─────╯          ╰─────╯          ╰───────╯
    (boolean)        (number)         (string)
```

### Styling
- Shape: Circle/pill
- Color: Gray (neutral, as it's just a value holder)
- Single output port: `value`
- No input ports

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
  return {
    success: true,
    outputs: { value: constantData.value },
  };
}
```

Synchronous, no side effects, instant execution.

### 3. Designer UI

**`packages/designer/src/nodes/ConstantNode.tsx`**:
- Circular/pill shape using CSS `border-radius: 50%` or similar
- Display the value centered in the node
- Single output handle on the right
- Gray background color

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

### 4. Example workflow (`workflows/test-constant.yaml`)

```yaml
version: 2
metadata:
  name: Constant Node Test
  description: Tests constant node value passthrough

nodes:
  - id: trigger
    type: trigger
    position: { x: 50, y: 100 }
    data:
      nodeType: trigger
      label: Start
      triggerType: manual

  - id: my-constant
    type: constant
    position: { x: 200, y: 100 }
    data:
      nodeType: constant
      label: My Value
      valueType: string
      value: "Hello from constant!"
      outputs:
        - name: value
          type: string

  - id: echo
    type: shell
    position: { x: 400, y: 100 }
    data:
      nodeType: shell
      label: Echo Value
      script: |
        echo "Received: {{ inputs.val }}"
      inputs:
        - name: val
          type: string

edges:
  - id: trigger-to-const
    source: trigger
    target: my-constant
    sourceHandle: "output:text"
    targetHandle: "input:trigger"

  - id: const-to-echo
    source: my-constant
    target: echo
    sourceHandle: "output:value"
    targetHandle: "input:val"
```

---

## Testing

1. Create constant node in designer
2. Configure with each type (boolean, number, string)
3. Wire to shell node
4. Execute and verify value passes through
5. Verify YAML export/import works correctly
