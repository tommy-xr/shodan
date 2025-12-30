import { spawn } from 'child_process';
import { executeAgent, type RunnerType } from './agents/index.js';
import type { PortDefinition, ValueType, WorkflowNode, WorkflowEdge, WorkflowSchema, LoopNodeData, ConstantNodeData, ConstantValueType } from '@shodan/core';
import { isLoopNodeData } from '@shodan/core';
import { loadWorkflow, getWorkflowDirectory } from './workflow-loader.js';
import { executeLoop } from './loop-executor.js';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  output?: string;
  rawOutput?: string; // Clean output without command prefixes, used for templating
  stdout?: string;    // Standard output (for shell/script nodes)
  stderr?: string;    // Standard error (for shell/script nodes)
  structuredOutput?: unknown; // Parsed JSON for agent nodes with outputSchema
  error?: string;
  exitCode?: number;
  startTime?: string;
  endTime?: string;
}

export interface ExecuteResult {
  success: boolean;
  results: NodeResult[];
  executionOrder: string[];
  outputs: Map<string, Record<string, unknown>>;  // Node outputs (extracted values)
  error?: string;  // Error message if workflow failed
}

/**
 * Dock context for loop execution - provides dock slot values to inner nodes
 */
export interface DockContext {
  dockOutputs: Record<string, unknown>;  // Map of dock handle ID -> value
  dockOutputEdges: WorkflowEdge[];       // Edges from dock outputs to inner nodes
}

export interface ExecuteOptions {
  rootDirectory?: string;
  startNodeId?: string;
  startNodeIds?: string[];  // Multiple start nodes (for loop inner workflows)
  loopId?: string;          // ID of the loop being executed (for filtering nested children)
  triggerInputs?: Record<string, unknown>;  // Inputs to pass to trigger nodes (e.g., from CLI --input)
  workflowInputs?: Record<string, unknown>;  // Inputs when workflow is run as component
  dockContext?: DockContext;                 // Dock context for loop inner workflow execution
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
  // Workflow inputs when run as a component
  workflowInputs?: Record<string, unknown>;
  // Dock context for loop inner workflow execution
  dockContext?: DockContext;
}

/**
 * Build adjacency map: source -> [targets]
 * Excludes dock input edges (feedback to loop) which should not trigger sequential execution
 */
function buildAdjacencyMap(edges: WorkflowEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    // Skip dock input edges - these are feedback edges to loops, not sequential dependencies
    // Dock input edges have targetHandle like "dock:*:input" or "dock:*:current"
    const targetHandle = edge.targetHandle || '';
    if (targetHandle.startsWith('dock:') &&
        (targetHandle.endsWith(':input') || targetHandle.endsWith(':current'))) {
      continue;
    }

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
 * Also handles dock output edges when running inside a loop
 */
function resolveInputs(
  nodeId: string,
  node: WorkflowNode,
  edges: WorkflowEdge[],
  context: ExecutionContext
): { success: boolean; inputValues: Record<string, unknown>; error?: string } {
  const inputValues: Record<string, unknown> = {};
  const inputs = node.data.inputs || [];

  // Collect all incoming edges, but avoid duplicates between regular edges and dock edges
  const regularIncomingEdges = edges.filter(e => e.target === nodeId);

  // Get dock output edges targeting this node (if in loop context)
  const dockEdgesToThisNode = context.dockContext
    ? context.dockContext.dockOutputEdges.filter(e => e.target === nodeId)
    : [];

  // Create a set of dock edge IDs to avoid duplicates
  const dockEdgeIds = new Set(dockEdgesToThisNode.map(e => e.id));

  // Only include regular edges that aren't also dock edges
  const incomingEdges = regularIncomingEdges.filter(e => !dockEdgeIds.has(e.id));
  incomingEdges.push(...dockEdgesToThisNode);

  const edgesByInputName = new Map<string, WorkflowEdge>();

  for (const edge of incomingEdges) {
    // Parse target handle: "input:inputName" or "input:inputName:internal"
    let targetHandle = edge.targetHandle || 'input:input';
    // Strip :internal suffix if present (used for internal loop handles)
    if (targetHandle.endsWith(':internal')) {
      targetHandle = targetHandle.slice(0, -9);
    }
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
    let sourceHandle = edge.sourceHandle || 'output:output';
    // Strip :internal suffix if present (used for internal loop handles)
    if (sourceHandle.endsWith(':internal')) {
      sourceHandle = sourceHandle.slice(0, -9);
    }

    // Check if this is a dock output edge or loop input edge
    // Dock handles: dock:iteration:output, dock:count:prev, etc.
    // Loop input handles: input:target (passing loop's input to inner nodes)
    const isDockHandle = sourceHandle.startsWith('dock:') || sourceHandle.startsWith('input:');
    if (isDockHandle && context.dockContext) {
      // Get value from dock context
      const dockValue = context.dockContext.dockOutputs[sourceHandle];
      inputValues[inputDef.name] = dockValue;
      continue;
    }

    // Regular edge - get from context.outputs
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
function replaceTemplates(
  text: string,
  context: ExecutionContext,
  inputValues?: Record<string, unknown>
): string {
  let result = text;

  // First, handle {{ input }} for single input (common case)
  if (inputValues && 'input' in inputValues) {
    const singleInputRegex = /\{\{\s*input\s*\}\}/g;
    result = result.replace(singleInputRegex, () => {
      const value = inputValues['input'];
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }

  // Then handle {{ inputs.portName }} for named inputs
  const templateRegex = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g;

  return result.replace(templateRegex, (match, identifier, property) => {
    // Check if referencing current node's inputs
    if (identifier === 'inputs' && inputValues) {
      if (property in inputValues) {
        const value = inputValues[property];
        return typeof value === 'string' ? value : JSON.stringify(value);
      }
      return match; // Input not found, leave template unchanged
    }

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
    // 1. If property is 'output' and node has an 'output' field, use it
    // 2. Otherwise look up the specific output by name
    // 3. If not found and property is 'output', use first defined output (legacy compat)

    if (property in nodeOutputs) {
      const value = nodeOutputs[property];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    // Legacy compatibility: {{ node.output }} falls back to first output
    if (property === 'output') {
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
function processNodeTemplates(
  node: WorkflowNode,
  context: ExecutionContext,
  inputValues?: Record<string, unknown>
): WorkflowNode {
  const processedData = { ...node.data };

  if (processedData.script && typeof processedData.script === 'string') {
    processedData.script = replaceTemplates(processedData.script, context, inputValues);
  }

  if (processedData.commands && Array.isArray(processedData.commands)) {
    processedData.commands = processedData.commands.map(cmd =>
      typeof cmd === 'string' ? replaceTemplates(cmd, context, inputValues) : cmd
    );
  }

  if (processedData.prompt && typeof processedData.prompt === 'string') {
    processedData.prompt = replaceTemplates(processedData.prompt, context, inputValues);
  }

  if (processedData.path && typeof processedData.path === 'string') {
    processedData.path = replaceTemplates(processedData.path, context, inputValues);
  }

  if (processedData.scriptFile && typeof processedData.scriptFile === 'string') {
    processedData.scriptFile = replaceTemplates(processedData.scriptFile, context, inputValues);
  }

  if (processedData.scriptArgs && typeof processedData.scriptArgs === 'string') {
    processedData.scriptArgs = replaceTemplates(processedData.scriptArgs, context, inputValues);
  }

  return { ...node, data: processedData };
}

/**
 * Find trigger nodes
 */
function findTriggerNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  // Filter out dock input edges - these are internal feedback loops, not sequential dependencies
  // Same logic as buildAdjacencyMap
  const sequentialEdges = edges.filter(e => {
    const targetHandle = e.targetHandle || '';
    if (targetHandle.startsWith('dock:') &&
        (targetHandle.endsWith(':input') || targetHandle.endsWith(':current'))) {
      return false;
    }
    return true;
  });

  const hasIncoming = new Set(sequentialEdges.map(e => e.target));

  // Find all trigger nodes
  const triggers = nodes.filter(n =>
    n.data.nodeType === 'trigger' || n.type === 'trigger'
  );

  // Find all source nodes (nodes with no incoming edges)
  // This includes constants and other pure value nodes
  // Exclude nodes with parentId - they run within their container
  const sourceNodes = nodes.filter(n => !hasIncoming.has(n.id) && !n.parentId);

  // Combine triggers and source nodes, deduplicating
  const startNodeIds = new Set<string>();
  for (const t of triggers) {
    startNodeIds.add(t.id);
  }
  for (const s of sourceNodes) {
    startNodeIds.add(s.id);
  }

  return Array.from(startNodeIds);
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

  if (nodeType === 'constant') {
    // Constant nodes have no inputs, one output whose type matches valueType
    const constantData = node.data as unknown as ConstantNodeData;
    const valueType = constantData.valueType || 'any';
    outputs.push(
      { name: 'value', type: valueType as ValueType, description: 'Constant value' }
    );
  } else if (nodeType === 'trigger') {
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
    structuredOutput?: unknown;  // Parsed JSON for agent nodes
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
    // For agents with structured output but no defined outputs, add it as 'structured'
    if (nodeType === 'agent' && result.structuredOutput !== undefined) {
      outputs.structured = result.structuredOutput;
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
    } else if (nodeType === 'constant') {
      // Constant node: output is the typed value from structuredOutput
      if (outputDef.name === 'value' && result.structuredOutput) {
        const structured = result.structuredOutput as { value: unknown };
        outputs.value = structured.value;
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
    } else if (nodeType === 'agent') {
      // Agent nodes have response (raw), structured (parsed JSON), and exitCode
      if (outputDef.name === 'response') {
        outputs.response = result.rawOutput || '';
      } else if (outputDef.name === 'structured') {
        outputs.structured = result.structuredOutput;
      } else if (outputDef.name === 'exitCode') {
        outputs.exitCode = result.exitCode ?? 0;
      } else {
        // Custom output - try to extract from structured output first, then raw
        if (result.structuredOutput && typeof result.structuredOutput === 'object') {
          const structured = result.structuredOutput as Record<string, unknown>;
          if (outputDef.name in structured) {
            outputs[outputDef.name] = structured[outputDef.name];
          } else {
            // Fall back to extraction from raw output
            sourceData = result.rawOutput || '';
            outputs[outputDef.name] = extractOutput(sourceData, outputDef.extract);
          }
        } else {
          sourceData = result.rawOutput || '';
          outputs[outputDef.name] = extractOutput(sourceData, outputDef.extract);
        }
      }
    } else if (nodeType === 'interface-input') {
      // Interface-input node: outputs come from workflow inputs
      const workflowInputs = context.workflowInputs || {};
      outputs[outputDef.name] = workflowInputs[outputDef.name];
    } else if (nodeType === 'component') {
      // Component node: outputs come from sub-workflow's interface-output
      if (result.structuredOutput && typeof result.structuredOutput === 'object') {
        const componentOutputs = result.structuredOutput as Record<string, unknown>;
        outputs[outputDef.name] = componentOutputs[outputDef.name];
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
  nodes: WorkflowNode[],
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

  if (nodeType === 'constant') {
    const constantData = node.data as unknown as ConstantNodeData;
    const { valueType, value } = constantData;

    // Runtime type validation
    if (valueType === 'boolean' && typeof value !== 'boolean') {
      return {
        nodeId: node.id,
        status: 'failed',
        error: `Expected boolean, got ${typeof value}`,
        startTime,
        endTime: new Date().toISOString(),
      };
    }
    if (valueType === 'number' && typeof value !== 'number') {
      return {
        nodeId: node.id,
        status: 'failed',
        error: `Expected number, got ${typeof value}`,
        startTime,
        endTime: new Date().toISOString(),
      };
    }
    if (valueType === 'string' && typeof value !== 'string') {
      return {
        nodeId: node.id,
        status: 'failed',
        error: `Expected string, got ${typeof value}`,
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    return {
      nodeId: node.id,
      status: 'completed',
      output: `Constant: ${JSON.stringify(value)}`,
      rawOutput: String(value),
      structuredOutput: { value },  // Store typed value for proper output extraction
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
      inputValues,  // Pass input values for template injection
    });

    return {
      nodeId: node.id,
      status: result.success ? 'completed' : 'failed',
      output: result.output,
      rawOutput: result.output,
      structuredOutput: result.structuredOutput,  // Parsed JSON if schema was provided
      error: result.error,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  // Interface-input node: outputs workflow's external inputs
  // This node type is used inside composable workflows
  if (nodeType === 'interface-input') {
    // The outputs of this node are populated from the workflow's input values
    // which are passed via context.workflowInputs (set when running as component)
    return {
      nodeId: node.id,
      status: 'completed',
      output: 'Interface input node',
      rawOutput: JSON.stringify(context.workflowInputs || {}),
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  // Interface-output node: collects values for workflow's external outputs
  // This node's inputs become the workflow's outputs when used as a component
  if (nodeType === 'interface-output') {
    // Simply pass through - the actual output collection happens in executeWorkflow
    return {
      nodeId: node.id,
      status: 'completed',
      output: 'Interface output node',
      rawOutput: JSON.stringify(inputValues),
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  // Interface-continue node: controls loop iteration
  // This node receives a boolean 'continue' input that determines whether the loop continues
  if (nodeType === 'interface-continue') {
    // Pass through - the loop executor reads this value to decide continuation
    return {
      nodeId: node.id,
      status: 'completed',
      output: 'Interface continue node',
      rawOutput: JSON.stringify(inputValues),
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  // Component node: executes another workflow as a sub-workflow
  if (nodeType === 'component') {
    const workflowPath = node.data.workflowPath as string | undefined;

    if (!workflowPath) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: 'Component node requires workflowPath to be specified',
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    try {
      // Load the component workflow
      const componentWorkflow = await loadWorkflow(workflowPath, rootDirectory);
      const componentDir = getWorkflowDirectory(workflowPath, rootDirectory);

      // Execute the sub-workflow with our input values as its workflow inputs
      const subResult = await executeWorkflow(
        componentWorkflow.nodes.map(n => ({
          id: n.id,
          type: n.type,
          data: n.data as WorkflowNode['data'],
        })),
        componentWorkflow.edges,
        {
          rootDirectory: componentDir,
          workflowInputs: inputValues,  // Pass our inputs as the sub-workflow's inputs
        }
      );

      if (!subResult.success) {
        return {
          nodeId: node.id,
          status: 'failed',
          output: '',
          error: `Component workflow failed: ${subResult.error || 'Unknown error'}`,
          startTime,
          endTime: new Date().toISOString(),
        };
      }

      // Extract outputs from the component's interface-output node
      const interfaceOutputResult = subResult.results.find(
        r => componentWorkflow.nodes.find(n => n.id === r.nodeId)?.data.nodeType === 'interface-output'
      );

      return {
        nodeId: node.id,
        status: 'completed',
        output: 'Component executed successfully',
        rawOutput: interfaceOutputResult?.rawOutput || '{}',
        structuredOutput: interfaceOutputResult?.rawOutput ? JSON.parse(interfaceOutputResult.rawOutput) : undefined,
        startTime,
        endTime: new Date().toISOString(),
      };
    } catch (err) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: `Failed to execute component: ${(err as Error).message}`,
        startTime,
        endTime: new Date().toISOString(),
      };
    }
  }

  // Loop node: executes inner workflow iteratively until continue=false
  if (nodeType === 'loop') {
    if (!isLoopNodeData(node.data)) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: 'Invalid loop node data',
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    try {
      const loopResult = await executeLoop(
        node,                      // loopNode - for accessing parentId filtering
        node.data as LoopNodeData, // loopNodeData - loop configuration
        nodes,                     // allNodes - for finding child nodes by parentId
        edges,                     // allEdges - for finding internal edges
        inputValues,               // outerInputs - inputs from connected edges
        cwd,                       // rootDirectory
        executeWorkflow,           // executeWorkflowFn - for inner workflow execution
        {
          onIterationStart: (iteration) => {
            // Could add logging or callbacks here
          },
          onIterationComplete: (result) => {
            // Could add logging or callbacks here
          },
        }
      );

      if (!loopResult.success) {
        return {
          nodeId: node.id,
          status: 'failed',
          output: `Loop failed after ${loopResult.totalIterations} iterations`,
          rawOutput: JSON.stringify(loopResult.finalOutputs),
          error: loopResult.error,
          startTime,
          endTime: new Date().toISOString(),
        };
      }

      // Return success with final outputs
      const terminationNote = loopResult.terminationReason === 'max_iterations'
        ? ` (max iterations reached)`
        : '';

      return {
        nodeId: node.id,
        status: 'completed',
        output: `Loop completed after ${loopResult.totalIterations} iterations${terminationNote}`,
        rawOutput: JSON.stringify(loopResult.finalOutputs),
        structuredOutput: loopResult.finalOutputs,
        startTime,
        endTime: new Date().toISOString(),
      };
    } catch (err) {
      return {
        nodeId: node.id,
        status: 'failed',
        output: '',
        error: `Failed to execute loop: ${(err as Error).message}`,
        startTime,
        endTime: new Date().toISOString(),
      };
    }
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
  const { rootDirectory, startNodeId, startNodeIds, loopId, triggerInputs, workflowInputs, dockContext, onNodeStart, onNodeComplete } = options;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacency = buildAdjacencyMap(edges);

  const context: ExecutionContext = {
    outputs: new Map(),
    nodeLabels: new Map(nodes.map(n => [n.id, (n.data.label as string) || n.id])),
    triggerInputs,
    workflowInputs,
    dockContext,
  };

  let startNodes: string[];
  if (startNodeIds && startNodeIds.length > 0) {
    // Multiple start nodes specified (for loop inner workflows)
    startNodes = startNodeIds.filter(id => nodeMap.has(id));
    if (startNodes.length === 0) {
      throw new Error('No valid start nodes found');
    }
  } else if (startNodeId) {
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

    // Skip the loop node itself when executing inside that loop
    // This prevents the loop from re-executing itself when downstream edges lead back to it
    if (loopId && nodeId === loopId) {
      // Don't execute the loop container from within its own inner workflow
      continue;
    }

    // Skip nodes that have a parentId - they are children of container nodes (like loops)
    // and should only be executed by their parent, not by the main workflow
    // Exception: when we're inside a loop (indicated by loopId being set), allow execution
    // ONLY if the node's parentId matches the loop we're executing
    if (node.parentId) {
      const isOurChild = loopId && node.parentId === loopId;
      if (!isOurChild) {
        // This node belongs to a different parent (or we're not in a loop)
        // Don't execute it, but do continue traversing
        const downstream = adjacency.get(nodeId) || [];
        queue.push(...downstream);
        continue;
      }
    }

    executionOrder.push(nodeId);

    if (onNodeStart) {
      onNodeStart(nodeId, node);
    }

    // Ensure node has I/O definitions before processing
    const nodeWithIO = ensureNodeIO(node);

    // Resolve inputs from connected edges
    const { success: inputsResolved, inputValues, error: inputError } = resolveInputs(
      nodeId,
      nodeWithIO,
      edges,
      context
    );

    if (!inputsResolved) {
      // Input resolution failed
      const result: NodeResult = {
        nodeId,
        status: 'failed',
        error: inputError || 'Failed to resolve inputs',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
      };
      results.push(result);

      if (onNodeComplete) {
        onNodeComplete(nodeId, result);
      }

      const continueOnFailure = nodeWithIO.data.continueOnFailure === true;
      if (!continueOnFailure) {
        overallSuccess = false;
        break; // Stop workflow on input resolution failure (same as execution failure)
      }
      // Node failed but continueOnFailure is true - keep going but mark overall as failed
      overallSuccess = false;
      continue;
    }

    // Process templates with resolved input values
    const processedNode = processNodeTemplates(nodeWithIO, context, inputValues);
    const result = await executeNode(processedNode, rootDirectory || process.cwd(), nodes, edges, context);
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
    outputs: context.outputs,
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
    position: n.position,
    style: n.style,
    parentId: n.parentId,
    extent: n.extent,
    data: n.data as WorkflowNode['data'],
  }));

  const edges: WorkflowEdge[] = schema.edges;

  return executeWorkflow(nodes, edges, {
    ...options,
    rootDirectory: schema.metadata.rootDirectory,
  });
}
