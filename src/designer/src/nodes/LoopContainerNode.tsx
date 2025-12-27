import { Handle, Position, NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { PortDefinition, ValueType, DockSlot } from '@shodan/core';
import type { BaseNodeData } from './BaseNode';
import './nodes.css';

// Color mapping for port types
const typeColors: Record<ValueType, string> = {
  string: '#60a5fa',    // blue
  number: '#a78bfa',    // purple
  boolean: '#f472b6',   // pink
  json: '#34d399',      // green
  file: '#fbbf24',      // orange
  files: '#fb923c',     // dark orange
  any: '#9ca3af',       // gray
};

/**
 * Loop Container Node
 *
 * Renders as a resizable container frame with:
 * - Header bar with loop icon, label, and max iterations
 * - Content area for child nodes
 * - Dock bar at bottom with iteration control slots
 *
 * Uses ReactFlow's sub-flow pattern where child nodes have parentId
 * referencing this loop.
 */
export function LoopContainerNode({ data, selected }: NodeProps) {
  const nodeData = data as BaseNodeData;
  const execStatus = nodeData.executionStatus || 'idle';
  const maxIterations = nodeData.maxIterations || 10;
  const currentIteration = nodeData.currentIteration;
  const isDropTarget = nodeData.isDropTarget || false;

  // Get I/O definitions for external ports
  const inputs = (nodeData.inputs as PortDefinition[]) || [];
  const outputs = (nodeData.outputs as PortDefinition[]) || [];

  // Get dock slots
  const dockSlots = (nodeData.dockSlots as DockSlot[]) || [];

  // Layout constants
  const headerHeight = 40;
  const portHeight = 24;
  const portStartOffset = headerHeight + 20;

  // Iteration display
  const getIterationDisplay = () => {
    if (execStatus === 'running' && currentIteration) {
      return `Iteration ${currentIteration}/${maxIterations}`;
    }
    return null;
  };

  const iterationDisplay = getIterationDisplay();

  // Render a dock slot with its handle(s)
  const renderDockSlot = (slot: DockSlot) => {
    const slotWidth = slot.type === 'feedback' ? 140 : 90;

    return (
      <div
        key={slot.name}
        className={`dock-slot dock-slot-${slot.type}`}
        style={{ width: slotWidth, position: 'relative' }}
      >
        {/* Handle positioned at top-center of slot */}
        {(slot.type === 'iteration' || slot.type === 'feedback') && (
          <Handle
            type="source"
            position={Position.Top}
            id={getDockHandleId(slot, 'prev')}
            className="handle dock-handle"
            style={{
              position: 'absolute',
              left: slot.type === 'feedback' ? '25%' : '50%',
              top: '-5px',
              transform: 'translateX(-50%)',
              backgroundColor: typeColors[slot.valueType],
              borderColor: typeColors[slot.valueType],
            }}
            title={slot.type === 'iteration' ? 'Iteration number' : `${slot.label || slot.name} (previous value)`}
          />
        )}
        {(slot.type === 'continue' || slot.type === 'feedback') && (
          <Handle
            type="target"
            position={Position.Top}
            id={getDockHandleId(slot, 'current')}
            className="handle dock-handle"
            style={{
              position: 'absolute',
              left: slot.type === 'feedback' ? '75%' : '50%',
              top: '-5px',
              transform: 'translateX(-50%)',
              backgroundColor: typeColors[slot.valueType],
              borderColor: typeColors[slot.valueType],
            }}
            title={slot.type === 'continue' ? 'Continue looping (boolean)' : `${slot.label || slot.name} (current value)`}
          />
        )}
        <div className="dock-slot-label">{slot.label || slot.name}</div>
      </div>
    );
  };

  // Generate handle ID for dock slot
  const getDockHandleId = (slot: DockSlot, portType: 'prev' | 'current' | 'output' | 'input') => {
    if (slot.type === 'iteration') {
      return `dock:${slot.name}:output`;
    } else if (slot.type === 'continue') {
      return `dock:${slot.name}:input`;
    } else {
      // feedback slot
      return `dock:${slot.name}:${portType}`;
    }
  };

  return (
    <>
      {/* Node Resizer - allows resizing the container */}
      <NodeResizer
        minWidth={400}
        minHeight={300}
        isVisible={selected}
        lineClassName="loop-resizer-line"
        handleClassName="loop-resizer-handle"
      />

      <div className={`loop-container ${selected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''} exec-${execStatus}`}>
        {/* Header bar */}
        <div className="loop-header">
          <div className="loop-header-left">
            <span className="loop-icon">🔁</span>
            <span className="loop-label">{nodeData.label || 'Loop'}</span>
          </div>
          <div className="loop-header-right">
            {iterationDisplay ? (
              <span className="loop-iteration-badge running">
                {iterationDisplay}
              </span>
            ) : (
              <span className="loop-max-badge">
                max: {maxIterations}
              </span>
            )}
            {execStatus !== 'idle' && (
              <span className={`loop-status-icon ${execStatus}`}>
                {execStatus === 'running' && '▶'}
                {execStatus === 'completed' && '✓'}
                {execStatus === 'failed' && '✗'}
                {execStatus === 'pending' && '⏳'}
              </span>
            )}
          </div>
        </div>

        {/* Content area - child nodes render here via ReactFlow */}
        <div className="loop-content">
          {/* This area is where child nodes with parentId will be rendered */}
          {/* ReactFlow handles the rendering automatically */}
        </div>

        {/* Dock bar - iteration control slots */}
        <div className="loop-dock">
          <div className="loop-dock-slots">
            {dockSlots.map((slot) => renderDockSlot(slot))}
          </div>
        </div>

        {/* Status bar */}
        {iterationDisplay && (
          <div className="loop-status-bar">
            {iterationDisplay}
          </div>
        )}

        {/* Port labels for external I/O */}
        {inputs.map((input, index) => {
          const topOffset = portStartOffset + (index * portHeight);
          return (
            <div
              key={`input-label-${input.name}`}
              className="loop-port-label loop-port-label-input"
              style={{ top: `${topOffset}px` }}
            >
              {input.label || input.name}
            </div>
          );
        })}

        {outputs.map((output, index) => {
          const topOffset = portStartOffset + (index * portHeight);
          return (
            <div
              key={`output-label-${output.name}`}
              className="loop-port-label loop-port-label-output"
              style={{ top: `${topOffset}px` }}
            >
              {output.label || output.name}
            </div>
          );
        })}
      </div>

      {/* External input handles on left side of container (for incoming edges) */}
      {inputs.map((input, index) => {
        const topOffset = portStartOffset + (index * portHeight);
        return (
          <Handle
            key={`input-${input.name}`}
            type="target"
            position={Position.Left}
            id={`input:${input.name}`}
            className="handle"
            style={{
              top: `${topOffset}px`,
              backgroundColor: typeColors[input.type],
              borderColor: typeColors[input.type],
            }}
            title={input.description || input.label || input.name}
          />
        );
      })}

      {/* Internal input handles (source) - to pass loop inputs to child nodes */}
      {inputs.map((input, index) => {
        const topOffset = portStartOffset + (index * portHeight);
        return (
          <Handle
            key={`input-internal-${input.name}`}
            type="source"
            position={Position.Left}
            id={`input:${input.name}:internal`}
            className="handle handle-internal"
            style={{
              top: `${topOffset}px`,
              left: '20px',
              backgroundColor: typeColors[input.type],
              borderColor: typeColors[input.type],
            }}
            title={`Pass ${input.label || input.name} to child nodes`}
          />
        );
      })}

      {/* External output handles on right side of container (for outgoing edges) */}
      {outputs.map((output, index) => {
        const topOffset = portStartOffset + (index * portHeight);
        return (
          <Handle
            key={`output-${output.name}`}
            type="source"
            position={Position.Right}
            id={`output:${output.name}`}
            className="handle"
            style={{
              top: `${topOffset}px`,
              backgroundColor: typeColors[output.type],
              borderColor: typeColors[output.type],
            }}
            title={output.description || output.label || output.name}
          />
        );
      })}

      {/* Internal output handles (target) - to collect results from child nodes */}
      {outputs.map((output, index) => {
        const topOffset = portStartOffset + (index * portHeight);
        return (
          <Handle
            key={`output-internal-${output.name}`}
            type="target"
            position={Position.Right}
            id={`output:${output.name}:internal`}
            className="handle handle-internal"
            style={{
              top: `${topOffset}px`,
              right: '20px',
              backgroundColor: typeColors[output.type],
              borderColor: typeColors[output.type],
            }}
            title={`Collect ${output.label || output.name} from child nodes (fires after loop)`}
          />
        );
      })}

    </>
  );
}
