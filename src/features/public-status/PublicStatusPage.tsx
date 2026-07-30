import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
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
import './public-status.css'

export type PublicStatusApi = Pick<ApiClient, 'getPublicStatusPage' | 'accessPublicStatusPage' | 'subscribeStatusPage'> & Partial<Pick<ApiClient, 'getPublicStatusPageByDomain' | 'accessPublicStatusPageByDomain'>>

export interface PublicStatusPageProps {
  api?: PublicStatusApi
}

type Failure = { kind: 'not-found' | 'error'; message: string }
type ConsentChoice = 'necessary' | 'all'

const defaultApi = new ApiClient()
const consentStorageKey = 'sslping.public-status.cookie-consent.v1'

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
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

function deriveOverallStatus(
  explicit: MonitorStatus | undefined,
  components: readonly PublicStatusComponent[],
): MonitorStatus {
  if (explicit) return explicit
  if (components.length === 0) return 'pending'
  return [...components].sort((left, right) => statusPriority[right.status] - statusPriority[left.status])[0].status
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

type PublicBranding = { logoUrl: string; accentColor: string; backgroundColor: string; colorScheme: 'system' | 'light' | 'dark'; removeProductLogo: boolean; removeCookieConsent: boolean; floatingStatusBar: boolean }
function publicBranding(value: unknown): PublicBranding {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const scheme = source.color_scheme
  return {
    logoUrl: typeof source.logo_url === 'string' ? source.logo_url : '',
    accentColor: typeof source.accent_color === 'string' ? source.accent_color : '#1eb873',
    backgroundColor: typeof source.background_color === 'string' ? source.background_color : '',
    colorScheme: scheme === 'dark' || scheme === 'light' ? scheme : 'system',
    removeProductLogo: source.remove_product_logo === true,
    removeCookieConsent: source.remove_cookie_consent === true,
    floatingStatusBar: source.enable_floating_status_bar === true,
  }
}

function ResponseChart({ points }: { points: NonNullable<PublicStatusComponent['response_time']> }) {
  if (points.length < 2) return null
  const max = Math.max(...points.map((point) => point.average_ms), 1)
  const coordinates = points.map((point, index) => `${(index / (points.length - 1)) * 180},${34 - (point.average_ms / max) * 30}`).join(' ')
  const average = Math.round(points.reduce((sum, point) => sum + point.average_ms, 0) / points.length)
  return <div className="ps-response-chart" aria-label={`Average response time ${average} ms`}><svg viewBox="0 0 180 38" preserveAspectRatio="none" role="img"><polyline points={coordinates} /></svg><span>{average} ms avg</span></div>
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
  closeLabel = 'Close',
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  closeLabel?: string
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

function LoadingView() {
  return (
    <main className="public-status-page ps-state-page" aria-busy="true" aria-label="Loading status page">
      <div className="ps-state-card ps-loading-card">
        <span className="ps-loader" />
        <div><span className="ps-skeleton ps-skeleton--title" /><span className="ps-skeleton" /></div>
        <span className="ps-skeleton ps-skeleton--panel" />
        <span className="ps-skeleton ps-skeleton--panel" />
      </div>
    </main>
  )
}

function FailureView({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  const notFound = failure.kind === 'not-found'
  return (
    <main className="public-status-page ps-state-page">
      <section className="ps-state-card ps-failure-card">
        <span className="ps-state-icon">{notFound ? <Activity size={36} /> : <TriangleAlert size={36} />}</span>
        <p className="ps-kicker">{notFound ? '404 · Status page not found' : 'Unable to load status'}</p>
        <h1>{notFound ? 'This status page is unavailable.' : 'We could not retrieve the latest status.'}</h1>
        <p>{failure.message}</p>
        {!notFound && <button type="button" className="ps-button ps-button--primary" onClick={onRetry}><RefreshCw size={17} /> Try again</button>}
        <a href="/" className="ps-text-link">Go to SSLPing</a>
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
}: {
  pageName: string
  busy: boolean
  error: string
  onSubmit: (password: string) => void
  copy: PublicStatusCopy
}) {
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password) onSubmit(password)
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
          <button type="submit" className="ps-button ps-button--primary" disabled={busy}>{busy ? copy.unlocking : copy.viewStatusPage}</button>
        </form>
        <small><ShieldCheck size={14} /> {copy.passwordSecurity}</small>
      </section>
    </main>
  )
}

function ComponentRow({ component, showBars, showPercentage, showResponseTime, showOutageDetails, enableDetails, copy, locale }: { component: PublicStatusComponent; showBars: boolean; showPercentage: boolean; showResponseTime: boolean; showOutageDetails: boolean; enableDetails: boolean; copy: PublicStatusCopy; locale: string }) {
  const bars = component.history_24h?.length ? component.history_24h : uptimeBars(component.uptime_24h)
  const [expanded, setExpanded] = useState(false)
  return (
    <article className="ps-component-row">
      <div className={`ps-component-state ps-component-state--${component.status}`}>{statusIcon(component.status, 18)}</div>
      <div className="ps-component-copy"><h3>{component.name}</h3><p>{component.last_checked_at ? `${copy.lastChecked} ${formatRelativeTime(component.last_checked_at, new Date(), { locale })}` : copy.waitingForFirstCheck}</p>{component.target && <p className="ps-component-target">{component.target}</p>}{showOutageDetails && Boolean(component.response_issues?.length) && <p className="ps-response-issue"><TriangleAlert size={13} /> High response time: {component.response_issues?.join(', ')}</p>}{enableDetails && <button className="ps-details-toggle" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide details' : 'Details'}</button>}</div>
      {showBars && <div className="ps-uptime-bars" aria-label={`${copy.uptime24h}: ${formatUptime(component.uptime_24h, 3, locale)}`}>{bars.map((status, index) => <span key={index} className={`is-${status}`} />)}</div>}
      {showResponseTime && <ResponseChart points={component.response_time ?? []} />}
      {showPercentage && <strong className="ps-uptime-value">{formatUptime(component.uptime_24h, 3, locale)}</strong>}
      <span className={`ps-status-label ps-status-label--${component.status}`}>{formatStatus(component.status, locale)}</span>
      {expanded && <div className="ps-component-details"><strong>24-hour checks</strong><span>{bars.filter((status) => status === 'up').length} healthy · {bars.filter((status) => status === 'warning').length} slow · {bars.filter((status) => status === 'down').length} failed</span></div>}
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
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [consent, setConsent] = useState<ConsentChoice | null>(readConsent)
  const languageRef = useRef<StatusPageLanguage>('en')
  const passwordRef = useRef('')
  const language = (snapshot?.page.language ?? 'en') as StatusPageLanguage
  const copy = publicStatusCopy(language)
  const locale = statusPageLocale(language)

  const load = useCallback(async (password?: string, background = false) => {
    if (!slug && !customDomain) {
      setFailure({ kind: 'not-found', message: 'The status page address is incomplete.' })
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
        ? password ? await api.accessPublicStatusPageByDomain?.(customDomain, password) : await api.getPublicStatusPageByDomain?.(customDomain)
        : password ? await api.accessPublicStatusPage(slug, password) : await api.getPublicStatusPage(slug)
      if (!result) throw new Error('Custom-domain status pages are not available.')
      languageRef.current = result.page.language
      if (password) passwordRef.current = password
      setSnapshot(result)
      const locked = result.password_protected && result.components === null
      setPasswordRequired(locked)
      if (password && locked) setPasswordError(publicStatusCopy(result.page.language).passwordRejected)
    } catch (error) {
      const status = errorStatus(error)
      if (status === 401 || status === 403) {
        setPasswordRequired(true)
        if (password) setPasswordError(publicStatusCopy(languageRef.current).incorrectPassword)
      } else if (status === 404) {
        setFailure({ kind: 'not-found', message: 'Check the address or ask the service owner for an updated link.' })
      } else {
        setFailure({ kind: 'error', message: errorMessage(error, 'The monitoring service did not respond. Please try again shortly.') })
      }
    } finally {
      if (!background) setLoading(false)
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
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const robotsWasCreated = !robots
    const previousRobots = robots?.content
    if (!robots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.appendChild(robots)
    }
    document.documentElement.lang = snapshot.page.language
    document.documentElement.dir = snapshot.page.language === 'ar' ? 'rtl' : 'ltr'
    document.title = `${snapshot.page.name} · ${publicStatusCopy(snapshot.page.language).currentStatus}`
    robots.content = snapshot.page.robots
    return () => {
      document.documentElement.lang = previousLanguage
      document.documentElement.dir = previousDirection
      document.title = previousTitle
      if (robotsWasCreated) robots?.remove()
      else if (robots && previousRobots !== undefined) robots.content = previousRobots
    }
  }, [snapshot])

  if (loading && !passwordRequired) return <LoadingView />
  if (failure) return <FailureView failure={failure} onRetry={() => void load()} />
  if (passwordRequired) {
    return <PasswordView pageName={snapshot?.page.name ?? copy.protectedPage} busy={loading} error={passwordError} copy={copy} onSubmit={(password) => void load(password)} />
  }
  if (!snapshot) return <LoadingView />

  const settings = snapshot.page.settings
  const visibleComponents = (snapshot.components ?? []).filter((component) => !(settings.hide_paused_monitors && component.status === 'paused'))
  const announcements = snapshot.announcements ?? []
  const overallStatus = deriveOverallStatus(snapshot.overall_status, visibleComponents)
  const overall = copy.overall[overallStatus]
  const uptimeValues = visibleComponents.map((component) => component.uptime_24h).filter((value): value is number => value !== undefined)
  const overallUptime = uptimeValues.length > 0 ? uptimeValues.reduce((total, value) => total + value, 0) / uptimeValues.length : undefined
  const smallConsent = settings.small_cookie_dialog
  const branding = publicBranding(snapshot.page.branding)
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
    <div className="public-status-page" data-color-scheme={branding.colorScheme} style={pageStyle}>
      <header className="ps-header">
        <div className="ps-container ps-header__inner">
          {snapshot.page.homepage_url ? (
            <a className="ps-brand" href={snapshot.page.homepage_url} target="_blank" rel="noreferrer"><span className="ps-brand__mark">{branding.logoUrl ? <img src={branding.logoUrl} alt="" /> : <Activity size={20} />}</span><span>{snapshot.page.name}</span><ExternalLink size={14} /></a>
          ) : (
            <div className="ps-brand"><span className="ps-brand__mark">{branding.logoUrl ? <img src={branding.logoUrl} alt="" /> : <Activity size={20} />}</span><span>{snapshot.page.name}</span></div>
          )}
          {settings.enable_subscribe && <button type="button" className="ps-button ps-button--outline" onClick={() => setSubscriptionOpen(true)}><Bell size={16} /> {copy.subscribeToUpdates}</button>}
        </div>
      </header>

      <main className="ps-container ps-main">
        <section className={`ps-overall ps-overall--${overallStatus}`} aria-live="polite">
          <div className="ps-overall__icon">{statusIcon(overallStatus, 29)}</div>
          <div><p>{copy.currentStatus}</p><h1>{overall.title}</h1><span>{overall.description}</span></div>
          <time dateTime={snapshot.generated_at}>{copy.updated} {formatRelativeTime(snapshot.generated_at, new Date(), { locale })}</time>
        </section>

        {settings.show_overall_percentage && (
          <section className="ps-metrics" aria-label={copy.overallUptime}>
            <article><span>{copy.last24Hours}</span><strong>{formatUptime(overallUptime, 3, locale)}</strong><small>{copy.overallUptime}</small></article>
            <article><span>{copy.services}</span><strong>{visibleComponents.length}</strong><small>{visibleComponents.filter((component) => component.status === 'up').length} {copy.operational}</small></article>
            <article><span>{copy.activeIncidents}</span><strong>{announcements.filter((announcement) => announcement.status !== 'resolved').length}</strong><small>{copy.publishedUpdates}</small></article>
          </section>
        )}

        <section className="ps-section">
          <div className="ps-section-heading"><div><p className="ps-kicker">{copy.liveMonitoring}</p><h2>{copy.services}</h2></div><span>{visibleComponents.length} {copy.components}</span></div>
          <div className="ps-components-card">
            {visibleComponents.length > 0 ? visibleComponents.map((component) => <ComponentRow key={component.name} component={component} showBars={settings.show_bar_charts} showPercentage={settings.show_uptime_percentage} showResponseTime={settings.show_response_time} showOutageDetails={settings.show_outage_details} enableDetails={settings.enable_details_page} copy={copy} locale={locale} />) : <div className="ps-empty"><Clock3 size={27} /><h3>{copy.noComponents}</h3><p>{copy.noComponentsBody}</p></div>}
          </div>
        </section>

        {(settings.show_latest_downtime || announcements.length > 0) && (
          <section className="ps-section">
            <div className="ps-section-heading"><div><p className="ps-kicker">{copy.latestUpdates}</p><h2>{copy.incidentsAndAnnouncements}</h2></div></div>
            <div className="ps-announcements">
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
        <div className="ps-container">{!branding.removeProductLogo && <span>Powered by <strong>SSLPing</strong></span>}<nav aria-label={copy.footerLabel}><button type="button" onClick={() => setPrivacyOpen(true)}>{copy.privacy}</button>{!branding.removeCookieConsent && <button type="button" onClick={() => setConsent(null)}>{copy.cookieSettings}</button>}<span>{copy.generated} {formatDate(snapshot.generated_at, { includeSeconds: true, locale })}</span></nav></div>
      </footer>

      {branding.floatingStatusBar && <div className={`ps-floating-status ps-floating-status--${overallStatus}`}>{statusIcon(overallStatus, 16)}<strong>{overall.title}</strong><span>{copy.updated} {formatRelativeTime(snapshot.generated_at, new Date(), { locale })}</span></div>}

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
    } catch (subscriptionError) {
      setError(errorMessage(subscriptionError, copy.subscriptionConsentRequired))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StatusDialog open={open} title={copy.subscribeTitle} closeLabel={copy.close} onClose={onClose}>
      {result ? (
        <div className="ps-subscription-success"><span><CheckCircle2 size={31} /></span><h3>{copy.checkInbox}</h3><p>{result.message}</p><button type="button" className="ps-button ps-button--primary" onClick={onClose}>{copy.done}</button></div>
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
