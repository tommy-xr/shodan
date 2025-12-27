/**
 * Loop Executor
 *
 * Handles execution of loop nodes, which contain child nodes that
 * execute repeatedly until the interface-continue node receives false.
 *
 * Child nodes are identified by their `parentId` matching the loop node's ID.
 */

import type {
  WorkflowNode,
  WorkflowEdge,
  LoopNodeData,
} from '@shodan/core';
import { LOOP_NODE_DEFAULTS } from '@shodan/core';
import type { NodeResult, ExecuteOptions, ExecuteResult } from './executor.js';

/**
 * Validation error for loop nodes
 */
export class LoopValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopValidationError';
  }
}

/**
 * Result of a single loop iteration
 */
interface IterationResult {
  iteration: number;
  success: boolean;
  shouldContinue: boolean;
  outputs: Record<string, unknown>;
  nodeResults: NodeResult[];
  error?: string;
}

/**
 * Result of loop execution
 */
export interface LoopExecutionResult {
  success: boolean;
  iterations: IterationResult[];
  finalOutputs: Record<string, unknown>;
  totalIterations: number;
  terminationReason: 'condition' | 'max_iterations' | 'error';
  error?: string;
}

/**
 * Find interface nodes in a list of nodes
 */
function findInterfaceNodes(nodes: WorkflowNode[]): {
  interfaceInput: WorkflowNode | undefined;
  interfaceOutput: WorkflowNode | undefined;
  interfaceContinue: WorkflowNode | undefined;
} {
  let interfaceInput: WorkflowNode | undefined;
  let interfaceOutput: WorkflowNode | undefined;
  let interfaceContinue: WorkflowNode | undefined;

  for (const node of nodes) {
    const nodeType = node.data.nodeType || node.type;
    if (nodeType === 'interface-input') {
      interfaceInput = node;
    } else if (nodeType === 'interface-output') {
      interfaceOutput = node;
    } else if (nodeType === 'interface-continue') {
      interfaceContinue = node;
    }
  }

  return { interfaceInput, interfaceOutput, interfaceContinue };
}

/**
 * Get child nodes and edges for a loop by filtering on parentId
 */
export function getLoopInnerWorkflow(
  loopNodeId: string,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[]
): { innerNodes: WorkflowNode[]; innerEdges: WorkflowEdge[] } {
  // Get all child nodes that have this loop as their parent
  const innerNodes = allNodes.filter(n => n.parentId === loopNodeId);

  // Get edges where both source and target are inner nodes
  const innerNodeIds = new Set(innerNodes.map(n => n.id));
  const innerEdges = allEdges.filter(e =>
    innerNodeIds.has(e.source) && innerNodeIds.has(e.target)
  );

  return { innerNodes, innerEdges };
}

/**
 * Validate that a loop has all required interface nodes
 */
export function validateLoopWorkflow(
  loopNodeId: string,
  innerNodes: WorkflowNode[],
  innerEdges: WorkflowEdge[]
): void {
  const { interfaceInput, interfaceOutput, interfaceContinue } = findInterfaceNodes(innerNodes);

  if (!interfaceInput) {
    throw new LoopValidationError(
      `Loop '${loopNodeId}' must contain exactly one interface-input node`
    );
  }

  if (!interfaceOutput) {
    throw new LoopValidationError(
      `Loop '${loopNodeId}' must contain exactly one interface-output node`
    );
  }

  if (!interfaceContinue) {
    throw new LoopValidationError(
      `Loop '${loopNodeId}' must contain exactly one interface-continue node`
    );
  }

  // Validate that interface-continue has an incoming edge to its continue input
  const continueNodeId = interfaceContinue.id;
  const hasIncomingEdge = innerEdges.some(
    edge => edge.target === continueNodeId &&
      (edge.targetHandle === 'input:continue' || !edge.targetHandle)
  );

  if (!hasIncomingEdge) {
    throw new LoopValidationError(
      `Loop '${loopNodeId}': interface-continue node must have an incoming edge to its 'continue' input`
    );
  }
}

/**
 * Build workflow inputs for an iteration
 *
 * For interface-input, we provide:
 * - All outer inputs (from the loop node's incoming edges)
 * - iteration: the current iteration number (1-based)
 * - prev.*: the previous iteration's interface-output values (null on first iteration)
 */
function buildIterationInputs(
  outerInputs: Record<string, unknown>,
  iteration: number,
  prevOutputs: Record<string, unknown> | null
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    ...outerInputs,
    iteration,
  };

  // Add prev.* values
  if (prevOutputs) {
    for (const [key, value] of Object.entries(prevOutputs)) {
      inputs[`prev.${key}`] = value;
    }
  } else {
    // First iteration - prev.* values are null
    // We don't know what outputs to expect, so we don't add any
    // The workflow should handle missing prev.* gracefully
  }

  return inputs;
}

/**
 * Extract the continue value from interface-continue node results
 */
function extractContinueValue(
  nodeResults: NodeResult[],
  nodes: WorkflowNode[]
): boolean {
  // Find the interface-continue node
  const continueNode = nodes.find(
    n => (n.data.nodeType || n.type) === 'interface-continue'
  );

  if (!continueNode) {
    return false; // No continue node means stop
  }

  // Find the result for the continue node
  const continueResult = nodeResults.find(r => r.nodeId === continueNode.id);
  if (!continueResult) {
    return false; // No result means stop
  }

  // The continue value should be in the rawOutput or parsed from it
  // The interface-continue node receives its inputs via edges, and those inputs
  // are stored in context.outputs by the executor

  // Parse the rawOutput to get the continue value
  // The rawOutput for interface-continue is JSON of its input values
  try {
    if (continueResult.rawOutput) {
      const inputValues = JSON.parse(continueResult.rawOutput);
      const continueValue = inputValues.continue;

      // Handle various truthy/falsy representations
      if (typeof continueValue === 'boolean') {
        return continueValue;
      }
      if (typeof continueValue === 'string') {
        return continueValue.toLowerCase() === 'true';
      }
      return Boolean(continueValue);
    }
  } catch {
    // Parse error - default to stop
  }

  return false;
}

/**
 * Extract output values from interface-output node results
 */
function extractOutputValues(
  nodeResults: NodeResult[],
  nodes: WorkflowNode[]
): Record<string, unknown> {
  // Find the interface-output node
  const outputNode = nodes.find(
    n => (n.data.nodeType || n.type) === 'interface-output'
  );

  if (!outputNode) {
    return {};
  }

  // Find the result for the output node
  const outputResult = nodeResults.find(r => r.nodeId === outputNode.id);
  if (!outputResult) {
    return {};
  }

  // The rawOutput for interface-output is JSON of its input values
  try {
    if (outputResult.rawOutput) {
      return JSON.parse(outputResult.rawOutput);
    }
  } catch {
    // Parse error - return empty
  }

  return {};
}

/**
 * Execute a loop node
 *
 * This is the main entry point for loop execution. It:
 * 1. Gets child nodes/edges by filtering on parentId
 * 2. Validates the inner workflow structure
 * 3. Runs iterations until continue=false or maxIterations reached
 * 4. Collects and returns the final outputs
 */
export async function executeLoop(
  loopNode: WorkflowNode,
  loopNodeData: LoopNodeData,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
  outerInputs: Record<string, unknown>,
  rootDirectory: string,
  executeWorkflowFn: (
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    options: ExecuteOptions
  ) => Promise<ExecuteResult>,
  options: {
    onIterationStart?: (iteration: number) => void;
    onIterationComplete?: (result: IterationResult) => void;
  } = {}
): Promise<LoopExecutionResult> {
  const maxIterations = loopNodeData.maxIterations ?? LOOP_NODE_DEFAULTS.maxIterations;

  // Get child nodes and edges by filtering on parentId
  const { innerNodes, innerEdges } = getLoopInnerWorkflow(loopNode.id, allNodes, allEdges);

  if (innerNodes.length === 0) {
    return {
      success: false,
      iterations: [],
      finalOutputs: {},
      totalIterations: 0,
      terminationReason: 'error',
      error: `Loop '${loopNode.id}' has no child nodes (no nodes with parentId='${loopNode.id}')`,
    };
  }

  // Validate the inner workflow structure
  try {
    validateLoopWorkflow(loopNode.id, innerNodes, innerEdges);
  } catch (err) {
    return {
      success: false,
      iterations: [],
      finalOutputs: {},
      totalIterations: 0,
      terminationReason: 'error',
      error: (err as Error).message,
    };
  }

  // Prepare nodes for execution
  const nodes: WorkflowNode[] = innerNodes.map(n => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  }));
  const edges = innerEdges;

  // Get the interface-output node to know what prev.* outputs to provide
  const { interfaceOutput } = findInterfaceNodes(nodes);
  const outputInputs = interfaceOutput?.data.inputs || [];

  // Execution loop
  const iterations: IterationResult[] = [];
  let prevOutputs: Record<string, unknown> | null = null;
  let shouldContinue = true;
  let iteration = 0;

  while (shouldContinue && iteration < maxIterations) {
    iteration++;

    if (options.onIterationStart) {
      options.onIterationStart(iteration);
    }

    // Build inputs for this iteration
    const iterationInputs = buildIterationInputs(outerInputs, iteration, prevOutputs);

    // If first iteration, add null prev.* values for all expected outputs
    if (iteration === 1 && outputInputs.length > 0) {
      for (const input of outputInputs) {
        if (!(`prev.${input.name}` in iterationInputs)) {
          iterationInputs[`prev.${input.name}`] = null;
        }
      }
    }

    // Execute the inner workflow
    const workflowResult = await executeWorkflowFn(nodes, edges, {
      rootDirectory,
      workflowInputs: iterationInputs,
    });

    // Extract outputs from interface-output
    const outputs = extractOutputValues(workflowResult.results, nodes);

    // Extract continue value from interface-continue
    shouldContinue = workflowResult.success &&
      extractContinueValue(workflowResult.results, nodes);

    const iterationResult: IterationResult = {
      iteration,
      success: workflowResult.success,
      shouldContinue,
      outputs,
      nodeResults: workflowResult.results,
      error: workflowResult.error,
    };

    iterations.push(iterationResult);

    if (options.onIterationComplete) {
      options.onIterationComplete(iterationResult);
    }

    // If workflow failed, stop immediately
    if (!workflowResult.success) {
      return {
        success: false,
        iterations,
        finalOutputs: outputs,
        totalIterations: iteration,
        terminationReason: 'error',
        error: workflowResult.error || 'Inner workflow failed',
      };
    }

    // Store outputs for next iteration's prev.* values
    prevOutputs = outputs;
  }

  // Determine termination reason
  const terminationReason: 'condition' | 'max_iterations' =
    iteration >= maxIterations ? 'max_iterations' : 'condition';

  // Final outputs come from the last iteration
  const finalOutputs = iterations.length > 0
    ? iterations[iterations.length - 1].outputs
    : {};

  return {
    success: true,
    iterations,
    finalOutputs,
    totalIterations: iteration,
    terminationReason,
  };
}
