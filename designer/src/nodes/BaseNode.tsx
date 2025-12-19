import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import './nodes.css';

export type NodeType = 'agent' | 'shell' | 'trigger' | 'workdir';

export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  runner?: string;
  model?: string;
  command?: string;
  triggerType?: string;
  path?: string;
  outputSchema?: string;
}

const nodeIcons: Record<NodeType, string> = {
  agent: '🤖',
  shell: '⌘',
  trigger: '⚡',
  workdir: '📁',
};

const nodeLabels: Record<NodeType, string> = {
  agent: 'Agent',
  shell: 'Shell',
  trigger: 'Trigger',
  workdir: 'Working Dir',
};

const runnerLabels: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'gemini-cli': 'Gemini',
  'aider': 'Aider',
};

const triggerLabels: Record<string, string> = {
  'manual': 'Manual',
  'periodic': 'Cron',
  'file-watch': 'File Watch',
  'pr': 'Pull Request',
  'webhook': 'Webhook',
};

export function BaseNode({ data, selected }: NodeProps) {
  const nodeData = data as BaseNodeData;
  const nodeType = nodeData.nodeType;
  const hasInput = nodeType !== 'trigger';

  const getNodeDetails = () => {
    switch (nodeType) {
      case 'agent':
        if (nodeData.runner && nodeData.model) {
          return `${runnerLabels[nodeData.runner] || nodeData.runner} · ${nodeData.model}`;
        }
        if (nodeData.runner) {
          return runnerLabels[nodeData.runner] || nodeData.runner;
        }
        return null;
      case 'shell':
        return nodeData.command || null;
      case 'trigger':
        return nodeData.triggerType ? triggerLabels[nodeData.triggerType] || nodeData.triggerType : null;
      case 'workdir':
        return nodeData.path || null;
      default:
        return null;
    }
  };

  const getOutputSchemaPreview = () => {
    if (nodeType !== 'agent' || !nodeData.outputSchema) return null;
    try {
      const schema = JSON.parse(nodeData.outputSchema);
      if (schema.properties) {
        const keys = Object.keys(schema.properties);
        if (keys.length > 0) {
          return keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '');
        }
      }
      return 'schema defined';
    } catch {
      return 'invalid schema';
    }
  };

  const details = getNodeDetails();
  const schemaPreview = getOutputSchemaPreview();

  return (
    <div className={`custom-node ${nodeType} ${selected ? 'selected' : ''}`}>
      {hasInput && (
        <Handle type="target" position={Position.Left} className="handle" />
      )}
      <div className="node-header">
        <span className="node-icon">{nodeIcons[nodeType]}</span>
        <span className="node-type">{nodeLabels[nodeType]}</span>
      </div>
      <div className="node-body">
        <div className="node-label">{nodeData.label || 'Untitled'}</div>
        {details && <div className="node-details">{details}</div>}
        {schemaPreview && (
          <div className="node-schema">
            <span className="schema-icon">{ }</span> {schemaPreview}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}
