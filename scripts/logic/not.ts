/**
 * Boolean NOT operator
 * Negates the input value
 */
export default function({ value }: { value: boolean }): { result: boolean } {
  return { result: !value };
}
