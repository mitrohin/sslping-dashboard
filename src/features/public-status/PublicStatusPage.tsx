import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useParams } from 'react-router'
import {
  Activity,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  Cookie,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  ApiClient,
  ApiError,
  type MonitorStatus,
  type PublicStatusAnnouncement,
  type PublicStatusComponent,
  type PublicStatusSnapshot,
  type StatusPageLanguage,
  type SubscriptionAcceptedResponse,
} from '../../api'
import { formatDate, formatRelativeTime, formatStatus, formatUptime } from '../../lib/format'
import { publicStatusCopy, statusPageLocale, type PublicStatusCopy } from './i18n'
import { TurnstileWidget } from '../auth/TurnstileWidget'
import './public-status.css'

export type PublicStatusApi = Pick<ApiClient, 'getPublicStatusPage' | 'accessPublicStatusPage' | 'subscribeStatusPage'> & Partial<Pick<ApiClient, 'getPublicStatusPageByDomain' | 'accessPublicStatusPageByDomain' | 'reportPublicStatusProblem'>>

export interface PublicStatusPageProps {
  api?: PublicStatusApi
}

type Failure = { kind: 'not-found' | 'error'; message: string }
type ConsentChoice = 'necessary' | 'all'
type ProblemReportReceipt = {
  version: 1
  reasonKey: string
  reasonLabel: string
  reportedAt: string
  expiresAt: string
}

const defaultApi = new ApiClient()
const consentStorageKey = 'sslping.public-status.cookie-consent.v1'
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
const PROBLEM_REPORT_METADATA_URL = (import.meta.env.VITE_PROBLEM_REPORT_METADATA_URL ?? '/problem-report-metadata').trim()
const STATUS_PAGE_LANGUAGES: readonly StatusPageLanguage[] = ['en', 'zh', 'zh-Hant', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'id', 'de', 'nl', 'cs', 'da', 'fi', 'el', 'hr', 'hu', 'he', 'it', 'ja', 'ms', 'no', 'fil', 'ur', 'pl', 'ro', 'sr', 'sv', 'sl', 'sk', 'tr', 'uk']
const RTL_STATUS_PAGE_LANGUAGES = new Set<StatusPageLanguage>(['ar', 'he', 'ur'])
const PROBLEM_REPORT_RECEIPT_PREFIX = 'sslping_problem_report_v1'
const PROBLEM_REPORT_RECEIPT_TTL_SECONDS = 24 * 60 * 60

const statusPriority: Readonly<Record<MonitorStatus, number>> = {
  down: 5,
  degraded: 4,
  pending: 3,
  paused: 2,
  up: 1,
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(consentStorageKey)
    return value === 'necessary' || value === 'all' ? value : null
  } catch {
    return null
  }
}

function saveConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(consentStorageKey, choice)
  } catch {
    // The public page remains usable when browser storage is disabled.
  }
}

function problemReportReceiptCookieName(pageSlug: string, componentID: string): string {
  const safePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  return `${PROBLEM_REPORT_RECEIPT_PREFIX}_${safePart(pageSlug)}_${safePart(componentID)}`
}

function readProblemReportReceipt(cookieName: string): ProblemReportReceipt | null {
  if (typeof document === 'undefined') return null
  const prefix = `${cookieName}=`
  const rawValue = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length)
  if (!rawValue) return null
  try {
    const receipt = JSON.parse(decodeURIComponent(rawValue)) as Partial<ProblemReportReceipt>
    if (receipt.version !== 1 || typeof receipt.reasonKey !== 'string' || typeof receipt.reasonLabel !== 'string' || typeof receipt.reportedAt !== 'string' || typeof receipt.expiresAt !== 'string') return null
    if (!Number.isFinite(Date.parse(receipt.reportedAt)) || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= Date.now()) return null
    return receipt as ProblemReportReceipt
  } catch {
    return null
  }
}

function saveProblemReportReceipt(cookieName: string, reasonKey: string, reasonLabel: string): ProblemReportReceipt {
  const reportedAt = new Date()
  const receipt: ProblemReportReceipt = {
    version: 1,
    reasonKey: reasonKey.slice(0, 128),
    reasonLabel: reasonLabel.slice(0, 200),
    reportedAt: reportedAt.toISOString(),
    expiresAt: new Date(reportedAt.getTime() + PROBLEM_REPORT_RECEIPT_TTL_SECONDS * 1000).toISOString(),
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  try {
    document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(receipt))}; Max-Age=${PROBLEM_REPORT_RECEIPT_TTL_SECONDS}; Path=/; SameSite=Lax${secure}`
  } catch {
    // The acknowledgement still works when the browser blocks cookies; only
    // restoring it after a reload becomes unavailable.
  }
  return receipt
}

function deriveOverallStatus(
  explicit: MonitorStatus | undefined,
  components: readonly PublicStatusComponent[],
): MonitorStatus {
  if (explicit) return explicit
  if (components.length === 0) return 'pending'
  return [...components].sort((left, right) => statusPriority[right.status] - statusPriority[left.status])[0].status
}

function regionDisplayName(locale: string, countryCode: string): string {
  if (!countryCode) return ''
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryCode) ?? countryCode
  } catch {
    return countryCode
  }
}

function uptimeBars(uptime: number | undefined): readonly ('up' | 'down' | 'warning' | 'empty')[] {
  if (uptime === undefined) return Array.from({ length: 30 }, () => 'empty' as const)
  if (uptime >= 100) return Array.from({ length: 30 }, () => 'up' as const)
  const lost = Math.max(1, Math.min(29, Math.ceil(((100 - uptime) / 100) * 30)))
  return Array.from({ length: 30 }, (_, index) => {
    if (index < 30 - lost) return 'up' as const
    return uptime >= 99 ? 'warning' as const : 'down' as const
  })
}

type PublicBranding = { logoUrl: string; accentColor: string; backgroundColor: string; colorScheme: 'system' | 'light' | 'dark'; removeProductLogo: boolean; removeCookieConsent: boolean }
function publicBranding(value: unknown): PublicBranding {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const scheme = source.color_scheme
  return {
    logoUrl: typeof source.logo_url === 'string' ? source.logo_url.trim() : '',
    accentColor: typeof source.accent_color === 'string' ? source.accent_color : '#1eb873',
    backgroundColor: typeof source.background_color === 'string' ? source.background_color : '',
    colorScheme: scheme === 'dark' || scheme === 'light' ? scheme : 'system',
    removeProductLogo: source.remove_product_logo === true,
    removeCookieConsent: source.remove_cookie_consent === true,
  }
}

function StatusPageLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) return <Activity size={20} />

  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function usePreferredColorScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const update = () => setScheme(query.matches ? 'dark' : 'light')
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return scheme
}

const PUBLIC_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000
const PUBLIC_ACTIVITY_BUCKETS = 48

interface PublicActivityBucket {
  at: number
  reports: number
  baseline: number
}

function publicChartMaximum(value: number): number {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  return (normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
}

function publicActivityBuckets(points: NonNullable<PublicStatusComponent['report_activity']>, endAt: number): PublicActivityBucket[] {
  const startAt = endAt - PUBLIC_ACTIVITY_WINDOW_MS
  const interval = PUBLIC_ACTIVITY_WINDOW_MS / PUBLIC_ACTIVITY_BUCKETS
  const reports = Array.from({ length: PUBLIC_ACTIVITY_BUCKETS }, () => 0)
  for (const point of points) {
    const at = Date.parse(point.at)
    if (!Number.isFinite(at) || at < startAt || at > endAt) continue
    const index = Math.min(PUBLIC_ACTIVITY_BUCKETS - 1, Math.floor((at - startAt) / interval))
    reports[index] += Math.max(0, point.count)
  }
  const overallAverage = reports.reduce((sum, count) => sum + count, 0) / reports.length
  return reports.map((reportCount, index) => {
    const history = reports.slice(Math.max(0, index - 8), index)
    const trailingAverage = history.length > 0 ? history.reduce((sum, count) => sum + count, 0) / history.length : overallAverage
    return { at: startAt + (index + 0.5) * interval, reports: reportCount, baseline: trailingAverage * 0.7 + overallAverage * 0.3 }
  })
}

function CombinedActivityChart({ responsePoints, reportPoints, copy, locale, generatedAt }: { responsePoints: NonNullable<PublicStatusComponent['response_time']>; reportPoints: NonNullable<PublicStatusComponent['report_activity']>; copy: PublicStatusCopy; locale: string; generatedAt: string }) {
  const gradientId = `public-report-area-${useId().replace(/:/g, '')}`
  const parsedGeneratedAt = Date.parse(generatedAt)
  const latestPointAt = Math.max(0, ...[...responsePoints, ...reportPoints].map((point) => Date.parse(point.at)).filter(Number.isFinite))
  const endAt = Number.isFinite(parsedGeneratedAt) ? parsedGeneratedAt : Math.max(Date.now(), latestPointAt)
  const activity = useMemo(() => publicActivityBuckets(reportPoints, endAt), [endAt, reportPoints])
  const responses = useMemo(() => responsePoints
    .map((point) => ({ at: Date.parse(point.at), averageMS: point.average_ms }))
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.averageMS) && point.averageMS >= 0)
    .sort((left, right) => left.at - right.at), [responsePoints])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const decimalFormatter = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])

  if (responses.length < 2 && activity.every((bucket) => bucket.reports === 0)) return null

  const width = 960
  const height = 250
  const plot = { left: 42, right: 18, top: 40, bottom: 210 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = plot.bottom - plot.top
  const countMaximum = publicChartMaximum(Math.max(1, ...activity.flatMap((bucket) => [bucket.reports, bucket.baseline])))
  const responseValues = responses.map((point) => point.averageMS)
  const rawResponseMin = responseValues.length > 0 ? Math.min(...responseValues) : 0
  const rawResponseMax = responseValues.length > 0 ? Math.max(...responseValues) : 1
  const responsePadding = rawResponseMax === rawResponseMin ? Math.max(25, rawResponseMax * 0.1) : (rawResponseMax - rawResponseMin) * 0.12
  const responseMin = Math.max(0, rawResponseMin - responsePadding)
  const responseMax = rawResponseMax + responsePadding
  const xForTime = (at: number): number => plot.left + Math.max(0, Math.min(1, (at - (endAt - PUBLIC_ACTIVITY_WINDOW_MS)) / PUBLIC_ACTIVITY_WINDOW_MS)) * plotWidth
  const xForIndex = (index: number): number => plot.left + (index / (activity.length - 1)) * plotWidth
  const yForCount = (value: number): number => plot.bottom - (value / countMaximum) * plotHeight
  const yForResponse = (value: number): number => plot.bottom - ((value - responseMin) / Math.max(1, responseMax - responseMin)) * plotHeight
  const areaPoints = activity.map((bucket, index) => `${xForIndex(index)},${yForCount(bucket.reports)}`).join(' L ')
  const areaPath = `M ${plot.left},${plot.bottom} L ${areaPoints} L ${plot.left + plotWidth},${plot.bottom} Z`
  const baselinePath = `M ${activity.map((bucket, index) => `${xForIndex(index)},${yForCount(bucket.baseline)}`).join(' L ')}`
  const responsePath = responses.map((point) => `${xForTime(point.at)},${yForResponse(point.averageMS)}`).join(' L ')
  const hovered = hoveredIndex === null ? null : activity[hoveredIndex]
  const hoveredResponse = hovered ? responses.reduce<(typeof responses)[number] | null>((nearest, point) => !nearest || Math.abs(point.at - hovered.at) < Math.abs(nearest.at - hovered.at) ? point : nearest, null) : null
  const visibleHoveredResponse = hoveredResponse && hovered && Math.abs(hoveredResponse.at - hovered.at) <= 90 * 60 * 1000 ? hoveredResponse : null
  const xTicks = [0, 12, 24, 36, 47].map((index) => ({ index, x: xForIndex(index), label: timeFormatter.format(activity[index].at) }))

  const selectFromPointer = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0) return
    const viewBoxX = ((event.clientX - bounds.left) / bounds.width) * width
    const relativeX = Math.max(0, Math.min(plotWidth, viewBoxX - plot.left))
    setHoveredIndex(Math.round((relativeX / plotWidth) * (activity.length - 1)))
  }

  return (
    <div className="ps-combined-chart">
      <div className="ps-combined-chart__legend" aria-hidden="true">
        <span><i className="is-response" />{copy.responseTime}</span>
        <span><i className="is-reports" />{copy.visitorReports}</span>
        <span><i className="is-baseline" />{copy.baseline}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={copy.activityAndResponse}
        tabIndex={0}
        onPointerMove={selectFromPointer}
        onPointerLeave={() => setHoveredIndex(null)}
        onFocus={() => setHoveredIndex(activity.length - 1)}
        onBlur={() => setHoveredIndex(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const direction = event.key === 'ArrowLeft' ? -1 : 1
          setHoveredIndex((current) => Math.max(0, Math.min(activity.length - 1, (current ?? activity.length - 1) + direction)))
        }}
      >
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#13b8c8" stopOpacity=".72" /><stop offset="100%" stopColor="#13b8c8" stopOpacity=".04" /></linearGradient></defs>
        {[0, countMaximum / 2, countMaximum].map((tick) => <g className="ps-combined-chart__axis" key={tick}><line x1={plot.left} y1={yForCount(tick)} x2={plot.left + plotWidth} y2={yForCount(tick)} /><text x={plot.left - 9} y={yForCount(tick) + 4} textAnchor="end">{decimalFormatter.format(tick)}</text></g>)}
        {xTicks.map((tick) => <g className="ps-combined-chart__axis ps-combined-chart__axis--time" key={tick.index}><line x1={tick.x} y1={plot.top} x2={tick.x} y2={plot.bottom} /><text x={tick.x} y={plot.bottom + 25} textAnchor={tick.index === 0 ? 'start' : tick.index === 47 ? 'end' : 'middle'}>{tick.label}</text></g>)}
        <text className="ps-combined-chart__watermark" x={plot.left + plotWidth / 2} y={plot.top + plotHeight / 2} textAnchor="middle">SSLPing</text>
        <path className="ps-combined-chart__area" d={areaPath} fill={`url(#${gradientId})`} />
        <path className="ps-combined-chart__reports" d={`M ${areaPoints}`} />
        <path className="ps-combined-chart__baseline" d={baselinePath} />
        {responses.length >= 2 && <><path className="ps-combined-chart__response-shadow" d={`M ${responsePath}`} /><path className="ps-combined-chart__response" d={`M ${responsePath}`} /></>}
        {hovered && hoveredIndex !== null && <g className="ps-combined-chart__selection"><line x1={xForIndex(hoveredIndex)} y1={plot.top} x2={xForIndex(hoveredIndex)} y2={plot.bottom} /><circle className="is-report" cx={xForIndex(hoveredIndex)} cy={yForCount(hovered.reports)} r="5" /><circle className="is-baseline" cx={xForIndex(hoveredIndex)} cy={yForCount(hovered.baseline)} r="5" />{visibleHoveredResponse && <circle className="is-response" cx={xForIndex(hoveredIndex)} cy={yForResponse(visibleHoveredResponse.averageMS)} r="5" />}</g>}
      </svg>
      {hovered && hoveredIndex !== null && <div className={`ps-combined-chart__tooltip${hoveredIndex > activity.length * 0.66 ? ' is-right' : ''}`} style={{ left: `${(xForIndex(hoveredIndex) / width) * 100}%` }} role="status"><time>{formatDate(hovered.at, { locale })}</time><span><i className="is-response" />{copy.responseTime}<strong>{visibleHoveredResponse ? `${Math.round(visibleHoveredResponse.averageMS)} ${copy.millisecondsShort}` : '—'}</strong></span><span><i className="is-reports" />{copy.visitorReports}<strong>{hovered.reports}</strong></span><span><i className="is-baseline" />{copy.baseline}<strong>{decimalFormatter.format(hovered.baseline)}</strong></span></div>}
    </div>
  )
}

function statusIcon(status: MonitorStatus, size = 24) {
  if (status === 'up') return <CheckCircle2 size={size} />
  if (status === 'down') return <TriangleAlert size={size} />
  if (status === 'degraded') return <Activity size={size} />
  return <Clock3 size={size} />
}

function StatusDialog({
  open,
  title,
  children,
  onClose,
  closeLabel,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  closeLabel: string
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusable = dialog?.querySelector<HTMLElement>('input, button, a[href], select, textarea')
    focusable?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const items = [...dialog.querySelectorAll<HTMLElement>('input, button, a[href], select, textarea')]
        .filter((element) => !element.hasAttribute('disabled'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus()
    }
  }, [onClose, open])

  if (!open) return null
  return (
    <div className="ps-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={dialogRef} className="ps-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="ps-dialog__mark"><Bell size={21} /></span><h2 id={titleId}>{title}</h2></div><button type="button" className="ps-icon-button" aria-label={closeLabel} onClick={onClose}><X size={20} /></button></header>
        <div className="ps-dialog__body">{children}</div>
      </div>
    </div>
  )
}

function LoadingView({ copy }: { copy: PublicStatusCopy }) {
  return (
    <main className="public-status-page ps-state-page" aria-busy="true" aria-label={copy.loadingStatusPage}>
      <div className="ps-state-card ps-loading-card">
        <span className="ps-loader" />
        <div><span className="ps-skeleton ps-skeleton--title" /><span className="ps-skeleton" /></div>
        <span className="ps-skeleton ps-skeleton--panel" />
        <span className="ps-skeleton ps-skeleton--panel" />
      </div>
    </main>
  )
}

function FailureView({ failure, onRetry, copy }: { failure: Failure; onRetry: () => void; copy: PublicStatusCopy }) {
  const notFound = failure.kind === 'not-found'
  return (
    <main className="public-status-page ps-state-page">
      <section className="ps-state-card ps-failure-card">
        <span className="ps-state-icon">{notFound ? <Activity size={36} /> : <TriangleAlert size={36} />}</span>
        <p className="ps-kicker">{notFound ? `404 · ${copy.statusPageNotFound}` : copy.unableToLoadStatus}</p>
        <h1>{notFound ? copy.statusPageUnavailable : copy.latestStatusUnavailable}</h1>
        <p>{failure.message}</p>
        {!notFound && <button type="button" className="ps-button ps-button--primary" onClick={onRetry}><RefreshCw size={17} /> {copy.tryAgain}</button>}
        <a href="/" className="ps-text-link">{copy.goToSSLPing}</a>
      </section>
    </main>
  )
}

function PasswordView({
  pageName,
  busy,
  error,
  onSubmit,
  copy,
  captchaRequired,
  captchaReset,
}: {
  pageName: string
  busy: boolean
  error: string
  onSubmit: (password: string, turnstileToken?: string) => void
  copy: PublicStatusCopy
  captchaRequired: boolean
  captchaReset: number
}) {
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password) onSubmit(password, turnstileToken || undefined)
  }
  return (
    <main className="public-status-page ps-state-page">
      <section className="ps-state-card ps-password-card">
        <span className="ps-state-icon"><LockKeyhole size={34} /></span>
        <p className="ps-kicker">{copy.privatePage}</p>
        <h1>{pageName}</h1>
        <p>{copy.passwordPrompt}</p>
        <form onSubmit={submit}>
          <label htmlFor="status-page-password">{copy.password}</label>
          <div className="ps-input-with-icon"><KeyRound size={18} /><input id="status-page-password" autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={copy.passwordPlaceholder} required /></div>
          {error && <div className="ps-form-error" role="alert">{error}</div>}
          {captchaRequired && TURNSTILE_SITE_KEY && <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} action="status-page-access" resetSignal={captchaReset} onToken={setTurnstileToken} />}
          <button type="submit" className="ps-button ps-button--primary" disabled={busy || captchaRequired && Boolean(TURNSTILE_SITE_KEY) && !turnstileToken}>{busy ? copy.unlocking : copy.viewStatusPage}</button>
        </form>
        <small><ShieldCheck size={14} /> {copy.passwordSecurity}</small>
      </section>
    </main>
  )
}

function ProblemReportPanel({ component, copy, locale, pageSlug, onReport }: { component: PublicStatusComponent; copy: PublicStatusCopy; locale: string; pageSlug: string; onReport: (reasonKey: string, turnstileToken?: string) => Promise<void> }) {
  const cookieName = problemReportReceiptCookieName(pageSlug, component.id ?? component.name)
  const [pendingSelection, setPendingSelection] = useState<{ reasonKey: string; reasonLabel: string } | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [resetSignal, setResetSignal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<ProblemReportReceipt | null>(() => readProblemReportReceipt(cookieName))
  const submittingRef = useRef(false)
  const interactionLockedRef = useRef(Boolean(receipt))
  const options = component.report_options?.length ? component.report_options : [
    { key: 'not_working', label: copy.reportNotWorking, standard: true },
    { key: 'slow', label: copy.reportSlow, standard: true },
  ]

  const submit = useCallback(async (selection: { reasonKey: string; reasonLabel: string }, token?: string) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    try {
      await onReport(selection.reasonKey, token)
    } catch {
      // Use the same acknowledgement for accepted and rejected submissions.
      // This avoids exposing the anti-abuse decision as an oracle and keeps
      // visitors from retrying a report the backend has already seen.
    } finally {
      setReceipt(saveProblemReportReceipt(cookieName, selection.reasonKey, selection.reasonLabel))
      submittingRef.current = false
      setBusy(false)
      setPendingSelection(null)
      setTurnstileToken('')
      setResetSignal((value) => value + 1)
    }
  }, [cookieName, onReport])

  useEffect(() => {
    if (pendingSelection && turnstileToken) void submit(pendingSelection, turnstileToken)
  }, [pendingSelection, submit, turnstileToken])

  const choose = (reasonKey: string, reasonLabel: string) => {
    if (interactionLockedRef.current) return
    interactionLockedRef.current = true
    const selection = { reasonKey, reasonLabel }
    setPendingSelection(selection)
    if (!TURNSTILE_SITE_KEY) {
      void submit(selection)
    }
  }

  if (receipt) {
    return (
      <section className="ps-problem-report" aria-label={copy.reportProblem}>
        <div className="ps-problem-report__state is-received" role="status">
          <span className="ps-problem-report__state-icon"><CheckCircle2 size={18} /></span>
          <div><strong>{copy.reportReceiptTitle}</strong><span>{copy.reportReceiptSignal}: {receipt.reasonLabel}</span><time dateTime={receipt.reportedAt}>{copy.reportReceiptTime}: {formatDate(receipt.reportedAt, { includeSeconds: true, locale })}</time></div>
        </div>
      </section>
    )
  }

  if (pendingSelection || busy) {
    return (
      <section className="ps-problem-report" aria-label={copy.reportProblem} aria-busy="true">
        <div className="ps-problem-report__state is-processing" role="status" aria-live="polite"><span className="ps-problem-report__spinner" /><div><strong>{copy.reportProcessing}</strong><span>{copy.reportProcessingBody}</span></div></div>
        {pendingSelection && TURNSTILE_SITE_KEY && <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} action="status-problem-report" appearance="interaction-only" resetSignal={resetSignal} onToken={setTurnstileToken} />}
      </section>
    )
  }

  return (
    <section className="ps-problem-report" aria-label={copy.reportProblem}>
      <div className="ps-problem-report__heading"><TriangleAlert size={17} /><div><strong>{copy.reportProblem}</strong><span>{copy.selectIssue}</span></div></div>
      <div className="ps-problem-report__actions">
        {options.map((option) => {
          const label = option.key === 'not_working' ? copy.reportNotWorking : option.key === 'slow' ? copy.reportSlow : option.label
          return <button type="button" key={option.key} onClick={() => choose(option.key, label)}>{label}</button>
        })}
      </div>
    </section>
  )
}

function ComponentRow({ component, followEnabled, showBars, showPercentage, showResponseTime, showOutageDetails, copy, locale, pageSlug, generatedAt, onReport }: { component: PublicStatusComponent; followEnabled: boolean; showBars: boolean; showPercentage: boolean; showResponseTime: boolean; showOutageDetails: boolean; copy: PublicStatusCopy; locale: string; pageSlug: string; generatedAt: string; onReport?: (reasonKey: string, turnstileToken?: string) => Promise<void> }) {
  const bars = component.history_24h?.length ? component.history_24h : uptimeBars(component.uptime_24h)
  return (
    <article className="ps-component-row">
      <div className={`ps-component-state ps-component-state--${component.status}`}>{statusIcon(component.status, 18)}</div>
      <div className="ps-component-copy"><h3>{component.name}</h3><p>{component.last_checked_at ? `${copy.lastChecked} ${formatRelativeTime(component.last_checked_at, new Date(), { locale })}` : copy.waitingForFirstCheck}</p>{component.target && <p className="ps-component-target">{component.target}</p>}{showOutageDetails && Boolean(component.response_issues?.length) && <p className="ps-response-issue"><TriangleAlert size={13} /> {copy.highResponseTime}: {component.response_issues?.join(', ')}</p>}</div>
      {showBars && <div className="ps-uptime-bars" aria-label={`${copy.uptime24h}: ${formatUptime(component.uptime_24h, 3, locale)}`}>{bars.map((status, index) => <span key={index} className={`is-${status}`} />)}</div>}
      {showPercentage && <strong className="ps-uptime-value">{formatUptime(component.uptime_24h, 3, locale)}</strong>}
      <span className={`ps-status-label ps-status-label--${component.status}`}>{formatStatus(component.status, locale)}</span>
	  {followEnabled && component.follow_url && <a className="ps-component-follow" href={component.follow_url} aria-label={`${copy.followMonitor ?? 'Follow'}: ${component.name}`}><Bell size={14} /> {copy.followMonitor ?? 'Follow'}</a>}
	  {showResponseTime && <div className="ps-component-details"><div className="ps-component-details__heading"><div><strong>{copy.activityAndResponse}</strong><span>{copy.last24Hours}</span></div></div><CombinedActivityChart responsePoints={component.response_time ?? []} reportPoints={component.report_activity ?? []} copy={copy} locale={locale} generatedAt={generatedAt} /></div>}
	  {onReport && <ProblemReportPanel component={component} copy={copy} locale={locale} pageSlug={pageSlug} onReport={onReport} />}
    </article>
  )
}

function AnnouncementCard({ announcement, copy, locale }: { announcement: PublicStatusAnnouncement; copy: PublicStatusCopy; locale: string }) {
  const active = announcement.status !== 'resolved'
  return (
    <article className={`ps-announcement ${active ? 'is-active' : ''}`}>
      <span className="ps-timeline-dot" />
      <div className="ps-announcement__top"><span className={`ps-status-label ps-status-label--${announcement.status}`}>{formatStatus(announcement.status, locale)}</span><time dateTime={announcement.published_at}>{formatDate(announcement.published_at, { includeSeconds: true, locale })}</time></div>
      <h3>{announcement.title}</h3>
      <p>{announcement.body}</p>
      {announcement.resolved_at && <small><Check size={14} /> {copy.resolved} {formatRelativeTime(announcement.resolved_at, new Date(), { locale })}</small>}
    </article>
  )
}

export function PublicStatusPage({ api = defaultApi }: PublicStatusPageProps) {
  const { slug = '' } = useParams<{ slug: string }>()
  const hostname = window.location.hostname.toLowerCase()
  const customDomain = !['status.sslping.io', 'dashboard.sslping.io', 'localhost', '127.0.0.1'].includes(hostname) ? hostname : ''
  const [snapshot, setSnapshot] = useState<PublicStatusSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [captchaReset, setCaptchaReset] = useState(0)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [consent, setConsent] = useState<ConsentChoice | null>(readConsent)
  const preferredColorScheme = usePreferredColorScheme()
  const documentLocale = document.documentElement.lang.toLowerCase()
  const documentLanguageBase = documentLocale.split('-')[0]
  const documentLanguage = (documentLocale.startsWith('zh-hant') || /^zh-(?:hk|mo|tw)(?:-|$)/.test(documentLocale)
    ? 'zh-Hant'
    : documentLanguageBase === 'nb' ? 'no' : documentLanguageBase) as StatusPageLanguage
  const initialLanguage = STATUS_PAGE_LANGUAGES.includes(documentLanguage) ? documentLanguage : 'en'
  const languageRef = useRef<StatusPageLanguage>(initialLanguage)
  const passwordRef = useRef('')
  const language = (snapshot?.page.language ?? initialLanguage) as StatusPageLanguage
  const copy = publicStatusCopy(language)
  const countryCode = snapshot?.page.country_code ?? ''
  const locale = statusPageLocale(language, countryCode)
  const countryName = useMemo(() => regionDisplayName(locale, countryCode), [countryCode, locale])

  const load = useCallback(async (password?: string, background = false, turnstileToken?: string) => {
    if (!slug && !customDomain) {
      setFailure({ kind: 'not-found', message: publicStatusCopy(languageRef.current).addressIncomplete })
      setLoading(false)
      return
    }
    if (!background) setLoading(true)
    setFailure(null)
    if (password) setPasswordError('')
    try {
      // Submit passwords to the dedicated POST endpoint. This keeps the
      // browser flow on simple CORS headers and avoids varying caches on a
      // secret request header.
      const result = customDomain
        ? password ? await api.accessPublicStatusPageByDomain?.(customDomain, password, turnstileToken) : await api.getPublicStatusPageByDomain?.(customDomain)
        : password ? await api.accessPublicStatusPage(slug, password, turnstileToken) : await api.getPublicStatusPage(slug)
      if (!result) throw new Error('Custom-domain status pages are not available.')
      languageRef.current = result.page.language
      if (password) passwordRef.current = password
      setSnapshot(result)
      setCaptchaRequired(false)
      const locked = result.password_protected && result.components === null
      setPasswordRequired(locked)
      if (password && locked) setPasswordError(publicStatusCopy(result.page.language).passwordRejected)
    } catch (error) {
      const status = errorStatus(error)
      if (status === 401 || status === 403) {
        setPasswordRequired(true)
        if (password) {
          setPasswordError(publicStatusCopy(languageRef.current).incorrectPassword)
          setCaptchaRequired(true)
          setCaptchaReset((value) => value + 1)
        }
      } else if (status === 404) {
        setFailure({ kind: 'not-found', message: publicStatusCopy(languageRef.current).checkAddress })
      } else {
        setFailure({ kind: 'error', message: publicStatusCopy(languageRef.current).monitoringUnavailable })
      }
    } finally {
      if (!background) setLoading(false)
    }
  }, [api, customDomain, slug])

	const reportProblem = useCallback(async (componentId: string, reasonKey: string, turnstileToken?: string) => {
		if (customDomain) throw new Error('Problem reporting is unavailable on custom domains.')
		if (!api.reportPublicStatusProblem) throw new Error('Problem reporting is unavailable.')
		const accepted = await api.reportPublicStatusProblem(slug, componentId, reasonKey, turnstileToken)
		if (accepted.enrichment_token && PROBLEM_REPORT_METADATA_URL) {
			try {
				await fetch(PROBLEM_REPORT_METADATA_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token: accepted.enrichment_token }),
				})
			} catch {
				// The report is already accepted. Network enrichment is best effort.
			}
		}
  }, [api, customDomain, slug])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => void load(passwordRef.current || undefined, true), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!snapshot) return
    const previousLanguage = document.documentElement.lang
    const previousDirection = document.documentElement.dir
    const previousTitle = document.title
    const serverSocialTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
    const serverCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
    let hasMatchingServerMetadata = false
    if (serverSocialTitle && serverCanonical) {
      try {
        hasMatchingServerMetadata = new URL(serverCanonical, window.location.href).pathname.replace(/\/$/, '') === `/${snapshot.page.slug}`
      } catch {
        hasMatchingServerMetadata = false
      }
    }
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const robotsWasCreated = !robots
    const previousRobots = robots?.content
    if (!robots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.appendChild(robots)
    }
    const pageCountryCode = snapshot.page.country_code ?? ''
    document.documentElement.lang = pageCountryCode ? statusPageLocale(snapshot.page.language, pageCountryCode) : snapshot.page.language
    document.documentElement.dir = RTL_STATUS_PAGE_LANGUAGES.has(snapshot.page.language) ? 'rtl' : 'ltr'
    // Preserve the localized search-oriented title emitted by the server.
    // The shorter fallback is only for local Vite/demo routes whose static
    // dashboard shell has no page-specific social metadata.
    document.title = hasMatchingServerMetadata && serverSocialTitle
      ? serverSocialTitle
      : `${snapshot.page.name} · ${publicStatusCopy(snapshot.page.language).currentStatus}`
    robots.content = snapshot.page.robots
    return () => {
      document.documentElement.lang = previousLanguage
      document.documentElement.dir = previousDirection
      document.title = previousTitle
      if (robotsWasCreated) robots?.remove()
      else if (robots && previousRobots !== undefined) robots.content = previousRobots
    }
  }, [snapshot])

  if (loading && !passwordRequired) return <LoadingView copy={copy} />
  if (failure) return <FailureView failure={failure} copy={copy} onRetry={() => void load()} />
  if (passwordRequired) {
    return <PasswordView pageName={snapshot?.page.name ?? copy.protectedPage} busy={loading} error={passwordError} copy={copy} captchaRequired={captchaRequired} captchaReset={captchaReset} onSubmit={(password, token) => void load(password, false, token)} />
  }
  if (!snapshot) return <LoadingView copy={copy} />

  const settings = snapshot.page.settings
  const visibleComponents = (snapshot.components ?? []).filter((component) => !(settings.hide_paused_monitors && component.status === 'paused'))
  const announcements = snapshot.announcements ?? []
  const activeIncidentStates = new Map<string, { unresolved: boolean; resolved: boolean }>()
  for (const announcement of announcements) {
    const key = announcement.incident_id || announcement.id
    const state = activeIncidentStates.get(key) ?? { unresolved: false, resolved: false }
    if (announcement.status === 'resolved' || announcement.resolved_at) state.resolved = true
    else state.unresolved = true
    activeIncidentStates.set(key, state)
  }
  const activeIncidentCount = [...activeIncidentStates.values()].filter((state) => state.unresolved && !state.resolved).length
  const overallStatus = deriveOverallStatus(snapshot.overall_status, visibleComponents)
  const overall = copy.overall[overallStatus]
  const uptimeValues = visibleComponents.map((component) => component.uptime_24h).filter((value): value is number => value !== undefined)
  const overallUptime = uptimeValues.length > 0 ? uptimeValues.reduce((total, value) => total + value, 0) / uptimeValues.length : undefined
  const smallConsent = settings.small_cookie_dialog
  const branding = publicBranding(snapshot.page.branding)
  const resolvedColorScheme = branding.colorScheme === 'system' ? preferredColorScheme : branding.colorScheme
  const pageStyle = {
    '--ps-green': branding.accentColor,
    '--ps-green-dark': branding.accentColor,
    ...(branding.backgroundColor ? { '--ps-page-background': branding.backgroundColor } : {}),
  } as CSSProperties

  const chooseConsent = (choice: ConsentChoice) => {
    saveConsent(choice)
    setConsent(choice)
  }

  return (
    <div className="public-status-page" data-color-scheme={resolvedColorScheme} style={pageStyle}>
      <header className="ps-header">
        <div className="ps-container ps-header__inner">
          {snapshot.page.homepage_url ? (
            <a className="ps-brand" href={snapshot.page.homepage_url} target="_blank" rel="noreferrer"><span className="ps-brand__mark" aria-hidden="true"><StatusPageLogo key={branding.logoUrl || 'fallback'} src={branding.logoUrl} /></span><span>{snapshot.page.name}</span><ExternalLink size={14} /></a>
          ) : (
            <div className="ps-brand"><span className="ps-brand__mark" aria-hidden="true"><StatusPageLogo key={branding.logoUrl || 'fallback'} src={branding.logoUrl} /></span><span>{snapshot.page.name}</span></div>
          )}
          {settings.enable_subscribe && <button type="button" className="ps-button ps-button--outline" onClick={() => setSubscriptionOpen(true)}><Bell size={16} /> {copy.subscribeToUpdates}</button>}
        </div>
      </header>

      <main className="ps-container ps-main">
        <section className={`ps-overall ps-overall--${overallStatus}`} aria-live="polite">
          <div className="ps-overall__icon">{statusIcon(overallStatus, 29)}</div>
          <div><p>{copy.currentStatus}{countryName && <span className="ps-country-name"> · {countryName}</span>}</p><h1>{overall.title}</h1><span>{overall.description}</span></div>
          <time dateTime={snapshot.generated_at}>{copy.updated} {formatRelativeTime(snapshot.generated_at, new Date(), { locale })}</time>
        </section>

        {settings.show_overall_percentage && (
          <section className="ps-metrics" aria-label={copy.overallUptime}>
            <article><span>{copy.last24Hours}</span><strong>{formatUptime(overallUptime, 3, locale)}</strong><small>{copy.overallUptime}</small></article>
            <article><span>{copy.services}</span><strong>{visibleComponents.length}</strong><small>{visibleComponents.filter((component) => component.status === 'up').length} {copy.operational}</small></article>
            <article><span>{copy.activeIncidents}</span><strong>{activeIncidentCount}</strong><small>{copy.publishedUpdates}</small></article>
          </section>
        )}

        <section className="ps-section">
          <div className="ps-section-heading"><div><p className="ps-kicker">{copy.liveMonitoring}</p><h2>{copy.services}</h2></div><span>{visibleComponents.length} {copy.components}</span></div>
          <div className="ps-components-card">
			{visibleComponents.length > 0 ? visibleComponents.map((component) => <ComponentRow key={component.id || component.name} component={component} followEnabled={snapshot.page.monitor_follow_enabled} showBars={settings.show_bar_charts} showPercentage={settings.show_uptime_percentage} showResponseTime={settings.show_response_time} showOutageDetails={settings.show_outage_details} copy={copy} locale={locale} pageSlug={slug} generatedAt={snapshot.generated_at} onReport={customDomain ? undefined : (reasonKey, token) => reportProblem(component.id ?? '', reasonKey, token)} />) : <div className="ps-empty"><Clock3 size={27} /><h3>{copy.noComponents}</h3><p>{copy.noComponentsBody}</p></div>}
          </div>
        </section>

        {(settings.show_latest_downtime || announcements.length > 0) && (
          <section className="ps-section">
            <div className="ps-section-heading"><div><p className="ps-kicker">{copy.latestUpdates}</p><h2>{copy.incidentsAndAnnouncements}</h2></div></div>
            <div className={`ps-announcements ${announcements.length === 0 ? 'is-empty' : ''}`}>
              {announcements.length > 0 ? announcements.map((announcement) => <AnnouncementCard key={announcement.id} announcement={announcement} copy={copy} locale={locale} />) : <div className="ps-empty ps-empty--bordered"><ShieldCheck size={29} /><h3>{copy.noIncidents}</h3><p>{copy.noIncidentsBody}</p></div>}
            </div>
          </section>
        )}

        {settings.enable_subscribe && (
          <section className="ps-subscribe-card">
            <span className="ps-subscribe-card__icon"><Mail size={25} /></span>
            <div><p className="ps-kicker">{copy.stayInformed}</p><h2>{copy.emailUpdates}</h2><span>{copy.emailUpdatesBody}</span></div>
            <button type="button" className="ps-button ps-button--primary" onClick={() => setSubscriptionOpen(true)}>{copy.subscribe}</button>
          </section>
        )}
      </main>

      <footer className="ps-footer">
        <div className="ps-container">{!branding.removeProductLogo && <span>{copy.poweredBy} <strong>SSLPing</strong></span>}<nav aria-label={copy.footerLabel}><button type="button" onClick={() => setPrivacyOpen(true)}>{copy.privacy}</button>{!branding.removeCookieConsent && <button type="button" onClick={() => setConsent(null)}>{copy.cookieSettings}</button>}<span>{copy.generated} {formatDate(snapshot.generated_at, { includeSeconds: true, locale })}</span></nav></div>
      </footer>

      <SubscriptionDialog open={subscriptionOpen} slug={snapshot.page.slug} api={api} copy={copy} onClose={() => setSubscriptionOpen(false)} onPrivacy={() => setPrivacyOpen(true)} />
      <StatusDialog open={privacyOpen} title={copy.privacyNotice} closeLabel={copy.close} onClose={() => setPrivacyOpen(false)}>
        <div className="ps-privacy-copy"><p>{copy.privacyBody}</p><h3>{copy.emailSubscriptions}</h3><p>{copy.emailSubscriptionsBody}</p><h3>{copy.cookies}</h3><p>{copy.cookiesBody}</p><button type="button" className="ps-button ps-button--primary" onClick={() => setPrivacyOpen(false)}>{copy.understood}</button></div>
      </StatusDialog>

      {!branding.removeCookieConsent && consent === null && (
        <aside className={`ps-cookie-banner ${smallConsent ? 'is-compact' : ''}`} aria-label={copy.cookieConsent}>
          <span className="ps-cookie-icon"><Cookie size={22} /></span>
          <div><strong>{copy.privacyChoice}</strong><p>{copy.privacyChoiceBody}</p><button type="button" onClick={() => setPrivacyOpen(true)}>{copy.readPrivacyNotice}</button></div>
          <div className="ps-cookie-actions"><button type="button" className="ps-button ps-button--quiet" onClick={() => chooseConsent('necessary')}>{copy.necessaryOnly}</button><button type="button" className="ps-button ps-button--primary" onClick={() => chooseConsent('all')}>{copy.acceptOptional}</button></div>
        </aside>
      )}
    </div>
  )
}

function SubscriptionDialog({
  open,
  slug,
  api,
  onClose,
  onPrivacy,
  copy,
}: {
  open: boolean
  slug: string
  api: PublicStatusApi
  onClose: () => void
  onPrivacy: () => void
  copy: PublicStatusCopy
}) {
  const [email, setEmail] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SubscriptionAcceptedResponse | null>(null)

  useEffect(() => {
    if (!open) return
    setEmail('')
    setAccepted(false)
    setError('')
    setResult(null)
  }, [open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!accepted) {
      setError(copy.subscriptionConsentRequired)
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await api.subscribeStatusPage(slug, email.trim().toLowerCase())
      setResult(response)
    } catch {
      setError(copy.subscriptionError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StatusDialog open={open} title={copy.subscribeTitle} closeLabel={copy.close} onClose={onClose}>
      {result ? (
        <div className="ps-subscription-success"><span><CheckCircle2 size={31} /></span><h3>{copy.checkInbox}</h3><p>{copy.subscriptionConfirmationSent}</p><button type="button" className="ps-button ps-button--primary" onClick={onClose}>{copy.done}</button></div>
      ) : (
        <form className="ps-subscribe-form" onSubmit={submit}>
          <p>{copy.subscriptionIntro}</p>
          <label htmlFor="status-subscription-email">{copy.emailAddress}</label>
          <div className="ps-input-with-icon"><Mail size={18} /><input id="status-subscription-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <label className="ps-consent-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>{copy.subscriptionConsent} <button type="button" onClick={onPrivacy}>{copy.privacyNotice}</button></span></label>
          {error && <div className="ps-form-error" role="alert">{error}</div>}
          <button type="submit" className="ps-button ps-button--primary" disabled={busy}>{busy ? copy.subscribing : copy.sendConfirmation}</button>
        </form>
      )}
    </StatusDialog>
  )
}

export const PublicStatusPageRoute = PublicStatusPage
