/**
 * Execution types shared between server and designer
 */

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

/**
 * Execution events streamed from server to client during workflow execution.
 * Uses SSE format (data: {...}\n\n) over streaming HTTP POST response.
 */
export type ExecutionEvent =
  | { type: 'node-start'; nodeId: string; timestamp: number }
  | { type: 'node-complete'; nodeId: string; result: NodeResult; timestamp: number }
  | { type: 'node-output'; nodeId: string; chunk: string; timestamp: number }
  | { type: 'edge-executed'; edgeId: string; sourceNodeId: string; timestamp: number }
  | { type: 'iteration-start'; loopId: string; iteration: number; timestamp: number }
  | { type: 'iteration-complete'; loopId: string; iteration: number; success: boolean; timestamp: number }
  | { type: 'workflow-complete'; success: boolean; error?: string; timestamp: number };

/**
 * Extract specific event types
 */
export type NodeStartEvent = Extract<ExecutionEvent, { type: 'node-start' }>;
export type NodeCompleteEvent = Extract<ExecutionEvent, { type: 'node-complete' }>;
export type NodeOutputEvent = Extract<ExecutionEvent, { type: 'node-output' }>;
export type EdgeExecutedEvent = Extract<ExecutionEvent, { type: 'edge-executed' }>;
export type IterationStartEvent = Extract<ExecutionEvent, { type: 'iteration-start' }>;
export type IterationCompleteEvent = Extract<ExecutionEvent, { type: 'iteration-complete' }>;
export type WorkflowCompleteEvent = Extract<ExecutionEvent, { type: 'workflow-complete' }>;
