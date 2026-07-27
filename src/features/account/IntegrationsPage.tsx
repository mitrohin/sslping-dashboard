import { useMemo, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  Bell,
  KeyRound,
  Mail,
  MessageCircle,
  Pencil,
  PhoneCall,
  Plus,
  ScrollText,
  Siren,
  Trash2,
  Webhook,
} from 'lucide-react'
import {
  demoApiKeys,
  demoIntegrationCatalog,
  demoIntegrations,
  demoMonitors,
  type ApiKeyViewModel,
  type IntegrationCatalogItem,
  type IntegrationCategory,
  type IntegrationType,
  type IntegrationViewModel,
  type MonitorViewModel,
} from '../../data'
import { formatRelativeTime } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  FeedbackBanner,
  IconButton,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Toggle,
} from '../../components/ui'
import { ApiKeysView } from './ApiKeysView'
import { AuditLogView, demoAuditEntries } from './AuditLogView'
import { IntegrationFormModal } from './IntegrationFormModal'
import type {
  ApiKeyCreateInput,
  ApiKeyCreateResult,
  AuditEntry,
  IntegrationInput,
  SaveIntegrationCallback,
} from './types'
import './account.css'

type AccountTab = 'integrations' | 'api-keys' | 'audit-log'
type IntegrationFilter = 'all' | IntegrationCategory

const tabs: readonly { value: AccountTab; label: string; icon: typeof Activity }[] = [
  { value: 'integrations', label: 'Integrations', icon: Activity },
  { value: 'api-keys', label: 'API keys', icon: KeyRound },
  { value: 'audit-log', label: 'Audit log', icon: ScrollText },
]

const categoryOptions: readonly { value: IntegrationFilter; label: string; icon: typeof Activity }[] = [
  { value: 'all', label: 'All integrations', icon: Activity },
  { value: 'chat', label: 'Chat platforms', icon: MessageCircle },
  { value: 'webhook', label: 'Webhooks', icon: Webhook },
  { value: 'incident-management', label: 'Incident management', icon: Siren },
  { value: 'push', label: 'Push notifications', icon: Bell },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms-voice', label: 'SMS & voice', icon: PhoneCall },
]

const categoryIcons: Readonly<Record<IntegrationCategory, typeof Activity>> = {
  chat: MessageCircle,
  webhook: Webhook,
  'incident-management': Siren,
  push: Bell,
  email: Mail,
  'sms-voice': PhoneCall,
}

export interface IntegrationsPageProps {
  initialTab?: AccountTab
  initialIntegrations?: readonly IntegrationViewModel[]
  catalog?: readonly IntegrationCatalogItem[]
  monitors?: readonly MonitorViewModel[]
  focusMonitorId?: string
  initialApiKeys?: readonly ApiKeyViewModel[]
  auditEntries?: readonly AuditEntry[]
  onSaveIntegration?: SaveIntegrationCallback
  onToggleIntegration?: (integrationId: string, active: boolean) => Promise<IntegrationViewModel | void>
  onDeleteIntegration?: (integrationId: string) => Promise<void>
  onCreateApiKey?: (input: ApiKeyCreateInput) => Promise<ApiKeyCreateResult | void>
  onRevokeApiKey?: (keyId: string) => Promise<ApiKeyViewModel | void>
  onExportAudit?: (entries: readonly AuditEntry[]) => void | Promise<void>
}

interface EditorState {
  type: IntegrationType
  integration: IntegrationViewModel | null
}

function destinationLabel(input: IntegrationInput): string {
  if (input.type === 'email') {
    const count = input.config.recipients?.split(',').filter(Boolean).length ?? 0
    return count > 0 ? `${count} email recipient${count === 1 ? '' : 's'}` : 'Email recipients configured'
  }
  if (input.type === 'telegram') return 'Telegram chat configured'
  if (input.type === 'sms' || input.type === 'voice') return 'Phone destination configured'
  if (input.type === 'pagerduty' || input.type === 'opsgenie') return 'On-call service configured'
  if (input.type === 'webhook') return 'HTTPS endpoint · credentials hidden'
  return 'Notification destination configured'
}

function eventSummary(integration: IntegrationViewModel): string {
  const down = integration.events.includes('monitor.down')
  const up = integration.events.includes('monitor.up')
  const expiry = integration.events.includes('ssl.expiry') || integration.events.includes('domain.expiry')
  const parts = [down && 'Down', up && 'Up', expiry && 'SSL & domain expiry'].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : `${integration.events.length} selected events`
}

export function IntegrationsPage({
  initialTab = 'integrations',
  initialIntegrations = demoIntegrations,
  catalog = demoIntegrationCatalog,
  monitors = demoMonitors,
  focusMonitorId,
  initialApiKeys = demoApiKeys,
  auditEntries = demoAuditEntries,
  onSaveIntegration,
  onToggleIntegration,
  onDeleteIntegration,
  onCreateApiKey,
  onRevokeApiKey,
  onExportAudit,
}: IntegrationsPageProps) {
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab)
  const [integrations, setIntegrations] = useState<readonly IntegrationViewModel[]>(initialIntegrations)
  const [category, setCategory] = useState<IntegrationFilter>('all')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleting, setDeleting] = useState<IntegrationViewModel | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const focusedMonitor = monitors.find((monitor) => monitor.id === focusMonitorId)
  const initialMonitorIds = useMemo(() => focusMonitorId ? [focusMonitorId] : [], [focusMonitorId])

  const filteredCatalog = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return catalog.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      const configured = integrations.filter((integration) =>
        integration.type === item.type && (
          !focusMonitorId || integration.monitorIds.length === 0 || integration.monitorIds.includes(focusMonitorId)
        ),
      )
      if (!normalized) return true
      return [item.name, item.description, ...configured.flatMap((integration) => [integration.name, integration.destinationLabel])]
        .some((value) => value.toLowerCase().includes(normalized))
    })
  }, [catalog, category, focusMonitorId, integrations, query])

  const switchTabWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const currentIndex = tabs.findIndex((tab) => tab.value === activeTab)
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(currentIndex + direction + tabs.length) % tabs.length]
    setActiveTab(next.value)
    document.getElementById(`account-tab-${next.value}`)?.focus()
  }

  const openCreate = (type: IntegrationType = 'slack') => {
    setError('')
    setEditor({ type, integration: null })
  }

  const openEdit = (integration: IntegrationViewModel) => {
    setError('')
    setEditor({ type: integration.type, integration })
  }

  const saveIntegration = async (input: IntegrationInput) => {
    const original = editor?.integration ?? null
    const provider = catalog.find((item) => item.type === input.type)
    if (!provider) return

    const optimisticId = original?.id ?? `local-${crypto.randomUUID()}`
    const optimistic: IntegrationViewModel = {
      id: optimisticId,
      name: input.name,
      type: input.type,
      category: provider.category,
      active: input.active,
      needsAttention: false,
      destinationLabel: original?.destinationLabel ?? destinationLabel(input),
      events: input.events,
      monitorIds: input.monitorIds,
      updatedAt: new Date().toISOString(),
    }

    setSaving(true)
    setError('')
    setIntegrations((current) =>
      original
        ? current.map((integration) => (integration.id === original.id ? optimistic : integration))
        : [...current, optimistic],
    )
    try {
      const saved = await onSaveIntegration?.(input, original?.id)
      if (saved) {
        setIntegrations((current) => current.map((integration) => (integration.id === optimisticId ? saved : integration)))
      }
      setEditor(null)
    } catch (saveError) {
      setIntegrations((current) =>
        original
          ? current.map((integration) => (integration.id === original.id ? original : integration))
          : current.filter((integration) => integration.id !== optimisticId),
      )
      setError(saveError instanceof Error ? saveError.message : 'Could not save this integration.')
    } finally {
      setSaving(false)
    }
  }

  const toggleIntegration = async (integration: IntegrationViewModel, active: boolean) => {
    const optimistic = { ...integration, active, updatedAt: new Date().toISOString() }
    setIntegrations((current) => current.map((item) => (item.id === integration.id ? optimistic : item)))
    try {
      const saved = await onToggleIntegration?.(integration.id, active)
      if (saved) setIntegrations((current) => current.map((item) => (item.id === integration.id ? saved : item)))
    } catch (toggleError) {
      setIntegrations((current) => current.map((item) => (item.id === integration.id ? integration : item)))
      setError(toggleError instanceof Error ? toggleError.message : 'Could not change integration status.')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const original = deleting
    setIntegrations((current) => current.filter((integration) => integration.id !== original.id))
    setDeleting(null)
    try {
      await onDeleteIntegration?.(original.id)
    } catch (deleteError) {
      setIntegrations((current) => [...current, original])
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this integration.')
    }
  }

  return (
    <div className="page page--wide account-page integrations-page">
      <PageHeader
        title="Integrations & API"
        description="Route alerts, automate monitoring, and inspect security-sensitive workspace activity."
        actions={activeTab === 'integrations' ? <Button onClick={() => openCreate()}><Plus size={17} /> Add integration</Button> : undefined}
      />

      <div className="account-tabs" role="tablist" aria-label="Integrations and API sections" onKeyDown={switchTabWithKeyboard}>
        {tabs.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            id={`account-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            aria-controls={`account-panel-${value}`}
            tabIndex={activeTab === value ? 0 : -1}
            className={activeTab === value ? 'is-active' : ''}
            onClick={() => setActiveTab(value)}
          ><Icon size={18} />{label}</button>
        ))}
      </div>

      {error && <FeedbackBanner tone="error" className="feedback-banner--page" onDismiss={() => setError('')}>{error}</FeedbackBanner>}
      {focusedMonitor && <div className="integration-focus"><Bell size={18} /><span><strong>Notification routes for {focusedMonitor.name}</strong><small>New integrations will be assigned to this monitor automatically. Workspace-wide routes are also shown.</small></span><Link to={`/monitors/${focusedMonitor.id}`}>Back to monitor</Link></div>}

      <div id="account-panel-integrations" hidden={activeTab !== 'integrations'} role="tabpanel" aria-labelledby="account-tab-integrations">
        <div className="integration-layout">
          <nav className="integration-categories" aria-label="Integration categories">
            {categoryOptions.map(({ value, label, icon: Icon }) => (
              <button type="button" key={value} className={category === value ? 'is-active' : ''} onClick={() => setCategory(value)}><Icon size={18} />{label}</button>
            ))}
          </nav>

          <div className="integration-content">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by integration type or name…" aria-label="Search integrations" />
            {filteredCatalog.length === 0 ? (
              <Panel><EmptyState icon={<Activity size={35} />} title="No matching integrations" description="Try another category or search phrase." /></Panel>
            ) : (
              <div className="integration-catalog">
                {filteredCatalog.map((item) => {
                  const configured = integrations.filter((integration) =>
                    integration.type === item.type && (
                      !focusMonitorId || integration.monitorIds.length === 0 || integration.monitorIds.includes(focusMonitorId)
                    ),
                  )
                  const CategoryIcon = categoryIcons[item.category]
                  return (
                    <Panel key={item.type} className="integration-card">
                      <div className="integration-card__header">
                        <div className="integration-logo"><CategoryIcon size={24} /></div>
                        <div><h2>{item.name}</h2><p>{item.description}</p></div>
                        <Button size="sm" onClick={() => openCreate(item.type)}><Plus size={16} /> Add</Button>
                      </div>
                      {configured.length > 0 && (
                        <div className="configured-integrations">
                          {configured.map((integration) => (
                            <article key={integration.id} className="configured-integration">
                              <span className={integration.active ? 'integration-state is-active' : 'integration-state'} aria-hidden="true" />
                              <div><strong>{integration.name}</strong><small>{integration.destinationLabel}</small></div>
                              <span className="configured-integration__events">{eventSummary(integration)}</span>
                              <span className="muted configured-integration__updated">Updated {formatRelativeTime(integration.updatedAt)}</span>
                              {integration.needsAttention && <Badge tone="warning">Activation needed</Badge>}
                              {!integration.needsAttention && <Badge tone={integration.active ? 'success' : 'neutral'}>{integration.active ? 'Active' : 'Paused'}</Badge>}
                              <Toggle checked={integration.active} onChange={(active) => void toggleIntegration(integration, active)} label={`${integration.active ? 'Pause' : 'Enable'} ${integration.name}`} />
                              <IconButton label={`Edit ${integration.name}`} onClick={() => openEdit(integration)}><Pencil size={16} /></IconButton>
                              <IconButton label={`Delete ${integration.name}`} onClick={() => setDeleting(integration)}><Trash2 size={16} /></IconButton>
                            </article>
                          ))}
                        </div>
                      )}
                    </Panel>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div id="account-panel-api-keys" hidden={activeTab !== 'api-keys'} role="tabpanel" aria-labelledby="account-tab-api-keys">
        <ApiKeysView initialKeys={initialApiKeys} monitors={monitors} onCreate={onCreateApiKey} onRevoke={onRevokeApiKey} />
      </div>

      <div id="account-panel-audit-log" hidden={activeTab !== 'audit-log'} role="tabpanel" aria-labelledby="account-tab-audit-log">
        <AuditLogView entries={auditEntries} onExport={onExportAudit} />
      </div>

      <IntegrationFormModal
        open={Boolean(editor)}
        catalog={catalog}
        initialType={editor?.type}
        integration={editor?.integration}
        monitors={monitors}
        initialMonitorIds={initialMonitorIds}
        saving={saving}
        error={error}
        onClose={() => setEditor(null)}
        onSubmit={saveIntegration}
      />

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete integration" icon={<Trash2 size={35} />} width="sm">
        {deleting && <div className="confirm-action"><p>Delete <strong>{deleting.name}</strong>? It will stop receiving alerts immediately.</p><div className="form-actions"><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={confirmDelete}><Trash2 size={16} /> Delete integration</Button></div></div>}
      </Modal>
    </div>
  )
}
