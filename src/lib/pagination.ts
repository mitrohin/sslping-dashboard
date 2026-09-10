import type { Page } from '../api/types'

/** Exhaust a cursor collection without silently presenting a truncated history. */
export async function collectCursorPages<T extends { id: string }>(
  load: (cursor?: string) => Promise<Page<T>>,
): Promise<Page<T>> {
  const items = new Map<string, T>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await load(cursor)
    for (const item of page.items ?? []) items.set(item.id, item)
    cursor = page.next_cursor || undefined
    if (cursor && cursors.has(cursor)) throw new Error('The server repeated a page. Please reload to obtain the complete history.')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return { items: [...items.values()] }
}
