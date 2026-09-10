import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from '../api/types'
import { useCursorHistory } from './useCursorHistory'

afterEach(cleanup)

it('loads incrementally, keeps previous rows after a failed page, and retries the same cursor', async () => {
  const load = vi.fn().mockResolvedValueOnce({ items: [{ id: '1' }], next_cursor: 'older' })
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ items: [{ id: '1' }, { id: '2' }] })
  const { result } = renderHook(() => useCursorHistory<{ id: string }>(load))
  await waitFor(() => expect(result.current.hasMore).toBe(true))
  expect(load).toHaveBeenCalledTimes(1)
  await act(() => result.current.loadMore())
  expect(result.current.items).toEqual([{ id: '1' }])
  expect(result.current.error).toBe('Connection lost')
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.items).toEqual([{ id: '1' }, { id: '2' }]))
  expect(load.mock.calls.map((args) => args[0])).toEqual([undefined, 'older', 'older'])
  expect(result.current.hasMore).toBe(false)
})

it('discards a late response after switching workspaces and aborts the old request', async () => {
  let finish: (page: Page<{ id: string }>) => void = () => undefined
  const oldLoad = vi.fn(() => new Promise<Page<{ id: string }>>((resolve) => { finish = resolve }))
  const newLoad = vi.fn().mockResolvedValue({ items: [{ id: 'new-workspace' }] })
  const { result, rerender } = renderHook(({ load }) => useCursorHistory<{ id: string }>(load), { initialProps: { load: oldLoad as typeof newLoad } })
  rerender({ load: newLoad })
  await waitFor(() => expect(result.current.items).toEqual([{ id: 'new-workspace' }]))
  await act(async () => { finish({ items: [{ id: 'old-workspace' }] }) })
  expect(result.current.items).toEqual([{ id: 'new-workspace' }])
  expect((oldLoad.mock.calls as unknown[][])[0][3]).toMatchObject({ aborted: true })
})

it('resets the cursor when the server date range changes', async () => {
  const load = vi.fn().mockResolvedValue({ items: [{ id: '1' }], next_cursor: 'older' })
  const { result } = renderHook(() => useCursorHistory<{ id: string }>(load))
  await waitFor(() => expect(result.current.hasMore).toBe(true))
  act(() => result.current.setRange({ from: '2026-09-01T00:00:00.000Z' }))
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(load.mock.calls[1][0]).toBeUndefined()
  expect(load.mock.calls[1][2]).toEqual({ from: '2026-09-01T00:00:00.000Z' })
})
