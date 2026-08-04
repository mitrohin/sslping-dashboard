import { ApiError } from '../../api/client'
import type {
  CheckResult,
  DNSConfig,
  HTTPConfig,
  Incident,
  Monitor,
  MonitorCreateRequest,
  MonitorUpdateRequest,
  Region,
  UptimeStats,
} from '../../api/types'
import { toIncidentViewModel, toMonitorViewModel } from '../../app/viewAdapters'
import type {
  IncidentViewModel,
  MonitorViewModel,
  ResponseTimeSeries,
  UptimePeriodSummary,
} from '../../data'
import type { MonitorDraft } from './MonitorForm'

const sslReminderDays = [30, 14, 7, 0]
const seriesColors = [
  '#35d67b', '#6558f5', '#f5a742', '#43b7e8', '#ed6aa5',
  '#ef5b5b', '#a66cff', '#2dd4bf', '#f97316', '#84cc16',
  '#e879f9', '#38bdf8', '#facc15', '#fb7185', '#22c55e',
  '#818cf8', '#14b8a6', '#c084fc', '#f59e0b', '#06b6d4',
] as const

function stableSeriesColor(region: string): string {
  if (region === 'local') return seriesColors[0]
  let hash = 2_166_136_261
  for (let index = 0; index < region.length; index += 1) {
    hash ^= region.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return seriesColors[(hash >>> 0) % seriesColors.length]
}

export interface MonitorDetailData {
  monitor: MonitorViewModel
  responseTime: readonly ResponseTimeSeries[]
  uptimePeriods: readonly UptimePeriodSummary[]
  incidents: readonly IncidentViewModel[]
  locationNames: Readonly<Record<string, string>>
  mtbfSeconds?: number
}

export function monitorErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail || fallback
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer.`)
  return value
}

function parseHostPort(
  target: string,
  options: { requirePort: boolean; defaultPort?: number },
): { host: string; port?: number } {
  const value = target.trim()
  if (!value) throw new Error('Host is required.')

  let host = value
  let port: number | undefined
  const bracketed = value.match(/^\[([^\]]+)](?::(\d+))?$/)
  if (bracketed) {
    host = bracketed[1]
    port = bracketed[2] ? Number(bracketed[2]) : undefined
  } else {
    const lastColon = value.lastIndexOf(':')
    if (lastColon > 0 && value.indexOf(':') === lastColon && /^\d+$/.test(value.slice(lastColon + 1))) {
      host = value.slice(0, lastColon)
      port = Number(value.slice(lastColon + 1))
    } else if (value.includes(':') && !value.includes('.')) {
      host = value
    }
  }

  port ??= options.defaultPort
  if (!host.trim()) throw new Error('Host is required.')
  if (options.requirePort && port === undefined) {
    throw new Error('Enter the target as host:port (for IPv6 use [address]:port).')
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error('Port must be between 1 and 65535.')
  }
  return { host: host.trim(), ...(port === undefined ? {} : { port }) }
}

function normaliseHttpMethod(method: string): NonNullable<HTTPConfig['method']> {
  const upper = method.toUpperCase()
  if (['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(upper)) {
    return upper as NonNullable<HTTPConfig['method']>
  }
  return 'GET'
}

function draftConfig(draft: MonitorDraft): MonitorCreateRequest['config'] {
  switch (draft.type) {
    case 'http':
    case 'keyword': {
      const url = draft.target.trim()
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
      } catch {
        throw new Error('Enter a valid HTTP or HTTPS URL.')
      }
      return {
        http: {
          url,
          method: normaliseHttpMethod(draft.method),
          follow_redirects: draft.followRedirects,
          allowed_status_classes: [...draft.allowedStatusClasses],
          allowed_status_codes: [...draft.allowedStatusCodes],
          validate_tls: draft.checkSSLErrors,
          tls_expiry_warn_days: draft.sslReminders ? sslReminderDays : null,
          domain_expiry_warn_days: draft.domainReminders ? sslReminderDays : null,
          ...(draft.type === 'keyword'
            ? {
                keyword: {
                  value: draft.keyword,
                  mode: draft.keywordMode,
                  case_sensitive: false,
                },
              }
            : {}),
        },
      }
    }
    case 'tcp': {
      const target = parseHostPort(draft.target, { requirePort: true })
      return { tcp: { host: target.host, port: target.port! } }
    }
    case 'udp': {
      const target = parseHostPort(draft.target, { requirePort: true })
      return { udp: { host: target.host, port: target.port! } }
    }
    case 'tls': {
      const target = parseHostPort(draft.target, { requirePort: false, defaultPort: 443 })
      return {
        tls: {
          host: target.host,
          port: target.port,
          warn_days: draft.sslReminders ? sslReminderDays : null,
        },
      }
    }
    case 'dns': {
      const expected = draft.dnsExpected
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      return {
        dns: {
          name: draft.target.trim(),
          record_type: draft.dnsRecordType,
          ...(expected.length ? { expected } : {}),
        },
      }
    }
    case 'domain':
      return {
        domain: {
          domain: draft.target.trim(),
          warn_days: draft.domainReminders ? sslReminderDays : null,
        },
      }
    case 'reachability': {
      const target = parseHostPort(draft.target, { requirePort: false })
      return { reachability: target }
    }
    case 'heartbeat':
      return {
        heartbeat: {
          period_seconds: positiveInteger(Number(draft.target), 'Heartbeat period'),
          grace_seconds: Math.max(0, Math.round(draft.heartbeatGraceSeconds)),
        },
      }
    case 'leakcheck':
      return { leakcheck: { query_type: draft.leakQueryType, query: draft.target.trim() } }
    case 'compliance': {
      const url = draft.target.trim()
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
      } catch {
        throw new Error('Enter a valid HTTP or HTTPS URL.')
      }
      if (draft.intervalSeconds < 86400) throw new Error('Compliance checks cannot run more often than every 24 hours.')
      return { compliance: { url, framework: draft.complianceFramework } }
    }
  }
}

export function monitorDraftToCreateRequest(draft: MonitorDraft): MonitorCreateRequest {
  if (!draft.name.trim()) throw new Error('Friendly name is required.')
  if (!draft.target.trim()) throw new Error('Monitor target is required.')
  if (draft.type === 'keyword' && !draft.keyword) throw new Error('Keyword is required.')

  return {
    name: draft.name.trim(),
    type: draft.type,
    config: draftConfig(draft),
    interval_seconds: positiveInteger(draft.intervalSeconds, 'Monitor interval'),
    timeout_seconds: positiveInteger(draft.timeoutSeconds, 'Request timeout'),
    tags: [...draft.tags],
    group_name: draft.group.trim() || 'Monitors',
    retry_policy: {
      failure_threshold: positiveInteger(draft.failureThreshold, 'Failure threshold'),
      recovery_threshold: positiveInteger(draft.recoveryThreshold, 'Recovery threshold'),
    },
    slow_threshold_ms: Math.max(0, Math.round(draft.slowThresholdMs)),
  }
}

export function monitorDraftToUpdateRequest(draft: MonitorDraft): MonitorUpdateRequest {
  const { type: _type, ...request } = monitorDraftToCreateRequest(draft)
  return request
}

function hostPort(host: string | undefined, port: number | undefined): string {
  if (!host) return ''
  const displayHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return port ? `${displayHost}:${port}` : displayHost
}

export function monitorToDraft(monitor: Monitor): MonitorDraft {
  const http = monitor.config.http
  const dns = monitor.config.dns
  let target = ''
  switch (monitor.type) {
    case 'http':
    case 'keyword':
      target = http?.url ?? ''
      break
    case 'tcp':
      target = hostPort(monitor.config.tcp?.host, monitor.config.tcp?.port)
      break
    case 'udp':
      target = hostPort(monitor.config.udp?.host, monitor.config.udp?.port)
      break
    case 'tls':
      target = hostPort(monitor.config.tls?.host, monitor.config.tls?.port ?? 443)
      break
    case 'dns':
      target = dns?.name ?? ''
      break
    case 'domain':
      target = monitor.config.domain?.domain ?? ''
      break
    case 'reachability':
      target = hostPort(monitor.config.reachability?.host, monitor.config.reachability?.port)
      break
    case 'heartbeat':
      target = String(monitor.config.heartbeat?.period_seconds ?? monitor.interval_seconds)
      break
    case 'leakcheck':
      target = monitor.config.leakcheck?.query ?? ''
      break
    case 'compliance':
      target = monitor.config.compliance?.url ?? ''
      break
  }

  return {
    name: monitor.name,
    type: monitor.type,
    target,
    intervalSeconds: monitor.interval_seconds,
    timeoutSeconds: monitor.timeout_seconds,
    regions: [...monitor.regions],
    tags: [...monitor.tags],
    group: monitor.group_name || 'Monitors',
    keyword: http?.keyword?.value ?? '',
    keywordMode: http?.keyword?.mode ?? 'present',
    method: http?.method ?? 'GET',
    followRedirects: http?.follow_redirects ?? true,
    allowedStatusClasses: http?.allowed_status_classes?.length || http?.allowed_status_codes?.length
      ? [...(http.allowed_status_classes ?? [])]
      : [2],
    allowedStatusCodes: [...(http?.allowed_status_codes ?? [])],
    checkSSLErrors: http?.validate_tls ?? true,
    sslReminders: http
      ? http.tls_expiry_warn_days !== null
      : monitor.config.tls?.warn_days !== null,
    domainReminders: http
      ? http.domain_expiry_warn_days !== null
      : monitor.config.domain?.warn_days !== null,
    slowThresholdMs: monitor.slow_threshold_ms ?? 0,
    failureThreshold: monitor.retry_policy.failure_threshold,
    recoveryThreshold: monitor.retry_policy.recovery_threshold,
    dnsRecordType: dns?.record_type ?? 'A',
    dnsExpected: dns?.expected?.join(', ') ?? '',
    heartbeatGraceSeconds: monitor.config.heartbeat?.grace_seconds ?? 0,
    leakQueryType: monitor.config.leakcheck?.query_type ?? 'email',
    complianceFramework: monitor.config.compliance?.framework ?? 'ru_152_fz',
  }
}

function checkStartedAt(check: CheckResult): number {
  return Date.parse(check.started_at)
}

function availabilityHealthy(check: CheckResult): boolean {
  return check.status === 'ok' || check.status === 'degraded'
}

function containsTimestampInRange(timestamps: readonly number[], from: number, to: number): boolean {
  let low = 0
  let high = timestamps.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (timestamps[middle] < from) low = middle + 1
    else high = middle
  }
  return low < timestamps.length && timestamps[low] <= to
}

function hasHealthyPeerInAttempt(
  region: string,
  sorted: readonly CheckResult[],
  index: number,
  healthyTimestampsByRegion: ReadonlyMap<string, readonly number[]>,
): boolean {
  const at = checkStartedAt(sorted[index])
  if (!Number.isFinite(at)) return false
  const previousAt = index > 0 ? checkStartedAt(sorted[index - 1]) : Number.NaN
  const nextAt = index + 1 < sorted.length ? checkStartedAt(sorted[index + 1]) : Number.NaN
  const from = Number.isFinite(previousAt)
    ? (previousAt + at) / 2
    : Number.isFinite(nextAt)
      ? at - (nextAt - at) / 2
      : at
  const to = Number.isFinite(nextAt)
    ? (at + nextAt) / 2
    : Number.isFinite(previousAt)
      ? at + (at - previousAt) / 2
      : at

  for (const [peerRegion, timestamps] of healthyTimestampsByRegion) {
    if (peerRegion !== region && containsTimestampInRange(timestamps, from, to)) return true
  }
  return false
}

export function toResponseTimeSeries(checks: readonly CheckResult[], locations: readonly Pick<Region, 'id' | 'name' | 'color'>[] = []): readonly ResponseTimeSeries[] {
  const grouped = new Map<string, CheckResult[]>()
  const locationNames = new Map(locations.map((location) => [location.id, location.name] as const))
  const locationColors = new Map(locations.flatMap((location) => location.color ? [[location.id, location.color] as const] : []))
  for (const check of checks) {
    const region = check.region || 'default'
    const values = grouped.get(region) ?? []
    values.push(check)
    grouped.set(region, values)
  }

  const sortedByRegion = new Map(
    [...grouped.entries()].map(([region, values]) => [
      region,
      [...values].sort((left, right) => checkStartedAt(left) - checkStartedAt(right)),
    ] as const),
  )
  const healthyTimestampsByRegion = new Map(
    [...sortedByRegion.entries()].map(([region, values]) => [
      region,
      values.filter(availabilityHealthy).map(checkStartedAt).filter(Number.isFinite),
    ] as const),
  )

  return [...sortedByRegion.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([region, sorted]) => {
    let previousValue: number | undefined
    const points = sorted.map((check, index) => {
      const rawValue = Math.max(0, check.latency_ms)
      let valueMs = rawValue
      if (
        check.status === 'failed'
        && check.root_cause === 'timeout'
        && previousValue !== undefined
        && hasHealthyPeerInAttempt(region, sorted, index, healthyTimestampsByRegion)
      ) {
        valueMs = previousValue
      }
      previousValue = valueMs
      return {
        timestamp: check.started_at,
        valueMs,
        status: check.status,
      }
    })
    const latencies = points.map((point) => point.valueMs)
    return {
      regionId: region,
      regionLabel: locationNames.get(region) ?? (region === 'local' ? 'Frankfurt' : region.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase())),
      color: locationColors.get(region) ?? stableSeriesColor(region),
      points,
      averageMs: latencies.length
        ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
        : 0,
      minimumMs: latencies.length ? Math.min(...latencies) : 0,
      maximumMs: latencies.length ? Math.max(...latencies) : 0,
    }
  })
}

export function toUptimePeriod(
  period: UptimePeriodSummary['period'],
  stats: UptimeStats,
): UptimePeriodSummary {
  return {
    period,
    uptime: stats.availability,
    incidentCount: stats.incidents,
    downtimeSeconds: stats.downtime_seconds,
  }
}

export function toLiveMonitorDetail(options: {
  monitor: Monitor
  checks: readonly CheckResult[]
  responseChecks?: readonly CheckResult[]
  certificateEvidence?: readonly CheckResult[]
  domainEvidence?: readonly CheckResult[]
  dnsEvidence?: readonly CheckResult[]
  incidents: readonly Incident[]
  stats: Readonly<Record<UptimePeriodSummary['period'], UptimeStats>>
  locations?: readonly Pick<Region, 'id' | 'name'>[]
}): MonitorDetailData {
  const openIncident = options.incidents.find((incident) => incident.status !== 'resolved')
  const base = toMonitorViewModel(options.monitor, {
    checks: options.checks,
    stats: options.stats['24h'],
    activeIncident: openIncident,
  })
  const certificate = options.certificateEvidence?.length
    ? toMonitorViewModel(options.monitor, { checks: options.certificateEvidence }).sslCertificate
    : undefined
  const domain = options.domainEvidence?.length
    ? toMonitorViewModel(options.monitor, { checks: options.domainEvidence }).domainRegistration
    : undefined

  return {
    monitor: {
      ...base,
      sslCertificate: certificate ?? base.sslCertificate,
      domainRegistration: domain ?? base.domainRegistration,
    },
    responseTime: toResponseTimeSeries(options.responseChecks ?? options.checks, options.locations),
    locationNames: Object.fromEntries((options.locations ?? []).map((location) => [location.id, location.name])),
    uptimePeriods: (['24h', '7d', '30d', '365d'] as const).map((period) =>
      toUptimePeriod(period, options.stats[period]),
    ),
    incidents: options.incidents.map((incident) =>
      toIncidentViewModel(incident, { monitor: options.monitor }),
    ),
    mtbfSeconds: options.stats['365d'].mtbf_seconds,
  }
}

export type DNSRecordType = DNSConfig['record_type']
