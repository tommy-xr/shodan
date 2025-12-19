import type { Node } from '@xyflow/react';
import type { BaseNodeData, NodeType } from '../nodes';

interface ConfigPanelProps {
  node: Node<BaseNodeData> | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<BaseNodeData>) => void;
}

export function ConfigPanel({ node, onClose, onUpdate }: ConfigPanelProps) {
  if (!node) {
    return (
      <aside className="config-panel">
        <div className="no-selection">
          Select a node to configure its properties
        </div>
      </aside>
    );
  }

  const nodeType = node.data.nodeType as NodeType;

  return (
    <aside className="config-panel">
      <div className="config-panel-header">
        <h2>Configure {nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}</h2>
        <button className="config-panel-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="config-panel-content">
        <div className="config-field">
          <label>Label</label>
          <input
            type="text"
            value={(node.data.label as string) || ''}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            placeholder="Enter a name..."
          />
        </div>

        {nodeType === 'agent' && <AgentConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'shell' && <ShellConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'trigger' && <TriggerConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'workdir' && <WorkdirConfig node={node} onUpdate={onUpdate} />}
      </div>
    </aside>
  );
}

interface NodeConfigProps {
  node: Node<BaseNodeData>;
  onUpdate: (nodeId: string, data: Partial<BaseNodeData>) => void;
}

type Runner = 'claude-code' | 'codex' | 'gemini-cli' | 'aider';

interface ModelOption {
  value: string;
  label: string;
}

const modelsByRunner: Record<Runner, ModelOption[]> = {
  'claude-code': [
    { value: 'opus', label: 'Claude Opus' },
    { value: 'sonnet', label: 'Claude Sonnet' },
    { value: 'haiku', label: 'Claude Haiku' },
  ],
  'codex': [
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' },
  ],
  'gemini-cli': [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  'aider': [
    { value: 'opus', label: 'Claude Opus' },
    { value: 'sonnet', label: 'Claude Sonnet' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'o3', label: 'o3' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
};

function AgentConfig({ node, onUpdate }: NodeConfigProps) {
  const runner = (node.data.runner as Runner) || '';
  const availableModels = runner ? modelsByRunner[runner] : [];

  const handleRunnerChange = (newRunner: string) => {
    // Clear model when runner changes since models are runner-specific
    onUpdate(node.id, { runner: newRunner, model: '' });
  };

  return (
    <>
      <div className="config-field">
        <label>Runner</label>
        <select
          value={runner}
          onChange={(e) => handleRunnerChange(e.target.value)}
        >
          <option value="">Select runner...</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex CLI</option>
          <option value="gemini-cli">Gemini CLI</option>
          <option value="aider">Aider</option>
        </select>
      </div>
      <div className="config-field">
        <label>Model</label>
        <select
          value={(node.data.model as string) || ''}
          onChange={(e) => onUpdate(node.id, { model: e.target.value })}
          disabled={!runner}
        >
          <option value="">{runner ? 'Select model...' : 'Select runner first...'}</option>
          {availableModels.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </div>
      <div className="config-field">
        <label>Prompt</label>
        <textarea
          value={(node.data.prompt as string) || ''}
          onChange={(e) => onUpdate(node.id, { prompt: e.target.value })}
          placeholder="Enter your prompt template..."
        />
      </div>
      <div className="config-field">
        <label>Output Schema (JSON)</label>
        <textarea
          value={(node.data.outputSchema as string) || ''}
          onChange={(e) => onUpdate(node.id, { outputSchema: e.target.value })}
          placeholder='{"type": "object", "properties": {...}}'
          className="code-input"
        />
      </div>
    </>
  );
}

function ShellConfig({ node, onUpdate }: NodeConfigProps) {
  return (
    <>
      <div className="config-field">
        <label>Command</label>
        <input
          type="text"
          value={(node.data.command as string) || ''}
          onChange={(e) => onUpdate(node.id, { command: e.target.value })}
          placeholder="e.g., npm run build"
        />
      </div>
      <div className="config-field">
        <label>Output Variable</label>
        <input
          type="text"
          value={(node.data.outputVar as string) || ''}
          onChange={(e) => onUpdate(node.id, { outputVar: e.target.value })}
          placeholder="e.g., buildResult"
        />
      </div>
    </>
  );
}

function TriggerConfig({ node, onUpdate }: NodeConfigProps) {
  return (
    <>
      <div className="config-field">
        <label>Trigger Type</label>
        <select
          value={(node.data.triggerType as string) || ''}
          onChange={(e) => onUpdate(node.id, { triggerType: e.target.value })}
        >
          <option value="">Select trigger...</option>
          <option value="manual">Manual</option>
          <option value="periodic">Periodic (Cron)</option>
          <option value="file-watch">File Watch</option>
          <option value="pr">Pull Request</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>
      {node.data.triggerType === 'periodic' && (
        <div className="config-field">
          <label>Cron Expression</label>
          <input
            type="text"
            value={(node.data.cron as string) || ''}
            onChange={(e) => onUpdate(node.id, { cron: e.target.value })}
            placeholder="e.g., 0 * * * *"
          />
        </div>
      )}
    </>
  );
}

function WorkdirConfig({ node, onUpdate }: NodeConfigProps) {
  return (
    <div className="config-field">
      <label>Path</label>
      <input
        type="text"
        value={(node.data.path as string) || ''}
        onChange={(e) => onUpdate(node.id, { path: e.target.value })}
        placeholder="e.g., ./my-project"
      />
    </div>
  );
}
