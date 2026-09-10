import { useCallback, useEffect, useRef, useState } from 'react'
import type { Page } from '../api/types'

export interface HistoryRange { from?: string; to?: string }

export function useCursorHistory<T extends { id: string }>(load: ((cursor?: string, search?: string, range?: HistoryRange, signal?: AbortSignal) => Promise<Page<T>>) | undefined) {
  const [items, setItems] = useState<T[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [range, setRange] = useState<HistoryRange>({})
  const controller = useRef<AbortController | null>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const generation = useRef(0)
  const inFlight = useRef(false)
  const seenCursors = useRef(new Set<string>())
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const request = useCallback(async (cursor?: string) => {
    if (!load || inFlight.current) return
    const current = generation.current
    inFlight.current = true
    setLoading(true)
    setError(undefined)
    try {
      controller.current = new AbortController()
      const page = await load(cursor, search, range, controller.current.signal)
      if (generation.current !== current) return
      const next = page.next_cursor || undefined
      if (next && (next === cursor || seenCursors.current.has(next))) throw new Error('The server repeated a page. Reload the history to continue.')
      if (cursor) seenCursors.current.add(cursor)
      setItems((previous) => [...new Map([...(cursor ? previous : []), ...(page.items ?? [])].map((row) => [row.id, row])).values()])
      setNextCursor(next)
    } catch (error) {
      if (generation.current === current) setError(error instanceof Error ? error.message : 'The history could not be loaded.')
    } finally {
      if (generation.current === current) { inFlight.current = false; setLoading(false) }
    }
  }, [load, search, range])

  useEffect(() => {
    generation.current++
    inFlight.current = false
    seenCursors.current.clear()
    setItems([])
    setNextCursor(undefined)
    setError(undefined)
    setLoading(false)
    void request()
    return () => { generation.current++; inFlight.current = false; controller.current?.abort() }
  }, [request, revision])

  return {
    items, loading, error, hasMore: Boolean(nextCursor), search: query,
    setSearch: setQuery, setRange,
    loadMore: () => request(nextCursor),
    retry: () => nextCursor ? void request(nextCursor) : setRevision((value) => value + 1),
  }
}
