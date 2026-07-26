import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CheckResult, Monitor, UptimeStats } from '../../api/types'
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
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (demo || !authenticated || !workspace) return
    setLoading(true)
    setError(null)
    try {
      const now = new Date()
      const from = fromForPeriod('24h', now)
      const [page, summary, incidentsPage] = await Promise.all([
        api.listMonitors(workspace.id, { limit: 100 }),
        api.getMetricsSummary(workspace.id, { from, to: now.toISOString() }),
        api.listIncidents(workspace.id, { from, to: now.toISOString(), limit: 100 }),
      ])
      const monitors = page.items ?? []
      const metricItems = summary.items ?? []
      const incidents = incidentsPage.items ?? []
      const checkResults = await Promise.allSettled(monitors.map(async (monitor) => {
        const checks: CheckResult[] = []
        let cursor: string | undefined
        do {
          const page = await api.listMonitorChecks(workspace.id, monitor.id, {
            from,
            to: now.toISOString(),
            limit: 250,
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
    await api.testMonitor(workspace.id, monitor.id)
    await reload()
  }

  const remove = async (monitor: MonitorViewModel) => {
    if (!workspace) throw new Error('No active workspace is selected.')
    await api.deleteMonitor(workspace.id, monitor.id)
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
        checksPage,
        responseChecksPage,
        metrics,
        incidentsPage,
        certificates,
        dns,
        domains,
        maintenanceList,
        integrationList,
        statusPageList,
      ] = await Promise.all([
        api.listMonitorChecks(workspace.id, monitor.id, { from: fromForPeriod('24h', now), to, limit: 100 }),
        api.listMonitorChecks(workspace.id, monitor.id, { from: responseFrom, to, limit: 100 }),
        metricsPromise,
        api.listIncidents(workspace.id, { from: fromForPeriod('365d', now), to, limit: 100 }),
        certificatePromise,
        dnsPromise,
        domainPromise,
        api.listMaintenanceWindows(workspace.id),
        api.listIntegrations(workspace.id),
        api.listStatusPages(workspace.id),
      ])
      const stats = Object.fromEntries(periods.map((period, index) => [period, metrics[index]])) as Record<UptimePeriodSummary['period'], UptimeStats>
      setData(toLiveMonitorDetail({
        monitor,
        checks: checksPage.items ?? [],
        responseChecks: responseChecksPage.items ?? [],
        certificateEvidence: certificates.items ?? [],
        dnsEvidence: dns.items ?? [],
        domainEvidence: domains.items ?? [],
        incidents: (incidentsPage.items ?? []).filter((incident) => incident.monitor_id === monitor.id),
        stats,
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
      if (!monitor?.lastCheckedAt || monitor.status === 'paused' || autoRefresh.current.inFlight) return
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
    await api.testMonitor(context.workspaceId, context.monitorId)
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
      setState({ monitor, view: toMonitorViewModel(monitor), availableTags })
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
