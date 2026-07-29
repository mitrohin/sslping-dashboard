import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ExternalLink,
  Globe2,
  LockKeyhole,
  Megaphone,
  MoreHorizontal,
  Plus,
  Radio,
} from 'lucide-react'
import {
  DEMO_NOW,
  demoMonitors,
  demoStatusPages,
  type MonitorViewModel,
  type StatusPageViewModel,
} from '../../data'
import { formatDate, formatStatus } from '../../lib/format'
import { Badge, Button, EmptyState, FeedbackBanner, Field, IconButton, Modal, PageHeader, Panel, SearchInput, Select, Toggle } from '../../components/ui'
import type { StatusPageAnnouncementInput, StatusPageCreateInput, StatusPageLanguageCode } from './types'
import './operations.css'
import { useI18n } from '../../app/I18nProvider'

type MaybePromise<T> = T | Promise<T>

export interface StatusPagesPageProps {
  pages?: readonly StatusPageViewModel[]
  monitors?: readonly MonitorViewModel[]
  initialCreateMonitorId?: string
  onCreate?: (input: StatusPageCreateInput) => MaybePromise<StatusPageViewModel | void>
  onAnnouncement?: (pageId: string, input: StatusPageAnnouncementInput) => MaybePromise<void>
  onEdit?: (pageId: string) => void
  onDelete?: (pageId: string) => MaybePromise<void>
}

const languageOptions: ReadonlyArray<{ value: StatusPageLanguageCode; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: 'العربية' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'id', label: 'Bahasa Indonesia' },
]

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)

const emptyCreate: StatusPageCreateInput = {
  name: '',
  slug: '',
  homepageUrl: '',
  accessLevel: 'public',
  password: '',
  language: 'en',
  published: true,
  monitorIds: [],
}

const emptyAnnouncement: StatusPageAnnouncementInput = {
  title: '',
  body: '',
  status: 'investigating',
}

export function StatusPagesPage({
  pages: initialPages = demoStatusPages,
  monitors = demoMonitors,
  initialCreateMonitorId,
  onCreate,
  onAnnouncement,
  onEdit,
  onDelete,
}: StatusPagesPageProps) {
  const { locale, t } = useI18n()
  const [pages, setPages] = useState<StatusPageViewModel[]>(() => [...initialPages])
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<StatusPageCreateInput>(emptyCreate)
  const [announcementPageId, setAnnouncementPageId] = useState<string | null>(null)
  const [announcementDraft, setAnnouncementDraft] = useState<StatusPageAnnouncementInput>(emptyAnnouncement)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
	const publishableMonitors = useMemo(() => monitors.filter((monitor) => monitor.type !== 'leakcheck' && monitor.type !== 'compliance'), [monitors])

  useEffect(() => {
	if (!initialCreateMonitorId || !publishableMonitors.some((monitor) => monitor.id === initialCreateMonitorId)) return
	const monitor = publishableMonitors.find((item) => item.id === initialCreateMonitorId)
    const suggestedName = monitor ? `${monitor.name} status` : ''
    setError('')
    setCreateDraft({
      ...emptyCreate,
      name: suggestedName,
      slug: toSlug(suggestedName),
      monitorIds: [initialCreateMonitorId],
    })
    setCreateOpen(true)
	}, [initialCreateMonitorId, publishableMonitors])

  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return pages
    return pages.filter((page) =>
      page.name.toLowerCase().includes(normalized) ||
      page.slug.toLowerCase().includes(normalized) ||
      page.customDomain?.toLowerCase().includes(normalized),
    )
  }, [pages, query])

  const updateCreate = <Key extends keyof StatusPageCreateInput>(
    key: Key,
    value: StatusPageCreateInput[Key],
  ) => setCreateDraft((current) => ({ ...current, [key]: value }))

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = createDraft.name.trim()
    const slug = toSlug(createDraft.slug || name)
    if (!name || !slug) {
      setError(t('statusPages.validationName'))
      return
    }
    if (createDraft.accessLevel === 'password' && createDraft.password.length < 12) {
      setError(t('statusPages.validationPassword'))
      return
    }

	const allowedMonitorIds = new Set(publishableMonitors.map((monitor) => monitor.id))
	const input: StatusPageCreateInput = { ...createDraft, name, slug, monitorIds: createDraft.monitorIds.filter((id) => allowedMonitorIds.has(id)) }
    const languageLabel = languageOptions.find((option) => option.value === input.language)?.label ?? input.language
    const optimistic: StatusPageViewModel = {
      id: makeId(),
      name,
      slug,
      url: `https://status.sslping.io/status/${slug}`,
      monitorCount: input.monitorIds.length,
      accessLevel: input.accessLevel,
      status: input.published ? 'published' : 'draft',
      language: languageLabel,
      customDomainVerified: false,
      announcementCount: 0,
      subscribers: 0,
      updatedAt: DEMO_NOW,
    }
    setPages((current) => [optimistic, ...current])
    setBusy(true)
    setError('')
    try {
      const persisted = await onCreate?.(input)
      if (persisted) {
        setPages((current) => current.map((page) => page.id === optimistic.id ? persisted : page))
      }
      setCreateOpen(false)
      setCreateDraft(emptyCreate)
    } catch (caught) {
      setPages((current) => current.filter((page) => page.id !== optimistic.id))
      setError(caught instanceof Error ? caught.message : t('statusPages.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submitAnnouncement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!announcementPageId || !announcementDraft.title.trim() || !announcementDraft.body.trim()) return
    const pageId = announcementPageId
    const input = {
      ...announcementDraft,
      title: announcementDraft.title.trim(),
      body: announcementDraft.body.trim(),
    }
    setPages((current) => current.map((page) =>
      page.id === pageId
        ? { ...page, announcementCount: page.announcementCount + 1, updatedAt: DEMO_NOW }
        : page,
    ))
    setBusy(true)
    setError('')
    try {
      await onAnnouncement?.(pageId, input)
      setAnnouncementPageId(null)
      setAnnouncementDraft(emptyAnnouncement)
    } catch (caught) {
      setPages((current) => current.map((page) =>
        page.id === pageId
          ? { ...page, announcementCount: Math.max(0, page.announcementCount - 1) }
          : page,
      ))
      setError(caught instanceof Error ? caught.message : t('statusPages.announcementFailed'))
    } finally {
      setBusy(false)
    }
  }

  const deletePage = async (page: StatusPageViewModel) => {
    if (!window.confirm(t('statusPages.confirmDelete', { name: page.name }))) return
    const snapshot = pages
    setPages((current) => current.filter((item) => item.id !== page.id))
    try {
      await onDelete?.(page.id)
    } catch (caught) {
      setPages(snapshot)
      setError(caught instanceof Error ? caught.message : t('statusPages.deleteFailed'))
    }
  }

  return (
    <div className="page page--wide ops-page">
      <PageHeader
        title={t('statusPages.title')}
        description={t('statusPages.description')}
        actions={<Button type="button" onClick={() => { setError(''); setCreateDraft((current) => ({ ...current, language: locale === 'ka' || locale === 'tr' ? 'en' : locale })); setCreateOpen(true) }}><Plus size={18} /> {t('statusPages.create')}</Button>}
      />

      {pages.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Radio size={36} />}
            title={t('statusPages.create')}
            description={t('statusPages.emptyHint')}
            action={<Button type="button" onClick={() => setCreateOpen(true)}><Plus size={18} /> {t('statusPages.create')}</Button>}
          />
        </Panel>
      ) : (
        <>
          <div className="ops-toolbar ops-toolbar--compact">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('statusPages.search')} aria-label={t('statusPages.search')} />
            <span className="ops-result-count">{t('statusPages.count', { filtered: filteredPages.length, total: pages.length })}</span>
          </div>
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          <Panel className="ops-table-panel">
            <div className="ops-table-scroll ops-desktop-only">
              <table className="ops-data-table">
                <thead><tr><th>{t('statusPages.name')}</th><th>{t('statusPages.access')}</th><th>{t('common.status')}</th><th>{t('statusPages.updated')}</th><th className="ops-actions-column">{t('common.actions')}</th></tr></thead>
                <tbody>
                  {filteredPages.map((page) => (
                    <tr key={page.id}>
                      <td>
                        <div className="ops-name-cell"><span className="ops-round-icon"><Radio size={18} /></span><span><strong>{page.name}</strong><small>{t('statusPages.stats', { monitors: page.monitorCount, subscribers: page.subscribers })}</small></span></div>
                      </td>
                      <td><span className="ops-inline-meta">{page.accessLevel === 'public' ? <Globe2 size={16} /> : <LockKeyhole size={16} />}{t(`statusPages.access.${page.accessLevel}`)}</span></td>
                      <td><Badge tone={page.status === 'published' ? 'success' : 'neutral'}>{t(`statusPages.status.${page.status}`)}</Badge></td>
                      <td>{formatDate(page.updatedAt)}</td>
                      <td>
                        <div className="ops-row-actions">
                          <Button size="sm" type="button" onClick={() => { setAnnouncementPageId(page.id); setError('') }}><Megaphone size={16} /> {t('statusPages.addAnnouncement')}</Button>
                          <a className="icon-button" href={page.url} target="_blank" rel="noreferrer" aria-label={t('monitors.open', { name: page.name })} title={t('statusPages.openPublic')}><ExternalLink size={17} /></a>
                          <IconButton label={t('maintenance.editNamed', { name: page.name })} onClick={() => onEdit?.(page.id)}><MoreHorizontal size={18} /></IconButton>
                          {onDelete && <Button variant="ghost" size="sm" type="button" onClick={() => void deletePage(page)}>{t('common.delete')}</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ops-mobile-only ops-card-list">
              {filteredPages.map((page) => (
                <article className="ops-resource-card" key={page.id}>
                  <div className="ops-card-row"><span className="ops-round-icon"><Radio size={18} /></span><Badge tone={page.status === 'published' ? 'success' : 'neutral'}>{page.status}</Badge></div>
                  <h2>{page.name}</h2>
                  <p>{t('statusPages.mobileStats', { monitors: page.monitorCount, access: t(`statusPages.access.${page.accessLevel}`), subscribers: page.subscribers })}</p>
                  <div className="ops-card-actions">
                    <Button size="sm" type="button" onClick={() => setAnnouncementPageId(page.id)}><Megaphone size={16} /> {t('statusPages.announce')}</Button>
                    <Button size="sm" variant="secondary" type="button" onClick={() => onEdit?.(page.id)}>{t('common.edit')}</Button>
                    <a className="icon-button" href={page.url} target="_blank" rel="noreferrer" aria-label={t('monitors.open', { name: page.name })}><ExternalLink size={17} /></a>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('statusPages.create')} icon={<Radio size={35} />} width="lg">
        <form className="ops-form" onSubmit={submitCreate}>
          <div className="form-grid">
            <Field label={t('statusPages.name')} hint={t('statusPages.nameHint')}>
              <input value={createDraft.name} onChange={(event) => updateCreate('name', event.target.value)} required maxLength={160} placeholder={t('statusPages.namePlaceholder')} />
            </Field>
            <Field label={t('statusPages.slug')} hint={t('statusPages.slugHint')}>
              <input value={createDraft.slug} onChange={(event) => updateCreate('slug', toSlug(event.target.value))} pattern="[a-z0-9-]+" placeholder="system-status" />
            </Field>
          </div>
          <Field label={t('statusPages.homepage')}>
            <input type="url" value={createDraft.homepageUrl} onChange={(event) => updateCreate('homepageUrl', event.target.value)} placeholder="https://example.com" />
          </Field>
          <div className="form-grid">
            <Field label={t('statusPages.access')}>
              <Select value={createDraft.accessLevel} onChange={(event) => updateCreate('accessLevel', event.target.value as StatusPageCreateInput['accessLevel'])}>
                <option value="public">{t('statusPages.access.public')}</option>
                <option value="password">{t('statusPages.access.password')}</option>
                <option value="private">{t('statusPages.access.private')}</option>
              </Select>
            </Field>
            <Field label={t('language.label')}>
              <Select value={createDraft.language} onChange={(event) => updateCreate('language', event.target.value as StatusPageLanguageCode)}>
                {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
          </div>
          {createDraft.accessLevel === 'password' && (
            <Field label={t('auth.password')} hint={t('statusPages.passwordHint')}>
              <input type="password" value={createDraft.password} onChange={(event) => updateCreate('password', event.target.value)} minLength={12} maxLength={72} required autoComplete="new-password" />
            </Field>
          )}
          <fieldset className="ops-check-grid">
            <legend>{t('statusPages.monitorsInclude')}</legend>
			{publishableMonitors.map((monitor) => (
              <label key={monitor.id}>
                <input
                  type="checkbox"
                  checked={createDraft.monitorIds.includes(monitor.id)}
                  onChange={(event) => updateCreate(
                    'monitorIds',
                    event.target.checked
                      ? [...createDraft.monitorIds, monitor.id]
                      : createDraft.monitorIds.filter((id) => id !== monitor.id),
                  )}
                />
                <span><strong>{monitor.name}</strong><small>{monitor.target}</small></span>
              </label>
            ))}
          </fieldset>
          <div className="toggle-row">
            <Toggle checked={createDraft.published} onChange={(value) => updateCreate('published', value)} label={t('statusPages.publishNow')} />
            <div className="toggle-row__copy"><strong>{t('statusPages.publishNow')}</strong><span>{t('statusPages.publishNowHint')}</span></div>
          </div>
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy}><Plus size={17} /> {busy ? t('statusPages.creating') : t('statusPages.create')}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(announcementPageId)} onClose={() => setAnnouncementPageId(null)} title={t('statusPages.addAnnouncement')} icon={<Megaphone size={35} />} width="md">
        <form className="ops-form" onSubmit={submitAnnouncement}>
          <Field label={t('statusPages.announcementTitle')}><input value={announcementDraft.title} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, title: event.target.value }))} maxLength={200} required placeholder={t('statusPages.announcementTitlePlaceholder')} /></Field>
          <Field label={t('statusPages.message')}><textarea value={announcementDraft.body} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, body: event.target.value }))} maxLength={10_000} required placeholder={t('statusPages.messagePlaceholder')} /></Field>
          <Field label={t('statusPages.incidentStatus')}>
            <Select value={announcementDraft.status} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, status: event.target.value as StatusPageAnnouncementInput['status'] }))}>
              <option value="investigating">{formatStatus('investigating')}</option><option value="identified">{formatStatus('identified')}</option><option value="monitoring">{formatStatus('monitoring')}</option><option value="resolved">{formatStatus('resolved')}</option>
            </Select>
          </Field>
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setAnnouncementPageId(null)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy}><Megaphone size={17} /> {busy ? t('statusPages.publishing') : t('statusPages.publishAnnouncement')}</Button></div>
        </form>
      </Modal>
    </div>
  )
}

export default StatusPagesPage
