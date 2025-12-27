# Logic Primitives Braindump

This document captures thoughts on adding logic primitive nodes to Shodan workflows.

## Motivation

With the loop redesign using visual wiring for the continue condition, we exposed a gap: expressing simple logic (like NOT) currently requires a shell node workaround:

```yaml
- id: not-gate
  type: shell
  data:
    script: |
      if [ "{{ inputs.value }}" = "true" ]; then echo "false"; else echo "true"; fi
```

This is verbose and error-prone. Built-in logic primitives would be cleaner.

---

## Proposed Primitives

### Boolean Logic

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `not` | `value: boolean` | `result: boolean` | Inverts boolean |
| `and` | `a: boolean`, `b: boolean` | `result: boolean` | Logical AND |
| `or` | `a: boolean`, `b: boolean` | `result: boolean` | Logical OR |

### Comparison

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `equals` | `a: any`, `b: any` | `result: boolean` | `a == b` |
| `not-equals` | `a: any`, `b: any` | `result: boolean` | `a != b` |
| `greater-than` | `a: number`, `b: number` | `result: boolean` | `a > b` |
| `less-than` | `a: number`, `b: number` | `result: boolean` | `a < b` |
| `greater-or-equal` | `a: number`, `b: number` | `result: boolean` | `a >= b` |
| `less-or-equal` | `a: number`, `b: number` | `result: boolean` | `a <= b` |

### Arithmetic (maybe)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `add` | `a: number`, `b: number` | `result: number` | `a + b` |
| `subtract` | `a: number`, `b: number` | `result: number` | `a - b` |
| `multiply` | `a: number`, `b: number` | `result: number` | `a * b` |
| `divide` | `a: number`, `b: number` | `result: number` | `a / b` |

### String Operations (maybe)

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `concat` | `a: string`, `b: string` | `result: string` | String concatenation |
| `contains` | `haystack: string`, `needle: string` | `result: boolean` | Substring check |
| `regex-match` | `text: string`, `pattern: string` | `result: boolean` | Regex test |

### Control Flow

| Node | Inputs | Output | Description |
|------|--------|--------|-------------|
| `switch` / `if` | `condition: boolean`, `then: any`, `else: any` | `result: any` | Conditional value |
| `coalesce` | `value: any`, `default: any` | `result: any` | First non-null value |

---

## Design Questions

### 1. Naming Convention

Options:
- **Verb-based**: `not`, `and`, `or`, `equals`, `add`
- **Symbol-based**: `!`, `&&`, `||`, `==`, `+` (probably bad for YAML)
- **Prefix**: `logic-not`, `logic-and`, `math-add` (namespaced)

Recommendation: Simple verb-based names.

### 2. Node Type vs Generic Expression Node

**Option A: Dedicated node types**
```yaml
- id: not-gate
  type: not
  data:
    nodeType: not
```

Pros: Clear, simple, easy to implement
Cons: Many node types

**Option B: Generic expression node**
```yaml
- id: expr-1
  type: expression
  data:
    expression: "NOT({{ inputs.value }})"
    # or: expression: "{{ a }} > {{ b }}"
```

Pros: Flexible, fewer node types
Cons: Need expression parser, less visual

**Option C: Hybrid - logic nodes + expression for complex cases**

Recommendation: Start with Option A (dedicated nodes) for common operations. Add expression node later if needed.

### 3. Visual Representation

How should primitives look in the designer?

```
┌─────────┐      ┌─────────┐      ┌─────────┐
│   NOT   │      │   AND   │      │   >     │
│         │      │         │      │         │
│ ○ value │      │ ○ a     │      │ ○ a     │
│         │      │ ○ b     │      │ ○ b     │
│ result ●│      │ result ●│      │ result ●│
└─────────┘      └─────────┘      └─────────┘
```

- Small, compact nodes
- Distinct styling (maybe different color/icon)
- Symbol in header for quick recognition

### 4. Multi-Input Gates

Should AND/OR support more than 2 inputs?

```
┌─────────┐
│   AND   │
│ ○ a     │
│ ○ b     │
│ ○ c     │  ← Variable number of inputs?
│ result ●│
└─────────┘
```

Options:
- Fixed 2 inputs (chain nodes for more)
- Dynamic inputs (add/remove in config)
- Array input (single input accepting boolean[])

Recommendation: Start with fixed 2 inputs. Chaining is explicit and visual.

### 5. Type Coercion

Should comparison nodes coerce types?
- `"5" == 5` → true or false?
- `"true" AND true` → error or coerce?

Recommendation: Strict types, no coercion. Match the I/O system design.

---

## Implementation Approach

### Executor

Primitives are simple - just pure functions:

```typescript
const primitiveExecutors: Record<string, (inputs: Record<string, unknown>) => Record<string, unknown>> = {
  'not': ({ value }) => ({ result: !value }),
  'and': ({ a, b }) => ({ result: a && b }),
  'or': ({ a, b }) => ({ result: a || b }),
  'equals': ({ a, b }) => ({ result: a === b }),
  'greater-than': ({ a, b }) => ({ result: a > b }),
  // ...
};
```

No async, no side effects, instant execution.

### UI

- Add to sidebar palette under "Logic" category
- Compact node rendering
- Color-coded by category (logic = purple?, math = blue?)

---

## Phasing

**Phase 1: Core boolean logic (needed for loops)**
- `not`
- `and`
- `or`

**Phase 2: Comparisons**
- `equals`, `not-equals`
- `greater-than`, `less-than`, `greater-or-equal`, `less-or-equal`

**Phase 3: Utilities (if needed)**
- `switch` / `if`
- `coalesce`
- Arithmetic and string ops

---

## Alternatives Considered

### 1. Expression Language in Templates

Instead of nodes, embed expressions in templates:
```
{{ NOT(review.approved) }}
{{ iteration < 5 AND NOT(approved) }}
```

Pros: Compact, familiar
Cons: Hidden logic, not visual, parser complexity

### 2. Script Node with Predefined Functions

A script node that imports utility functions:
```javascript
return { continue: NOT(inputs.approved) }
```

Pros: Flexible
Cons: Not visual, requires JS knowledge

### 3. Stay with Shell Workarounds

Just use shell nodes for logic.

Pros: No new code
Cons: Verbose, error-prone, ugly

---

## Recommendation

Start with **Phase 1 (core boolean)** when implementing loops. The NOT gate is immediately needed. AND/OR are natural companions.

Defer comparisons and arithmetic until we see real usage patterns that need them.
