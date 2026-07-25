import { useMemo, useState, type FormEvent } from 'react'
import {
  CheckCircle2,
  Clock3,
  Filter,
  MessageSquareText,
  Search,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react'
import {
  DEMO_NOW,
  demoIncidents,
  demoMonitors,
  demoTeamMembers,
  type IncidentStatus,
  type IncidentViewModel,
  type MonitorViewModel,
  type TeamMemberViewModel,
} from '../../data'
import { formatDate, formatDuration, formatStatus } from '../../lib/format'
import { Badge, Button, Field, Modal, PageHeader, Panel, SearchInput, Select } from '../../components/ui'
import './operations.css'

type MaybePromise<T> = T | Promise<T>

export interface IncidentCommentViewModel {
  id: string
  author: string
  message: string
  createdAt: string
}

export interface IncidentsPageProps {
  incidents?: readonly IncidentViewModel[]
  monitors?: readonly MonitorViewModel[]
  members?: readonly TeamMemberViewModel[]
  onAcknowledge?: (incidentId: string) => MaybePromise<void>
  onAssign?: (incidentId: string, memberId: string) => MaybePromise<void>
  onComment?: (incidentId: string, message: string) => MaybePromise<void>
  onResolve?: (incidentId: string) => MaybePromise<void>
}

type SortOrder = 'newest' | 'oldest' | 'duration'
type StatusFilter = 'all' | IncidentStatus | 'open'

const incidentTone = (status: IncidentStatus): 'success' | 'warning' | 'info' => {
  if (status === 'resolved') return 'success'
  if (status === 'monitoring') return 'info'
  return 'warning'
}

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function IncidentsPage({
  incidents: initialIncidents = demoIncidents,
  monitors = demoMonitors,
  members = demoTeamMembers,
  onAcknowledge,
  onAssign,
  onComment,
  onResolve,
}: IncidentsPageProps) {
  const [incidents, setIncidents] = useState<IncidentViewModel[]>(() => [...initialIncidents])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(() => new Set())
  const [assignments, setAssignments] = useState<Readonly<Record<string, string>>>({})
  const [comments, setComments] = useState<Readonly<Record<string, readonly IncidentCommentViewModel[]>>>({})
  const [commentDraft, setCommentDraft] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const monitorById = useMemo(
    () => new Map(monitors.map((monitor) => [monitor.id, monitor])),
    [monitors],
  )
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  )
  const allTags = useMemo(
    () => [...new Set(monitors.flatMap((monitor) => monitor.tags))].sort(),
    [monitors],
  )

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const result = incidents.filter((incident) => {
      const incidentTags = monitorById.get(incident.monitorId)?.tags ?? []
      const matchesQuery =
        normalizedQuery === '' ||
        incident.monitorName.toLowerCase().includes(normalizedQuery) ||
        incident.rootCause.toLowerCase().includes(normalizedQuery) ||
        incident.rootCauseCode.toLowerCase().includes(normalizedQuery)
      const matchesTag = tag === 'all' || incidentTags.includes(tag)
      const matchesStatus =
        status === 'all' ||
        (status === 'open' ? incident.status !== 'resolved' : incident.status === status)
      return matchesQuery && matchesTag && matchesStatus
    })
    return result.sort((left, right) => {
      if (sort === 'oldest') return Date.parse(left.startedAt) - Date.parse(right.startedAt)
      if (sort === 'duration') return right.durationSeconds - left.durationSeconds
      return Date.parse(right.startedAt) - Date.parse(left.startedAt)
    })
  }, [incidents, monitorById, query, sort, status, tag])

  const selected = selectedId ? incidents.find((incident) => incident.id === selectedId) : undefined
  const selectedAssignment = selected
    ? assignments[selected.id] ?? members.find((member) => member.name === selected.assignedTo)?.id ?? ''
    : ''

  const execute = async (key: string, action: () => MaybePromise<void>, optimistic: () => void) => {
    setBusyAction(key)
    setActionError('')
    optimistic()
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The action could not be completed.')
    } finally {
      setBusyAction(null)
    }
  }

  const acknowledge = (incident: IncidentViewModel) =>
    execute(
      'acknowledge',
      () => onAcknowledge?.(incident.id),
      () => setAcknowledged((current) => new Set(current).add(incident.id)),
    )

  const assign = (incident: IncidentViewModel, memberId: string) =>
    execute(
      'assign',
      () => onAssign?.(incident.id, memberId),
      () => setAssignments((current) => ({ ...current, [incident.id]: memberId })),
    )

  const resolve = (incident: IncidentViewModel) =>
    execute(
      'resolve',
      () => onResolve?.(incident.id),
      () =>
        setIncidents((current) =>
          current.map((item) =>
            item.id === incident.id
              ? { ...item, status: 'resolved', resolvedAt: DEMO_NOW }
              : item,
          ),
        ),
    )

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !commentDraft.trim()) return
    const message = commentDraft.trim()
    void execute(
      'comment',
      () => onComment?.(selected.id, message),
      () => {
        const comment: IncidentCommentViewModel = {
          id: makeId(),
          author: 'You',
          message,
          createdAt: DEMO_NOW,
        }
        setComments((current) => ({
          ...current,
          [selected.id]: [...(current[selected.id] ?? []), comment],
        }))
        setIncidents((current) =>
          current.map((item) =>
            item.id === selected.id ? { ...item, commentCount: item.commentCount + 1 } : item,
          ),
        )
        setCommentDraft('')
      },
    )
  }

  const openCount = incidents.filter((incident) => incident.status !== 'resolved').length
  const filtersActive = query.trim() !== '' || tag !== 'all' || status !== 'all' || sort !== 'newest'

  const resetFilters = () => {
    setQuery('')
    setTag('all')
    setStatus('all')
    setSort('newest')
  }

  return (
    <div className="page page--wide ops-page">
      <PageHeader
        title="Incidents"
        description={`${openCount} open · ${incidents.length} total incidents`}
      />

      <div className="ops-notice" role="note">
        <ShieldCheck size={21} aria-hidden="true" />
        <div>
          <strong>Checker network is protected</strong>
          <span>Allowlist checker IPs in your firewall to avoid false timeout incidents.</span>
        </div>
      </div>

      <div className="ops-toolbar" aria-label="Incident filters">
        <SearchInput
          className="ops-toolbar__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by monitor or root cause"
          aria-label="Search incidents"
        />
        <Select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter by tag">
          <option value="all">All tags</option>
          {allTags.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="open">Open only</option>
          <option value="investigating">Investigating</option>
          <option value="identified">Identified</option>
          <option value="monitoring">Monitoring</option>
          <option value="resolved">Resolved</option>
        </Select>
        <Select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)} aria-label="Sort incidents">
          <option value="newest">Started · Newest</option>
          <option value="oldest">Started · Oldest</option>
          <option value="duration">Longest duration</option>
        </Select>
        <Button variant="secondary" size="sm" type="button" disabled={!filtersActive} onClick={resetFilters}>
          <Filter size={16} /> {filtersActive ? 'Clear filters' : 'Filters'}
        </Button>
      </div>

      <Panel className="ops-table-panel">
        <div className="ops-table-scroll ops-desktop-only">
          <table className="ops-data-table ops-incidents-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Monitor</th>
                <th>Root cause</th>
                <th>Comments</th>
                <th>Started</th>
                <th>Resolved</th>
                <th>Duration</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((incident) => (
                <tr key={incident.id}>
                  <td><Badge tone={incidentTone(incident.status)}>{formatStatus(incident.status)}</Badge></td>
                  <td><button className="ops-link-button" type="button" onClick={() => setSelectedId(incident.id)}>{incident.monitorName}</button></td>
                  <td><span className="ops-root-cause"><Badge tone="danger">{incident.rootCauseCode}</Badge>{incident.rootCause}</span></td>
                  <td><span className="ops-inline-meta"><MessageSquareText size={15} />{incident.commentCount}</span></td>
                  <td>{formatDate(incident.startedAt, { includeSeconds: true })}</td>
                  <td>{incident.resolvedAt ? formatDate(incident.resolvedAt, { includeSeconds: true }) : '—'}</td>
                  <td>{formatDuration(incident.durationSeconds)}</td>
                  <td><Badge tone={incident.visibility === 'included' ? 'neutral' : 'warning'}>{incident.visibility === 'included' ? 'Included' : 'Excluded'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ops-mobile-only ops-card-list">
          {filtered.map((incident) => (
            <button className="ops-incident-card" type="button" key={incident.id} onClick={() => setSelectedId(incident.id)}>
              <span className="ops-card-row"><Badge tone={incidentTone(incident.status)}>{formatStatus(incident.status)}</Badge><span>{formatDuration(incident.durationSeconds)}</span></span>
              <strong>{incident.monitorName}</strong>
              <span>{incident.rootCause}</span>
              <span className="ops-card-row ops-card-row--muted"><span>{formatDate(incident.startedAt)}</span><span>{incident.commentCount} comments</span></span>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="ops-filter-empty">
            <Search size={28} />
            <strong>No matching incidents</strong>
            <span>Clear filters or try a broader search.</span>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(selected)}
        onClose={() => { setSelectedId(null); setActionError('') }}
        title={selected ? selected.monitorName : 'Incident'}
        icon={<Clock3 size={34} />}
        width="lg"
      >
        {selected && (
          <div className="ops-incident-detail">
            <div className="ops-detail-summary">
              <div><span>Status</span><Badge tone={incidentTone(selected.status)}>{formatStatus(selected.status)}</Badge></div>
              <div><span>Root cause</span><strong>{selected.rootCause}</strong></div>
              <div><span>Started</span><strong>{formatDate(selected.startedAt, { includeSeconds: true })}</strong></div>
              <div><span>Duration</span><strong>{formatDuration(selected.durationSeconds)}</strong></div>
            </div>

            <div className="ops-action-row">
              <Button
                variant="secondary"
                type="button"
                disabled={acknowledged.has(selected.id) || busyAction !== null}
                onClick={() => void acknowledge(selected)}
              >
                <CheckCircle2 size={17} />
                {acknowledged.has(selected.id) ? 'Acknowledged' : 'Acknowledge'}
              </Button>
              <label className="ops-assign-control">
                <UserRoundCheck size={17} />
                <Select
                  value={selectedAssignment}
                  disabled={busyAction !== null}
                  onChange={(event) => void assign(selected, event.target.value)}
                  aria-label="Assign incident"
                >
                  <option value="">Unassigned</option>
                  {members.filter((member) => member.status === 'active').map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </Select>
              </label>
              {selected.status !== 'resolved' && (
                <Button variant="success" type="button" disabled={busyAction !== null} onClick={() => void resolve(selected)}>
                  <CheckCircle2 size={17} /> Resolve
                </Button>
              )}
            </div>

            {selectedAssignment && (
              <p className="ops-assignment-note">Assigned to {memberById.get(selectedAssignment)?.name ?? 'team member'}.</p>
            )}
            {actionError && <div className="ops-error" role="alert">{actionError}</div>}

            <section className="ops-timeline">
              <h3>Timeline</h3>
              <div className="ops-timeline__item">
                <span className="ops-timeline__marker" />
                <div><strong>Incident opened</strong><span>{formatDate(selected.startedAt, { includeSeconds: true })}</span><p>{selected.rootCause}</p></div>
              </div>
              {(comments[selected.id] ?? []).map((comment) => (
                <div className="ops-timeline__item" key={comment.id}>
                  <span className="ops-timeline__marker" />
                  <div><strong>{comment.author}</strong><span>{formatDate(comment.createdAt, { includeSeconds: true })}</span><p>{comment.message}</p></div>
                </div>
              ))}
              {selected.resolvedAt && (
                <div className="ops-timeline__item">
                  <span className="ops-timeline__marker ops-timeline__marker--success" />
                  <div><strong>Incident resolved</strong><span>{formatDate(selected.resolvedAt, { includeSeconds: true })}</span></div>
                </div>
              )}
            </section>

            <form className="ops-comment-form" onSubmit={submitComment}>
              <Field label="Add an update" hint="Visible to your incident response team.">
                <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={10_000} placeholder="Share context or the next action…" />
              </Field>
              <Button type="submit" disabled={!commentDraft.trim() || busyAction !== null}>
                <MessageSquareText size={17} /> Add comment
              </Button>
            </form>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default IncidentsPage
