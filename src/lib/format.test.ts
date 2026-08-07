import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDuration,
  formatRelativeTime,
  formatStatus,
  formatUptime,
  statusTone,
} from './format'

describe('formatDuration', () => {
  it('formats short and multi-day durations compactly', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(66)).toBe('1m 6s')
    expect(formatDuration(90_061)).toBe('1d 1h 1m')
    expect(formatDuration(90_061, 2)).toBe('1d 1h')
  })

  it('guards against invalid and negative values', () => {
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-20)).toBe('0s')
  })
})

describe('formatDate', () => {
  it('uses the requested locale and time zone', () => {
    const result = formatDate('2026-07-25T13:04:06.000Z', {
      locale: 'en-GB',
      timeZone: 'UTC',
      includeSeconds: true,
    })

    expect(result).toContain('25 Jul 2026')
    expect(result).toContain('13:04:06')
  })

  it('returns an em dash for invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  it('formats past and future timestamps', () => {
    const now = '2026-07-25T13:00:00.000Z'
    expect(formatRelativeTime('2026-07-25T12:58:00.000Z', now)).toBe('2 minutes ago')
    expect(formatRelativeTime('2026-07-26T13:00:00.000Z', now)).toBe('in 1 day')
  })
})

describe('formatUptime', () => {
  it('formats and clamps uptime percentages', () => {
    expect(formatUptime(99.975)).toBe('99.975%')
    expect(formatUptime(100)).toBe('100%')
    expect(formatUptime(123)).toBe('100%')
    expect(formatUptime(-1)).toBe('0%')
    expect(formatUptime(undefined)).toBe('—')
  })
})

describe('status formatting', () => {
  it('maps known and unknown statuses to readable labels', () => {
    expect(formatStatus('up')).toBe('Up')
    expect(formatStatus('no-data')).toBe('No data')
    expect(formatStatus('custom_status')).toBe('Custom status')
    expect(formatStatus(undefined)).toBe('Unknown')
  })

  it('keeps Traditional Chinese status labels for HK and TW locales', () => {
    expect(formatStatus('degraded', 'zh-Hant-HK')).toBe('效能下降')
    expect(formatStatus('resolved', 'zh-Hant-TW')).toBe('已解決')
    expect(formatStatus('maintenance', 'zh-TW')).toBe('維護中')
    expect(formatStatus('degraded', 'zh-CN')).toBe('性能下降')
  })

  it('maps statuses to semantic tones', () => {
    expect(statusTone('up')).toBe('positive')
    expect(statusTone('down')).toBe('negative')
    expect(statusTone('degraded')).toBe('warning')
    expect(statusTone('monitoring')).toBe('info')
    expect(statusTone('new-status')).toBe('neutral')
  })
})
