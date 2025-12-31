/**
 * Boolean AND operator
 * Returns true only if both inputs are true
 */
export default function({ a, b }: { a: boolean, b: boolean }): { result: boolean } {
  return { result: a && b };
}
