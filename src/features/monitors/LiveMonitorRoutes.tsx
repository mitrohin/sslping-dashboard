import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CheckResult, Monitor, UptimeStats } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { isDemoSession } from '../../app/DashboardGate'
import { toMonitorViewModel } from '../../app/viewAdapters'
import type { MonitorViewModel, UptimePeriodSummary } from '../../data'
import { MonitorDetailPage } from './MonitorDetailPage'
import { MonitorEditPage } from './MonitorEditPage'
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

export function LiveMonitorsPage() {
  const { api, authenticated, workspace } = useAuth()
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
      const checkResults = await Promise.allSettled(
        page.items.map((monitor) =>
          api.listMonitorChecks(workspace.id, monitor.id, { from, to: now.toISOString(), limit: 30 }),
        ),
      )
      const metrics = new Map(summary.items.map((item) => [item.monitor_id, item.stats] as const))
      const activeIncidents = new Map(
        incidentsPage.items
          .filter((incident) => incident.status !== 'resolved')
          .map((incident) => [incident.monitor_id, incident] as const),
      )
      setData(page.items.map((monitor, index) =>
        toMonitorViewModel(monitor, {
          checks: checkResults[index].status === 'fulfilled' ? checkResults[index].value.items : [],
          stats: metrics.get(monitor.id),
          activeIncident: activeIncidents.get(monitor.id),
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
    await api.createMonitor(workspace.id, monitorDraftToCreateRequest(draft))
    await reload()
  }

  return <MonitorsPage data={data} loading={loading} error={error} onRetry={() => void reload()} onCreate={create} />
}

export function LiveMonitorDetailPage() {
  const { api, authenticated, workspace } = useAuth()
  const { monitorId } = useParams()
  const navigate = useNavigate()
  const demo = isDemoSession()
  const [data, setData] = useState<MonitorDetailData | null>(null)
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState<string | null>(null)
  const [responseRange, setResponseRange] = useState('1h')

  const reload = useCallback(async () => {
    if (demo || !authenticated || !workspace || !monitorId) return
    setLoading(true)
    setError(null)
    try {
      const monitor = await api.getMonitor(workspace.id, monitorId)
      const now = new Date()
      const to = now.toISOString()
      const responseFrom = fromForResponseRange(responseRange, now)
      const metricsPromise = Promise.all(periods.map((period) =>
        api.getMonitorMetrics(workspace.id, monitor.id, { from: fromForPeriod(period, now), to }),
      ))
      const certificatePromise = monitor.type === 'tls' || /^https:\/\//i.test(monitor.config.http?.url ?? '')
        ? api.listCertificateEvidence(workspace.id, monitor.id, { limit: 30 })
        : Promise.resolve(emptyCheckPage())
      const dnsPromise = monitor.type === 'dns'
        ? api.listDnsEvidence(workspace.id, monitor.id, { limit: 30 })
        : Promise.resolve(emptyCheckPage())
      const domainPromise = monitor.type === 'domain'
        ? api.listDomainEvidence(workspace.id, monitor.id, { limit: 30 })
        : Promise.resolve(emptyCheckPage())

      const [checksPage, responseChecksPage, metrics, incidentsPage, certificates, dns, domains] = await Promise.all([
        api.listMonitorChecks(workspace.id, monitor.id, { from: fromForPeriod('24h', now), to, limit: 100 }),
        api.listMonitorChecks(workspace.id, monitor.id, { from: responseFrom, to, limit: 100 }),
        metricsPromise,
        api.listIncidents(workspace.id, { from: fromForPeriod('365d', now), to, limit: 100 }),
        certificatePromise,
        dnsPromise,
        domainPromise,
      ])
      const stats = Object.fromEntries(periods.map((period, index) => [period, metrics[index]])) as Record<UptimePeriodSummary['period'], UptimeStats>
      setData(toLiveMonitorDetail({
        monitor,
        checks: checksPage.items,
        responseChecks: responseChecksPage.items,
        certificateEvidence: certificates.items,
        dnsEvidence: dns.items,
        domainEvidence: domains.items,
        incidents: incidentsPage.items.filter((incident) => incident.monitor_id === monitor.id),
        stats,
      }))
    } catch (loadError) {
      setError(monitorErrorMessage(loadError, 'The monitor details could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [api, authenticated, demo, monitorId, responseRange, workspace])

  useEffect(() => { void reload() }, [reload])

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

  return (
    <MonitorDetailPage
      monitor={data?.monitor}
      responseTime={data?.responseTime}
      uptimePeriods={data?.uptimePeriods}
      incidents={data?.incidents}
      mtbfSeconds={data?.mtbfSeconds}
      loading={loading && !data}
      error={error}
      onRetry={() => void reload()}
      onTogglePause={togglePause}
      onTest={test}
      onDelete={remove}
      onRangeChange={setResponseRange}
    />
  )
}

interface LiveEditState {
  monitor: Monitor
  view: MonitorViewModel
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
      const monitor = await api.getMonitor(workspace.id, monitorId)
      setState({ monitor, view: toMonitorViewModel(monitor) })
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
      loading={loading && !state}
      error={error}
      onRetry={() => void reload()}
      onSubmit={update}
    />
  )
}
