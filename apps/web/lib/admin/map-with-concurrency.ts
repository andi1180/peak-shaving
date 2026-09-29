/**
 * `Promise.all(items.map(fn))` mit höchstens `limit` gleichzeitigen Aufrufen; Ergebnisse in der
 * Reihenfolge der Eingabe. `fn` darf nicht werfen — ein Wurf bricht wie bei `Promise.all` alles ab.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
