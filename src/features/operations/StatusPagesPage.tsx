import { useMemo, useState, type FormEvent } from 'react'
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
import { formatDate } from '../../lib/format'
import { Badge, Button, EmptyState, Field, IconButton, Modal, PageHeader, Panel, SearchInput, Select, Toggle } from '../../components/ui'
import type { StatusPageAnnouncementInput, StatusPageCreateInput, StatusPageLanguageCode } from './types'
import './operations.css'

type MaybePromise<T> = T | Promise<T>

export interface StatusPagesPageProps {
  pages?: readonly StatusPageViewModel[]
  monitors?: readonly MonitorViewModel[]
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
  onCreate,
  onAnnouncement,
  onEdit,
  onDelete,
}: StatusPagesPageProps) {
  const [pages, setPages] = useState<StatusPageViewModel[]>(() => [...initialPages])
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<StatusPageCreateInput>(emptyCreate)
  const [announcementPageId, setAnnouncementPageId] = useState<string | null>(null)
  const [announcementDraft, setAnnouncementDraft] = useState<StatusPageAnnouncementInput>(emptyAnnouncement)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
      setError('Name and a valid slug are required.')
      return
    }
    if (createDraft.accessLevel === 'password' && createDraft.password.length < 12) {
      setError('Status-page passwords must contain at least 12 characters.')
      return
    }

    const input: StatusPageCreateInput = { ...createDraft, name, slug }
    const languageLabel = languageOptions.find((option) => option.value === input.language)?.label ?? input.language
    const optimistic: StatusPageViewModel = {
      id: makeId(),
      name,
      slug,
      url: `https://status.sslping.local/${slug}`,
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
      setError(caught instanceof Error ? caught.message : 'The status page could not be created.')
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
      setError(caught instanceof Error ? caught.message : 'The announcement could not be published.')
    } finally {
      setBusy(false)
    }
  }

  const deletePage = async (page: StatusPageViewModel) => {
    if (!window.confirm(`Delete “${page.name}”? This cannot be undone.`)) return
    const snapshot = pages
    setPages((current) => current.filter((item) => item.id !== page.id))
    try {
      await onDelete?.(page.id)
    } catch (caught) {
      setPages(snapshot)
      setError(caught instanceof Error ? caught.message : 'The status page could not be deleted.')
    }
  }

  return (
    <div className="page page--wide ops-page">
      <PageHeader
        title="Status pages"
        description="Publish clear, real-time service health for customers and internal teams."
        actions={<Button type="button" onClick={() => { setError(''); setCreateOpen(true) }}><Plus size={18} /> Create status page</Button>}
      />

      {pages.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Radio size={36} />}
            title="Create a status page"
            description="Share real-time uptime, incident updates, and planned maintenance from one branded page."
            action={<Button type="button" onClick={() => setCreateOpen(true)}><Plus size={18} /> Create status page</Button>}
          />
        </Panel>
      ) : (
        <>
          <div className="ops-toolbar ops-toolbar--compact">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search status pages" aria-label="Search status pages" />
            <span className="ops-result-count">{filteredPages.length} of {pages.length} pages</span>
          </div>
          {error && <div className="ops-error" role="alert">{error}</div>}
          <Panel className="ops-table-panel">
            <div className="ops-table-scroll ops-desktop-only">
              <table className="ops-data-table">
                <thead><tr><th>Name</th><th>Access level</th><th>Status</th><th>Updated</th><th className="ops-actions-column">Actions</th></tr></thead>
                <tbody>
                  {filteredPages.map((page) => (
                    <tr key={page.id}>
                      <td>
                        <div className="ops-name-cell"><span className="ops-round-icon"><Radio size={18} /></span><span><strong>{page.name}</strong><small>{page.monitorCount} monitors · {page.subscribers} subscribers</small></span></div>
                      </td>
                      <td><span className="ops-inline-meta">{page.accessLevel === 'public' ? <Globe2 size={16} /> : <LockKeyhole size={16} />}{page.accessLevel === 'public' ? 'Public' : page.accessLevel === 'password' ? 'Password' : 'Private'}</span></td>
                      <td><Badge tone={page.status === 'published' ? 'success' : 'neutral'}>{page.status === 'published' ? 'Published' : 'Draft'}</Badge></td>
                      <td>{formatDate(page.updatedAt)}</td>
                      <td>
                        <div className="ops-row-actions">
                          <Button size="sm" type="button" onClick={() => { setAnnouncementPageId(page.id); setError('') }}><Megaphone size={16} /> Add announcement</Button>
                          <a className="icon-button" href={page.url} target="_blank" rel="noreferrer" aria-label={`Open ${page.name}`} title="Open public page"><ExternalLink size={17} /></a>
                          <IconButton label={`Edit ${page.name}`} onClick={() => onEdit?.(page.id)}><MoreHorizontal size={18} /></IconButton>
                          {onDelete && <Button variant="ghost" size="sm" type="button" onClick={() => void deletePage(page)}>Delete</Button>}
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
                  <p>{page.monitorCount} monitors · {page.accessLevel} · {page.subscribers} subscribers</p>
                  <div className="ops-card-actions">
                    <Button size="sm" type="button" onClick={() => setAnnouncementPageId(page.id)}><Megaphone size={16} /> Announce</Button>
                    <Button size="sm" variant="secondary" type="button" onClick={() => onEdit?.(page.id)}>Edit</Button>
                    <a className="icon-button" href={page.url} target="_blank" rel="noreferrer" aria-label={`Open ${page.name}`}><ExternalLink size={17} /></a>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create status page" icon={<Radio size={35} />} width="lg">
        <form className="ops-form" onSubmit={submitCreate}>
          <div className="form-grid">
            <Field label="Name" hint="Used in the page title and heading.">
              <input value={createDraft.name} onChange={(event) => updateCreate('name', event.target.value)} required maxLength={160} placeholder="System status" />
            </Field>
            <Field label="Slug" hint="Leave empty to generate it from the name.">
              <input value={createDraft.slug} onChange={(event) => updateCreate('slug', toSlug(event.target.value))} pattern="[a-z0-9-]+" placeholder="system-status" />
            </Field>
          </div>
          <Field label="Homepage URL">
            <input type="url" value={createDraft.homepageUrl} onChange={(event) => updateCreate('homepageUrl', event.target.value)} placeholder="https://example.com" />
          </Field>
          <div className="form-grid">
            <Field label="Access level">
              <Select value={createDraft.accessLevel} onChange={(event) => updateCreate('accessLevel', event.target.value as StatusPageCreateInput['accessLevel'])}>
                <option value="public">Public</option>
                <option value="password">Password protected</option>
                <option value="private">Private draft</option>
              </Select>
            </Field>
            <Field label="Language">
              <Select value={createDraft.language} onChange={(event) => updateCreate('language', event.target.value as StatusPageLanguageCode)}>
                {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
          </div>
          {createDraft.accessLevel === 'password' && (
            <Field label="Password" hint="Minimum 12 characters.">
              <input type="password" value={createDraft.password} onChange={(event) => updateCreate('password', event.target.value)} minLength={12} maxLength={72} required autoComplete="new-password" />
            </Field>
          )}
          <fieldset className="ops-check-grid">
            <legend>Monitors to include</legend>
            {monitors.map((monitor) => (
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
            <Toggle checked={createDraft.published} onChange={(value) => updateCreate('published', value)} label="Publish immediately" />
            <div className="toggle-row__copy"><strong>Publish immediately</strong><span>The page can be changed back to a draft later.</span></div>
          </div>
          {error && <div className="ops-error" role="alert">{error}</div>}
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}><Plus size={17} /> {busy ? 'Creating…' : 'Create status page'}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(announcementPageId)} onClose={() => setAnnouncementPageId(null)} title="Add announcement" icon={<Megaphone size={35} />} width="md">
        <form className="ops-form" onSubmit={submitAnnouncement}>
          <Field label="Title"><input value={announcementDraft.title} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, title: event.target.value }))} maxLength={200} required placeholder="Investigating elevated error rates" /></Field>
          <Field label="Message"><textarea value={announcementDraft.body} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, body: event.target.value }))} maxLength={10_000} required placeholder="Tell subscribers what is happening and what to expect." /></Field>
          <Field label="Incident status">
            <Select value={announcementDraft.status} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, status: event.target.value as StatusPageAnnouncementInput['status'] }))}>
              <option value="investigating">Investigating</option><option value="identified">Identified</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option>
            </Select>
          </Field>
          {error && <div className="ops-error" role="alert">{error}</div>}
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setAnnouncementPageId(null)}>Cancel</Button><Button type="submit" disabled={busy}><Megaphone size={17} /> {busy ? 'Publishing…' : 'Publish announcement'}</Button></div>
        </form>
      </Modal>
    </div>
  )
}

export default StatusPagesPage
