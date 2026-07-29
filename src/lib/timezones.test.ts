import { describe, expect, it } from 'vitest'
import { dateTimeInputToUTC, dateToTimeZoneInput, timeZones } from './timezones'

describe('IANA time zones', () => {
  it('exposes the runtime IANA catalogue and UTC', () => {
    expect(timeZones).toContain('UTC')
    expect(timeZones).toContain('Europe/Moscow')
    expect(timeZones.length).toBeGreaterThan(50)
  })

  it('interprets maintenance wall time in the selected team zone', () => {
    expect(dateTimeInputToUTC('2026-07-28T12:00', 'Europe/Moscow')?.toISOString()).toBe('2026-07-28T09:00:00.000Z')
    expect(dateTimeInputToUTC('2026-07-28T12:00', 'America/New_York')?.toISOString()).toBe('2026-07-28T16:00:00.000Z')
  })

  it('renders stored UTC time back in the selected zone', () => {
    expect(dateToTimeZoneInput('2026-07-28T09:00:00.000Z', 'Europe/Moscow')).toBe('2026-07-28T12:00')
  })

  it('rejects invalid and nonexistent local times', () => {
    expect(dateTimeInputToUTC('not-a-date', 'UTC')).toBeNull()
    expect(dateTimeInputToUTC('2026-03-08T02:30', 'America/New_York')).toBeNull()
  })
})
