import { spawn } from 'child_process';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface WorkflowNode {
  id: string;
  type: string;
  data: {
    label?: string;
    nodeType?: string;
    commands?: string[];
    scriptFiles?: string[];
    path?: string;
    prompt?: string;
    [key: string]: unknown;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
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
  onNodeStart?: (nodeId: string, node: WorkflowNode) => void;
  onNodeComplete?: (nodeId: string, result: NodeResult) => void;
}

/**
 * Execution context - stores outputs from executed nodes
 */
interface ExecutionContext {
  outputs: Map<string, string>;
  nodeLabels: Map<string, string>;
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
 * Replace template variables in a string
 */
function replaceTemplates(text: string, context: ExecutionContext): string {
  const templateRegex = /\{\{\s*([a-zA-Z0-9_-]+)\.output\s*\}\}/g;

  return text.replace(templateRegex, (match, identifier) => {
    if (context.outputs.has(identifier)) {
      return context.outputs.get(identifier) || '';
    }

    for (const [nodeId, label] of context.nodeLabels) {
      const normalizedLabel = label.toLowerCase().replace(/\s+/g, '_');
      if (normalizedLabel === identifier.toLowerCase() || label === identifier) {
        if (context.outputs.has(nodeId)) {
          return context.outputs.get(nodeId) || '';
        }
      }
    }

    return match;
  });
}

/**
 * Process node data, replacing template variables
 */
function processNodeTemplates(node: WorkflowNode, context: ExecutionContext): WorkflowNode {
  const processedData = { ...node.data };

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
): Promise<{ output: string; exitCode: number }> {
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
        exitCode: code ?? 0,
      });
    });

    proc.on('error', (err) => {
      resolve({
        output: `Failed to start process: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}

/**
 * Execute a single node
 */
async function executeNode(
  node: WorkflowNode,
  rootDirectory: string
): Promise<NodeResult> {
  const startTime = new Date().toISOString();
  const nodeType = node.data.nodeType || node.type;
  const cwd = (node.data.path as string) || rootDirectory || process.cwd();

  if (nodeType === 'shell') {
    const commands = (node.data.commands as string[]) || [];

    if (commands.length === 0) {
      return {
        nodeId: node.id,
        status: 'completed',
        output: '(no commands to execute)',
        startTime,
        endTime: new Date().toISOString(),
      };
    }

    const outputs: string[] = [];
    let lastExitCode = 0;

    for (const command of commands) {
      if (!command.trim()) continue;

      const result = await executeShellCommand(command, cwd);
      outputs.push(`$ ${command}\n${result.output}`);
      lastExitCode = result.exitCode;

      if (result.exitCode !== 0) {
        return {
          nodeId: node.id,
          status: 'failed',
          output: outputs.join('\n\n'),
          exitCode: result.exitCode,
          error: `Command failed with exit code ${result.exitCode}`,
          startTime,
          endTime: new Date().toISOString(),
        };
      }
    }

    return {
      nodeId: node.id,
      status: 'completed',
      output: outputs.join('\n\n'),
      exitCode: lastExitCode,
      startTime,
      endTime: new Date().toISOString(),
    };
  }

  if (nodeType === 'trigger') {
    return {
      nodeId: node.id,
      status: 'completed',
      output: 'Trigger activated',
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
  const { rootDirectory, startNodeId, onNodeStart, onNodeComplete } = options;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacency = buildAdjacencyMap(edges);

  const context: ExecutionContext = {
    outputs: new Map(),
    nodeLabels: new Map(nodes.map(n => [n.id, (n.data.label as string) || n.id])),
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

  while (queue.length > 0 && overallSuccess) {
    const nodeId = queue.shift()!;

    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    executionOrder.push(nodeId);

    if (onNodeStart) {
      onNodeStart(nodeId, node);
    }

    const processedNode = processNodeTemplates(node, context);
    const result = await executeNode(processedNode, rootDirectory || process.cwd());
    results.push(result);

    if (onNodeComplete) {
      onNodeComplete(nodeId, result);
    }

    if (result.output) {
      const rawOutput = result.output
        .split('\n')
        .filter(line => !line.startsWith('$ '))
        .join('\n')
        .trim();
      context.outputs.set(nodeId, rawOutput);
    }

    if (result.status === 'failed') {
      overallSuccess = false;
      break;
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
