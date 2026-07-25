import { useMemo, useState } from 'react'
import { Download, FileClock, Filter, ShieldCheck } from 'lucide-react'
import { formatDate } from '../../lib/format'
import { Badge, Button, EmptyState, Panel, SearchInput, Select } from '../../components/ui'
import type { AuditEntry } from './types'

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
      const header = ['Time', 'Actor', 'Action', 'Category', 'Target', 'Outcome', 'IP address']
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
    <section className="account-tab-panel" role="tabpanel" aria-label="Audit log">
      <div className="account-section-heading">
        <div><h2>Audit log<span className="title-dot">.</span></h2><p>Review security-sensitive changes and activity across this workspace.</p></div>
        <Button variant="secondary" onClick={exportLog} disabled={exporting || filtered.length === 0}><Download size={17} />{exporting ? 'Exporting…' : 'Export CSV'}</Button>
      </div>

      <div className="audit-toolbar">
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, action, or resource" aria-label="Search audit log" />
        <label><Filter size={16} /><span className="sr-only">Category</span><Select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item.replace('-', ' ')}</option>)}</Select></label>
        <label><ShieldCheck size={16} /><span className="sr-only">Outcome</span><Select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="all">All outcomes</option><option value="success">Success</option><option value="warning">Warning</option><option value="failure">Failure</option></Select></label>
      </div>

      <Panel className="account-table-panel">
        {filtered.length === 0 ? (
          <EmptyState icon={<FileClock size={35} />} title="No matching activity" description="Try a different search or filter." />
        ) : (
          <div className="account-table-wrap">
            <table className="account-table audit-table">
              <caption className="sr-only">Workspace audit log</caption>
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>IP address</th></tr></thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="When"><time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt, { includeSeconds: true })}</time></td>
                    <td data-label="Actor"><strong>{entry.actorName}</strong>{entry.actorEmail && <small>{entry.actorEmail}</small>}</td>
                    <td data-label="Action"><code>{formatAction(entry.action)}</code><small>{entry.category}</small></td>
                    <td data-label="Target"><strong>{entry.target}</strong>{entry.detail && <small>{entry.detail}</small>}</td>
                    <td data-label="Outcome"><Badge tone={outcomeTone(entry.outcome)}>{entry.outcome}</Badge></td>
                    <td data-label="IP"><code>{entry.ipAddress ?? 'Internal'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="account-table-footer"><span>{filtered.length} of {entries.length} events</span><span className="muted">Audit history is append-only.</span></footer>
      </Panel>
    </section>
  )
}
