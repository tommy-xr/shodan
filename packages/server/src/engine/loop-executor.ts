/**
 * Loop Executor - Dock-Based Model
 *
 * Handles execution of loop nodes using the dock-based UI model.
 * Child nodes are identified by their `parentId` matching the loop node's ID.
 *
 * Dock slots:
 * - iteration: Output (●→) - provides current iteration number (1-based)
 * - continue: Input (→●) - receives boolean to control looping
 * - feedback: Bidirectional (●→ + →●) - prev value out, current value in
 *
 * Handle ID format:
 * - dock:iteration:output
 * - dock:continue:input
 * - dock:{name}:prev (feedback output)
 * - dock:{name}:current (feedback input)
 */

import type {
  WorkflowNode,
  WorkflowEdge,
  LoopNodeData,
  DockSlot,
  NodeResult,
} from '@shodan/core';
import { LOOP_NODE_DEFAULTS } from '@shodan/core';
import type { ExecuteOptions, ExecuteResult } from './executor.js';

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
  feedbackValues: Record<string, unknown>;
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
 * Categorized edges for loop execution
 */
interface CategorizedEdges {
  // Edges entirely within inner nodes
  innerEdges: WorkflowEdge[];
  // Edges from dock outputs to inner nodes (dock:*:output/prev -> inner node)
  dockOutputEdges: WorkflowEdge[];
  // Edges from inner nodes to dock inputs (inner node -> dock:*:input/current)
  dockInputEdges: WorkflowEdge[];
  // Edges from inner nodes to external nodes (deferred until loop completes)
  deferredEdges: WorkflowEdge[];
  // Edges from external to loop's external inputs
  externalInputEdges: WorkflowEdge[];
}

/**
 * Get child nodes and categorize edges for a loop
 */
export function getLoopInnerWorkflow(
  loopNode: WorkflowNode,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[]
): { innerNodes: WorkflowNode[]; categorizedEdges: CategorizedEdges } {
  const loopNodeId = loopNode.id;

  // Get all child nodes that have this loop as their parent
  const innerNodes = allNodes.filter(n => n.parentId === loopNodeId);
  const innerNodeIds = new Set(innerNodes.map(n => n.id));

  // Categorize edges
  const innerEdges: WorkflowEdge[] = [];
  const dockOutputEdges: WorkflowEdge[] = [];
  const dockInputEdges: WorkflowEdge[] = [];
  const deferredEdges: WorkflowEdge[] = [];
  const externalInputEdges: WorkflowEdge[] = [];

  for (const edge of allEdges) {
    const sourceIsInner = innerNodeIds.has(edge.source);
    const targetIsInner = innerNodeIds.has(edge.target);
    const sourceIsLoop = edge.source === loopNodeId;
    const targetIsLoop = edge.target === loopNodeId;

    // Check for dock handles
    const sourceIsDockOutput = sourceIsLoop && edge.sourceHandle?.startsWith('dock:') &&
      (edge.sourceHandle.endsWith(':output') || edge.sourceHandle.endsWith(':prev'));
    const targetIsDockInput = targetIsLoop && edge.targetHandle?.startsWith('dock:') &&
      (edge.targetHandle.endsWith(':input') || edge.targetHandle.endsWith(':current'));
    // Also handle edges from loop's input ports to inner nodes (e.g., "input:target")
    const sourceIsLoopInput = sourceIsLoop && edge.sourceHandle?.startsWith('input:');
    // Handle edges from inner nodes to loop's internal output handles (e.g., "output:final:internal")
    const targetIsLoopOutputInternal = targetIsLoop && edge.targetHandle?.startsWith('output:') &&
      edge.targetHandle.endsWith(':internal');

    if (sourceIsInner && targetIsInner) {
      // Both ends are inner nodes
      innerEdges.push(edge);
    } else if ((sourceIsDockOutput || sourceIsLoopInput) && targetIsInner) {
      // From dock output/prev OR loop input to inner node
      dockOutputEdges.push(edge);
    } else if (sourceIsInner && (targetIsDockInput || targetIsLoopOutputInternal)) {
      // From inner node to dock input/current OR to loop's internal output
      dockInputEdges.push(edge);
    } else if (sourceIsInner && !targetIsInner && !targetIsLoop) {
      // From inner node to external node (deferred)
      deferredEdges.push(edge);
    } else if (!sourceIsInner && !sourceIsLoop && targetIsLoop) {
      // From external to loop's external inputs
      externalInputEdges.push(edge);
    }
    // Note: edges from loop's external inputs to inner nodes are handled separately
    // when we inject outer inputs
  }

  return {
    innerNodes,
    categorizedEdges: {
      innerEdges,
      dockOutputEdges,
      dockInputEdges,
      deferredEdges,
      externalInputEdges,
    },
  };
}

/**
 * Validate dock-based loop workflow
 */
export function validateLoopWorkflow(
  loopNode: WorkflowNode,
  loopData: LoopNodeData,
  innerNodes: WorkflowNode[],
  categorizedEdges: CategorizedEdges
): void {
  const dockSlots = loopData.dockSlots || [];

  // Check for required continue slot
  const continueSlot = dockSlots.find(s => s.type === 'continue');
  if (!continueSlot) {
    throw new LoopValidationError(
      `Loop '${loopNode.id}' must have a 'continue' dock slot`
    );
  }

  // Validate that continue slot has an incoming edge
  const hasContinueEdge = categorizedEdges.dockInputEdges.some(
    edge => edge.targetHandle === 'dock:continue:input' ||
            edge.targetHandle === `dock:${continueSlot.name}:input`
  );

  if (!hasContinueEdge) {
    throw new LoopValidationError(
      `Loop '${loopNode.id}': continue dock slot must have an incoming edge from an inner node`
    );
  }
}

/**
 * Build dock outputs for an iteration
 *
 * Returns a map of handle IDs to values:
 * - dock:iteration:output -> iteration number
 * - dock:{name}:prev -> previous iteration's feedback value (null on first iteration)
 * - input:{name} -> loop's external input value (for passing to inner nodes)
 */
function buildDockOutputs(
  dockSlots: DockSlot[],
  iteration: number,
  feedbackValues: Record<string, unknown>,
  outerInputs: Record<string, unknown>
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};

  for (const slot of dockSlots) {
    if (slot.type === 'iteration') {
      outputs[`dock:${slot.name}:output`] = iteration;
    } else if (slot.type === 'feedback') {
      outputs[`dock:${slot.name}:prev`] = feedbackValues[slot.name] ?? null;
    }
  }

  // Include loop's external inputs for edges that pass them to inner nodes
  for (const [inputName, value] of Object.entries(outerInputs)) {
    outputs[`input:${inputName}`] = value;
  }

  return outputs;
}

/**
 * Extract dock inputs from execution results
 *
 * Reads values that were sent to dock input ports:
 * - dock:continue:input -> boolean
 * - dock:{name}:current -> feedback value
 */
function extractDockInputs(
  dockSlots: DockSlot[],
  dockInputEdges: WorkflowEdge[],
  executionContext: Record<string, Record<string, unknown>>
): { shouldContinue: boolean; newFeedbackValues: Record<string, unknown> } {
  let shouldContinue = false;
  const newFeedbackValues: Record<string, unknown> = {};

  // Find the continue slot name (it may not be "continue")
  const continueSlot = dockSlots.find(s => s.type === 'continue');
  const continueHandleName = continueSlot ? `dock:${continueSlot.name}:input` : 'dock:continue:input';

  for (const edge of dockInputEdges) {
    const targetHandle = edge.targetHandle || '';
    const sourceNodeId = edge.source;
    const sourceHandle = edge.sourceHandle || 'output';

    // Get the output value from the source node
    const sourceOutputs = executionContext[sourceNodeId] || {};

    // Extract output name from handle (e.g., "output:result" -> "result")
    const outputName = sourceHandle.startsWith('output:')
      ? sourceHandle.slice(7)
      : sourceHandle;
    const value = sourceOutputs[outputName];

    if (targetHandle === continueHandleName) {
      // Handle continue value
      if (typeof value === 'boolean') {
        shouldContinue = value;
      } else if (typeof value === 'string') {
        shouldContinue = value.toLowerCase() === 'true';
      } else {
        shouldContinue = Boolean(value);
      }
    } else if (targetHandle.endsWith(':current')) {
      // Handle feedback value
      // Extract slot name from handle (e.g., "dock:feedback:current" -> "feedback")
      const match = targetHandle.match(/^dock:(.+):current$/);
      if (match) {
        const slotName = match[1];
        newFeedbackValues[slotName] = value;
      }
    }
  }

  return { shouldContinue, newFeedbackValues };
}

/**
 * Build workflow inputs that inject dock outputs into the inner workflow
 *
 * This creates pseudo-input values that the inner workflow can access via edges
 * from dock output ports.
 */
function buildIterationInputs(
  outerInputs: Record<string, unknown>,
  dockOutputs: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...outerInputs,
    // Dock outputs are injected as special input values
    // The executor will resolve these when processing dockOutputEdges
    __dockOutputs: dockOutputs,
  };
}

/**
 * Execute a loop node using the dock-based model
 *
 * This is the main entry point for loop execution. It:
 * 1. Gets child nodes/edges by filtering on parentId
 * 2. Validates dock slot configuration
 * 3. Runs iterations until continue=false or maxIterations reached
 * 4. Returns the final outputs (from deferred edges)
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
  parentOptions: ExecuteOptions = {}
): Promise<LoopExecutionResult> {
  // Extract iteration callbacks from parent options
  const { onIterationStart, onIterationComplete } = parentOptions;
  const maxIterations = loopNodeData.maxIterations ?? LOOP_NODE_DEFAULTS.maxIterations;
  const dockSlots = loopNodeData.dockSlots || [];

  // Get child nodes and categorize edges
  const { innerNodes, categorizedEdges } = getLoopInnerWorkflow(loopNode, allNodes, allEdges);

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

  // Validate the loop configuration
  try {
    validateLoopWorkflow(loopNode, loopNodeData, innerNodes, categorizedEdges);
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

  // Pass all nodes to inner workflow - this is needed for nested loops
  // The main executor will skip nodes with parentId that aren't direct children
  // But nested loops need to find their children in allNodes
  const nodes: WorkflowNode[] = allNodes;

  // Pass all edges to inner workflow - nested loops need access to all edges
  // to find their own inner edges. The edge categorization happens at each level.
  const edges = allEdges;

  // Execution loop
  const iterations: IterationResult[] = [];
  let feedbackValues: Record<string, unknown> = {};
  let shouldContinue = true;
  let iteration = 0;
  let lastExecutionContext: Record<string, Record<string, unknown>> = {};

  while (shouldContinue && iteration < maxIterations) {
    iteration++;

    // Fire iteration start callback
    if (onIterationStart) {
      onIterationStart(loopNode.id, iteration);
    }

    // Build dock outputs for this iteration
    const dockOutputs = buildDockOutputs(dockSlots, iteration, feedbackValues, outerInputs);

    // Build workflow inputs with dock outputs
    const iterationInputs = buildIterationInputs(outerInputs, dockOutputs);

    // Create virtual input values for nodes connected to dock outputs
    // We need to pre-populate the context with dock output values
    const dockNodeContext: Record<string, unknown> = {};
    for (const edge of categorizedEdges.dockOutputEdges) {
      const sourceHandle = edge.sourceHandle || '';
      const value = dockOutputs[sourceHandle];
      if (value !== undefined) {
        // Store the value keyed by edge target for injection
        dockNodeContext[`${edge.target}:${edge.targetHandle}`] = value;
      }
    }

    // Execute the inner workflow
    // Use innerNode IDs as start nodes (not the main workflow's trigger)
    const innerNodeIds = innerNodes.map(n => n.id);
    const workflowResult = await executeWorkflowFn(nodes, edges, {
      // Forward streaming callbacks from parent
      ...parentOptions,
      rootDirectory,
      workflowInputs: iterationInputs,
      startNodeIds: innerNodeIds,  // Start from the loop's direct children
      loopId: loopNode.id,         // ID of this loop (for filtering nested children)
      // Pass dock context for edge resolution
      dockContext: {
        dockOutputs,
        dockOutputEdges: categorizedEdges.dockOutputEdges,
      },
    });

    // Use the outputs map from workflow execution (contains extracted values)
    const executionContext: Record<string, Record<string, unknown>> = {};
    for (const [nodeId, outputs] of workflowResult.outputs) {
      executionContext[nodeId] = outputs;
    }

    lastExecutionContext = executionContext;

    // Extract dock inputs (continue and feedback values)
    const dockInputs = extractDockInputs(
      dockSlots,
      categorizedEdges.dockInputEdges,
      executionContext
    );

    shouldContinue = workflowResult.success && dockInputs.shouldContinue;

    const iterationResult: IterationResult = {
      iteration,
      success: workflowResult.success,
      shouldContinue: dockInputs.shouldContinue,
      feedbackValues: dockInputs.newFeedbackValues,
      nodeResults: workflowResult.results,
      error: workflowResult.error,
    };

    iterations.push(iterationResult);

    // Fire iteration complete callback
    if (onIterationComplete) {
      onIterationComplete(loopNode.id, iteration, iterationResult.success);
    }

    // If workflow failed, stop immediately
    if (!workflowResult.success) {
      return {
        success: false,
        iterations,
        finalOutputs: {},
        totalIterations: iteration,
        terminationReason: 'error',
        error: workflowResult.error || 'Inner workflow failed',
      };
    }

    // Store feedback values for next iteration
    feedbackValues = { ...feedbackValues, ...dockInputs.newFeedbackValues };
  }

  // Determine termination reason
  const terminationReason: 'condition' | 'max_iterations' =
    iteration >= maxIterations ? 'max_iterations' : 'condition';

  // Build final outputs from deferred edges and internal output edges
  const finalOutputs: Record<string, unknown> = {};

  // Deferred edges: from inner nodes to external nodes
  for (const edge of categorizedEdges.deferredEdges) {
    const sourceNodeContext = lastExecutionContext[edge.source] || {};
    const sourceHandle = edge.sourceHandle || 'output';
    const outputName = sourceHandle.startsWith('output:')
      ? sourceHandle.slice(7)
      : sourceHandle;
    const value = sourceNodeContext[outputName];

    // Key by target handle for the external node to consume
    const targetKey = edge.targetHandle || `from_${edge.source}`;
    finalOutputs[targetKey] = value;
  }

  // Internal output edges: from inner nodes to loop's output:*:internal handles
  for (const edge of categorizedEdges.dockInputEdges) {
    if (edge.targetHandle?.startsWith('output:') && edge.targetHandle.endsWith(':internal')) {
      const sourceNodeContext = lastExecutionContext[edge.source] || {};
      const sourceHandle = edge.sourceHandle || 'output';
      const outputName = sourceHandle.startsWith('output:')
        ? sourceHandle.slice(7)
        : sourceHandle;
      const value = sourceNodeContext[outputName];

      // Extract the output name from "output:name:internal"
      const loopOutputName = edge.targetHandle.slice(7, -9); // Remove "output:" and ":internal"
      finalOutputs[loopOutputName] = value;
    }
  }

  return {
    success: true,
    iterations,
    finalOutputs,
    totalIterations: iteration,
    terminationReason,
  };
}
