import type { Node } from '@xyflow/react';
import type { BaseNodeData, NodeType } from '../nodes';
import type { PortDefinition, ValueType } from '@robomesh/core';
import { ListEditor } from './ListEditor';
import { PortEditor } from './PortEditor';

interface ConfigPanelProps {
  node: Node<BaseNodeData> | null;
  rootDirectory: string;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<BaseNodeData>) => void;
}

function formatNodeType(type: NodeType): string {
  const labels: Record<string, string> = {
    'agent': 'Agent',
    'shell': 'Shell',
    'trigger': 'Trigger',
    'workdir': 'Working Dir',
    'component': 'Component',
    'interface-input': 'Interface Input',
    'interface-output': 'Interface Output',
    'interface-continue': 'Interface Continue',
    'loop': 'Loop',
    'constant': 'Constant',
  };
  return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
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
        <h2>Configure {formatNodeType(nodeType)}</h2>
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
        {nodeType === 'trigger' && <TriggerConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'workdir' && <WorkdirConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'component' && <ComponentConfig node={node} />}
        {nodeType === 'loop' && <LoopConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'constant' && <ConstantConfig node={node} onUpdate={onUpdate} />}
        {nodeType === 'function' && <FunctionConfig node={node} onUpdate={onUpdate} />}
        {(nodeType === 'interface-input' || nodeType === 'interface-output' || nodeType === 'interface-continue') && <InterfaceConfig node={node} onUpdate={onUpdate} />}

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
              <div className={`execution-output-content ${node.data.executionStatus === 'running' ? 'streaming' : ''}`}>
                <label>Output {node.data.executionStatus === 'running' && <span className="streaming-indicator">(streaming...)</span>}</label>
                <pre>
                  {node.data.executionOutput as string}
                  {node.data.executionStatus === 'running' && <span className="output-cursor">▌</span>}
                </pre>
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

function TriggerConfig({ node, onUpdate }: NodeConfigProps) {
  return (
    <>
      <div className="config-field">
        <label>Trigger Type</label>
        <select
          value={(node.data.triggerType as string) || 'manual'}
          onChange={(e) => onUpdate(node.id, { triggerType: e.target.value })}
        >
          <option value="manual">Manual</option>
          <option value="cron">Cron (Scheduled)</option>
          <option value="idle">Idle (When Nothing Running)</option>
        </select>
      </div>
      {node.data.triggerType === 'cron' && (
        <div className="config-field">
          <label>Cron Expression</label>
          <input
            type="text"
            value={(node.data.cron as string) || ''}
            onChange={(e) => onUpdate(node.id, { cron: e.target.value })}
            placeholder="e.g., 0 0 9 * * * (9am daily)"
          />
        </div>
      )}
      {node.data.triggerType === 'idle' && (
        <div className="config-field">
          <label>Idle Minutes</label>
          <input
            type="number"
            min="1"
            value={(node.data.idleMinutes as number) || 5}
            onChange={(e) => onUpdate(node.id, { idleMinutes: parseInt(e.target.value, 10) || 5 })}
            placeholder="Minutes idle before triggering"
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

function ComponentConfig({ node }: Omit<NodeConfigProps, 'rootDirectory' | 'onUpdate'>) {
  const workflowPath = (node.data.workflowPath as string) || '';
  const componentRef = (node.data.componentRef as string) || '';
  const inputs = (node.data.inputs as PortDefinition[]) || [];
  const outputs = (node.data.outputs as PortDefinition[]) || [];

  // Determine source type
  const isInline = !!componentRef;
  const isFileBased = !!workflowPath;

  return (
    <>
      <div className="config-field">
        <label>Source</label>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '4px',
          fontSize: '0.85rem',
        }}>
          {isInline && (
            <>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#60a5fa',
              }} />
              <span>Inline</span>
              <code style={{
                marginLeft: 'auto',
                opacity: 0.7,
                fontSize: '0.8rem',
              }}>{componentRef}</code>
            </>
          )}
          {isFileBased && (
            <>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#34d399',
              }} />
              <span>File</span>
              <code style={{
                marginLeft: 'auto',
                opacity: 0.7,
                fontSize: '0.8rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '200px',
              }}>{workflowPath}</code>
            </>
          )}
          {!isInline && !isFileBased && (
            <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Unknown source</span>
          )}
        </div>
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          marginTop: '4px',
        }}>
          {isInline && 'Defined within this workflow'}
          {isFileBased && 'Loaded from external file'}
        </div>
      </div>
      <div className="config-field">
        <label>Interface (read-only)</label>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: '8px' }}>
            <strong>Inputs:</strong>
            {inputs.length === 0 && <span style={{ fontStyle: 'italic' }}> none</span>}
            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
              {inputs.map((input) => (
                <li key={input.name}>
                  <code style={{ color: 'var(--text-primary)' }}>{input.name}</code>
                  <span style={{ marginLeft: '8px', opacity: 0.7 }}>({input.type})</span>
                  {input.required && <span style={{ marginLeft: '4px', color: '#f87171' }}>*</span>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Outputs:</strong>
            {outputs.length === 0 && <span style={{ fontStyle: 'italic' }}> none</span>}
            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
              {outputs.map((output) => (
                <li key={output.name}>
                  <code style={{ color: 'var(--text-primary)' }}>{output.name}</code>
                  <span style={{ marginLeft: '8px', opacity: 0.7 }}>({output.type})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="config-field">
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          Tip: Double-click the node to edit the component's internal workflow
        </div>
      </div>
    </>
  );
}

function LoopConfig({ node, onUpdate }: Omit<NodeConfigProps, 'rootDirectory'>) {
  const maxIterations = (node.data.maxIterations as number) || 10;
  const inputs = (node.data.inputs as PortDefinition[]) || [];
  const outputs = (node.data.outputs as PortDefinition[]) || [];

  return (
    <>
      <div className="config-field">
        <label>Max Iterations</label>
        <input
          type="number"
          value={maxIterations}
          onChange={(e) => onUpdate(node.id, { maxIterations: parseInt(e.target.value, 10) || 10 })}
          min={1}
          max={100}
        />
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Safety limit to prevent infinite loops
        </div>
      </div>

      <div className="config-field">
        <label>Inner Workflow</label>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '8px 0' }}>
          Drag nodes into this loop container. Use the dock slots at the bottom:
          <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
            <li><strong>Iteration</strong> - outputs current iteration number (1, 2, 3...)</li>
            <li><strong>Continue</strong> - connect a boolean to control looping</li>
            <li><strong>Feedback</strong> - pass values between iterations (prev/current)</li>
          </ul>
        </div>
      </div>

      <div className="config-field">
        <label>External I/O</label>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: '8px' }}>
            <strong>Inputs:</strong>
            {inputs.length === 0 && <span style={{ fontStyle: 'italic' }}> none defined</span>}
            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
              {inputs.map((input) => (
                <li key={input.name}>
                  <code style={{ color: 'var(--text-primary)' }}>{input.name}</code>
                  <span style={{ marginLeft: '8px', opacity: 0.7 }}>({input.type})</span>
                  {input.required && <span style={{ marginLeft: '4px', color: '#f87171' }}>*</span>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Outputs:</strong>
            {outputs.length === 0 && <span style={{ fontStyle: 'italic' }}> none defined</span>}
            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
              {outputs.map((output) => (
                <li key={output.name}>
                  <code style={{ color: 'var(--text-primary)' }}>{output.name}</code>
                  <span style={{ marginLeft: '8px', opacity: 0.7 }}>({output.type})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function InterfaceConfig({ node, onUpdate }: Omit<NodeConfigProps, 'rootDirectory'>) {
  const nodeType = node.data.nodeType as string;
  const isInput = nodeType === 'interface-input';
  const isContinue = nodeType === 'interface-continue';

  // For continue nodes, show read-only info
  if (isContinue) {
    return (
      <div className="config-field">
        <label>Interface Type</label>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '8px 0' }}>
          This node controls loop iteration. Connect a boolean value to its <code>continue</code> input:
          <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
            <li><code>true</code> - run another iteration</li>
            <li><code>false</code> - stop the loop</li>
          </ul>
        </div>
      </div>
    );
  }

  const ports = isInput
    ? (node.data.outputs as PortDefinition[]) || []
    : (node.data.inputs as PortDefinition[]) || [];

  return (
    <>
      <div className="config-field">
        <label>Interface Type</label>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '8px 0' }}>
          {isInput
            ? 'This node exposes workflow inputs to internal nodes'
            : 'This node collects outputs to expose as workflow outputs'}
        </div>
      </div>
      <PortEditor
        ports={ports}
        direction={isInput ? 'output' : 'input'}
        onChange={(newPorts) =>
          onUpdate(node.id, isInput ? { outputs: newPorts } : { inputs: newPorts })
        }
      />
    </>
  );
}

type ConstantValueType = 'boolean' | 'number' | 'string';

/**
 * Try to coerce a value to a new type
 * Returns { success: true, value } if coercion worked, { success: false } otherwise
 */
function tryCoerceValue(
  value: unknown,
  fromType: ConstantValueType,
  toType: ConstantValueType
): { success: boolean; value?: boolean | number | string } {
  if (fromType === toType) {
    return { success: true, value: value as boolean | number | string };
  }

  // String -> Number: try to parse
  if (fromType === 'string' && toType === 'number') {
    const str = String(value).trim();
    if (str === '') return { success: false };
    const num = Number(str);
    if (!isNaN(num)) {
      return { success: true, value: num };
    }
    return { success: false };
  }

  // Number -> String: always works
  if (fromType === 'number' && toType === 'string') {
    return { success: true, value: String(value) };
  }

  // String -> Boolean: "true"/"false" or "1"/"0"
  if (fromType === 'string' && toType === 'boolean') {
    const str = String(value).toLowerCase().trim();
    if (str === 'true' || str === '1') {
      return { success: true, value: true };
    }
    if (str === 'false' || str === '0' || str === '') {
      return { success: true, value: false };
    }
    return { success: false };
  }

  // Boolean -> String: always works
  if (fromType === 'boolean' && toType === 'string') {
    return { success: true, value: String(value) };
  }

  // Number -> Boolean: 0 = false, non-zero = true
  if (fromType === 'number' && toType === 'boolean') {
    return { success: true, value: Boolean(value) };
  }

  // Boolean -> Number: true = 1, false = 0
  if (fromType === 'boolean' && toType === 'number') {
    return { success: true, value: value ? 1 : 0 };
  }

  return { success: false };
}

function getDefaultValue(type: ConstantValueType): boolean | number | string {
  switch (type) {
    case 'boolean': return false;
    case 'number': return 0;
    case 'string': return '';
  }
}

function ConstantConfig({ node, onUpdate }: Omit<NodeConfigProps, 'rootDirectory'>) {
  const valueType = (node.data.valueType as ConstantValueType) || 'string';
  const value = node.data.value;

  // Handle type change - try to coerce value, otherwise reset to default
  const handleTypeChange = (newType: ConstantValueType) => {
    const coercion = tryCoerceValue(value, valueType, newType);
    const newValue = coercion.success ? coercion.value! : getDefaultValue(newType);

    onUpdate(node.id, {
      valueType: newType,
      value: newValue,
      outputs: [{ name: 'value', type: newType }],
    });
  };

  // Handle value change based on type
  const handleValueChange = (newValue: boolean | number | string) => {
    onUpdate(node.id, { value: newValue });
  };

  return (
    <>
      <div className="config-field">
        <label>Value Type</label>
        <select
          value={valueType}
          onChange={(e) => handleTypeChange(e.target.value as ConstantValueType)}
        >
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
        </select>
      </div>
      <div className="config-field">
        <label>Value</label>
        {valueType === 'boolean' ? (
          <div className="toggle-field">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => handleValueChange(e.target.checked)}
              />
              <span className="toggle-text">{value ? 'true' : 'false'}</span>
            </label>
          </div>
        ) : valueType === 'number' ? (
          <input
            type="number"
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => handleValueChange(parseFloat(e.target.value) || 0)}
          />
        ) : (
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleValueChange(e.target.value)}
            placeholder="Enter value..."
            rows={3}
          />
        )}
      </div>
      <div className="config-field">
        <label>Output</label>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <code style={{ color: 'var(--text-primary)' }}>value</code>
          <span style={{ marginLeft: '8px', opacity: 0.7 }}>({valueType})</span>
        </div>
      </div>
    </>
  );
}

/**
 * Function node configuration - inline code or file reference
 */
function FunctionConfig({ node, onUpdate }: Omit<NodeConfigProps, 'rootDirectory'>) {
  const code = (node.data.code as string) || '';
  const file = (node.data.file as string) || '';
  const inputs: PortDefinition[] = (node.data.inputs as PortDefinition[]) || [];
  const outputs: PortDefinition[] = (node.data.outputs as PortDefinition[]) || [];

  // Determine mode based on which field is set
  const mode: 'inline' | 'file' = file ? 'file' : 'inline';

  const handleModeChange = (newMode: 'inline' | 'file') => {
    if (newMode === 'inline') {
      onUpdate(node.id, {
        code: code || 'return { result: inputs.value }',
        file: undefined,
      });
    } else {
      onUpdate(node.id, {
        code: undefined,
        file: file || '',
      });
    }
  };

  const handleCodeChange = (newCode: string) => {
    onUpdate(node.id, { code: newCode });
  };

  const handleFileChange = (newFile: string) => {
    onUpdate(node.id, { file: newFile });
  };

  const addInput = () => {
    const newInputs: PortDefinition[] = [...inputs, { name: `input${inputs.length + 1}`, type: 'any' as ValueType }];
    onUpdate(node.id, { inputs: newInputs });
  };

  const updateInput = (index: number, field: 'name' | 'type', value: string) => {
    const newInputs: PortDefinition[] = [...inputs];
    if (field === 'type') {
      newInputs[index] = { ...newInputs[index], type: value as ValueType };
    } else {
      newInputs[index] = { ...newInputs[index], [field]: value };
    }
    onUpdate(node.id, { inputs: newInputs });
  };

  const removeInput = (index: number) => {
    const newInputs: PortDefinition[] = inputs.filter((_, i) => i !== index);
    onUpdate(node.id, { inputs: newInputs });
  };

  const addOutput = () => {
    const newOutputs: PortDefinition[] = [...outputs, { name: `output${outputs.length + 1}`, type: 'any' as ValueType }];
    onUpdate(node.id, { outputs: newOutputs });
  };

  const updateOutput = (index: number, field: 'name' | 'type', value: string) => {
    const newOutputs: PortDefinition[] = [...outputs];
    if (field === 'type') {
      newOutputs[index] = { ...newOutputs[index], type: value as ValueType };
    } else {
      newOutputs[index] = { ...newOutputs[index], [field]: value };
    }
    onUpdate(node.id, { outputs: newOutputs });
  };

  const removeOutput = (index: number) => {
    const newOutputs: PortDefinition[] = outputs.filter((_, i) => i !== index);
    onUpdate(node.id, { outputs: newOutputs });
  };

  const typeOptions = ['any', 'string', 'number', 'boolean', 'object'];

  return (
    <>
      <div className="config-field">
        <label>Mode</label>
        <select value={mode} onChange={(e) => handleModeChange(e.target.value as 'inline' | 'file')}>
          <option value="inline">Inline Code</option>
          <option value="file">File</option>
        </select>
      </div>

      {mode === 'inline' ? (
        <div className="config-field">
          <label>Code</label>
          <textarea
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="return { result: inputs.value }"
            style={{ fontFamily: 'monospace', minHeight: '100px' }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Access inputs via <code>inputs.name</code>. Return an object with output values.
          </div>
        </div>
      ) : (
        <div className="config-field">
          <label>File Path</label>
          <input
            type="text"
            value={file}
            onChange={(e) => handleFileChange(e.target.value)}
            placeholder="scripts/logic/myFunction.ts"
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            File must export a default function.
          </div>
        </div>
      )}

      <div className="config-field">
        <label>
          Inputs
          <button
            className="add-port-btn"
            onClick={addInput}
            style={{ marginLeft: '8px', padding: '2px 6px', fontSize: '0.75rem' }}
          >
            + Add
          </button>
        </label>
        {inputs.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No inputs defined</div>
        )}
        {inputs.map((input, index) => (
          <div key={index} style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <input
              type="text"
              value={input.name}
              onChange={(e) => updateInput(index, 'name', e.target.value)}
              placeholder="name"
              style={{ flex: 1 }}
            />
            <select
              value={input.type}
              onChange={(e) => updateInput(index, 'type', e.target.value)}
              style={{ width: '80px' }}
            >
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => removeInput(index)}
              style={{ padding: '2px 6px', fontSize: '0.75rem' }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="config-field">
        <label>
          Outputs
          <button
            className="add-port-btn"
            onClick={addOutput}
            style={{ marginLeft: '8px', padding: '2px 6px', fontSize: '0.75rem' }}
          >
            + Add
          </button>
        </label>
        {outputs.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No outputs defined</div>
        )}
        {outputs.map((output, index) => (
          <div key={index} style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <input
              type="text"
              value={output.name}
              onChange={(e) => updateOutput(index, 'name', e.target.value)}
              placeholder="name"
              style={{ flex: 1 }}
            />
            <select
              value={output.type}
              onChange={(e) => updateOutput(index, 'type', e.target.value)}
              style={{ width: '80px' }}
            >
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => removeOutput(index)}
              style={{ padding: '2px 6px', fontSize: '0.75rem' }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
