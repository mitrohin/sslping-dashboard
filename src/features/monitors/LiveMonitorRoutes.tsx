import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { ApiClient } from '../../api/client'
import type { CheckResult, HistoryQuery, Monitor, Region, UptimeStats } from '../../api/types'
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

const periods: readonly UptimePeriodSummary['period'][] = ['24h', '7d', '30d', '365d']

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

function fromForResponseRange(range: string, now: Date): string {
  const duration = range === '7d' ? 7 * 86_400_000 : range === '24h' ? 86_400_000 : 3_600_000
  return new Date(now.getTime() - duration).toISOString()
}

function emptyCheckPage(): { items: CheckResult[] } {
  return { items: [] }
}

const checkHistoryPageSize = 250
const checkHistoryMaxItems = 75_000
const checkHistoryMaxPages = 300

interface CheckHistoryGuard {
  maxItems?: number
  maxPages?: number
}

export async function loadMonitorCheckHistory(
  api: Pick<ApiClient, 'listMonitorChecks'>,
  workspaceId: string,
  monitorId: string,
  query: Omit<HistoryQuery, 'cursor' | 'limit'>,
  guard: CheckHistoryGuard = {},
): Promise<CheckResult[]> {
  const maxItems = Math.max(1, Math.floor(guard.maxItems ?? checkHistoryMaxItems))
  const maxPages = Math.max(1, Math.floor(guard.maxPages ?? checkHistoryMaxPages))
  const checks: CheckResult[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await api.listMonitorChecks(workspaceId, monitorId, {
      ...query,
      limit: checkHistoryPageSize,
      cursor,
    })
    const items = page.items ?? []
    if (checks.length + items.length > maxItems) {
      throw new Error(`The selected check history is too large to display safely (over ${maxItems.toLocaleString('en-US')} results).`)
    }
    checks.push(...items)

    const nextCursor = page.next_cursor
    if (!nextCursor) return checks
    if (nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error('The monitoring service returned a repeated check-history cursor.')
    }
    if (pageNumber + 1 >= maxPages) {
      throw new Error(`The selected check history exceeded the safe pagination limit of ${maxPages} pages.`)
    }
    if (cursor) seenCursors.add(cursor)
    cursor = nextCursor
  }

  return checks
}

function checksWithinRange(checks: readonly CheckResult[], from: string, to: string): CheckResult[] {
  const fromTime = Date.parse(from)
  const toTime = Date.parse(to)
  return checks.filter((check) => {
    const startedAt = Date.parse(check.started_at)
    return Number.isFinite(startedAt) && startedAt >= fromTime && startedAt < toTime
  })
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
  const { api, authenticated, workspace } = useAuth()
  const navigate = useNavigate()
  const demo = isDemoSession()
  const [data, setData] = useState<readonly MonitorViewModel[]>([])
  const [rawMonitors, setRawMonitors] = useState<readonly Monitor[]>([])
  const [manualTestEnabled, setManualTestEnabled] = useState(false)
  const [availableLocations, setAvailableLocations] = useState<readonly Region[]>([])
  const [maxLocations, setMaxLocations] = useState(1)
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState<string | null>(null)
  const loadedOnce = useRef(demo)

  const reload = useCallback(async () => {
    if (demo || !authenticated || !workspace) return
    if (!loadedOnce.current) setLoading(true)
    setError(null)
    try {
      const now = new Date()
      const from = fromForPeriod('24h', now)
      const [page, summary, incidentsPage, entitlements, regionsPage] = await Promise.all([
        api.listMonitors(workspace.id, { limit: 100 }),
        api.getMetricsSummary(workspace.id, { from, to: now.toISOString() }),
        api.listIncidents(workspace.id, { from, to: now.toISOString(), limit: 100 }),
        api.getWorkspaceEntitlements(workspace.id),
        api.listRegions(),
      ])
      setManualTestEnabled(entitlements.limits.allow_manual_tests)
      setMaxLocations(entitlements.limits.max_locations)
      setAvailableLocations(regionsPage.items ?? [])
      const monitors = page.items ?? []
      setRawMonitors(monitors)
      const metricItems = summary.items ?? []
      const incidents = incidentsPage.items ?? []
      const checkResults = await Promise.allSettled(monitors.map(async (monitor) => {
        const checks: CheckResult[] = []
        let cursor: string | undefined
        do {
          const page = await api.listMonitorChecks(workspace.id, monitor.id, {
            ...(monitor.type === 'leakcheck' || monitor.type === 'compliance' ? {} : { from, to: now.toISOString() }),
            limit: monitor.type === 'leakcheck' || monitor.type === 'compliance' ? 1 : 250,
            cursor,
          })
          checks.push(...(page.items ?? []))
          cursor = page.next_cursor
        } while (cursor)
        return checks
      }))
      const metrics = new Map(metricItems.map((item) => [item.monitor_id, item.stats] as const))
      const activeIncidents = new Map(
        incidents
          .filter((incident) => incident.status !== 'resolved')
          .map((incident) => [incident.monitor_id, incident] as const),
      )
      const latestIncidents = new Map<string, (typeof incidents)[number]>()
      incidents.forEach((incident) => {
        const current = latestIncidents.get(incident.monitor_id)
        if (!current || Date.parse(incident.started_at) > Date.parse(current.started_at)) {
          latestIncidents.set(incident.monitor_id, incident)
        }
      })
      setData(monitors.map((monitor, index) =>
        toMonitorViewModel(monitor, {
          checks: checkResults[index].status === 'fulfilled'
            ? checkResults[index].value
            : [],
          stats: metrics.get(monitor.id),
          activeIncident: activeIncidents.get(monitor.id),
          latestIncident: latestIncidents.get(monitor.id),
          now,
        }),
      ))
    } catch (loadError) {
      setError(monitorErrorMessage(loadError, 'The monitoring service did not respond.'))
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [api, authenticated, demo, workspace])

  useEffect(() => { void reload() }, [reload])

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
      onBulkAction={bulkAction}
      onBulkTags={bulkTags}
      manualTestEnabled={manualTestEnabled}
      availableLocations={availableLocations}
      maxLocations={maxLocations}
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
      const monitor = await api.getMonitor(workspace.id, monitorId)
      setRawMonitor(monitor)
      const now = new Date()
      const to = now.toISOString()
      const responseFrom = fromForResponseRange(responseRange, now)
      const uptimeFrom = fromForPeriod('24h', now)
      const historyFrom = Date.parse(responseFrom) < Date.parse(uptimeFrom) ? responseFrom : uptimeFrom
      const evidenceOnly = monitor.type === 'leakcheck' || monitor.type === 'compliance'
      const metricsPromise = Promise.all(periods.map((period) =>
        api.getMonitorMetrics(workspace.id, monitor.id, { from: fromForPeriod(period, now), to }),
      ))
      const httpConfig = monitor.config.http
      const certificatePromise = monitor.type === 'tls' || (
        /^https:\/\//i.test(httpConfig?.url ?? '') && (
          httpConfig?.validate_tls === true || httpConfig?.tls_expiry_warn_days != null
        )
      )
        ? api.listCertificateEvidence(workspace.id, monitor.id, { limit: 30 })
        : Promise.resolve(emptyCheckPage())
      const dnsPromise = monitor.type === 'dns'
        ? api.listDnsEvidence(workspace.id, monitor.id, { limit: 30 })
        : Promise.resolve(emptyCheckPage())
      const domainPromise = monitor.type === 'domain' || monitor.type === 'http' || monitor.type === 'keyword'
        ? api.listDomainEvidence(workspace.id, monitor.id, { limit: 30 })
        : Promise.resolve(emptyCheckPage())

      const [
        historyChecks,
        metrics,
        incidentsPage,
        certificates,
        dns,
        domains,
        maintenanceList,
        integrationList,
        statusPageList,
        entitlements,
        locationCatalog,
      ] = await Promise.all([
        evidenceOnly
          ? api.listMonitorChecks(workspace.id, monitor.id, { limit: 1 }).then((page) => page.items ?? [])
          : loadMonitorCheckHistory(api, workspace.id, monitor.id, { from: historyFrom, to }),
        metricsPromise,
        api.listIncidents(workspace.id, { from: fromForPeriod('365d', now), to, limit: 100 }),
        certificatePromise,
        dnsPromise,
        domainPromise,
        api.listMaintenanceWindows(workspace.id),
        api.listIntegrations(workspace.id),
        evidenceOnly ? Promise.resolve({ items: [] }) : api.listStatusPages(workspace.id),
        api.getWorkspaceEntitlements(workspace.id),
        api.listRegions(),
      ])
      setManualTestEnabled(entitlements.limits.allow_manual_tests)
      const stats = Object.fromEntries(periods.map((period, index) => [period, metrics[index]])) as Record<UptimePeriodSummary['period'], UptimeStats>
      const checks = evidenceOnly ? historyChecks : checksWithinRange(historyChecks, uptimeFrom, to)
      const responseChecks = evidenceOnly ? [] : checksWithinRange(historyChecks, responseFrom, to)
      setData(toLiveMonitorDetail({
        monitor,
        checks,
        responseChecks,
        certificateEvidence: certificates.items ?? [],
        dnsEvidence: dns.items ?? [],
        domainEvidence: domains.items ?? [],
        incidents: (incidentsPage.items ?? []).filter((incident) => incident.monitor_id === monitor.id),
        stats,
        locations: locationCatalog.items ?? [],
      }))
      const monitorWindows = (maintenanceList.items ?? [])
        .filter((window) => window.active && window.monitor_ids.includes(monitor.id))
        .map((window) => toMaintenanceWindowViewModel(window, { monitors: [monitor] }))
        .filter((window) => window.state === 'active' || window.state === 'upcoming')
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
      setNextMaintenance(monitorWindows[0])
      setNotifications((integrationList.items ?? [])
        .filter((integration) => !integration.monitor_ids?.length || integration.monitor_ids.includes(monitor.id))
        .map(toIntegrationViewModel))

      const rawStatusPages = statusPageList.items ?? []
      const componentLists = await Promise.allSettled(
        rawStatusPages.map((page) => api.listStatusPageComponents(workspace.id, page.id)),
      )
      setStatusPages(rawStatusPages.flatMap((page, index) => {
        const components = componentLists[index].status === 'fulfilled'
          ? componentLists[index].value.items ?? []
          : []
        return components.some((component) => component.monitor_id === monitor.id)
          ? [toStatusPageViewModel(page, { componentCount: components.length })]
          : []
      }))
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
        if (now - autoRefresh.current.lastAttemptAt < 3000) return
        autoRefresh.current.inFlight = true
        autoRefresh.current.lastAttemptAt = now
        void reload(true).finally(() => { autoRefresh.current.inFlight = false })
        return
      }
      const checkedAt = new Date(monitor.lastCheckedAt).getTime()
      const dueAt = checkedAt + Math.max(1, monitor.intervalSeconds) * 1000
      const now = Date.now()
      if (!Number.isFinite(checkedAt) || now < dueAt || now - autoRefresh.current.lastAttemptAt < 5000) return
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
  availableLocations: Region[]
  maxLocations: number
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
      const [monitor, page, regionsPage, entitlements] = await Promise.all([
        api.getMonitor(workspace.id, monitorId),
        api.listMonitors(workspace.id, { limit: 250 }),
        api.listRegions(),
        api.getWorkspaceEntitlements(workspace.id),
      ])
      const availableTags = [...new Set((page.items ?? []).flatMap((item) => item.tags))].sort()
      setState({
        monitor,
        view: toMonitorViewModel(monitor),
        availableTags,
        availableLocations: regionsPage.items ?? [],
        maxLocations: entitlements.limits.max_locations,
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
      availableLocations={state?.availableLocations}
      maxLocations={state?.maxLocations}
      loading={loading && !state}
      error={error}
      onRetry={() => void reload()}
      onSubmit={update}
    />
  )
}
