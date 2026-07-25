import { describe, expect, it } from 'vitest'
import type {
  APIKey,
  AuditLog,
  CheckResult,
  Incident,
  Integration,
  MaintenanceWindow,
  Membership,
  Monitor,
  StatusPage,
  StatusPageDetail,
  User,
} from '../api/types'
import {
  toApiKeyViewModel,
  toAuditLogViewModel,
  toIncidentViewModel,
  toIntegrationViewModel,
  toMaintenanceWindowViewModel,
  toMonitorViewModel,
  toStatusPageViewModel,
  toTeamMemberViewModel,
  toUserTeamMemberViewModel,
} from './viewAdapters'

const now = '2026-07-25T12:00:00.000Z'

const user: User = {
  id: 'user-1',
  email: 'alex@example.com',
  name: 'Alex Morgan',
  phone: '+12025550199',
  locale: 'en',
  timezone: 'UTC',
  email_verified_at: '2026-01-01T00:00:00.000Z',
  two_factor_enabled: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
}

const monitor: Monitor = {
  id: 'monitor-1',
  workspace_id: 'workspace-1',
  name: 'Production API',
  type: 'keyword',
  status: 'up',
  config: {
    http: {
      url: 'https://api.example.com/health',
      keyword: { value: 'ok', mode: 'present', case_sensitive: false },
    },
  },
  interval_seconds: 60,
  timeout_seconds: 30,
  regions: ['eu-west', 'us-east'],
  tags: ['production', 'api'],
  group_name: 'Production',
  retry_policy: {
    failure_threshold: 2,
    recovery_threshold: 2,
    confirmation_delay_seconds: 0,
  },
  paused: false,
  last_check_at: '2026-07-25T11:59:50.000Z',
  last_status_change_at: '2026-07-24T08:00:00.000Z',
  next_check_at: '2026-07-25T12:00:50.000Z',
  consecutive_failures: 0,
  consecutive_recoveries: 4,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-07-25T11:59:50.000Z',
}

const checks: CheckResult[] = [
  {
    id: 'check-new',
    workspace_id: 'workspace-1',
    monitor_id: monitor.id,
    region: 'eu-west',
    status: 'ok',
    latency_ms: 147,
    started_at: '2026-07-25T11:59:49.000Z',
    finished_at: '2026-07-25T11:59:50.000Z',
    incident_id: 'incident-open',
    details: {
      tls: {
        issuer: 'Example Trust Services',
        expires_at: '2026-09-01T00:00:00.000Z',
      },
    },
  },
  {
    id: 'check-old',
    workspace_id: 'workspace-1',
    monitor_id: monitor.id,
    region: 'eu-west',
    status: 'failed',
    latency_ms: 4_200,
    started_at: '2026-07-25T11:58:49.000Z',
    finished_at: '2026-07-25T11:58:50.000Z',
  },
]

const incident: Incident = {
  id: 'incident-1',
  workspace_id: 'workspace-1',
  monitor_id: monitor.id,
  status: 'resolved',
  title: 'Production API is unavailable',
  root_cause: 'Connection timeout',
  started_at: '2026-07-25T11:00:00.000Z',
  resolved_at: '2026-07-25T11:05:30.000Z',
  assigned_to: user.id,
  visibility: 'included',
  created_at: '2026-07-25T11:00:00.000Z',
  updated_at: '2026-07-25T11:05:30.000Z',
}

const page: StatusPage = {
  id: 'page-1',
  workspace_id: 'workspace-1',
  name: 'Public status',
  slug: 'public-status',
  custom_domain: 'status.example.com',
  custom_domain_verified_at: '2026-07-20T00:00:00.000Z',
  language: 'ru',
  published: true,
  robots: 'index,follow',
  settings: {
    show_bar_charts: true,
    show_uptime_percentage: true,
    show_overall_percentage: true,
    show_outage_details: true,
    enable_details_page: true,
    show_monitor_url: false,
    hide_paused_monitors: true,
    enable_subscribe: true,
    show_latest_downtime: true,
    small_cookie_dialog: false,
    share_analytics: false,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-07-25T10:00:00.000Z',
}

describe('toMonitorViewModel', () => {
  it('combines monitor, check, metrics, incident, and expiry data without mutating checks', () => {
    const originalOrder = checks.map((check) => check.id)
    const result = toMonitorViewModel(monitor, {
      checks,
      stats: {
        from: '2026-07-24T12:00:00.000Z',
        to: now,
        availability: 99.975,
        average_latency_ms: 220,
        p50_latency_ms: 180,
        p95_latency_ms: 410,
        p99_latency_ms: 980,
        checks: 1_440,
        failures: 1,
        incidents: 1,
        downtime_seconds: 22,
        mtbf_seconds: 86_400,
      },
      activeIncident: { id: 'incident-current' },
      now,
    })

    expect(result).toMatchObject({
      id: monitor.id,
      typeLabel: 'Keyword',
      target: 'https://api.example.com/health',
      status: 'up',
      responseTimeMs: 147,
      uptime24h: 99.975,
      incidentId: 'incident-current',
    })
    expect(result.last24Hours.map((bar) => bar.status)).toEqual(['down', 'up'])
    expect(result.sslCertificate).toMatchObject({
      expiresAt: '2026-09-01T00:00:00.000Z',
      issuer: 'Example Trust Services',
      state: 'ok',
    })
    expect(checks.map((check) => check.id)).toEqual(originalOrder)
  })

  it('uses safe defaults for incomplete runtime payloads', () => {
    const incomplete = {
      ...monitor,
      id: '',
      name: '',
      type: 'future-type',
      status: 'future-status',
      config: {},
      tags: undefined,
      regions: undefined,
      group_name: '',
      paused: true,
    } as unknown as Monitor

    expect(toMonitorViewModel(incomplete, { now })).toMatchObject({
      id: 'unknown-monitor',
      name: 'Unnamed monitor',
      type: 'http',
      status: 'paused',
      target: 'Target unavailable',
      group: 'Ungrouped',
      tags: [],
      regions: [],
    })
  })
})

describe('incident and maintenance adapters', () => {
  it('resolves monitor and assignee context and calculates duration', () => {
    expect(
      toIncidentViewModel(incident, {
        monitor,
        assignee: user,
        commentCount: 3,
        now,
      }),
    ).toMatchObject({
      monitorName: 'Production API',
      monitorType: 'keyword',
      rootCauseCode: 'T/O',
      durationSeconds: 330,
      commentCount: 3,
      assignedTo: 'Alex Morgan',
    })
  })

  it('recognises active recurring windows and maps missing monitor names safely', () => {
    const window: MaintenanceWindow = {
      id: 'maintenance-1',
      workspace_id: 'workspace-1',
      name: 'Daily deploy',
      monitor_ids: [monitor.id, 'deleted-monitor'],
      starts_at: '2026-07-20T11:50:00.000Z',
      duration_minutes: 30,
      timezone: 'UTC',
      recurrence: 'daily',
      weekdays: [5, 5, 9, -1],
      active: true,
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
    }
    const result = toMaintenanceWindowViewModel(window, { monitors: [monitor], now })

    expect(result.state).toBe('active')
    expect(result.monitorNames).toEqual(['Production API', 'Unknown monitor'])
    expect(result.weekdays).toEqual([5])
  })
})

describe('status page adapters', () => {
  it('uses component counts, verified custom domain, language, and access context', () => {
    const detail: StatusPageDetail = {
      page,
      components: [
        {
          id: 'component-1',
          status_page_id: page.id,
          monitor_id: monitor.id,
          name: monitor.name,
          position: 0,
          created_at: now,
        },
      ],
    }
    expect(
      toStatusPageViewModel(detail, {
        passwordProtected: true,
        announcementCount: 4,
        subscribers: 120,
      }),
    ).toMatchObject({
      url: 'https://status.example.com',
      monitorCount: 1,
      accessLevel: 'password',
      status: 'published',
      language: 'Русский',
      customDomainVerified: true,
      announcementCount: 4,
      subscribers: 120,
    })
  })
})

describe('team adapters', () => {
  it('maps backend membership vocabulary to dashboard vocabulary', () => {
    const membership: Membership = {
      workspace_id: 'workspace-1',
      user_id: user.id,
      role: 'notifier',
      status: 'disabled',
      user,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: now,
    }
    expect(toTeamMemberViewModel(membership, { currentUserId: user.id })).toMatchObject({
      name: 'Alex Morgan',
      initials: 'AM',
      role: 'notify-only',
      status: 'suspended',
      twoFactorEnabled: true,
      isCurrentUser: true,
    })
  })

  it('can adapt a user independently and survives a missing embedded user', () => {
    expect(toUserTeamMemberViewModel(user, { role: 'admin' }).role).toBe('admin')
    expect(
      toTeamMemberViewModel({
        workspace_id: 'workspace-1',
        user_id: 'missing-user',
        role: 'viewer',
        status: 'invited',
        created_at: now,
        updated_at: now,
      }),
    ).toMatchObject({
      id: 'missing-user',
      name: 'Unknown member',
      email: 'Unavailable',
      initials: 'UM',
      role: 'reader',
      status: 'invited',
    })
  })
})

describe('integration and API key adapters', () => {
  it('keeps integration destinations redacted and flags unconfigured integrations', () => {
    const integration: Integration = {
      id: 'integration-1',
      workspace_id: 'workspace-1',
      name: 'On-call email',
      type: 'email',
      events: ['monitor.down', 'monitor.up'],
      monitor_ids: [monitor.id],
      config: { to: ['ops@example.com', 'owner@example.com'] },
      active: true,
      created_at: now,
      updated_at: now,
    }
    expect(toIntegrationViewModel(integration)).toMatchObject({
      category: 'email',
      destinationLabel: '2 recipients',
      needsAttention: false,
      monitorIds: [monitor.id],
    })

    expect(toIntegrationViewModel({ ...integration, type: 'webhook', config: undefined })).toMatchObject(
      { category: 'webhook', needsAttention: true },
    )
  })

  it('classifies monitor-specific and expiring API keys', () => {
    const key: APIKey = {
      id: 'key-1',
      workspace_id: 'workspace-1',
      name: 'Public widget',
      prefix: 'sp_live_widget',
      scopes: ['monitors:read'],
      monitor_id: monitor.id,
      last_used_at: '2026-07-25T10:00:00.000Z',
      expires_at: '2026-07-30T12:00:00.000Z',
      created_by: user.id,
      created_at: '2026-07-01T00:00:00.000Z',
    }
    expect(toApiKeyViewModel(key, { monitor, now })).toMatchObject({
      prefix: 'sp_live_widget…',
      kind: 'monitor-specific',
      monitorName: monitor.name,
      status: 'expiring',
    })
  })
})

describe('toAuditLogViewModel', () => {
  it('derives category, target, outcome, actor, and details from an audit record', () => {
    const entry: AuditLog = {
      id: 'audit-1',
      workspace_id: 'workspace-1',
      actor_id: user.id,
      action: 'integration.update_failed',
      resource: 'integration',
      resource_id: 'integration-1',
      ip: '198.51.100.20',
      metadata: {
        name: 'Production alerts',
        detail: 'Endpoint rejected the validation request.',
      },
      created_at: now,
    }
    expect(toAuditLogViewModel(entry, { actor: user })).toMatchObject({
      actorName: user.name,
      actorEmail: user.email,
      category: 'integration',
      target: 'Production alerts',
      outcome: 'failure',
      detail: 'Endpoint rejected the validation request.',
    })
  })
})
