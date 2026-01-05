/**
 * Node Port Defaults
 *
 * Centralized definition of standard input/output ports for each node type.
 * This serves as the single source of truth for:
 * - Designer UI (default ports when creating nodes)
 * - Executor validation (ensuring required ports exist)
 * - Workflow validation (schema consistency checks)
 */

import type { PortDefinition } from './io-types.js';

/**
 * Standard port definitions for each node type
 */
export interface NodePortDefaults {
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}

/**
 * Node types that have predefined port structures
 */
export type StandardNodeType =
  | 'trigger'
  | 'agent'
  | 'shell'
  | 'constant'
  | 'function'
  | 'workdir'
  | 'wire';

/**
 * Standard ports for each node type
 *
 * These represent the "well-known" ports that the executor understands.
 * Nodes can define additional custom ports beyond these.
 */
export const NODE_PORT_DEFAULTS: Record<StandardNodeType, NodePortDefaults> = {
  trigger: {
    inputs: [],
    outputs: [
      { name: 'timestamp', type: 'string', description: 'Trigger timestamp (ISO format)' },
      { name: 'type', type: 'string', description: 'Trigger type (manual, cron, etc.)' },
      { name: 'text', type: 'string', description: 'Input text (for manual triggers)' },
      { name: 'params', type: 'json', description: 'Additional trigger parameters' },
    ],
  },

  agent: {
    inputs: [
      { name: 'prompt', type: 'string', required: false, description: 'Override prompt (optional)' },
      { name: 'sessionId', type: 'string', required: false, description: 'Session ID to resume (optional)' },
    ],
    outputs: [
      { name: 'output', type: 'string', description: 'Agent response text' },
      { name: 'sessionId', type: 'string', description: 'Session ID for continuation' },
      { name: 'exitCode', type: 'number', description: 'Exit code (0 = success)' },
    ],
  },

  shell: {
    inputs: [
      { name: 'input', type: 'any', required: false, description: 'Generic input for template interpolation' },
    ],
    outputs: [
      { name: 'output', type: 'string', description: 'Combined stdout output' },
      { name: 'stdout', type: 'string', description: 'Standard output' },
      { name: 'stderr', type: 'string', description: 'Standard error' },
      { name: 'exitCode', type: 'number', description: 'Exit code (0 = success)' },
    ],
  },

  constant: {
    inputs: [],
    outputs: [
      { name: 'value', type: 'any', description: 'The constant value' },
    ],
  },

  function: {
    inputs: [
      { name: 'value', type: 'any', required: false, description: 'Input value' },
    ],
    outputs: [
      { name: 'result', type: 'any', description: 'Function result' },
    ],
  },

  workdir: {
    inputs: [],
    outputs: [
      { name: 'path', type: 'string', description: 'The working directory path' },
    ],
  },

  wire: {
    inputs: [
      { name: 'value', type: 'any', required: false, description: 'Input value to pass through' },
    ],
    outputs: [
      { name: 'value', type: 'any', description: 'Pass-through value' },
    ],
  },
};

/**
 * Get default ports for a node type
 * Returns undefined for dynamic node types (loop, component, interface-*)
 */
export function getNodePortDefaults(nodeType: string): NodePortDefaults | undefined {
  return NODE_PORT_DEFAULTS[nodeType as StandardNodeType];
}

/**
 * Get the list of well-known output port names for a node type
 */
export function getWellKnownOutputs(nodeType: string): string[] {
  const defaults = getNodePortDefaults(nodeType);
  return defaults?.outputs.map(p => p.name) || [];
}

/**
 * Get the list of well-known input port names for a node type
 */
export function getWellKnownInputs(nodeType: string): string[] {
  const defaults = getNodePortDefaults(nodeType);
  return defaults?.inputs.map(p => p.name) || [];
}

/**
 * Check if a port name is a well-known port for a node type
 */
export function isWellKnownPort(nodeType: string, portName: string, direction: 'input' | 'output'): boolean {
  const defaults = getNodePortDefaults(nodeType);
  if (!defaults) return false;

  const ports = direction === 'input' ? defaults.inputs : defaults.outputs;
  return ports.some(p => p.name === portName);
}

/**
 * Merge user-defined ports with defaults
 * User ports override defaults with the same name
 */
export function mergeWithDefaults(
  nodeType: string,
  userInputs?: PortDefinition[],
  userOutputs?: PortDefinition[]
): NodePortDefaults {
  const defaults = getNodePortDefaults(nodeType);

  if (!defaults) {
    return {
      inputs: userInputs || [],
      outputs: userOutputs || [],
    };
  }

  // Merge inputs: user ports override defaults
  const inputNames = new Set(userInputs?.map(p => p.name) || []);
  const mergedInputs = [
    ...defaults.inputs.filter(p => !inputNames.has(p.name)),
    ...(userInputs || []),
  ];

  // Merge outputs: user ports override defaults
  const outputNames = new Set(userOutputs?.map(p => p.name) || []);
  const mergedOutputs = [
    ...defaults.outputs.filter(p => !outputNames.has(p.name)),
    ...(userOutputs || []),
  ];

  return {
    inputs: mergedInputs,
    outputs: mergedOutputs,
  };
}
