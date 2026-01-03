# Array Input/Output Ports

## Motivation

Several use cases require connecting multiple values to a single logical input:
- **CONCAT**: Combine N strings with a separator
- **AND/OR**: Logical operations on N boolean values (currently limited to 2)
- **FIRST/RACE**: Return whichever value arrives first
- **MERGE**: Combine multiple objects into one

## Design Questions

### 1. How do multiple wires connect to an array port?

**Option A: Single port, multiple connections**
- One visible port that accepts multiple incoming edges
- Visual: Wires stack/fan into the same handle
- Pros: Clean, minimal UI
- Cons: Hard to see how many connections exist; reordering is unclear

**Option B: Dynamic port expansion**
- Port shows `a`, and when connected, a new `b` appears, then `c`, etc.
- Visual: Ports grow as connections are made
- Pros: Clear visual of each connection; easy to reorder
- Cons: Node size grows; more complex implementation

**Option C: Explicit "Add Input" button**
- User manually adds ports via ConfigPanel or node UI
- Ports have fixed names: `items[0]`, `items[1]`, etc.
- Pros: User controls exactly how many inputs
- Cons: Extra step; less discoverable

### 2. How is order determined?

For CONCAT, order matters. Options:
- **Alphabetical by port name**: `a`, `b`, `c` → predictable but inflexible
- **Connection order**: First wire connected = first in array
- **Explicit index**: Port names include index (`items[0]`, `items[1]`)
- **Visual position**: Top-to-bottom on the node

### 3. What happens when array output → array input?

If a node outputs `string[]` and connects to an array input:
- **Flatten**: Each element becomes a separate input (array spreads)
- **Nest**: The entire array becomes one element
- **Type match**: Only allow if types are compatible

### 4. Type system implications

Current port types: `string`, `number`, `boolean`, `json`, `any`

Options for array types:
- **New types**: `string[]`, `number[]`, `boolean[]`, etc.
- **Modifier**: `{ type: 'string', array: true }`
- **Generic**: `array` type that accepts any element type

### 5. Execution implications

How does the executor collect array inputs?
- Wait for all connected inputs before executing?
- Execute as values arrive (streaming)?
- Require minimum count before proceeding?

## Proposed Approach (Draft)

### Phase 1: Dynamic Port Expansion (Option B)

For array input ports:
1. Define port with `array: true` modifier: `{ name: 'values', type: 'string', array: true }`
2. Initially show one port: `values[0]`
3. When connected, add `values[1]`, and so on
4. Disconnecting removes empty trailing ports
5. Order is by index (visual top-to-bottom)

### Phase 2: Array Output Support

1. Nodes can output arrays: `{ name: 'items', type: 'string', array: true }`
2. When array output → single input: pass entire array as value
3. When array output → array input: user chooses flatten vs nest

### Example: N-ary AND

```yaml
- id: and-op
  type: function
  data:
    label: AND
    code: "return { result: inputs.values.every(v => v) }"
    inputs:
      - name: values
        type: boolean
        array: true
    outputs:
      - name: result
        type: boolean
```

### Example: CONCAT

```yaml
- id: concat
  type: function
  data:
    label: CONCAT
    code: "return { result: inputs.values.join(inputs.separator || '') }"
    inputs:
      - name: values
        type: string
        array: true
      - name: separator
        type: string
    outputs:
      - name: result
        type: string
```

## Visual Design Considerations

- Array ports could have a distinct visual indicator (e.g., `[●]` instead of `●`)
- Show count badge when multiple connections exist
- Allow drag-to-reorder within the port group

## Implementation Scope

### Designer Changes
- `BaseNode.tsx`: Render dynamic ports for array inputs
- `App.tsx`: Handle edge creation that triggers new port addition
- Port rendering: Visual distinction for array ports

### Core Changes
- `io-types.ts`: Add `array?: boolean` to PortDefinition
- `validation.ts`: Validate array port connections

### Executor Changes
- `executor.ts`: Collect all values for array inputs before execution
- Handle array coercion and flattening

## Open Questions

1. Should array ports be limited to certain node types?
2. Maximum number of array elements?
3. How to handle sparse arrays (disconnected middle ports)?
4. Should we support array outputs that dynamically size based on input?

## Related Work

- ReactFlow doesn't have built-in array handle support
- Similar patterns in Unreal Blueprints ("Add pin" on certain nodes)
- Node-RED uses a single port with multiple connections
