export type MonitorType =
  | 'http'
  | 'keyword'
  | 'tcp'
  | 'udp'
  | 'tls'
  | 'dns'
  | 'domain'
  | 'reachability'
  | 'heartbeat'
  | 'leakcheck'
  | 'compliance'

export type MonitorStatus = 'pending' | 'up' | 'down' | 'degraded' | 'paused'
export type CheckStatus = 'ok' | 'failed' | 'degraded' | 'skipped'
export type UptimeBarStatus = 'up' | 'down' | 'degraded' | 'maintenance' | 'no-data'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type StatusTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'info'

export interface UptimeBar {
  id: string
  startedAt: string
  status: UptimeBarStatus
  responseTimeMs?: number
}

export interface ExpirySnapshot {
  expiresAt: string
  daysRemaining: number
  state: 'ok' | 'warning' | 'expired' | 'unknown'
  issuer?: string
}

export interface MonitorViewModel {
  id: string
  name: string
  type: MonitorType
  typeLabel: string
  target: string
  status: MonitorStatus
  group: string
  tags: readonly string[]
  intervalSeconds: number
  timeoutSeconds: number
  slowThresholdMs?: number
  lastCheckedAt?: string
  statusChangedAt?: string
  responseTimeMs?: number
  uptime24h?: number
  incidentCount24h?: number
  downtimeSeconds24h?: number
  mtbfSeconds24h?: number
  last24Hours: readonly UptimeBar[]
  regions: readonly string[]
  incidentId?: string
  lastIncidentAt?: string
  hasOpenIncident?: boolean
  sslCertificate?: ExpirySnapshot
  domainRegistration?: ExpirySnapshot
  leakReport?: import('../api/types').LeakCheckReport
  leakReportCached?: boolean
  leakCacheExpiresAt?: string
  complianceReport?: import('../api/types').ComplianceReport
}

export interface MonitorSummary {
  total: number
  up: number
  down: number
  degraded: number
  paused: number
  pending: number
  capacity: number
  overallUptime24h?: number
  incidentCount24h: number
  downtimeSeconds24h: number
  mtbfSeconds?: number
}

export interface MonitorListViewModel {
  monitors: readonly MonitorViewModel[]
  summary: MonitorSummary
}

export interface ResponseTimePoint {
  timestamp: string
  valueMs: number
  status: CheckStatus
}

export interface ResponseTimeSeries {
  regionId: string
  regionLabel: string
  color: string
  points: readonly ResponseTimePoint[]
  averageMs: number
  minimumMs: number
  maximumMs: number
}

export interface UptimePeriodSummary {
  period: '24h' | '7d' | '30d' | '365d'
  uptime: number
  incidentCount: number
  downtimeSeconds: number
}

export interface IncidentLocationObservation {
  region: string
  status: CheckStatus
  rootCause?: string
  latencyMs?: number
  finishedAt?: string
}

export interface IncidentLocationQuorum {
  policy: string
  expectedLocations: number
  requiredFailures: number
  requiredRecoveries: number
  evaluatedAt?: string
  observations: readonly IncidentLocationObservation[]
}

export interface IncidentViewModel {
  id: string
  monitorId: string
  monitorName: string
  monitorType: MonitorType
  status: IncidentStatus
  rootCause: string
  rootCauseCode: string
	source?: 'monitor' | 'user_report'
	reportReasonLabel?: string
  startedAt: string
  resolvedAt?: string
  durationSeconds: number
  commentCount: number
  visibility: 'included' | 'excluded'
  assignedTo?: string
  locationQuorum?: IncidentLocationQuorum
  leakReport?: import('../api/types').LeakCheckReport
  complianceReport?: import('../api/types').ComplianceReport
}

export interface IncidentSummary {
  open: number
  resolved: number
  total: number
}

export interface IncidentListViewModel {
  incidents: readonly IncidentViewModel[]
  summary: IncidentSummary
}

export interface StatusPageViewModel {
  id: string
  name: string
  slug: string
  url: string
  monitorCount: number
  accessLevel: 'public' | 'password' | 'private'
  status: 'published' | 'draft'
  language: string
  languageCode?: import('../api/types').StatusPageLanguage
  customDomain?: string
  customDomainVerified: boolean
  announcementCount: number
  subscribers: number
  updatedAt: string
}

export interface StatusPageListViewModel {
  pages: readonly StatusPageViewModel[]
}

export type MaintenanceRecurrence = 'once' | 'daily' | 'weekly'

export interface MaintenanceWindowViewModel {
  id: string
  name: string
  monitorIds: readonly string[]
  monitorNames: readonly string[]
  startsAt: string
  durationMinutes: number
  timezone: string
  recurrence: MaintenanceRecurrence
  weekdays: readonly number[]
  endsAt?: string
  active: boolean
  state: 'upcoming' | 'active' | 'completed' | 'disabled'
}

export interface MaintenanceListViewModel {
  windows: readonly MaintenanceWindowViewModel[]
}

export type TeamRole = 'owner' | 'admin' | 'editor' | 'reader' | 'notify-only'

export interface TeamMemberViewModel {
  id: string
  name: string
  email: string
  initials: string
  phone?: string
  role: TeamRole
  twoFactorEnabled: boolean
  status: 'active' | 'invited' | 'suspended'
  isCurrentUser: boolean
  joinedAt?: string
}

export interface TeamSummary {
  seatsUsed: number
  seatsTotal: number
  loginSeatsUsed: number
  notifySeatsUsed: number
  planName: string
}

export interface TeamViewModel {
  members: readonly TeamMemberViewModel[]
  summary: TeamSummary
}

export type IntegrationCategory =
  | 'chat'
  | 'webhook'
  | 'incident-management'
  | 'push'
  | 'email'
  | 'sms-voice'

export type IntegrationType =
  | 'webhook'
  | 'slack'
  | 'microsoft_teams'
  | 'discord'
  | 'google_chat'
  | 'telegram'
  | 'email'
  | 'pagerduty'
  | 'opsgenie'
  | 'pushover'
  | 'pushbullet'
  | 'sms'
  | 'voice'

export type IntegrationEvent =
  | 'monitor.down'
  | 'monitor.up'
  | 'monitor.slow'
  | 'ssl.expiry'
  | 'domain.expiry'
  | 'incident.updated'
  | 'maintenance.started'

export interface IntegrationCatalogItem {
  type: IntegrationType
  name: string
  description: string
  category: IntegrationCategory
  available: boolean
}

export interface IntegrationViewModel {
  id: string
  name: string
  type: IntegrationType
  category: IntegrationCategory
  active: boolean
  needsAttention: boolean
  destinationLabel: string
  events: readonly IntegrationEvent[]
  monitorIds: readonly string[]
  updatedAt: string
}

export interface IntegrationListViewModel {
  catalog: readonly IntegrationCatalogItem[]
  configured: readonly IntegrationViewModel[]
}

export type ApiKeyScope =
  | 'read'
  | 'write'
  | 'monitors:read'
  | 'monitors:write'
  | 'incidents:read'
  | 'incidents:write'
  | 'status:read'

export interface ApiKeyViewModel {
  id: string
  name: string
  prefix: string
  scopes: readonly ApiKeyScope[]
  kind: 'main' | 'read-only' | 'monitor-specific'
  monitorId?: string
  monitorName?: string
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  revokedAt?: string
  status: 'active' | 'expiring' | 'expired' | 'revoked' | 'never-used'
}

export interface ApiKeyListViewModel {
  keys: readonly ApiKeyViewModel[]
}

export interface MonitorDetailViewModel {
  monitor: MonitorViewModel
  responseTime: readonly ResponseTimeSeries[]
  uptimePeriods: readonly UptimePeriodSummary[]
  incidents: readonly IncidentViewModel[]
  nextMaintenance?: MaintenanceWindowViewModel
  notifiedBy: readonly IntegrationType[]
  statusPageNames: readonly string[]
}

export interface EmptyStateContent {
  title: string
  description: string
  actionLabel?: string
}

export type DemoViewState<T> =
  | {
      kind: 'loading'
      data: null
      skeletonCount: number
    }
  | {
      kind: 'empty'
      data: T
      emptyState: EmptyStateContent
    }
  | {
      kind: 'filled'
      data: T
    }

export interface DemoStateSet<T> {
  loading: DemoViewState<T>
  empty: DemoViewState<T>
  filled: DemoViewState<T>
}
