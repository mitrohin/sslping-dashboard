import { ApiError } from '../../api/client'
import type {
  CheckResult,
  DNSConfig,
  HTTPConfig,
  Incident,
  Monitor,
  MonitorCreateRequest,
  MonitorUpdateRequest,
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
const seriesColors = ['#35d67b', '#6558f5', '#f5a742', '#43b7e8', '#ed6aa5']

export interface MonitorDetailData {
  monitor: MonitorViewModel
  responseTime: readonly ResponseTimeSeries[]
  uptimePeriods: readonly UptimePeriodSummary[]
  incidents: readonly IncidentViewModel[]
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
    regions: [...draft.regions],
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
  }
}

export function toResponseTimeSeries(checks: readonly CheckResult[]): readonly ResponseTimeSeries[] {
  const grouped = new Map<string, CheckResult[]>()
  for (const check of checks) {
    const region = check.region || 'default'
    const values = grouped.get(region) ?? []
    values.push(check)
    grouped.set(region, values)
  }

  return [...grouped.entries()].map(([region, values], index) => {
    const sorted = [...values].sort((left, right) => Date.parse(left.started_at) - Date.parse(right.started_at))
    const latencies = sorted.map((check) => Math.max(0, check.latency_ms))
    return {
      regionId: region,
      regionLabel: region.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
      color: seriesColors[index % seriesColors.length],
      points: sorted.map((check) => ({
        timestamp: check.started_at,
        valueMs: Math.max(0, check.latency_ms),
        status: check.status,
      })),
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
    responseTime: toResponseTimeSeries(options.responseChecks ?? options.checks),
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
