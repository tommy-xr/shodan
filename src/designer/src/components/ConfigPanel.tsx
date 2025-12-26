import { useState } from 'react';
import type { Node } from '@xyflow/react';
import type { BaseNodeData, NodeType } from '../nodes';
import type { PortDefinition } from '@shodan/core';
import { ListEditor } from './ListEditor';
import { FilePicker } from './FilePicker';
import { PortEditor } from './PortEditor';

interface ConfigPanelProps {
  node: Node<BaseNodeData> | null;
  rootDirectory: string;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<BaseNodeData>) => void;
}

export function ConfigPanel({ node, rootDirectory, onClose, onUpdate }: ConfigPanelProps) {
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

        {nodeType === 'agent' && <AgentConfig node={node} rootDirectory={rootDirectory} onUpdate={onUpdate} />}
        {nodeType === 'shell' && <ShellConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'script' && <ScriptConfig node={node} rootDirectory={rootDirectory} onUpdate={onUpdate} />}
        {nodeType === 'trigger' && <TriggerConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'workdir' && <WorkdirConfig node={node} onUpdate={onUpdate} />}

        {/* Execution Output */}
        {node.data.executionStatus && node.data.executionStatus !== 'idle' && (
          <div className="execution-output">
            <div className={`execution-status-badge ${node.data.executionStatus}`}>
              {node.data.executionStatus === 'pending' && '⏳ Pending'}
              {node.data.executionStatus === 'running' && '▶ Running'}
              {node.data.executionStatus === 'completed' && '✓ Completed'}
              {node.data.executionStatus === 'failed' && '✗ Failed'}
            </div>
            {node.data.executionError && (
              <div className="execution-error">
                {node.data.executionError as string}
              </div>
            )}
            {node.data.executionOutput && (
              <div className="execution-output-content">
                <label>Output</label>
                <pre>{node.data.executionOutput as string}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

interface NodeConfigProps {
  node: Node<BaseNodeData>;
  onUpdate: (nodeId: string, data: Partial<BaseNodeData>) => void;
  rootDirectory?: string;
}

type Runner = 'openai' | 'claude-code' | 'codex' | 'gemini-cli';

interface ModelOption {
  value: string;
  label: string;
}

const modelsByRunner: Record<Runner, ModelOption[]> = {
  'openai': [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' },
  ],
  'claude-code': [
    { value: 'opus', label: 'Claude Opus' },
    { value: 'sonnet', label: 'Claude Sonnet' },
    { value: 'haiku', label: 'Claude Haiku' },
  ],
  'codex': [
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
  ],
  'gemini-cli': [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
};

function AgentConfig({ node, rootDirectory, onUpdate }: NodeConfigProps) {
  const runner = (node.data.runner as Runner) || '';
  const availableModels = runner ? modelsByRunner[runner] : [];

  const handleRunnerChange = (newRunner: string) => {
    // Clear model when runner changes since models are runner-specific
    onUpdate(node.id, { runner: newRunner, model: '' });
  };

  const inputs = (node.data.inputs as PortDefinition[]) || [];
  const outputs = (node.data.outputs as PortDefinition[]) || [];

  return (
    <>
      <div className="config-field">
        <label>Runner</label>
        <select
          value={runner}
          onChange={(e) => handleRunnerChange(e.target.value)}
        >
          <option value="">Select runner...</option>
          <option value="openai">OpenAI API</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex CLI</option>
          <option value="gemini-cli">Gemini CLI</option>
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
        <label>Prompt Files (relative to root)</label>
        <ListEditor
          items={(node.data.promptFiles as string[]) || []}
          onChange={(files) => onUpdate(node.id, { promptFiles: files })}
          placeholder="e.g., prompts/review.md"
          addButtonText="+ Add"
          emptyText="No files added"
          inputType="file"
          rootDirectory={rootDirectory}
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
      <PortEditor
        ports={inputs}
        direction="input"
        onChange={(newInputs) => onUpdate(node.id, { inputs: newInputs })}
      />
      <PortEditor
        ports={outputs}
        direction="output"
        onChange={(newOutputs) => onUpdate(node.id, { outputs: newOutputs })}
      />
    </>
  );
}

function ShellConfig({ node, onUpdate }: Omit<NodeConfigProps, 'rootDirectory'>) {
  // Support both new 'script' field and legacy 'commands' array
  const scriptValue = (node.data.script as string) ||
    ((node.data.commands as string[]) || []).join('\n');

  const handleScriptChange = (value: string) => {
    // Clear legacy commands when using new script field
    onUpdate(node.id, { script: value, commands: undefined });
  };

  const inputs = (node.data.inputs as PortDefinition[]) || [];
  const outputs = (node.data.outputs as PortDefinition[]) || [];

  return (
    <>
      <div className="config-field">
        <label>Inline Script</label>
        <textarea
          value={scriptValue}
          onChange={(e) => handleScriptChange(e.target.value)}
          placeholder="Enter shell commands..."
          className="script-editor"
          rows={6}
        />
      </div>
      <PortEditor
        ports={inputs}
        direction="input"
        onChange={(newInputs) => onUpdate(node.id, { inputs: newInputs })}
      />
      <PortEditor
        ports={outputs}
        direction="output"
        onChange={(newOutputs) => onUpdate(node.id, { outputs: newOutputs })}
      />
    </>
  );
}

function ScriptConfig({ node, rootDirectory, onUpdate }: NodeConfigProps) {
  const [showFilePicker, setShowFilePicker] = useState(false);
  const scriptFile = (node.data.scriptFile as string) || '';

  const getFileType = (path: string): string => {
    if (path.endsWith('.ts')) return 'TypeScript';
    if (path.endsWith('.js')) return 'JavaScript';
    if (path.endsWith('.sh')) return 'Bash';
    return 'Unknown';
  };

  const handleFileSelect = (path: string) => {
    onUpdate(node.id, { scriptFile: path });
    setShowFilePicker(false);
  };

  const inputs = (node.data.inputs as PortDefinition[]) || [];
  const outputs = (node.data.outputs as PortDefinition[]) || [];

  return (
    <>
      <div className="config-field">
        <label>Script File</label>
        <div className="file-input-group">
          <input
            type="text"
            value={scriptFile}
            onChange={(e) => onUpdate(node.id, { scriptFile: e.target.value })}
            placeholder="e.g., scripts/build.ts"
            className="monospace"
          />
          <button
            className="browse-btn"
            onClick={() => setShowFilePicker(true)}
            disabled={!rootDirectory}
          >
            Browse
          </button>
        </div>
        {scriptFile && (
          <div className="file-type-hint">
            Type: {getFileType(scriptFile)}
          </div>
        )}
      </div>
      <div className="config-field">
        <label>Arguments</label>
        <input
          type="text"
          value={(node.data.scriptArgs as string) || ''}
          onChange={(e) => onUpdate(node.id, { scriptArgs: e.target.value })}
          placeholder="e.g., --verbose --output=dist"
        />
      </div>
      <div className="config-field script-info">
        <label>Supported File Types</label>
        <ul className="file-type-list">
          <li><code>.ts</code> - TypeScript (via tsx)</li>
          <li><code>.js</code> - JavaScript (via node)</li>
          <li><code>.sh</code> - Bash script</li>
        </ul>
      </div>
      <PortEditor
        ports={inputs}
        direction="input"
        onChange={(newInputs) => onUpdate(node.id, { inputs: newInputs })}
      />
      <PortEditor
        ports={outputs}
        direction="output"
        onChange={(newOutputs) => onUpdate(node.id, { outputs: newOutputs })}
      />
      {showFilePicker && rootDirectory && (
        <FilePicker
          rootDirectory={rootDirectory}
          onSelect={handleFileSelect}
          onClose={() => setShowFilePicker(false)}
          filter="*.ts,*.js,*.sh"
        />
      )}
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
