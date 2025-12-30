import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ValueType } from '@shodan/core';
import './nodes.css';

export type ConstantValueType = 'boolean' | 'number' | 'string';
export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

// Color mapping for port types (same as BaseNode)
const typeColors: Record<ValueType, string> = {
  string: '#60a5fa',    // blue
  number: '#a78bfa',    // purple
  boolean: '#f472b6',   // pink
  json: '#34d399',      // green
  file: '#fbbf24',      // orange
  files: '#fb923c',     // dark orange
  any: '#9ca3af',       // gray
};

export interface ConstantNodeData extends Record<string, unknown> {
  label?: string;
  nodeType: 'constant';
  valueType: ConstantValueType;
  value: boolean | number | string;
  executionStatus?: ExecutionStatus;
}

/**
 * Format the value for display
 */
function formatValue(value: boolean | number | string, valueType: ConstantValueType): string {
  if (valueType === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (valueType === 'number') {
    return String(value);
  }
  // String - truncate if too long and add quotes
  const str = String(value);
  if (str.length > 20) {
    return `"${str.slice(0, 17)}..."`;
  }
  return `"${str}"`;
}

export function ConstantNode({ data, selected }: NodeProps) {
  const nodeData = data as ConstantNodeData;
  const { valueType = 'string', value = '', executionStatus = 'idle' } = nodeData;

  const displayValue = formatValue(value, valueType);
  const handleColor = typeColors[valueType as ValueType] || typeColors.any;

  return (
    <div className={`constant-node ${selected ? 'selected' : ''} exec-${executionStatus}`}>
      <div className="constant-value" title={String(value)}>
        {displayValue}
      </div>

      {/* Label underneath if provided */}
      {nodeData.label && (
        <div className="constant-label">{nodeData.label}</div>
      )}

      {/* Single output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output:value"
        className="handle"
        style={{
          backgroundColor: handleColor,
          borderColor: handleColor,
        }}
        title={`value (${valueType})`}
      />
    </div>
  );
}
