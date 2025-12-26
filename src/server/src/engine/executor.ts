import { spawn } from 'child_process';
import { executeAgent, type RunnerType } from './agents/index.js';
import type { PortDefinition, ValueType } from '@shodan/core';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface WorkflowNode {
  id: string;
  type: string;
  data: {
    label?: string;
    nodeType?: string;
    // I/O definitions
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
    // Execution options
    continueOnFailure?: boolean; // If true, workflow continues even if this node fails
    // Node-specific fields
    script?: string; // New: single multi-line script
    commands?: string[]; // Legacy: array of commands
    scriptFiles?: string[];
    scriptFile?: string; // Script node: path to .js, .ts, or .sh file
    scriptArgs?: string; // Script node: arguments to pass
    path?: string;
    prompt?: string;
    [key: string]: unknown;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;  // Format: "output:outputName"
  targetHandle?: string;  // Format: "input:inputName"
}

export interface WorkflowSchema {
  version: number;
  metadata: {
    name: string;
    description?: string;
    rootDirectory?: string;
  };
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
}

export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  output?: string;
  rawOutput?: string; // Clean output without command prefixes, used for templating
  stdout?: string;    // Standard output (for shell/script nodes)
  stderr?: string;    // Standard error (for shell/script nodes)
  error?: string;
  exitCode?: number;
  startTime?: string;
  endTime?: string;
}

export interface ExecuteResult {
  success: boolean;
  results: NodeResult[];
  executionOrder: string[];
}

export interface ExecuteOptions {
  rootDirectory?: string;
  startNodeId?: string;
  triggerInputs?: Record<string, unknown>;  // Inputs to pass to trigger nodes (e.g., from CLI --input)
  onNodeStart?: (nodeId: string, node: WorkflowNode) => void;
  onNodeComplete?: (nodeId: string, result: NodeResult) => void;
}

/**
 * Execution context - stores outputs from executed nodes
 */
interface ExecutionContext {
  // Map of nodeId -> { outputName -> value }
  outputs: Map<string, Record<string, unknown>>;
  nodeLabels: Map<string, string>;
  // Trigger input data (from CLI --input or UI)
  triggerInputs?: Record<string, unknown>;
}

/**
 * Build adjacency map: source -> [targets]
 */
function buildAdjacencyMap(edges: WorkflowEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    adjacency.get(edge.source)!.push(edge.target);
  }
  return adjacency;
}

/**
 * Type compatibility check
 * Returns true if sourceType can connect to targetType
 */
function isTypeCompatible(sourceType: ValueType, targetType: ValueType): boolean {
  // 'any' is bidirectional - accepts all and is accepted by all
  if (sourceType === 'any' || targetType === 'any') {
    return true;
  }
  // Otherwise, strict type matching
  return sourceType === targetType;
}

/**
 * Resolve input values for a node from incoming edges
 */
function resolveInputs(
  nodeId: string,
  node: WorkflowNode,
  edges: WorkflowEdge[],
  context: ExecutionContext
): { success: boolean; inputValues: Record<string, unknown>; error?: string } {
  const inputValues: Record<string, unknown> = {};
  const inputs = node.data.inputs || [];

  // Build map of input name -> edge
  const incomingEdges = edges.filter(e => e.target === nodeId);
  const edgesByInputName = new Map<string, WorkflowEdge>();

  for (const edge of incomingEdges) {
    // Parse target handle: "input:inputName"
    const targetHandle = edge.targetHandle || 'input:input';
    const inputName = targetHandle.startsWith('input:')
      ? targetHandle.substring(6)
      : targetHandle;

    // Enforce single edge per input
    if (edgesByInputName.has(inputName)) {
      return {
        success: false,
        inputValues: {},
        error: `Multiple edges connected to input '${inputName}'`,
      };
    }

    edgesByInputName.set(inputName, edge);
  }

  // Resolve each input
  for (const inputDef of inputs) {
    const edge = edgesByInputName.get(inputDef.name);

    if (!edge) {
      // No edge connected - check if required or has default
      if (inputDef.required && inputDef.default === undefined) {
        return {
          success: false,
          inputValues: {},
          error: `Required input '${inputDef.name}' is not connected`,
        };
      }
      // Use default value if provided
      if (inputDef.default !== undefined) {
        inputValues[inputDef.name] = inputDef.default;
      }
      continue;
    }

    // Get source output value
    const sourceHandle = edge.sourceHandle || 'output:output';
    const outputName = sourceHandle.startsWith('output:')
      ? sourceHandle.substring(7)
      : sourceHandle;

    const sourceOutputs = context.outputs.get(edge.source);
    if (!sourceOutputs || !(outputName in sourceOutputs)) {
      return {
        success: false,
        inputValues: {},
        error: `Source node '${edge.source}' output '${outputName}' not found`,
      };
    }

    const value = sourceOutputs[outputName];

    // Type validation
    // Get source output type
    const sourceNode = context.outputs.get(edge.source);
    // For now, we'll do basic type checking - can enhance later
    // TODO: Look up source node's output definition to get actual type

    inputValues[inputDef.name] = value;
  }

  return { success: true, inputValues };
}

/**
 * Extract output value based on extraction configuration
 */
function extractOutput(
  rawOutput: string,
  extraction: PortDefinition['extract']
): unknown {
  if (!extraction || extraction.type === 'full') {
    return rawOutput;
  }

  if (extraction.type === 'regex' && extraction.pattern) {
    const regex = new RegExp(extraction.pattern);
    const match = rawOutput.match(regex);
    return match?.[1] || null;
  }

  if (extraction.type === 'json_path' && extraction.pattern) {
    try {
      const data = JSON.parse(rawOutput);
      // Simple JSONPath implementation - just support basic paths like $.foo.bar
      const path = extraction.pattern.replace(/^\$\./, '').split('.');
      let value: any = data;
      for (const key of path) {
        value = value?.[key];
      }
      return value;
    } catch {
      return null;
    }
  }

  return rawOutput;
}

/**
 * Replace template variables in a string
 * Supports both legacy {{ node.output }} and new {{ node.outputName }} syntax
 */
function replaceTemplates(text: string, context: ExecutionContext): string {
  // Match both {{ node.output }} and {{ node.outputName }}
  const templateRegex = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g;

  return text.replace(templateRegex, (match, identifier, outputName) => {
    // Try to find node by ID or label
    let nodeId: string | undefined;

    if (context.outputs.has(identifier)) {
      nodeId = identifier;
    } else {
      // Try to find by label
      for (const [id, label] of context.nodeLabels) {
        const normalizedLabel = label.toLowerCase().replace(/\s+/g, '_');
        if (normalizedLabel === identifier.toLowerCase() || label === identifier) {
          nodeId = id;
          break;
        }
      }
    }

    if (!nodeId) {
      return match; // Node not found, leave template unchanged
    }

    const nodeOutputs = context.outputs.get(nodeId);
    if (!nodeOutputs) {
      return match; // No outputs for this node
    }

    // Resolution rules:
    // 1. If outputName is 'output' and node has an 'output' field, use it
    // 2. Otherwise look up the specific output by name
    // 3. If not found and outputName is 'output', use first defined output (legacy compat)

    if (outputName in nodeOutputs) {
      const value = nodeOutputs[outputName];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    // Legacy compatibility: {{ node.output }} falls back to first output
    if (outputName === 'output') {
      const firstOutput = Object.values(nodeOutputs)[0];
      if (firstOutput !== undefined) {
        return typeof firstOutput === 'string' ? firstOutput : JSON.stringify(firstOutput);
      }
    }

    return match; // Output not found, leave template unchanged
  });
}

/**
 * Process node data, replacing template variables
 */
function processNodeTemplates(node: WorkflowNode, context: ExecutionContext): WorkflowNode {
  const processedData = { ...node.data };

  if (processedData.script && typeof processedData.script === 'string') {
    processedData.script = replaceTemplates(processedData.script, context);
  }

  if (processedData.commands && Array.isArray(processedData.commands)) {
    processedData.commands = processedData.commands.map(cmd =>
      typeof cmd === 'string' ? replaceTemplates(cmd, context) : cmd
    );
  }

  if (processedData.prompt && typeof processedData.prompt === 'string') {
    processedData.prompt = replaceTemplates(processedData.prompt, context);
  }

  if (processedData.path && typeof processedData.path === 'string') {
    processedData.path = replaceTemplates(processedData.path, context);
  }

  if (processedData.scriptFile && typeof processedData.scriptFile === 'string') {
    processedData.scriptFile = replaceTemplates(processedData.scriptFile, context);
  }

  if (processedData.scriptArgs && typeof processedData.scriptArgs === 'string') {
    processedData.scriptArgs = replaceTemplates(processedData.scriptArgs, context);
  }

  return { ...node, data: processedData };
}

/**
 * Find trigger nodes
 */
function findTriggerNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const hasIncoming = new Set(edges.map(e => e.target));

  const triggers = nodes.filter(n =>
    n.data.nodeType === 'trigger' || n.type === 'trigger'
  );

  if (triggers.length > 0) {
    return triggers.map(t => t.id);
  }

  return nodes
    .filter(n => !hasIncoming.has(n.id))
    .map(n => n.id);
}

/**
 * Execute a shell command
 */
function executeShellCommand(
  command: string,
  cwd: string
): Promise<{ output: string; stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      resolve({
        output: output.trim(),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      });
    });

    proc.on('error', (err) => {
      resolve({
        output: `Failed to start process: ${err.message}`,
        stdout: '',
        stderr: `Failed to start process: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}

/**
 * Ensure node has default I/O definitions based on its type
 * This provides backwards compatibility and sets up the I/O system
 */
function ensureNodeIO(node: WorkflowNode): WorkflowNode {
  const nodeType = node.data.nodeType || node.type;

  // If node already has I/O definitions, return as-is
  if (node.data.inputs || node.data.outputs) {
    return node;
  }

  // Add default I/O based on node type
  const inputs: PortDefinition[] = [];
  const outputs: PortDefinition[] = [];

  if (nodeType === 'trigger') {
    // Triggers have no inputs, only outputs
    outputs.push(
      { name: 'timestamp', type: 'string', description: 'ISO timestamp when trigger fired' },
      { name: 'type', type: 'string', description: 'Trigger type identifier' },
      { name: 'text', type: 'string', description: 'Optional text input from user' },
      { name: 'params', type: 'json', description: 'Optional parameters passed via CLI/UI' }
    );
  } else if (nodeType === 'shell' || nodeType === 'script') {
    // Shell/script nodes have generic input and stdout/stderr/exitCode outputs
    inputs.push(
      { name: 'input', type: 'any', required: false, description: 'Generic input value' }
    );
    outputs.push(
      { name: 'stdout', type: 'string', description: 'Standard output from script' },
      { name: 'stderr', type: 'string', description: 'Standard error from script' },
      { name: 'exitCode', type: 'number', description: 'Exit code from script' }
    );
  } else {
    // Other node types get a generic input/output
    inputs.push(
      { name: 'input', type: 'any', required: false }
    );
    outputs.push(
      { name: 'output', type: 'string' }
    );
  }

  return {
    ...node,
    data: {
      ...node.data,
      inputs,
      outputs,
    },
  };
}

/**
 * Build default outputs for a node execution result
 */
function buildOutputValues(
  node: WorkflowNode,
  result: {
    rawOutput?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  },
  context: ExecutionContext
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  const nodeType = node.data.nodeType || node.type;
  const outputDefs = node.data.outputs || [];

  // If no output definitions, create defaults based on node type
  if (outputDefs.length === 0) {
    // Legacy mode: single 'output' field
    if (result.rawOutput !== undefined) {
      outputs.output = result.rawOutput;
    }
    return outputs;
  }

  // Extract outputs based on definitions
  for (const outputDef of outputDefs) {
    // Determine source data for extraction
    let sourceData: string = '';

    if (nodeType === 'shell' || nodeType === 'script') {
      // Shell/script nodes have stdout, stderr, exitCode
      if (outputDef.name === 'stdout') {
        outputs.stdout = result.stdout || '';
      } else if (outputDef.name === 'stderr') {
        outputs.stderr = result.stderr || '';
      } else if (outputDef.name === 'exitCode') {
        outputs.exitCode = result.exitCode ?? 0;
      } else {
        // Custom output with extraction
        sourceData = result.stdout || result.rawOutput || '';
        outputs[outputDef.name] = extractOutput(sourceData, outputDef.extract);
      }
    } else if (nodeType === 'trigger') {
      // Trigger outputs come from context.triggerInputs
      const triggerInputs = context.triggerInputs || {};
      if (outputDef.name === 'timestamp') {
        outputs.timestamp = new Date().toISOString();
      } else if (outputDef.name === 'type') {
        outputs.type = node.data.triggerType || 'manual';
      } else if (outputDef.name === 'text') {
        outputs.text = triggerInputs.text || '';
      } else if (outputDef.name === 'params') {
        outputs.params = triggerInputs.params || {};
      } else {
        // Pass through from trigger inputs
        outputs[outputDef.name] = triggerInputs[outputDef.name];
      }
    } else {
      // Other node types - use rawOutput
      sourceData = result.rawOutput || '';
      outputs[outputDef.name] = extractOutput(sourceData, outputDef.extract);
    }
  }

  return outputs;
}

/**
 * Execute a single node
 */
async function executeNode(
  node: WorkflowNode,
  rootDirectory: string,
  edges: WorkflowEdge[],
  context: ExecutionContext
): Promise<NodeResult> {
  const startTime = new Date().toISOString();
  const nodeType = node.data.nodeType || node.type;
  const cwd = (node.data.path as string) || rootDirectory || process.cwd();

  // Resolve inputs from edges
  const inputResolution = resolveInputs(node.id, node, edges, context);
  if (!inputResolution.success) {
    return {
      nodeId: node.id,
      status: 'failed',
      error: inputResolution.error,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  const inputValues = inputResolution.inputValues;

  if (nodeType === 'shell') {
    // Support both new 'script' field and legacy 'commands' array
    const script = node.data.script as string | undefined;
    const legacyCommands = (node.data.commands as string[]) || [];

    // Determine what to execute: prefer script, fall back to legacy commands
    const commandsToRun: string[] = script?.trim()
      ? [script]
      : legacyCommands;

    if (commandsToRun.length === 0 || !commandsToRun.some(c => c.trim())) {
      return {
        nodeId: node.id,
        status: 'completed',
        output: '(no script to execute)',
        rawOutput: '',
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    const outputs: string[] = [];
    const rawOutputs: string[] = [];
    const stdouts: string[] = [];
    const stderrs: string[] = [];
    let lastExitCode = 0;

    for (const command of commandsToRun) {
      if (!command.trim()) continue;

      const result = await executeShellCommand(command, cwd);
      outputs.push(`$ ${command}\n${result.output}`);
      rawOutputs.push(result.output);
      stdouts.push(result.stdout);
      stderrs.push(result.stderr);
      lastExitCode = result.exitCode;

      if (result.exitCode !== 0) {
        return {
          nodeId: node.id,
          status: 'failed',
          output: outputs.join('\n\n'),
          rawOutput: rawOutputs.join('\n'),
          exitCode: result.exitCode,
          error: `Script failed with exit code ${result.exitCode}`,
          startTime,
          endTime: new Date().toISOString(),
        };
      }
    }

    return {
      nodeId: node.id,
      status: 'completed',
      output: outputs.join('\n\n'),
      rawOutput: rawOutputs.join('\n'),
      stdout: stdouts.join('\n'),
      stderr: stderrs.join('\n'),
      exitCode: lastExitCode,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  if (nodeType === 'trigger') {
    // Trigger nodes don't execute anything - they just provide initial outputs
    // The actual output values are built from triggerInputs in buildOutputValues
    return {
      nodeId: node.id,
      status: 'completed',
      output: 'Trigger activated',
      rawOutput: '', // Triggers don't have rawOutput from execution
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  if (nodeType === 'workdir') {
    return {
      nodeId: node.id,
      status: 'completed',
      output: `Working directory: ${node.data.path || '(not set)'}`,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  if (nodeType === 'script') {
    const scriptFile = node.data.scriptFile as string | undefined;
    const scriptArgs = node.data.scriptArgs as string | undefined;

    if (!scriptFile?.trim()) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: 'Script node requires a script file to be specified',
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    // Determine the runner based on file extension
    let command: string;
    const args = scriptArgs?.trim() || '';

    if (scriptFile.endsWith('.ts')) {
      // TypeScript - use tsx
      command = `npx tsx "${scriptFile}" ${args}`.trim();
    } else if (scriptFile.endsWith('.js')) {
      // JavaScript - use node
      command = `node "${scriptFile}" ${args}`.trim();
    } else if (scriptFile.endsWith('.sh')) {
      // Bash script
      command = `bash "${scriptFile}" ${args}`.trim();
    } else {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: `Unsupported script type: ${scriptFile}. Supported extensions: .ts, .js, .sh`,
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    const result = await executeShellCommand(command, cwd);

    return {
      nodeId: node.id,
      status: result.exitCode === 0 ? 'completed' : 'failed',
      output: `$ ${command}\n${result.output}`,
      rawOutput: result.output,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.exitCode !== 0 ? `Script exited with code ${result.exitCode}` : undefined,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  if (nodeType === 'agent') {
    const runner = node.data.runner as RunnerType | undefined;
    const model = node.data.model as string | undefined;
    const prompt = node.data.prompt as string | undefined;
    const promptFiles = node.data.promptFiles as string[] | undefined;
    const outputSchema = node.data.outputSchema as string | undefined;

    if (!runner) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: 'Agent node requires a runner to be specified',
        startTime,
        endTime: new Date().toISOString(),
      };
    }


    if (!prompt) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: 'Agent node requires a prompt to be specified',
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    const result = await executeAgent({
      runner,
      model,
      prompt,
      promptFiles,
      outputSchema,
      cwd,
    });

    return {
      nodeId: node.id,
      status: result.success ? 'completed' : 'failed',
      output: result.output,
      rawOutput: result.output,
      error: result.error,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  return {
    nodeId: node.id,
    status: 'completed',
    output: `Node type '${nodeType}' execution not yet implemented`,
    startTime,
    endTime: new Date().toISOString(),
  };
}

/**
 * Execute a workflow
 */
export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const { rootDirectory, startNodeId, triggerInputs, onNodeStart, onNodeComplete } = options;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacency = buildAdjacencyMap(edges);

  const context: ExecutionContext = {
    outputs: new Map(),
    nodeLabels: new Map(nodes.map(n => [n.id, (n.data.label as string) || n.id])),
    triggerInputs,
  };

  let startNodes: string[];
  if (startNodeId) {
    if (!nodeMap.has(startNodeId)) {
      throw new Error(`Start node '${startNodeId}' not found`);
    }
    startNodes = [startNodeId];
  } else {
    startNodes = findTriggerNodes(nodes, edges);
    if (startNodes.length === 0) {
      throw new Error('No trigger or start node found');
    }
  }

  const results: NodeResult[] = [];
  const executionOrder: string[] = [];
  const visited = new Set<string>();
  let overallSuccess = true;

  const queue = [...startNodes];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    executionOrder.push(nodeId);

    if (onNodeStart) {
      onNodeStart(nodeId, node);
    }

    // Ensure node has I/O definitions before processing
    const nodeWithIO = ensureNodeIO(node);
    const processedNode = processNodeTemplates(nodeWithIO, context);
    const result = await executeNode(processedNode, rootDirectory || process.cwd(), edges, context);
    results.push(result);

    if (onNodeComplete) {
      onNodeComplete(nodeId, result);
    }

    // Build and store output values based on node's output definitions
    const outputValues = buildOutputValues(processedNode, result, context);
    context.outputs.set(nodeId, outputValues);

    // Check if we should stop on failure
    if (result.status === 'failed') {
      const continueOnFailure = processedNode.data.continueOnFailure === true;
      if (!continueOnFailure) {
        overallSuccess = false;
        break;
      }
      // Node failed but continueOnFailure is true - keep going but mark overall as failed
      overallSuccess = false;
    }

    const nextNodes = adjacency.get(nodeId) || [];
    for (const nextId of nextNodes) {
      if (!visited.has(nextId)) {
        queue.push(nextId);
      }
    }
  }

  return {
    success: overallSuccess,
    results,
    executionOrder,
  };
}

/**
 * Execute a workflow from schema (as loaded from YAML/JSON)
 */
export async function executeWorkflowSchema(
  schema: WorkflowSchema,
  options: Omit<ExecuteOptions, 'rootDirectory'> = {}
): Promise<ExecuteResult> {
  const nodes: WorkflowNode[] = schema.nodes.map(n => ({
    id: n.id,
    type: n.type,
    data: n.data as WorkflowNode['data'],
  }));

  const edges: WorkflowEdge[] = schema.edges;

  return executeWorkflow(nodes, edges, {
    ...options,
    rootDirectory: schema.metadata.rootDirectory,
  });
}
