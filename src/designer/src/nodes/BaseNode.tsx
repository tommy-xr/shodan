import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { PortDefinition } from '@shodan/core';
import './nodes.css';

export type NodeType = 'agent' | 'shell' | 'script' | 'trigger' | 'workdir';
export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  // I/O definition (persisted)
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
  // Execution options
  continueOnFailure?: boolean;
  // Agent fields
  runner?: string;
  model?: string;
  prompt?: string;
  promptFiles?: string[];
  outputSchema?: string;
  // Shell fields
  script?: string; // Inline multi-line script
  commands?: string[]; // Deprecated: for backwards compat with old workflows
  scriptFiles?: string[];
  outputVar?: string;
  // Trigger fields
  triggerType?: string;
  cron?: string;
  // Script node fields
  scriptFile?: string; // Path to .js, .ts, or .sh file
  scriptArgs?: string; // Arguments to pass to the script
  // Working directory fields
  path?: string;
  // Execution state
  executionStatus?: ExecutionStatus;
  executionOutput?: string;
  executionError?: string;
}

const nodeIcons: Record<NodeType, string> = {
  agent: '🤖',
  shell: '⌘',
  script: '📜',
  trigger: '⚡',
  workdir: '📁',
};

const nodeLabels: Record<NodeType, string> = {
  agent: 'Agent',
  shell: 'Shell',
  script: 'Script',
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

const statusIcons: Record<ExecutionStatus, string> = {
  idle: '',
  pending: '⏳',
  running: '▶',
  completed: '✓',
  failed: '✗',
};

export function BaseNode({ data, selected }: NodeProps) {
  const nodeData = data as BaseNodeData;
  const nodeType = nodeData.nodeType;
  const hasInput = nodeType !== 'trigger';
  const execStatus = nodeData.executionStatus || 'idle';

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
      case 'shell': {
        const hasScript = nodeData.script?.trim() || (nodeData.commands?.length || 0) > 0;
        const fileCount = nodeData.scriptFiles?.length || 0;
        const parts = [];
        if (hasScript) parts.push('script');
        if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
        return parts.length > 0 ? parts.join(', ') : null;
      }
      case 'script': {
        if (nodeData.scriptFile) {
          const fileName = nodeData.scriptFile.split('/').pop() || nodeData.scriptFile;
          return fileName;
        }
        return null;
      }
      case 'trigger':
        return nodeData.triggerType ? triggerLabels[nodeData.triggerType] || nodeData.triggerType : null;
      case 'workdir':
        return nodeData.path || null;
      default:
        return null;
    }
  };

  const getFilesPreview = () => {
    if (nodeType === 'agent' && nodeData.promptFiles?.length) {
      const count = nodeData.promptFiles.length;
      return `${count} file${count > 1 ? 's' : ''}`;
    }
    return null;
  };

  const filesPreview = getFilesPreview();

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
    <div className={`custom-node ${nodeType} ${selected ? 'selected' : ''} exec-${execStatus}`}>
      {hasInput && (
        <Handle type="target" position={Position.Left} className="handle" />
      )}
      <div className="node-header">
        <span className="node-icon">{nodeIcons[nodeType]}</span>
        <span className="node-type">{nodeLabels[nodeType]}</span>
        {execStatus !== 'idle' && (
          <span className={`exec-status-icon ${execStatus}`}>{statusIcons[execStatus]}</span>
        )}
      </div>
      <div className="node-body">
        <div className="node-label">{nodeData.label || 'Untitled'}</div>
        {details && <div className="node-details">{details}</div>}
        {filesPreview && (
          <div className="node-files">
            <span className="files-icon">📄</span> {filesPreview}
          </div>
        )}
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
