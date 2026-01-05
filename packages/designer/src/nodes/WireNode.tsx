import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import './nodes.css';

export interface WireNodeData extends Record<string, unknown> {
  label?: string;
  nodeType: 'wire';
  // Execution state
  executionStatus?: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * WireNode - A minimal pass-through node for wire routing
 *
 * Displays as a small hollow square with a single connection point.
 * If a label is provided, it renders above the node.
 */
export function WireNode({ data, selected }: NodeProps) {
  const nodeData = data as WireNodeData;
  const execStatus = nodeData.executionStatus || 'idle';
  const hasLabel = nodeData.label && nodeData.label.trim().length > 0;

  return (
    <div className={`wire-node ${selected ? 'selected' : ''} exec-${execStatus}`}>
      {/* Label above the node */}
      {hasLabel && (
        <span className="wire-label">{nodeData.label}</span>
      )}

      {/* The hollow square */}
      <div className="wire-square" />

      {/* Input handle - small point on the left */}
      <Handle
        type="target"
        position={Position.Left}
        id="input:value"
        className="wire-handle-point"
        title="Input"
      />

      {/* Output handle - small point on the right */}
      <Handle
        type="source"
        position={Position.Right}
        id="output:value"
        className="wire-handle-point"
        title="Output"
      />
    </div>
  );
}
