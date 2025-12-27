import { Handle, Position, NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { PortDefinition, ValueType } from '@shodan/core';
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
 * Renders as a resizable container frame that can hold child nodes.
 * Uses ReactFlow's sub-flow pattern where child nodes have parentId
 * referencing this loop.
 */
export function LoopContainerNode({ data, selected }: NodeProps) {
  const nodeData = data as BaseNodeData;
  const execStatus = nodeData.executionStatus || 'idle';
  const maxIterations = nodeData.maxIterations || 10;
  const currentIteration = nodeData.currentIteration;

  // Get I/O definitions from interface nodes
  const inputs = (nodeData.inputs as PortDefinition[]) || [];
  const outputs = (nodeData.outputs as PortDefinition[]) || [];

  // Calculate port positions
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

      <div className={`loop-container ${selected ? 'selected' : ''} exec-${execStatus}`}>
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

        {/* Port labels */}
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

      {/* Input handles on left side of container */}
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

      {/* Output handles on right side of container */}
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
    </>
  );
}
