import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, BellRing, Clock3, ExternalLink, Unlink } from 'lucide-react'
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
import { formatDate, formatDuration, formatStatus, formatUptime } from '../../lib/format'
import { subscriptionDailyResponseTimeSeries, toSubscribedMonitorViewModel } from './adapters'
import './subscriptions.css'

const notificationEvents: readonly IntegrationEvent[] = [
  'monitor.down',
  'monitor.up',
  'monitor.slow',
  'ssl.expiry',
  'domain.expiry',
  'incident.updated',
]

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

function responseTick(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function subscriptionError(value: unknown): string {
  return value instanceof Error ? value.message : 'The followed monitor could not be loaded.'
}

export function SubscribedMonitorDetailPage({ api: apiOverride }: { api?: SubscribedMonitorApi } = {}) {
  const auth = useAuth()
  const api = apiOverride ?? auth.api
  const { subscriptionId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const canManageIntegrations = auth.workspaceRole === 'owner' || auth.workspaceRole === 'admin' || auth.workspaceRole === 'editor'
  const [state, setState] = useState<DetailState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [events, setEvents] = useState<Set<IntegrationEvent>>(() => new Set())
  const [integrationIds, setIntegrationIds] = useState<Set<string>>(() => new Set())

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

  if (loading) return <main className="page page--wide subscription-detail"><PageLoadingSkeleton label={t('subscriptions.loadingDetail')} rows={5} /></main>
  if (error || !state || !monitor) {
    return <main className="page page--wide subscription-detail"><Panel><FeedbackBanner tone="error" action={<Button variant="secondary" size="sm" type="button" onClick={() => void load()}>{t('common.tryAgain')}</Button>}>{error || t('subscriptions.detailMissing')}</FeedbackBanner></Panel></main>
  }

  const latestStats = state.detail.item.stats
  const uptimeHistory = monitor.last24Hours
  const uptimeTitles = uptimeHistory.map((hour) => `${formatDate(hour.startedAt)} · ${formatStatus(hour.status)}`)

  return (
    <main className="page page--wide subscription-detail">
      <div className="subscription-detail__back"><Link to="/monitors"><ArrowLeft size={17} /> {t('nav.monitoring')}</Link></div>

      <header className="subscription-detail__header">
        <StatusDot status={monitor.status} />
        <div>
          <div className="subscription-detail__title"><h1>{monitor.name}<span className="title-dot">.</span></h1><Badge tone="info">{t('subscriptions.readOnly')}</Badge></div>
          <p>{monitor.typeLabel} · <span>{monitor.target || t('subscriptions.targetHidden')}</span></p>
          <small>{t('subscriptions.followedFrom', { page: state.detail.item.page_name })}</small>
        </div>
        <Button variant="danger" type="button" disabled={busy} onClick={() => void unsubscribe()}><Unlink size={17} /> {t('subscriptions.unsubscribe')}</Button>
      </header>

      {feedback && <FeedbackBanner tone={feedback.tone} onDismiss={() => setFeedback(null)}>{feedback.message}</FeedbackBanner>}

      <section className="subscription-detail__summary" aria-label={t('subscriptions.safeSummary')}>
        <Panel><span>{t('common.status')}</span><strong>{formatStatus(monitor.status)}</strong></Panel>
        <Panel><span>{t('monitorDetail.lastCheck')}</span><strong>{monitor.lastCheckedAt ? formatDate(monitor.lastCheckedAt, { includeSeconds: true }) : '—'}</strong></Panel>
        <Panel><span>{t('monitors.last24h')}</span><strong>{latestStats ? formatUptime(latestStats.availability) : '—'}</strong></Panel>
        <Panel><span>MTBF</span><strong>{latestStats ? formatDuration(latestStats.mtbf_seconds) : '—'}</strong></Panel>
      </section>

      <Panel className="subscription-detail__uptime">
        <div><h2>{t('subscriptions.uptimeHistory')}</h2><span>{latestStats ? formatUptime(latestStats.availability) : '—'}</span></div>
        <UptimeBars
          label={t('monitors.hourlyChecks')}
          values={uptimeHistory.map((hour) => hour.status === 'up' ? 100 : hour.status === 'down' ? 0 : hour.status === 'degraded' ? 98 : null)}
          titles={uptimeTitles}
        />
      </Panel>

      <Panel className="subscription-detail__chart">
        <div className="subscription-detail__section-title"><div><h2>{t('subscriptions.responseTime')}</h2><p>{t('subscriptions.responseTimeHint')}</p></div><Badge>{t('subscriptions.aggregated')}</Badge></div>
        {chartData.length ? <div className="subscription-detail__chart-frame">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(132, 151, 179, .16)" vertical={false} />
              <XAxis dataKey="timestamp" tickFormatter={responseTick} stroke="#8193aa" tickLine={false} axisLine={false} minTickGap={36} />
              <YAxis unit=" ms" stroke="#8193aa" tickLine={false} axisLine={false} width={72} />
              <Tooltip labelFormatter={(value) => formatDate(Number(value), { includeSeconds: false })} formatter={(value) => [`${Math.round(Number(value))} ms`, t('subscriptions.responseTime')]} />
              {responseSeries.map((series) => <Line key={series.regionId} type="monotone" dataKey={series.regionId} name={series.regionLabel} stroke={series.color} strokeWidth={2} dot={false} connectNulls />)}
            </LineChart>
          </ResponsiveContainer>
        </div> : <p className="subscription-detail__empty">{t('subscriptions.noResponseData')}</p>}
      </Panel>

      <section className="subscription-detail__periods">
        {(state.detail.periods ?? []).map((period) => <Panel key={period.period}><span>{period.period}</span><strong>{formatUptime(period.stats.availability)}</strong><small>{t('subscriptions.periodIncidents', { count: period.stats.incidents })}</small></Panel>)}
      </section>

      <Panel className="subscription-detail__incidents">
        <div className="subscription-detail__section-title"><div><h2>{t('nav.incidents')}</h2><p>{t('subscriptions.safeIncidentsHint')}</p></div><Badge>{state.detail.incidents?.length ?? 0}</Badge></div>
        {(state.detail.incidents ?? []).length ? <div className="subscription-detail__incident-list">{state.detail.incidents.map((incident) => <article key={incident.id}>
          <div><Badge tone={incident.status === 'resolved' ? 'success' : 'warning'}>{formatStatus(incident.status)}</Badge><strong>{incident.title}</strong></div>
          <p>{incident.root_cause || incident.title}</p>
          <span><Clock3 size={14} /> {formatDate(incident.started_at, { includeSeconds: true })}{incident.resolved_at ? ` · ${formatDate(incident.resolved_at, { includeSeconds: true })}` : ''}</span>
        </article>)}</div> : <p className="subscription-detail__empty">{t('subscriptions.noIncidents')}</p>}
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
    </main>
  )
}

export default SubscribedMonitorDetailPage
