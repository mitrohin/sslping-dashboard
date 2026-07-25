import type {
  IncidentStatus,
  MonitorStatus,
  StatusTone,
  UptimeBarStatus,
} from '../data/models'

export interface DateFormatOptions {
  locale?: string
  timeZone?: string
  includeYear?: boolean
  includeSeconds?: boolean
}

export interface RelativeTimeOptions {
  locale?: string
  numeric?: Intl.RelativeTimeFormatNumeric
}

const statusLabels: Readonly<Record<string, string>> = {
  pending: 'Pending',
  up: 'Up',
  down: 'Down',
  degraded: 'Degraded',
  paused: 'Paused',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  maintenance: 'Maintenance',
  'no-data': 'No data',
  ok: 'Operational',
  failed: 'Failed',
  skipped: 'Skipped',
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
  published: 'Published',
  draft: 'Draft',
  expired: 'Expired',
  revoked: 'Revoked',
  'never-used': 'Never used',
  expiring: 'Expiring soon',
}

const statusTones: Readonly<Record<string, StatusTone>> = {
  up: 'positive',
  ok: 'positive',
  resolved: 'positive',
  active: 'positive',
  published: 'positive',
  down: 'negative',
  failed: 'negative',
  expired: 'negative',
  revoked: 'negative',
  suspended: 'negative',
  degraded: 'warning',
  investigating: 'warning',
  identified: 'warning',
  expiring: 'warning',
  invited: 'warning',
  monitoring: 'info',
  maintenance: 'info',
  pending: 'neutral',
  paused: 'neutral',
  skipped: 'neutral',
  draft: 'neutral',
  'no-data': 'neutral',
  'never-used': 'neutral',
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDuration(totalSeconds: number, maxParts = 3): string {
  if (!Number.isFinite(totalSeconds)) return '—'

  let seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds === 0) return '0s'

  const units = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ] as const
  const parts: string[] = []

  for (const [label, size] of units) {
    if (seconds < size && parts.length === 0) continue
    const value = Math.floor(seconds / size)
    seconds %= size
    if (value > 0) parts.push(`${value}${label}`)
    if (parts.length >= Math.max(1, maxParts)) break
  }

  return parts.join(' ') || '0s'
}

export function formatDate(
  value: string | number | Date,
  options: DateFormatOptions = {},
): string {
  const date = toDate(value)
  if (!date) return '—'

  const {
    locale = 'en-US',
    timeZone,
    includeYear = true,
    includeSeconds = false,
  } = options

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' as const } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
}

export const formatDateTime = formatDate

export function formatRelativeTime(
  value: string | number | Date,
  now: string | number | Date = new Date(),
  options: RelativeTimeOptions = {},
): string {
  const date = toDate(value)
  const reference = toDate(now)
  if (!date || !reference) return '—'

  const differenceSeconds = (date.getTime() - reference.getTime()) / 1_000
  const absoluteSeconds = Math.abs(differenceSeconds)
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ] as const
  const [unit, size] = units.find(([, unitSize]) => absoluteSeconds >= unitSize) ?? [
    'second',
    1,
  ]
  const amount = Math.round(differenceSeconds / size)

  return new Intl.RelativeTimeFormat(options.locale ?? 'en', {
    numeric: options.numeric ?? 'always',
  }).format(amount, unit)
}

export function formatUptime(value: number | null | undefined, maximumFractionDigits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'

  const normalized = Math.min(100, Math.max(0, value))
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.max(0, maximumFractionDigits),
  }).format(normalized)}%`
}

export function formatStatus(
  status: MonitorStatus | IncidentStatus | UptimeBarStatus | string | null | undefined,
): string {
  if (!status) return 'Unknown'
  if (statusLabels[status]) return statusLabels[status]

  return status
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return 'neutral'
  return statusTones[status] ?? 'neutral'
}
