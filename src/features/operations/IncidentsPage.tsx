import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router'
import {
  ArrowRight,
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
import type { UserProblemReport } from '../../api'
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

export interface IncidentDetailsViewModel {
  comments: readonly IncidentCommentViewModel[]
  reports: readonly UserProblemReport[]
}

export interface IncidentsPageProps {
  incidents?: readonly IncidentViewModel[]
  monitors?: readonly MonitorViewModel[]
  members?: readonly TeamMemberViewModel[]
  initialComments?: Readonly<Record<string, readonly IncidentCommentViewModel[]>>
	initialReports?: Readonly<Record<string, readonly UserProblemReport[]>>
  onLoadIncidentDetails?: (incidentId: string) => Promise<IncidentDetailsViewModel>
  onAssign?: (incidentId: string, memberId: string) => MaybePromise<void>
  onComment?: (incidentId: string, message: string) => MaybePromise<void>
  onResolve?: (incidentId: string) => MaybePromise<void>
  onDownloadComplianceReport?: (incidentId: string) => Promise<Blob>
}

type SortOrder = 'newest' | 'oldest' | 'duration'
type StatusFilter = 'all' | IncidentStatus | 'open'
type IncidentDetailLoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: string }

const incidentTone = (status: IncidentStatus): 'success' | 'warning' | 'info' => {
  if (status === 'resolved') return 'success'
  if (status === 'monitoring') return 'info'
  return 'warning'
}

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

const REPORT_CHART_WINDOW_MS = 24 * 60 * 60 * 1000
const REPORT_CHART_BUCKETS = 48

interface ReportActivityBucket {
  at: number
  reports: number
  baseline: number
}

function niceChartMaximum(value: number): number {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function buildReportActivity(reports: readonly UserProblemReport[], endAt: number): ReportActivityBucket[] {
  const startAt = endAt - REPORT_CHART_WINDOW_MS
  const bucketDuration = REPORT_CHART_WINDOW_MS / REPORT_CHART_BUCKETS
  const counts = Array.from({ length: REPORT_CHART_BUCKETS }, () => 0)

  for (const report of reports) {
    const reportedAt = Date.parse(report.reported_at)
    if (!Number.isFinite(reportedAt) || reportedAt < startAt || reportedAt > endAt) continue
    const index = Math.min(REPORT_CHART_BUCKETS - 1, Math.floor((reportedAt - startAt) / bucketDuration))
    counts[index] += 1
  }

  const overallAverage = counts.reduce((sum, count) => sum + count, 0) / counts.length
  return counts.map((reportCount, index) => {
    const historyStart = Math.max(0, index - 8)
    const history = counts.slice(historyStart, index)
    const trailingAverage = history.length > 0
      ? history.reduce((sum, count) => sum + count, 0) / history.length
      : overallAverage

    return {
      at: startAt + (index + 0.5) * bucketDuration,
      reports: reportCount,
      baseline: (trailingAverage * 0.7) + (overallAverage * 0.3),
    }
  })
}

function VisitorReportActivityChart({ incident, reports, translate, locale }: { incident: IncidentViewModel; reports: readonly UserProblemReport[]; translate: (key: string, variables?: Record<string, string | number>) => string; locale: string }) {
  const gradientId = `report-area-${useId().replace(/:/g, '')}`
  const latestReportAt = Math.max(0, ...reports.map((report) => Date.parse(report.reported_at)).filter(Number.isFinite))
  const resolvedAt = Date.parse(incident.resolvedAt ?? '')
  const endAt = useMemo(
    () => Number.isFinite(resolvedAt) ? resolvedAt : Math.max(Date.now(), latestReportAt),
    [latestReportAt, resolvedAt],
  )
  const buckets = useMemo(() => buildReportActivity(reports, endAt), [endAt, reports])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const width = 960
  const height = 300
  const plot = { left: 52, right: 18, top: 28, bottom: 252 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = plot.bottom - plot.top
  const highestValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.reports, bucket.baseline]))
  const maximum = niceChartMaximum(highestValue)
  const xForIndex = (index: number): number => plot.left + (index / (buckets.length - 1)) * plotWidth
  const yForValue = (value: number): number => plot.bottom - (value / maximum) * plotHeight
  const reportPoints = buckets.map((bucket, index) => `${xForIndex(index)},${yForValue(bucket.reports)}`).join(' L ')
  const reportArea = `M ${plot.left},${plot.bottom} L ${reportPoints} L ${plot.left + plotWidth},${plot.bottom} Z`
  const baselinePath = `M ${buckets.map((bucket, index) => `${xForIndex(index)},${yForValue(bucket.baseline)}`).join(' L ')}`
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const decimalFormatter = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])
  const hovered = hoveredIndex === null ? null : buckets[hoveredIndex]

  const selectFromPointer = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0) return
    const viewBoxX = ((event.clientX - bounds.left) / bounds.width) * width
    const relativeX = Math.max(0, Math.min(plotWidth, viewBoxX - plot.left))
    setHoveredIndex(Math.round((relativeX / plotWidth) * (buckets.length - 1)))
  }

  const xTicks = Array.from({ length: 9 }, (_, index) => {
    const bucketIndex = Math.min(buckets.length - 1, index * 6)
    return { index: bucketIndex, x: xForIndex(bucketIndex), label: timeFormatter.format(buckets[bucketIndex].at) }
  })
  const yTicks = [0, maximum / 2, maximum]

  return (
    <section className="ops-incident-activity ops-report-activity">
      <header>
        <div><span>{translate('incidents.visitorReports')}</span><h3>{translate('incidents.reportActivity')}</h3><small>{translate('incidents.last24Hours')}</small></div>
        <strong>{translate('incidents.reportCount', { count: reports.length })}</strong>
      </header>
      <div className="ops-report-activity__plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={translate('incidents.reportActivity')}
          tabIndex={0}
          onPointerMove={selectFromPointer}
          onPointerLeave={() => setHoveredIndex(null)}
          onFocus={() => setHoveredIndex(buckets.length - 1)}
          onBlur={() => setHoveredIndex(null)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const direction = event.key === 'ArrowLeft' ? -1 : 1
            setHoveredIndex((current) => Math.max(0, Math.min(buckets.length - 1, (current ?? buckets.length - 1) + direction)))
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--report-chart-fill)" stopOpacity=".8" />
              <stop offset="100%" stopColor="var(--report-chart-fill)" stopOpacity=".08" />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => (
            <g key={tick} className="ops-report-activity__axis">
              <line x1={plot.left} y1={yForValue(tick)} x2={plot.left + plotWidth} y2={yForValue(tick)} />
              <text x={plot.left - 10} y={yForValue(tick) + 4} textAnchor="end">{decimalFormatter.format(tick)}</text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={tick.index} className="ops-report-activity__axis ops-report-activity__axis--time">
              <line x1={tick.x} y1={plot.top} x2={tick.x} y2={plot.bottom} />
              <text x={tick.x} y={plot.bottom + 24} textAnchor={tick.index === 0 ? 'start' : tick.index >= buckets.length - 2 ? 'end' : 'middle'}>{tick.label}</text>
            </g>
          ))}
          <text className="ops-report-activity__watermark" x={plot.left + plotWidth / 2} y={plot.top + plotHeight / 2} textAnchor="middle">SSLPing</text>
          <path className="ops-report-activity__area" d={reportArea} fill={`url(#${gradientId})`} />
          <path className="ops-report-activity__reports" d={`M ${reportPoints}`} />
          <path className="ops-report-activity__baseline" d={baselinePath} />
          {hovered && hoveredIndex !== null && (
            <g className="ops-report-activity__selection">
              <line x1={xForIndex(hoveredIndex)} y1={plot.top} x2={xForIndex(hoveredIndex)} y2={plot.bottom} />
              <circle className="ops-report-activity__selection-report" cx={xForIndex(hoveredIndex)} cy={yForValue(hovered.reports)} r="5" />
              <circle className="ops-report-activity__selection-baseline" cx={xForIndex(hoveredIndex)} cy={yForValue(hovered.baseline)} r="5" />
            </g>
          )}
        </svg>
        {hovered && hoveredIndex !== null && (
          <div
            className={`ops-report-activity__tooltip${hoveredIndex > buckets.length * 0.66 ? ' ops-report-activity__tooltip--right' : ''}`}
            style={{ left: `${(xForIndex(hoveredIndex) / width) * 100}%` }}
            role="status"
          >
            <time>{formatDate(hovered.at, { includeSeconds: false, locale })}</time>
            <span><i className="ops-report-activity__legend-dot ops-report-activity__legend-dot--baseline" />{translate('incidents.baseline')}: <strong>{decimalFormatter.format(hovered.baseline)}</strong></span>
            <span><i className="ops-report-activity__legend-dot" />{translate('incidents.reports')}: <strong>{hovered.reports}</strong></span>
          </div>
        )}
      </div>
    </section>
  )
}

function IncidentActivityChart({ incident, comments, translate }: { incident: IncidentViewModel; comments: readonly IncidentCommentViewModel[]; translate: (key: string, variables?: Record<string, string | number>) => string }) {
  const startedAt = Date.parse(incident.startedAt) || Date.now()
  const endedAt = Date.parse(incident.resolvedAt ?? '') || Math.max(Date.now(), startedAt + 1)
  const span = Math.max(endedAt - startedAt, 1)
  const width = 640
  const chartBottom = 122

  const statusY: Record<IncidentStatus, number> = { investigating: 24, identified: 52, monitoring: 82, resolved: 120 }
  const events = [{ at: startedAt, status: comments[0]?.status ?? 'investigating' as IncidentStatus }, ...comments.map((comment) => ({ at: Date.parse(comment.createdAt), status: comment.status ?? incident.status }))]
  if (incident.resolvedAt) events.push({ at: Date.parse(incident.resolvedAt), status: 'resolved' })
  else events.push({ at: endedAt, status: incident.status })
  const points = events.sort((left, right) => left.at - right.at).map((event) => `${Math.max(0, Math.min(width, ((event.at - startedAt) / span) * width))},${statusY[event.status]}`).join(' ')
  return <section className="ops-incident-activity"><header><div><span>{translate('incidents.lifecycle')}</span><h3>{translate('incidents.statusDynamics')}</h3></div><strong>{formatDuration(incident.durationSeconds)}</strong></header><svg viewBox={`0 0 ${width} 140`} preserveAspectRatio="none" role="img" aria-label={translate('incidents.statusDynamics')}><line x1="0" y1={chartBottom} x2={width} y2={chartBottom} /><line x1="0" y1="70" x2={width} y2="70" /><polyline points={points} /></svg><footer><span>{formatDate(incident.startedAt, { includeSeconds: true })}</span><span>{incident.resolvedAt ? formatDate(incident.resolvedAt, { includeSeconds: true }) : translate('incidents.now')}</span></footer></section>
}

export function IncidentsPage({
  incidents: initialIncidents = demoIncidents,
  monitors = demoMonitors,
  members = demoTeamMembers,
  initialComments = {},
	initialReports = {},
  onLoadIncidentDetails,
  onAssign,
  onComment,
  onResolve,
  onDownloadComplianceReport,
}: IncidentsPageProps) {
  const { t, locale } = useI18n()
	const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale])
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
  const [reports, setReports] = useState<Readonly<Record<string, readonly UserProblemReport[]>>>(() => initialReports)
  const loadedDetailIds = useRef(new Set([...Object.keys(initialComments), ...Object.keys(initialReports)]))
  const pendingDetailIds = useRef(new Set<string>())
  const mounted = useRef(true)
  const [detailLoads, setDetailLoads] = useState<Readonly<Record<string, IncidentDetailLoadState>>>(() =>
    Object.fromEntries([...loadedDetailIds.current].map((incidentId) => [incidentId, { status: 'ready' as const }])),
  )
  const [commentDraft, setCommentDraft] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [downloadingReport, setDownloadingReport] = useState(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

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
	const selectedReports = selected ? reports[selected.id] ?? [] : []
  const selectedAssignment = selected
    ? assignments[selected.id] ?? members.find((member) => member.name === selected.assignedTo)?.id ?? ''
    : ''

  const loadIncidentDetails = useCallback((incident: IncidentViewModel) => {
    if (incident.access === 'subscription' || !onLoadIncidentDetails) return
    if (loadedDetailIds.current.has(incident.id) || pendingDetailIds.current.has(incident.id)) return

    pendingDetailIds.current.add(incident.id)
    setDetailLoads((current) => ({ ...current, [incident.id]: { status: 'loading' } }))
    void onLoadIncidentDetails(incident.id).then(
      (detail) => {
        pendingDetailIds.current.delete(incident.id)
        loadedDetailIds.current.add(incident.id)
        if (!mounted.current) return
        setComments((current) => ({ ...current, [incident.id]: detail.comments }))
        setReports((current) => ({ ...current, [incident.id]: detail.reports }))
        setIncidents((current) => current.map((item) =>
          item.id === incident.id ? { ...item, commentCount: detail.comments.length } : item,
        ))
        setDetailLoads((current) => ({ ...current, [incident.id]: { status: 'ready' } }))
      },
      (error) => {
        pendingDetailIds.current.delete(incident.id)
        if (!mounted.current) return
        setDetailLoads((current) => ({
          ...current,
          [incident.id]: {
            status: 'error',
            error: error instanceof Error ? error.message : '',
          },
        }))
      },
    )
  }, [onLoadIncidentDetails])

  useEffect(() => {
    if (selected) loadIncidentDetails(selected)
  }, [loadIncidentDetails, selected])

  const selectedDetailLoad = selected && selected.access !== 'subscription' && onLoadIncidentDetails
    ? detailLoads[selected.id] ?? { status: 'loading' as const }
    : { status: 'ready' as const }

  const retryIncidentDetails = () => {
    if (!selected) return
    loadIncidentDetails(selected)
  }

  const displayedCommentCount = (incident: IncidentViewModel): number | string =>
    !onLoadIncidentDetails || detailLoads[incident.id]?.status === 'ready' ? incident.commentCount : '—'

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
  const showPrivateColumns = incidents.some((incident) => incident.access !== 'subscription')
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
        <div className="ops-notice__copy">
          <strong>{t('incidents.networkProtected')}</strong>
          <span>{t('incidents.networkProtectedHint')}</span>
        </div>
        <Link className="ops-notice__action" to="/checker-ips">
          {t('incidents.networkAllowlistAction')} <ArrowRight size={16} aria-hidden="true" />
        </Link>
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
                {showPrivateColumns && <th>{t('incidents.comments')}</th>}
                <th>{t('incidents.started')}</th>
                <th>{t('incidents.resolved')}</th>
                <th>{t('incidents.duration')}</th>
                {showPrivateColumns && <th>{t('incidents.assignee')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((incident) => (
                <tr key={incident.id}>
                  <td><Badge tone={incidentTone(incident.status)}>{formatStatus(incident.status)}</Badge></td>
                  <td><button className="ops-link-button" type="button" onClick={() => setSelectedId(incident.id)}>{incident.monitorName}</button></td>
                  <td><span className="ops-root-cause"><Badge tone="danger">{incident.rootCauseCode}</Badge>{incident.rootCause}</span></td>
                  {showPrivateColumns && <td>{incident.access === 'subscription' ? '—' : <span className="ops-inline-meta"><MessageSquareText size={15} />{displayedCommentCount(incident)}</span>}</td>}
                  <td>{formatDate(incident.startedAt, { includeSeconds: true })}</td>
                  <td>{incident.resolvedAt ? formatDate(incident.resolvedAt, { includeSeconds: true }) : '—'}</td>
                  <td>{formatDuration(incident.durationSeconds)}</td>
                  {showPrivateColumns && <td>{incident.access !== 'subscription' && incident.status !== 'resolved' && (assignments[incident.id] || incident.assignedTo) ? (
                    <span className="ops-assignee-badge"><UserRoundCheck size={15} />{memberById.get(assignments[incident.id])?.name ?? incident.assignedTo}</span>
                  ) : '—'}</td>}
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
              {incident.access !== 'subscription' && incident.status !== 'resolved' && (assignments[incident.id] || incident.assignedTo) && (
                <span className="ops-card-assignee"><UserRoundCheck size={15} />{memberById.get(assignments[incident.id])?.name ?? incident.assignedTo}</span>
              )}
              <span className="ops-card-row ops-card-row--muted"><span>{formatDate(incident.startedAt)}</span>{incident.access !== 'subscription' && <span>{detailLoads[incident.id]?.status === 'ready' || !onLoadIncidentDetails ? t('incidents.commentCount', { count: incident.commentCount }) : '—'}</span>}</span>
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

            {selected.access === 'subscription' ? (
              <>
                <div className="ops-notice ops-notice--compact" role="note">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div><strong>{t('subscriptions.readOnlyIncident')}</strong><span>{t('subscriptions.readOnlyIncidentHint')}</span></div>
                </div>
                <div className="ops-detail-summary ops-detail-summary--subscription">
                  <div><span>{t('incidents.monitor')}</span><strong>{selected.monitorName}</strong></div>
                  <div><span>{t('incidents.resolved')}</span><strong>{selected.resolvedAt ? formatDate(selected.resolvedAt, { includeSeconds: true }) : '—'}</strong></div>
                </div>
              </>
            ) : <>

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

            {selectedDetailLoad.status === 'loading' ? (
              <FeedbackBanner tone="info">{t('common.loading')}</FeedbackBanner>
            ) : selectedDetailLoad.status === 'error' ? (
              <FeedbackBanner
                tone="error"
                action={<Button size="sm" variant="secondary" type="button" onClick={retryIncidentDetails}>{t('common.tryAgain')}</Button>}
              >
                {selectedDetailLoad.error || t('incidents.actionFailed')}
              </FeedbackBanner>
            ) : <>

				{selected.source === 'user_report'
				? <VisitorReportActivityChart incident={selected} reports={selectedReports} translate={t} locale={locale} />
				: <IncidentActivityChart incident={selected} comments={selectedComments} translate={t} />}

			{selected.source === 'user_report' && (
				<section className="ops-report-journal">
					<header><div><span>{t('incidents.reportJournal')}</span><h3>{selected.reportReasonLabel ?? selected.rootCause}</h3></div><Badge tone="info">{t('incidents.signalCount', { count: selectedReports.length })}</Badge></header>
					<div className="ops-report-journal__table"><table><thead><tr><th>{t('incidents.time')}</th><th>{t('incidents.country')}</th><th>{t('incidents.provider')}</th><th>{t('incidents.ipAddress')}</th></tr></thead><tbody>{[...selectedReports].reverse().map((report) => <tr key={report.id}><td>{formatDate(report.reported_at, { includeSeconds: true })}</td><td>{report.country === 'T1' ? t('incidents.torNetwork') : report.country ? countryNames.of(report.country) ?? report.country : t('incidents.unknown')}</td><td>{[report.provider, report.asn].filter(Boolean).join(' · ') || t('incidents.unknown')}</td><td><code>{report.ip_address}</code></td></tr>)}</tbody></table>{selectedReports.length === 0 && <p>{t('incidents.noVisitorReports')}</p>}</div>
				</section>
			)}

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
                        <strong>{observation.region === 'local' ? 'Frankfurt' : observation.region}</strong>
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
            </>}
            </>}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default IncidentsPage
