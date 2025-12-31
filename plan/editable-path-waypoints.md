# Editable Path Waypoints

## Overview

Allow users to customize edge routing by adding and dragging waypoints (bend points) on edges. This gives manual control over how edges are routed between nodes, creating cleaner layouts for complex workflows.

## Design

### Interaction Model

```
Before (automatic step routing):
    ┌─────┐          ┌─────┐
    │  A  │●────┬────●│  B  │
    └─────┘     │     └─────┘
                │
          ┌─────┴─────┐
          │     C     │
          └───────────┘

After (user adds waypoint and drags it):
    ┌─────┐               ┌─────┐
    │  A  │●──────────────●│  B  │
    └─────┘               └─────┘
                │
                ◆ ← draggable waypoint
                │
          ┌─────┴─────┐
          │     C     │
          └───────────┘
```

### User Actions

1. **Add waypoint**: Double-click on an edge to insert a waypoint at that position
2. **Move waypoint**: Drag a waypoint to reposition it
3. **Remove waypoint**: Double-click an existing waypoint to delete it
4. **Clear all waypoints**: Right-click edge → "Reset to auto-routing"

### Visual Design

- **Waypoints**: Small diamond (◆) or circle markers, 8-10px
- **Default state**: Subtle, semi-transparent (don't clutter the view)
- **Hover state**: Highlight with glow effect matching edge color
- **Selected edge**: Show all waypoints prominently
- **Drag cursor**: `grab` / `grabbing`

### Edge Path Calculation

With waypoints, the edge path becomes a series of connected segments:

```
Source handle → Waypoint 1 → Waypoint 2 → ... → Target handle
```

Each segment uses 90-degree step routing between points.

---

## Data Model

### Edge Data Extension

```typescript
// packages/core/src/workflow-types.ts
interface EdgeWaypoint {
  id: string;
  x: number;  // absolute canvas position
  y: number;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  waypoints?: EdgeWaypoint[];  // NEW: ordered list of waypoints
}
```

### Persistence

Waypoints are stored in the edge data and persisted to:
- localStorage (designer state)
- YAML workflow files (edges section)

```yaml
edges:
  - id: e1
    source: nodeA
    target: nodeB
    sourceHandle: "output:result"
    targetHandle: "input:data"
    waypoints:
      - id: wp1
        x: 450
        y: 200
      - id: wp2
        x: 450
        y: 350
```

---

## Implementation

### 1. Custom Edge Component

**`packages/designer/src/edges/EditableStepEdge.tsx`**

```typescript
import { BaseEdge, EdgeProps, getSmoothStepPath } from '@xyflow/react';

interface EdgeWaypoint {
  id: string;
  x: number;
  y: number;
}

interface EditableEdgeData {
  waypoints?: EdgeWaypoint[];
}

export function EditableStepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<EditableEdgeData>) {
  const waypoints = data?.waypoints || [];

  if (waypoints.length === 0) {
    // No waypoints: use standard step path
    const [path] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition,
      targetX, targetY, targetPosition,
    });
    return <BaseEdge id={id} path={path} />;
  }

  // Build path through waypoints
  const pathSegments = buildWaypointPath(
    { x: sourceX, y: sourceY },
    waypoints,
    { x: targetX, y: targetY }
  );

  return (
    <>
      <BaseEdge id={id} path={pathSegments.path} />
      {selected && waypoints.map((wp) => (
        <WaypointHandle
          key={wp.id}
          waypoint={wp}
          edgeId={id}
        />
      ))}
    </>
  );
}

function buildWaypointPath(
  source: { x: number; y: number },
  waypoints: EdgeWaypoint[],
  target: { x: number; y: number }
): { path: string } {
  // Build SVG path with 90-degree segments through each waypoint
  const points = [source, ...waypoints, target];
  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    // Step routing: horizontal then vertical
    d += ` L ${curr.x} ${prev.y}`;
    d += ` L ${curr.x} ${curr.y}`;
  }

  return { path: d };
}
```

### 2. Waypoint Handle Component

**`packages/designer/src/edges/WaypointHandle.tsx`**

```typescript
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

interface WaypointHandleProps {
  waypoint: EdgeWaypoint;
  edgeId: string;
}

export function WaypointHandle({ waypoint, edgeId }: WaypointHandleProps) {
  const { setEdges } = useReactFlow();

  const onDrag = useCallback((event: React.MouseEvent) => {
    // Convert screen coords to canvas coords
    // Update waypoint position in edge data
  }, [edgeId, waypoint.id, setEdges]);

  const onDoubleClick = useCallback(() => {
    // Remove this waypoint
    setEdges((edges) =>
      edges.map((e) => {
        if (e.id !== edgeId) return e;
        return {
          ...e,
          data: {
            ...e.data,
            waypoints: e.data?.waypoints?.filter((wp) => wp.id !== waypoint.id),
          },
        };
      })
    );
  }, [edgeId, waypoint.id, setEdges]);

  return (
    <div
      className="waypoint-handle"
      style={{
        position: 'absolute',
        left: waypoint.x - 5,
        top: waypoint.y - 5,
        width: 10,
        height: 10,
        transform: 'rotate(45deg)',
        cursor: 'grab',
      }}
      onMouseDown={onDrag}
      onDoubleClick={onDoubleClick}
    />
  );
}
```

### 3. Register Custom Edge Type

**`packages/designer/src/edges/index.ts`**

```typescript
import { EditableStepEdge } from './EditableStepEdge';

export const edgeTypes = {
  editableStep: EditableStepEdge,
};
```

**`packages/designer/src/App.tsx`**

```typescript
import { edgeTypes } from './edges';

// In ReactFlow component:
<ReactFlow
  edgeTypes={edgeTypes}
  defaultEdgeOptions={{ type: 'editableStep' }}
  // ...
/>
```

### 4. Add Waypoint on Edge Double-Click

**`packages/designer/src/App.tsx`**

```typescript
const onEdgeDoubleClick = useCallback(
  (event: React.MouseEvent, edge: Edge) => {
    // Get click position in canvas coordinates
    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    // Add waypoint to edge
    setEdges((edges) =>
      edges.map((e) => {
        if (e.id !== edge.id) return e;
        const waypoints = e.data?.waypoints || [];
        return {
          ...e,
          data: {
            ...e.data,
            waypoints: [
              ...waypoints,
              { id: `wp-${Date.now()}`, x: position.x, y: position.y },
            ],
          },
        };
      })
    );
  },
  [setEdges, screenToFlowPosition]
);

// Add to ReactFlow:
<ReactFlow
  onEdgeDoubleClick={onEdgeDoubleClick}
  // ...
/>
```

### 5. Dragging Logic

The waypoint drag implementation needs to:
1. Track mouse movement relative to canvas
2. Update waypoint position in real-time
3. Handle drag start/end for cursor changes
4. Optionally snap to grid

```typescript
// In WaypointHandle or as a custom hook
const useDragWaypoint = (edgeId: string, waypointId: string) => {
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const pos = screenToFlowPosition({
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });

      setEdges((edges) =>
        edges.map((edge) => {
          if (edge.id !== edgeId) return edge;
          return {
            ...edge,
            data: {
              ...edge.data,
              waypoints: edge.data?.waypoints?.map((wp) =>
                wp.id === waypointId ? { ...wp, x: pos.x, y: pos.y } : wp
              ),
            },
          };
        })
      );
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [edgeId, waypointId, setEdges, screenToFlowPosition]);

  return { onMouseDown, isDragging };
};
```

### 6. Styling

**`packages/designer/src/edges/edges.css`**

```css
.waypoint-handle {
  background: var(--text-secondary);
  border: 2px solid var(--bg-primary);
  border-radius: 2px;
  opacity: 0.7;
  transition: all 0.15s ease;
  pointer-events: all;
}

.waypoint-handle:hover {
  opacity: 1;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
  transform: rotate(45deg) scale(1.2);
}

.waypoint-handle.dragging {
  cursor: grabbing;
  background: var(--accent);
}

/* Show waypoints on edge selection */
.react-flow__edge.selected .waypoint-handle {
  opacity: 1;
}
```

### 7. Context Menu for Edge Reset

Add right-click menu option to clear all waypoints:

```typescript
const onEdgeContextMenu = useCallback(
  (event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    // Show context menu with "Reset to auto-routing" option
    // On click: remove all waypoints from edge
  },
  []
);
```

---

## Edge Cases & Considerations

### Waypoint Ordering

When adding a new waypoint, insert it in the correct position along the path:
- Calculate which segment the click was closest to
- Insert waypoint between those two points
- Simple approach: append to end and let user drag into position

### Node Movement

When nodes move, waypoints stay fixed (absolute positions). This is intentional - waypoints represent user-defined routing that shouldn't auto-adjust.

Alternative: Store waypoints as relative offsets from source/target. More complex but keeps routing when nodes move.

### Performance

For workflows with many edges:
- Only render waypoint handles for selected edge
- Use CSS `pointer-events: none` on non-selected edges
- Debounce position updates during drag

### Undo/Redo

Waypoint changes should integrate with any undo/redo system:
- Adding waypoint
- Moving waypoint
- Removing waypoint
- Resetting edge

---

## Testing

### Manual Tests

1. **Add waypoint**: Double-click edge → waypoint appears at click position
2. **Drag waypoint**: Click and drag → waypoint follows cursor, edge re-routes
3. **Remove waypoint**: Double-click waypoint → waypoint removed, edge re-routes
4. **Multiple waypoints**: Add 3+ waypoints → edge routes through all in order
5. **Persistence**: Refresh page → waypoints preserved
6. **YAML export**: Save workflow → waypoints in YAML file
7. **YAML import**: Load workflow with waypoints → displayed correctly

### Edge Cases

1. Waypoint at same position as node handle
2. Waypoints creating overlapping path segments
3. Deleting a node removes connected edge waypoints
4. Copy/paste edge preserves waypoints

---

## Future Enhancements

- **Snap to grid**: Option to snap waypoints to canvas grid
- **Smart insertion**: Insert waypoint in correct path order based on click position
- **Relative positioning**: Store waypoints relative to nodes for auto-adjustment
- **Waypoint alignment tools**: Align multiple waypoints horizontally/vertically
- **Edge bundling**: Group parallel edges with shared waypoints
