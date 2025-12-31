/**
 * Equality comparison operator
 * Returns true if both values are strictly equal
 */
export default function({ a, b }: { a: unknown, b: unknown }): { result: boolean } {
  return { result: a === b };
}
