/**
 * Workflow Schema Types
 *
 * Core types for defining workflow structure - nodes, edges, and schema.
 * These are shared between server, designer, and CLI packages.
 */

import type { PortDefinition } from './io-types.js';

/**
 * Workflow node - a single node in the workflow graph
 */
export interface WorkflowNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  style?: { width?: number; height?: number };  // Container dimensions

  // Parent-child relationships (for sub-flows like loops)
  parentId?: string;         // ID of parent container node
  extent?: 'parent';         // Constrain movement within parent

  data: WorkflowNodeData;
}

/**
 * Workflow node data - configuration for a node
 */
export interface WorkflowNodeData {
  label?: string;
  nodeType?: string;

  // I/O definitions
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];

  // Execution options
  continueOnFailure?: boolean;

  // Shell node fields
  script?: string;
  commands?: string[];  // Legacy
  scriptFiles?: string[];

  // Script node fields
  scriptFile?: string;
  scriptArgs?: string;

  // Agent node fields
  prompt?: string;
  promptFiles?: string[];
  runner?: string;
  model?: string;
  outputSchema?: string;

  // Trigger node fields
  triggerType?: string;
  cron?: string;
  idleMinutes?: number;

  // Working directory node fields
  path?: string;

  // Component node fields
  workflowPath?: string;
  componentInputs?: Record<string, unknown>;

  // Loop node fields
  maxIterations?: number;
  // Note: Loop child nodes use parentId instead of inlineWorkflow

  // Allow additional fields
  [key: string]: unknown;
}

/**
 * Workflow edge - a connection between two nodes
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;  // Format: "output:outputName"
  targetHandle?: string;  // Format: "input:inputName"
}

/**
 * Workflow interface - external I/O when used as a component
 */
export interface WorkflowInterface {
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
}

/**
 * Complete workflow schema - the full workflow definition
 */
export interface WorkflowSchema {
  version: number;
  metadata: {
    name: string;
    description?: string;
    rootDirectory?: string;
  };
  interface?: WorkflowInterface;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/**
 * Current workflow schema version
 */
export const WORKFLOW_SCHEMA_VERSION = 2;
