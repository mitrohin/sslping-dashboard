import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  BellRing,
  ChevronDown,
  Eye,
  Filter,
  Layers3,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RotateCw,
  SearchX,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import { demoMonitors, type MonitorStatus, type MonitorViewModel } from '../../data'
import { formatDuration, formatRelativeTime, formatUptime } from '../../lib/format'
import { UptimeBars } from '../../components/UptimeBars'
import { Badge, Button, EmptyState, IconButton, Modal, PageHeader, Panel, SearchInput, StatusDot, Toggle } from '../../components/ui'
import { defaultMonitorDraft, MonitorForm, type MonitorDraft } from './MonitorForm'
import { HeartbeatCredentialModal, type HeartbeatCredential } from './HeartbeatCredentialModal'
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
  onBulkAction?: (monitors: readonly MonitorViewModel[], action: MonitorRowAction) => Promise<void>
  onBulkTags?: (monitors: readonly MonitorViewModel[], mode: 'add' | 'remove', tags: readonly string[]) => Promise<void>
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
  onBulkAction,
  onBulkTags,
}: MonitorsPageProps = {}) {
  const [demoMonitorState, setDemoMonitorState] = useState<MonitorViewModel[]>([...demoMonitors])
  const monitors = data ?? demoMonitorState
  const availableTags = useMemo(() => [...new Set(monitors.flatMap((monitor) => monitor.tags))].sort(), [monitors])
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
    const measured = monitors.filter((monitor) => monitor.uptime24h !== undefined)
    const incidentCount = monitors.reduce((total, monitor) => total + (monitor.incidentCount24h ?? 0), 0)
    const stableTime = monitors.reduce(
      (total, monitor) => total + (monitor.mtbfSeconds24h ?? 0) * (monitor.incidentCount24h ?? 0),
      0,
    )
    const latestIncidentAt = monitors.reduce<number | undefined>((latest, monitor) => {
      if (!monitor.lastIncidentAt) return latest
      const timestamp = Date.parse(monitor.lastIncidentAt)
      if (!Number.isFinite(timestamp)) return latest
      return latest === undefined || timestamp > latest ? timestamp : latest
    }, undefined)
    const hasOpenIncident = monitors.some((monitor) => monitor.hasOpenIncident)
    const secondsWithoutIncident = monitors.length === 0
      ? undefined
      : hasOpenIncident
        ? 0
        : latestIncidentAt === undefined
          ? 86_400
          : Math.max(0, Math.min(86_400, Math.floor((Date.now() - latestIncidentAt) / 1000)))

    return {
      up: monitors.filter((monitor) => monitor.status === 'up').length,
      down: monitors.filter((monitor) => monitor.status === 'down').length,
      degraded: monitors.filter((monitor) => monitor.status === 'degraded').length,
      paused: monitors.filter((monitor) => monitor.status === 'paused').length,
      uptime: measured.length > 0
        ? measured.reduce((total, monitor) => total + (monitor.uptime24h ?? 0), 0) / measured.length
        : undefined,
      incidents: incidentCount,
      mtbfSeconds: incidentCount > 0 ? stableTime / incidentCount : undefined,
      secondsWithoutIncident,
    }
  }, [monitors])

  const visibleIds = useMemo(() => filtered.map((monitor) => monitor.id), [filtered])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected
  const selectedMonitors = useMemo(() => monitors.filter((monitor) => selectedIds.has(monitor.id)), [monitors, selectedIds])
  const selectedTagUnion = useMemo(() => [...new Set(selectedMonitors.flatMap((monitor) => monitor.tags))].sort(), [selectedMonitors])
  const bulkTagCandidates = bulkTagMode === 'remove' ? selectedTagUnion : availableTags
  const filteredBulkTags = bulkTagCandidates.filter((tag) => tag.toLocaleLowerCase().includes(bulkTagQuery.trim().toLocaleLowerCase()))
  const canCreateBulkTag = bulkTagMode === 'add' && bulkTagQuery.trim().length > 0
    && !availableTags.some((tag) => tag.toLocaleLowerCase() === bulkTagQuery.trim().toLocaleLowerCase())

  useEffect(() => {
    setSelectedIds((current) => {
      const available = new Set(monitors.map((monitor) => monitor.id))
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
    if (action === 'delete' && !window.confirm(`Delete “${monitor.name}”? This cannot be undone.`)) return

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
      const verb = action === 'test' ? 'Test completed for' : action === 'delete' ? 'Deleted' : action === 'pause' ? 'Paused' : 'Resumed'
      setActionFeedback({ tone: 'success', message: `${verb} ${monitor.name}.` })
    } catch (actionError) {
      setActionFeedback({
        tone: 'danger',
        message: actionError instanceof Error ? actionError.message : `Could not ${action} ${monitor.name}.`,
      })
    } finally {
      setBusyActionId(null)
    }
  }

  const runBulkAction = async (action: MonitorRowAction) => {
    if (!selectedMonitors.length) return
    if (action === 'delete' && !window.confirm(`Delete ${selectedMonitors.length} selected monitors? This cannot be undone.`)) return
    setBulkBusy(true)
    setActionFeedback(null)
    try {
      if (onBulkAction) await onBulkAction(selectedMonitors, action)
      else selectedMonitors.forEach((monitor) => applyDemoAction(monitor, action))
      if (action === 'delete') setSelectedIds(new Set())
      const verb = action === 'test' ? 'Tested' : action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : 'Deleted'
      setActionFeedback({ tone: 'success', message: `${verb} ${selectedMonitors.length} selected monitors.` })
    } catch (actionError) {
      setActionFeedback({ tone: 'danger', message: actionError instanceof Error ? actionError.message : `Could not ${action} selected monitors.` })
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
      setActionFeedback({ tone: 'success', message: `${bulkTagMode === 'add' ? 'Added' : 'Removed'} ${tags.length} tags ${bulkTagMode === 'add' ? 'to' : 'from'} ${selectedMonitors.length} monitors.` })
      setBulkTagsOpen(false)
    } catch (actionError) {
      setActionFeedback({ tone: 'danger', message: actionError instanceof Error ? actionError.message : 'Could not update tags.' })
    } finally {
      setBulkBusy(false)
    }
  }

  const renderRows = (rows: MonitorViewModel[]) => rows.map((monitor) => (
    <article className={`monitor-row ${selectedIds.has(monitor.id) ? 'monitor-row--selected' : ''}`} key={monitor.id}>
      <div className="monitor-row__lead">
        <input
          className="monitor-checkbox"
          type="checkbox"
          checked={selectedIds.has(monitor.id)}
          onChange={() => toggleMonitorSelection(monitor.id)}
          aria-label={`Select ${monitor.name}`}
        />
        <Link to={`/monitors/${monitor.id}`} className="monitor-row__status" aria-label={`Open ${monitor.name}`}><StatusDot status={monitor.status} /></Link>
      </div>
      <div className="monitor-row__identity">
        <Link to={`/monitors/${monitor.id}`}>{monitor.name}</Link>
        <div><Badge>{monitor.typeLabel}</Badge><span>{monitor.status === 'up' ? `Up ${monitor.statusChangedAt ? formatRelativeTime(monitor.statusChangedAt) : '—'}` : monitor.status}</span></div>
      </div>
      <div className="monitor-row__meta">
        {monitor.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}
        {monitor.sslCertificate?.state === 'warning' && <Badge tone="warning">SSL exp. in {monitor.sslCertificate.daysRemaining}d</Badge>}
        {monitor.domainRegistration?.state === 'warning' && <Badge tone="warning">Domain exp. soon</Badge>}
      </div>
      <div className="monitor-row__interval"><RotateCw size={15} /> {formatDuration(monitor.intervalSeconds)}</div>
      <div className="monitor-row__uptime"><UptimeBars compact label="Hourly checks for the last 24 hours" values={monitor.last24Hours.map((bar) => bar.status === 'up' ? 100 : bar.status === 'down' ? 0 : bar.status === 'degraded' ? 98 : null)} titles={monitor.last24Hours.map((bar) => `${new Date(bar.startedAt).toLocaleString([], { hour: '2-digit', minute: '2-digit' })} · ${bar.status === 'no-data' ? 'No checks' : bar.status}`)} /><span>{monitor.uptime24h === undefined ? '—' : formatUptime(monitor.uptime24h)}</span></div>
      <div className="monitor-row__actions" ref={openActionId === monitor.id ? actionMenuRef : undefined}>
        <IconButton
          label={`Actions for ${monitor.name}`}
          aria-haspopup="menu"
          aria-expanded={openActionId === monitor.id}
          disabled={busyActionId === monitor.id}
          onClick={() => setOpenActionId((current) => current === monitor.id ? null : monitor.id)}
        ><MoreHorizontal size={19} /></IconButton>
        {openActionId === monitor.id && (
          <div className="monitor-action-menu" role="menu" aria-label={`Actions for ${monitor.name}`}>
            <Link role="menuitem" to={`/monitors/${monitor.id}`} onClick={() => { setOpenActionId(null); onView?.(monitor) }}><Eye size={16} /> View</Link>
            <Link role="menuitem" to={`/monitors/${monitor.id}/edit`} onClick={() => { setOpenActionId(null); onEdit?.(monitor) }}><Pencil size={16} /> Edit</Link>
            <button role="menuitem" type="button" onClick={() => void runMonitorAction(monitor, monitor.status === 'paused' ? 'resume' : 'pause')}>
              {monitor.status === 'paused' ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
              {monitor.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button role="menuitem" type="button" onClick={() => void runMonitorAction(monitor, 'test')}><BellRing size={16} /> Test now</button>
            <button className="monitor-action-menu__danger" role="menuitem" type="button" onClick={() => void runMonitorAction(monitor, 'delete')}><Trash2 size={16} /> Delete</button>
          </div>
        )}
      </div>
    </article>
  ))

  const grouped = useMemo(() => {
    if (!showGroups) return [] as Array<[string, MonitorViewModel[]]>
    const groups = filtered.reduce<Record<string, MonitorViewModel[]>>((accumulator, monitor) => {
      ;(accumulator[monitor.group] ??= []).push(monitor)
      return accumulator
    }, {})
    return Object.entries(groups)
  }, [filtered, showGroups])

  return (
    <div className="page page--wide monitors-page">
      <PageHeader title="Monitors" actions={<Button onClick={() => setCreateOpen(true)}><Plus size={18} /> New monitor <ChevronDown size={16} /></Button>} />

      <div className="monitor-toolbar">
        <label className="monitor-toolbar__count">
          <input
            ref={selectAllRef}
            className="monitor-checkbox"
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAllVisible}
            disabled={visibleIds.length === 0}
            aria-label="Select all visible monitors"
          />
          <span>{selectedIds.size} / {monitors.length}</span>
        </label>
        <div className="monitor-toolbar__groups"><span>Show groups</span><Toggle checked={showGroups} onChange={setShowGroups} label="Show monitor groups" /></div>
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or URL" />
        <div className="filter-dropdown"><Filter size={17} /><select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | MonitorStatus)}><option value="all">All statuses</option><option value="down">Down</option><option value="degraded">Degraded</option><option value="up">Up</option><option value="paused">Paused</option></select></div>
        <div className="filter-dropdown"><Tags size={17} /><select aria-label="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">All tags</option>{availableTags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}</select></div>
        <div className="filter-dropdown"><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="status">Down first</option><option value="name">Name A–Z</option><option value="response">Slowest first</option></select></div>
      </div>

      {selectedMonitors.length > 0 && <div className="monitor-bulk-toolbar" role="toolbar" aria-label="Bulk monitor actions">
        <strong>{selectedMonitors.length} selected</strong>
        <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulkAction('test')}><BellRing size={16} /> Test now</Button>
        <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulkAction('pause')}><PauseCircle size={16} /> Pause</Button>
        <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulkAction('resume')}><PlayCircle size={16} /> Resume</Button>
        <Button variant="secondary" disabled={bulkBusy} onClick={openBulkTags}><Tags size={16} /> Manage tags</Button>
        <Button variant="danger" disabled={bulkBusy} onClick={() => void runBulkAction('delete')}><Trash2 size={16} /> Delete</Button>
        <button type="button" className="monitor-bulk-toolbar__clear" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}><X size={15} /> Clear</button>
      </div>}

      {actionFeedback && <div className={`monitor-action-feedback monitor-action-feedback--${actionFeedback.tone}`} role={actionFeedback.tone === 'danger' ? 'alert' : 'status'}>{actionFeedback.message}</div>}

      <div className="monitor-layout">
        <Panel className="monitor-list">
          {loading ? (
            <EmptyState icon={<Activity size={34} />} title="Loading monitors" description="Fetching checks, uptime and current monitor state…" />
          ) : error ? (
            <EmptyState icon={<SearchX size={34} />} title="Could not load monitors" description={error} action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined} />
          ) : filtered.length === 0 ? <EmptyState icon={<SearchX size={34} />} title="No monitors found" description="Try another filter or create a new monitor." action={<Button onClick={() => setCreateOpen(true)}><Plus size={17} /> Create monitor</Button>} /> : showGroups ? grouped.map(([group, rows]) => rows && <section key={group} className="monitor-group"><header><span><Layers3 size={17} /> {group}</span><Badge>{rows.length}</Badge></header>{renderRows(rows)}</section>) : renderRows(filtered)}
        </Panel>

        <aside className="monitor-summary">
          <Panel className="status-summary">
            <h2>Current status<span className="title-dot">.</span></h2>
            <div className={`status-summary__visual status-summary__visual--${summary.down ? 'down' : summary.degraded ? 'degraded' : summary.up ? 'up' : 'idle'}`}><span>{summary.down ? '!' : summary.degraded ? '~' : summary.up ? '✓' : '–'}</span></div>
            <div className="status-summary__counts"><div><strong className="danger-text">{summary.down}</strong><span>Down</span></div><div><strong>{summary.up}</strong><span>Up</span></div><div><strong>{summary.paused}</strong><span>Paused</span></div></div>
            <p>Using {monitors.length} of 100 monitors.</p>
          </Panel>
          <Panel className="status-summary status-summary--stats">
            <h2>Last 24 hours<span className="title-dot">.</span></h2>
            <div className="status-summary__metric-grid"><div><strong className={summary.uptime !== undefined && summary.uptime < 99 ? 'danger-text' : 'success-text'}>{summary.uptime === undefined ? '—' : formatUptime(summary.uptime)}</strong><span>Overall uptime</span></div><div><strong>{summary.mtbfSeconds === undefined ? '—' : formatDuration(summary.mtbfSeconds)}</strong><span>MTBF</span></div><div><strong>{summary.secondsWithoutIncident === undefined ? '—' : formatDuration(summary.secondsWithoutIncident)}</strong><span>Without incidents</span></div><div><strong>{summary.incidents}</strong><span>Incidents</span></div></div>
          </Panel>
        </aside>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={<>Create <span className="success-text">monitor</span></>} icon={<Activity size={31} />} width="xl">
        <MonitorForm initialValue={{ ...defaultMonitorDraft }} availableTags={availableTags} onSubmit={createMonitor} onCancel={() => setCreateOpen(false)} />
      </Modal>
      <Modal open={bulkTagsOpen} onClose={() => !bulkBusy && setBulkTagsOpen(false)} title={<>Manage <span className="success-text">tags</span></>} icon={<Tags size={29} />} width="md">
        <div className="bulk-tags-dialog">
          <p>Update {selectedMonitors.length} selected monitors in one operation.</p>
          <div className="bulk-tags-dialog__modes" role="group" aria-label="Tag operation">
            <button type="button" className={bulkTagMode === 'add' ? 'is-active' : ''} onClick={() => { setBulkTagMode('add'); setBulkTagSelection(new Set()); setBulkTagQuery('') }}>Add tags</button>
            <button type="button" className={bulkTagMode === 'remove' ? 'is-active' : ''} onClick={() => { setBulkTagMode('remove'); setBulkTagSelection(new Set()); setBulkTagQuery('') }}>Remove tags</button>
          </div>
          <input aria-label="Search bulk tags" value={bulkTagQuery} onChange={(event) => setBulkTagQuery(event.target.value)} placeholder={bulkTagMode === 'add' ? 'Search or create a tag…' : 'Search assigned tags…'} />
          {bulkTagSelection.size > 0 && <div className="bulk-tags-dialog__selected">{[...bulkTagSelection].map((tag) => <span key={tag}>{tag}<button type="button" aria-label={`Unselect tag ${tag}`} onClick={() => toggleBulkTag(tag)}><X size={12} /></button></span>)}</div>}
          <div className="bulk-tags-dialog__options" role="listbox" aria-label="Bulk tag choices">
            {filteredBulkTags.map((tag) => <button type="button" role="option" aria-selected={bulkTagSelection.has(tag)} className={bulkTagSelection.has(tag) ? 'is-selected' : ''} key={tag} onClick={() => toggleBulkTag(tag)}>{tag}<small>{bulkTagSelection.has(tag) ? 'Selected' : bulkTagMode === 'add' ? 'Existing tag' : 'Assigned to selection'}</small></button>)}
            {canCreateBulkTag && <button type="button" role="option" aria-selected="false" className="bulk-tags-dialog__create" onClick={() => toggleBulkTag(bulkTagQuery.trim())}><Plus size={14} /> Create “{bulkTagQuery.trim()}”</button>}
            {filteredBulkTags.length === 0 && !canCreateBulkTag && <p>{bulkTagMode === 'remove' ? 'Selected monitors have no matching tags.' : 'No matching workspace tags.'}</p>}
          </div>
          <div className="form-actions"><Button variant="secondary" disabled={bulkBusy} onClick={() => setBulkTagsOpen(false)}>Cancel</Button><Button aria-label="Apply bulk tag changes" disabled={bulkBusy || bulkTagSelection.size === 0} onClick={() => void applyBulkTags()}>{bulkBusy ? 'Applying…' : bulkTagMode === 'add' ? 'Add tags' : 'Remove tags'}</Button></div>
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
