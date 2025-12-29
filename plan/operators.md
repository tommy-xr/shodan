# Logic Operators

## Overview

Logic operator nodes for boolean operations, comparisons, and utilities. These build on the constant node foundation to enable visual logic in workflows.

## Motivation

With the loop redesign using visual wiring for the continue condition, we exposed a gap: expressing simple logic (like NOT) currently requires a shell node workaround:

```yaml
- id: not-gate
  type: shell
  data:
    script: |
      if [ "{{ inputs.value }}" = "true" ]; then echo "false"; else echo "true"; fi
```

Built-in logic operators are cleaner and more visual.

---

## Proposed Operators

### Boolean Logic (Phase 2)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `not` | `value: boolean` | `result: boolean` | Inverts boolean |
| `and` | `a: boolean`, `b: boolean` | `result: boolean` | Logical AND |
| `or` | `a: boolean`, `b: boolean` | `result: boolean` | Logical OR |

**Styling**: Purple, compact rectangular nodes

### Comparisons (Phase 3)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `equals` | `a: any`, `b: any` | `result: boolean` | `a == b` |
| `not-equals` | `a: any`, `b: any` | `result: boolean` | `a != b` |
| `greater-than` | `a: number`, `b: number` | `result: boolean` | `a > b` |
| `less-than` | `a: number`, `b: number` | `result: boolean` | `a < b` |
| `greater-or-equal` | `a: number`, `b: number` | `result: boolean` | `a >= b` |
| `less-or-equal` | `a: number`, `b: number` | `result: boolean` | `a <= b` |

**Styling**: Orange, compact rectangular nodes

### Utilities (Phase 4)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `switch` / `if` | `condition: boolean`, `then: any`, `else: any` | `result: any` | Conditional value |
| `coalesce` | `value: any`, `default: any` | `result: any` | First non-null value |

### Arithmetic (Phase 4, if needed)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `add` | `a: number`, `b: number` | `result: number` | `a + b` |
| `subtract` | `a: number`, `b: number` | `result: number` | `a - b` |
| `multiply` | `a: number`, `b: number` | `result: number` | `a * b` |
| `divide` | `a: number`, `b: number` | `result: number` | `a / b` |

### String Operations (Phase 4, if needed)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `concat` | `a: string`, `b: string` | `result: string` | String concatenation |
| `contains` | `haystack: string`, `needle: string` | `result: boolean` | Substring check |
| `regex-match` | `text: string`, `pattern: string` | `result: boolean` | Regex test |

---

## Design Decisions

### Naming Convention
Simple verb-based names: `not`, `and`, `or`, `equals`, `add`

### Node Type Approach
Dedicated node types (not a generic expression node). Clear, simple, easy to implement.

### Multi-Input Gates
Fixed 2 inputs for AND/OR. Chain nodes for more - it's explicit and visual.

### Type Coercion
Strict types, no coercion. `"5" == 5` is false. Match the I/O system design.

### Visual Representation

```
┌─────────┐      ┌─────────┐      ┌─────────┐
│   NOT   │      │   AND   │      │   >     │
│         │      │         │      │         │
│ ○ value │      │ ○ a     │      │ ○ a     │
│         │      │ ○ b     │      │ ○ b     │
│ result ●│      │ result ●│      │ result ●│
└─────────┘      └─────────┘      └─────────┘
  (purple)         (purple)        (orange)
```

- Small, compact nodes
- Symbol in header for quick recognition
- Color-coded by category

---

## Implementation

### Executor

Operators are pure functions - add to executor:

```typescript
const operatorExecutors: Record<string, (inputs: Record<string, unknown>) => Record<string, unknown>> = {
  'not': ({ value }) => ({ result: !value }),
  'and': ({ a, b }) => ({ result: Boolean(a) && Boolean(b) }),
  'or': ({ a, b }) => ({ result: Boolean(a) || Boolean(b) }),
  'equals': ({ a, b }) => ({ result: a === b }),
  'not-equals': ({ a, b }) => ({ result: a !== b }),
  'greater-than': ({ a, b }) => ({ result: Number(a) > Number(b) }),
  'less-than': ({ a, b }) => ({ result: Number(a) < Number(b) }),
  // ...
};
```

### UI

- `nodes/OperatorNode.tsx` - compact rectangular rendering
- Color-coded by category (purple for logic, orange for comparison)
- Add to sidebar under "Logic" category with subcategories

---

## Example: NOT gate with loop

```yaml
# Inside a loop, invert the "approved" output to control continue
- id: not-gate
  type: not
  parentId: review-loop
  position: { x: 300, y: 150 }
  data:
    nodeType: not
    inputs:
      - name: value
        type: boolean
    outputs:
      - name: result
        type: boolean

edges:
  # Agent output -> NOT gate
  - source: review-agent
    target: not-gate
    sourceHandle: "output:approved"
    targetHandle: "input:value"

  # NOT gate -> loop continue
  - source: not-gate
    target: review-loop
    sourceHandle: "output:result"
    targetHandle: "dock:continue:input"
```

This replaces the verbose shell workaround with a clean, visual connection.
