import { describe, expect, it, vi } from 'vitest'
import { collectCursorPages } from './pagination'

describe('complete cursor collections', () => {
  it('loads rows beyond 100 and deduplicates a page boundary', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
    const load = vi.fn(async (cursor?: string) => cursor ? { items: [{ id: '99' }, { id: '100' }] } : { items: first, next_cursor: 'next' })
    expect((await collectCursorPages(load)).items).toHaveLength(101)
    expect(load).toHaveBeenNthCalledWith(2, 'next')
  })
  it('rejects partial history if a later page fails', async () => {
    await expect(collectCursorPages(async (cursor) => {
      if (cursor) throw new Error('Offline')
      return { items: [{ id: 'a' }], next_cursor: 'next' }
    })).rejects.toThrow('Offline')
  })
  it('detects looping cursors instead of requesting forever', async () => {
    await expect(collectCursorPages(async () => ({ items: [], next_cursor: 'same' }))).rejects.toThrow('repeated a page')
  })
})
