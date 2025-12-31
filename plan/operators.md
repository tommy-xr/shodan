# Logic Operators

## Overview

Dedicated logic operator nodes (`not`, `and`, `or`, etc.) that appear in the sidebar as distinct primitives. These are "sealed" function nodes with hard-coded inline code and fixed inputs/outputs (not user-editable).

## Status

**Infrastructure complete** - function node execution works.

**Remaining work**:
- [ ] Add `not`, `and`, `or` to sidebar under "Logic" category
- [ ] Pre-configured inline code and I/O defaults
- [ ] Consider compact visual styling (smaller nodes, symbols like `¬`, `∧`, `∨`)

## Implementation Approach

Operators are just function nodes with pre-configured defaults. Users can still edit them if needed.

### Example: AND operator

```yaml
type: function
data:
  nodeType: function
  label: AND
  code: "return { result: inputs.a && inputs.b }"
  inputs:
    - name: a
      type: boolean
    - name: b
      type: boolean
  outputs:
    - name: result
      type: boolean
```

### Sidebar entries

Add to `packages/designer/src/components/Sidebar.tsx`:

```typescript
const logicItems = [
  { type: 'function', label: 'Function', icon: 'ƒ' },
  // Pre-configured operators:
  { type: 'function', label: 'NOT', icon: '¬', preset: 'not' },
  { type: 'function', label: 'AND', icon: '∧', preset: 'and' },
  { type: 'function', label: 'OR', icon: '∨', preset: 'or' },
];
```

### Operator presets

```typescript
const operatorPresets = {
  not: {
    label: 'NOT',
    code: 'return { result: !inputs.value }',
    inputs: [{ name: 'value', type: 'boolean' }],
    outputs: [{ name: 'result', type: 'boolean' }],
  },
  and: {
    label: 'AND',
    code: 'return { result: inputs.a && inputs.b }',
    inputs: [{ name: 'a', type: 'boolean' }, { name: 'b', type: 'boolean' }],
    outputs: [{ name: 'result', type: 'boolean' }],
  },
  or: {
    label: 'OR',
    code: 'return { result: inputs.a || inputs.b }',
    inputs: [{ name: 'a', type: 'boolean' }, { name: 'b', type: 'boolean' }],
    outputs: [{ name: 'result', type: 'boolean' }],
  },
};

## Future phases

- **Comparisons**: `equals`, `not-equals`, `>`, `<`, `>=`, `<=`
- **Utilities**: `switch`/`if`, `coalesce`
- **Arithmetic**: `add`, `subtract`, `multiply`, `divide`
- **String**: `concat`, `contains`, `regex-match`
