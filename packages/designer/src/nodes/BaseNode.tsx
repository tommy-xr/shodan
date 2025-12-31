import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { PortDefinition, ValueType, DockSlot } from '@shodan/core';
import './nodes.css';

export type NodeType = 'agent' | 'shell' | 'script' | 'trigger' | 'workdir' | 'component' | 'interface-input' | 'interface-output' | 'loop' | 'interface-continue' | 'constant';
export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

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
  // Component fields
  workflowPath?: string;  // Path to component workflow file
  // Loop fields
  maxIterations?: number;  // Safety limit for loops (default: 10)
  dockSlots?: DockSlot[];  // Dock slots for iteration control
  // Execution state
  executionStatus?: ExecutionStatus;
  executionOutput?: string;
  executionError?: string;
  // Loop execution state
  currentIteration?: number;  // Current iteration number (1-based)
  // UI state (transient, not persisted)
  isDropTarget?: boolean;  // True when dragging node over this loop
}

const nodeIcons: Record<NodeType, string> = {
  agent: '🤖',
  shell: '⌘',
  script: '📜',
  trigger: '⚡',
  workdir: '📁',
  component: '📦',
  'interface-input': '⊕',
  'interface-output': '⊕',
  loop: '🔁',
  'interface-continue': '⊕',
  constant: '◆',
};

const nodeLabels: Record<NodeType, string> = {
  agent: 'Agent',
  shell: 'Shell',
  script: 'Script',
  trigger: 'Trigger',
  workdir: 'Working Dir',
  component: 'Component',
  'interface-input': 'Input',
  'interface-output': 'Output',
  loop: 'Loop',
  'interface-continue': 'Continue',
  constant: 'Constant',
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

/**
 * Get default I/O definitions for a node type
 */
function getDefaultIO(nodeType: NodeType): { inputs: PortDefinition[]; outputs: PortDefinition[] } {
  if (nodeType === 'trigger') {
    return {
      inputs: [],
      outputs: [
        { name: 'timestamp', type: 'string', description: 'ISO timestamp when trigger fired' },
        { name: 'type', type: 'string', description: 'Trigger type identifier' },
        { name: 'text', type: 'string', description: 'Optional text input from user' },
        { name: 'params', type: 'json', description: 'Optional parameters passed via CLI/UI' }
      ]
    };
  } else if (nodeType === 'shell' || nodeType === 'script') {
    return {
      inputs: [
        { name: 'input', type: 'any', required: false, description: 'Generic input value' }
      ],
      outputs: [
        { name: 'stdout', type: 'string', description: 'Standard output from script' },
        { name: 'stderr', type: 'string', description: 'Standard error from script' },
        { name: 'exitCode', type: 'number', description: 'Exit code from script' }
      ]
    };
  } else if (nodeType === 'interface-input') {
    // Interface-input nodes only have outputs (they expose workflow inputs to internal nodes)
    return {
      inputs: [],
      outputs: [
        { name: 'value', type: 'any', description: 'Workflow input value' }
      ]
    };
  } else if (nodeType === 'interface-output') {
    // Interface-output nodes only have inputs (they collect outputs from internal nodes)
    return {
      inputs: [
        { name: 'value', type: 'any', description: 'Value to expose as workflow output' }
      ],
      outputs: []
    };
  } else if (nodeType === 'component') {
    // Component nodes have I/O defined by the referenced workflow
    // Defaults are empty; they get populated when workflowPath is set
    return {
      inputs: [],
      outputs: []
    };
  } else if (nodeType === 'loop') {
    // Loop nodes have I/O defined by interface nodes in inner workflow
    // Defaults are empty; they get populated from interface-input/output
    return {
      inputs: [],
      outputs: []
    };
  } else if (nodeType === 'interface-continue') {
    // Interface-continue nodes have a single boolean input
    return {
      inputs: [
        { name: 'continue', type: 'boolean', required: true, description: 'Whether to continue iterating' }
      ],
      outputs: []
    };
  } else if (nodeType === 'constant') {
    // Constant nodes have no inputs, one output
    // The actual type is determined by valueType in the node data
    return {
      inputs: [],
      outputs: [
        { name: 'value', type: 'any', description: 'Constant value' }
      ]
    };
  } else {
    return {
      inputs: [
        { name: 'input', type: 'any', required: false }
      ],
      outputs: [
        { name: 'output', type: 'string' }
      ]
    };
  }
}

export function BaseNode({ data, selected }: NodeProps) {
  const nodeData = data as BaseNodeData;
  const nodeType = nodeData.nodeType;
  const execStatus = nodeData.executionStatus || 'idle';

  // Get I/O definitions (use defaults if not defined)
  const defaultIO = getDefaultIO(nodeType);
  const inputs = nodeData.inputs || defaultIO.inputs;
  const outputs = nodeData.outputs || defaultIO.outputs;

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
      case 'component':
        if (nodeData.workflowPath) {
          const fileName = nodeData.workflowPath.split('/').pop() || nodeData.workflowPath;
          return fileName.replace(/\.(yaml|yml)$/, '');
        }
        return null;
      case 'interface-input':
      case 'interface-output':
      case 'interface-continue':
        return '(interface)';
      case 'loop': {
        const parts: string[] = [];
        // Show iteration progress if running
        if (nodeData.currentIteration && execStatus === 'running') {
          parts.push(`Iteration ${nodeData.currentIteration}/${nodeData.maxIterations || 10}`);
        } else if (nodeData.workflowPath) {
          const fileName = nodeData.workflowPath.split('/').pop() || nodeData.workflowPath;
          parts.push(fileName.replace(/\.(yaml|yml)$/, ''));
        } else if (nodeData.maxIterations) {
          parts.push(`max: ${nodeData.maxIterations}`);
        }
        return parts.length > 0 ? parts.join(' · ') : null;
      }
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

  // Calculate the minimum height needed for ports
  const maxPorts = Math.max(inputs.length, outputs.length);
  const portHeight = 28; // Height per port row
  const headerHeight = 36; // Node header height
  const contentPadding = 60; // Space for label, details, etc.
  const portsStartOffset = headerHeight + contentPadding; // Start ports after content
  const minBodyHeight = contentPadding + maxPorts * portHeight + 20; // Content padding + ports + extra padding

  return (
    <div className={`custom-node ${nodeType} ${selected ? 'selected' : ''} exec-${execStatus}`}>
      <div className="node-header">
        <span className="node-icon">{nodeIcons[nodeType]}</span>
        <span className="node-type">{nodeLabels[nodeType]}</span>
        {execStatus !== 'idle' && (
          <span className={`exec-status-icon ${execStatus}`}>{statusIcons[execStatus]}</span>
        )}
      </div>

      <div className="node-body" style={{ minHeight: `${minBodyHeight}px` }}>
        <div className="node-content">
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
      </div>

      {/* Floating streaming output panel - appears below node when running */}
      {execStatus === 'running' && nodeData.executionOutput && (
        <div className="node-streaming-panel">
          <pre>{
            // Show last 6 lines to preserve newline formatting
            nodeData.executionOutput.split('\n').slice(-6).join('\n')
          }<span className="streaming-cursor">▌</span></pre>
        </div>
      )}

      {/* Port labels - positioned absolutely relative to the entire node */}
      {inputs.map((input, index) => {
        const topOffset = portsStartOffset + (index * portHeight);
        return (
          <div
            key={`input-label-${input.name}`}
            className="port-label port-label-input"
            style={{ top: `${topOffset}px` }}
          >
            {input.label || input.name}
          </div>
        );
      })}

      {outputs.map((output, index) => {
        const topOffset = portsStartOffset + (index * portHeight);
        return (
          <div
            key={`output-label-${output.name}`}
            className="port-label port-label-output"
            style={{ top: `${topOffset}px` }}
          >
            {output.label || output.name}
          </div>
        );
      })}

      {/* Input handles */}
      {inputs.map((input, index) => {
        const topOffset = portsStartOffset + (index * portHeight);
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

      {/* Output handles */}
      {outputs.map((output, index) => {
        const topOffset = portsStartOffset + (index * portHeight);
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
    </div>
  );
}
