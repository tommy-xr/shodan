/**
 * Function Node Types
 *
 * Types for function nodes that execute TypeScript/JavaScript code
 * with structured inputs and outputs.
 */

export interface FunctionNodeInput {
  name: string;
  type: string;
  required?: boolean;
}

export interface FunctionNodeOutput {
  name: string;
  type: string;
}

export interface FunctionNodeData {
  nodeType: 'function';
  label?: string;

  /**
   * Inline mode - TypeScript/JavaScript code string executed directly.
   * The code should return an object with output values.
   * Example: "return { result: inputs.a + inputs.b }"
   */
  code?: string;

  /**
   * File mode - path to TypeScript file with default export function.
   * The file should export a default function that takes inputs and returns outputs.
   * Example: "scripts/logic/and.ts"
   */
  file?: string;

  /**
   * Explicit input definitions for the function.
   * These define the input ports shown on the node.
   */
  inputs?: FunctionNodeInput[];

  /**
   * Explicit output definitions for the function.
   * These define the output ports shown on the node.
   */
  outputs?: FunctionNodeOutput[];
}

/**
 * Supported value types for function inputs/outputs
 */
export type FunctionValueType = 'boolean' | 'number' | 'string' | 'object' | 'any';

/**
 * Coerce a value to a target type based on declared input type.
 * Used when passing values between nodes with different output/input types.
 */
export function coerceValue(value: unknown, targetType: string): unknown {
  if (value === undefined || value === null) return value;

  switch (targetType) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
      }
      return Boolean(value);

    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const num = parseFloat(value);
        if (!isNaN(num)) return num;
      }
      return value; // Can't coerce, leave as-is

    case 'string':
      if (typeof value === 'string') return value;
      return String(value);

    case 'object':
      if (typeof value === 'object') return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;

    case 'any':
    default:
      return value; // No coercion for 'any'
  }
}

/**
 * Apply coercion to all input values based on declared input types.
 */
export function coerceInputs(
  inputValues: Record<string, unknown>,
  declaredInputs: FunctionNodeInput[]
): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...inputValues };

  for (const input of declaredInputs) {
    if (input.name in coerced) {
      coerced[input.name] = coerceValue(coerced[input.name], input.type);
    }
  }

  return coerced;
}
