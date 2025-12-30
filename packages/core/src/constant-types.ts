/**
 * Constant Node Types
 *
 * Types for constant value nodes that output boolean, number, or string values.
 */

export type ConstantValueType = 'boolean' | 'number' | 'string';

export interface ConstantNodeData {
  nodeType: 'constant';
  label?: string;
  valueType: ConstantValueType;
  value: boolean | number | string;
  outputs?: Array<{ name: string; type: string }>;
}

/**
 * Get the default value for a given constant type
 */
export function getDefaultConstantValue(valueType: ConstantValueType): boolean | number | string {
  switch (valueType) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
  }
}
