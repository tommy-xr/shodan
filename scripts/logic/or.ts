/**
 * Boolean OR operator
 * Returns true if either input is true
 */
export default function({ a, b }: { a: boolean, b: boolean }): { result: boolean } {
  return { result: a || b };
}
