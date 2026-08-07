import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type {
  Announcement,
  Incident,
  MaintenanceWindow,
  Membership,
  Monitor,
  MonitorSubscriptionIncident,
  StatusPage,
  StatusPageDetail,
  User,
} from '../api/types'
import type {
  IncidentsPageProps,
  MaintenancePageProps,
  StatusPageEditorPageProps,
  StatusPagesPageProps,
} from '../features/operations'

const mocks = vi.hoisted(() => {
  const api = {
    listMonitors: vi.fn(),
    listIncidents: vi.fn(),
    listMembers: vi.fn(),
    listIncidentComments: vi.fn(),
    listMonitorSubscriptionIncidents: vi.fn(),
    acknowledgeIncident: vi.fn(),
    assignIncident: vi.fn(),
    addIncidentComment: vi.fn(),
    resolveIncident: vi.fn(),
    listMaintenanceWindows: vi.fn(),
    createMaintenanceWindow: vi.fn(),
    updateMaintenanceWindow: vi.fn(),
    deleteMaintenanceWindow: vi.fn(),
    listStatusPages: vi.fn(),
    getStatusPageDashboard: vi.fn(),
    getStatusPage: vi.fn(),
    createStatusPage: vi.fn(),
    deleteStatusPage: vi.fn(),
    listAnnouncements: vi.fn(),
    createAnnouncement: vi.fn(),
    updateStatusPage: vi.fn(),
    claimStatusPageCustomDomain: vi.fn(),
    verifyStatusPageCustomDomain: vi.fn(),
  }
  return {
    api,
    demo: false,
    auth: { api, workspace: { id: 'workspace-1' } },
    incidentProps: undefined as unknown,
    maintenanceProps: undefined as unknown,
    statusPagesProps: undefined as unknown,
    editorProps: undefined as unknown,
  }
})

vi.mock('./AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('./DashboardGate', () => ({
  isDemoSession: () => mocks.demo,
}))

vi.mock('../features/operations', () => ({
  IncidentsPage: (props: unknown) => {
    mocks.incidentProps = props
    return <div data-testid="incidents-page" />
  },
  MaintenancePage: (props: unknown) => {
    mocks.maintenanceProps = props
    return <div data-testid="maintenance-page" />
  },
  StatusPagesPage: (props: unknown) => {
    mocks.statusPagesProps = props
    return <div data-testid="status-pages-page" />
  },
  StatusPageEditorPage: (props: unknown) => {
    mocks.editorProps = props
    return <div data-testid="status-editor-page" />
  },
}))

import {
  LiveIncidentsPage,
  LiveMaintenancePage,
  LiveStatusPageEditorPage,
  LiveStatusPagesPage,
} from './LiveOperations'

const now = '2026-07-25T12:00:00.000Z'

const user: User = {
  id: 'user-1',
  email: 'alex@example.com',
  name: 'Alex Morgan',
  locale: 'en',
  timezone: 'UTC',
  two_factor_enabled: true,
  system_role: 'user',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: now,
}

const monitor: Monitor = {
  id: 'monitor-1',
  workspace_id: 'workspace-1',
  name: 'Production API',
  type: 'http',
  status: 'up',
  config: { http: { url: 'https://api.example.com/health' } },
  interval_seconds: 60,
  timeout_seconds: 30,
  regions: ['eu-west'],
  tags: ['production'],
  retry_policy: {
    failure_threshold: 2,
    recovery_threshold: 2,
    confirmation_delay_seconds: 0,
  },
  paused: false,
  next_check_at: now,
  consecutive_failures: 0,
  consecutive_recoveries: 2,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: now,
}

const membership: Membership = {
  workspace_id: 'workspace-1',
  user_id: user.id,
  role: 'admin',
  status: 'active',
  user,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: now,
}

const incident: Incident = {
  id: 'incident-1',
  workspace_id: 'workspace-1',
  monitor_id: monitor.id,
  status: 'investigating',
  title: 'Production API is down',
  root_cause: 'Connection timeout',
  started_at: '2026-07-25T11:55:00.000Z',
  assigned_to: user.id,
  visibility: 'included',
  created_at: '2026-07-25T11:55:00.000Z',
  updated_at: now,
}

const maintenance: MaintenanceWindow = {
  id: 'maintenance-1',
  workspace_id: 'workspace-1',
  name: 'Production deploy',
  monitor_ids: [monitor.id],
  starts_at: '2026-07-26T09:00:00.000Z',
  duration_minutes: 60,
  timezone: 'UTC',
  recurrence: 'once',
  active: true,
  created_at: now,
  updated_at: now,
}

const statusPage: StatusPage = {
  id: 'page-1',
  workspace_id: 'workspace-1',
  name: 'Service health',
  slug: 'service-health',
  homepage_url: 'https://example.com',
  custom_domain: 'status.example.com',
  custom_domain_verified_at: '2026-07-24T00:00:00.000Z',
  language: 'en',
  published: true,
  robots: 'index,follow',
  branding: {
    logo_url: 'https://example.com/logo.svg',
    accent_color: '#20c878',
    background_color: '#101824',
    color_scheme: 'dark',
    remove_product_logo: true,
    google_analytics_id: 'G-EXAMPLE01',
    remove_cookie_consent: false,
    enable_floating_status_bar: true,
    password_enabled: true,
  },
  settings: {
    show_bar_charts: true,
    show_response_time: true,
    show_uptime_percentage: true,
    show_overall_percentage: true,
    show_outage_details: true,
    enable_details_page: true,
    show_monitor_url: false,
    hide_paused_monitors: true,
    enable_subscribe: true,
    show_latest_downtime: true,
    small_cookie_dialog: true,
    share_analytics: false,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: now,
}

const statusPageDetail: StatusPageDetail = {
  page: statusPage,
  components: [
    {
      id: 'component-2',
      status_page_id: statusPage.id,
      monitor_id: 'monitor-2',
      name: 'Secondary API',
      position: 1,
      created_at: now,
    },
    {
      id: 'component-1',
      status_page_id: statusPage.id,
      monitor_id: monitor.id,
      name: monitor.name,
      position: 0,
      created_at: now,
    },
  ],
}

const announcement: Announcement = {
  id: 'announcement-1',
  status_page_id: statusPage.id,
  title: 'Investigating elevated latency',
  body: 'The team is investigating.',
  status: 'investigating',
  published_at: now,
  created_by: user.id,
}

function renderRoute(element: ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>)
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={[`/status-pages/${statusPage.id}/edit`]}>
      <Routes>
        <Route path="/status-pages/:statusPageId/edit" element={<LiveStatusPageEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.demo = false
  mocks.auth.workspace = { id: 'workspace-1' }
  mocks.incidentProps = undefined
  mocks.maintenanceProps = undefined
  mocks.statusPagesProps = undefined
  mocks.editorProps = undefined
  Object.values(mocks.api).forEach((method) => method.mockReset())
  mocks.api.listMonitorSubscriptionIncidents.mockResolvedValue({ items: [] })
})

afterEach(() => {
  cleanup()
})

describe('demo operations routes', () => {
  it('renders the existing demo defaults without performing API calls', () => {
    mocks.demo = true
    const views = [
      <LiveIncidentsPage key="incidents" />,
      <LiveMaintenancePage key="maintenance" />,
      <LiveStatusPagesPage key="pages" />,
    ]
    for (const view of views) {
      const rendered = renderRoute(view)
      rendered.unmount()
    }
    const editor = renderEditor()
    editor.unmount()

    expect(mocks.incidentProps).toEqual({})
    expect(mocks.maintenanceProps).toEqual({})
    expect(mocks.statusPagesProps).toMatchObject({ onEdit: expect.any(Function) })
    expect(mocks.editorProps).toMatchObject({
      page: expect.objectContaining({ id: expect.any(String) }),
      onBack: expect.any(Function),
      onPreview: expect.any(Function),
    })
    Object.values(mocks.api).forEach((method) => expect(method).not.toHaveBeenCalled())
  })
})

describe('empty workspace list responses', () => {
  it('normalizes null items for incidents, maintenance, status pages, and the status editor', async () => {
    mocks.api.listMonitors.mockResolvedValue({ items: null })
    mocks.api.listIncidents.mockResolvedValue({ items: null })
    mocks.api.listMembers.mockResolvedValue({ items: null })
    mocks.api.listMaintenanceWindows.mockResolvedValue({ items: null })
    mocks.api.getStatusPageDashboard.mockResolvedValue({ items: null })
    mocks.api.listAnnouncements.mockResolvedValue({ items: null })
    mocks.api.getStatusPage.mockResolvedValue({ ...statusPageDetail, components: [] })

    const incidentsView = renderRoute(<LiveIncidentsPage />)
    await waitFor(() => expect(mocks.incidentProps).toBeDefined())
    expect(mocks.incidentProps).toMatchObject({ incidents: [], monitors: [], members: [] })
    incidentsView.unmount()

    mocks.maintenanceProps = undefined
    const maintenanceView = renderRoute(<LiveMaintenancePage />)
    await waitFor(() => expect(mocks.maintenanceProps).toBeDefined())
    expect(mocks.maintenanceProps).toMatchObject({ windows: [], monitors: [] })
    maintenanceView.unmount()

    mocks.statusPagesProps = undefined
    const pagesView = renderRoute(<LiveStatusPagesPage />)
    await waitFor(() => expect(mocks.statusPagesProps).toBeDefined())
    expect(mocks.statusPagesProps).toMatchObject({ pages: [], monitors: [] })
    pagesView.unmount()

    mocks.editorProps = undefined
    const editorView = renderEditor()
    await waitFor(() => expect(mocks.editorProps).toBeDefined())
    expect(mocks.editorProps).toMatchObject({ monitors: [], announcements: [] })
    editorView.unmount()
  })
})

describe('LiveIncidentsPage', () => {
  it('merges safe followed-monitor incidents without loading private incident details', async () => {
    const sharedIncident: MonitorSubscriptionIncident = {
      id: 'shared-incident-1',
      subscription_id: 'subscription-1',
      monitor_id: 'shared-monitor-1',
      monitor_name: 'Vendor API',
      monitor_type: 'http',
      status: 'investigating',
      title: 'Vendor API is unavailable',
      root_cause: 'Public upstream outage',
      started_at: now,
      read_only: true,
    }
    mocks.api.listMonitors.mockResolvedValue({ items: [] })
    mocks.api.listIncidents.mockResolvedValue({ items: [] })
    mocks.api.listMembers.mockResolvedValue({ items: [] })
    mocks.api.listMonitorSubscriptionIncidents.mockResolvedValue({ items: [sharedIncident] })

    renderRoute(<LiveIncidentsPage />)
    await waitFor(() => expect(mocks.incidentProps).toBeDefined())
    const props = mocks.incidentProps as IncidentsPageProps

    expect(props.incidents).toEqual([
      expect.objectContaining({
        id: sharedIncident.id,
        access: 'subscription',
        subscriptionId: sharedIncident.subscription_id,
        monitorName: sharedIncident.monitor_name,
        rootCause: sharedIncident.root_cause,
        commentCount: 0,
      }),
    ])
    expect(mocks.api.listIncidentComments).not.toHaveBeenCalled()
    expect(props.initialComments).toEqual({})
    expect(props.initialReports).toEqual({})
  })

  it('loads adapted data and wires every incident mutation', async () => {
    mocks.api.listMonitors.mockResolvedValue({ items: [monitor] })
    mocks.api.listIncidents.mockResolvedValue({ items: [incident] })
    mocks.api.listMembers.mockResolvedValue({ items: [membership] })
    mocks.api.listIncidentComments.mockResolvedValue({
      items: [
        {
          id: 'comment-1',
          incident_id: incident.id,
          status: 'investigating',
          message: 'Connection timeout confirmed',
          created_at: incident.started_at,
        },
        {
          id: 'comment-2',
          incident_id: incident.id,
          status: 'investigating',
          message: 'Checking the upstream provider',
          created_by: user.id,
          created_at: now,
        },
      ],
    })
    mocks.api.assignIncident.mockResolvedValue(incident)
    mocks.api.addIncidentComment.mockResolvedValue({ id: 'comment-2' })
    mocks.api.resolveIncident.mockResolvedValue({ ...incident, status: 'resolved' })

    renderRoute(<LiveIncidentsPage />)
    await waitFor(() => expect(mocks.incidentProps).toBeDefined())
    const props = mocks.incidentProps as IncidentsPageProps

    expect(props.incidents?.[0]).toMatchObject({
      id: incident.id,
      monitorName: monitor.name,
      assignedTo: user.name,
      commentCount: 2,
      rootCauseCode: 'T/O',
    })
    expect(props.initialComments?.[incident.id]).toEqual([
      expect.objectContaining({
        author: 'Incident opened',
        message: 'Connection timeout confirmed',
      }),
      expect.objectContaining({
        author: user.name,
        message: 'Checking the upstream provider',
      }),
    ])
    expect(props.monitors?.[0].target).toBe('https://api.example.com/health')
    expect(props.members?.[0]).toMatchObject({ id: user.id, role: 'admin' })

    await act(async () => {
      await props.onAssign?.(incident.id, user.id)
      await props.onComment?.(incident.id, 'A useful update')
      await props.onResolve?.(incident.id)
    })

    expect(mocks.api.assignIncident).toHaveBeenCalledWith('workspace-1', incident.id, user.id)
    expect(mocks.api.addIncidentComment).toHaveBeenCalledWith(
      'workspace-1', incident.id, 'A useful update',
    )
    expect(mocks.api.resolveIncident).toHaveBeenCalledWith('workspace-1', incident.id)
  })
})

describe('LiveMaintenancePage', () => {
  it('loads windows and translates create, update, and delete payloads', async () => {
    mocks.api.listMonitors.mockResolvedValue({ items: [monitor] })
    mocks.api.listMaintenanceWindows.mockResolvedValue({ items: [maintenance] })
    mocks.api.createMaintenanceWindow.mockResolvedValue({ ...maintenance, id: 'maintenance-new' })
    mocks.api.updateMaintenanceWindow.mockResolvedValue({ ...maintenance, name: 'Updated deploy' })
    mocks.api.deleteMaintenanceWindow.mockResolvedValue(undefined)

    renderRoute(<LiveMaintenancePage />)
    await waitFor(() => expect(mocks.maintenanceProps).toBeDefined())
    const props = mocks.maintenanceProps as MaintenancePageProps
    expect(props.windows?.[0]).toMatchObject({
      id: maintenance.id,
      monitorNames: [monitor.name],
    })

    const input = {
      name: 'Updated deploy',
      monitorIds: [monitor.id],
      startsAt: '2026-07-27T09:00:00.000Z',
      durationMinutes: 90,
      timezone: 'Europe/Moscow',
      recurrence: 'weekly' as const,
      weekdays: [1, 3],
      endsAt: '2026-09-01T00:00:00.000Z',
      active: true,
    }
    let created
    await act(async () => {
      created = await props.onCreate?.(input)
      await props.onUpdate?.(maintenance.id, input)
      await props.onDelete?.(maintenance.id)
    })

    expect(mocks.api.createMaintenanceWindow).toHaveBeenCalledWith('workspace-1', {
      name: input.name,
      monitor_ids: [monitor.id],
      starts_at: input.startsAt,
      duration_minutes: 90,
      timezone: 'Europe/Moscow',
      recurrence: 'weekly',
      weekdays: [1, 3],
      ends_at: input.endsAt,
      active: true,
    })
    expect(mocks.api.updateMaintenanceWindow).toHaveBeenCalledWith(
      'workspace-1', maintenance.id, expect.objectContaining({ name: input.name }),
    )
    expect(mocks.api.deleteMaintenanceWindow).toHaveBeenCalledWith('workspace-1', maintenance.id)
    expect(created).toMatchObject({ id: 'maintenance-new', monitorNames: [monitor.name] })
  })
})

describe('LiveStatusPagesPage', () => {
  it('enriches pages and wires create, announcement, edit, and delete operations', async () => {
    mocks.api.listMonitors.mockResolvedValue({ items: [monitor] })
    mocks.api.getStatusPageDashboard.mockResolvedValue({
      items: [{ page: statusPage, component_count: 2, announcement_count: 1, subscriber_count: 0 }],
    })
    mocks.api.getStatusPage.mockResolvedValue(statusPageDetail)
    mocks.api.listAnnouncements.mockResolvedValue({ items: [announcement] })
    mocks.api.createStatusPage.mockResolvedValue({ ...statusPage, id: 'page-new', slug: 'new-page' })
    mocks.api.createAnnouncement.mockResolvedValue(announcement)
    mocks.api.deleteStatusPage.mockResolvedValue(undefined)

    renderRoute(<LiveStatusPagesPage />)
    await waitFor(() => expect(mocks.statusPagesProps).toBeDefined())
    const props = mocks.statusPagesProps as StatusPagesPageProps
    expect(props.pages?.[0]).toMatchObject({
      id: statusPage.id,
      monitorCount: 2,
      announcementCount: 1,
      accessLevel: 'password',
      url: 'https://status.example.com',
    })
    expect(mocks.api.getStatusPage).not.toHaveBeenCalled()
    expect(mocks.api.listAnnouncements).not.toHaveBeenCalled()

    const createInput = {
      name: 'New page',
      slug: 'new-page',
      homepageUrl: 'https://example.com',
      accessLevel: 'password' as const,
      password: 'very-secure-password',
      language: 'ru' as const,
      published: true,
      monitorIds: [monitor.id],
    }
    let created
    await act(async () => {
      created = await props.onCreate?.(createInput)
      await props.onAnnouncement?.(statusPage.id, {
        title: 'Resolved',
        body: 'Everything is healthy.',
        status: 'resolved',
        incidentId: incident.id,
      })
      await props.onDelete?.(statusPage.id)
    })

    expect(mocks.api.createStatusPage).toHaveBeenCalledWith('workspace-1', {
      page: expect.objectContaining({
        name: 'New page',
        slug: 'new-page',
        language: 'ru',
        published: true,
        branding: { password_enabled: true },
      }),
      password: 'very-secure-password',
      monitor_ids: [monitor.id],
    })
    expect(created).toMatchObject({ id: 'page-new', monitorCount: 1, accessLevel: 'password' })
    expect(mocks.api.createAnnouncement).toHaveBeenCalledWith('workspace-1', statusPage.id, {
      title: 'Resolved',
      body: 'Everything is healthy.',
      status: 'resolved',
      incident_id: incident.id,
    })
    expect(mocks.api.deleteStatusPage).toHaveBeenCalledWith('workspace-1', statusPage.id)
  })
})

describe('LiveStatusPageEditorPage', () => {
  it('hydrates editor settings and persists settings, components, domain, and announcements', async () => {
    mocks.api.getStatusPage.mockResolvedValue(statusPageDetail)
    mocks.api.listMonitors.mockResolvedValue({ items: [monitor] })
    mocks.api.listAnnouncements.mockResolvedValue({ items: [announcement] })
    mocks.api.updateStatusPage.mockResolvedValue(statusPage)
    mocks.api.claimStatusPageCustomDomain.mockResolvedValue({ page: statusPage, challenge: {} })
    mocks.api.verifyStatusPageCustomDomain.mockResolvedValue(statusPage)
    mocks.api.createAnnouncement.mockResolvedValue(announcement)

    renderEditor()
    await waitFor(() => expect(mocks.editorProps).toBeDefined())
    const props = mocks.editorProps as StatusPageEditorPageProps
    expect(props.page).toMatchObject({ id: statusPage.id, accessLevel: 'password' })
    expect(props.initialValue).toMatchObject({
      homepageUrl: statusPage.homepage_url,
      customDomain: statusPage.custom_domain,
      googleAnalyticsId: 'G-EXAMPLE01',
      language: statusPage.language,
      passwordEnabled: true,
      monitorIds: [monitor.id, 'monitor-2'],
      branding: expect.objectContaining({ colorScheme: 'dark', removeProductLogo: true }),
      features: expect.objectContaining({ enableFloatingStatusBar: true, enableSubscribe: true }),
    })
    expect(props.monitors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: monitor.id, name: monitor.name }),
      expect.objectContaining({ id: 'monitor-2', name: 'Secondary API' }),
    ]))
    expect(props.announcements?.[0]).toMatchObject({ id: announcement.id, title: announcement.title })

    const changed = {
      ...props.initialValue!,
      name: 'Updated health',
      language: 'ru' as const,
      password: 'replacement-password',
      monitorIds: [monitor.id],
      features: { ...props.initialValue!.features, showBarCharts: false },
    }
    await act(async () => {
      await props.onSave?.(changed)
      await props.onClaimDomain?.('health.example.com')
      await props.onVerifyDomain?.('health.example.com')
      await props.onAnnouncement?.({
        title: 'Maintenance complete',
        body: 'The deployment completed.',
        status: 'resolved',
      })
    })

    expect(mocks.api.updateStatusPage).toHaveBeenCalledWith(
      'workspace-1',
      statusPage.id,
      expect.objectContaining({
        page: expect.objectContaining({
          name: 'Updated health',
          language: 'ru',
          branding: expect.objectContaining({ password_enabled: true }),
          settings: expect.objectContaining({ show_bar_charts: false, enable_subscribe: true }),
        }),
        password: 'replacement-password',
        monitor_ids: [monitor.id],
      }),
    )
    expect(mocks.api.claimStatusPageCustomDomain).toHaveBeenCalledWith(
      'workspace-1', statusPage.id, 'health.example.com',
    )
    expect(mocks.api.verifyStatusPageCustomDomain).toHaveBeenCalledWith(
      'workspace-1', statusPage.id,
    )
    expect(mocks.api.createAnnouncement).toHaveBeenCalledWith(
      'workspace-1',
      statusPage.id,
      expect.objectContaining({ title: 'Maintenance complete', status: 'resolved' }),
    )
  })
})
