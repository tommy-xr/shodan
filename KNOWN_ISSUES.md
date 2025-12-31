# Known Issues

## Designer - Loop Node Parenting

### Cannot Unparent Nodes by Dragging

**Location**: `packages/designer/src/App.tsx:367`

When a node is parented to a loop, it gets `extent: 'parent'` which constrains the node within its parent's bounds. This means users cannot drag nodes outside the loop container to unparent them.

The unparenting code exists (lines 374-389, Case 2: `!targetLoop && currentParentId`), but is unreachable because:
1. Node has `extent: 'parent'` → ReactFlow prevents dragging outside parent bounds
2. `findContainingLoop()` always returns the parent loop since node can't leave
3. The unparent condition is never true

**Possible fixes**:
- Remove `extent: 'parent'` to allow free dragging (may feel less polished)
- Add an "Unparent" button in the Config Panel
- Detect drag-to-edge behavior and temporarily disable extent constraint

### Unexpected Unparenting When Deleting Loop Containers

**Location**: `packages/designer/src/App.tsx:901`

There's no custom delete handler - just the default ReactFlow behavior (`deleteKeyCode={['Backspace', 'Delete']}`). When a loop is deleted, ReactFlow may automatically handle orphaned children by removing their `parentId`, causing them to suddenly become top-level nodes with incorrect relative positions.

**Possible fixes**:
- Add an `onNodesDelete` handler that converts child positions to absolute before removing parentId
- Alternatively, delete child nodes along with the parent loop
- Show a confirmation dialog when deleting loops with children

## Designer - Loop Inner Node Status

### Inner Loop Nodes Show "Pending" After Completion

**Location**: `packages/designer/src/App.tsx` (execution status updates)

When executing a workflow with loops, the nodes inside the loop container always show "pending" status even after the loop completes successfully. The loop container itself shows "completed", but child nodes (shell, agent, etc.) remain in pending state.

**Root cause**: The executor only reports status for top-level nodes in the workflow results. Inner node executions happen within the loop executor and their status updates aren't propagated back to the UI.

**Possible fixes**:
- Add `innerNodeResults` to the loop execution result that includes status for each child node
- Emit status updates via SSE/WebSocket during loop iteration
- Show iteration-specific status in a collapsible panel on the loop node
