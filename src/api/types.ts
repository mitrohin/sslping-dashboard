export type UUID = string
export type ISODateTime = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type ProblemCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal_error'

export interface Problem {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  code: ProblemCode
  errors?: Record<string, string>
}

export interface Tokens {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_at: ISODateTime
}

export interface User {
  id: UUID
  email: string
  name: string
  phone?: string
  locale: string
  timezone: string
  email_verified_at?: ISODateTime
  two_factor_enabled: boolean
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface Workspace {
  id: UUID
  name: string
  slug: string
  plan: string
  timezone: string
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface RegisterRequest {
  email: string
  password: string
  name: string
  workspace_name?: string
  locale?: string
  timezone?: string
}

export interface RegisterResponse {
  user: User
  tenant: Workspace
  tokens?: Tokens
  verification_token?: string
}

export interface LoginRequest {
  email: string
  password: string
  tenant_id?: UUID
}

export type LoginResult =
  | {
      user: User
      tokens: Tokens
      two_factor_required: false
      challenge_token?: never
      challenge_expires_at?: never
    }
  | {
      user: User
      tokens?: never
      two_factor_required: true
      challenge_token: string
      challenge_expires_at: ISODateTime
    }

export interface LoginResponse {
  user: User
  tokens: Tokens
}

export interface TwoFactorLoginRequest {
  challenge_token: string
  code: string
}

export interface EmailRequest {
  email: string
}

export interface TokenRequest {
  token: string
}

export interface PasswordResetRequest {
  token: string
  new_password: string
}

export interface PasswordChangeRequest {
  current_password: string
  new_password: string
}

export interface PasswordProofRequest {
  password: string
}

export interface TOTPCodeRequest {
  code: string
}

export interface TwoFactorProofRequest {
  password: string
  code: string
}

export interface EmailVerificationRequestedResponse {
  message: 'If the address requires verification, a confirmation email has been sent.'
  verification_token?: string
}

export interface EmailVerifiedResponse {
  status: 'verified'
  user: User
}

export interface PasswordResetRequestedResponse {
  message: 'If the account exists, a password reset email has been sent.'
  reset_token?: string
}

export interface TwoFactorSetup {
  secret: string
  otpauth_url: string
  account_name: string
}

export interface RecoveryCodesResponse {
  recovery_codes: string[]
}

export interface MeResponse {
  user: User
  tenants: Workspace[]
  active_tenant_id: UUID
}

export interface WorkspacePatch {
  name?: string
  slug?: string
  timezone?: string
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer' | 'notifier'
export type MemberStatus = 'invited' | 'active' | 'disabled'

export interface Membership {
  workspace_id: UUID
  user_id: UUID
  role: Role
  status: MemberStatus
  created_at: ISODateTime
  updated_at: ISODateTime
  user?: User
}

export interface MembershipPatch {
  role?: Role
  status?: MemberStatus
}

export interface InvitationRequest {
  email: string
  role: Exclude<Role, 'owner'>
  phone?: string
}

export interface Invitation {
  id: UUID
  workspace_id: UUID
  email: string
  role: Role
  phone?: string
  invited_by: UUID
  expires_at: ISODateTime
  accepted_at?: ISODateTime
  created_at: ISODateTime
}

export interface InvitationCreateResponse {
  invitation: Invitation
  invite_token?: string
}

export interface Region {
  id: 'local' | 'eu-west' | 'us-east' | 'ap-south'
  name: string
  capabilities: Array<'http' | 'tcp' | 'tls' | 'dns' | 'domain' | 'reachability'>
  status: 'available' | 'deployable'
}

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

export type MonitorStatus = 'pending' | 'up' | 'down' | 'degraded' | 'paused'
export type CheckStatus = 'ok' | 'failed' | 'degraded' | 'skipped'

export interface KeywordRule {
  value: string
  mode: 'present' | 'absent'
  case_sensitive: boolean
}

export interface HTTPAuth {
  type: 'none' | 'basic' | 'bearer'
  username?: string
  password?: string
  token?: string
}

export interface HTTPConfig {
  url: string
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
  headers?: Record<string, string>
  body?: string
  send_json?: boolean
  follow_redirects?: boolean
  allowed_status_classes?: number[]
  allowed_status_codes?: number[]
  keyword?: KeywordRule
  auth?: HTTPAuth
  max_body_bytes?: number
  ip_family?: '' | 'ip4' | 'ip6'
  user_agent?: string
  validate_tls?: boolean | null
  tls_expiry_warn_days?: number[] | null
  domain_expiry_warn_days?: number[] | null
}

export interface TCPConfig {
  host: string
  port: number
  send?: string
  expect?: string
  use_tls?: boolean
  server_name?: string
}

export interface UDPConfig {
  host: string
  port: number
  payload?: string
  expect?: string
}

export interface TLSConfig {
  host: string
  port?: number
  server_name?: string
  warn_days?: number[] | null
}

export interface DNSConfig {
  name: string
  record_type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'CAA' | 'SRV'
  expected?: string[]
  nameserver?: string
  require_dnssec?: boolean
}

export interface DomainConfig {
  domain: string
  warn_days?: number[] | null
}

export interface ReachabilityConfig {
  host: string
  port?: number
}

export interface HeartbeatConfig {
  period_seconds: number
  grace_seconds?: number
}

export interface MonitorConfig {
  http?: HTTPConfig
  tcp?: TCPConfig
  udp?: UDPConfig
  tls?: TLSConfig
  dns?: DNSConfig
  domain?: DomainConfig
  reachability?: ReachabilityConfig
  heartbeat?: HeartbeatConfig
}

export interface RetryPolicy {
  failure_threshold?: number
  recovery_threshold?: number
  confirmation_delay_seconds?: number
}

export interface ResolvedRetryPolicy {
  failure_threshold: number
  recovery_threshold: number
  confirmation_delay_seconds: number
}

interface MonitorWriteFields {
  name: string
  config: MonitorConfig
  interval_seconds?: number
  timeout_seconds?: number
  regions?: string[]
  tags?: string[]
  group_name?: string
  retry_policy?: RetryPolicy
  slow_threshold_ms?: number
  paused?: boolean
}

export interface MonitorCreateRequest extends MonitorWriteFields {
  type: MonitorType
}

export interface MonitorUpdateRequest extends MonitorWriteFields {
  type?: MonitorType
}

export interface Monitor {
  id: UUID
  workspace_id: UUID
  name: string
  type: MonitorType
  status: MonitorStatus
  config: MonitorConfig
  interval_seconds: number
  timeout_seconds: number
  regions: string[]
  tags: string[]
  group_name?: string
  retry_policy: ResolvedRetryPolicy
  slow_threshold_ms?: number
  paused: boolean
  last_check_at?: ISODateTime
  last_heartbeat_at?: ISODateTime
  last_status_change_at?: ISODateTime
  next_check_at: ISODateTime
  consecutive_failures: number
  consecutive_recoveries: number
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface MonitorCreateResponse {
  monitor: Monitor
  heartbeat_token?: string
  heartbeat_url?: string
}

export interface Page<T> {
  items: T[]
  next_cursor?: string
}

export interface ItemList<T> {
  items: T[]
}

export interface HeartbeatTokenResponse {
  heartbeat_token: string
  heartbeat_url: string
}

export interface CheckResult {
  id: UUID
  workspace_id: UUID
  monitor_id: UUID
  region: string
  status: CheckStatus
  root_cause?: string
  message?: string
  status_code?: number
  latency_ms: number
  started_at: ISODateTime
  finished_at: ISODateTime
  details?: JsonObject
  incident_id?: UUID
}

export interface UptimeStats {
  from: ISODateTime
  to: ISODateTime
  availability: number
  average_latency_ms: number
  p50_latency_ms: number
  p95_latency_ms: number
  p99_latency_ms: number
  checks: number
  failures: number
  incidents: number
  downtime_seconds: number
  mtbf_seconds: number
}

export interface MetricsSummaryItem {
  monitor_id: UUID
  name: string
  status: MonitorStatus
  stats: UptimeStats
}

export interface MetricsSummary {
  from: ISODateTime
  to: ISODateTime
  items: MetricsSummaryItem[]
}

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export interface Incident {
  id: UUID
  workspace_id: UUID
  monitor_id: UUID
  status: IncidentStatus
  title: string
  root_cause?: string
  started_at: ISODateTime
  acknowledged_at?: ISODateTime
  acknowledged_by?: UUID
  assigned_to?: UUID
  resolved_at?: ISODateTime
  visibility: string
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface IncidentUpdate {
  id: UUID
  incident_id: UUID
  status: IncidentStatus
  message: string
  created_by?: UUID
  created_at: ISODateTime
}

export interface IncidentDetail {
  incident: Incident
  timeline: IncidentUpdate[]
}

export type Recurrence = '' | 'once' | 'daily' | 'weekly'

export interface MaintenanceWindowWrite {
  name: string
  monitor_ids: UUID[]
  starts_at: ISODateTime
  duration_minutes: number
  timezone?: string
  recurrence?: Recurrence
  weekdays?: number[]
  ends_at?: ISODateTime | null
  active?: boolean
}

export interface MaintenanceWindow {
  id: UUID
  workspace_id: UUID
  name: string
  monitor_ids: UUID[]
  starts_at: ISODateTime
  duration_minutes: number
  timezone: string
  recurrence: Recurrence
  weekdays?: number[]
  ends_at?: ISODateTime
  active: boolean
  created_at: ISODateTime
  updated_at: ISODateTime
}

export type StatusPageLanguage = 'en' | 'zh' | 'hi' | 'es' | 'fr' | 'ar' | 'bn' | 'pt' | 'ru' | 'id'
export type StatusPageRobotsPolicy = 'index,follow' | 'noindex,nofollow' | 'noindex,follow'

export interface StatusPageSettings {
  show_bar_charts?: boolean
  show_uptime_percentage?: boolean
  show_overall_percentage?: boolean
  show_outage_details?: boolean
  enable_details_page?: boolean
  show_monitor_url?: boolean
  hide_paused_monitors?: boolean
  enable_subscribe?: boolean
  show_latest_downtime?: boolean
  small_cookie_dialog?: boolean
  share_analytics?: boolean
}

export type ResolvedStatusPageSettings = Required<StatusPageSettings>

export interface StatusPageCreateFields {
  name: string
  slug?: string
  homepage_url?: string
  custom_domain?: string
  language?: StatusPageLanguage
  published?: boolean
  robots?: StatusPageRobotsPolicy
  branding?: JsonValue
  settings?: StatusPageSettings
}

export interface StatusPageUpdateFields {
  name: string
  slug: string
  homepage_url?: string
  custom_domain?: string
  language: StatusPageLanguage
  published?: boolean
  robots: StatusPageRobotsPolicy
  branding?: JsonValue
  settings?: StatusPageSettings
}

export interface StatusPageCreateRequest {
  page: StatusPageCreateFields
  password?: string | null
  monitor_ids?: UUID[]
}

export interface StatusPageUpdateRequest {
  page: StatusPageUpdateFields
  password?: string | null
  monitor_ids?: UUID[]
}

export interface StatusPage {
  id: UUID
  workspace_id: UUID
  name: string
  slug: string
  homepage_url?: string
  custom_domain?: string
  custom_domain_verification_expires_at?: ISODateTime
  custom_domain_verified_at?: ISODateTime
  language: StatusPageLanguage
  published: boolean
  robots: StatusPageRobotsPolicy
  branding?: JsonValue
  settings: ResolvedStatusPageSettings
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface DNSRecord {
  type: 'TXT'
  name: string
  value: string
}

export interface CustomDomainChallenge {
  domain: string
  dns_record: DNSRecord
  expires_at: ISODateTime
}

export interface CustomDomainClaimResponse {
  page: StatusPage
  challenge: CustomDomainChallenge
}

export interface StatusPageComponent {
  id: UUID
  status_page_id: UUID
  monitor_id: UUID
  name: string
  position: number
  created_at: ISODateTime
}

export interface StatusPageDetail {
  page: StatusPage
  components: StatusPageComponent[]
}

export interface AnnouncementRequest {
  title: string
  body: string
  status: IncidentStatus
  incident_id?: UUID
}

export interface Announcement {
  id: UUID
  status_page_id: UUID
  incident_id?: UUID
  title: string
  body: string
  status: IncidentStatus
  published_at: ISODateTime
  resolved_at?: ISODateTime
  created_by: string
}

export interface PublicStatusPage {
  name: string
  slug: string
  homepage_url?: string
  language: StatusPageLanguage
  robots: StatusPageRobotsPolicy
  branding?: JsonValue
  settings: ResolvedStatusPageSettings
}

export interface PublicStatusComponent {
  name: string
  status: MonitorStatus
  uptime_24h?: number
  last_checked_at?: ISODateTime
}

export interface PublicStatusAnnouncement {
  id: UUID
  title: string
  body: string
  status: IncidentStatus
  published_at: ISODateTime
  resolved_at?: ISODateTime
}

export interface PublicStatusSnapshot {
  page: PublicStatusPage
  password_protected: boolean
  overall_status?: MonitorStatus
  components: PublicStatusComponent[] | null
  announcements: PublicStatusAnnouncement[] | null
  generated_at: ISODateTime
}

export interface SubscriptionAcceptedResponse {
  message: 'If the address can be subscribed, a confirmation email has been sent.'
  confirmation_token?: string
}

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

export interface WebhookIntegrationConfig {
  url: string
  headers?: Record<string, string>
  signing_secret?: string
  custom_value?: string
}

export interface TelegramIntegrationConfig {
  bot_token: string
  chat_id: string
}

export interface PagerDutyIntegrationConfig {
  routing_key: string
}

export interface OpsgenieIntegrationConfig {
  api_key: string
  region?: string
}

export interface PushoverIntegrationConfig {
  api_token: string
  user_key: string
  device?: string
  priority?: number
}

export interface PushbulletIntegrationConfig {
  access_token: string
}

export interface TwilioIntegrationConfig {
  account_sid: string
  auth_token: string
  from: string
  to: string
}

export interface EmailIntegrationConfig {
  to: string[]
}

export type IntegrationConfigInput =
  | WebhookIntegrationConfig
  | TelegramIntegrationConfig
  | PagerDutyIntegrationConfig
  | OpsgenieIntegrationConfig
  | PushoverIntegrationConfig
  | PushbulletIntegrationConfig
  | TwilioIntegrationConfig
  | EmailIntegrationConfig

export interface IntegrationCreateRequest {
  name: string
  type: IntegrationType
  events: IntegrationEvent[]
  monitor_ids?: UUID[]
  active?: boolean
  config: IntegrationConfigInput
}

export interface IntegrationUpdateRequest {
  name?: string
  type?: IntegrationType
  events: IntegrationEvent[]
  monitor_ids?: UUID[]
  active?: boolean
  config?: IntegrationConfigInput
}

export interface Integration {
  id: UUID
  workspace_id: UUID
  name: string
  type: IntegrationType
  events: IntegrationEvent[]
  monitor_ids?: UUID[]
  config?: JsonObject
  active: boolean
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface SentResponse {
  status: 'sent'
}

export type APIKeyScope =
  | 'read'
  | 'write'
  | 'monitors:read'
  | 'monitors:write'
  | 'incidents:read'
  | 'incidents:write'
  | 'status:read'

export interface APIKeyRequest {
  name: string
  scopes?: APIKeyScope[]
  monitor_id?: UUID
  expires_at?: ISODateTime | null
}

export interface APIKey {
  id: UUID
  workspace_id: UUID
  name: string
  prefix: string
  scopes: APIKeyScope[]
  monitor_id?: UUID
  last_used_at?: ISODateTime
  expires_at?: ISODateTime
  revoked_at?: ISODateTime
  created_by: UUID
  created_at: ISODateTime
}

export interface APIKeyCreateResponse {
  api_key: APIKey
  secret: string
}

export interface AuditLog {
  id: UUID
  workspace_id: UUID
  actor_id?: UUID
  action: string
  resource: string
  resource_id?: string
  ip?: string
  metadata?: JsonValue
  created_at: ISODateTime
}

export interface ListQuery {
  limit?: number
  cursor?: string
  search?: string
}

export interface TimeRangeQuery {
  from?: ISODateTime
  to?: ISODateTime
}

export type HistoryQuery = ListQuery & TimeRangeQuery
