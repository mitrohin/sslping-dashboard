const intlWithTimeZones = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

const fallbackTimeZones = [
  'UTC',
  'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago',
  'America/Denver', 'America/Halifax', 'America/Lima', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Phoenix', 'America/Santiago', 'America/Sao_Paulo', 'America/St_Johns',
  'America/Toronto', 'America/Vancouver',
  'Asia/Almaty', 'Asia/Baghdad', 'Asia/Baku', 'Asia/Bangkok', 'Asia/Beirut', 'Asia/Colombo',
  'Asia/Dhaka', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem', 'Asia/Karachi',
  'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
  'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Tehran', 'Asia/Tokyo', 'Asia/Yerevan',
  'Atlantic/Azores', 'Atlantic/Reykjavik',
  'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Darwin', 'Australia/Hobart', 'Australia/Melbourne',
  'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/Brussels',
  'Europe/Bucharest', 'Europe/Budapest', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Istanbul',
  'Europe/Kyiv', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Minsk', 'Europe/Moscow',
  'Europe/Paris', 'Europe/Prague', 'Europe/Riga', 'Europe/Rome', 'Europe/Sofia', 'Europe/Stockholm',
  'Europe/Tallinn', 'Europe/Vienna', 'Europe/Vilnius', 'Europe/Warsaw', 'Europe/Zurich',
  'Indian/Maldives', 'Indian/Mauritius',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Guam', 'Pacific/Honolulu', 'Pacific/Tahiti',
] as const

export const timeZones: readonly string[] = (() => {
  const supported = intlWithTimeZones.supportedValuesOf?.('timeZone') ?? [...fallbackTimeZones]
  return [...new Set(['UTC', ...supported])].sort((left, right) => left.localeCompare(right))
})()

export interface TimeZoneGroup {
  area: string
  zones: readonly string[]
}

export const timeZoneGroups: readonly TimeZoneGroup[] = (() => {
  const grouped = new Map<string, string[]>()
  for (const zone of timeZones) {
    const separator = zone.indexOf('/')
    const area = separator > 0 ? zone.slice(0, separator) : 'Universal'
    const zones = grouped.get(area) ?? []
    zones.push(zone)
    grouped.set(area, zones)
  }
  return [...grouped.entries()].map(([area, zones]) => ({ area, zones }))
})()

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') }
}

export function dateTimeInputToUTC(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const desired = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) }
  let timestamp = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute)
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const shown = dateParts(new Date(timestamp), timeZone)
      const shownAsUTC = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute)
      const desiredAsUTC = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute)
      timestamp += desiredAsUTC - shownAsUTC
    }
    const result = new Date(timestamp)
    const shown = dateParts(result, timeZone)
    return shown.year === desired.year && shown.month === desired.month && shown.day === desired.day && shown.hour === desired.hour && shown.minute === desired.minute ? result : null
  } catch {
    return null
  }
}

export function dateToTimeZoneInput(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const parts = dateParts(date, timeZone)
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
  } catch {
    return date.toISOString().slice(0, 16)
  }
}
