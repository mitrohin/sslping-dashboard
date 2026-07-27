import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  Globe2,
  KeyRound,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  RadioTower,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  demoIncidents,
  demoMaintenanceWindows,
  demoMonitors,
  demoResponseTimeSeries,
  demoUptimePeriods,
  type IncidentViewModel,
  type IntegrationViewModel,
  type MaintenanceWindowViewModel,
  type MonitorViewModel,
  type ResponseTimeSeries,
  type StatusPageViewModel,
  type UptimePeriodSummary,
} from '../../data'
import { formatDate, formatDuration, formatRelativeTime, formatUptime } from '../../lib/format'
import { UptimeBars } from '../../components/UptimeBars'
import { Badge, Button, EmptyState, Field, IconButton, Modal, Panel, Select, StatusDot, Toggle } from '../../components/ui'
import { HeartbeatCredentialModal, type HeartbeatCredential } from './HeartbeatCredentialModal'

export interface MonitorDetailPageProps {
  monitor?: MonitorViewModel
  responseTime?: readonly ResponseTimeSeries[]
  uptimePeriods?: readonly UptimePeriodSummary[]
  incidents?: readonly IncidentViewModel[]
  nextMaintenance?: MaintenanceWindowViewModel
  notifications?: readonly IntegrationViewModel[]
  statusPages?: readonly StatusPageViewModel[]
  mtbfSeconds?: number
  loading?: boolean
  refreshing?: boolean
  error?: string | null
  onRetry?: () => void
  onTogglePause?: (pause: boolean) => Promise<void>
  onTest?: () => Promise<void>
  onDelete?: () => Promise<void>
  onRotateHeartbeat?: () => Promise<HeartbeatCredential>
  onRangeChange?: (range: string) => void
  onUpdateResponseAlert?: (thresholdMs?: number) => Promise<void>
  onExportLogs?: () => void
  manualTestEnabled?: boolean
}

const quoteCsv = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`

function incidentCsv(incidents: readonly IncidentViewModel[]): string {
  const header = ['status', 'root_cause', 'started_at', 'resolved_at', 'duration_seconds', 'visibility']
  const rows = incidents.map((incident) => [
    incident.status,
    incident.rootCause,
    incident.startedAt,
    incident.resolvedAt ?? '',
    incident.durationSeconds,
    incident.visibility,
  ])
  return [header, ...rows].map((row) => row.map(quoteCsv).join(',')).join('\n')
}

export function MonitorDetailPage({
  monitor: suppliedMonitor,
  responseTime: suppliedResponseTime,
  uptimePeriods: suppliedUptimePeriods,
  incidents: suppliedIncidents,
  nextMaintenance,
  notifications = [],
  statusPages = [],
  mtbfSeconds,
  loading = false,
  refreshing = false,
  error = null,
  onRetry,
  onTogglePause,
  onTest,
  onDelete,
  onRotateHeartbeat,
  onRangeChange,
  onUpdateResponseAlert,
  onExportLogs,
  manualTestEnabled = true,
}: MonitorDetailPageProps = {}) {
  const { monitorId } = useParams()
  const navigate = useNavigate()
  const fallbackMonitor = demoMonitors.find((item) => item.id === monitorId) ?? demoMonitors[0]
  const monitor = suppliedMonitor ?? fallbackMonitor
  const responseTime = suppliedResponseTime ?? demoResponseTimeSeries
  const uptimePeriods = suppliedUptimePeriods ?? demoUptimePeriods
  const incidents = suppliedIncidents ?? demoIncidents.filter((incident) => incident.monitorId === monitor.id)
  const [pausedOverride, setPausedOverride] = useState<boolean | null>(null)
  const [notificationSent, setNotificationSent] = useState(false)
  const [range, setRange] = useState('1h')
  const [clock, setClock] = useState(() => Date.now())
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [heartbeatCredential, setHeartbeatCredential] = useState<HeartbeatCredential | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [regionsOpen, setRegionsOpen] = useState(false)
  const [selectedRegions, setSelectedRegions] = useState<readonly string[]>(() => responseTime.map((series) => series.regionId))
  const [responseAlertOpen, setResponseAlertOpen] = useState(false)
  const [responseAlertEnabled, setResponseAlertEnabled] = useState(Boolean(monitor.slowThresholdMs))
  const [responseThresholdMs, setResponseThresholdMs] = useState(monitor.slowThresholdMs || 1500)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const regionMenuRef = useRef<HTMLDivElement>(null)
  const exportLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => setPausedOverride(null), [monitor.id, monitor.status])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    setSelectedRegions((current) => {
      const available = responseTime.map((series) => series.regionId)
      const retained = current.filter((regionId) => available.includes(regionId))
      return retained.length ? retained : available
    })
  }, [responseTime])
  useEffect(() => {
    setResponseAlertEnabled(Boolean(monitor.slowThresholdMs))
    setResponseThresholdMs(monitor.slowThresholdMs || 1500)
  }, [monitor.id, monitor.slowThresholdMs])
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Node
      if (!actionMenuRef.current?.contains(target)) setActionsOpen(false)
      if (!regionMenuRef.current?.contains(target)) setRegionsOpen(false)
    }
    document.addEventListener('pointerdown', closeMenus)
    return () => document.removeEventListener('pointerdown', closeMenus)
  }, [])

  const paused = pausedOverride ?? monitor.status === 'paused'
  const activeResponseTime = useMemo(
    () => responseTime.filter((series) => selectedRegions.includes(series.regionId)),
    [responseTime, selectedRegions],
  )
  const chartData = useMemo(() => {
    const length = Math.max(0, ...activeResponseTime.map((series) => series.points.length))
    return Array.from({ length }, (_, index) => {
      const timestamp = activeResponseTime.find((series) => series.points[index])?.points[index]?.timestamp
      const row: Record<string, string | number | undefined> = {
        timestamp: timestamp
          ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '',
      }
      for (const series of activeResponseTime) row[series.regionId] = series.points[index]?.valueMs
      return row
    })
  }, [activeResponseTime])
  const uptimeValues = monitor.last24Hours.map((bar) =>
    bar.status === 'up' ? 100 : bar.status === 'down' ? 0 : 97,
  )
  const latencyValues = activeResponseTime.flatMap((series) => series.points.map((point) => point.valueMs))
  const averageLatency = latencyValues.length
    ? Math.round(latencyValues.reduce((total, value) => total + value, 0) / latencyValues.length)
    : 0
  const minimumLatency = latencyValues.length ? Math.min(...latencyValues) : 0
  const maximumLatency = latencyValues.length ? Math.max(...latencyValues) : 0
  const regionLabel = selectedRegions.length === responseTime.length
    ? 'All regions'
    : selectedRegions.length === 1
      ? responseTime.find((series) => series.regionId === selectedRegions[0])?.regionLabel ?? '1 region'
      : `${selectedRegions.length} regions`
  const exportFileName = `${monitor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'monitor'}-incidents.csv`
  const exportHref = `data:text/csv;charset=utf-8,${encodeURIComponent(incidentCsv(incidents))}`

  const runAction = async (action: () => Promise<void>) => {
    setActionBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'The action could not be completed.')
    } finally {
      setActionBusy(false)
    }
  }

  const togglePause = () => void runAction(async () => {
    const nextPaused = !paused
    if (onTogglePause) await onTogglePause(nextPaused)
    setPausedOverride(nextPaused)
    setActionsOpen(false)
  })

  const testNotification = () => void runAction(async () => {
    if (onTest) await onTest()
    setNotificationSent(true)
    setActionsOpen(false)
    window.setTimeout(() => setNotificationSent(false), 2200)
  })

  const deleteMonitor = () => {
    setActionsOpen(false)
    if (!window.confirm(`Delete “${monitor.name}”? This cannot be undone.`)) return
    void runAction(async () => {
      if (onDelete) await onDelete()
      else navigate('/monitors')
    })
  }

  const rotateHeartbeat = () => {
    if (!onRotateHeartbeat) return
    if (!window.confirm('Rotate this heartbeat URL? The current URL will stop working immediately.')) return
    void runAction(async () => setHeartbeatCredential(await onRotateHeartbeat()))
  }

  const copyTarget = async () => {
    await navigator.clipboard.writeText(monitor.target)
    setActionsOpen(false)
  }

  const exportLogs = () => {
    setActionsOpen(false)
    if (onExportLogs) onExportLogs()
    else exportLinkRef.current?.click()
  }

  const saveResponseAlert = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const threshold = Math.max(100, Math.round(responseThresholdMs))
    void runAction(async () => {
      await onUpdateResponseAlert?.(responseAlertEnabled ? threshold : undefined)
      setResponseAlertOpen(false)
    })
  }

  const toggleRegion = (regionId: string) => {
    setSelectedRegions((current) => {
      if (!current.includes(regionId)) return [...current, regionId]
      if (current.length === 1) return current
      return current.filter((value) => value !== regionId)
    })
  }

  if (loading) {
    return <div className="page page--wide monitor-detail-page"><Link to="/monitors" className="back-link"><ArrowLeft size={17} /> Monitoring</Link><Panel><EmptyState icon={<Globe2 size={34} />} title="Loading monitor" description="Fetching checks, metrics, incidents and evidence…" /></Panel></div>
  }

  if (error && !suppliedMonitor) {
    return <div className="page page--wide monitor-detail-page"><Link to="/monitors" className="back-link"><ArrowLeft size={17} /> Monitoring</Link><Panel><EmptyState icon={<ShieldCheck size={34} />} title="Could not load monitor" description={error} action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined} /></Panel></div>
  }

  return (
    <div className="page page--wide monitor-detail-page">
      <Link to="/monitors" className="back-link"><ArrowLeft size={17} /> Monitoring</Link>
      <header className="monitor-detail-header">
        <div className={`monitor-detail-header__state monitor-detail-header__state--${paused ? 'paused' : monitor.status}`}><StatusDot status={paused ? 'paused' : monitor.status} /></div>
        <div className="monitor-detail-header__identity">
          <h1>{monitor.name}<span className="title-dot">.</span></h1>
          <p>{monitor.typeLabel} monitor for <a href={monitor.target.startsWith('http') ? monitor.target : undefined}>{monitor.target} {monitor.target.startsWith('http') && <ExternalLink size={14} />}</a></p>
          <div>{monitor.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
          {actionError && <small className="danger-text" role="alert">{actionError}</small>}
        </div>
        <div className="monitor-detail-header__actions">
          {monitor.type === 'heartbeat' && onRotateHeartbeat && <Button variant="secondary" disabled={actionBusy} onClick={rotateHeartbeat}><KeyRound size={17} /> Rotate URL</Button>}
          {manualTestEnabled && <Button variant="secondary" disabled={actionBusy} onClick={testNotification}><BellRing size={17} /> {notificationSent ? 'Test completed' : 'Test monitor'}</Button>}
          <Button variant="secondary" disabled={actionBusy} onClick={togglePause}>{paused ? <PlayCircle size={17} /> : <PauseCircle size={17} />}{paused ? 'Resume' : 'Pause'}</Button>
          <Link className="button button--secondary button--md" to={`/monitors/${monitor.id}/edit`}><Pencil size={17} /> Edit</Link>
          <div className="monitor-detail-actions-menu" ref={actionMenuRef}>
            <IconButton label={`More actions for ${monitor.name}`} aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)}><MoreVertical size={19} /></IconButton>
            {actionsOpen && <div className="monitor-action-menu" role="menu">
              <Link to={`/monitors/${monitor.id}/edit`} role="menuitem"><Pencil size={15} /> Edit monitor</Link>
              {manualTestEnabled && <button type="button" role="menuitem" onClick={testNotification}><BellRing size={15} /> Run test now</button>}
              <button type="button" role="menuitem" onClick={togglePause}>{paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />}{paused ? 'Resume monitor' : 'Pause monitor'}</button>
              <button type="button" role="menuitem" onClick={() => void copyTarget()}><Copy size={15} /> Copy target</button>
              <button type="button" role="menuitem" onClick={exportLogs}><Download size={15} /> Export incident log</button>
              <button type="button" role="menuitem" className="monitor-action-menu__danger" onClick={deleteMonitor}><Trash2 size={15} /> Delete monitor</button>
            </div>}
          </div>
        </div>
      </header>

      <div className="monitor-detail-grid">
        <div className="monitor-detail-main">
          <div className="monitor-kpis">
            <Panel><span>Current status</span><strong className={paused ? 'muted' : monitor.status === 'up' ? 'success-text' : 'danger-text'}>{paused ? 'Paused' : monitor.status === 'up' ? 'Up' : monitor.status}</strong><small>{monitor.statusChangedAt ? `Since ${formatRelativeTime(monitor.statusChangedAt, clock)}` : 'Awaiting first check'}</small></Panel>
            <Panel><span>Last check</span><strong>{monitor.lastCheckedAt ? formatRelativeTime(monitor.lastCheckedAt, clock) : '—'}</strong><small>{refreshing ? 'Refreshing from backend…' : `Checked every ${formatDuration(monitor.intervalSeconds)}`}</small></Panel>
            <Panel className="monitor-kpis__uptime"><div><span>Last 24 hours</span><strong>{formatUptime(monitor.uptime24h)}</strong></div><UptimeBars values={uptimeValues} /><small>{incidents.length} incidents in this period</small></Panel>
          </div>

          <Panel className="uptime-periods">
            {uptimePeriods.map((period) => <div key={period.period}><span>Last {period.period}</span><strong className={period.uptime >= 99.9 ? 'success-text' : 'warning-text'}>{formatUptime(period.uptime)}</strong><small>{period.incidentCount} incidents, {formatDuration(period.downtimeSeconds)} down</small></div>)}
            <div><span>MTBF</span><strong className="success-text">{mtbfSeconds === undefined ? '—' : formatDuration(mtbfSeconds)}</strong><small>Calculated over 365 days</small></div>
          </Panel>

          <Panel className="response-chart-panel">
            <header className="panel__header"><h2>Response time for <span className="region-picker" ref={regionMenuRef}><button type="button" className="region-picker__trigger" aria-haspopup="menu" aria-expanded={regionsOpen} onClick={() => setRegionsOpen((open) => !open)}>{regionLabel}<ChevronDown className="dropdown-chevron" size={16} aria-hidden="true" /></button>{regionsOpen && <span className="region-picker__menu" role="menu">{responseTime.map((series) => <button type="button" role="menuitemcheckbox" aria-checked={selectedRegions.includes(series.regionId)} key={series.regionId} onClick={() => toggleRegion(series.regionId)}><span className="region-picker__swatch" style={{ background: series.color }} /><span>{series.regionLabel}</span>{selectedRegions.includes(series.regionId) && <Check size={15} />}</button>)}</span>}</span></h2><div><Button size="sm" variant="secondary" onClick={() => setResponseAlertOpen(true)}><Gauge size={15} />{monitor.slowThresholdMs ? `Alert at ${monitor.slowThresholdMs} ms` : 'Set response alert'}</Button><Select value={range} onChange={(event) => { setRange(event.target.value); onRangeChange?.(event.target.value) }}><option value="1h">Last hour</option><option value="24h">Last 24h</option><option value="7d">Last 7 days</option></Select></div></header>
            <div className="response-chart">
              {chartData.length ? <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 15, right: 18, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke="#2b374a" vertical={false} />
                  <XAxis dataKey="timestamp" stroke="#6f829e" tickLine={false} axisLine={false} minTickGap={45} fontSize={11} />
                  <YAxis stroke="#6f829e" tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={(value) => `${value}ms`} />
                  <Tooltip contentStyle={{ background: '#101925', border: '1px solid #354158', borderRadius: 10 }} />
                  {activeResponseTime.map((series) => <Line key={series.regionId} dataKey={series.regionId} name={series.regionLabel} type="monotone" stroke={series.color} dot={false} strokeWidth={2} />)}
                </LineChart>
              </ResponsiveContainer> : <div className="latest-incidents__empty"><span>No response-time samples for this range.</span></div>}
            </div>
            <footer className="response-chart__stats">
              <div><span><Settings2 size={17} /> Average</span><strong>{averageLatency} ms</strong></div>
              <div><span><ArrowDownToLine size={17} /> Fastest</span><strong className="success-text">{minimumLatency} ms</strong></div>
              <div><span><ArrowUpFromLine size={17} /> Slowest</span><strong className="danger-text">{maximumLatency} ms</strong></div>
            </footer>
          </Panel>

          <Panel className="latest-incidents">
            <header className="panel__header"><h2>Latest incidents<span className="title-dot">.</span></h2>{onExportLogs ? <Button variant="secondary" size="sm" onClick={onExportLogs}><Download size={15} /> Export logs</Button> : <a ref={exportLinkRef} className="button button--secondary button--sm" href={exportHref} download={exportFileName}><Download size={15} /> Export logs</a>}</header>
            {incidents.length ? incidents.map((incident) => <div className="latest-incidents__row" key={incident.id}><span><StatusDot status={incident.status} /><strong className={incident.status === 'resolved' ? 'success-text' : 'warning-text'}>{incident.status}</strong></span><span>{incident.rootCause}</span><span>{formatDate(incident.startedAt)}</span><span>{formatDuration(incident.durationSeconds)}</span></div>) : <div className="latest-incidents__empty"><ShieldCheck size={27} /><span>No incidents recorded for this monitor.</span></div>}
          </Panel>
        </div>

        <aside className="monitor-detail-side">
          <Panel className="side-card domain-card"><h2>Domain & SSL<span className="title-dot">.</span></h2>{monitor.domainRegistration ? <div><span>Domain valid until</span><strong><ShieldCheck size={19} /> {formatDate(monitor.domainRegistration.expiresAt, { includeYear: true })}</strong></div> : <p className="muted">No domain evidence yet.</p>}{monitor.sslCertificate ? <div><span>SSL certificate valid until</span><strong><ShieldCheck size={19} /> {formatDate(monitor.sslCertificate.expiresAt, { includeYear: true })}</strong><small>{monitor.sslCertificate.issuer}</small></div> : null}</Panel>
          <Panel className="side-card"><h2>Next maintenance<span className="title-dot">.</span></h2><CalendarDays size={26} className="side-card__feature-icon" />{nextMaintenance ? <div className="side-card__resource"><strong>{nextMaintenance.name}</strong><span>{formatDate(nextMaintenance.startsAt)}</span><small>{formatDuration(nextMaintenance.durationMinutes * 60)} · {nextMaintenance.timezone}</small></div> : <p>{suppliedMonitor ? 'No maintenance planned.' : demoMaintenanceWindows[1]?.name ?? 'No maintenance planned.'}</p>}<Button variant="secondary" size="sm" onClick={() => navigate(`/maintenance?create=1&monitor=${encodeURIComponent(monitor.id)}`)}>Set up maintenance</Button></Panel>
          <Panel className="side-card"><h2>Regions<span className="title-dot">.</span></h2><div className="region-map" aria-label="Monitoring regions"><Globe2 size={90} /><span className="region-map__one" /><span className="region-map__two" /></div>{monitor.regions.map((region) => <Badge key={region} tone="success">{region}</Badge>)}</Panel>
          <Panel className="side-card"><h2>To be notified<span className="title-dot">.</span></h2>{notifications.length ? <div className="side-card__resource-list">{notifications.slice(0, 3).map((integration) => <div key={integration.id}><BellRing size={16} /><span><strong>{integration.name}</strong><small>{integration.destinationLabel}</small></span></div>)}</div> : <div className="notification-logos"><span>—</span></div>}<Button variant="secondary" size="sm" onClick={() => navigate(`/integrations?monitor=${encodeURIComponent(monitor.id)}`)}>Manage notifications</Button></Panel>
          <Panel className="side-card"><h2>Appears on<span className="title-dot">.</span></h2>{statusPages.length ? <div className="side-card__resource-list">{statusPages.slice(0, 3).map((page) => <div key={page.id}><RadioTower size={16} /><span><strong>{page.name}</strong><small>{page.status}</small></span></div>)}</div> : <><RadioTower size={25} className="side-card__feature-icon" /><p>{suppliedMonitor ? 'Not attached to a status page.' : 'System status'}</p></>}<Button variant="secondary" size="sm" onClick={() => navigate(`/status-pages?create=1&monitor=${encodeURIComponent(monitor.id)}`)}>Manage status pages</Button></Panel>
        </aside>
      </div>

      <Modal open={responseAlertOpen} onClose={() => setResponseAlertOpen(false)} title="Response time alert" icon={<Gauge size={36} />} width="sm">
        <form className="response-alert-form" onSubmit={saveResponseAlert}>
          <div className="response-alert-toggle"><div><strong>Slow response alert</strong><span>Open an incident when response time crosses the threshold.</span></div><Toggle checked={responseAlertEnabled} onChange={setResponseAlertEnabled} label="Slow response alert" /></div>
          <Field label="Response-time threshold" hint="Values are evaluated for every selected monitoring region."><div className="input-with-suffix"><input type="number" min={100} max={120000} step={100} disabled={!responseAlertEnabled} value={responseThresholdMs} onChange={(event) => setResponseThresholdMs(Number(event.target.value))} required={responseAlertEnabled} /><span>ms</span></div></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setResponseAlertOpen(false)}>Cancel</Button><Button type="submit" disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Save alert'}</Button></div>
        </form>
      </Modal>
      {heartbeatCredential && <HeartbeatCredentialModal credential={heartbeatCredential} onClose={() => setHeartbeatCredential(null)} />}
    </div>
  )
}
