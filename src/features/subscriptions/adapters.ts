import type {
  CheckResultHour,
  CheckStatus,
  MonitorSubscription,
  MonitorSubscriptionIncident,
} from '../../api/types'
import type {
  IncidentViewModel,
  MonitorType,
  MonitorViewModel,
  ResponseTimeSeries,
  UptimeBar,
  UptimeBarStatus,
} from '../../data'

const typeLabels: Readonly<Record<MonitorType, string>> = {
  http: 'HTTP',
  keyword: 'Keyword',
  tcp: 'TCP',
  udp: 'UDP',
  tls: 'SSL / TLS',
  dns: 'DNS',
  domain: 'Domain',
  reachability: 'Reachability',
  heartbeat: 'Heartbeat',
  leakcheck: 'Leak exposure',
  compliance: 'Legal compliance',
}

const seriesColors = ['#34d77b', '#58a6ff', '#c084fc', '#f59e0b', '#ec4899', '#22d3ee']

function rootCauseCode(rootCause: string): string {
  const httpCode = rootCause.match(/\b[1-5]\d{2}\b/)?.[0]
  if (httpCode) return httpCode
  if (/timeout|timed out/i.test(rootCause)) return 'T/O'
  if (/keyword/i.test(rootCause)) return 'KW'
  if (/dns|resolve|nxdomain/i.test(rootCause)) return 'DNS'
  if (/tls|ssl|certificate/i.test(rootCause)) return 'TLS'
  if (/slow|latency|threshold/i.test(rootCause)) return 'SLOW'
  if (/connect|network|refused|unreachable/i.test(rootCause)) return 'CONN'
  return 'INC'
}

function latency(hour: CheckResultHour): number | undefined {
  if (!Number.isFinite(hour.samples) || hour.samples <= 0 || !Number.isFinite(hour.latency_sum_ms)) return undefined
  return Math.max(0, hour.latency_sum_ms / hour.samples)
}

function subscriptionUptimeBars(subscription: MonitorSubscription): UptimeBar[] {
  const buckets = new Map<string, { statuses: CheckStatus[]; latencySum: number; samples: number }>()
  for (const hour of subscription.history ?? []) {
    const bucket = buckets.get(hour.at) ?? { statuses: [], latencySum: 0, samples: 0 }
    bucket.statuses.push(hour.status)
    if (Number.isFinite(hour.latency_sum_ms) && Number.isFinite(hour.samples) && hour.samples > 0) {
      bucket.latencySum += Math.max(0, hour.latency_sum_ms)
      bucket.samples += hour.samples
    }
    buckets.set(hour.at, bucket)
  }

  const requiresLocationConsensus = ['http', 'keyword', 'tcp', 'udp', 'tls', 'dns', 'domain', 'reachability'].includes(subscription.monitor.type)
  const requiredFailures = requiresLocationConsensus ? 2 : 1
  return [...buckets.entries()]
    .sort(([left], [right]) => Date.parse(left) - Date.parse(right))
    .map(([startedAt, bucket], index) => {
      const failures = bucket.statuses.filter((status) => status === 'failed').length
      const status: UptimeBarStatus = failures >= requiredFailures
        ? 'down'
        : bucket.statuses.includes('degraded')
          ? 'degraded'
          : bucket.statuses.some((value) => value === 'ok' || value === 'failed')
            ? 'up'
            : 'no-data'
      return {
        id: `${subscription.subscription_id}:${startedAt}:${index}`,
        startedAt,
        status,
        responseTimeMs: bucket.samples > 0 ? bucket.latencySum / bucket.samples : undefined,
      }
    })
}

export function toSubscribedMonitorViewModel(subscription: MonitorSubscription): MonitorViewModel {
  const { monitor } = subscription

  return {
    id: monitor.id,
    access: 'subscription',
    subscriptionId: subscription.subscription_id,
    subscriptionPageName: subscription.page_name,
    name: monitor.name,
    type: monitor.type,
    typeLabel: typeLabels[monitor.type],
    target: monitor.target || '',
    status: monitor.paused ? 'paused' : monitor.status,
    group: subscription.page_name || 'Followed monitors',
    tags: [],
    intervalSeconds: monitor.interval_seconds,
    timeoutSeconds: monitor.timeout_seconds,
    lastCheckedAt: monitor.last_check_at ?? subscription.latest?.checked_at,
    statusChangedAt: monitor.last_status_change_at,
    responseTimeMs: subscription.latest?.latency_ms,
    uptime24h: subscription.stats?.availability,
    incidentCount24h: subscription.stats?.incidents,
    downtimeSeconds24h: subscription.stats?.downtime_seconds,
    mtbfSeconds24h: subscription.stats?.mtbf_seconds,
    last24Hours: subscriptionUptimeBars(subscription),
    regions: [...(monitor.regions ?? [])],
    incidentId: subscription.latest?.incident_id,
  }
}

export function toSubscribedIncidentViewModel(
  incident: MonitorSubscriptionIncident,
  now = Date.now(),
): IncidentViewModel {
  const rootCause = incident.root_cause?.trim() || incident.title?.trim() || 'Unknown cause'
  const startedAt = Date.parse(incident.started_at)
  const endedAt = Date.parse(incident.resolved_at ?? '')
  const finish = Number.isFinite(endedAt) ? endedAt : now

  return {
    id: incident.id,
    access: 'subscription',
    subscriptionId: incident.subscription_id,
    monitorId: incident.monitor_id,
    monitorName: incident.monitor_name,
    monitorType: incident.monitor_type,
    status: incident.status,
    rootCause,
    rootCauseCode: rootCauseCode(rootCause),
    source: 'monitor',
    startedAt: incident.started_at,
    resolvedAt: incident.resolved_at,
    durationSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.round((finish - startedAt) / 1_000)) : 0,
    commentCount: 0,
    visibility: 'included',
  }
}

export function subscriptionResponseTimeSeries(
  history: readonly CheckResultHour[],
  locationNames: Readonly<Record<string, string>> = {},
): ResponseTimeSeries[] {
  const byRegion = new Map<string, CheckResultHour[]>()
  for (const hour of history) {
    const region = hour.region || 'local'
    const current = byRegion.get(region) ?? []
    current.push(hour)
    byRegion.set(region, current)
  }

  return [...byRegion.entries()].map(([region, hours], index) => {
    const points = hours
      .map((hour) => ({ hour, value: latency(hour) }))
      .filter((item): item is { hour: CheckResultHour; value: number } => item.value !== undefined)
      .sort((left, right) => Date.parse(left.hour.at) - Date.parse(right.hour.at))
      .map(({ hour, value }) => ({ timestamp: hour.at, valueMs: value, status: hour.status }))
    const values = points.map((point) => point.valueMs)
    return {
      regionId: region,
      regionLabel: locationNames[region] ?? (region === 'local' ? 'Default region' : region),
      color: seriesColors[index % seriesColors.length],
      points,
      averageMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
      minimumMs: values.length ? Math.min(...values) : 0,
      maximumMs: values.length ? Math.max(...values) : 0,
    }
  })
}

/** The seven-day view deliberately exposes one weighted average per calendar day. */
export function subscriptionDailyResponseTimeSeries(
  history: readonly CheckResultHour[],
  locationNames: Readonly<Record<string, string>> = {},
): ResponseTimeSeries[] {
  const buckets = new Map<string, CheckResultHour>()
  for (const hour of history) {
    const parsed = new Date(hour.at)
    if (!Number.isFinite(parsed.getTime())) continue
    const day = parsed.toISOString().slice(0, 10)
    const region = hour.region || 'local'
    const key = `${region}:${day}`
    const current = buckets.get(key)
    const status: CheckStatus = current?.status === 'failed' || hour.status === 'failed'
      ? 'failed'
      : current?.status === 'degraded' || hour.status === 'degraded'
        ? 'degraded'
        : current?.status === 'ok' || hour.status === 'ok'
          ? 'ok'
          : 'skipped'
    buckets.set(key, {
      monitor_id: hour.monitor_id,
      at: `${day}T12:00:00.000Z`,
      region,
      status,
      latency_sum_ms: (current?.latency_sum_ms ?? 0) + (Number.isFinite(hour.latency_sum_ms) ? hour.latency_sum_ms : 0),
      samples: (current?.samples ?? 0) + (Number.isFinite(hour.samples) ? Math.max(0, hour.samples) : 0),
    })
  }
  return subscriptionResponseTimeSeries([...buckets.values()], locationNames)
}
