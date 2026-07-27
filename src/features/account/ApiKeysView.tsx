import { useMemo, useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, LockKeyhole, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import {
  demoApiKeys,
  demoMonitors,
  type ApiKeyScope,
  type ApiKeyViewModel,
  type MonitorViewModel,
} from '../../data'
import { formatDate, formatRelativeTime, formatStatus } from '../../lib/format'
import { Badge, Button, EmptyState, FeedbackBanner, Field, IconButton, Modal, Panel, Select } from '../../components/ui'
import type { ApiKeyCreateInput, ApiKeyCreateResult } from './types'

const scopeLabels: Readonly<Record<ApiKeyScope, string>> = {
  read: 'Read all resources',
  write: 'Write all resources',
  'monitors:read': 'Read monitors',
  'monitors:write': 'Manage monitors',
  'incidents:read': 'Read incidents',
  'incidents:write': 'Manage incidents',
  'status:read': 'Read status pages',
}

const availableScopes = Object.keys(scopeLabels) as ApiKeyScope[]

const keyKindLabels: Readonly<Record<ApiKeyViewModel['kind'], string>> = {
  main: 'Main API key',
  'read-only': 'Read-only API key',
  'monitor-specific': 'Monitor-specific API key',
}

export interface ApiKeysViewProps {
  initialKeys?: readonly ApiKeyViewModel[]
  monitors?: readonly MonitorViewModel[]
  onCreate?: (input: ApiKeyCreateInput) => Promise<ApiKeyCreateResult | void>
  onRevoke?: (keyId: string) => Promise<ApiKeyViewModel | void>
}

interface KeyDraft {
  name: string
  kind: ApiKeyViewModel['kind']
  scopes: readonly ApiKeyScope[]
  monitorId: string
  expiresOn: string
}

const initialDraft: KeyDraft = {
  name: '',
  kind: 'read-only',
  scopes: ['read'],
  monitorId: '',
  expiresOn: '',
}

function keyStatusTone(status: ApiKeyViewModel['status']) {
  if (status === 'active') return 'success' as const
  if (status === 'expiring') return 'warning' as const
  if (status === 'expired' || status === 'revoked') return 'danger' as const
  return 'neutral' as const
}

export function ApiKeysView({
  initialKeys = demoApiKeys,
  monitors = demoMonitors,
  onCreate,
  onRevoke,
}: ApiKeysViewProps) {
  const [keys, setKeys] = useState<readonly ApiKeyViewModel[]>(initialKeys)
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<KeyDraft>(initialDraft)
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<ApiKeyViewModel | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const groupedKeys = useMemo(
    () => ({
      main: keys.filter((key) => key.kind === 'main'),
      'read-only': keys.filter((key) => key.kind === 'read-only'),
      'monitor-specific': keys.filter((key) => key.kind === 'monitor-specific'),
    }),
    [keys],
  )

  const openCreate = () => {
    setDraft(initialDraft)
    setError('')
    setCreateOpen(true)
  }

  const changeKind = (kind: ApiKeyViewModel['kind']) => {
    setDraft((current) => ({
      ...current,
      kind,
      scopes: kind === 'main' ? ['read', 'write'] : kind === 'read-only' ? ['read'] : ['monitors:read'],
      monitorId: kind === 'monitor-specific' ? current.monitorId : '',
    }))
  }

  const toggleScope = (scope: ApiKeyScope) => {
    setDraft((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((item) => item !== scope)
        : [...current.scopes, scope],
    }))
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (draft.kind === 'monitor-specific' && !draft.monitorId) {
      setError('Choose a monitor for this API key.')
      return
    }
    if (draft.scopes.length === 0) {
      setError('Choose at least one scope.')
      return
    }

    const now = new Date().toISOString()
    const optimisticId = `local-${crypto.randomUUID()}`
    const monitor = monitors.find((item) => item.id === draft.monitorId)
    const optimistic: ApiKeyViewModel = {
      id: optimisticId,
      name: draft.name.trim(),
      prefix: 'Creating…',
      kind: draft.kind,
      scopes: draft.scopes,
      ...(monitor ? { monitorId: monitor.id, monitorName: monitor.name } : {}),
      createdAt: now,
      ...(draft.expiresOn ? { expiresAt: new Date(`${draft.expiresOn}T23:59:59.000Z`).toISOString() } : {}),
      status: 'never-used',
    }
    const input: ApiKeyCreateInput = {
      name: optimistic.name,
      kind: optimistic.kind,
      scopes: optimistic.scopes,
      ...(optimistic.monitorId ? { monitorId: optimistic.monitorId } : {}),
      ...(optimistic.expiresAt ? { expiresAt: optimistic.expiresAt } : {}),
    }

    setSaving(true)
    setError('')
    setKeys((current) => [...current, optimistic])
    try {
      let result = await onCreate?.(input)
      if (!result) {
        const demoSecret = `sp_live_demo_${crypto.randomUUID().replaceAll('-', '')}`
        result = {
          secret: demoSecret,
          key: { ...optimistic, prefix: `${demoSecret.slice(0, 17)}…` },
        }
      }
      setKeys((current) => current.map((key) => (key.id === optimisticId ? result.key : key)))
      setCreateOpen(false)
      setCopied(false)
      setSecret(result.secret)
    } catch (creationError) {
      setKeys((current) => current.filter((key) => key.id !== optimisticId))
      setError(creationError instanceof Error ? creationError.message : 'Could not create the API key.')
    } finally {
      setSaving(false)
    }
  }

  const confirmRevoke = async () => {
    if (!revoking) return
    const original = revoking
    const optimistic: ApiKeyViewModel = {
      ...revoking,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    }
    setSaving(true)
    setKeys((current) => current.map((key) => (key.id === original.id ? optimistic : key)))
    try {
      const saved = await onRevoke?.(original.id)
      if (saved) setKeys((current) => current.map((key) => (key.id === original.id ? saved : key)))
      setRevoking(null)
    } catch (revocationError) {
      setKeys((current) => current.map((key) => (key.id === original.id ? original : key)))
      setError(revocationError instanceof Error ? revocationError.message : 'Could not revoke the API key.')
      setRevoking(null)
    } finally {
      setSaving(false)
    }
  }

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="account-tab-panel" role="tabpanel" aria-label="API keys">
      <div className="account-section-heading">
        <div><h2>API keys<span className="title-dot">.</span></h2><p>Create scoped keys for automation, integrations, and public widgets.</p></div>
        <Button onClick={openCreate}><Plus size={17} /> Create API key</Button>
      </div>

      {error && <FeedbackBanner tone="error" onDismiss={() => setError('')}>{error}</FeedbackBanner>}

      {keys.length === 0 ? (
        <Panel><EmptyState icon={<KeyRound size={34} />} title="No API keys" description="Create a key to access the SSLPing API from your own tools." action={<Button onClick={openCreate}>Create API key</Button>} /></Panel>
      ) : (
        <div className="api-key-groups">
          {(Object.keys(groupedKeys) as ApiKeyViewModel['kind'][]).map((kind) => (
            <Panel key={kind} className="api-key-group">
              <div className="panel__header"><div><h2>{keyKindLabels[kind]}</h2><p>{kind === 'monitor-specific' ? 'Restricted to one monitor and read access.' : kind === 'read-only' ? 'Safe read access without mutation permissions.' : 'Workspace-wide access for trusted automation.'}</p></div><KeyRound size={22} /></div>
              {groupedKeys[kind].length === 0 ? (
                <div className="api-key-empty">No {keyKindLabels[kind].toLowerCase()} created.</div>
              ) : (
                <div className="api-key-list">
                  {groupedKeys[kind].map((key) => (
                    <article className="api-key-row" key={key.id}>
                      <div className="api-key-row__main"><strong>{key.name}</strong><code>{key.prefix}</code>{key.monitorName && <span className="muted">{key.monitorName}</span>}</div>
                      <div className="api-key-row__scopes">{key.scopes.map((scope) => <Badge key={scope} tone="purple">{scope}</Badge>)}</div>
                      <div className="api-key-row__used"><span>Last used</span><strong>{key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : 'Never'}</strong>{key.expiresAt && <small>Expires {formatDate(key.expiresAt)}</small>}</div>
                      <Badge tone={keyStatusTone(key.status)}>{formatStatus(key.status)}</Badge>
                      <IconButton label={`Revoke ${key.name}`} onClick={() => setRevoking(key)} disabled={key.status === 'revoked'}><Trash2 size={16} /></IconButton>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => !saving && setCreateOpen(false)} title={<>Create <span className="success-text">API key</span></>} icon={<KeyRound size={37} />} width="lg">
        <form onSubmit={submitCreate}>
          <div className="form-section form-grid">
            <Field label="Friendly name" hint="Choose a name that identifies where this key is used." error={error}>
              <input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Deployment automation" required />
            </Field>
            <Field label="Key type">
              <Select value={draft.kind} onChange={(event) => changeKind(event.target.value as ApiKeyViewModel['kind'])}>
                <option value="main">Main API key</option>
                <option value="read-only">Read-only API key</option>
                <option value="monitor-specific">Monitor-specific API key</option>
              </Select>
            </Field>
          </div>
          {draft.kind === 'monitor-specific' && (
            <div className="form-section"><Field label="Monitor" hint="This key can read only the selected monitor."><Select value={draft.monitorId} onChange={(event) => setDraft((current) => ({ ...current, monitorId: event.target.value }))} required><option value="">Choose a monitor…</option>{monitors.map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.name}</option>)}</Select></Field></div>
          )}
          <fieldset className="form-section account-fieldset">
            <legend>Scopes</legend>
            <p>Select the minimum permissions this integration needs.</p>
            <div className="scope-grid">
              {availableScopes.map((scope) => {
                const locked = draft.kind === 'read-only' || draft.kind === 'monitor-specific'
                return (
                  <label key={scope} className={draft.scopes.includes(scope) ? 'scope-option is-selected' : 'scope-option'}>
                    <input type="checkbox" checked={draft.scopes.includes(scope)} onChange={() => toggleScope(scope)} disabled={locked} />
                    <span><strong>{scope}</strong><small>{scopeLabels[scope]}</small></span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="form-section"><Field label="Expiration date" hint="Optional. The key stops working at the end of this UTC date."><input type="date" value={draft.expiresOn} onChange={(event) => setDraft((current) => ({ ...current, expiresOn: event.target.value }))} /></Field></div>
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create API key'}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(secret)} onClose={() => setSecret('')} title="Copy your API key" icon={<LockKeyhole size={37} />} width="sm">
        <div className="one-time-secret">
          <div className="account-warning"><ShieldAlert size={20} /><span><strong>This secret is shown only once.</strong><small>Store it in a password manager or secrets vault. You cannot recover it later.</small></span></div>
          <label><span className="field__label">API key secret</span><div><input readOnly value={secret} onFocus={(event) => event.currentTarget.select()} /><IconButton label="Copy API key" onClick={copySecret}>{copied ? <Check size={17} /> : <Copy size={17} />}</IconButton></div></label>
          <Button onClick={() => setSecret('')} disabled={!secret}>{copied ? 'Done' : 'I have saved the key'}</Button>
        </div>
      </Modal>

      <Modal open={Boolean(revoking)} onClose={() => !saving && setRevoking(null)} title="Revoke API key" icon={<Trash2 size={34} />} width="sm">
        {revoking && <div className="confirm-action"><p>Revoke <strong>{revoking.name}</strong>? Applications using this key will lose access immediately.</p><div className="form-actions"><Button variant="secondary" onClick={() => setRevoking(null)}>Cancel</Button><Button variant="danger" onClick={confirmRevoke} disabled={saving}>{saving ? 'Revoking…' : 'Revoke key'}</Button></div></div>}
      </Modal>
    </section>
  )
}
