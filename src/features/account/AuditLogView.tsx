import { useMemo, useState } from 'react'
import { Download, FileClock, Filter, ShieldCheck } from 'lucide-react'
import { formatDate } from '../../lib/format'
import { Badge, Button, EmptyState, Panel, SearchInput, Select } from '../../components/ui'
import type { AuditEntry } from './types'
import { useI18n } from '../../app/I18nProvider'

export const demoAuditEntries: readonly AuditEntry[] = [
  {
    id: 'audit-001',
    occurredAt: '2026-07-25T12:56:18.000Z',
    actorName: 'Alex Morgan',
    actorEmail: 'alex@example.com',
    action: 'integration.updated',
    category: 'integration',
    target: 'Production alerts',
    ipAddress: '198.51.100.24',
    outcome: 'success',
    detail: 'Notification events and monitor routing updated.',
  },
  {
    id: 'audit-002',
    occurredAt: '2026-07-25T11:42:03.000Z',
    actorName: 'Maya Chen',
    actorEmail: 'maya@example.com',
    action: 'incident.resolved',
    category: 'incident',
    target: 'Production API · expected keyword was not found',
    ipAddress: '203.0.113.19',
    outcome: 'success',
  },
  {
    id: 'audit-003',
    occurredAt: '2026-07-25T10:09:51.000Z',
    actorName: 'System worker',
    action: 'monitor.paused',
    category: 'monitor',
    target: 'Nightly database backup',
    outcome: 'warning',
    detail: 'Monitor paused for scheduled infrastructure work.',
  },
  {
    id: 'audit-004',
    occurredAt: '2026-07-24T18:30:44.000Z',
    actorName: 'Alex Morgan',
    actorEmail: 'alex@example.com',
    action: 'api_key.created',
    category: 'api-key',
    target: 'Public website widget',
    ipAddress: '198.51.100.24',
    outcome: 'success',
    detail: 'Monitor-specific read-only key created.',
  },
  {
    id: 'audit-005',
    occurredAt: '2026-07-24T16:11:29.000Z',
    actorName: 'Unknown user',
    action: 'auth.login_failed',
    category: 'auth',
    target: 'alex@example.com',
    ipAddress: '192.0.2.61',
    outcome: 'failure',
    detail: 'Invalid password. No session was created.',
  },
  {
    id: 'audit-006',
    occurredAt: '2026-07-23T09:02:11.000Z',
    actorName: 'Alex Morgan',
    actorEmail: 'alex@example.com',
    action: 'team.invitation_sent',
    category: 'team',
    target: 'priya@example.com',
    ipAddress: '198.51.100.24',
    outcome: 'success',
  },
  {
    id: 'audit-007',
    occurredAt: '2026-07-22T13:48:37.000Z',
    actorName: 'Maya Chen',
    actorEmail: 'maya@example.com',
    action: 'monitor.updated',
    category: 'monitor',
    target: 'Checkout API',
    ipAddress: '203.0.113.19',
    outcome: 'success',
    detail: 'Check interval changed from 60 seconds to 30 seconds.',
  },
  {
    id: 'audit-008',
    occurredAt: '2026-07-21T08:20:00.000Z',
    actorName: 'Alex Morgan',
    actorEmail: 'alex@example.com',
    action: 'workspace.updated',
    category: 'workspace',
    target: 'SSLPing production',
    ipAddress: '198.51.100.24',
    outcome: 'success',
    detail: 'Default timezone changed to Europe/Moscow.',
  },
]

const categories: readonly AuditEntry['category'][] = [
  'auth',
  'team',
  'monitor',
  'incident',
  'integration',
  'api-key',
  'workspace',
]

function outcomeTone(outcome: AuditEntry['outcome']) {
  if (outcome === 'success') return 'success' as const
  if (outcome === 'failure') return 'danger' as const
  return 'warning' as const
}

function formatAction(action: string): string {
  return action.replaceAll('_', ' ').replaceAll('.', ' · ')
}

export interface AuditLogViewProps {
  entries?: readonly AuditEntry[]
  onExport?: (entries: readonly AuditEntry[]) => void | Promise<void>
}

export function AuditLogView({ entries = demoAuditEntries, onExport }: AuditLogViewProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | AuditEntry['category']>('all')
  const [outcome, setOutcome] = useState<'all' | AuditEntry['outcome']>('all')
  const [exporting, setExporting] = useState(false)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false
      if (outcome !== 'all' && entry.outcome !== outcome) return false
      if (!normalized) return true
      return [entry.actorName, entry.actorEmail, entry.action, entry.target, entry.detail]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized))
    })
  }, [category, entries, outcome, query])

  const exportLog = async () => {
    setExporting(true)
    try {
      if (onExport) {
        await onExport(filtered)
        return
      }
      const header = [t('audit.when'), t('audit.actor'), t('audit.action'), t('audit.category'), t('audit.target'), t('audit.outcome'), t('audit.ip')]
      const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
      const csv = [
        header.map(escape).join(','),
        ...filtered.map((entry) =>
          [
            entry.occurredAt,
            entry.actorName,
            entry.action,
            entry.category,
            entry.target,
            entry.outcome,
            entry.ipAddress ?? '',
          ].map(escape).join(','),
        ),
      ].join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'sslping-audit-log.csv'
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="account-tab-panel" role="tabpanel" aria-label={t('audit.title')}>
      <div className="account-section-heading">
        <div><h2>{t('audit.title')}<span className="title-dot">.</span></h2><p>{t('audit.description')}</p></div>
        <Button variant="secondary" onClick={exportLog} disabled={exporting || filtered.length === 0}><Download size={17} />{exporting ? t('audit.exporting') : t('audit.export')}</Button>
      </div>

      <div className="audit-toolbar">
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('audit.search')} aria-label={t('audit.searchLabel')} />
        <label><Filter size={16} /><span className="sr-only">{t('audit.category')}</span><Select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="all">{t('audit.allCategories')}</option>{categories.map((item) => <option key={item} value={item}>{t(`audit.category.${item}`)}</option>)}</Select></label>
        <label><ShieldCheck size={16} /><span className="sr-only">{t('audit.outcome')}</span><Select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="all">{t('audit.allOutcomes')}</option><option value="success">{t('audit.outcome.success')}</option><option value="warning">{t('audit.outcome.warning')}</option><option value="failure">{t('audit.outcome.failure')}</option></Select></label>
      </div>

      <Panel className="account-table-panel">
        {filtered.length === 0 ? (
          <EmptyState icon={<FileClock size={35} />} title={t('audit.empty')} description={t('audit.emptyHint')} />
        ) : (
          <div className="account-table-wrap">
            <table className="account-table audit-table">
              <caption className="sr-only">{t('audit.workspaceLog')}</caption>
              <thead><tr><th>{t('audit.when')}</th><th>{t('audit.actor')}</th><th>{t('audit.action')}</th><th>{t('audit.target')}</th><th>{t('audit.outcome')}</th><th>{t('audit.ip')}</th></tr></thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={t('audit.when')}><time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt, { includeSeconds: true })}</time></td>
                    <td data-label={t('audit.actor')}><strong>{entry.actorName}</strong>{entry.actorEmail && <small>{entry.actorEmail}</small>}</td>
                    <td data-label={t('audit.action')}><code>{formatAction(entry.action)}</code><small>{t(`audit.category.${entry.category}`)}</small></td>
                    <td data-label={t('audit.target')}><strong>{entry.target}</strong>{entry.detail && <small>{entry.detail}</small>}</td>
                    <td data-label={t('audit.outcome')}><Badge tone={outcomeTone(entry.outcome)}>{t(`audit.outcome.${entry.outcome}`)}</Badge></td>
                    <td data-label={t('audit.ip')}><code>{entry.ipAddress ?? t('audit.internal')}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="account-table-footer"><span>{t('audit.eventsCount', { visible: filtered.length, total: entries.length })}</span><span className="muted">{t('audit.appendOnly')}</span></footer>
      </Panel>
    </section>
  )
}
