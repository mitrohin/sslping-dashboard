import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
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
  KeyRound,
  LoaderCircle,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  RadioTower,
  Scale,
  Settings2,
  ShieldCheck,
  ShieldAlert,
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
import { formatDate, formatDuration, formatRelativeTime, formatStatus, formatUptime } from '../../lib/format'
import { UptimeBars } from '../../components/UptimeBars'
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageLoadingSkeleton, Panel, Select, StatusDot, Toggle } from '../../components/ui'
import { HeartbeatCredentialModal, type HeartbeatCredential } from './HeartbeatCredentialModal'
import { ComplianceManualChecklist } from './ComplianceReport'
import { useI18n } from '../../app/I18nProvider'
import { RegionMap } from './RegionMap'

export interface MonitorDetailPageProps {
  monitor?: MonitorViewModel
  responseTime?: readonly ResponseTimeSeries[]
  locationNames?: Readonly<Record<string, string>>
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

function formatCheckAgeSeconds(value: string | undefined, now: number): string {
  if (!value) return '—'
  const checkedAt = Date.parse(value)
  if (!Number.isFinite(checkedAt)) return '—'
  return `${Math.max(0, Math.floor((now - checkedAt) / 1000))}s`
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

export interface ResponseTimeChartRow {
  timestamp: number
  [regionId: string]: number | undefined
}

const RESPONSE_TIME_DISPLAY_PREFIX = '__display__:'

export function responseTimeDisplayKey(regionId: string): string {
  return `${RESPONSE_TIME_DISPLAY_PREFIX}${regionId}`
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/**
 * Hampel-style visual filter for a single high sample surrounded by normal
 * samples. Sustained or adjacent spikes are left untouched so a real latency
 * event remains visible.
 */
export function smoothIsolatedResponseTimeSpikes(values: readonly number[]): number[] {
  if (values.length < 3) return [...values]

  return values.map((current, index) => {
    if (index === 0 || index === values.length - 1) return current

    const start = Math.max(0, index - 2)
    const end = Math.min(values.length, index + 3)
    const neighbours = values.slice(start, end).filter((_, offset) => start + offset !== index)
    const baseline = median(neighbours)
    const medianDeviation = median(neighbours.map((value) => Math.abs(value - baseline)))
    const threshold = Math.max(100, baseline, medianDeviation * 6)
    const previous = values[index - 1]
    const next = values[index + 1]
    const isolated = current > baseline + threshold
      && previous <= baseline + threshold
      && next <= baseline + threshold

    return isolated ? baseline : current
  })
}

export function buildResponseTimeChartData(
  seriesList: readonly ResponseTimeSeries[],
  options: { smoothIsolatedSpikes?: boolean } = {},
): ResponseTimeChartRow[] {
  const rows = new Map<number, ResponseTimeChartRow>()
  for (const series of seriesList) {
    const samples = series.points
      .map((point) => ({ timestamp: Date.parse(point.timestamp), value: point.valueMs }))
      .filter((point) => Number.isFinite(point.timestamp))
      .sort((left, right) => left.timestamp - right.timestamp)
    const displayValues = options.smoothIsolatedSpikes
      ? smoothIsolatedResponseTimeSpikes(samples.map((point) => point.value))
      : undefined

    samples.forEach((sample, index) => {
      const { timestamp } = sample
      const row = rows.get(timestamp) ?? { timestamp }
      row[series.regionId] = sample.value
      if (displayValues) row[responseTimeDisplayKey(series.regionId)] = displayValues[index]
      rows.set(timestamp, row)
    })
  }
  return [...rows.values()].sort((left, right) => left.timestamp - right.timestamp)
}

export function formatResponseTimeTick(timestamp: number, range: string, locale = 'en') {
  const date = new Date(timestamp)
  if (range === '7d') {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatResponseTimeTooltipLabel(timestamp: number, range: string, locale: string) {
  const date = new Date(timestamp)
  if (range === '7d') {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(date)
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export function MonitorDetailPage({
  monitor: suppliedMonitor,
  responseTime: suppliedResponseTime,
  locationNames = {},
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
  const { t, locale } = useI18n()
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
  const leakIncident = monitor.type === 'leakcheck'
    ? incidents.find((incident) => incident.leakReport && incident.status !== 'resolved')
      ?? incidents.find((incident) => incident.leakReport)
      ?? incidents[0]
    : undefined
  const complianceIncident = monitor.type === 'compliance'
    ? incidents.find((incident) => incident.complianceReport && incident.status !== 'resolved')
      ?? incidents.find((incident) => incident.complianceReport)
      ?? incidents[0]
    : undefined
  const evidenceOnly = monitor.type === 'leakcheck' || monitor.type === 'compliance'
  const compliancePending = monitor.type === 'compliance' && !monitor.complianceReport && !monitor.lastCheckedAt
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
  const smoothChartSpikes = range === '1h' || range === '24h'
  const chartData = useMemo(
    () => buildResponseTimeChartData(activeResponseTime, { smoothIsolatedSpikes: smoothChartSpikes }),
    [activeResponseTime, smoothChartSpikes],
  )
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
    ? t('monitorDetail.allRegions')
    : selectedRegions.length === 1
      ? responseTime.find((series) => series.regionId === selectedRegions[0])?.regionLabel ?? t('monitorDetail.oneRegion')
      : t('monitorDetail.regionsCount', { count: selectedRegions.length })
  const exportFileName = `${monitor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'monitor'}-incidents.csv`
  const exportHref = `data:text/csv;charset=utf-8,${encodeURIComponent(incidentCsv(incidents))}`
  const mappedRegions = monitor.regions.map((region) => ({
    id: region,
    label: locationNames[region] ?? (region === 'local' ? 'Frankfurt' : region),
    color: responseTime.find((series) => series.regionId === region)?.color,
  }))

  const runAction = async (action: () => Promise<void>) => {
    setActionBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : t('monitorDetail.actionFailed'))
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
    if (!window.confirm(t('monitorDetail.deleteConfirm', { name: monitor.name }))) return
    void runAction(async () => {
      if (onDelete) await onDelete()
      else navigate('/monitors')
    })
  }

  const rotateHeartbeat = () => {
    if (!onRotateHeartbeat) return
    if (!window.confirm(t('monitorDetail.rotateConfirm'))) return
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
    return <div className="page page--wide monitor-detail-page"><PageLoadingSkeleton label={t('monitorDetail.loading')} rows={5} /></div>
  }

  if (error && !suppliedMonitor) {
    return <div className="page page--wide monitor-detail-page"><Link to="/monitors" className="back-link"><ArrowLeft size={17} /> {t('nav.monitoring')}</Link><Panel><EmptyState icon={<ShieldCheck size={34} />} title={t('monitorDetail.loadFailed')} description={error} action={onRetry ? <Button onClick={onRetry}>{t('common.tryAgain')}</Button> : undefined} /></Panel></div>
  }

  return (
    <div className="page page--wide monitor-detail-page">
      <Link to="/monitors" className="back-link"><ArrowLeft size={17} /> {t('nav.monitoring')}</Link>
      <header className="monitor-detail-header">
        <div className={`monitor-detail-header__state monitor-detail-header__state--${compliancePending ? 'checking' : paused ? 'paused' : monitor.status}`}><StatusDot status={compliancePending ? 'checking' : paused ? 'paused' : monitor.status} /></div>
        <div className="monitor-detail-header__identity">
          <h1>{monitor.name}<span className="title-dot">.</span></h1>
          <p>{t('monitorDetail.monitorFor', { type: monitor.typeLabel })} {monitor.target.startsWith('http') ? <a href={monitor.target}>{monitor.target} <ExternalLink size={14} /></a> : <span>{monitor.target}</span>}</p>
          <div>{monitor.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
          {actionError && <small className="danger-text" role="alert">{actionError}</small>}
        </div>
        <div className="monitor-detail-header__actions">
          {monitor.type === 'heartbeat' && onRotateHeartbeat && <Button variant="secondary" disabled={actionBusy} onClick={rotateHeartbeat}><KeyRound size={17} /> {t('monitorDetail.rotateUrl')}</Button>}
          {(manualTestEnabled || monitor.type === 'leakcheck') && <Button variant="secondary" disabled={actionBusy} onClick={testNotification}>{monitor.type === 'leakcheck' ? <ShieldAlert size={17} /> : monitor.type === 'compliance' ? <Scale size={17} /> : <BellRing size={17} />} {notificationSent ? t('monitorDetail.testComplete') : monitor.type === 'leakcheck' ? t('monitorDetail.scanLeaks') : monitor.type === 'compliance' ? t('monitorDetail.runComplianceReview') : t('monitorDetail.test')}</Button>}
          <Button variant="secondary" disabled={actionBusy} onClick={togglePause}>{paused ? <PlayCircle size={17} /> : <PauseCircle size={17} />}{paused ? t('common.resume') : t('common.pause')}</Button>
          <Link className="button button--secondary button--md" to={`/monitors/${monitor.id}/edit`}><Pencil size={17} /> {t('common.edit')}</Link>
          <div className="monitor-detail-actions-menu" ref={actionMenuRef}>
            <IconButton label={t('monitorDetail.moreActions', { name: monitor.name })} aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)}><MoreVertical size={19} /></IconButton>
            {actionsOpen && <div className="monitor-action-menu" role="menu">
              <Link to={`/monitors/${monitor.id}/edit`} role="menuitem"><Pencil size={15} /> {t('monitorDetail.editMonitor')}</Link>
              {manualTestEnabled && <button type="button" role="menuitem" onClick={testNotification}>{monitor.type === 'compliance' ? <Scale size={15} /> : <BellRing size={15} />} {monitor.type === 'compliance' ? t('monitorDetail.runComplianceReview') : t('monitorDetail.runTest')}</button>}
              <button type="button" role="menuitem" onClick={togglePause}>{paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />}{paused ? t('monitorDetail.resumeMonitor') : t('monitorDetail.pauseMonitor')}</button>
              <button type="button" role="menuitem" onClick={() => void copyTarget()}><Copy size={15} /> {t('monitorDetail.copyTarget')}</button>
              <button type="button" role="menuitem" onClick={exportLogs}><Download size={15} /> {t('monitorDetail.exportIncidentLog')}</button>
              <button type="button" role="menuitem" className="monitor-action-menu__danger" onClick={deleteMonitor}><Trash2 size={15} /> {t('monitorDetail.deleteMonitor')}</button>
            </div>}
          </div>
        </div>
      </header>

      <div className="monitor-detail-grid">
        <div className="monitor-detail-main">
          <div className="monitor-kpis">
            <Panel className={compliancePending ? 'monitor-kpis__pending' : undefined}><span>{t('monitorDetail.currentStatus')}</span><strong className={compliancePending ? 'checking-text' : paused ? 'muted' : monitor.status === 'up' ? 'success-text' : 'danger-text'}>{compliancePending ? <><LoaderCircle size={22} />{t('monitorDetail.scanInProgress')}</> : paused ? formatStatus('paused') : monitor.type === 'leakcheck' ? (monitor.status === 'down' ? t('monitorDetail.exposureFound') : monitor.status === 'up' ? t('monitorDetail.noExposure') : formatStatus(monitor.status)) : monitor.type === 'compliance' ? (monitor.status === 'up' ? t('monitorDetail.compliant') : t('monitorDetail.complianceIssues')) : formatStatus(monitor.status)}</strong><small>{compliancePending ? t('monitorDetail.firstScanRunning') : monitor.statusChangedAt ? t('monitorDetail.since', { time: formatRelativeTime(monitor.statusChangedAt, clock) }) : t('monitorDetail.awaitingFirst')}</small></Panel>
            <Panel className="monitor-kpis__last-check"><span>{monitor.type === 'leakcheck' ? t('monitorDetail.lastScan') : monitor.type === 'compliance' ? t('monitorDetail.lastReview') : t('monitorDetail.lastCheck')}</span><strong>{compliancePending ? <LoaderCircle className="compliance-scan-spinner" size={25} /> : formatCheckAgeSeconds(monitor.lastCheckedAt, clock)}</strong>{compliancePending ? <small>{t('monitorDetail.scanStageCrawl')}</small> : refreshing ? <small>{t('monitorDetail.refreshing')}</small> : monitor.type !== 'leakcheck' ? <small>{t('monitorDetail.checkedEvery', { interval: formatDuration(monitor.intervalSeconds) })}</small> : null}</Panel>
            {monitor.type === 'leakcheck' ? <Panel className="monitor-kpis__uptime monitor-kpis__leak-summary"><div><span>{t('monitorDetail.exposureStatus')}</span><strong className={monitor.leakReport?.found ? 'danger-text' : 'success-text'}>{monitor.leakReport?.found ?? '—'}</strong></div><small>{monitor.leakReport ? t('monitorDetail.sourcesCount', { count: monitor.leakReport.sources.length }) : t('monitorDetail.awaitingFirst')}</small>{leakIncident && <Link className="leakcheck-incident-link" to={`/incidents?incident=${encodeURIComponent(leakIncident.id)}`}><ShieldAlert size={16} /> {t('monitorDetail.openLeakIncident')}</Link>}</Panel> : monitor.type === 'compliance' ? <Panel className="monitor-kpis__uptime monitor-kpis__compliance-summary"><div><span>{t('monitorDetail.legalReviewResult')}</span><strong className={monitor.complianceReport?.summary.failed ? 'danger-text' : 'success-text'}>{monitor.complianceReport ? (monitor.complianceReport.summary.failed || t('monitorDetail.noViolations')) : compliancePending ? t('monitorDetail.pendingResult') : '—'}</strong></div><small>{monitor.complianceReport ? t('monitorDetail.manualReviewCount', { count: monitor.complianceReport.summary.manual }) : compliancePending ? t('monitorDetail.resultAfterScan') : t('monitorDetail.noComplianceReport')}</small>{complianceIncident && <Link className="compliance-incident-link" to={`/incidents?incident=${encodeURIComponent(complianceIncident.id)}`}><Scale size={16} /> {t('monitorDetail.openComplianceIncident')}</Link>}</Panel> : <Panel className="monitor-kpis__uptime"><div><span>{t('monitorDetail.last24h')}</span><strong>{formatUptime(monitor.uptime24h)}</strong></div><UptimeBars values={uptimeValues} /><small>{t('monitorDetail.incidentsPeriod', { count: incidents.length })}</small></Panel>}
          </div>

          {compliancePending && <Panel className="compliance-scan-progress"><div className="compliance-scan-progress__heading" role="status" aria-live="polite"><span className="compliance-scan-progress__icon"><LoaderCircle size={22} /></span><div><strong>{t('monitorDetail.scanStageCrawl')}</strong><small>{t('monitorDetail.scanStageHint')}</small></div></div><div className="compliance-scan-progress__track"><span /></div><div className="compliance-scan-progress__steps"><span className="is-active">1 · {t('monitorDetail.scanStageConnect')}</span><span className="is-active">2 · {t('monitorDetail.scanStagePages')}</span><span>3 · {t('monitorDetail.scanStageAnalyze')}</span><span>4 · {t('monitorDetail.scanStageReport')}</span></div></Panel>}

          {!evidenceOnly && <Panel className="uptime-periods">
            {uptimePeriods.map((period) => <div key={period.period}><span>{t('monitorDetail.lastPeriod', { period: period.period })}</span><strong className={period.uptime >= 99.9 ? 'success-text' : 'warning-text'}>{formatUptime(period.uptime)}</strong><small>{t('monitorDetail.periodIncidentSummary', { count: period.incidentCount, downtime: formatDuration(period.downtimeSeconds) })}</small></div>)}
            <div><span>MTBF</span><strong className="success-text">{mtbfSeconds === undefined ? '—' : formatDuration(mtbfSeconds)}</strong><small>{t('monitorDetail.mtbfHint')}</small></div>
          </Panel>}

          {!evidenceOnly && <Panel className="response-chart-panel">
            <header className="panel__header"><h2>{t('monitorDetail.responseTimeFor')} <span className="region-picker" ref={regionMenuRef}><button type="button" className="region-picker__trigger" aria-haspopup="menu" aria-expanded={regionsOpen} onClick={() => setRegionsOpen((open) => !open)}>{regionLabel}<ChevronDown className="dropdown-chevron" size={16} aria-hidden="true" /></button>{regionsOpen && <span className="region-picker__menu" role="menu">{responseTime.map((series) => <button type="button" role="menuitemcheckbox" aria-checked={selectedRegions.includes(series.regionId)} key={series.regionId} onClick={() => toggleRegion(series.regionId)}><span className="region-picker__swatch" style={{ background: series.color }} /><span>{series.regionLabel}</span>{selectedRegions.includes(series.regionId) && <Check size={15} />}</button>)}</span>}</span></h2><div><Button size="sm" variant="secondary" onClick={() => setResponseAlertOpen(true)}><Gauge size={15} />{monitor.slowThresholdMs ? t('monitorDetail.alertAt', { threshold: monitor.slowThresholdMs }) : t('monitorDetail.setResponseAlert')}</Button><Select value={range} onChange={(event) => { setRange(event.target.value); onRangeChange?.(event.target.value) }}><option value="1h">{t('monitorDetail.lastHour')}</option><option value="24h">{t('monitorDetail.last24h')}</option><option value="7d">{t('monitorDetail.last7d')}</option></Select></div></header>
            <div className="response-chart">
              {chartData.length ? <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 15, right: 18, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke="#2b374a" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(timestamp) => formatResponseTimeTick(Number(timestamp), range, locale)} stroke="#6f829e" tickLine={false} axisLine={false} minTickGap={range === '7d' ? 28 : 45} fontSize={11} />
                  <YAxis stroke="#6f829e" tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={(value) => `${value}ms`} />
                  <Tooltip
                    labelFormatter={(timestamp) => formatResponseTimeTooltipLabel(Number(timestamp), range, locale)}
                    formatter={(value, name, item) => {
                      const dataKey = String(item.dataKey ?? '')
                      const rawKey = dataKey.startsWith(RESPONSE_TIME_DISPLAY_PREFIX)
                        ? dataKey.slice(RESPONSE_TIME_DISPLAY_PREFIX.length)
                        : dataKey
                      const rawValue = (item.payload as ResponseTimeChartRow | undefined)?.[rawKey]
                      return [`${Math.round(Number(rawValue ?? value))} ms`, name]
                    }}
                    contentStyle={{ background: '#101925', border: '1px solid #354158', borderRadius: 10 }}
                  />
                  {activeResponseTime.map((series) => <Line key={series.regionId} dataKey={smoothChartSpikes ? responseTimeDisplayKey(series.regionId) : series.regionId} name={series.regionLabel} type="monotone" stroke={series.color} dot={false} strokeWidth={2} connectNulls />)}
                </LineChart>
              </ResponsiveContainer> : <div className="latest-incidents__empty"><span>{t('monitorDetail.noResponseSamples')}</span></div>}
            </div>
            <footer className="response-chart__stats">
              <div><span><Settings2 size={17} /> {t('monitorDetail.average')}</span><strong>{averageLatency} ms</strong></div>
              <div><span><ArrowDownToLine size={17} /> {t('monitorDetail.fastest')}</span><strong className="success-text">{minimumLatency} ms</strong></div>
              <div><span><ArrowUpFromLine size={17} /> {t('monitorDetail.slowest')}</span><strong className="danger-text">{maximumLatency} ms</strong></div>
            </footer>
          </Panel>}

          {monitor.type === 'compliance' && monitor.status === 'up' && monitor.complianceReport && monitor.complianceReport.summary.failed === 0 && <Panel><ComplianceManualChecklist report={monitor.complianceReport} /></Panel>}

          <Panel className="latest-incidents">
            <header className="panel__header"><h2>{t('monitorDetail.latestIncidents')}<span className="title-dot">.</span></h2>{onExportLogs ? <Button variant="secondary" size="sm" onClick={onExportLogs}><Download size={15} /> {t('monitorDetail.exportLogs')}</Button> : <a ref={exportLinkRef} className="button button--secondary button--sm" href={exportHref} download={exportFileName}><Download size={15} /> {t('monitorDetail.exportLogs')}</a>}</header>
            {incidents.length ? incidents.map((incident) => <div className="latest-incidents__row" key={incident.id}><span><StatusDot status={incident.status} /><strong className={incident.status === 'resolved' ? 'success-text' : 'warning-text'}>{formatStatus(incident.status)}</strong></span><span>{incident.rootCause}</span><span>{formatDate(incident.startedAt)}</span><span>{formatDuration(incident.durationSeconds)}</span></div>) : <div className="latest-incidents__empty"><ShieldCheck size={27} /><span>{t('monitorDetail.noIncidents')}</span></div>}
          </Panel>
        </div>

        <aside className="monitor-detail-side">
          {!evidenceOnly && <Panel className="side-card domain-card"><h2>{t('monitorDetail.domainSsl')}<span className="title-dot">.</span></h2>{monitor.domainRegistration ? <div><span>{t('monitorDetail.domainValidUntil')}</span><strong><ShieldCheck size={19} /> {formatDate(monitor.domainRegistration.expiresAt, { includeYear: true })}</strong></div> : <p className="muted">{t('monitorDetail.noDomainEvidence')}</p>}{monitor.sslCertificate ? <div><span>{t('monitorDetail.sslValidUntil')}</span><strong><ShieldCheck size={19} /> {formatDate(monitor.sslCertificate.expiresAt, { includeYear: true })}</strong><small>{monitor.sslCertificate.issuer}</small></div> : null}</Panel>}
          <Panel className="side-card"><h2>{t('monitorDetail.nextMaintenance')}<span className="title-dot">.</span></h2><CalendarDays size={26} className="side-card__feature-icon" />{nextMaintenance ? <div className="side-card__resource"><strong>{nextMaintenance.name}</strong><span>{formatDate(nextMaintenance.startsAt)}</span><small>{formatDuration(nextMaintenance.durationMinutes * 60)} · {nextMaintenance.timezone}</small></div> : <p>{suppliedMonitor ? t('monitorDetail.noMaintenance') : demoMaintenanceWindows[1]?.name ?? t('monitorDetail.noMaintenance')}</p>}<Button variant="secondary" size="sm" onClick={() => navigate(`/maintenance?create=1&monitor=${encodeURIComponent(monitor.id)}`)}>{t('monitorDetail.setupMaintenance')}</Button></Panel>
          <Panel className="side-card region-card"><h2>{t('monitorDetail.regions')}<span className="title-dot">.</span></h2><RegionMap regions={mappedRegions} label={t('monitorDetail.monitoringRegions')} /></Panel>
          <Panel className="side-card"><h2>{t('monitorDetail.toBeNotified')}<span className="title-dot">.</span></h2>{notifications.length ? <div className="side-card__resource-list">{notifications.slice(0, 3).map((integration) => <div key={integration.id}><BellRing size={16} /><span><strong>{integration.name}</strong><small>{integration.destinationLabel}</small></span></div>)}</div> : <div className="notification-logos"><span>—</span></div>}<Button variant="secondary" size="sm" onClick={() => navigate(`/integrations?monitor=${encodeURIComponent(monitor.id)}`)}>{t('monitorDetail.manageNotifications')}</Button></Panel>
		  {!evidenceOnly && <Panel className="side-card"><h2>{t('monitorDetail.appearsOn')}<span className="title-dot">.</span></h2>{statusPages.length ? <div className="side-card__resource-list">{statusPages.slice(0, 3).map((page) => <div key={page.id}><RadioTower size={16} /><span><strong>{page.name}</strong><small>{formatStatus(page.status)}</small></span></div>)}</div> : <><RadioTower size={25} className="side-card__feature-icon" /><p>{suppliedMonitor ? t('monitorDetail.notOnStatusPage') : t('monitorDetail.systemStatus')}</p></>}<Button variant="secondary" size="sm" onClick={() => navigate(`/status-pages?create=1&monitor=${encodeURIComponent(monitor.id)}`)}>{t('monitorDetail.manageStatusPages')}</Button></Panel>}
        </aside>
      </div>

      <Modal open={responseAlertOpen} onClose={() => setResponseAlertOpen(false)} title={t('monitorDetail.responseAlert')} icon={<Gauge size={36} />} width="sm">
        <form className="response-alert-form" onSubmit={saveResponseAlert}>
          <div className="response-alert-toggle"><div><strong>{t('monitorDetail.slowAlert')}</strong><span>{t('monitorDetail.slowAlertHint')}</span></div><Toggle checked={responseAlertEnabled} onChange={setResponseAlertEnabled} label={t('monitorDetail.slowAlert')} /></div>
          <Field label={t('monitorDetail.responseThreshold')} hint={t('monitorDetail.responseThresholdHint')}><div className="input-with-suffix"><input type="number" min={100} max={120000} step={100} disabled={!responseAlertEnabled} value={responseThresholdMs} onChange={(event) => setResponseThresholdMs(Number(event.target.value))} required={responseAlertEnabled} /><span>ms</span></div></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setResponseAlertOpen(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={actionBusy}>{actionBusy ? t('common.saving') : t('monitorDetail.saveAlert')}</Button></div>
        </form>
      </Modal>
      {heartbeatCredential && <HeartbeatCredentialModal credential={heartbeatCredential} onClose={() => setHeartbeatCredential(null)} />}
    </div>
  )
}
