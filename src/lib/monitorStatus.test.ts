import { expect, it } from 'vitest'
import { observationIsStale, statusReason } from './monitorStatus'

it('distinguishes paused, never checked, stale, and fresh observations', () => {
  const now = Date.parse('2026-09-10T12:00:00Z')
  const monitor = { status: 'up' as const, intervalSeconds: 60, timeoutSeconds: 10, lastCheckedAt: '2026-09-10T11:50:00Z' }
  expect(observationIsStale(monitor, now)).toBe(true)
  expect(observationIsStale({ ...monitor, lastCheckedAt: '2026-09-10T11:59:30Z' }, now)).toBe(false)
  expect(observationIsStale({ ...monitor, lastCheckedAt: undefined }, now)).toBe(false)
  expect(observationIsStale({ ...monitor, status: 'paused', observationStale: true }, now)).toBe(false)
  expect(observationIsStale({ ...monitor, observationStale: false }, now)).toBe(false)
  expect(statusReason('none', 'ru')).toBeUndefined()
  expect(statusReason('timeout', 'ru')).toBe('Истекло время ожидания ответа')
})
