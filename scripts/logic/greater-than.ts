/**
 * Greater than comparison operator
 * Returns true if a > b
 */
export default function({ a, b }: { a: number, b: number }): { result: boolean } {
  return { result: a > b };
}
