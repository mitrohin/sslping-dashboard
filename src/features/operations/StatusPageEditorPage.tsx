import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ExternalLink,
  Globe2,
  GripVertical,
  Megaphone,
  MonitorCog,
  Palette,
  Plus,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import {
  DEMO_NOW,
  demoMonitors,
  demoStatusPages,
  type MonitorViewModel,
  type StatusPageViewModel,
} from '../../data'
import { formatDate, formatStatus } from '../../lib/format'
import { Badge, Button, FeedbackBanner, Field, Modal, PageHeader, Panel, SearchInput, Select, Toggle } from '../../components/ui'
import type {
  RobotsPolicy,
  StatusPageAnnouncementInput,
  StatusPageAnnouncementViewModel,
  StatusPageEditorValue,
  StatusPageFeatureSettings,
  StatusPageLanguageCode,
} from './types'
import './operations.css'

type MaybePromise<T> = T | Promise<T>
export type StatusPageEditorTab = 'monitors' | 'appearance' | 'global' | 'announcements'

// Dynamic customer-host TLS and routing are deliberately disabled for the
// first production release. Keep the inactive controls visible so the roadmap
// is clear without letting a customer verify a domain that cannot be served.
const customStatusDomainsAvailable = false
const statusSubscriptionsAvailable = false

export interface StatusPageEditorPageProps {
  page?: StatusPageViewModel
  monitors?: readonly MonitorViewModel[]
  initialValue?: StatusPageEditorValue
  announcements?: readonly StatusPageAnnouncementViewModel[]
  onBack?: () => void
  onPreview?: (page: StatusPageViewModel) => void
  onSave?: (value: StatusPageEditorValue) => MaybePromise<void>
  onClaimDomain?: (domain: string) => MaybePromise<void>
  onVerifyDomain?: (domain: string) => MaybePromise<void>
  onAnnouncement?: (input: StatusPageAnnouncementInput) => MaybePromise<void>
}

const languages: ReadonlyArray<{ code: StatusPageLanguageCode; label: string }> = [
  { code: 'en', label: 'English' }, { code: 'zh', label: '中文' }, { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' }, { code: 'fr', label: 'Français' }, { code: 'ar', label: 'العربية' },
  { code: 'bn', label: 'বাংলা' }, { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'id', label: 'Bahasa Indonesia' },
]

const defaultFeatures: StatusPageFeatureSettings = {
  showBarCharts: true,
  showUptimePercentage: true,
  showOverallPercentage: true,
  showOutageDetails: true,
  enableDetailsPage: true,
  enableFloatingStatusBar: false,
  showMonitorUrl: false,
  hidePausedMonitors: true,
  enableSubscribe: false,
  showLatestDowntime: true,
  smallCookieDialog: true,
  shareAnalytics: false,
}

function makeDefaultValue(page: StatusPageViewModel, monitors: readonly MonitorViewModel[]): StatusPageEditorValue {
	const publishableMonitors = monitors.filter((monitor) => monitor.type !== 'leakcheck' && monitor.type !== 'compliance')
  return {
    name: page.name,
    slug: page.slug,
    homepageUrl: 'https://example.com',
    customDomain: page.customDomain ?? '',
    googleAnalyticsId: '',
    language: page.languageCode ?? 'en',
    robots: 'noindex,nofollow',
    published: page.status === 'published',
    passwordEnabled: page.accessLevel === 'password',
    password: '',
    removeCookieConsent: false,
	monitorIds: publishableMonitors.slice(0, page.monitorCount).map((monitor) => monitor.id),
    branding: {
      logoUrl: '',
      accentColor: '#34d77b',
      backgroundColor: '#101824',
      colorScheme: 'dark',
      removeProductLogo: false,
    },
    features: defaultFeatures,
  }
}

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

function SettingsToggle({ checked, onChange, title, description, disabled = false }: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description: string
  disabled?: boolean
}) {
  return (
    <div className={`ops-setting-toggle ${disabled ? 'is-disabled' : ''}`}>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
      <div><strong>{title}</strong><span>{description}</span></div>
    </div>
  )
}

function EditorSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Panel className="ops-editor-section">
      <div className="panel__header"><h2>{icon}{title}<span className="title-dot">.</span></h2></div>
      <div className="panel__body">{children}</div>
    </Panel>
  )
}

export function StatusPageEditorPage({
  page = demoStatusPages[0],
  monitors = demoMonitors,
  initialValue,
  announcements: initialAnnouncements = [],
  onBack,
  onPreview,
  onSave,
  onClaimDomain,
  onVerifyDomain,
  onAnnouncement,
}: StatusPageEditorPageProps) {
  const [tab, setTab] = useState<StatusPageEditorTab>('global')
  const [value, setValue] = useState<StatusPageEditorValue>(() => initialValue ?? makeDefaultValue(page, monitors))
  const [monitorQuery, setMonitorQuery] = useState('')
  const [announcements, setAnnouncements] = useState<StatusPageAnnouncementViewModel[]>(() => [...initialAnnouncements])
  const [announcementOpen, setAnnouncementOpen] = useState(false)
  const [announcementDraft, setAnnouncementDraft] = useState<StatusPageAnnouncementInput>({ title: '', body: '', status: 'investigating' })
  const [domainState, setDomainState] = useState<'idle' | 'pending' | 'verified'>(page.customDomainVerified ? 'verified' : page.customDomain ? 'pending' : 'idle')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
	const publishableMonitors = useMemo(() => monitors.filter((monitor) => monitor.type !== 'leakcheck' && monitor.type !== 'compliance'), [monitors])
	const publishableMonitorIds = useMemo(() => new Set(publishableMonitors.map((monitor) => monitor.id)), [publishableMonitors])

  const selectedMonitors = useMemo(
	() => value.monitorIds.map((id) => publishableMonitors.find((monitor) => monitor.id === id)).filter((monitor): monitor is MonitorViewModel => Boolean(monitor)),
	[publishableMonitors, value.monitorIds],
  )
  const availableMonitors = useMemo(() => {
    const query = monitorQuery.trim().toLowerCase()
    return query
	  ? publishableMonitors.filter((monitor) => monitor.name.toLowerCase().includes(query) || monitor.target.toLowerCase().includes(query))
	  : publishableMonitors
	}, [monitorQuery, publishableMonitors])

  const update = <Key extends keyof StatusPageEditorValue>(key: Key, next: StatusPageEditorValue[Key]) =>
    setValue((current) => ({ ...current, [key]: next }))
  const updateBranding = <Key extends keyof StatusPageEditorValue['branding']>(key: Key, next: StatusPageEditorValue['branding'][Key]) =>
    setValue((current) => ({ ...current, branding: { ...current.branding, [key]: next } }))
  const updateFeature = (key: keyof StatusPageFeatureSettings, next: boolean) =>
    setValue((current) => ({ ...current, features: { ...current.features, [key]: next } }))

  const toggleMonitor = (monitorId: string, checked: boolean) => {
    const current = value.monitorIds
    update('monitorIds', checked ? [...current, monitorId] : current.filter((id) => id !== monitorId))
  }

  const moveMonitor = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= value.monitorIds.length) return
    const next = [...value.monitorIds]
    ;[next[index], next[target]] = [next[target], next[index]]
    update('monitorIds', next)
  }

  const save = async () => {
    setBusy('save')
    setError('')
    setMessage('')
    try {
	  await onSave?.({ ...value, monitorIds: value.monitorIds.filter((id) => publishableMonitorIds.has(id)) })
      setMessage('Changes saved.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Changes could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  const claimDomain = async () => {
    if (!value.customDomain.trim()) return
    setBusy('domain')
    setError('')
    setDomainState('pending')
    try {
      await onClaimDomain?.(value.customDomain.trim())
      setMessage('Domain claimed. Add the TXT record, then verify it.')
    } catch (caught) {
      setDomainState('idle')
      setError(caught instanceof Error ? caught.message : 'The custom domain could not be claimed.')
    } finally {
      setBusy(null)
    }
  }

  const verifyDomain = async () => {
    setBusy('verify')
    setError('')
    try {
      await onVerifyDomain?.(value.customDomain.trim())
      setDomainState('verified')
      setMessage('Custom domain verified.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'TXT verification is still pending.')
    } finally {
      setBusy(null)
    }
  }

  const publishAnnouncement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!announcementDraft.title.trim() || !announcementDraft.body.trim()) return
    const next: StatusPageAnnouncementViewModel = {
      ...announcementDraft,
      id: makeId(),
      title: announcementDraft.title.trim(),
      body: announcementDraft.body.trim(),
      publishedAt: DEMO_NOW,
    }
    setAnnouncements((current) => [next, ...current])
    setBusy('announcement')
    setError('')
    try {
      await onAnnouncement?.(announcementDraft)
      setAnnouncementOpen(false)
      setAnnouncementDraft({ title: '', body: '', status: 'investigating' })
    } catch (caught) {
      setAnnouncements((current) => current.filter((item) => item.id !== next.id))
      setError(caught instanceof Error ? caught.message : 'The announcement could not be published.')
    } finally {
      setBusy(null)
    }
  }

  const tabButtons: ReadonlyArray<{ id: StatusPageEditorTab; label: string; icon: ReactNode }> = [
    { id: 'monitors', label: 'Monitors', icon: <MonitorCog size={17} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={17} /> },
    { id: 'global', label: 'Global settings', icon: <Settings2 size={17} /> },
    { id: 'announcements', label: 'Announcements', icon: <Megaphone size={17} /> },
  ]

  return (
    <div className="page page--wide ops-page ops-status-editor">
      <button className="ops-back-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Status pages</button>
      <PageHeader
        title={<>Edit <span className="success-text">{value.name}</span> status page</>}
        description={<>Public status page hosted at <a className="ops-text-link" href={page.url} target="_blank" rel="noreferrer">{page.url}</a></>}
        actions={
          <>
            <Button variant="secondary" type="button" onClick={() => onPreview?.(page)}><ExternalLink size={17} /> Preview</Button>
            <Button type="button" onClick={() => setAnnouncementOpen(true)}><Megaphone size={17} /> Add announcement</Button>
          </>
        }
      />

      <div className="ops-editor-layout">
        <main className="ops-editor-content">
          {tab === 'monitors' && (
            <>
              <EditorSection title="Visible monitors" icon={<MonitorCog size={20} />}>
                <div className="ops-toolbar ops-toolbar--compact">
                  <SearchInput value={monitorQuery} onChange={(event) => setMonitorQuery(event.target.value)} placeholder="Search monitors" aria-label="Search monitors" />
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
				  onClick={() => update('monitorIds', value.monitorIds.length === publishableMonitors.length ? [] : publishableMonitors.map((monitor) => monitor.id))}
				>
				  {value.monitorIds.length === publishableMonitors.length ? 'Clear all' : 'Select all'}
                  </Button>
                </div>
                <div className="ops-monitor-picker">
                  {availableMonitors.map((monitor) => (
                    <label key={monitor.id}>
                      <input type="checkbox" checked={value.monitorIds.includes(monitor.id)} onChange={(event) => toggleMonitor(monitor.id, event.target.checked)} />
                      <span><strong>{monitor.name}</strong><small>{monitor.typeLabel} · {monitor.target}</small></span>
                    </label>
                  ))}
                </div>
              </EditorSection>

              <EditorSection title="Display order">
                {selectedMonitors.length === 0 ? <p className="muted">Select at least one monitor to build the page.</p> : (
                  <ol className="ops-sortable-list">
                    {selectedMonitors.map((monitor, index) => (
                      <li key={monitor.id}>
                        <GripVertical size={17} />
                        <span><strong>{monitor.name}</strong><small>{monitor.target}</small></span>
                        <button type="button" onClick={() => moveMonitor(index, -1)} disabled={index === 0} aria-label={`Move ${monitor.name} up`}><ArrowUp size={16} /></button>
                        <button type="button" onClick={() => moveMonitor(index, 1)} disabled={index === selectedMonitors.length - 1} aria-label={`Move ${monitor.name} down`}><ArrowDown size={16} /></button>
                      </li>
                    ))}
                  </ol>
                )}
              </EditorSection>
            </>
          )}

          {tab === 'appearance' && (
            <>
              <EditorSection title="Name & homepage" icon={<Globe2 size={20} />}>
                <div className="form-grid">
                  <Field label="Name of the status page" hint="Used in the heading and browser title."><input value={value.name} onChange={(event) => update('name', event.target.value)} maxLength={160} /></Field>
                  <Field label="Homepage URL" hint="The logo and page title link target."><input type="url" value={value.homepageUrl} onChange={(event) => update('homepageUrl', event.target.value)} placeholder="https://example.com" /></Field>
                </div>
              </EditorSection>
              <EditorSection title="Brand appearance" icon={<Palette size={20} />}>
                <div className="form-grid form-grid--three">
                  <Field label="Logo URL"><input type="url" value={value.branding.logoUrl} onChange={(event) => updateBranding('logoUrl', event.target.value)} placeholder="https://…/logo.svg" /></Field>
                  <Field label="Accent color"><input type="color" value={value.branding.accentColor} onChange={(event) => updateBranding('accentColor', event.target.value)} /></Field>
                  <Field label="Background"><input type="color" value={value.branding.backgroundColor} onChange={(event) => updateBranding('backgroundColor', event.target.value)} /></Field>
                </div>
                <Field label="Color scheme">
                  <Select value={value.branding.colorScheme} onChange={(event) => updateBranding('colorScheme', event.target.value as StatusPageEditorValue['branding']['colorScheme'])}>
                    <option value="system">Follow visitor system</option><option value="light">Light</option><option value="dark">Dark</option>
                  </Select>
                </Field>
                <div className="ops-brand-preview" style={{ background: value.branding.backgroundColor, borderColor: value.branding.accentColor }}>
                  <span style={{ background: value.branding.accentColor }} />
                  <div><strong>{value.name || 'Status page'}</strong><small>All systems operational</small></div>
                </div>
              </EditorSection>
            </>
          )}

          {tab === 'global' && (
            <>
              <EditorSection title="Language & search engines" icon={<Globe2 size={20} />}>
                <div className="form-grid">
                  <Field label="Public page language" hint="Controls all system text, dates and status labels on the public page.">
                    <Select value={value.language} onChange={(event) => update('language', event.target.value as StatusPageLanguageCode)}>{languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</Select>
                  </Field>
                  <Field label="Robots meta tag"><Select value={value.robots} onChange={(event) => update('robots', event.target.value as RobotsPolicy)}><option value="index,follow">index, follow</option><option value="noindex,nofollow">noindex, nofollow</option><option value="noindex,follow">noindex, follow</option></Select></Field>
                </div>
              </EditorSection>

              <EditorSection title="White-label" icon={<ShieldCheck size={20} />}>
                <div className="form-grid">
                  {customStatusDomainsAvailable ? (
                    <Field label="Custom domain" hint="Create the required TXT record before verification.">
                      <div className="ops-inline-field"><input value={value.customDomain} onChange={(event) => { update('customDomain', event.target.value.toLowerCase().replace(/\.$/, '')); setDomainState('idle') }} placeholder="status.example.com" /><Button variant="secondary" type="button" disabled={!value.customDomain || busy !== null} onClick={() => void claimDomain()}>Claim</Button></div>
                    </Field>
                  ) : (
                    <Field label="Custom domain" hint="Coming soon after managed TLS and customer-host routing are enabled.">
                      <input value="" placeholder="Available soon" disabled />
                    </Field>
                  )}
                  <Field label="Google Analytics" hint="Measurement ID stored in branding configuration."><input value={value.googleAnalyticsId} onChange={(event) => update('googleAnalyticsId', event.target.value.toUpperCase())} placeholder="G-XXXXXXXXXX" pattern="G-[A-Z0-9]+" /></Field>
                </div>
                {customStatusDomainsAvailable && domainState === 'pending' && (
                  <div className="ops-domain-challenge">
                    <div><span>TXT name</span><code>_sslping-verification.{value.customDomain}</code></div>
                    <div><span>TXT value</span><code>sslping-verification=••••••••••••••••</code></div>
                    <Button size="sm" type="button" disabled={busy !== null} onClick={() => void verifyDomain()}>Verify DNS</Button>
                  </div>
                )}
                {customStatusDomainsAvailable && domainState === 'verified' && <div className="ops-success"><Check size={17} /> Custom domain verified</div>}
                <div className="ops-settings-grid">
                  <SettingsToggle checked={value.branding.removeProductLogo} onChange={(next) => updateBranding('removeProductLogo', next)} title="Remove SSLPing logo" description="Hide the powered-by link in the public footer." />
                  <SettingsToggle checked={value.removeCookieConsent} onChange={(next) => update('removeCookieConsent', next)} title="Remove cookie consent" description="Available only when a verified custom domain is used." disabled={!customStatusDomainsAvailable || domainState !== 'verified'} />
                </div>
              </EditorSection>

              <EditorSection title="Access">
                <SettingsToggle checked={value.passwordEnabled} onChange={(next) => update('passwordEnabled', next)} title="Password" description="Restrict this status page to visitors with a password." />
                {value.passwordEnabled && <Field label="Status page password" hint="Leave empty to preserve the current password."><input type="password" value={value.password} onChange={(event) => update('password', event.target.value)} minLength={12} maxLength={72} autoComplete="new-password" placeholder="••••••••••••" /></Field>}
                <SettingsToggle checked={value.published} onChange={(next) => update('published', next)} title="Published" description="Make this page reachable through its public URL." />
              </EditorSection>

              <EditorSection title="Features">
                <div className="ops-settings-grid">
                  <SettingsToggle checked={value.features.showBarCharts} onChange={(next) => updateFeature('showBarCharts', next)} title="Show bar charts" description="Display recent monitor uptime bars." />
                  <SettingsToggle checked={value.features.showOutageDetails} onChange={(next) => updateFeature('showOutageDetails', next)} title="Show outage details" description="Explain outage reasons and status codes." />
                  <SettingsToggle checked={value.features.showUptimePercentage} onChange={(next) => updateFeature('showUptimePercentage', next)} title="Show uptime percentage" description="Display uptime beside each monitor." />
                  <SettingsToggle checked={value.features.enableDetailsPage} onChange={(next) => updateFeature('enableDetailsPage', next)} title="Enable details page" description="Let visitors inspect monitor history." />
                  <SettingsToggle checked={value.features.enableFloatingStatusBar} onChange={(next) => updateFeature('enableFloatingStatusBar', next)} title="Enable floating status bar" description="Keep overall health visible at the bottom." />
                  <SettingsToggle checked={value.features.showMonitorUrl} onChange={(next) => updateFeature('showMonitorUrl', next)} title="Show monitor URL" description="Reveal monitor URL and type." />
                  <SettingsToggle checked={value.features.showOverallPercentage} onChange={(next) => updateFeature('showOverallPercentage', next)} title="Show overall percentage" description="Show 24-hour, 7-day and 30-day availability." />
                  <SettingsToggle checked={value.features.hidePausedMonitors} onChange={(next) => updateFeature('hidePausedMonitors', next)} title="Hide paused monitors" description="Do not display paused components." />
                  <SettingsToggle checked={value.features.showLatestDowntime} onChange={(next) => updateFeature('showLatestDowntime', next)} title="Show outage updates and latest downtime" description="Group recent outages in the announcement feed." />
                  <SettingsToggle checked={statusSubscriptionsAvailable && value.features.enableSubscribe} onChange={(next) => updateFeature('enableSubscribe', next)} title="Enable subscribe feature" description="Available soon after subscriber abuse protection is enabled." disabled={!statusSubscriptionsAvailable} />
                </div>
              </EditorSection>

              <EditorSection title="Privacy">
                <div className="ops-settings-grid">
                  <SettingsToggle checked={value.features.shareAnalytics} onChange={(next) => updateFeature('shareAnalytics', next)} title="Help us improve" description="Share anonymous status-page analytics." />
                  <SettingsToggle checked={value.features.smallCookieDialog} onChange={(next) => updateFeature('smallCookieDialog', next)} title="Use small cookie dialog" description="Use the compact visitor consent experience." />
                </div>
              </EditorSection>
            </>
          )}

          {tab === 'announcements' && (
            <EditorSection title="Announcements" icon={<Megaphone size={20} />}>
              <div className="ops-section-heading"><p className="muted">Publish incident and maintenance updates to subscribers.</p><Button type="button" size="sm" onClick={() => setAnnouncementOpen(true)}><Plus size={16} /> Add announcement</Button></div>
              {announcements.length === 0 ? <div className="ops-filter-empty"><Megaphone size={27} /><strong>No announcements yet</strong><span>Publish an update when customers need context.</span></div> : (
                <div className="ops-announcement-list">
                  {announcements.map((announcement) => (
                    <article key={announcement.id}><div><Badge tone={announcement.status === 'resolved' ? 'success' : 'warning'}>{formatStatus(announcement.status)}</Badge><time>{formatDate(announcement.publishedAt)}</time></div><h3>{announcement.title}</h3><p>{announcement.body}</p></article>
                  ))}
                </div>
              )}
            </EditorSection>
          )}

          {(message || error) && <FeedbackBanner tone={error ? 'error' : 'success'} onDismiss={() => { setError(''); setMessage('') }}>{error || message}</FeedbackBanner>}
          <div className="ops-sticky-save"><Button size="lg" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save changes'}</Button></div>
        </main>

        <nav className="ops-editor-tabs" aria-label="Status page editor sections">
          {tabButtons.map((item) => <button type="button" key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}
        </nav>
      </div>

      <Modal open={announcementOpen} onClose={() => setAnnouncementOpen(false)} title="Add announcement" icon={<Megaphone size={35} />} width="md">
        <form className="ops-form" onSubmit={publishAnnouncement}>
          <Field label="Title"><input value={announcementDraft.title} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, title: event.target.value }))} required maxLength={200} /></Field>
          <Field label="Message"><textarea value={announcementDraft.body} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, body: event.target.value }))} required maxLength={10_000} /></Field>
          <Field label="Status"><Select value={announcementDraft.status} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, status: event.target.value as StatusPageAnnouncementInput['status'] }))}><option value="investigating">Investigating</option><option value="identified">Identified</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></Select></Field>
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setAnnouncementOpen(false)}>Cancel</Button><Button type="submit" disabled={busy !== null}><Megaphone size={17} /> Publish announcement</Button></div>
        </form>
      </Modal>
    </div>
  )
}

export default StatusPageEditorPage
