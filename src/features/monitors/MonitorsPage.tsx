import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronDown, Filter, Layers3, MoreHorizontal, Plus, RotateCw, SearchX } from 'lucide-react'
import { demoMonitors, type MonitorStatus, type MonitorViewModel } from '../../data'
import { formatDuration, formatRelativeTime, formatUptime } from '../../lib/format'
import { UptimeBars } from '../../components/UptimeBars'
import { Badge, Button, EmptyState, IconButton, Modal, PageHeader, Panel, SearchInput, StatusDot, Toggle } from '../../components/ui'
import { defaultMonitorDraft, MonitorForm, type MonitorDraft } from './MonitorForm'
import './monitors.css'

const statusOrder: Record<MonitorStatus, number> = { down: 0, degraded: 1, pending: 2, up: 3, paused: 4 }

export interface MonitorsPageProps {
  data?: readonly MonitorViewModel[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onCreate?: (draft: MonitorDraft) => Promise<void>
}

export function MonitorsPage({ data, loading = false, error = null, onRetry, onCreate }: MonitorsPageProps = {}) {
  const [demoMonitorState, setDemoMonitorState] = useState<MonitorViewModel[]>([...demoMonitors])
  const monitors = data ?? demoMonitorState
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MonitorStatus>('all')
  const [sort, setSort] = useState<'status' | 'name' | 'response'>('status')
  const [showGroups, setShowGroups] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => monitors
    .filter((monitor) => filter === 'all' || monitor.status === filter)
    .filter((monitor) => `${monitor.name} ${monitor.target} ${monitor.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'response' ? (b.responseTimeMs ?? 0) - (a.responseTimeMs ?? 0) : statusOrder[a.status] - statusOrder[b.status]), [filter, monitors, query, sort])

  const summary = useMemo(() => ({
    up: monitors.filter((monitor) => monitor.status === 'up').length,
    down: monitors.filter((monitor) => monitor.status === 'down').length,
    degraded: monitors.filter((monitor) => monitor.status === 'degraded').length,
    paused: monitors.filter((monitor) => monitor.status === 'paused').length,
    uptime: monitors.filter((monitor) => monitor.uptime24h !== undefined).reduce((total, monitor) => total + (monitor.uptime24h ?? 0), 0) / Math.max(1, monitors.filter((monitor) => monitor.uptime24h !== undefined).length),
  }), [monitors])

  const createMonitor = async (draft: MonitorDraft) => {
    if (onCreate) {
      await onCreate(draft)
      setCreateOpen(false)
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

  const renderRows = (rows: MonitorViewModel[]) => rows.map((monitor) => (
    <article className="monitor-row" key={monitor.id}>
      <Link to={`/monitors/${monitor.id}`} className="monitor-row__status" aria-label={`Open ${monitor.name}`}><StatusDot status={monitor.status} /></Link>
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
      <div className="monitor-row__uptime"><UptimeBars compact values={monitor.last24Hours.map((bar) => bar.status === 'up' ? 100 : bar.status === 'down' ? 0 : 98)} /><span>{monitor.uptime24h === undefined ? '—' : formatUptime(monitor.uptime24h)}</span></div>
      <IconButton label={`Actions for ${monitor.name}`}><MoreHorizontal size={19} /></IconButton>
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
        <div className="monitor-toolbar__count"><span className="check-box" /> 0 / {monitors.length}</div>
        <label className="monitor-toolbar__groups"><span>Show groups</span><Toggle checked={showGroups} onChange={setShowGroups} label="Show monitor groups" /></label>
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or URL" />
        <div className="filter-dropdown"><Filter size={17} /><select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | MonitorStatus)}><option value="all">All statuses</option><option value="down">Down</option><option value="degraded">Degraded</option><option value="up">Up</option><option value="paused">Paused</option></select></div>
        <div className="filter-dropdown"><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="status">Down first</option><option value="name">Name A–Z</option><option value="response">Slowest first</option></select></div>
      </div>

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
            <div className="status-summary__visual"><span>{summary.down ? '!' : '✓'}</span></div>
            <div className="status-summary__counts"><div><strong className="danger-text">{summary.down}</strong><span>Down</span></div><div><strong>{summary.up}</strong><span>Up</span></div><div><strong>{summary.paused}</strong><span>Paused</span></div></div>
            <p>Using {monitors.length} of 100 monitors.</p>
          </Panel>
          <Panel className="status-summary status-summary--stats">
            <h2>Last 24 hours<span className="title-dot">.</span></h2>
            <div className="status-summary__metric-grid"><div><strong className={summary.uptime < 99 ? 'danger-text' : 'success-text'}>{formatUptime(summary.uptime)}</strong><span>Overall uptime</span></div><div><strong>21.85h</strong><span>MTBF</span></div><div><strong>45m</strong><span>Without incidents</span></div><div><strong>{summary.down + summary.degraded}</strong><span>Incidents</span></div></div>
          </Panel>
        </aside>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={<>Create <span className="success-text">monitor</span></>} icon={<Activity size={31} />} width="xl">
        <MonitorForm initialValue={{ ...defaultMonitorDraft }} onSubmit={createMonitor} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </div>
  )
}
