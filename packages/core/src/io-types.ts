/**
 * Input/Output System Types
 *
 * This file defines the core types for the unified input/output system
 * for Shodan workflow nodes.
 */

/**
 * Basic value types that can flow between nodes
 */
export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'      // Arbitrary JSON object
  | 'file'      // File path reference
  | 'files'     // Array of file paths
  | 'any';      // Accepts anything (for backwards compat)

/**
 * Output extraction configuration
 * Defines how to extract a specific output value from execution results
 */
export interface OutputExtraction {
  type: 'regex' | 'json_path' | 'full';
  pattern?: string;  // Regex pattern (capture group 1) or JSONPath expression
}

/**
 * Port definition - represents an input or output port on a node
 */
export interface PortDefinition {
  name: string;           // Unique identifier within the node
  label?: string;         // Human-readable label
  type: ValueType;
  required?: boolean;     // For inputs: is this required?
  default?: unknown;      // For inputs: default value if not connected
  description?: string;   // Help text
  schema?: object;        // JSON Schema for 'json' type validation
  extract?: OutputExtraction;  // For outputs: how to extract value from execution result
}

/**
 * Node I/O definition
 */
export interface NodeIO {
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
}

/**
 * Runtime-only state for node execution (NOT persisted to workflow files)
 * These values exist in the execution context or runtime store
 */
export interface NodeRuntimeState {
  inputValues?: Record<string, unknown>;
  outputValues?: Record<string, unknown>;
  executionStatus?: 'pending' | 'running' | 'completed' | 'failed';
}
