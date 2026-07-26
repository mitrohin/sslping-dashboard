import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ApiClient } from '../api/client'
import type {
  Announcement,
  JsonObject,
  JsonValue,
  MaintenanceWindowWrite,
  Monitor,
  StatusPage,
  StatusPageCreateRequest,
  StatusPageUpdateRequest,
} from '../api/types'
import { Button, Panel } from '../components/ui'
import {
  demoStatusPages,
  type IncidentViewModel,
  type MaintenanceWindowViewModel,
  type MonitorViewModel,
  type StatusPageViewModel,
  type TeamMemberViewModel,
} from '../data'
import {
  IncidentsPage,
  MaintenancePage,
  StatusPageEditorPage,
  StatusPagesPage,
  type MaintenanceWindowInput,
  type StatusPageAnnouncementInput,
  type StatusPageAnnouncementViewModel,
  type StatusPageCreateInput,
  type StatusPageEditorValue,
} from '../features/operations'
import { useAuth } from './AuthProvider'
import { isDemoSession } from './DashboardGate'
import {
  toIncidentViewModel,
  toMaintenanceWindowViewModel,
  toMonitorViewModel,
  toStatusPageViewModel,
  toTeamMemberViewModel,
} from './viewAdapters'

type RemoteState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error }

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error('The dashboard data could not be loaded.')
}

function useRemoteData<T>(
  workspaceId: string | undefined,
  loader: (workspaceId: string) => Promise<T>,
) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<RemoteState<T>>({ status: 'loading' })

  useEffect(() => {
    let active = true
    if (!workspaceId) {
      setState({ status: 'error', error: new Error('No active workspace is available.') })
      return () => {
        active = false
      }
    }

    setState({ status: 'loading' })
    void loader(workspaceId).then(
      (data) => {
        if (active) setState({ status: 'ready', data })
      },
      (error) => {
        if (active) setState({ status: 'error', error: errorFrom(error) })
      },
    )

    return () => {
      active = false
    }
  }, [loader, revision, workspaceId])

  return {
    state,
    retry: () => setRevision((current) => current + 1),
  }
}

function LoadingOperations({ label }: { label: string }) {
  return (
    <main className="page page--wide ops-page" aria-busy="true">
      <Panel><p role="status">Loading {label}…</p></Panel>
    </main>
  )
}

function FailedOperations({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <main className="page page--wide ops-page">
      <Panel>
        <div className="ops-error" role="alert">{error.message}</div>
        <Button type="button" onClick={retry}>Try again</Button>
      </Panel>
    </main>
  )
}

interface IncidentData {
  incidents: readonly IncidentViewModel[]
  monitors: readonly MonitorViewModel[]
  members: readonly TeamMemberViewModel[]
}

function LiveIncidentsContent({ api, workspaceId }: { api: ApiClient; workspaceId?: string }) {
  const load = useCallback(async (activeWorkspaceId: string): Promise<IncidentData> => {
    const [monitorPage, incidentPage, memberList] = await Promise.all([
      api.listMonitors(activeWorkspaceId, { limit: 100 }),
      api.listIncidents(activeWorkspaceId, { limit: 100 }),
      api.listMembers(activeWorkspaceId),
    ])
    const rawMonitors = monitorPage.items ?? []
    const memberships = memberList.items ?? []
    const monitorById = new Map(rawMonitors.map((monitor) => [monitor.id, monitor]))
    const memberById = new Map(memberships.map((membership) => [membership.user_id, membership]))
    const commentCounts = new Map<string, number>()

    await Promise.all(
      (incidentPage.items ?? []).map(async (incident) => {
        try {
          const comments = await api.listIncidentComments(activeWorkspaceId, incident.id)
          commentCounts.set(incident.id, comments.items?.length ?? 0)
        } catch {
          commentCounts.set(incident.id, 0)
        }
      }),
    )

    return {
      monitors: rawMonitors.map((monitor) => toMonitorViewModel(monitor)),
      members: memberships.map((membership) => toTeamMemberViewModel(membership)),
      incidents: (incidentPage.items ?? []).map((incident) => {
        const membership = incident.assigned_to ? memberById.get(incident.assigned_to) : undefined
        return toIncidentViewModel(incident, {
          monitor: monitorById.get(incident.monitor_id),
          assignee: membership?.user,
          commentCount: commentCounts.get(incident.id),
        })
      }),
    }
  }, [api])
  const { state, retry } = useRemoteData(workspaceId, load)

  if (state.status === 'loading') return <LoadingOperations label="incidents" />
  if (state.status === 'error') return <FailedOperations error={state.error} retry={retry} />

  const requireWorkspace = () => {
    if (!workspaceId) throw new Error('No active workspace is available.')
    return workspaceId
  }

  return (
    <IncidentsPage
      incidents={state.data.incidents}
      monitors={state.data.monitors}
      members={state.data.members}
      onAcknowledge={(incidentId) => api.acknowledgeIncident(requireWorkspace(), incidentId).then(() => undefined)}
      onAssign={(incidentId, memberId) => api.assignIncident(requireWorkspace(), incidentId, memberId).then(() => undefined)}
      onComment={(incidentId, message) => api.addIncidentComment(requireWorkspace(), incidentId, message).then(() => undefined)}
      onResolve={(incidentId) => api.resolveIncident(requireWorkspace(), incidentId).then(() => undefined)}
    />
  )
}

export function LiveIncidentsPage() {
  const { api, workspace } = useAuth()
  if (isDemoSession()) return <IncidentsPage />
  return <LiveIncidentsContent api={api} workspaceId={workspace?.id} />
}

interface MaintenanceData {
  rawMonitors: readonly Monitor[]
  monitors: readonly MonitorViewModel[]
  windows: readonly MaintenanceWindowViewModel[]
}

function maintenanceRequest(input: MaintenanceWindowInput): MaintenanceWindowWrite {
  return {
    name: input.name,
    monitor_ids: [...input.monitorIds],
    starts_at: input.startsAt,
    duration_minutes: input.durationMinutes,
    timezone: input.timezone,
    recurrence: input.recurrence,
    weekdays: [...input.weekdays],
    ends_at: input.endsAt ?? null,
    active: input.active,
  }
}

function LiveMaintenanceContent({ api, workspaceId, initialMonitorId }: { api: ApiClient; workspaceId?: string; initialMonitorId?: string }) {
  const load = useCallback(async (activeWorkspaceId: string): Promise<MaintenanceData> => {
    const [monitorPage, windowList] = await Promise.all([
      api.listMonitors(activeWorkspaceId, { limit: 100 }),
      api.listMaintenanceWindows(activeWorkspaceId),
    ])
    const rawMonitors = monitorPage.items ?? []
    return {
      rawMonitors,
      monitors: rawMonitors.map((monitor) => toMonitorViewModel(monitor)),
      windows: (windowList.items ?? []).map((window) =>
        toMaintenanceWindowViewModel(window, { monitors: rawMonitors }),
      ),
    }
  }, [api])
  const { state, retry } = useRemoteData(workspaceId, load)

  if (state.status === 'loading') return <LoadingOperations label="maintenance windows" />
  if (state.status === 'error') return <FailedOperations error={state.error} retry={retry} />

  const requireWorkspace = () => {
    if (!workspaceId) throw new Error('No active workspace is available.')
    return workspaceId
  }
  const adapt = (window: Awaited<ReturnType<ApiClient['createMaintenanceWindow']>>) =>
    toMaintenanceWindowViewModel(window, { monitors: state.data.rawMonitors })

  return (
    <MaintenancePage
      windows={state.data.windows}
      monitors={state.data.monitors}
      initialCreateMonitorId={initialMonitorId}
      onCreate={async (input) =>
        adapt(await api.createMaintenanceWindow(requireWorkspace(), maintenanceRequest(input)))}
      onUpdate={async (windowId, input) =>
        adapt(await api.updateMaintenanceWindow(requireWorkspace(), windowId, maintenanceRequest(input)))}
      onDelete={(windowId) => api.deleteMaintenanceWindow(requireWorkspace(), windowId)}
    />
  )
}

export function LiveMaintenancePage() {
  const { api, workspace } = useAuth()
  const searchParams = new URLSearchParams(window.location.search)
  const initialMonitorId = searchParams.get('create') === '1' ? searchParams.get('monitor') ?? undefined : undefined
  if (isDemoSession()) return <MaintenancePage initialCreateMonitorId={initialMonitorId} />
  return <LiveMaintenanceContent api={api} workspaceId={workspace?.id} initialMonitorId={initialMonitorId} />
}

interface StatusPageData {
  monitors: readonly MonitorViewModel[]
  pages: readonly StatusPageViewModel[]
}

function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function booleanValue(record: JsonObject | undefined, key: string, fallback = false): boolean {
  return typeof record?.[key] === 'boolean' ? record[key] as boolean : fallback
}

function stringValue(record: JsonObject | undefined, key: string, fallback = ''): string {
  return typeof record?.[key] === 'string' ? record[key] as string : fallback
}

function statusPagePasswordProtected(page: StatusPage): boolean {
  return booleanValue(objectValue(page.branding), 'password_enabled')
}

function statusPageCreateRequest(input: StatusPageCreateInput): StatusPageCreateRequest {
  return {
    page: {
      name: input.name,
      slug: input.slug,
      homepage_url: input.homepageUrl || undefined,
      language: input.language,
      published: input.accessLevel === 'private' ? false : input.published,
      robots: input.accessLevel === 'private' ? 'noindex,nofollow' : 'index,follow',
      branding: { password_enabled: input.accessLevel === 'password' },
    },
    password: input.accessLevel === 'password' ? input.password : null,
    monitor_ids: [...input.monitorIds],
  }
}

function LiveStatusPagesContent({
  api,
  workspaceId,
  onEdit,
  initialMonitorId,
}: {
  api: ApiClient
  workspaceId?: string
  onEdit: (pageId: string) => void
  initialMonitorId?: string
}) {
  const load = useCallback(async (activeWorkspaceId: string): Promise<StatusPageData> => {
    const [monitorPage, pageList] = await Promise.all([
      api.listMonitors(activeWorkspaceId, { limit: 100 }),
      api.listStatusPages(activeWorkspaceId),
    ])
    const rawPages = pageList.items ?? []
    const pages = await Promise.all(rawPages.map(async (page) => {
      const [detailResult, announcementsResult] = await Promise.allSettled([
        api.getStatusPage(activeWorkspaceId, page.id),
        api.listAnnouncements(activeWorkspaceId, page.id),
      ])
      const source = detailResult.status === 'fulfilled' ? detailResult.value : page
      const announcementCount = announcementsResult.status === 'fulfilled'
        ? announcementsResult.value.items?.length ?? 0
        : 0
      return toStatusPageViewModel(source, {
        announcementCount,
        passwordProtected: statusPagePasswordProtected(page),
      })
    }))

    return {
      monitors: (monitorPage.items ?? []).map((monitor) => toMonitorViewModel(monitor)),
      pages,
    }
  }, [api])
  const { state, retry } = useRemoteData(workspaceId, load)

  if (state.status === 'loading') return <LoadingOperations label="status pages" />
  if (state.status === 'error') return <FailedOperations error={state.error} retry={retry} />

  const requireWorkspace = () => {
    if (!workspaceId) throw new Error('No active workspace is available.')
    return workspaceId
  }

  return (
    <StatusPagesPage
      pages={state.data.pages}
      monitors={state.data.monitors}
      initialCreateMonitorId={initialMonitorId}
      onEdit={onEdit}
      onCreate={async (input) => {
        const page = await api.createStatusPage(requireWorkspace(), statusPageCreateRequest(input))
        return toStatusPageViewModel(page, {
          componentCount: input.monitorIds.length,
          passwordProtected: input.accessLevel === 'password',
        })
      }}
      onAnnouncement={(pageId, input) =>
        api.createAnnouncement(requireWorkspace(), pageId, {
          title: input.title,
          body: input.body,
          status: input.status,
          incident_id: input.incidentId,
        }).then(() => undefined)}
      onDelete={(pageId) => api.deleteStatusPage(requireWorkspace(), pageId)}
    />
  )
}

export function LiveStatusPagesPage() {
  const { api, workspace } = useAuth()
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(window.location.search)
  const initialMonitorId = searchParams.get('create') === '1' ? searchParams.get('monitor') ?? undefined : undefined
  const onEdit = useCallback(
    (pageId: string) => navigate(`/status-pages/${pageId}/edit`),
    [navigate],
  )
  if (isDemoSession()) return <StatusPagesPage onEdit={onEdit} initialCreateMonitorId={initialMonitorId} />
  return <LiveStatusPagesContent api={api} workspaceId={workspace?.id} onEdit={onEdit} initialMonitorId={initialMonitorId} />
}

interface StatusPageEditorData {
  page: StatusPageViewModel
  monitors: readonly MonitorViewModel[]
  initialValue: StatusPageEditorValue
  announcements: readonly StatusPageAnnouncementViewModel[]
}

const defaultBranding = {
  logoUrl: '',
  accentColor: '#34d77b',
  backgroundColor: '#101824',
  colorScheme: 'system' as const,
  removeProductLogo: false,
}

function editorValue(
  page: StatusPage,
  monitorIds: readonly string[],
): StatusPageEditorValue {
  const branding = objectValue(page.branding)
  const colorScheme = stringValue(branding, 'color_scheme', 'system')
  return {
    name: page.name,
    slug: page.slug,
    homepageUrl: page.homepage_url ?? '',
    customDomain: page.custom_domain ?? '',
    googleAnalyticsId: stringValue(branding, 'google_analytics_id'),
    language: page.language,
    robots: page.robots,
    published: page.published,
    passwordEnabled: booleanValue(branding, 'password_enabled'),
    password: '',
    removeCookieConsent: booleanValue(branding, 'remove_cookie_consent'),
    monitorIds: [...monitorIds],
    branding: {
      logoUrl: stringValue(branding, 'logo_url', defaultBranding.logoUrl),
      accentColor: stringValue(branding, 'accent_color', defaultBranding.accentColor),
      backgroundColor: stringValue(branding, 'background_color', defaultBranding.backgroundColor),
      colorScheme: colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : 'system',
      removeProductLogo: booleanValue(branding, 'remove_product_logo'),
    },
    features: {
      showBarCharts: page.settings.show_bar_charts,
      showUptimePercentage: page.settings.show_uptime_percentage,
      showOverallPercentage: page.settings.show_overall_percentage,
      showOutageDetails: page.settings.show_outage_details,
      enableDetailsPage: page.settings.enable_details_page,
      enableFloatingStatusBar: booleanValue(branding, 'enable_floating_status_bar'),
      showMonitorUrl: page.settings.show_monitor_url,
      hidePausedMonitors: page.settings.hide_paused_monitors,
      enableSubscribe: page.settings.enable_subscribe,
      showLatestDowntime: page.settings.show_latest_downtime,
      smallCookieDialog: page.settings.small_cookie_dialog,
      shareAnalytics: page.settings.share_analytics,
    },
  }
}

function announcementViewModel(announcement: Announcement): StatusPageAnnouncementViewModel {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    status: announcement.status,
    incidentId: announcement.incident_id,
    publishedAt: announcement.published_at,
  }
}

function editorUpdateRequest(value: StatusPageEditorValue): StatusPageUpdateRequest {
  if (value.passwordEnabled && value.password && value.password.length < 12) {
    throw new Error('Status-page passwords must contain at least 12 characters.')
  }
  return {
    page: {
      name: value.name.trim(),
      slug: value.slug.trim(),
      homepage_url: value.homepageUrl.trim() || undefined,
      language: value.language,
      published: value.published,
      robots: value.robots,
      branding: {
        logo_url: value.branding.logoUrl,
        accent_color: value.branding.accentColor,
        background_color: value.branding.backgroundColor,
        color_scheme: value.branding.colorScheme,
        remove_product_logo: value.branding.removeProductLogo,
        google_analytics_id: value.googleAnalyticsId,
        remove_cookie_consent: value.removeCookieConsent,
        enable_floating_status_bar: value.features.enableFloatingStatusBar,
        password_enabled: value.passwordEnabled,
      },
      settings: {
        show_bar_charts: value.features.showBarCharts,
        show_uptime_percentage: value.features.showUptimePercentage,
        show_overall_percentage: value.features.showOverallPercentage,
        show_outage_details: value.features.showOutageDetails,
        enable_details_page: value.features.enableDetailsPage,
        show_monitor_url: value.features.showMonitorUrl,
        hide_paused_monitors: value.features.hidePausedMonitors,
        enable_subscribe: value.features.enableSubscribe,
        show_latest_downtime: value.features.showLatestDowntime,
        small_cookie_dialog: value.features.smallCookieDialog,
        share_analytics: value.features.shareAnalytics,
      },
    },
    password: value.passwordEnabled ? value.password || undefined : '',
    monitor_ids: [...value.monitorIds],
  }
}

function LiveStatusPageEditorContent({
  api,
  workspaceId,
  statusPageId,
  onBack,
}: {
  api: ApiClient
  workspaceId?: string
  statusPageId?: string
  onBack: () => void
}) {
  const load = useCallback(async (activeWorkspaceId: string): Promise<StatusPageEditorData> => {
    if (!statusPageId) throw new Error('Status page was not specified.')
    const [detail, monitorPage, announcementList] = await Promise.all([
      api.getStatusPage(activeWorkspaceId, statusPageId),
      api.listMonitors(activeWorkspaceId, { limit: 100 }),
      api.listAnnouncements(activeWorkspaceId, statusPageId),
    ])
    const components = [...(detail.components ?? [])].sort(
      (left, right) => left.position - right.position,
    )
    return {
      page: toStatusPageViewModel(detail, {
        announcementCount: announcementList.items?.length ?? 0,
        passwordProtected: statusPagePasswordProtected(detail.page),
      }),
      monitors: (monitorPage.items ?? []).map((monitor) => toMonitorViewModel(monitor)),
      initialValue: editorValue(detail.page, components.map((component) => component.monitor_id)),
      announcements: (announcementList.items ?? []).map(announcementViewModel),
    }
  }, [api, statusPageId])
  const { state, retry } = useRemoteData(workspaceId, load)

  if (state.status === 'loading') return <LoadingOperations label="status-page settings" />
  if (state.status === 'error') return <FailedOperations error={state.error} retry={retry} />

  const requireWorkspace = () => {
    if (!workspaceId) throw new Error('No active workspace is available.')
    return workspaceId
  }
  const requireStatusPage = () => {
    if (!statusPageId) throw new Error('Status page was not specified.')
    return statusPageId
  }

  return (
    <StatusPageEditorPage
      page={state.data.page}
      monitors={state.data.monitors}
      initialValue={state.data.initialValue}
      announcements={state.data.announcements}
      onBack={onBack}
      onPreview={(page) => window.open(`/status/${page.slug}`, '_blank', 'noopener,noreferrer')}
      onSave={async (value) => {
        await api.updateStatusPage(
          requireWorkspace(),
          requireStatusPage(),
          editorUpdateRequest(value),
        )
      }}
      onClaimDomain={(domain) =>
        api.claimStatusPageCustomDomain(requireWorkspace(), requireStatusPage(), domain).then(() => undefined)}
      onVerifyDomain={() =>
        api.verifyStatusPageCustomDomain(requireWorkspace(), requireStatusPage()).then(() => undefined)}
      onAnnouncement={(input: StatusPageAnnouncementInput) =>
        api.createAnnouncement(requireWorkspace(), requireStatusPage(), {
          title: input.title,
          body: input.body,
          status: input.status,
          incident_id: input.incidentId,
        }).then(() => undefined)}
    />
  )
}

export function LiveStatusPageEditorPage() {
  const { api, workspace } = useAuth()
  const navigate = useNavigate()
  const { statusPageId } = useParams()
  const onBack = useCallback(() => navigate('/status-pages'), [navigate])

  if (isDemoSession()) {
    const page = demoStatusPages.find((candidate) => candidate.id === statusPageId) ?? demoStatusPages[0]
    return (
      <StatusPageEditorPage
        page={page}
        onBack={onBack}
        onPreview={(value) => window.open(`/status/${value.slug}`, '_blank', 'noopener,noreferrer')}
      />
    )
  }

  return (
    <LiveStatusPageEditorContent
      api={api}
      workspaceId={workspace?.id}
      statusPageId={statusPageId}
      onBack={onBack}
    />
  )
}
