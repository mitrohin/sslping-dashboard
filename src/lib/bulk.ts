export interface BulkOutcome {
  id: string
  name: string
  error?: string
}

/** Keep every outcome and finish outstanding requests before refreshing the list. */
export async function runBulk<T extends { id: string; name: string }>(
  rows: readonly T[],
  perform: (row: T) => Promise<unknown>,
  concurrency = 4,
): Promise<BulkOutcome[]> {
  const outcomes: BulkOutcome[] = new Array(rows.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(rows.length, Math.max(1, concurrency)) }, async () => {
    while (index < rows.length) {
      const position = index++
      const row = rows[position]
      try {
        await perform(row)
        outcomes[position] = { id: row.id, name: row.name }
      } catch (error) {
        outcomes[position] = { id: row.id, name: row.name, error: error instanceof Error ? error.message : 'The operation could not be completed.' }
      }
    }
  }))
  return outcomes
}
