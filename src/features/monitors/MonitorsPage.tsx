import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  Activity,
  Bell,
  BellRing,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Filter,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RotateCw,
  Scale,
  Search,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
import { demoMonitors, type MonitorStatus, type MonitorViewModel } from '../../data'
import { formatDuration, formatRelativeTime, formatUptime } from '../../lib/format'
import { UptimeBars } from '../../components/UptimeBars'
import { Badge, Button, EmptyState, FeedbackBanner, IconButton, Modal, PageHeader, PageLoadingSkeleton, Panel, SearchInput, Select, StatusDot, Toggle } from '../../components/ui'
import { defaultMonitorDraft, MonitorForm, type MonitorDraft } from './MonitorForm'
import { HeartbeatCredentialModal, type HeartbeatCredential } from './HeartbeatCredentialModal'
import { useI18n } from '../../app/I18nProvider'
import './monitors.css'

const statusOrder: Record<MonitorStatus, number> = { down: 0, degraded: 1, pending: 2, up: 3, paused: 4 }

export interface MonitorsPageProps {
  data?: readonly MonitorViewModel[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onCreate?: (draft: MonitorDraft) => Promise<HeartbeatCredential | void>
  onView?: (monitor: MonitorViewModel) => void
  onEdit?: (monitor: MonitorViewModel) => void
  onTogglePause?: (monitor: MonitorViewModel, pause: boolean) => Promise<void>
  onTest?: (monitor: MonitorViewModel) => Promise<void>
  onDelete?: (monitor: MonitorViewModel) => Promise<void>
  onUnsubscribe?: (monitor: MonitorViewModel) => Promise<void>
  onBulkAction?: (monitors: readonly MonitorViewModel[], action: MonitorRowAction) => Promise<void>
  onBulkTags?: (monitors: readonly MonitorViewModel[], mode: 'add' | 'remove', tags: readonly string[]) => Promise<void>
  manualTestEnabled?: boolean
  monitorLimit?: number
  pageNumber?: number
  hasPreviousPage?: boolean
  hasNextPage?: boolean
  onPreviousPage?: () => void
  onNextPage?: () => void
  totalMonitors?: number
  availableTags?: readonly string[]
  onSearchQueryChange?: (query: string) => void
  onStatusFilterChange?: (status: 'all' | MonitorStatus) => void
  onTagFilterChange?: (tag: string) => void
  onSortChange?: (sort: 'status' | 'name' | 'response') => void
  summaryPageScoped?: boolean
}

type MonitorRowAction = 'pause' | 'resume' | 'test' | 'delete'

export function MonitorsPage({
  data,
  loading = false,
  error = null,
  onRetry,
  onCreate,
  onView,
  onEdit,
  onTogglePause,
  onTest,
  onDelete,
  onUnsubscribe,
  onBulkAction,
  onBulkTags,
  manualTestEnabled = true,
  monitorLimit = 100,
  pageNumber = 1,
  hasPreviousPage = false,
  hasNextPage = false,
  onPreviousPage,
  onNextPage,
  totalMonitors,
  availableTags: workspaceTags,
  onSearchQueryChange,
  onStatusFilterChange,
  onTagFilterChange,
  onSortChange,
  summaryPageScoped = false,
}: MonitorsPageProps = {}) {
  const { locale, t } = useI18n()
  const [demoMonitorState, setDemoMonitorState] = useState<MonitorViewModel[]>([...demoMonitors])
  const monitors = data ?? demoMonitorState
  const ownedMonitors = useMemo(() => monitors.filter((monitor) => monitor.access !== 'subscription'), [monitors])
  const availableTags = useMemo(
    () => workspaceTags ? [...workspaceTags] : [...new Set(monitors.flatMap((monitor) => monitor.tags))].sort(),
    [monitors, workspaceTags],
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MonitorStatus>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [sort, setSort] = useState<'status' | 'name' | 'response'>('status')
  const [showGroups, setShowGroups] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [heartbeatCredential, setHeartbeatCredential] = useState<HeartbeatCredential | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [openActionId, setOpenActionId] = useState<string | null>(null)
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false)
  const [bulkTagMode, setBulkTagMode] = useState<'add' | 'remove'>('add')
  const [bulkTagSelection, setBulkTagSelection] = useState<Set<string>>(() => new Set())
  const [bulkTagQuery, setBulkTagQuery] = useState('')
  const previousStatuses = useRef(new Map<string, MonitorStatus>())
  const selectAllRef = useRef<HTMLInputElement>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => monitors
    .filter((monitor) => filter === 'all' || monitor.status === filter)
    .filter((monitor) => tagFilter === 'all' || monitor.tags.includes(tagFilter))
    .filter((monitor) => `${monitor.name} ${monitor.target} ${monitor.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'response' ? (b.responseTimeMs ?? 0) - (a.responseTimeMs ?? 0) : statusOrder[a.status] - statusOrder[b.status]), [filter, monitors, query, sort, tagFilter])

  const summary = useMemo(() => {
	const uptimeMonitors = monitors.filter((monitor) => monitor.type !== 'leakcheck' && monitor.type !== 'compliance')
	const leakMonitors = monitors.filter((monitor) => monitor.type === 'leakcheck')
	const complianceMonitors = monitors.filter((monitor) => monitor.type === 'compliance')
	const measured = uptimeMonitors.filter((monitor) => monitor.uptime24h !== undefined)
	const incidentCount = uptimeMonitors.reduce((total, monitor) => total + (monitor.incidentCount24h ?? 0), 0)
	const stableTime = uptimeMonitors.reduce(
      (total, monitor) => total + (monitor.mtbfSeconds24h ?? 0) * (monitor.incidentCount24h ?? 0),
      0,
    )
	const latestIncidentAt = uptimeMonitors.reduce<number | undefined>((latest, monitor) => {
      if (!monitor.lastIncidentAt) return latest
      const timestamp = Date.parse(monitor.lastIncidentAt)
      if (!Number.isFinite(timestamp)) return latest
      return latest === undefined || timestamp > latest ? timestamp : latest
    }, undefined)
	const hasOpenIncident = uptimeMonitors.some((monitor) => monitor.hasOpenIncident)
	const secondsWithoutIncident = uptimeMonitors.length === 0
      ? undefined
      : hasOpenIncident
        ? 0
        : latestIncidentAt === undefined
          ? 86_400
          : Math.max(0, Math.min(86_400, Math.floor((Date.now() - latestIncidentAt) / 1000)))

    return {
	  up: uptimeMonitors.filter((monitor) => monitor.status === 'up').length,
	  down: uptimeMonitors.filter((monitor) => monitor.status === 'down').length,
	  degraded: uptimeMonitors.filter((monitor) => monitor.status === 'degraded').length,
	  paused: uptimeMonitors.filter((monitor) => monitor.status === 'paused').length,
      uptime: measured.length > 0
        ? measured.reduce((total, monitor) => total + (monitor.uptime24h ?? 0), 0) / measured.length
        : undefined,
      incidents: incidentCount,
	  mtbfSeconds: incidentCount > 0 ? stableTime / incidentCount : undefined,
	  secondsWithoutIncident,
	  leaks: {
		exposed: leakMonitors.filter((monitor) => monitor.status === 'down').length,
		clear: leakMonitors.filter((monitor) => monitor.status === 'up').length,
		awaiting: leakMonitors.filter((monitor) => monitor.status !== 'up' && monitor.status !== 'down').length,
		total: leakMonitors.length,
	  },
	  compliance: {
		issues: complianceMonitors.filter((monitor) => monitor.status === 'down').length,
		warnings: complianceMonitors.filter((monitor) => monitor.status === 'degraded').length,
		clear: complianceMonitors.filter((monitor) => monitor.status === 'up').length,
		awaiting: complianceMonitors.filter((monitor) => monitor.status === 'pending').length,
		total: complianceMonitors.length,
	  },
    }
  }, [monitors])

  const visibleIds = useMemo(() => filtered.filter((monitor) => monitor.access !== 'subscription').map((monitor) => monitor.id), [filtered])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected
  const selectedMonitors = useMemo(() => monitors.filter((monitor) => monitor.access !== 'subscription' && selectedIds.has(monitor.id)), [monitors, selectedIds])
  const selectedCanTest = selectedMonitors.length > 0 && selectedMonitors.every((monitor) => monitor.type === 'leakcheck' || manualTestEnabled)
  const selectedTagUnion = useMemo(() => [...new Set(selectedMonitors.flatMap((monitor) => monitor.tags))].sort(), [selectedMonitors])
  const bulkTagCandidates = bulkTagMode === 'remove' ? selectedTagUnion : availableTags
  const filteredBulkTags = bulkTagCandidates.filter((tag) => tag.toLocaleLowerCase().includes(bulkTagQuery.trim().toLocaleLowerCase()))
  const canCreateBulkTag = bulkTagMode === 'add' && bulkTagQuery.trim().length > 0
    && !availableTags.some((tag) => tag.toLocaleLowerCase() === bulkTagQuery.trim().toLocaleLowerCase())

  useEffect(() => {
    setSelectedIds((current) => {
      const available = new Set(monitors.filter((monitor) => monitor.access !== 'subscription').map((monitor) => monitor.id))
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [monitors])

  useEffect(() => {
    if (tagFilter !== 'all' && !availableTags.includes(tagFilter)) setTagFilter('all')
  }, [availableTags, tagFilter])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected
  }, [someVisibleSelected])

  useEffect(() => {
    if (!openActionId) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setOpenActionId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActionId(null)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openActionId])

  const createMonitor = async (draft: MonitorDraft) => {
    if (onCreate) {
      const credential = await onCreate(draft)
      setCreateOpen(false)
      if (credential) setHeartbeatCredential(credential)
      return
    }
    const id = crypto.randomUUID()
    setDemoMonitorState((current) => [{
      id,
      name: draft.name,
      type: draft.type,
      typeLabel: draft.type.toUpperCase(),
      target: draft.type === 'heartbeat' ? `Every ${formatDuration(Number(draft.target))}` : draft.target,
      status: 'pending',
      group: draft.group,
      tags: draft.tags,
      intervalSeconds: draft.intervalSeconds,
      timeoutSeconds: draft.timeoutSeconds,
      regions: draft.regions,
      last24Hours: Array.from({ length: 30 }, (_, index) => ({ id: `${id}-${index}`, startedAt: new Date().toISOString(), status: 'no-data' as const })),
    }, ...current])
    setCreateOpen(false)
  }

  const toggleMonitorSelection = (monitorId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(monitorId)) next.delete(monitorId)
      else next.add(monitorId)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const applyDemoAction = (monitor: MonitorViewModel, action: MonitorRowAction) => {
    if (action === 'pause' && monitor.status !== 'paused') previousStatuses.current.set(monitor.id, monitor.status)
    setDemoMonitorState((current) => action === 'delete'
      ? current.filter((item) => item.id !== monitor.id)
      : current.map((item) => item.id === monitor.id
        ? {
            ...item,
            ...(action === 'pause' ? { status: 'paused' as const, statusChangedAt: new Date().toISOString() } : {}),
            ...(action === 'resume' ? { status: previousStatuses.current.get(item.id) ?? 'pending', statusChangedAt: new Date().toISOString() } : {}),
            ...(action === 'test' ? { lastCheckedAt: new Date().toISOString() } : {}),
          }
        : item))
  }

  const runMonitorAction = async (monitor: MonitorViewModel, action: MonitorRowAction) => {
    setOpenActionId(null)
    if (action === 'delete' && !window.confirm(t('monitors.confirmDelete', { name: monitor.name }))) return

    setBusyActionId(monitor.id)
    setActionFeedback(null)
    try {
      if (action === 'pause' || action === 'resume') {
        if (onTogglePause) await onTogglePause(monitor, action === 'pause')
        else applyDemoAction(monitor, action)
      } else if (action === 'test') {
        if (onTest) await onTest(monitor)
        else applyDemoAction(monitor, action)
      } else {
        if (onDelete) await onDelete(monitor)
        else applyDemoAction(monitor, action)
        setSelectedIds((current) => {
          if (!current.has(monitor.id)) return current
          const next = new Set(current)
          next.delete(monitor.id)
          return next
        })
      }
      setActionFeedback({ tone: 'success', message: t(`monitors.feedback.${action}`, { name: monitor.name }) })
    } catch (actionError) {
      setActionFeedback({
        tone: 'danger',
        message: actionError instanceof Error ? actionError.message : t('monitors.feedback.failed', { action: t(`monitors.action.${action}`), name: monitor.name }),
      })
    } finally {
      setBusyActionId(null)
    }
  }

  const unsubscribeMonitor = async (monitor: MonitorViewModel) => {
    setOpenActionId(null)
    if (!window.confirm(t('subscriptions.confirmUnsubscribe', { name: monitor.name }))) return
    setBusyActionId(monitor.id)
    setActionFeedback(null)
    try {
      if (onUnsubscribe) await onUnsubscribe(monitor)
      else setDemoMonitorState((current) => current.filter((item) => item.id !== monitor.id))
      setActionFeedback({ tone: 'success', message: t('subscriptions.unsubscribed', { name: monitor.name }) })
    } catch (actionError) {
      setActionFeedback({
        tone: 'danger',
        message: actionError instanceof Error ? actionError.message : t('subscriptions.unsubscribeFailed'),
      })
    } finally {
      setBusyActionId(null)
    }
  }

  const runBulkAction = async (action: MonitorRowAction) => {
    if (!selectedMonitors.length) return
    if (action === 'delete' && !window.confirm(t('monitors.confirmBulkDelete', { count: selectedMonitors.length }))) return
    setBulkBusy(true)
    setActionFeedback(null)
    try {
      if (onBulkAction) await onBulkAction(selectedMonitors, action)
      else selectedMonitors.forEach((monitor) => applyDemoAction(monitor, action))
      if (action === 'delete') setSelectedIds(new Set())
      setActionFeedback({ tone: 'success', message: t(`monitors.feedback.bulk.${action}`, { count: selectedMonitors.length }) })
    } catch (actionError) {
      setActionFeedback({ tone: 'danger', message: actionError instanceof Error ? actionError.message : t('monitors.feedback.bulkFailed', { action: t(`monitors.action.${action}`) }) })
    } finally {
      setBulkBusy(false)
    }
  }

  const openBulkTags = () => {
    setBulkTagMode('add')
    setBulkTagSelection(new Set())
    setBulkTagQuery('')
    setBulkTagsOpen(true)
  }

  const toggleBulkTag = (tag: string) => {
    setBulkTagSelection((current) => {
      const next = new Set(current)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
    setBulkTagQuery('')
  }

  const applyBulkTags = async () => {
    const tags = [...bulkTagSelection]
    if (!tags.length || !selectedMonitors.length) return
    setBulkBusy(true)
    setActionFeedback(null)
    try {
      if (onBulkTags) await onBulkTags(selectedMonitors, bulkTagMode, tags)
      else {
        const selected = new Set(selectedMonitors.map((monitor) => monitor.id))
        const changes = new Set(tags.map((tag) => tag.toLocaleLowerCase()))
        setDemoMonitorState((current) => current.map((monitor) => {
          if (!selected.has(monitor.id)) return monitor
          const nextTags = bulkTagMode === 'add'
            ? [...monitor.tags, ...tags.filter((tag) => !monitor.tags.some((currentTag) => currentTag.toLocaleLowerCase() === tag.toLocaleLowerCase()))]
            : monitor.tags.filter((tag) => !changes.has(tag.toLocaleLowerCase()))
          return { ...monitor, tags: nextTags }
        }))
      }
      setActionFeedback({ tone: 'success', message: t(`monitors.tags.feedback.${bulkTagMode}`, { tags: tags.length, monitors: selectedMonitors.length }) })
      setBulkTagsOpen(false)
    } catch (actionError) {
      setActionFeedback({ tone: 'danger', message: actionError instanceof Error ? actionError.message : t('monitors.tags.feedback.failed') })
    } finally {
      setBulkBusy(false)
    }
  }

  const renderRows = (rows: MonitorViewModel[]) => rows.map((monitor) => {
    const leakFound = monitor.leakFound ?? monitor.leakReport?.found
    const complianceSummary = monitor.complianceSummary ?? monitor.complianceReport?.summary
    const subscribed = monitor.access === 'subscription'
    const detailPath = subscribed && monitor.subscriptionId
      ? `/monitors/followed/${monitor.subscriptionId}`
      : `/monitors/${monitor.id}`
    return (
    <article className={`monitor-row ${selectedIds.has(monitor.id) ? 'monitor-row--selected' : ''} ${subscribed ? 'monitor-row--subscription' : ''}`} key={`${monitor.access ?? 'owner'}:${monitor.subscriptionId ?? monitor.id}`}>
      <div className="monitor-row__lead">
        {subscribed
          ? <span className="monitor-checkbox monitor-checkbox--spacer" aria-hidden="true" />
          : <input
              className="monitor-checkbox"
              type="checkbox"
              checked={selectedIds.has(monitor.id)}
              onChange={() => toggleMonitorSelection(monitor.id)}
              aria-label={t('monitors.select', { name: monitor.name })}
            />}
        <Link to={detailPath} className="monitor-row__status" aria-label={t('monitors.open', { name: monitor.name })}><StatusDot status={monitor.type === 'compliance' && !monitor.lastCheckedAt ? 'checking' : monitor.status} /></Link>
      </div>
      <div className="monitor-row__identity">
        <Link to={detailPath}>{monitor.name}</Link>
        <div><Badge>{monitor.typeLabel}</Badge>{subscribed && <Badge tone="info">{t('subscriptions.readOnly')}</Badge>}<span>{monitor.type === 'leakcheck' ? (monitor.status === 'down' ? t('monitorDetail.exposureFound') : monitor.status === 'up' ? t('monitorDetail.noExposure') : t(`status.${monitor.status}`)) : monitor.type === 'compliance' ? (!monitor.lastCheckedAt ? t('monitorDetail.scanInProgress') : monitor.status === 'up' ? t('monitorDetail.compliant') : t('monitorDetail.complianceIssues')) : monitor.status === 'up' ? `${t('status.up')} ${monitor.statusChangedAt ? formatRelativeTime(monitor.statusChangedAt) : '—'}` : locale === 'en' ? monitor.status : t(`status.${monitor.status}`)}</span></div>
      </div>
      <div className="monitor-row__meta">
        {subscribed && monitor.subscriptionPageName && <Badge>{monitor.subscriptionPageName}</Badge>}
        {monitor.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}
        {monitor.sslCertificate?.state === 'warning' && <Badge tone="warning">{t('monitors.sslExpires', { days: monitor.sslCertificate.daysRemaining ?? 0 })}</Badge>}
        {monitor.domainRegistration?.state === 'warning' && <Badge tone="warning">{t('monitors.domainExpires')}</Badge>}
      </div>
      <div className="monitor-row__interval">
        {monitor.type !== 'leakcheck' && <><RotateCw size={15} /> {formatDuration(monitor.intervalSeconds)}</>}
      </div>
      <div className="monitor-row__uptime">
        {monitor.type === 'leakcheck' ? (
          <div
            className={`monitor-row__leak-result ${leakFound ? 'is-exposed' : 'is-clear'}`}
            aria-label={leakFound !== undefined ? (leakFound ? t('monitorDetail.exposedRecords', { count: leakFound }) : t('monitorDetail.noLeaksFound')) : t('monitorDetail.noLeakReport')}
          >
            <ShieldAlert size={16} />
            <small>{monitor.lastCheckedAt ? formatRelativeTime(monitor.lastCheckedAt) : '—'}</small>
          </div>
        ) : monitor.type === 'compliance' ? (
          <div
            className={`monitor-row__compliance-result ${!monitor.lastCheckedAt ? 'is-pending' : (complianceSummary?.failed ?? 0) + (complianceSummary?.warnings ?? 0) > 0 ? 'has-issues' : 'is-clear'}`}
            aria-label={complianceSummary ? t('monitorDetail.complianceResult', { score: complianceSummary.score, failed: complianceSummary.failed, warnings: complianceSummary.warnings }) : t('monitorDetail.noComplianceReport')}
          >
            {!monitor.lastCheckedAt ? <LoaderCircle className="compliance-scan-spinner" size={16} /> : <Scale size={16} />}
            <small>{monitor.lastCheckedAt ? formatRelativeTime(monitor.lastCheckedAt) : '—'}</small>
          </div>
        ) : (
          <><UptimeBars compact label={t('monitors.hourlyChecks')} values={monitor.last24Hours.map((bar) => bar.status === 'up' ? 100 : bar.status === 'down' ? 0 : bar.status === 'degraded' ? 98 : null)} titles={monitor.last24Hours.map((bar) => `${new Date(bar.startedAt).toLocaleString([], { hour: '2-digit', minute: '2-digit' })} · ${bar.status === 'no-data' ? t('status.noData') : t(`status.${bar.status}`)}`)} /><span>{monitor.uptime24h === undefined ? '—' : formatUptime(monitor.uptime24h)}</span></>
        )}
      </div>
      <div className="monitor-row__actions" ref={openActionId === monitor.id ? actionMenuRef : undefined}>
        <IconButton
          label={t('monitors.actionsFor', { name: monitor.name })}
          aria-haspopup="menu"
          aria-expanded={openActionId === monitor.id}
          disabled={busyActionId === monitor.id}
          onClick={() => setOpenActionId((current) => current === monitor.id ? null : monitor.id)}
        ><MoreHorizontal size={19} /></IconButton>
        {openActionId === monitor.id && (
          <div className="monitor-action-menu" role="menu" aria-label={t('monitors.actionsFor', { name: monitor.name })}>
            {subscribed ? <>
              <Link role="menuitem" to={detailPath} onClick={() => setOpenActionId(null)}><Eye size={16} /> {t('common.view')}</Link>
              <Link role="menuitem" to={`${detailPath}#notifications`} onClick={() => setOpenActionId(null)}><Bell size={16} /> {t('subscriptions.notifications')}</Link>
              <button className="monitor-action-menu__danger" role="menuitem" type="button" onClick={() => void unsubscribeMonitor(monitor)}><Unlink size={16} /> {t('subscriptions.unsubscribe')}</button>
            </> : <>
              <Link role="menuitem" to={detailPath} onClick={() => { setOpenActionId(null); onView?.(monitor) }}><Eye size={16} /> {t('common.view')}</Link>
              <Link role="menuitem" to={`/monitors/${monitor.id}/edit`} onClick={() => { setOpenActionId(null); onEdit?.(monitor) }}><Pencil size={16} /> {t('common.edit')}</Link>
              <button role="menuitem" type="button" onClick={() => void runMonitorAction(monitor, monitor.status === 'paused' ? 'resume' : 'pause')}>
                {monitor.status === 'paused' ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                {monitor.status === 'paused' ? t('monitors.action.resume') : t('monitors.action.pause')}
              </button>
              {(manualTestEnabled || monitor.type === 'leakcheck') && <button role="menuitem" type="button" onClick={() => void runMonitorAction(monitor, 'test')}>{monitor.type === 'leakcheck' ? <ShieldAlert size={16} /> : monitor.type === 'compliance' ? <Scale size={16} /> : <BellRing size={16} />} {monitor.type === 'leakcheck' ? t('monitorDetail.scanLeaks') : monitor.type === 'compliance' ? t('monitorDetail.runComplianceReview') : t('monitors.action.test')}</button>}
              <button className="monitor-action-menu__danger" role="menuitem" type="button" onClick={() => void runMonitorAction(monitor, 'delete')}><Trash2 size={16} /> {t('common.delete')}</button>
            </>}
          </div>
        )}
      </div>
    </article>
    )
  })

  const grouped = useMemo(() => {
    if (!showGroups) return [] as Array<[string, MonitorViewModel[]]>
    const groups = filtered.reduce<Record<string, MonitorViewModel[]>>((accumulator, monitor) => {
      ;(accumulator[monitor.group] ??= []).push(monitor)
      return accumulator
    }, {})
    return Object.entries(groups)
  }, [filtered, showGroups])

  if (loading && monitors.length === 0) {
    return (
      <div className="page page--wide monitors-page">
        <PageLoadingSkeleton label={t('monitors.loading')} rows={5} />
      </div>
    )
  }

  return (
    <div className="page page--wide monitors-page" aria-busy={loading}>
      <PageHeader title={t('monitors.title')} actions={<Button onClick={() => setCreateOpen(true)}><Plus size={18} /> {t('monitors.new')}</Button>} />

      <div className="monitor-toolbar">
        <label className="monitor-toolbar__count">
          <input
            ref={selectAllRef}
            className="monitor-checkbox"
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAllVisible}
            disabled={visibleIds.length === 0}
            aria-label={t('monitors.selectAll')}
          />
          <span>{selectedIds.size} / {monitors.length}</span>
        </label>
        <div className="monitor-toolbar__groups"><span>{t('monitors.showGroups')}</span><Toggle checked={showGroups} onChange={setShowGroups} label={t('monitors.showGroups')} /></div>
        <SearchInput value={query} onChange={(event) => { setQuery(event.target.value); onSearchQueryChange?.(event.target.value) }} placeholder={t('monitors.search')} />
        <div className="filter-dropdown"><Filter size={17} /><Select aria-label={t('monitors.filterStatus')} value={filter} onChange={(event) => { const value = event.target.value as 'all' | MonitorStatus; setFilter(value); onStatusFilterChange?.(value) }}><option value="all">{t('status.all')}</option><option value="down">{t('status.down')}</option><option value="degraded">{t('status.degraded')}</option><option value="up">{t('status.up')}</option><option value="paused">{t('status.paused')}</option></Select></div>
        <div className="filter-dropdown"><Tags size={17} /><Select aria-label={t('monitors.filterTag')} value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); onTagFilterChange?.(event.target.value) }}><option value="all">{t('monitors.allTags')}</option>{availableTags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}</Select></div>
        <div className="filter-dropdown"><Select aria-label={t('monitors.sort')} value={sort} onChange={(event) => { const value = event.target.value as typeof sort; setSort(value); onSortChange?.(value) }}><option value="status">{t('monitors.sortDown')}</option><option value="name">{t('monitors.sortName')}</option><option value="response">{t('monitors.sortSlowest')}</option></Select></div>
      </div>

      {selectedMonitors.length > 0 && <div className="monitor-bulk-toolbar" role="toolbar" aria-label={t('monitors.bulkActions')}>
        <strong>{t('monitors.selected', { count: selectedMonitors.length })}</strong>
        {selectedCanTest && <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulkAction('test')}><BellRing size={16} /> {t('monitors.action.test')}</Button>}
        <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulkAction('pause')}><PauseCircle size={16} /> {t('monitors.action.pause')}</Button>
        <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulkAction('resume')}><PlayCircle size={16} /> {t('monitors.action.resume')}</Button>
        <Button variant="secondary" disabled={bulkBusy} onClick={openBulkTags}><Tags size={16} /> {t('monitors.manageTags')}</Button>
        <Button variant="danger" disabled={bulkBusy} onClick={() => void runBulkAction('delete')}><Trash2 size={16} /> {t('common.delete')}</Button>
        <button type="button" className="monitor-bulk-toolbar__clear" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}><X size={15} /> {t('common.clear')}</button>
      </div>}

      {actionFeedback && <FeedbackBanner tone={actionFeedback.tone === 'danger' ? 'error' : 'success'} className="feedback-banner--page" onDismiss={() => setActionFeedback(null)}>{actionFeedback.message}</FeedbackBanner>}

      <div className="monitor-layout">
        <div className="monitor-list-column">
          <Panel className="monitor-list">
            {error ? (
              <EmptyState icon={<SearchX size={34} />} title={t('monitors.loadFailed')} description={error} action={onRetry ? <Button onClick={onRetry}>{t('common.tryAgain')}</Button> : undefined} />
            ) : filtered.length === 0 ? <EmptyState icon={<SearchX size={34} />} title={t('monitors.empty')} description={t('monitors.emptyHint')} action={<Button onClick={() => setCreateOpen(true)}><Plus size={17} /> {t('monitors.create')}</Button>} /> : showGroups ? grouped.map(([group, rows]) => rows && <section key={group} className="monitor-group"><header><span><Layers3 size={17} /> {group}</span><Badge>{rows.length}</Badge></header>{renderRows(rows)}</section>) : renderRows(filtered)}
          </Panel>
          {(hasPreviousPage || hasNextPage) && <nav className="monitor-pagination" aria-label={t('monitors.pagination')}>
            <Button variant="secondary" disabled={!hasPreviousPage || loading} onClick={onPreviousPage}><ChevronLeft size={16} /> {t('common.previous')}</Button>
            <span className="monitor-pagination__scope" aria-current="page"><strong>{t('monitors.page', { page: pageNumber })}</strong><small>{t('monitors.pageScope')}</small></span>
            <Button variant="secondary" disabled={!hasNextPage || loading} onClick={onNextPage}>{t('common.next')} <ChevronRight size={16} /></Button>
          </nav>}
        </div>

        <aside className="monitor-summary">
          <Panel className={`status-summary ${summary.leaks.total > 0 || summary.compliance.total > 0 ? 'status-summary--has-special' : ''}`}>
            <h2>{t(summaryPageScoped ? 'monitors.currentPageStatus' : 'monitors.currentStatus')}<span className="title-dot">.</span></h2>
            <div className={`status-summary__visual status-summary__visual--${summary.down ? 'down' : summary.degraded ? 'degraded' : summary.up ? 'up' : 'idle'}`}><span>{summary.down ? '!' : summary.degraded ? '~' : summary.up ? '✓' : '–'}</span></div>
            <div className="status-summary__counts"><div><strong className="danger-text">{summary.down}</strong><span>{t('status.down')}</span></div><div><strong>{summary.up}</strong><span>{t('status.up')}</span></div><div><strong>{summary.paused}</strong><span>{t('status.paused')}</span></div></div>
            <p>{t('monitors.usage', { used: totalMonitors ?? ownedMonitors.length, total: monitorLimit })}</p>
            {(summary.leaks.total > 0 || summary.compliance.total > 0) && <div className="status-summary__secondary">
              {summary.leaks.total > 0 && <div className="status-summary__secondary-row">
                <span className="status-summary__secondary-type" title={t('monitors.leakStatus')} aria-hidden="true"><ShieldAlert size={16} /></span>
                <span className="status-summary__signals" role="group" aria-label={t('monitors.leakStatus')}>
                  <span className={`status-summary__signal status-summary__signal--danger ${summary.leaks.exposed ? 'is-active' : ''}`} title={`${t('monitors.leakExposed')}: ${summary.leaks.exposed}`} aria-label={`${t('monitors.leakExposed')}: ${summary.leaks.exposed}`}><ShieldAlert size={13} aria-hidden="true" /><b>{summary.leaks.exposed}</b></span>
                  <span className={`status-summary__signal status-summary__signal--success ${summary.leaks.clear ? 'is-active' : ''}`} title={`${t('monitors.leakClear')}: ${summary.leaks.clear}`} aria-label={`${t('monitors.leakClear')}: ${summary.leaks.clear}`}><ShieldCheck size={13} aria-hidden="true" /><b>{summary.leaks.clear}</b></span>
                  <span className={`status-summary__signal status-summary__signal--warning ${summary.leaks.awaiting ? 'is-active' : ''}`} title={`${t('monitors.leakAwaiting')}: ${summary.leaks.awaiting}`} aria-label={`${t('monitors.leakAwaiting')}: ${summary.leaks.awaiting}`}><Clock3 size={13} aria-hidden="true" /><b>{summary.leaks.awaiting}</b></span>
                </span>
              </div>}
              {summary.compliance.total > 0 && <div className="status-summary__secondary-row">
                <span className="status-summary__secondary-type" title={t('monitors.complianceStatus')} aria-hidden="true"><Scale size={16} /></span>
                <span className="status-summary__signals" role="group" aria-label={t('monitors.complianceStatus')}>
                  <span className={`status-summary__signal status-summary__signal--danger ${(summary.compliance.issues + summary.compliance.warnings) ? 'is-active' : ''}`} title={`${t('monitors.complianceIssues')}: ${summary.compliance.issues + summary.compliance.warnings}`} aria-label={`${t('monitors.complianceIssues')}: ${summary.compliance.issues + summary.compliance.warnings}`}><ShieldAlert size={13} aria-hidden="true" /><b>{summary.compliance.issues + summary.compliance.warnings}</b></span>
                  <span className={`status-summary__signal status-summary__signal--success ${summary.compliance.clear ? 'is-active' : ''}`} title={`${t('monitors.complianceClear')}: ${summary.compliance.clear}`} aria-label={`${t('monitors.complianceClear')}: ${summary.compliance.clear}`}><CircleCheck size={13} aria-hidden="true" /><b>{summary.compliance.clear}</b></span>
                </span>
              </div>}
            </div>}
          </Panel>
		  <Panel className="status-summary status-summary--stats">
            <h2>{t(summaryPageScoped ? 'monitors.last24hPage' : 'monitors.last24h')}<span className="title-dot">.</span></h2>
            <div className="status-summary__metric-grid"><div><strong className={summary.uptime !== undefined && summary.uptime < 99 ? 'danger-text' : 'success-text'}>{summary.uptime === undefined ? '—' : formatUptime(summary.uptime)}</strong><span>{t('monitors.overallUptime')}</span></div><div><strong>{summary.mtbfSeconds === undefined ? '—' : formatDuration(summary.mtbfSeconds)}</strong><span>MTBF</span></div><div><strong>{summary.secondsWithoutIncident === undefined ? '—' : formatDuration(summary.secondsWithoutIncident)}</strong><span>{t('monitors.withoutIncidents')}</span></div><div><strong>{summary.incidents}</strong><span>{t('nav.incidents')}</span></div></div>
		  </Panel>
		</aside>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('monitors.create')} icon={<Activity size={31} />} width="xl">
        <MonitorForm
          initialValue={defaultMonitorDraft}
          availableTags={availableTags}
          onSubmit={createMonitor}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
      <Modal open={bulkTagsOpen} onClose={() => !bulkBusy && setBulkTagsOpen(false)} title={t('monitors.manageTags')} icon={<Tags size={29} />} width="md">
        <div className="bulk-tags-dialog">
          <p>{t('monitors.tags.updateSelected', { count: selectedMonitors.length })}</p>
          <div className="bulk-tags-dialog__modes" role="group" aria-label={t('monitors.tags.operation')}>
            <button type="button" className={bulkTagMode === 'add' ? 'is-active' : ''} onClick={() => { setBulkTagMode('add'); setBulkTagSelection(new Set()); setBulkTagQuery('') }}>{t('monitors.tags.add')}</button>
            <button type="button" className={bulkTagMode === 'remove' ? 'is-active' : ''} onClick={() => { setBulkTagMode('remove'); setBulkTagSelection(new Set()); setBulkTagQuery('') }}>{t('monitors.tags.remove')}</button>
          </div>
          <div className="bulk-tags-dialog__search">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label={t('monitors.tags.search')}
              value={bulkTagQuery}
              onChange={(event) => setBulkTagQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreateBulkTag) {
                  event.preventDefault()
                  toggleBulkTag(bulkTagQuery.trim())
                } else if (event.key === 'Escape' && bulkTagQuery) {
                  event.preventDefault()
                  setBulkTagQuery('')
                }
              }}
              placeholder={bulkTagMode === 'add' ? t('monitors.tags.searchCreate') : t('monitors.tags.searchAssigned')}
              autoComplete="off"
              autoFocus
            />
            {bulkTagQuery && (
              <button type="button" aria-label={t('monitors.tags.clearSearch')} onClick={() => setBulkTagQuery('')}>
                <X size={16} />
              </button>
            )}
          </div>
          {bulkTagSelection.size > 0 && <div className="bulk-tags-dialog__selected">{[...bulkTagSelection].map((tag) => <span key={tag}>{tag}<button type="button" aria-label={`Unselect tag ${tag}`} onClick={() => toggleBulkTag(tag)}><X size={12} /></button></span>)}</div>}
          <div className="bulk-tags-dialog__options" role="listbox" aria-label={t('monitors.tags.choices')}>
            {filteredBulkTags.map((tag) => <button type="button" role="option" aria-selected={bulkTagSelection.has(tag)} className={bulkTagSelection.has(tag) ? 'is-selected' : ''} key={tag} onClick={() => toggleBulkTag(tag)}>{tag}<small>{bulkTagSelection.has(tag) ? t('common.selected') : bulkTagMode === 'add' ? t('monitors.tags.existing') : t('monitors.tags.assigned')}</small></button>)}
            {canCreateBulkTag && <button type="button" role="option" aria-selected="false" className="bulk-tags-dialog__create" onClick={() => toggleBulkTag(bulkTagQuery.trim())}><Plus size={14} /> {t('monitors.tags.create', { tag: bulkTagQuery.trim() })}</button>}
            {filteredBulkTags.length === 0 && !canCreateBulkTag && <p>{bulkTagMode === 'remove' ? t('monitors.tags.noneSelected') : t('monitors.tags.noneWorkspace')}</p>}
          </div>
          <div className="form-actions"><Button variant="secondary" disabled={bulkBusy} onClick={() => setBulkTagsOpen(false)}>{t('common.cancel')}</Button><Button aria-label={t('monitors.tags.apply')} disabled={bulkBusy || bulkTagSelection.size === 0} onClick={() => void applyBulkTags()}>{bulkBusy ? t('common.applying') : bulkTagMode === 'add' ? t('monitors.tags.add') : t('monitors.tags.remove')}</Button></div>
        </div>
      </Modal>
      {heartbeatCredential && (
        <HeartbeatCredentialModal
          credential={heartbeatCredential}
          onClose={() => setHeartbeatCredential(null)}
        />
      )}
    </div>
  )
}
