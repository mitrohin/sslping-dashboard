import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BellRing,
  ExternalLink,
  RadioTower,
  Settings2,
  ShieldCheck,
  Unlink,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ApiClient } from '../../api/client'
import type {
  Integration,
  IntegrationEvent,
  MonitorSubscriptionDetail,
} from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { useI18n } from '../../app/I18nProvider'
import { UptimeBars } from '../../components/UptimeBars'
import { Badge, Button, FeedbackBanner, PageLoadingSkeleton, Panel, StatusDot, Toggle } from '../../components/ui'
import { formatDate, formatDuration, formatRelativeTime, formatStatus, formatUptime } from '../../lib/format'
import { RegionMap } from '../monitors/RegionMap'
import {
  subscriptionDailyResponseTimeSeries,
  toSubscribedIncidentViewModel,
  toSubscribedMonitorViewModel,
} from './adapters'
import '../monitors/monitors.css'
import './subscriptions.css'

const notificationEvents: readonly IntegrationEvent[] = [
  'monitor.down',
  'monitor.up',
  'monitor.slow',
  'ssl.expiry',
  'domain.expiry',
  'incident.updated',
]

const uptimePeriodKeys = ['24h', '7d', '30d', '365d'] as const

export type SubscribedMonitorApi = Pick<
  ApiClient,
  | 'getMonitorSubscription'
  | 'listIntegrations'
  | 'updateMonitorSubscriptionNotifications'
  | 'deleteMonitorSubscription'
>

interface DetailState {
  detail: MonitorSubscriptionDetail
  integrations: readonly Integration[]
}

function responseTick(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(timestamp)
}

function formatCheckAgeSeconds(value: string | undefined, now: number): string {
  if (!value) return '—'
  const checkedAt = Date.parse(value)
  if (!Number.isFinite(checkedAt)) return '—'
  return `${Math.max(0, Math.floor((now - checkedAt) / 1_000))}s`
}

function subscriptionError(value: unknown): string {
  return value instanceof Error ? value.message : 'The followed monitor could not be loaded.'
}

export function SubscribedMonitorDetailPage({ api: apiOverride }: { api?: SubscribedMonitorApi } = {}) {
  const auth = useAuth()
  const api = apiOverride ?? auth.api
  const { subscriptionId } = useParams()
  const navigate = useNavigate()
  const { locale, t } = useI18n()
  const canManageIntegrations = auth.workspaceRole === 'owner' || auth.workspaceRole === 'admin' || auth.workspaceRole === 'editor'
  const [state, setState] = useState<DetailState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [events, setEvents] = useState<Set<IntegrationEvent>>(() => new Set())
  const [integrationIds, setIntegrationIds] = useState<Set<string>>(() => new Set())
  const [clock, setClock] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (!auth.workspace || !subscriptionId) {
      setError(t('subscriptions.detailMissing'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [detail, integrationList] = await Promise.all([
        api.getMonitorSubscription(auth.workspace.id, subscriptionId),
        canManageIntegrations ? api.listIntegrations(auth.workspace.id) : Promise.resolve({ items: [] }),
      ])
      setState({ detail, integrations: integrationList.items ?? [] })
      setEmailEnabled(detail.item.email_enabled)
      setEvents(new Set(detail.item.events ?? []))
      setIntegrationIds(new Set(detail.item.integration_ids ?? []))
    } catch (cause) {
      setError(subscriptionError(cause))
    } finally {
      setLoading(false)
    }
  }, [api, auth.workspace, canManageIntegrations, subscriptionId, t])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!state || window.location.hash !== '#notifications') return
    window.requestAnimationFrame(() => document.getElementById('notifications')?.scrollIntoView({ block: 'start' }))
  }, [state])

  const monitor = useMemo(
    () => state ? toSubscribedMonitorViewModel(state.detail.item) : null,
    [state],
  )
  const responseSeries = useMemo(
    () => subscriptionDailyResponseTimeSeries(state?.detail.history ?? state?.detail.item.history ?? []),
    [state],
  )
  const incidents = useMemo(
    () => (state?.detail.incidents ?? []).map((incident) => toSubscribedIncidentViewModel(incident, clock)),
    [clock, state],
  )
  const chartData = useMemo(() => {
    const rows = new Map<number, { timestamp: number; [region: string]: number }>()
    responseSeries.forEach((series) => series.points.forEach((point) => {
      const timestamp = Date.parse(point.timestamp)
      if (!Number.isFinite(timestamp)) return
      const row = rows.get(timestamp) ?? { timestamp }
      row[series.regionId] = point.valueMs
      rows.set(timestamp, row)
    }))
    return [...rows.values()].sort((left, right) => left.timestamp - right.timestamp)
  }, [responseSeries])
  const responseValues = useMemo(
    () => responseSeries.flatMap((series) => series.points.map((point) => point.valueMs)),
    [responseSeries],
  )

  const toggleEvent = (event: IntegrationEvent) => {
    setEvents((current) => {
      const next = new Set(current)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }

  const toggleIntegration = (integrationId: string) => {
    setIntegrationIds((current) => {
      const next = new Set(current)
      if (next.has(integrationId)) next.delete(integrationId)
      else next.add(integrationId)
      return next
    })
  }

  const saveNotifications = async (event: FormEvent) => {
    event.preventDefault()
    if (!auth.workspace || !subscriptionId) return
    setBusy(true)
    setFeedback(null)
    try {
      await api.updateMonitorSubscriptionNotifications(auth.workspace.id, subscriptionId, {
        events: [...events],
        email_enabled: emailEnabled,
        ...(canManageIntegrations ? { integration_ids: [...integrationIds] } : {}),
      })
      setFeedback({ tone: 'success', message: t('subscriptions.notificationsSaved') })
    } catch (cause) {
      setFeedback({ tone: 'error', message: subscriptionError(cause) })
    } finally {
      setBusy(false)
    }
  }

  const unsubscribe = async () => {
    if (!auth.workspace || !subscriptionId || !monitor) return
    if (!window.confirm(t('subscriptions.confirmUnsubscribe', { name: monitor.name }))) return
    setBusy(true)
    setFeedback(null)
    try {
      await api.deleteMonitorSubscription(auth.workspace.id, subscriptionId)
      navigate('/monitors', { replace: true })
    } catch (cause) {
      setFeedback({ tone: 'error', message: subscriptionError(cause) })
      setBusy(false)
    }
  }

  if (loading) return <div className="page page--wide monitor-detail-page subscription-detail"><PageLoadingSkeleton label={t('subscriptions.loadingDetail')} rows={5} /></div>
  if (error || !state || !monitor) {
    return <div className="page page--wide monitor-detail-page subscription-detail"><Link to="/monitors" className="back-link"><ArrowLeft size={17} /> {t('nav.monitoring')}</Link><Panel><FeedbackBanner tone="error" action={<Button variant="secondary" size="sm" type="button" onClick={() => void load()}>{t('common.tryAgain')}</Button>}>{error || t('subscriptions.detailMissing')}</FeedbackBanner></Panel></div>
  }

  const latestStats = state.detail.item.stats
  const uptimeHistory = monitor.last24Hours
  const uptimeTitles = uptimeHistory.map((hour) => `${formatDate(hour.startedAt)} · ${formatStatus(hour.status)}`)
  const periodStats = new Map(state.detail.periods.map((period) => [period.period, period.stats]))
  const mtbfSeconds = periodStats.get('365d')?.mtbf_seconds ?? latestStats?.mtbf_seconds
  const averageLatency = responseValues.length
    ? Math.round(responseValues.reduce((total, value) => total + value, 0) / responseValues.length)
    : undefined
  const minimumLatency = responseValues.length ? Math.round(Math.min(...responseValues)) : undefined
  const maximumLatency = responseValues.length ? Math.round(Math.max(...responseValues)) : undefined
  const statusClass = monitor.status === 'up'
    ? 'success-text'
    : monitor.status === 'down'
      ? 'danger-text'
      : 'warning-text'
  const mappedRegions = monitor.regions.map((region) => ({
    id: region,
    label: responseSeries.find((series) => series.regionId === region)?.regionLabel ?? region,
    color: responseSeries.find((series) => series.regionId === region)?.color,
  }))
  const selectedIntegrations = state.integrations.filter((integration) => integrationIds.has(integration.id))

  return (
    <div className="page page--wide monitor-detail-page subscription-detail">
      <Link to="/monitors" className="back-link"><ArrowLeft size={17} /> {t('nav.monitoring')}</Link>

      <header className="monitor-detail-header">
        <div className={`monitor-detail-header__state monitor-detail-header__state--${monitor.status}`}><StatusDot status={monitor.status} /></div>
        <div className="monitor-detail-header__identity">
          <h1>{monitor.name}<span className="title-dot">.</span></h1>
          <p><span className="subscription-detail__monitor-label">{t('monitorDetail.monitorFor', { type: monitor.typeLabel })}</span> {monitor.target ? (monitor.target.startsWith('http') ? <a href={monitor.target} target="_blank" rel="noreferrer">{monitor.target} <ExternalLink size={14} /></a> : <span>{monitor.target}</span>) : <span>{t('subscriptions.targetHidden')}</span>}</p>
          <div><Badge tone="info">{t('subscriptions.readOnly')}</Badge><Badge>{state.detail.item.page_name}</Badge></div>
        </div>
        <div className="monitor-detail-header__actions subscription-detail__actions">
          <a className="button button--secondary button--md" href="#notifications"><BellRing size={17} /> {t('subscriptions.notifications')}</a>
          <Button variant="danger" type="button" disabled={busy} onClick={() => void unsubscribe()}><Unlink size={17} /> {t('subscriptions.unsubscribe')}</Button>
        </div>
      </header>

      {feedback && <div className="subscription-detail__feedback"><FeedbackBanner tone={feedback.tone} onDismiss={() => setFeedback(null)}>{feedback.message}</FeedbackBanner></div>}

      <div className="monitor-detail-grid">
        <div className="monitor-detail-main">
          <section className="monitor-kpis" aria-label={t('subscriptions.safeSummary')}>
            <Panel><span>{t('monitorDetail.currentStatus')}</span><strong className={statusClass}>{formatStatus(monitor.status)}</strong><small>{monitor.statusChangedAt ? t('monitorDetail.since', { time: formatRelativeTime(monitor.statusChangedAt, clock) }) : t('monitorDetail.awaitingFirst')}</small></Panel>
            <Panel className="monitor-kpis__last-check"><span>{t('monitorDetail.lastCheck')}</span><strong>{formatCheckAgeSeconds(monitor.lastCheckedAt, clock)}</strong><small>{t('monitorDetail.checkedEvery', { interval: formatDuration(monitor.intervalSeconds) })}</small></Panel>
            <Panel className="monitor-kpis__uptime"><div><span>{t('monitorDetail.last24h')}</span><strong>{formatUptime(monitor.uptime24h)}</strong></div><UptimeBars label={t('monitors.hourlyChecks')} values={uptimeHistory.map((hour) => hour.status === 'up' ? 100 : hour.status === 'down' ? 0 : hour.status === 'degraded' ? 98 : null)} titles={uptimeTitles} /><small>{t('monitorDetail.incidentsPeriod', { count: monitor.incidentCount24h ?? incidents.length })}</small></Panel>
          </section>

          <Panel className="uptime-periods">
            {uptimePeriodKeys.map((period) => {
              const stats = periodStats.get(period)
              return <div key={period}><span>{t('monitorDetail.lastPeriod', { period })}</span><strong className={stats ? stats.availability >= 99.9 ? 'success-text' : 'warning-text' : undefined}>{stats ? formatUptime(stats.availability) : '—'}</strong><small>{stats ? t('monitorDetail.periodIncidentSummary', { count: stats.incidents, downtime: formatDuration(stats.downtime_seconds) }) : t('subscriptions.noPeriodData')}</small></div>
            })}
            <div><span>MTBF</span><strong className="success-text">{mtbfSeconds === undefined ? '—' : formatDuration(mtbfSeconds)}</strong><small>{t('monitorDetail.mtbfHint')}</small></div>
          </Panel>

          <Panel className="response-chart-panel">
            <header className="panel__header"><div><h2>{t('monitorDetail.responseTimeFor')} <span className="subscription-detail__chart-region">{t('monitorDetail.allRegions')}</span></h2><p>{t('subscriptions.responseTimeHint')}</p></div><Badge>{t('subscriptions.aggregated')}</Badge></header>
            <div className="response-chart">
              {chartData.length ? <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 15, right: 18, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke="#2b374a" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(timestamp) => responseTick(Number(timestamp), locale)} stroke="#6f829e" tickLine={false} axisLine={false} minTickGap={28} fontSize={11} />
                  <YAxis stroke="#6f829e" tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={(value) => `${value}ms`} />
                  <Tooltip labelFormatter={(value) => formatDate(Number(value), { includeSeconds: false })} formatter={(value, name) => [`${Math.round(Number(value))} ms`, name]} contentStyle={{ background: '#101925', border: '1px solid #354158', borderRadius: 10 }} />
                  {responseSeries.map((series) => <Line key={series.regionId} type="monotone" dataKey={series.regionId} name={series.regionLabel} stroke={series.color} strokeWidth={2} dot={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer> : <div className="latest-incidents__empty"><span>{t('subscriptions.noResponseData')}</span></div>}
            </div>
            <footer className="response-chart__stats">
              <div><span><Settings2 size={17} /> {t('monitorDetail.average')}</span><strong>{averageLatency === undefined ? '—' : `${averageLatency} ms`}</strong></div>
              <div><span><ArrowDownToLine size={17} /> {t('monitorDetail.fastest')}</span><strong className="success-text">{minimumLatency === undefined ? '—' : `${minimumLatency} ms`}</strong></div>
              <div><span><ArrowUpFromLine size={17} /> {t('monitorDetail.slowest')}</span><strong className="danger-text">{maximumLatency === undefined ? '—' : `${maximumLatency} ms`}</strong></div>
            </footer>
          </Panel>

          <Panel className="latest-incidents">
            <header className="panel__header subscription-detail__incidents-header"><div><h2>{t('monitorDetail.latestIncidents')}<span className="title-dot">.</span></h2><p>{t('subscriptions.safeIncidentsHint')}</p></div><Badge>{incidents.length}</Badge></header>
            {incidents.length ? incidents.map((incident) => <div className="latest-incidents__row" key={incident.id}><span><StatusDot status={incident.status} /><strong className={incident.status === 'resolved' ? 'success-text' : 'warning-text'}>{formatStatus(incident.status)}</strong></span><span>{incident.rootCause}</span><span>{formatDate(incident.startedAt)}</span><span>{formatDuration(incident.durationSeconds)}</span></div>) : <div className="latest-incidents__empty"><ShieldCheck size={27} /><span>{t('subscriptions.noIncidents')}</span></div>}
          </Panel>

          <section id="notifications" className="subscription-detail__notifications-anchor">
            <Panel className="subscription-detail__notifications">
              <div className="subscription-detail__section-title"><div><h2><BellRing size={20} /> {t('subscriptions.notifications')}</h2><p>{t('subscriptions.notificationsHint')}</p></div></div>
              <form onSubmit={saveNotifications}>
                <label className="subscription-detail__toggle"><span><strong>{t('subscriptions.emailNotifications')}</strong><small>{t('subscriptions.emailNotificationsHint')}</small></span><Toggle checked={emailEnabled} onChange={setEmailEnabled} label={t('subscriptions.emailNotifications')} /></label>

                <fieldset>
                  <legend>{t('subscriptions.events')}</legend>
                  <div className="subscription-detail__choices">{notificationEvents.map((notificationEvent) => <label key={notificationEvent}><input type="checkbox" checked={events.has(notificationEvent)} onChange={() => toggleEvent(notificationEvent)} /><span>{t(`subscriptions.event.${notificationEvent}`)}</span></label>)}</div>
                </fieldset>

                <fieldset>
                  <legend>{t('subscriptions.integrations')}</legend>
                  {!canManageIntegrations && <p className="subscription-detail__permission-note">{t('subscriptions.integrationsEditorOnly')}</p>}
                  {state.integrations.length ? <div className="subscription-detail__choices">{state.integrations.map((integration) => <label key={integration.id} className={!integration.active || !canManageIntegrations ? 'is-disabled' : ''}><input type="checkbox" checked={integrationIds.has(integration.id)} disabled={!integration.active || !canManageIntegrations} onChange={() => toggleIntegration(integration.id)} /><span>{integration.name}<small>{integration.type}</small></span></label>)}</div> : <p className="subscription-detail__empty">{t('subscriptions.noIntegrations')} {canManageIntegrations && <Link to="/integrations">{t('subscriptions.addIntegration')} <ExternalLink size={13} /></Link>}</p>}
                </fieldset>

                <Button type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Button>
              </form>
            </Panel>
          </section>
        </div>

        <aside className="monitor-detail-side">
          <Panel className="side-card subscription-detail__source-card"><h2>{t('subscriptions.sourceStatusPage')}<span className="title-dot">.</span></h2><RadioTower size={27} className="side-card__feature-icon" /><div className="side-card__resource"><strong>{state.detail.item.page_name}</strong></div><p>{t('subscriptions.sharedDataHint')}</p></Panel>
          <Panel className="side-card region-card"><h2>{t('monitorDetail.regions')}<span className="title-dot">.</span></h2>{mappedRegions.length ? <RegionMap regions={mappedRegions} label={t('monitorDetail.monitoringRegions')} /> : <p>{t('subscriptions.noRegions')}</p>}</Panel>
          <Panel className="side-card"><h2>{t('monitorDetail.toBeNotified')}<span className="title-dot">.</span></h2>{emailEnabled || selectedIntegrations.length ? <div className="side-card__resource-list">{emailEnabled && <div><BellRing size={16} /><span><strong>{t('subscriptions.emailNotifications')}</strong><small>{t('subscriptions.eventsSelected', { count: events.size })}</small></span></div>}{selectedIntegrations.map((integration) => <div key={integration.id}><BellRing size={16} /><span><strong>{integration.name}</strong><small>{integration.type}</small></span></div>)}</div> : <div className="notification-logos"><span>—</span></div>}<a className="button button--secondary button--sm" href="#notifications">{t('monitorDetail.manageNotifications')}</a></Panel>
        </aside>
      </div>
    </div>
  )
}

export default SubscribedMonitorDetailPage
