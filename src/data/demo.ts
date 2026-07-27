import type {
  ApiKeyListViewModel,
  ApiKeyViewModel,
  DemoStateSet,
  DemoViewState,
  IncidentListViewModel,
  IncidentViewModel,
  IntegrationCatalogItem,
  IntegrationListViewModel,
  IntegrationViewModel,
  MaintenanceListViewModel,
  MaintenanceWindowViewModel,
  MonitorDetailViewModel,
  MonitorListViewModel,
  MonitorStatus,
  MonitorSummary,
  MonitorViewModel,
  ResponseTimePoint,
  ResponseTimeSeries,
  StatusPageListViewModel,
  StatusPageViewModel,
  TeamMemberViewModel,
  TeamViewModel,
  UptimeBar,
  UptimeBarStatus,
  UptimePeriodSummary,
} from './models'

export const DEMO_NOW = '2026-07-25T13:00:00.000Z'

const DEMO_NOW_MS = Date.parse(DEMO_NOW)

const isoBefore = (seconds: number): string => new Date(DEMO_NOW_MS - seconds * 1_000).toISOString()
const isoAfter = (seconds: number): string => new Date(DEMO_NOW_MS + seconds * 1_000).toISOString()

function buildUptimeBars(
  key: string,
  overrides: Readonly<Record<number, UptimeBarStatus>> = {},
): readonly UptimeBar[] {
  return Array.from({ length: 30 }, (_, index) => {
    const status = overrides[index] ?? 'up'
    return {
      id: `${key}-bar-${index + 1}`,
      startedAt: isoBefore((29 - index) * 48 * 60),
      status,
      ...(status === 'up' || status === 'degraded'
        ? { responseTimeMs: 135 + ((index * 37 + key.length * 11) % 260) }
        : {}),
    }
  })
}

const monitorIds = {
  website: '10000000-0000-4000-8000-000000000001',
  api: '10000000-0000-4000-8000-000000000002',
  checkout: '10000000-0000-4000-8000-000000000003',
  dns: '10000000-0000-4000-8000-000000000004',
  heartbeat: '10000000-0000-4000-8000-000000000005',
  smtp: '10000000-0000-4000-8000-000000000006',
  certificate: '10000000-0000-4000-8000-000000000007',
  domain: '10000000-0000-4000-8000-000000000008',
  edge: '10000000-0000-4000-8000-000000000009',
} as const

export const demoMonitors: readonly MonitorViewModel[] = [
  {
    id: monitorIds.website,
    name: 'Marketing website',
    type: 'http',
    typeLabel: 'HTTP',
    target: 'https://www.example.com',
    status: 'up',
    group: 'Public websites',
    tags: ['production', 'website'],
    intervalSeconds: 60,
    timeoutSeconds: 15,
    lastCheckedAt: isoBefore(22),
    statusChangedAt: isoBefore(2_764_800),
    responseTimeMs: 184,
    uptime24h: 100,
    last24Hours: buildUptimeBars('website'),
    regions: ['North America', 'Europe', 'Asia Pacific'],
    sslCertificate: {
      expiresAt: '2026-10-18T00:00:00.000Z',
      daysRemaining: 85,
      state: 'ok',
      issuer: "Let's Encrypt",
    },
    domainRegistration: {
      expiresAt: '2028-03-12T00:00:00.000Z',
      daysRemaining: 596,
      state: 'ok',
    },
  },
  {
    id: monitorIds.api,
    name: 'Production API',
    type: 'keyword',
    typeLabel: 'Keyword',
    target: 'https://api.example.com/v1/health',
    status: 'up',
    group: 'Core API',
    tags: ['production', 'api'],
    intervalSeconds: 60,
    timeoutSeconds: 20,
    lastCheckedAt: isoBefore(41),
    statusChangedAt: isoBefore(1_537_200),
    responseTimeMs: 312,
    uptime24h: 99.972,
    last24Hours: buildUptimeBars('api', { 8: 'degraded' }),
    regions: ['North America', 'Europe'],
    sslCertificate: {
      expiresAt: '2026-09-16T00:00:00.000Z',
      daysRemaining: 53,
      state: 'ok',
      issuer: 'Google Trust Services',
    },
  },
  {
    id: monitorIds.checkout,
    name: 'Checkout API',
    type: 'http',
    typeLabel: 'HTTP',
    target: 'https://checkout.example.com/health',
    status: 'down',
    group: 'Commerce',
    tags: ['production', 'critical'],
    intervalSeconds: 30,
    timeoutSeconds: 10,
    lastCheckedAt: isoBefore(17),
    statusChangedAt: isoBefore(312),
    responseTimeMs: 10_000,
    uptime24h: 97.128,
    last24Hours: buildUptimeBars('checkout', {
      22: 'degraded',
      23: 'down',
      24: 'down',
      25: 'down',
      26: 'down',
      27: 'down',
      28: 'down',
      29: 'down',
    }),
    regions: ['North America', 'Europe', 'Asia Pacific'],
    incidentId: '20000000-0000-4000-8000-000000000001',
    sslCertificate: {
      expiresAt: '2026-08-29T00:00:00.000Z',
      daysRemaining: 35,
      state: 'ok',
      issuer: 'Amazon',
    },
  },
  {
    id: monitorIds.dns,
    name: 'Authoritative DNS',
    type: 'dns',
    typeLabel: 'DNS',
    target: 'example.com · A',
    status: 'degraded',
    group: 'Infrastructure',
    tags: ['dns', 'critical'],
    intervalSeconds: 300,
    timeoutSeconds: 10,
    lastCheckedAt: isoBefore(96),
    statusChangedAt: isoBefore(1_140),
    responseTimeMs: 873,
    uptime24h: 99.621,
    last24Hours: buildUptimeBars('dns', { 20: 'degraded', 21: 'degraded', 22: 'degraded' }),
    regions: ['Europe', 'Asia Pacific'],
  },
  {
    id: monitorIds.heartbeat,
    name: 'Nightly database backup',
    type: 'heartbeat',
    typeLabel: 'Heartbeat',
    target: 'Every 24 hours · 30 minute grace period',
    status: 'paused',
    group: 'Cron jobs',
    tags: ['backup'],
    intervalSeconds: 86_400,
    timeoutSeconds: 30,
    lastCheckedAt: isoBefore(61_200),
    statusChangedAt: isoBefore(14_400),
    uptime24h: 100,
    last24Hours: buildUptimeBars('heartbeat', {
      25: 'no-data',
      26: 'no-data',
      27: 'no-data',
      28: 'no-data',
      29: 'no-data',
    }),
    regions: ['Heartbeat'],
  },
  {
    id: monitorIds.smtp,
    name: 'Transactional mail',
    type: 'tcp',
    typeLabel: 'TCP',
    target: 'smtp.example.com:587',
    status: 'up',
    group: 'Infrastructure',
    tags: ['email'],
    intervalSeconds: 300,
    timeoutSeconds: 15,
    lastCheckedAt: isoBefore(107),
    statusChangedAt: isoBefore(7_776_000),
    responseTimeMs: 96,
    uptime24h: 100,
    last24Hours: buildUptimeBars('smtp'),
    regions: ['Europe'],
  },
  {
    id: monitorIds.certificate,
    name: 'Customer portal',
    type: 'http',
    typeLabel: 'HTTP',
    target: 'https://portal.example.com/health',
    status: 'up',
    group: 'Production',
    tags: ['customer-facing', 'ssl'],
    intervalSeconds: 60,
    timeoutSeconds: 15,
    lastCheckedAt: isoBefore(1_860),
    statusChangedAt: isoBefore(10_368_000),
    responseTimeMs: 131,
    uptime24h: 100,
    last24Hours: buildUptimeBars('certificate'),
    regions: ['Europe'],
    sslCertificate: {
      expiresAt: '2026-08-02T00:00:00.000Z',
      daysRemaining: 8,
      state: 'warning',
      issuer: "Let's Encrypt",
    },
  },
  {
    id: monitorIds.domain,
    name: 'Main website',
    type: 'http',
    typeLabel: 'HTTP',
    target: 'https://example.com',
    status: 'up',
    group: 'Production',
    tags: ['website', 'domain'],
    intervalSeconds: 300,
    timeoutSeconds: 20,
    lastCheckedAt: isoBefore(18_000),
    statusChangedAt: isoBefore(31_536_000),
    uptime24h: 100,
    last24Hours: buildUptimeBars('domain'),
    regions: ['Europe'],
    domainRegistration: {
      expiresAt: '2026-09-23T00:00:00.000Z',
      daysRemaining: 60,
      state: 'ok',
    },
  },
  {
    id: monitorIds.edge,
    name: 'Edge gateway',
    type: 'reachability',
    typeLabel: 'Reachability',
    target: 'edge.example.com:443',
    status: 'pending',
    group: 'Infrastructure',
    tags: ['edge'],
    intervalSeconds: 60,
    timeoutSeconds: 10,
    uptime24h: undefined,
    last24Hours: buildUptimeBars('edge', Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [index, 'no-data' as const]),
    )),
    regions: ['North America'],
  },
]

function summarizeMonitors(monitors: readonly MonitorViewModel[]): MonitorSummary {
  const count = (status: MonitorStatus): number =>
    monitors.filter((monitor) => monitor.status === status).length
  const uptimeValues = monitors
    .filter((monitor) => monitor.status !== 'paused' && monitor.uptime24h !== undefined)
    .map((monitor) => monitor.uptime24h as number)

  return {
    total: monitors.length,
    up: count('up'),
    down: count('down'),
    degraded: count('degraded'),
    paused: count('paused'),
    pending: count('pending'),
    capacity: 100,
    overallUptime24h:
      uptimeValues.length > 0
        ? uptimeValues.reduce((total, value) => total + value, 0) / uptimeValues.length
        : undefined,
    incidentCount24h: 3,
    downtimeSeconds24h: 2_724,
    mtbfSeconds: 1_908_000,
  }
}

export const demoMonitorList: MonitorListViewModel = {
  monitors: demoMonitors,
  summary: summarizeMonitors(demoMonitors),
}

export const demoUptimeBars: readonly UptimeBar[] = demoMonitors[0].last24Hours

export const demoUptimeBarsByMonitor: Readonly<Record<string, readonly UptimeBar[]>> =
  Object.fromEntries(demoMonitors.map((monitor) => [monitor.id, monitor.last24Hours]))

export const demoIncidents: readonly IncidentViewModel[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    monitorId: monitorIds.checkout,
    monitorName: 'Checkout API',
    monitorType: 'http',
    status: 'investigating',
    rootCause: 'Connection timeout',
    rootCauseCode: 'T/O',
    startedAt: isoBefore(312),
    durationSeconds: 312,
    commentCount: 2,
    visibility: 'included',
    assignedTo: 'Alex Morgan',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    monitorId: monitorIds.dns,
    monitorName: 'Authoritative DNS',
    monitorType: 'dns',
    status: 'monitoring',
    rootCause: 'Slow DNS response',
    rootCauseCode: 'SLOW',
    startedAt: isoBefore(1_140),
    durationSeconds: 1_140,
    commentCount: 1,
    visibility: 'included',
    assignedTo: 'Maya Chen',
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    monitorId: monitorIds.api,
    monitorName: 'Production API',
    monitorType: 'keyword',
    status: 'resolved',
    rootCause: 'Expected keyword was not found',
    rootCauseCode: 'KW',
    startedAt: isoBefore(28_200),
    resolvedAt: isoBefore(27_978),
    durationSeconds: 222,
    commentCount: 1,
    visibility: 'included',
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    monitorId: monitorIds.website,
    monitorName: 'Marketing website',
    monitorType: 'http',
    status: 'resolved',
    rootCause: 'HTTP 503 Service Unavailable',
    rootCauseCode: '503',
    startedAt: isoBefore(172_800),
    resolvedAt: isoBefore(172_485),
    durationSeconds: 315,
    commentCount: 3,
    visibility: 'included',
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    monitorId: monitorIds.smtp,
    monitorName: 'Transactional mail',
    monitorType: 'tcp',
    status: 'resolved',
    rootCause: 'TCP connection refused',
    rootCauseCode: 'CONN',
    startedAt: isoBefore(604_800),
    resolvedAt: isoBefore(604_716),
    durationSeconds: 84,
    commentCount: 0,
    visibility: 'excluded',
  },
  {
    id: '20000000-0000-4000-8000-000000000006',
    monitorId: monitorIds.checkout,
    monitorName: 'Checkout API',
    monitorType: 'http',
    status: 'resolved',
    rootCause: 'HTTP 502 Bad Gateway',
    rootCauseCode: '502',
    startedAt: isoBefore(1_209_600),
    resolvedAt: isoBefore(1_208_994),
    durationSeconds: 606,
    commentCount: 4,
    visibility: 'included',
  },
  {
    id: '20000000-0000-4000-8000-000000000007',
    monitorId: monitorIds.api,
    monitorName: 'Production API',
    monitorType: 'keyword',
    status: 'resolved',
    rootCause: 'Response time threshold exceeded',
    rootCauseCode: 'SLOW',
    startedAt: isoBefore(2_678_400),
    resolvedAt: isoBefore(2_674_733),
    durationSeconds: 3_667,
    commentCount: 2,
    visibility: 'included',
  },
]

export const demoIncidentList: IncidentListViewModel = {
  incidents: demoIncidents,
  summary: {
    open: demoIncidents.filter((incident) => incident.status !== 'resolved').length,
    resolved: demoIncidents.filter((incident) => incident.status === 'resolved').length,
    total: demoIncidents.length,
  },
}

function buildResponseTimePoints(
  regionSeed: number,
  baseMs: number,
): readonly ResponseTimePoint[] {
  return Array.from({ length: 48 }, (_, index) => {
    const wave = Math.sin((index + regionSeed) / 4) * 34
    const jitter = ((index * (17 + regionSeed)) % 43) - 21
    const spike = index === 20 ? 2_650 : index === 31 ? 3_910 : index === 39 ? 740 : 0
    const valueMs = Math.max(35, Math.round(baseMs + wave + jitter + spike))
    return {
      timestamp: isoBefore((47 - index) * 75),
      valueMs,
      status: valueMs > 2_500 ? 'degraded' : 'ok',
    }
  })
}

function makeResponseSeries(
  regionId: string,
  regionLabel: string,
  color: string,
  regionSeed: number,
  baseMs: number,
): ResponseTimeSeries {
  const points = buildResponseTimePoints(regionSeed, baseMs)
  const values = points.map((point) => point.valueMs)
  return {
    regionId,
    regionLabel,
    color,
    points,
    averageMs: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
    minimumMs: Math.min(...values),
    maximumMs: Math.max(...values),
  }
}

export const demoResponseTimeSeries: readonly ResponseTimeSeries[] = [
  makeResponseSeries('us-east', 'North America', '#35d67b', 1, 186),
  makeResponseSeries('eu-west', 'Europe', '#6558f5', 4, 147),
  makeResponseSeries('ap-southeast', 'Asia Pacific', '#f5a742', 8, 286),
]

export const demoUptimePeriods: readonly UptimePeriodSummary[] = [
  { period: '24h', uptime: 100, incidentCount: 0, downtimeSeconds: 0 },
  { period: '7d', uptime: 100, incidentCount: 0, downtimeSeconds: 0 },
  { period: '30d', uptime: 99.991, incidentCount: 1, downtimeSeconds: 222 },
  { period: '365d', uptime: 99.975, incidentCount: 7, downtimeSeconds: 7_830 },
]

export const demoStatusPages: readonly StatusPageViewModel[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'System status',
    slug: 'system-status',
    url: '/status/system-status',
    monitorCount: 8,
    accessLevel: 'public',
    status: 'published',
    language: 'English',
    customDomain: 'status.example.com',
    customDomainVerified: true,
    announcementCount: 3,
    subscribers: 482,
    updatedAt: isoBefore(3_600),
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    name: 'Internal services',
    slug: 'internal-services',
    url: '/status/internal-services',
    monitorCount: 4,
    accessLevel: 'password',
    status: 'published',
    language: 'English',
    customDomainVerified: false,
    announcementCount: 0,
    subscribers: 23,
    updatedAt: isoBefore(86_400),
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Partner API',
    slug: 'partner-api',
    url: '/status/partner-api',
    monitorCount: 2,
    accessLevel: 'private',
    status: 'draft',
    language: 'Deutsch',
    customDomainVerified: false,
    announcementCount: 0,
    subscribers: 0,
    updatedAt: isoBefore(604_800),
  },
]

export const demoStatusPageList: StatusPageListViewModel = { pages: demoStatusPages }

export const demoMaintenanceWindows: readonly MaintenanceWindowViewModel[] = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Weekly database maintenance',
    monitorIds: [monitorIds.api, monitorIds.checkout],
    monitorNames: ['Production API', 'Checkout API'],
    startsAt: isoAfter(2 * 86_400 + 9 * 3_600),
    durationMinutes: 60,
    timezone: 'Europe/London',
    recurrence: 'weekly',
    weekdays: [1],
    endsAt: '2026-12-31T23:59:59.000Z',
    active: true,
    state: 'upcoming',
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    name: 'CDN migration',
    monitorIds: [monitorIds.website, monitorIds.edge],
    monitorNames: ['Marketing website', 'Edge gateway'],
    startsAt: isoAfter(6 * 86_400),
    durationMinutes: 180,
    timezone: 'UTC',
    recurrence: 'once',
    weekdays: [],
    active: true,
    state: 'upcoming',
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    name: 'Mail cluster upgrade',
    monitorIds: [monitorIds.smtp],
    monitorNames: ['Transactional mail'],
    startsAt: isoBefore(21 * 86_400),
    durationMinutes: 45,
    timezone: 'UTC',
    recurrence: 'once',
    weekdays: [],
    active: false,
    state: 'completed',
  },
]

export const demoMaintenanceList: MaintenanceListViewModel = {
  windows: demoMaintenanceWindows,
}

export const demoTeamMembers: readonly TeamMemberViewModel[] = [
  {
    id: '50000000-0000-4000-8000-000000000001',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    initials: 'AM',
    role: 'owner',
    twoFactorEnabled: true,
    status: 'active',
    isCurrentUser: true,
    joinedAt: '2025-11-03T10:00:00.000Z',
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    name: 'Maya Chen',
    email: 'maya@example.com',
    initials: 'MC',
    role: 'admin',
    twoFactorEnabled: true,
    status: 'active',
    isCurrentUser: false,
    joinedAt: '2026-01-14T16:30:00.000Z',
  },
  {
    id: '50000000-0000-4000-8000-000000000003',
    name: 'Noah Williams',
    email: 'noah@example.com',
    initials: 'NW',
    role: 'reader',
    twoFactorEnabled: false,
    status: 'active',
    isCurrentUser: false,
    joinedAt: '2026-05-22T09:15:00.000Z',
  },
  {
    id: '50000000-0000-4000-8000-000000000004',
    name: 'Priya Sharma',
    email: 'priya@example.com',
    initials: 'PS',
    role: 'notify-only',
    twoFactorEnabled: false,
    status: 'invited',
    isCurrentUser: false,
  },
]

export const demoTeam: TeamViewModel = {
  members: demoTeamMembers,
  summary: {
    seatsUsed: 4,
    seatsTotal: 5,
    loginSeatsUsed: 3,
    notifySeatsUsed: 1,
    planName: 'Team',
  },
}

export const demoIntegrationCatalog: readonly IntegrationCatalogItem[] = [
  {
    type: 'slack',
    name: 'Slack',
    description: 'Notify channels and incident rooms in real time.',
    category: 'chat',
    available: true,
  },
  {
    type: 'microsoft_teams',
    name: 'Microsoft Teams',
    description: 'Deliver alerts to Microsoft Teams workflows.',
    category: 'chat',
    available: true,
  },
  {
    type: 'discord',
    name: 'Discord',
    description: 'Post monitoring events to a Discord channel.',
    category: 'chat',
    available: true,
  },
  {
    type: 'google_chat',
    name: 'Google Chat',
    description: 'Keep Google Chat spaces up to date.',
    category: 'chat',
    available: true,
  },
  {
    type: 'telegram',
    name: 'Telegram',
    description: 'Send concise alerts to a Telegram chat.',
    category: 'chat',
    available: true,
  },
  {
    type: 'webhook',
    name: 'Webhook',
    description: 'Call your HTTPS endpoint with signed event payloads.',
    category: 'webhook',
    available: true,
  },
  {
    type: 'pagerduty',
    name: 'PagerDuty',
    description: 'Open and resolve PagerDuty incidents automatically.',
    category: 'incident-management',
    available: true,
  },
  {
    type: 'opsgenie',
    name: 'Opsgenie',
    description: 'Route alerts into your on-call schedule.',
    category: 'incident-management',
    available: true,
  },
  {
    type: 'pushover',
    name: 'Pushover',
    description: 'Receive prioritized push notifications.',
    category: 'push',
    available: true,
  },
  {
    type: 'pushbullet',
    name: 'Pushbullet',
    description: 'Send notifications to phones, browsers, and desktops.',
    category: 'push',
    available: true,
  },
  {
    type: 'email',
    name: 'Email',
    description: 'Send alerts to one or more verified email addresses.',
    category: 'email',
    available: true,
  },
  {
    type: 'sms',
    name: 'SMS',
    description: 'Deliver urgent events by text message.',
    category: 'sms-voice',
    available: true,
  },
  {
    type: 'voice',
    name: 'Voice call',
    description: 'Place automated calls for critical events.',
    category: 'sms-voice',
    available: true,
  },
]

export const demoIntegrations: readonly IntegrationViewModel[] = [
  {
    id: '60000000-0000-4000-8000-000000000001',
    name: 'Production alerts',
    type: 'slack',
    category: 'chat',
    active: true,
    needsAttention: false,
    destinationLabel: '#production-alerts',
    events: ['monitor.down', 'monitor.up', 'monitor.slow', 'ssl.expiry', 'domain.expiry'],
    monitorIds: [],
    updatedAt: isoBefore(172_800),
  },
  {
    id: '60000000-0000-4000-8000-000000000002',
    name: 'On-call incidents',
    type: 'pagerduty',
    category: 'incident-management',
    active: true,
    needsAttention: false,
    destinationLabel: 'Primary on-call service',
    events: ['monitor.down', 'monitor.up', 'incident.updated'],
    monitorIds: [monitorIds.checkout, monitorIds.api],
    updatedAt: isoBefore(604_800),
  },
  {
    id: '60000000-0000-4000-8000-000000000003',
    name: 'Internal event receiver',
    type: 'webhook',
    category: 'webhook',
    active: false,
    needsAttention: true,
    destinationLabel: 'HTTPS endpoint · credentials hidden',
    events: ['monitor.down', 'monitor.up', 'maintenance.started'],
    monitorIds: [],
    updatedAt: isoBefore(2_592_000),
  },
  {
    id: '60000000-0000-4000-8000-000000000004',
    name: 'Security reminders',
    type: 'email',
    category: 'email',
    active: true,
    needsAttention: false,
    destinationLabel: '2 verified recipients',
    events: ['ssl.expiry', 'domain.expiry'],
    monitorIds: [monitorIds.certificate, monitorIds.domain],
    updatedAt: isoBefore(86_400),
  },
]

export const demoIntegrationList: IntegrationListViewModel = {
  catalog: demoIntegrationCatalog,
  configured: demoIntegrations,
}

export const demoApiKeys: readonly ApiKeyViewModel[] = [
  {
    id: '70000000-0000-4000-8000-000000000001',
    name: 'Dashboard automation',
    prefix: 'sp_live_demo…',
    scopes: ['read', 'write'],
    kind: 'main',
    createdAt: '2026-01-10T11:30:00.000Z',
    lastUsedAt: isoBefore(820),
    status: 'active',
  },
  {
    id: '70000000-0000-4000-8000-000000000002',
    name: 'Reporting export',
    prefix: 'sp_live_reports…',
    scopes: ['read'],
    kind: 'read-only',
    createdAt: '2026-03-18T08:10:00.000Z',
    lastUsedAt: isoBefore(90_000),
    expiresAt: '2027-03-18T08:10:00.000Z',
    status: 'active',
  },
  {
    id: '70000000-0000-4000-8000-000000000003',
    name: 'Public website widget',
    prefix: 'sp_live_widget…',
    scopes: ['monitors:read'],
    kind: 'monitor-specific',
    monitorId: monitorIds.website,
    monitorName: 'Marketing website',
    createdAt: '2026-06-01T12:00:00.000Z',
    status: 'never-used',
  },
  {
    id: '70000000-0000-4000-8000-000000000004',
    name: 'Legacy integration',
    prefix: 'sp_live_legacy…',
    scopes: ['read'],
    kind: 'read-only',
    createdAt: '2025-10-08T12:00:00.000Z',
    lastUsedAt: '2026-02-04T10:20:00.000Z',
    revokedAt: '2026-04-02T09:00:00.000Z',
    status: 'revoked',
  },
]

export const demoApiKeyList: ApiKeyListViewModel = { keys: demoApiKeys }

export const demoMonitorDetail: MonitorDetailViewModel = {
  monitor: demoMonitors[0],
  responseTime: demoResponseTimeSeries,
  uptimePeriods: demoUptimePeriods,
  incidents: demoIncidents.filter((incident) => incident.monitorId === monitorIds.website),
  nextMaintenance: demoMaintenanceWindows[1],
  notifiedBy: ['slack', 'email'],
  statusPageNames: ['System status'],
}

function stateSet<T>(
  emptyData: T,
  filledData: T,
  skeletonCount: number,
  title: string,
  description: string,
  actionLabel?: string,
): DemoStateSet<T> {
  const loading: DemoViewState<T> = { kind: 'loading', data: null, skeletonCount }
  const empty: DemoViewState<T> = {
    kind: 'empty',
    data: emptyData,
    emptyState: { title, description, ...(actionLabel ? { actionLabel } : {}) },
  }
  const filled: DemoViewState<T> = { kind: 'filled', data: filledData }
  return { loading, empty, filled }
}

const emptyMonitorSummary: MonitorSummary = {
  total: 0,
  up: 0,
  down: 0,
  degraded: 0,
  paused: 0,
  pending: 0,
  capacity: 100,
  overallUptime24h: undefined,
  incidentCount24h: 0,
  downtimeSeconds24h: 0,
  mtbfSeconds: undefined,
}

export const demoMonitorStates = stateSet<MonitorListViewModel>(
  { monitors: [], summary: emptyMonitorSummary },
  demoMonitorList,
  8,
  'Create your first monitor',
  'Monitor a website, API, DNS record, certificate, port, or scheduled job.',
  'Create monitor',
)

export const demoIncidentStates = stateSet<IncidentListViewModel>(
  { incidents: [], summary: { open: 0, resolved: 0, total: 0 } },
  demoIncidentList,
  7,
  'No incidents yet',
  'Incidents will appear here when a monitor changes state.',
)

export const demoStatusPageStates = stateSet<StatusPageListViewModel>(
  { pages: [] },
  demoStatusPageList,
  3,
  'Create a status page',
  'Share real-time uptime and incident updates with your customers.',
  'Create status page',
)

export const demoMaintenanceStates = stateSet<MaintenanceListViewModel>(
  { windows: [] },
  demoMaintenanceList,
  3,
  'Plan your first maintenance',
  'Scheduled windows suppress alerts and keep planned work out of uptime statistics.',
  'Create maintenance window',
)

export const demoTeamStates = stateSet<TeamViewModel>(
  {
    members: [],
    summary: { seatsUsed: 0, seatsTotal: 5, loginSeatsUsed: 0, notifySeatsUsed: 0, planName: 'Team' },
  },
  demoTeam,
  4,
  'Invite your team',
  'Collaborate on monitoring, incidents, and status communication.',
  'Invite team member',
)

export const demoIntegrationStates = stateSet<IntegrationListViewModel>(
  { catalog: demoIntegrationCatalog, configured: [] },
  demoIntegrationList,
  5,
  'No integrations configured',
  'Connect chat, on-call, email, push, or custom webhook destinations.',
  'Add integration',
)

export const demoApiKeyStates = stateSet<ApiKeyListViewModel>(
  { keys: [] },
  demoApiKeyList,
  3,
  'No API keys',
  'Create scoped credentials for automation and external dashboards.',
  'Create API key',
)

export const demoResponseTimeStates = stateSet<readonly ResponseTimeSeries[]>(
  [],
  demoResponseTimeSeries,
  1,
  'No response-time data yet',
  'The chart will appear after this monitor completes its first checks.',
)

export const demoUptimeBarStates = stateSet<readonly UptimeBar[]>(
  [],
  demoUptimeBars,
  1,
  'No uptime history yet',
  'Uptime history will appear after this monitor completes its first checks.',
)

export const demoDashboard = {
  now: DEMO_NOW,
  monitors: demoMonitorStates,
  incidents: demoIncidentStates,
  statusPages: demoStatusPageStates,
  maintenance: demoMaintenanceStates,
  team: demoTeamStates,
  integrations: demoIntegrationStates,
  apiKeys: demoApiKeyStates,
  responseTime: demoResponseTimeStates,
  uptimeBars: demoUptimeBarStates,
  monitorDetail: demoMonitorDetail,
} as const
