import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Activity, KeyRound, Pencil, Plus, ServerCog, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import type { ApiClient } from '../../api/client'
import type { CheckLocation, CheckLocationCreateInput, CheckLocationUpdateInput } from '../../api/types'
import { useI18n } from '../../app/I18nProvider'
import { Badge, Button, FeedbackBanner, Field, IconButton, Modal, Panel, Toggle } from '../../components/ui'
import { formatDate } from '../../lib/format'

type CheckLocationsApi = Pick<ApiClient, 'adminListCheckLocations' | 'adminCreateCheckLocation' | 'adminUpdateCheckLocation'>

type ConnectionStatus = 'provisioning' | 'online' | 'connecting' | 'offline' | 'draining' | 'inactive'

interface LocationDraft {
  code: string
  name: string
  ip_address: string
  port: number
  key: string
  active: boolean
  enforce_ip: boolean
  concurrency: number
}

const emptyDraft: LocationDraft = {
  code: '',
  name: '',
  ip_address: '',
  port: 8443,
  key: '',
  active: true,
  enforce_ip: true,
  concurrency: 4,
}

function asMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function normalizedIPAddress(value: string) {
  return value.trim().replace(/^\[|\]$/g, '')
}

function isIPv4(value: string) {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

function isIPAddress(value: string) {
  const address = normalizedIPAddress(value)
  if (isIPv4(address)) return address !== '0.0.0.0' && address !== '255.255.255.255'
  if (!address.includes(':') || address.includes('%') || !/^[0-9a-f:.]+$/i.test(address)) return false
  try {
    new URL(`http://[${address}]/`)
    return address !== '::' && address !== '::1'
  } catch {
    return false
  }
}

export function formatCheckLocationEndpoint(location: Pick<CheckLocation, 'ip_address' | 'port'>) {
  const address = normalizedIPAddress(location.ip_address)
  return address.includes(':') ? `[${address}]:${location.port}` : `${address}:${location.port}`
}

export function checkLocationStatus(location: { active: boolean; state?: CheckLocation['state']; last_seen_at?: string; system?: boolean }, now = Date.now()): ConnectionStatus {
  if (location.system) return 'online'
  const state = location.state ?? (location.active ? 'active' : 'inactive')
  if (state === 'provisioning') return 'provisioning'
  if (state === 'draining') return 'draining'
  if (state === 'inactive') return 'inactive'
  if (!location.last_seen_at) return 'connecting'
  const seenAt = Date.parse(location.last_seen_at)
  return Number.isFinite(seenAt) && now - seenAt < 90_000 ? 'online' : 'offline'
}

function statusTone(status: ConnectionStatus) {
  if (status === 'online') return 'success' as const
  if (status === 'connecting' || status === 'provisioning') return 'warning' as const
  if (status === 'offline') return 'danger' as const
  if (status === 'draining') return 'info' as const
  return 'neutral' as const
}

function StatusIcon({ status }: { status: ConnectionStatus }) {
  if (status === 'online') return <Wifi size={13} aria-hidden="true" />
  if (status === 'connecting' || status === 'provisioning' || status === 'draining') return <Activity size={13} aria-hidden="true" />
  return <WifiOff size={13} aria-hidden="true" />
}

export function CheckLocationsSection({ api }: { api: CheckLocationsApi }) {
  const { t } = useI18n()
  const [locations, setLocations] = useState<CheckLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CheckLocation | null>(null)

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const response = await api.adminListCheckLocations()
      setLocations(response.items ?? [])
      setError('')
    } catch (reason) {
      setError(asMessage(reason, t('admin.location.error.load')))
    } finally {
      if (!background) setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const closeEditor = () => {
    setCreating(false)
    setEditing(null)
  }

  const save = async (draft: LocationDraft) => {
    const fields = {
      code: draft.code.trim(),
      name: draft.name.trim(),
      ip_address: normalizedIPAddress(draft.ip_address),
      port: draft.port,
      active: draft.active,
      enforce_ip: draft.enforce_ip,
      concurrency: draft.concurrency,
    }
    setBusy(true)
    setError('')
    try {
      if (editing) {
        const key = draft.key.trim()
        const input: CheckLocationUpdateInput = key ? { ...fields, key } : fields
        const updated = await api.adminUpdateCheckLocation(editing.id, input)
        setLocations((items) => items.map((item) => item.id === updated.id ? updated : item))
        setNotice(t('admin.location.notice.updated', { name: updated.name }))
      } else {
        const input: CheckLocationCreateInput = { ...fields, key: draft.key.trim() }
        const created = await api.adminCreateCheckLocation(input)
        setLocations((items) => [...items, created])
        setNotice(t('admin.location.notice.created', { name: created.name }))
      }
      closeEditor()
    } catch (reason) {
      setError(asMessage(reason, t('admin.location.error.save')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-locations-section">
      {notice && <FeedbackBanner tone="success" onDismiss={() => setNotice('')}>{notice}</FeedbackBanner>}
      {error && <FeedbackBanner tone="error" action={<Button size="sm" variant="secondary" onClick={() => void load()}>{t('admin.location.retry')}</Button>} onDismiss={() => setError('')}>{error}</FeedbackBanner>}
      <div className="admin-section-heading">
        <div><h2>{t('admin.location.title')}</h2><p>{t('admin.location.description')}</p></div>
        <Button onClick={() => setCreating(true)}><Plus size={17} /> {t('admin.location.new')}</Button>
      </div>

      {loading ? (
        <Panel className="admin-locations-loading"><Activity size={24} /><span>{t('admin.location.loading')}</span></Panel>
      ) : locations.length === 0 ? (
        <Panel className="admin-locations-empty"><ServerCog size={30} /><strong>{t('admin.location.empty')}</strong><span>{t('admin.location.emptyHint')}</span></Panel>
      ) : (
        <Panel className="admin-location-list-panel">
          <div className="admin-location-list-heading" aria-hidden="true">
            <span>{t('admin.location.location')}</span>
            <span>{t('admin.location.endpoint')}</span>
            <span>{t('admin.location.connection')}</span>
            <span>{t('admin.location.security')}</span>
            <span>{t('admin.location.capacity')}</span>
            <span>{t('common.edit')}</span>
          </div>
          <div className="admin-location-list" role="list">
            {locations.map((location) => {
              const status = checkLocationStatus(location)
              const observedMismatch = location.enforce_ip && Boolean(location.last_observed_ip) && normalizedIPAddress(location.last_observed_ip ?? '') !== normalizedIPAddress(location.ip_address)
              return <article className={`admin-location-row ${location.state === 'inactive' ? 'is-inactive' : ''} ${location.state === 'provisioning' || location.state === 'draining' ? 'is-transitioning' : ''}`} role="listitem" key={location.id}>
                <div className="admin-location-identity">
                  <span className="admin-location-icon"><ServerCog size={20} /></span>
                  <span><strong>{location.name}</strong><code>{location.display_code ?? location.code}</code></span>
                </div>
                <div className="admin-location-cell admin-location-endpoint" data-label={t('admin.location.endpoint')}>
                  {location.system ? <strong>{t('admin.location.clusterManaged')}</strong> : <code>{formatCheckLocationEndpoint(location)}</code>}
                  {location.last_observed_ip && <small className={observedMismatch ? 'warning-text' : ''}>{t('admin.location.observedIP', { ip: location.last_observed_ip })}</small>}
                </div>
                <div className="admin-location-cell admin-location-connection" data-label={t('admin.location.connection')}>
                  <Badge tone={statusTone(status)} className="admin-location-status"><StatusIcon status={status} />{t(`admin.location.status.${status}`)}</Badge>
                  {location.state === 'draining' && location.drain_until && <small>{t('admin.location.drainUntil', { date: formatDate(location.drain_until, { includeYear: true, includeSeconds: true }) })}</small>}
                  <small>{location.system ? t('admin.location.alwaysEnabled') : location.last_seen_at ? t('admin.location.lastSeen', { date: formatDate(location.last_seen_at, { includeYear: true, includeSeconds: true }) }) : t('admin.location.neverSeen')}</small>
                  {location.agent_version && <small>{t('admin.location.agentVersion', { version: location.agent_version })}</small>}
                </div>
                <div className="admin-location-cell admin-location-security" data-label={t('admin.location.security')}>
                  {location.system ? <><span><ShieldCheck size={14} /><strong>{t('admin.location.system')}</strong></span><small>{t('admin.location.systemSecurity')}</small></> : <><span><KeyRound size={14} /><code>{location.key_fingerprint}</code></span><small>{t(location.enforce_ip ? 'admin.location.ipEnforced' : 'admin.location.ipNotEnforced')}</small></>}
                </div>
                <div className="admin-location-cell admin-location-capacity" data-label={t('admin.location.capacity')}>
                  <strong>{location.concurrency}</strong><small>{t('admin.location.concurrentChecks')}</small>
                </div>
                {location.system ? <Badge tone="info">{t('admin.location.locked')}</Badge> : <IconButton className="admin-location-edit" label={t('admin.location.editNamed', { name: location.name })} onClick={() => setEditing(location)}><Pencil size={17} /></IconButton>}
              </article>
            })}
          </div>
        </Panel>
      )}

      <CheckLocationModal
        open={creating || Boolean(editing)}
        location={editing}
        busy={busy}
        onClose={closeEditor}
        onSave={save}
      />
    </section>
  )
}

function CheckLocationModal({ open, location, busy, onClose, onSave }: { open: boolean; location: CheckLocation | null; busy: boolean; onClose: () => void; onSave: (draft: LocationDraft) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<LocationDraft>(emptyDraft)

  useEffect(() => {
    if (!open) return
    setDraft(location ? {
      code: location.code,
      name: location.name,
      ip_address: location.ip_address,
      port: location.port,
      key: '',
      active: location.state === 'active' || location.state === 'provisioning',
      enforce_ip: location.enforce_ip,
      concurrency: location.concurrency,
    } : { ...emptyDraft })
  }, [location, open])

  const valid = useMemo(() => {
    const key = draft.key.trim()
    return draft.code !== 'local'
      && draft.code !== 'fra-1'
      && /^[a-z0-9][a-z0-9-]{1,63}$/.test(draft.code)
      && draft.name.trim().length >= 2
      && draft.name.trim().length <= 120
      && isIPAddress(draft.ip_address)
      && Number.isInteger(draft.port) && draft.port >= 1 && draft.port <= 65_535
      && Number.isInteger(draft.concurrency) && draft.concurrency >= 1 && draft.concurrency <= 256
      && (location ? key.length === 0 || key.length >= 32 : key.length >= 32)
  }, [draft, location])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (valid) onSave(draft)
  }

  return <Modal open={open} onClose={onClose} title={t(location ? 'admin.location.edit' : 'admin.location.create')} icon={<ServerCog size={29} />} width="lg" className="admin-location-modal">
    <form className="admin-modal-form" onSubmit={submit}>
      {!location && <div className="admin-callout"><ShieldCheck size={20} /><span>{t('admin.location.createHint')}</span></div>}
      <div className="form-grid">
        <Field label={t('admin.location.name')}><input maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('admin.location.namePlaceholder')} /></Field>
        <Field label={t('admin.location.code')} hint={t(location ? 'admin.location.codeLockedHint' : 'admin.location.codeHint')}><input maxLength={64} value={draft.code} disabled={Boolean(location)} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="ams-1" /></Field>
        <Field label={t('admin.location.ipAddress')} hint={t('admin.location.ipHint')}><input value={draft.ip_address} onChange={(event) => setDraft({ ...draft, ip_address: event.target.value })} placeholder="203.0.113.10" spellCheck={false} /></Field>
        <Field label={t('admin.location.port')} hint={t('admin.location.portHint')}><input type="number" min={1} max={65_535} value={draft.port} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })} /></Field>
      </div>
      <Field label={t('admin.location.key')} hint={t(location ? 'admin.location.keyEditHint' : 'admin.location.keyCreateHint')}>
        <input type="password" autoComplete="new-password" value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder={location ? t('admin.location.keyKeepPlaceholder') : t('admin.location.keyPlaceholder')} />
      </Field>
      <Field label={t('admin.location.concurrency')} hint={t('admin.location.concurrencyHint')}>
        <input type="number" min={1} max={256} value={draft.concurrency} onChange={(event) => setDraft({ ...draft, concurrency: Number(event.target.value) })} />
      </Field>
      <div className="admin-toggle-grid">
        <div className="admin-toggle-row"><Toggle checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} label={t('admin.location.activeToggle')} /><span><strong>{t('admin.location.active')}</strong><small>{t('admin.location.activeHint')}</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={draft.enforce_ip} onChange={(enforce_ip) => setDraft({ ...draft, enforce_ip })} label={t('admin.location.enforceIPToggle')} /><span><strong>{t('admin.location.enforceIP')}</strong><small>{t('admin.location.enforceIPHint')}</small></span></div>
      </div>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || !valid}>{t(location ? 'admin.location.save' : 'admin.location.createAction')}</Button></div>
    </form>
  </Modal>
}
