import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { Monitor } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { isDemoSession } from '../../app/DashboardGate'
import {
  toIntegrationViewModel,
  toMaintenanceWindowViewModel,
  toMonitorViewModel,
  toStatusPageViewModel,
} from '../../app/viewAdapters'
import type {
  IntegrationViewModel,
  MaintenanceWindowViewModel,
  MonitorViewModel,
  StatusPageViewModel,
  UptimePeriodSummary,
} from '../../data'
import { MonitorDetailPage } from './MonitorDetailPage'
import { MonitorEditPage } from './MonitorEditPage'
import { toSubscribedMonitorViewModel } from '../subscriptions/adapters'
import type { HeartbeatCredential } from './HeartbeatCredentialModal'
import type { MonitorDraft } from './MonitorForm'
import { MonitorsPage } from './MonitorsPage'
import {
  monitorDraftToCreateRequest,
  monitorDraftToUpdateRequest,
  monitorErrorMessage,
  monitorToDraft,
  toLiveMonitorDetail,
  type MonitorDetailData,
} from './monitorData'

function fromForPeriod(period: UptimePeriodSummary['period'], now: Date): string {
  const duration = period === '24h'
    ? 86_400_000
    : period === '7d'
      ? 7 * 86_400_000
      : period === '30d'
        ? 30 * 86_400_000
        : 365 * 86_400_000
  return new Date(now.getTime() - duration).toISOString()
}

export function resolveHeartbeatUrl(baseUrl: string, heartbeatUrl: string, origin = window.location.origin): string {
  const base = new URL(baseUrl || '/', origin)
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return new URL(heartbeatUrl, base).toString()
}

function heartbeatCredential(
  baseUrl: string,
  monitorName: string,
  response: { heartbeat_url?: string },
): HeartbeatCredential | undefined {
  if (!response.heartbeat_url) return undefined
  return {
    monitorName,
    url: resolveHeartbeatUrl(baseUrl, response.heartbeat_url),
  }
}

export function LiveMonitorsPage() {
  const { workspace } = useAuth()
  if (isDemoSession()) return <MonitorsPage />
  return <LiveMonitorsContent key={workspace?.id ?? 'no-workspace'} />
}

function LiveMonitorsContent() {
  const { api, authenticated, workspace } = useAuth()
  const navigate = useNavigate()
  const demo = isDemoSession()
  const [data, setData] = useState<readonly MonitorViewModel[]>([])
  const [rawMonitors, setRawMonitors] = useState<readonly Monitor[]>([])
  const [manualTestEnabled, setManualTestEnabled] = useState(false)
  const [monitorLimit, setMonitorLimit] = useState(100)
  const [totalMonitors, setTotalMonitors] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down' | 'degraded' | 'pending' | 'paused'>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [sortMode, setSortMode] = useState<'status' | 'name' | 'response'>('status')
  const [availableTags, setAvailableTags] = useState<readonly string[]>([])
  const [pageNumber, setPageNumber] = useState(1)
  const [cursor, setCursor] = useState<string | undefined>()
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState<string | null>(null)
  const requestRevision = useRef(0)
  const searchTimer = useRef<number | undefined>(undefined)

  const reload = useCallback(async () => {
    if (demo || !authenticated || !workspace) return
    const revision = ++requestRevision.current
    setLoading(true)
    setError(null)
    try {
      const now = new Date()
      const from = fromForPeriod('24h', now)
      const [dashboard, subscriptionList] = await Promise.all([
        api.getMonitorDashboard(workspace.id, {
          from,
          to: now.toISOString(),
          limit: 50,
          cursor,
          search,
          status: statusFilter === 'all' ? undefined : statusFilter,
          tag: tagFilter === 'all' ? undefined : tagFilter,
          sort: sortMode,
        }),
        api.listMonitorSubscriptions(workspace.id),
      ])
      if (requestRevision.current !== revision) return
      const dashboardItems = dashboard.items ?? []
      setManualTestEnabled(dashboard.entitlements.limits.allow_manual_tests)
      setMonitorLimit(dashboard.entitlements.limits.max_monitors)
      setTotalMonitors(dashboard.total_count ?? dashboardItems.length)
      setNextCursor(dashboard.next_cursor)
      setAvailableTags(dashboard.available_tags ?? [])
      const monitors = dashboardItems.map((item) => item.monitor)
      setRawMonitors(monitors)
      const owned = dashboardItems.map((item) =>
        toMonitorViewModel(item.monitor, {
          history: item.history ?? [],
          latest: item.latest,
          stats: item.stats,
          activeIncident: item.active_incident,
          latestIncident: item.latest_incident,
          now,
        }))
      const followed = (subscriptionList.items ?? []).map(toSubscribedMonitorViewModel)
      setData([...owned, ...followed])
    } catch (loadError) {
      if (requestRevision.current !== revision) return
      setError(monitorErrorMessage(loadError, 'The monitoring service did not respond.'))
    } finally {
      if (requestRevision.current !== revision) return
      setLoading(false)
    }
  }, [api, authenticated, cursor, demo, search, sortMode, statusFilter, tagFilter, workspace])

  useEffect(() => () => window.clearTimeout(searchTimer.current), [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (demo || !authenticated || !workspace) return
    const timer = window.setInterval(() => void reload(), 60_000)
    return () => window.clearInterval(timer)
  }, [authenticated, demo, reload, workspace])

  if (demo) return <MonitorsPage />

  const create = async (draft: MonitorDraft) => {
    if (!workspace) throw new Error('No active workspace is selected.')
    const response = await api.createMonitor(workspace.id, monitorDraftToCreateRequest(draft))
    let credential = heartbeatCredential(api.baseUrl, response.monitor.name, response)
    if (draft.type === 'heartbeat' && !credential) {
      const rotated = await api.rotateHeartbeatToken(workspace.id, response.monitor.id)
      credential = heartbeatCredential(api.baseUrl, response.monitor.name, rotated)
    }
    await reload()
    if (draft.type === 'heartbeat' && !credential) throw new Error('The monitoring service did not return a heartbeat URL.')
    return credential
  }

  const togglePause = async (monitor: MonitorViewModel, pause: boolean) => {
    if (!workspace) throw new Error('No active workspace is selected.')
    if (pause) await api.pauseMonitor(workspace.id, monitor.id)
    else await api.resumeMonitor(workspace.id, monitor.id)
    await reload()
  }

  const test = async (monitor: MonitorViewModel) => {
    if (!workspace) throw new Error('No active workspace is selected.')
    if (monitor.type === 'leakcheck') await api.scanLeakCheckMonitor(workspace.id, monitor.id)
    else await api.testMonitor(workspace.id, monitor.id)
    await reload()
  }

  const remove = async (monitor: MonitorViewModel) => {
    if (!workspace) throw new Error('No active workspace is selected.')
    await api.deleteMonitor(workspace.id, monitor.id)
    await reload()
  }

  const unsubscribe = async (monitor: MonitorViewModel) => {
    if (!workspace || !monitor.subscriptionId) throw new Error('The monitor subscription is unavailable.')
    await api.deleteMonitorSubscription(workspace.id, monitor.subscriptionId)
    await reload()
  }

  const bulkAction = async (monitors: readonly MonitorViewModel[], action: 'pause' | 'resume' | 'test' | 'delete') => {
    if (!workspace) throw new Error('No active workspace is selected.')
    await Promise.all(monitors.map((monitor) => action === 'pause'
      ? api.pauseMonitor(workspace.id, monitor.id)
      : action === 'resume'
        ? api.resumeMonitor(workspace.id, monitor.id)
        : action === 'test'
          ? monitor.type === 'leakcheck'
            ? api.scanLeakCheckMonitor(workspace.id, monitor.id)
            : api.testMonitor(workspace.id, monitor.id)
          : api.deleteMonitor(workspace.id, monitor.id)))
    await reload()
  }

  const bulkTags = async (monitors: readonly MonitorViewModel[], mode: 'add' | 'remove', tags: readonly string[]) => {
    if (!workspace) throw new Error('No active workspace is selected.')
    const rawById = new Map(rawMonitors.map((monitor) => [monitor.id, monitor]))
    const changes = new Set(tags.map((tag) => tag.toLocaleLowerCase()))
    await Promise.all(monitors.map(async (monitor) => {
      const raw = rawById.get(monitor.id)
      if (!raw) throw new Error(`Configuration for ${monitor.name} is unavailable.`)
      const draft = monitorToDraft(raw)
      draft.tags = mode === 'add'
        ? [...draft.tags, ...tags.filter((tag) => !draft.tags.some((current) => current.toLocaleLowerCase() === tag.toLocaleLowerCase()))]
        : draft.tags.filter((tag) => !changes.has(tag.toLocaleLowerCase()))
      await api.updateMonitor(workspace.id, monitor.id, monitorDraftToUpdateRequest(draft))
    }))
    await reload()
  }

  const nextPage = () => {
    if (!nextCursor || loading) return
    setPreviousCursors((current) => [...current, cursor])
    setCursor(nextCursor)
    setPageNumber((current) => current + 1)
  }

  const previousPage = () => {
    if (pageNumber <= 1 || loading) return
    const previous = previousCursors[previousCursors.length - 1]
    setPreviousCursors((current) => current.slice(0, -1))
    setCursor(previous)
    setPageNumber((current) => Math.max(1, current - 1))
  }

  const changeSearch = (value: string) => {
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setPreviousCursors([])
      setCursor(undefined)
      setPageNumber(1)
      setSearch(value.trim())
    }, 300)
  }

  const resetToFirstPage = () => {
    setPreviousCursors([])
    setCursor(undefined)
    setPageNumber(1)
  }

  return (
    <MonitorsPage
      data={data}
      loading={loading}
      error={error}
      onRetry={() => void reload()}
      onCreate={create}
      onView={(monitor) => navigate(`/monitors/${monitor.id}`)}
      onEdit={(monitor) => navigate(`/monitors/${monitor.id}/edit`)}
      onTogglePause={togglePause}
      onTest={test}
      onDelete={remove}
      onUnsubscribe={unsubscribe}
      onBulkAction={bulkAction}
      onBulkTags={bulkTags}
      manualTestEnabled={manualTestEnabled}
      monitorLimit={monitorLimit}
      pageNumber={pageNumber}
      hasPreviousPage={pageNumber > 1}
      hasNextPage={Boolean(nextCursor)}
      onPreviousPage={previousPage}
      onNextPage={nextPage}
      totalMonitors={totalMonitors}
      availableTags={availableTags}
      onSearchQueryChange={changeSearch}
      onStatusFilterChange={(value) => { resetToFirstPage(); setStatusFilter(value) }}
      onTagFilterChange={(value) => { resetToFirstPage(); setTagFilter(value) }}
      onSortChange={(value) => { resetToFirstPage(); setSortMode(value) }}
      summaryPageScoped={pageNumber > 1 || Boolean(nextCursor)}
    />
  )
}

export function LiveMonitorDetailPage() {
  const { api, authenticated, workspace } = useAuth()
  const { monitorId } = useParams()
  const navigate = useNavigate()
  const demo = isDemoSession()
  const [data, setData] = useState<MonitorDetailData | null>(null)
  const [rawMonitor, setRawMonitor] = useState<Monitor | null>(null)
  const [nextMaintenance, setNextMaintenance] = useState<MaintenanceWindowViewModel | undefined>()
  const [notifications, setNotifications] = useState<readonly IntegrationViewModel[]>([])
  const [statusPages, setStatusPages] = useState<readonly StatusPageViewModel[]>([])
  const [manualTestEnabled, setManualTestEnabled] = useState(false)
  const [loading, setLoading] = useState(!demo)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [responseRange, setResponseRange] = useState('1h')
  const autoRefresh = useRef({ inFlight: false, lastAttemptAt: 0 })

  const reload = useCallback(async (background = false) => {
    if (demo || !authenticated || !workspace || !monitorId) return
    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const overview = await api.getMonitorOverview(workspace.id, monitorId, responseRange as '1h' | '24h' | '7d')
      const monitor = overview.monitor
      setRawMonitor(monitor)
      setManualTestEnabled(overview.entitlements.limits.allow_manual_tests)
      const evidenceChecks = overview.evidence_check ? [overview.evidence_check] : []
      setData(toLiveMonitorDetail({
        monitor,
        checks: evidenceChecks,
        history: overview.uptime_history ?? [],
        latest: overview.latest,
        responseHistory: overview.response_history ?? [],
        incidents: overview.incidents ?? [],
        stats: overview.periods,
        locations: overview.regions ?? [],
      }))
      const monitorWindows = (overview.maintenance ?? [])
        .map((window) => toMaintenanceWindowViewModel(window, { monitors: [monitor] }))
        .filter((window) => window.state === 'active' || window.state === 'upcoming')
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
      setNextMaintenance(monitorWindows[0])
      setNotifications((overview.integrations ?? []).map(toIntegrationViewModel))
      setStatusPages((overview.status_pages ?? []).map(({ page, component_count }) =>
        toStatusPageViewModel(page, { componentCount: component_count })))
    } catch (loadError) {
      setError(monitorErrorMessage(loadError, 'The monitor details could not be loaded.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [api, authenticated, demo, monitorId, responseRange, workspace])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const monitor = data?.monitor
      if (!monitor || monitor.type === 'leakcheck' || monitor.status === 'paused' || autoRefresh.current.inFlight) return
      if (!monitor.lastCheckedAt) {
        const now = Date.now()
        if (now - autoRefresh.current.lastAttemptAt < 10_000) return
        autoRefresh.current.inFlight = true
        autoRefresh.current.lastAttemptAt = now
        void reload(true).finally(() => { autoRefresh.current.inFlight = false })
        return
      }
      const checkedAt = new Date(monitor.lastCheckedAt).getTime()
      const dueAt = checkedAt + Math.max(1, monitor.intervalSeconds) * 1000
      const now = Date.now()
      if (!Number.isFinite(checkedAt) || now < dueAt || now - autoRefresh.current.lastAttemptAt < 15_000) return
      autoRefresh.current.inFlight = true
      autoRefresh.current.lastAttemptAt = now
      void reload(true).finally(() => { autoRefresh.current.inFlight = false })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [data?.monitor, reload])

  if (demo) return <MonitorDetailPage />

  const requireContext = (): { workspaceId: string; monitorId: string } => {
    if (!workspace || !monitorId) throw new Error('Monitor context is unavailable.')
    return { workspaceId: workspace.id, monitorId }
  }

  const togglePause = async (pause: boolean) => {
    const context = requireContext()
    if (pause) await api.pauseMonitor(context.workspaceId, context.monitorId)
    else await api.resumeMonitor(context.workspaceId, context.monitorId)
    await reload()
  }

  const test = async () => {
    const context = requireContext()
    if (rawMonitor?.type === 'leakcheck') await api.scanLeakCheckMonitor(context.workspaceId, context.monitorId)
    else await api.testMonitor(context.workspaceId, context.monitorId)
    await reload()
  }

  const remove = async () => {
    const context = requireContext()
    await api.deleteMonitor(context.workspaceId, context.monitorId)
    navigate('/monitors', { replace: true })
  }

  const rotateHeartbeat = async () => {
    const context = requireContext()
    const response = await api.rotateHeartbeatToken(context.workspaceId, context.monitorId)
    const credential = heartbeatCredential(api.baseUrl, data?.monitor.name ?? 'Heartbeat monitor', response)
    if (!credential) throw new Error('The monitoring service did not return a heartbeat URL.')
    return credential
  }

  const updateResponseAlert = async (thresholdMs?: number) => {
    const context = requireContext()
    if (!rawMonitor) throw new Error('Monitor configuration is still loading.')
    const request = monitorDraftToUpdateRequest(monitorToDraft(rawMonitor))
    await api.updateMonitor(context.workspaceId, context.monitorId, {
      ...request,
      slow_threshold_ms: thresholdMs ?? 0,
    })
    await reload(true)
  }

  return (
    <MonitorDetailPage
      monitor={data?.monitor}
      responseTime={data?.responseTime}
      locationNames={data?.locationNames}
      uptimePeriods={data?.uptimePeriods}
      incidents={data?.incidents}
      mtbfSeconds={data?.mtbfSeconds}
      nextMaintenance={nextMaintenance}
      notifications={notifications}
      statusPages={statusPages}
      loading={loading && !data}
      refreshing={refreshing}
      error={error}
      onRetry={() => void reload()}
      onTogglePause={togglePause}
      onTest={test}
      onDelete={remove}
      onRotateHeartbeat={data?.monitor.type === 'heartbeat' ? rotateHeartbeat : undefined}
      onRangeChange={setResponseRange}
      onUpdateResponseAlert={updateResponseAlert}
      manualTestEnabled={data?.monitor.type === 'leakcheck' || manualTestEnabled}
    />
  )
}

interface LiveEditState {
  monitor: Monitor
  view: MonitorViewModel
  availableTags: string[]
}

export function LiveMonitorEditPage() {
  const { api, authenticated, workspace } = useAuth()
  const { monitorId } = useParams()
  const demo = isDemoSession()
  const [state, setState] = useState<LiveEditState | null>(null)
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (demo || !authenticated || !workspace || !monitorId) return
    setLoading(true)
    setError(null)
    try {
      const [monitor, page] = await Promise.all([
        api.getMonitor(workspace.id, monitorId),
        api.listMonitors(workspace.id, { limit: 250 }),
      ])
      const availableTags = [...new Set((page.items ?? []).flatMap((item) => item.tags))].sort()
      setState({
        monitor,
        view: toMonitorViewModel(monitor),
        availableTags,
      })
    } catch (loadError) {
      setError(monitorErrorMessage(loadError, 'The monitor configuration could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [api, authenticated, demo, monitorId, workspace])

  useEffect(() => { void reload() }, [reload])

  if (demo) return <MonitorEditPage />

  const update = async (draft: MonitorDraft) => {
    if (!workspace || !monitorId) throw new Error('Monitor context is unavailable.')
    await api.updateMonitor(workspace.id, monitorId, monitorDraftToUpdateRequest(draft))
  }

  return (
    <MonitorEditPage
      monitor={state?.view}
      initialValue={state ? monitorToDraft(state.monitor) : undefined}
      availableTags={state?.availableTags}
      loading={loading && !state}
      error={error}
      onRetry={() => void reload()}
      onSubmit={update}
    />
  )
}
