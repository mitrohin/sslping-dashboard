import { useMemo, useState, type FormEvent } from 'react'
import {
  CheckCircle2,
  Clock3,
  Download,
  Filter,
  MessageSquareText,
  Search,
  ShieldCheck,
  ShieldAlert,
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
import { Badge, Button, FeedbackBanner, Field, Modal, PageHeader, Panel, SearchInput, Select } from '../../components/ui'
import './operations.css'
import { useI18n } from '../../app/I18nProvider'
import { ComplianceReport } from '../monitors/ComplianceReport'
import { notifyIncidentAssignmentChanged } from './events'

type MaybePromise<T> = T | Promise<T>

export interface IncidentCommentViewModel {
  id: string
  author: string
  message: string
  createdAt: string
  status?: IncidentStatus
}

export interface IncidentsPageProps {
  incidents?: readonly IncidentViewModel[]
  monitors?: readonly MonitorViewModel[]
  members?: readonly TeamMemberViewModel[]
  initialComments?: Readonly<Record<string, readonly IncidentCommentViewModel[]>>
  onAssign?: (incidentId: string, memberId: string) => MaybePromise<void>
  onComment?: (incidentId: string, message: string) => MaybePromise<void>
  onResolve?: (incidentId: string) => MaybePromise<void>
  onDownloadComplianceReport?: (incidentId: string) => Promise<Blob>
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
  initialComments = {},
  onAssign,
  onComment,
  onResolve,
  onDownloadComplianceReport,
}: IncidentsPageProps) {
  const { t } = useI18n()
  const [incidents, setIncidents] = useState<IncidentViewModel[]>(() => [...initialIncidents])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('incident')
  })
  const [assignments, setAssignments] = useState<Readonly<Record<string, string>>>({})
  const [comments, setComments] = useState<Readonly<Record<string, readonly IncidentCommentViewModel[]>>>(() => initialComments)
  const [commentDraft, setCommentDraft] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [downloadingReport, setDownloadingReport] = useState(false)

  const downloadComplianceReport = async (incident: IncidentViewModel) => {
    if (!onDownloadComplianceReport) return
    setDownloadingReport(true)
    setActionError('')
    try {
      const blob = await onDownloadComplianceReport(incident.id)
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `legal-compliance-${incident.id}.pdf`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setDownloadingReport(false)
    }
  }

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
  const selectedComments = selected ? comments[selected.id] ?? [] : []
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
      setActionError(error instanceof Error ? error.message : t('incidents.actionFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const assign = (incident: IncidentViewModel, memberId: string) =>
    execute(
      'assign',
      async () => {
        await onAssign?.(incident.id, memberId)
        notifyIncidentAssignmentChanged()
      },
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
          author: t('common.you'),
          message,
          createdAt: new Date().toISOString(),
          status: selected.status,
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
        title={t('incidents.title')}
        description={t('incidents.summary', { open: openCount, total: incidents.length })}
      />

      <div className="ops-notice" role="note">
        <ShieldCheck size={21} aria-hidden="true" />
        <div>
          <strong>{t('incidents.networkProtected')}</strong>
          <span>{t('incidents.networkProtectedHint')}</span>
        </div>
      </div>

      <div className="ops-toolbar" aria-label={t('incidents.filters')}>
        <SearchInput
          className="ops-toolbar__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('incidents.search')}
          aria-label={t('incidents.searchLabel')}
        />
        <Select value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t('monitors.filterTag')}>
          <option value="all">{t('monitors.allTags')}</option>
          {allTags.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label={t('monitors.filterStatus')}>
          <option value="all">{t('status.all')}</option>
          <option value="open">{t('incidents.openOnly')}</option>
          <option value="investigating">{formatStatus('investigating')}</option>
          <option value="identified">{formatStatus('identified')}</option>
          <option value="monitoring">{formatStatus('monitoring')}</option>
          <option value="resolved">{formatStatus('resolved')}</option>
        </Select>
        <Select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)} aria-label={t('incidents.sort')}>
          <option value="newest">{t('incidents.sortNewest')}</option>
          <option value="oldest">{t('incidents.sortOldest')}</option>
          <option value="duration">{t('incidents.sortDuration')}</option>
        </Select>
        <Button variant="secondary" size="sm" type="button" disabled={!filtersActive} onClick={resetFilters}>
          <Filter size={16} /> {filtersActive ? t('incidents.clearFilters') : t('incidents.filtersShort')}
        </Button>
      </div>

      <Panel className="ops-table-panel">
        <div className="ops-table-scroll ops-desktop-only">
          <table className="ops-data-table ops-incidents-table">
            <thead>
              <tr>
                <th>{t('common.status')}</th>
                <th>{t('incidents.monitor')}</th>
                <th>{t('incidents.rootCause')}</th>
                <th>{t('incidents.comments')}</th>
                <th>{t('incidents.started')}</th>
                <th>{t('incidents.resolved')}</th>
                <th>{t('incidents.duration')}</th>
                <th>{t('incidents.assignee')}</th>
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
                  <td>{incident.status !== 'resolved' && (assignments[incident.id] || incident.assignedTo) ? (
                    <span className="ops-assignee-badge"><UserRoundCheck size={15} />{memberById.get(assignments[incident.id])?.name ?? incident.assignedTo}</span>
                  ) : '—'}</td>
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
              {incident.status !== 'resolved' && (assignments[incident.id] || incident.assignedTo) && (
                <span className="ops-card-assignee"><UserRoundCheck size={15} />{memberById.get(assignments[incident.id])?.name ?? incident.assignedTo}</span>
              )}
              <span className="ops-card-row ops-card-row--muted"><span>{formatDate(incident.startedAt)}</span><span>{t('incidents.commentCount', { count: incident.commentCount })}</span></span>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="ops-filter-empty">
            <Search size={28} />
            <strong>{t('incidents.empty')}</strong>
            <span>{t('incidents.emptyHint')}</span>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(selected)}
        onClose={() => { setSelectedId(null); setActionError('') }}
        title={selected ? selected.monitorName : t('incidents.incident')}
        icon={<Clock3 size={34} />}
        width="lg"
      >
        {selected && (
          <div className="ops-incident-detail">
            <div className="ops-detail-summary">
              <div><span>{t('common.status')}</span><Badge tone={incidentTone(selected.status)}>{formatStatus(selected.status)}</Badge></div>
              <div><span>{t('incidents.rootCause')}</span><strong>{selected.rootCause}</strong></div>
              <div><span>{t('incidents.started')}</span><strong>{formatDate(selected.startedAt, { includeSeconds: true })}</strong></div>
              <div><span>{t('incidents.duration')}</span><strong>{formatDuration(selected.durationSeconds)}</strong></div>
            </div>

            <div className="ops-action-row">
              <label className="ops-assign-control">
                <UserRoundCheck size={17} />
                <Select
                  value={selectedAssignment}
                  disabled={busyAction !== null}
                  onChange={(event) => void assign(selected, event.target.value)}
                  aria-label={t('incidents.assign')}
                >
                  <option value="">{t('incidents.unassigned')}</option>
                  {members.filter((member) => member.status === 'active').map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </Select>
              </label>
              {selected.status !== 'resolved' && (
                <Button variant="success" type="button" disabled={busyAction !== null} onClick={() => void resolve(selected)}>
                  <CheckCircle2 size={17} /> {t('incidents.resolve')}
                </Button>
              )}
            </div>

            {selectedAssignment && (
              <p className="ops-assignment-note">{t('incidents.assignedTo', { name: memberById.get(selectedAssignment)?.name ?? t('incidents.teamMember') })}</p>
            )}
            {actionError && <FeedbackBanner tone="error">{actionError}</FeedbackBanner>}

            {selected.locationQuorum && (
              <section className="ops-location-quorum">
                <header className="ops-location-quorum__header">
                  <span className="ops-location-quorum__icon"><ShieldCheck size={23} /></span>
                  <div>
                    <h3>{t('incidents.locationEvidence')}</h3>
                    <p>{t('incidents.locationEvidenceHint', {
                      failed: selected.locationQuorum.observations.filter((observation) => observation.status === 'failed').length,
                      required: selected.locationQuorum.requiredFailures,
                      expected: selected.locationQuorum.expectedLocations,
                    })}</p>
                  </div>
                </header>
                <div className="ops-location-quorum__grid">
                  {selected.locationQuorum.observations.map((observation) => (
                    <article key={`${observation.region}-${observation.finishedAt ?? observation.status}`}>
                      <div className="ops-location-quorum__location">
                        <strong>{observation.region === 'local' ? 'Frankfurt, Germany' : observation.region}</strong>
                        <Badge tone={observation.status === 'failed' ? 'danger' : observation.status === 'degraded' ? 'warning' : observation.status === 'ok' ? 'success' : 'neutral'}>
                          {formatStatus(observation.status)}
                        </Badge>
                      </div>
                      {observation.rootCause && <p>{observation.rootCause}</p>}
                      <span>
                        {observation.latencyMs !== undefined && `${Math.round(observation.latencyMs)} ms`}
                        {observation.latencyMs !== undefined && observation.finishedAt && ' · '}
                        {observation.finishedAt && formatDate(observation.finishedAt, { includeSeconds: true })}
                      </span>
                    </article>
                  ))}
                </div>
                <small>{t('incidents.locationRecoveryHint', { required: selected.locationQuorum.requiredRecoveries })}</small>
              </section>
            )}

            {selected.leakReport && <section className="ops-leak-report">
              <header className="ops-leak-report__header">
                <span className="ops-leak-report__icon"><ShieldAlert size={24} /></span>
                <div><span className="ops-leak-report__eyebrow">LeakCheck</span><h3>{t('monitorDetail.leakReport')}</h3><p>{t('monitorDetail.leakReportFor', { target: selected.leakReport.query_masked })}</p></div>
              </header>
              <div className="ops-leak-report__summary"><div><span>{t('monitorDetail.exposureStatus')}</span><strong>{selected.leakReport.found}</strong></div><div><span>{t('monitorDetail.sourcesLabel')}</span><strong>{selected.leakReport.sources.length}</strong></div><div><span>{t('monitorDetail.lastScan')}</span><strong>{formatDate(selected.leakReport.checked_at, { includeSeconds: true })}</strong></div></div>
              <div className="ops-leak-report__sources">{selected.leakReport.sources.map((source) => <article key={`${source.name}-${source.breach_date ?? ''}`}><div><strong>{source.name}</strong><span>{source.breach_date || t('monitorDetail.unknownDate')} · {t('monitorDetail.recordsCount', { count: source.records })}</span></div><div>{source.fields.map((field) => <Badge key={field}>{field}</Badge>)}</div></article>)}</div>
              {selected.leakReport.records.length > 0 && <details><summary>{t('monitorDetail.maskedDetails')}</summary><div className="ops-leak-report__records">{selected.leakReport.records.map((record, index) => <dl key={`${record.source.name}-${index}`}><div><dt>source</dt><dd>{record.source.name}</dd></div>{Object.entries(record.data).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl>)}</div></details>}
            </section>}

            {selected.complianceReport && <section className="ops-compliance-report">
              {selected.complianceReport.summary.failed > 0 && onDownloadComplianceReport && <div className="ops-compliance-report__actions"><Button type="button" variant="secondary" disabled={downloadingReport} onClick={() => void downloadComplianceReport(selected)}><Download size={17} />{downloadingReport ? t('incidents.preparingCompliancePdf') : t('incidents.downloadCompliancePdf')}</Button></div>}
              <ComplianceReport report={selected.complianceReport} />
            </section>}

            <section className="ops-timeline">
              <h3>{t('incidents.timeline')}</h3>
              {selectedComments.length > 0 ? (
                selectedComments.map((comment) => (
                  <div className="ops-timeline__item" key={comment.id}>
                    <span className={`ops-timeline__marker${comment.status === 'resolved' ? ' ops-timeline__marker--success' : ''}`} />
                    <div><strong>{comment.author}</strong><span>{formatDate(comment.createdAt, { includeSeconds: true })}</span><p>{comment.message}</p></div>
                  </div>
                ))
              ) : (
                <>
                  <div className="ops-timeline__item">
                    <span className="ops-timeline__marker" />
                    <div><strong>{t('incidents.opened')}</strong><span>{formatDate(selected.startedAt, { includeSeconds: true })}</span><p>{selected.rootCause}</p></div>
                  </div>
                  {selected.resolvedAt && (
                    <div className="ops-timeline__item">
                      <span className="ops-timeline__marker ops-timeline__marker--success" />
                      <div><strong>{t('incidents.resolvedEvent')}</strong><span>{formatDate(selected.resolvedAt, { includeSeconds: true })}</span></div>
                    </div>
                  )}
                </>
              )}
            </section>

            <form className="ops-comment-form" onSubmit={submitComment}>
              <Field label={t('incidents.addUpdate')} hint={t('incidents.updateHint')}>
                <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={10_000} placeholder={t('incidents.updatePlaceholder')} />
              </Field>
              <Button type="submit" disabled={!commentDraft.trim() || busyAction !== null}>
                <MessageSquareText size={17} /> {t('incidents.addComment')}
              </Button>
            </form>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default IncidentsPage
