import type {
  APIKey,
  AuditLog,
  CheckResult,
  Incident,
  Integration,
  JsonObject,
  JsonValue,
  MaintenanceWindow,
  Membership,
  Monitor,
  StatusPage,
  StatusPageDetail,
  User,
  UptimeStats,
} from '../api/types'
import type {
  ApiKeyScope,
  ApiKeyViewModel,
  ExpirySnapshot,
  IncidentViewModel,
  IntegrationCategory,
  IntegrationEvent,
  IntegrationType,
  IntegrationViewModel,
  MaintenanceRecurrence,
  MaintenanceWindowViewModel,
  MonitorStatus,
  MonitorType,
  MonitorViewModel,
  StatusPageViewModel,
  TeamMemberViewModel,
  TeamRole,
  UptimeBar,
  UptimeBarStatus,
} from '../data/models'

type DateInput = string | number | Date

const DAY_MS = 86_400_000
const WEEK_MS = DAY_MS * 7

const monitorTypes = new Set<MonitorType>([
  'http',
  'keyword',
  'tcp',
  'udp',
  'tls',
  'dns',
  'domain',
  'reachability',
  'heartbeat',
])

const monitorStatuses = new Set<MonitorStatus>([
  'pending',
  'up',
  'down',
  'degraded',
  'paused',
])

const monitorTypeLabels: Readonly<Record<MonitorType, string>> = {
  http: 'HTTP',
  keyword: 'Keyword',
  tcp: 'TCP',
  udp: 'UDP',
  tls: 'SSL / TLS',
  dns: 'DNS',
  domain: 'Domain',
  reachability: 'Reachability',
  heartbeat: 'Heartbeat',
}

const languageLabels: Readonly<Record<string, string>> = {
  en: 'English',
  zh: '中文',
  hi: 'हिन्दी',
  es: 'Español',
  fr: 'Français',
  ar: 'العربية',
  bn: 'বাংলা',
  pt: 'Português',
  ru: 'Русский',
  id: 'Bahasa Indonesia',
}

function toTimestamp(value: DateInput | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function nowTimestamp(value?: DateInput): number {
  return toTimestamp(value) ?? Date.now()
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback))
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function recordString(record: JsonObject | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function childRecord(record: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = record?.[key]
  return isRecord(value) ? value : undefined
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value))
}

function clampPercentage(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, value))
}

function normaliseMonitorType(value: unknown): MonitorType {
  return typeof value === 'string' && monitorTypes.has(value as MonitorType)
    ? (value as MonitorType)
    : 'http'
}

function normaliseMonitorStatus(value: unknown): MonitorStatus {
  return typeof value === 'string' && monitorStatuses.has(value as MonitorStatus)
    ? (value as MonitorStatus)
    : 'pending'
}

function formatInterval(totalSeconds: unknown): string {
  const seconds = Math.max(0, Math.round(finiteNumber(totalSeconds)))
  if (seconds >= 3_600 && seconds % 3_600 === 0) return `${seconds / 3_600}h`
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

function monitorTarget(monitor: Monitor, type: MonitorType): string {
  const config = monitor.config ?? {}
  switch (type) {
    case 'http':
    case 'keyword':
      return nonEmpty(config.http?.url, 'Target unavailable')
    case 'tcp':
      return config.tcp?.host
        ? `${config.tcp.host}:${finiteNumber(config.tcp.port)}`
        : 'Target unavailable'
    case 'udp':
      return config.udp?.host
        ? `${config.udp.host}:${finiteNumber(config.udp.port)}`
        : 'Target unavailable'
    case 'tls':
      return config.tls?.host
        ? `${config.tls.host}:${finiteNumber(config.tls.port, 443)}`
        : 'Target unavailable'
    case 'dns': {
      if (!config.dns?.name) return 'Target unavailable'
      const recordType = nonEmpty(config.dns.record_type, 'record')
      return `${config.dns.name} · ${recordType}`
    }
    case 'domain':
      return nonEmpty(config.domain?.domain, 'Target unavailable')
    case 'reachability':
      return config.reachability?.host
        ? config.reachability.port
          ? `${config.reachability.host}:${config.reachability.port}`
          : config.reachability.host
        : 'Target unavailable'
    case 'heartbeat': {
      if (!config.heartbeat) return 'Target unavailable'
      const grace = config.heartbeat.grace_seconds
        ? ` · ${formatInterval(config.heartbeat.grace_seconds)} grace`
        : ''
      return `Every ${formatInterval(config.heartbeat.period_seconds)}${grace}`
    }
  }
}

function uptimeBarStatus(status: unknown): UptimeBarStatus {
  switch (status) {
    case 'ok':
      return 'up'
    case 'failed':
      return 'down'
    case 'degraded':
      return 'degraded'
    case 'skipped':
    default:
      return 'no-data'
  }
}

function toUptimeBars(monitorId: string, checks: readonly CheckResult[]): readonly UptimeBar[] {
  return [...checks]
    .filter((check) => !check.monitor_id || check.monitor_id === monitorId)
    .sort(
      (left, right) =>
        (toTimestamp(left.started_at) ?? 0) - (toTimestamp(right.started_at) ?? 0),
    )
    .slice(-30)
    .map((check, index) => ({
      id: nonEmpty(check.id, `${monitorId}-check-${index + 1}`),
      startedAt: nonEmpty(check.started_at, check.finished_at || ''),
      status: uptimeBarStatus(check.status),
      responseTimeMs: optionalNonNegativeNumber(check.latency_ms),
    }))
}

function latestCheck(monitorId: string, checks: readonly CheckResult[]): CheckResult | undefined {
  return checks
    .filter((check) => !check.monitor_id || check.monitor_id === monitorId)
    .reduce<CheckResult | undefined>((latest, check) => {
      if (!latest) return check
      const latestAt = toTimestamp(latest.finished_at) ?? toTimestamp(latest.started_at) ?? 0
      const checkAt = toTimestamp(check.finished_at) ?? toTimestamp(check.started_at) ?? 0
      return checkAt >= latestAt ? check : latest
    }, undefined)
}

function expirySnapshot(
  check: CheckResult | undefined,
  kind: 'certificate' | 'domain',
  referenceTime: number,
): ExpirySnapshot | undefined {
  const details = check?.details
  if (!details) return undefined

  const envelope = childRecord(details, kind === 'certificate' ? 'tls_certificate' : 'domain_registration')
  const envelopeDetails = childRecord(envelope, 'details')
  const legacy = childRecord(details, kind === 'certificate' ? 'tls' : 'domain')
  const expiresAt = kind === 'certificate'
    ? firstString(
        recordString(details, 'certificate_expiry'),
        recordString(envelopeDetails, 'expires_at'),
        recordString(envelope, 'expires_at'),
        recordString(legacy, 'expires_at'),
        recordString(details, 'not_after'),
        recordString(details, 'valid_until'),
        recordString(details, 'expires_at'),
      )
    : firstString(
        recordString(details, 'domain_expires_at'),
        recordString(envelopeDetails, 'expires_at'),
        recordString(envelope, 'expires_at'),
        recordString(legacy, 'expires_at'),
        recordString(details, 'expiration_date'),
        recordString(details, 'valid_until'),
        recordString(details, 'expires_at'),
      )
  const expiresTimestamp = toTimestamp(expiresAt)
  if (!expiresAt || expiresTimestamp === null) return undefined

  const daysRemaining = Math.ceil((expiresTimestamp - referenceTime) / DAY_MS)
  return {
    expiresAt,
    daysRemaining,
    state: expiresTimestamp <= referenceTime ? 'expired' : daysRemaining <= 30 ? 'warning' : 'ok',
    ...(kind === 'certificate'
      ? {
          issuer: firstString(
            recordString(envelopeDetails, 'issuer'),
            recordString(envelope, 'issuer'),
            recordString(legacy, 'issuer'),
            recordString(details, 'certificate_issuer'),
            recordString(details, 'issuer'),
          ),
        }
      : {
          issuer: firstString(
            recordString(envelopeDetails, 'registrar'),
            recordString(envelope, 'registrar'),
            recordString(legacy, 'registrar'),
            recordString(details, 'domain_registrar'),
            recordString(details, 'registrar'),
          ),
        }),
  }
}

export interface MonitorAdapterOptions {
  checks?: readonly CheckResult[]
  stats?: UptimeStats
  activeIncident?: Pick<Incident, 'id'>
  now?: DateInput
}

export function toMonitorViewModel(
  monitor: Monitor,
  options: MonitorAdapterOptions = {},
): MonitorViewModel {
  const type = normaliseMonitorType(monitor.type)
  const checks = options.checks ?? []
  const lastCheck = latestCheck(monitor.id, checks)
  const referenceTime = nowTimestamp(options.now)
  const httpConfig = monitor.config?.http
  const isSecureHttp = /^https:\/\//i.test(httpConfig?.url ?? '')
  const tracksCertificateExpiry = type === 'tls' || (
    isSecureHttp && (
      httpConfig?.validate_tls === true || httpConfig?.tls_expiry_warn_days != null
    )
  )
  const tracksDomainExpiry = type === 'domain' || type === 'http' || type === 'keyword'

  return {
    id: nonEmpty(monitor.id, 'unknown-monitor'),
    name: nonEmpty(monitor.name, 'Unnamed monitor'),
    type,
    typeLabel: monitorTypeLabels[type],
    target: monitorTarget(monitor, type),
    status: monitor.paused ? 'paused' : normaliseMonitorStatus(monitor.status),
    group: nonEmpty(monitor.group_name, 'Ungrouped'),
    tags: Array.isArray(monitor.tags) ? [...monitor.tags] : [],
    intervalSeconds: nonNegativeNumber(monitor.interval_seconds),
    timeoutSeconds: nonNegativeNumber(monitor.timeout_seconds),
    lastCheckedAt: monitor.last_check_at ?? lastCheck?.finished_at ?? lastCheck?.started_at,
    statusChangedAt: monitor.last_status_change_at,
    responseTimeMs: optionalNonNegativeNumber(lastCheck?.latency_ms),
    uptime24h: clampPercentage(options.stats?.availability),
    last24Hours: toUptimeBars(monitor.id, checks),
    regions: Array.isArray(monitor.regions) ? [...monitor.regions] : [],
    incidentId: options.activeIncident?.id ?? lastCheck?.incident_id,
    sslCertificate:
      tracksCertificateExpiry
        ? expirySnapshot(lastCheck, 'certificate', referenceTime)
        : undefined,
    domainRegistration:
      tracksDomainExpiry ? expirySnapshot(lastCheck, 'domain', referenceTime) : undefined,
  }
}

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

export interface IncidentAdapterOptions {
  monitor?: Pick<Monitor, 'id' | 'name' | 'type'>
  assignee?: Pick<User, 'id' | 'name'>
  commentCount?: number
  now?: DateInput
}

export function toIncidentViewModel(
  incident: Incident,
  options: IncidentAdapterOptions = {},
): IncidentViewModel {
  const startedAt = toTimestamp(incident.started_at)
  const finishedAt = toTimestamp(incident.resolved_at) ?? nowTimestamp(options.now)
  const durationSeconds =
    startedAt === null ? 0 : Math.max(0, Math.round((finishedAt - startedAt) / 1_000))
  const rootCause = nonEmpty(incident.root_cause, nonEmpty(incident.title, 'Unknown cause'))

  return {
    id: nonEmpty(incident.id, 'unknown-incident'),
    monitorId: nonEmpty(incident.monitor_id, options.monitor?.id ?? 'unknown-monitor'),
    monitorName: nonEmpty(options.monitor?.name, 'Unknown monitor'),
    monitorType: normaliseMonitorType(options.monitor?.type),
    status: incident.status ?? 'investigating',
    rootCause,
    rootCauseCode: rootCauseCode(rootCause),
    startedAt: incident.started_at ?? '',
    resolvedAt: incident.resolved_at,
    durationSeconds,
    commentCount: Math.round(nonNegativeNumber(options.commentCount)),
    visibility: incident.visibility === 'excluded' ? 'excluded' : 'included',
    assignedTo:
      options.assignee?.name ??
      (typeof incident.assigned_to === 'string' && incident.assigned_to.trim()
        ? incident.assigned_to.trim()
        : undefined),
  }
}

function monitorNameLookup(monitors: readonly Pick<Monitor, 'id' | 'name'>[]): Map<string, string> {
  return new Map(
    monitors.map((monitor) => [monitor.id, nonEmpty(monitor.name, 'Unknown monitor')] as const),
  )
}

function normaliseWeekdays(weekdays: readonly number[] | undefined): readonly number[] {
  return [
    ...new Set(
      (weekdays ?? [])
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .map((day) => Number(day)),
    ),
  ].sort((left, right) => left - right)
}

function isInRecurringWindow(
  startsAt: number,
  durationMs: number,
  recurrence: MaintenanceRecurrence,
  weekdays: readonly number[],
  now: number,
): boolean {
  if (now < startsAt) return false
  if (recurrence === 'once') return now < startsAt + durationMs

  if (recurrence === 'daily') {
    const occurrenceStart = startsAt + Math.floor((now - startsAt) / DAY_MS) * DAY_MS
    return now < occurrenceStart + durationMs
  }

  const allowedDays = weekdays.length > 0 ? weekdays : [new Date(startsAt).getUTCDay()]
  const startDate = new Date(startsAt)
  const startTime =
    startDate.getUTCHours() * 3_600_000 +
    startDate.getUTCMinutes() * 60_000 +
    startDate.getUTCSeconds() * 1_000 +
    startDate.getUTCMilliseconds()

  for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
    const candidateDate = new Date(now - daysAgo * DAY_MS)
    if (!allowedDays.includes(candidateDate.getUTCDay())) continue
    candidateDate.setUTCHours(0, 0, 0, 0)
    const candidate = candidateDate.getTime() + startTime
    if (candidate >= startsAt && candidate <= now && now < candidate + durationMs) return true
  }
  return false
}

function maintenanceState(window: MaintenanceWindow, now: number): MaintenanceWindowViewModel['state'] {
  if (!window.active) return 'disabled'
  const startsAt = toTimestamp(window.starts_at)
  if (startsAt === null) return 'upcoming'
  const endsAt = toTimestamp(window.ends_at)
  if (endsAt !== null && now >= endsAt) return 'completed'

  const recurrence: MaintenanceRecurrence =
    window.recurrence === 'daily' || window.recurrence === 'weekly'
      ? window.recurrence
      : 'once'
  const durationMs = nonNegativeNumber(window.duration_minutes) * 60_000
  if (recurrence === 'once' && now >= startsAt + durationMs) return 'completed'
  if (
    isInRecurringWindow(
      startsAt,
      durationMs,
      recurrence,
      normaliseWeekdays(window.weekdays),
      now,
    )
  ) {
    return 'active'
  }
  return 'upcoming'
}

export interface MaintenanceWindowAdapterOptions {
  monitors?: readonly Pick<Monitor, 'id' | 'name'>[]
  now?: DateInput
}

export function toMaintenanceWindowViewModel(
  window: MaintenanceWindow,
  options: MaintenanceWindowAdapterOptions = {},
): MaintenanceWindowViewModel {
  const monitorIds = Array.isArray(window.monitor_ids) ? [...window.monitor_ids] : []
  const names = monitorNameLookup(options.monitors ?? [])
  const recurrence: MaintenanceRecurrence =
    window.recurrence === 'daily' || window.recurrence === 'weekly'
      ? window.recurrence
      : 'once'

  return {
    id: nonEmpty(window.id, 'unknown-maintenance'),
    name: nonEmpty(window.name, 'Untitled maintenance'),
    monitorIds,
    monitorNames: monitorIds.map((id) => names.get(id) ?? 'Unknown monitor'),
    startsAt: window.starts_at ?? '',
    durationMinutes: Math.round(nonNegativeNumber(window.duration_minutes)),
    timezone: nonEmpty(window.timezone, 'UTC'),
    recurrence,
    weekdays: normaliseWeekdays(window.weekdays),
    endsAt: window.ends_at,
    active: Boolean(window.active),
    state: maintenanceState(window, nowTimestamp(options.now)),
  }
}

function isStatusPageDetail(value: StatusPage | StatusPageDetail): value is StatusPageDetail {
  return 'page' in value && Boolean(value.page)
}

export interface StatusPageAdapterOptions {
  components?: readonly { monitor_id?: string }[]
  componentCount?: number
  announcementCount?: number
  subscribers?: number
  passwordProtected?: boolean
  publicBaseUrl?: string
}

export function toStatusPageViewModel(
  source: StatusPage | StatusPageDetail,
  options: StatusPageAdapterOptions = {},
): StatusPageViewModel {
  const page: StatusPage = isStatusPageDetail(source) ? source.page : source
  const detailComponents = isStatusPageDetail(source) ? source.components : undefined
  const components = options.components ?? detailComponents
  const baseUrl = nonEmpty(options.publicBaseUrl, 'https://status.sslping.local').replace(/\/$/, '')
  const customDomain = page.custom_domain?.trim() || undefined
  const customDomainVerified = Boolean(customDomain && page.custom_domain_verified_at)

  return {
    id: nonEmpty(page.id, 'unknown-status-page'),
    name: nonEmpty(page.name, 'Untitled status page'),
    slug: nonEmpty(page.slug, 'status'),
    url: customDomainVerified ? `https://${customDomain}` : `${baseUrl}/${page.slug || 'status'}`,
    monitorCount: Math.round(
      nonNegativeNumber(options.componentCount, Array.isArray(components) ? components.length : 0),
    ),
    accessLevel: !page.published
      ? 'private'
      : options.passwordProtected
        ? 'password'
        : 'public',
    status: page.published ? 'published' : 'draft',
    language: languageLabels[page.language] ?? nonEmpty(page.language, 'English'),
    customDomain,
    customDomainVerified,
    announcementCount: Math.round(nonNegativeNumber(options.announcementCount)),
    subscribers: Math.round(nonNegativeNumber(options.subscribers)),
    updatedAt: page.updated_at ?? page.created_at ?? '',
  }
}

function teamRole(role: unknown): TeamRole {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'editor':
      return role
    case 'notifier':
      return 'notify-only'
    case 'viewer':
    default:
      return 'reader'
  }
}

function memberStatus(status: unknown): TeamMemberViewModel['status'] {
  if (status === 'invited') return 'invited'
  if (status === 'disabled') return 'suspended'
  return 'active'
}

function initials(name: unknown, email?: unknown): string {
  const words = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : []
  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
  }
  if (typeof email === 'string' && email.trim()) return email.trim()[0].toUpperCase()
  return '?'
}

export interface TeamMemberAdapterOptions {
  user?: User
  currentUserId?: string
}

export function toTeamMemberViewModel(
  membership: Membership,
  options: TeamMemberAdapterOptions = {},
): TeamMemberViewModel {
  const user = membership.user ?? options.user
  const id = nonEmpty(user?.id, nonEmpty(membership.user_id, 'unknown-member'))
  const name = nonEmpty(user?.name, 'Unknown member')
  const email = nonEmpty(user?.email, 'Unavailable')

  return {
    id,
    name,
    email,
    initials: initials(name, email),
    phone: user?.phone?.trim() || undefined,
    role: teamRole(membership.role),
    twoFactorEnabled: Boolean(user?.two_factor_enabled),
    status: memberStatus(membership.status),
    isCurrentUser: Boolean(options.currentUserId && id === options.currentUserId),
    joinedAt: membership.created_at,
  }
}

export interface UserTeamMemberAdapterOptions {
  role?: TeamRole
  status?: TeamMemberViewModel['status']
  currentUserId?: string
  joinedAt?: string
}

export function toUserTeamMemberViewModel(
  user: User,
  options: UserTeamMemberAdapterOptions = {},
): TeamMemberViewModel {
  const id = nonEmpty(user.id, 'unknown-member')
  const name = nonEmpty(user.name, 'Unknown member')
  const email = nonEmpty(user.email, 'Unavailable')
  return {
    id,
    name,
    email,
    initials: initials(name, email),
    phone: user.phone?.trim() || undefined,
    role: options.role ?? 'reader',
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    status: options.status ?? 'active',
    isCurrentUser: Boolean(options.currentUserId && id === options.currentUserId),
    joinedAt: options.joinedAt ?? user.created_at,
  }
}

function integrationCategory(type: IntegrationType): IntegrationCategory {
  switch (type) {
    case 'slack':
    case 'microsoft_teams':
    case 'discord':
    case 'google_chat':
    case 'telegram':
      return 'chat'
    case 'webhook':
      return 'webhook'
    case 'pagerduty':
    case 'opsgenie':
      return 'incident-management'
    case 'pushover':
    case 'pushbullet':
      return 'push'
    case 'email':
      return 'email'
    case 'sms':
    case 'voice':
      return 'sms-voice'
  }
}

function humanise(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function integrationDestination(type: IntegrationType, config?: JsonObject): string {
  const endpointHost = recordString(config, 'endpoint_host')
  if (endpointHost) return endpointHost
  const destination = config?.to
  if (Array.isArray(destination)) {
    return `${destination.length} ${destination.length === 1 ? 'recipient' : 'recipients'}`
  }
  if (typeof destination === 'string' && destination.trim()) return destination.trim()
  return `${humanise(type)} integration`
}

function integrationConfigured(config?: JsonObject): boolean {
  if (!config) return false
  if (config.configured === false) return false
  if (config.configured === true) return true
  if (recordString(config, 'endpoint_host')) return true
  if (typeof config.to === 'string' && config.to.trim()) return true
  if (Array.isArray(config.to) && config.to.length > 0) return true
  return false
}

export function toIntegrationViewModel(integration: Integration): IntegrationViewModel {
  const type = integration.type
  const configured = integrationConfigured(integration.config)
  return {
    id: nonEmpty(integration.id, 'unknown-integration'),
    name: nonEmpty(integration.name, `${humanise(type)} integration`),
    type,
    category: integrationCategory(type),
    active: Boolean(integration.active),
    needsAttention: !integration.active || !configured,
    destinationLabel: integrationDestination(type, integration.config),
    events: Array.isArray(integration.events)
      ? ([...integration.events] as readonly IntegrationEvent[])
      : [],
    monitorIds: Array.isArray(integration.monitor_ids) ? [...integration.monitor_ids] : [],
    updatedAt: integration.updated_at ?? integration.created_at ?? '',
  }
}

function apiKeyKind(key: APIKey): ApiKeyViewModel['kind'] {
  if (key.monitor_id) return 'monitor-specific'
  const scopes = Array.isArray(key.scopes) ? key.scopes : []
  const hasWriteScope = scopes.some((scope) => scope === 'write' || scope.endsWith(':write'))
  return hasWriteScope ? 'main' : 'read-only'
}

function apiKeyStatus(key: APIKey, now: number): ApiKeyViewModel['status'] {
  if (key.revoked_at) return 'revoked'
  const expiresAt = toTimestamp(key.expires_at)
  if (expiresAt !== null && expiresAt <= now) return 'expired'
  if (expiresAt !== null && expiresAt - now <= WEEK_MS) return 'expiring'
  if (!key.last_used_at) return 'never-used'
  return 'active'
}

function displayPrefix(prefix: unknown): string {
  const value = nonEmpty(prefix, 'key')
  return /(?:…|\.\.\.)$/.test(value) ? value : `${value}…`
}

export interface ApiKeyAdapterOptions {
  monitor?: Pick<Monitor, 'id' | 'name'>
  now?: DateInput
}

export function toApiKeyViewModel(
  key: APIKey,
  options: ApiKeyAdapterOptions = {},
): ApiKeyViewModel {
  return {
    id: nonEmpty(key.id, 'unknown-api-key'),
    name: nonEmpty(key.name, 'Unnamed API key'),
    prefix: displayPrefix(key.prefix),
    scopes: Array.isArray(key.scopes) ? ([...key.scopes] as readonly ApiKeyScope[]) : [],
    kind: apiKeyKind(key),
    monitorId: key.monitor_id,
    monitorName: key.monitor_id
      ? options.monitor?.id === key.monitor_id
        ? nonEmpty(options.monitor.name, 'Unknown monitor')
        : 'Unknown monitor'
      : undefined,
    createdAt: key.created_at ?? '',
    lastUsedAt: key.last_used_at,
    expiresAt: key.expires_at,
    revokedAt: key.revoked_at,
    status: apiKeyStatus(key, nowTimestamp(options.now)),
  }
}

export interface AuditLogViewModel {
  id: string
  occurredAt: string
  actorName: string
  actorEmail?: string
  action: string
  category: 'auth' | 'team' | 'monitor' | 'incident' | 'integration' | 'api-key' | 'workspace'
  target: string
  ipAddress?: string
  outcome: 'success' | 'warning' | 'failure'
  detail?: string
}

function auditCategory(entry: AuditLog): AuditLogViewModel['category'] {
  const value = `${entry.action} ${entry.resource}`.toLowerCase()
  if (/auth|login|password|session|token/.test(value)) return 'auth'
  if (/team|member|membership|invite|invitation/.test(value)) return 'team'
  if (/monitor/.test(value)) return 'monitor'
  if (/incident/.test(value)) return 'incident'
  if (/integration|webhook/.test(value)) return 'integration'
  if (/api.?key/.test(value)) return 'api-key'
  return 'workspace'
}

function auditOutcome(entry: AuditLog): AuditLogViewModel['outcome'] {
  const metadata = isRecord(entry.metadata) ? entry.metadata : undefined
  const explicit = recordString(metadata, 'outcome')
  if (explicit === 'success' || explicit === 'warning' || explicit === 'failure') return explicit
  if (/fail|error|denied|reject/.test(entry.action.toLowerCase())) return 'failure'
  if (/pause|disable|revoke|warn/.test(entry.action.toLowerCase())) return 'warning'
  return 'success'
}

export interface AuditLogAdapterOptions {
  actor?: Pick<User, 'id' | 'name' | 'email'>
  resourceLabel?: string
}

export function toAuditLogViewModel(
  entry: AuditLog,
  options: AuditLogAdapterOptions = {},
): AuditLogViewModel {
  const metadata = isRecord(entry.metadata) ? entry.metadata : undefined
  const metadataTarget =
    recordString(metadata, 'target') ??
    recordString(metadata, 'name') ??
    recordString(metadata, 'email')
  const actorMatches = Boolean(options.actor && options.actor.id === entry.actor_id)

  return {
    id: nonEmpty(entry.id, 'unknown-audit-entry'),
    occurredAt: entry.created_at ?? '',
    actorName: actorMatches
      ? nonEmpty(options.actor?.name, 'Unknown user')
      : entry.actor_id
        ? 'Unknown user'
        : 'System worker',
    actorEmail: actorMatches ? options.actor?.email : undefined,
    action: nonEmpty(entry.action, 'unknown.action'),
    category: auditCategory(entry),
    target:
      options.resourceLabel?.trim() ||
      metadataTarget ||
      entry.resource_id ||
      humanise(nonEmpty(entry.resource, 'workspace')),
    ipAddress: entry.ip,
    outcome: auditOutcome(entry),
    detail: recordString(metadata, 'detail') ?? recordString(metadata, 'message'),
  }
}
