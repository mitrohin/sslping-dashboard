import { useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  Braces,
  Clock3,
  DatabaseZap,
  Globe2,
  HeartPulse,
  KeyRound,
  LockKeyhole,
  Network,
  Radio,
  ServerCog,
} from 'lucide-react'
import { Button, Field, Select, Toggle } from '../../components/ui'
import type { DNSConfig } from '../../api/types'
import type { MonitorType } from '../../data'

export interface MonitorDraft {
  name: string
  type: MonitorType
  target: string
  intervalSeconds: number
  timeoutSeconds: number
  regions: string[]
  tags: string[]
  group: string
  keyword: string
  keywordMode: 'present' | 'absent'
  method: string
  followRedirects: boolean
  checkSSLErrors: boolean
  sslReminders: boolean
  domainReminders: boolean
  slowThresholdMs: number
  failureThreshold: number
  recoveryThreshold: number
  dnsRecordType: DNSConfig['record_type']
  dnsExpected: string
  heartbeatGraceSeconds: number
}

const monitorTypes: Array<{ value: MonitorType; label: string; description: string; icon: typeof Globe2 }> = [
  { value: 'http', label: 'Website / API', description: 'HTTP status, body and response time', icon: Globe2 },
  { value: 'keyword', label: 'Keyword', description: 'Find or reject content in a response', icon: Braces },
  { value: 'tcp', label: 'TCP port', description: 'Connect to any TCP service', icon: Network },
  { value: 'udp', label: 'UDP', description: 'Request and verify UDP services', icon: Radio },
  { value: 'tls', label: 'SSL / TLS', description: 'Certificate validity and expiry', icon: LockKeyhole },
  { value: 'dns', label: 'DNS record', description: 'A, AAAA, CNAME, MX, TXT and more', icon: DatabaseZap },
  { value: 'domain', label: 'Domain expiry', description: 'RDAP registration and expiry', icon: ServerCog },
  { value: 'reachability', label: 'Reachability', description: 'Host and port availability', icon: Activity },
  { value: 'heartbeat', label: 'Heartbeat', description: 'Cron jobs and scheduled tasks', icon: HeartPulse },
]

export const defaultMonitorDraft: MonitorDraft = {
  name: '',
  type: 'http',
  target: 'https://',
  intervalSeconds: 60,
  timeoutSeconds: 15,
  regions: ['local'],
  tags: [],
  group: 'Monitors',
  keyword: '',
  keywordMode: 'present',
  method: 'GET',
  followRedirects: true,
  checkSSLErrors: true,
  sslReminders: true,
  domainReminders: true,
  slowThresholdMs: 0,
  failureThreshold: 2,
  recoveryThreshold: 1,
  dnsRecordType: 'A',
  dnsExpected: '',
  heartbeatGraceSeconds: 0,
}

function targetLabel(type: MonitorType) {
  if (type === 'heartbeat') return 'Expected heartbeat period'
  if (type === 'dns') return 'Domain to resolve'
  if (type === 'domain') return 'Domain name'
  if (type === 'tcp' || type === 'udp' || type === 'tls' || type === 'reachability') return 'Host and port'
  return 'URL to monitor'
}

export function MonitorForm({
  initialValue = defaultMonitorDraft,
  submitLabel = 'Create monitor',
  onSubmit,
  onCancel,
  lockType = false,
}: {
  initialValue?: MonitorDraft
  submitLabel?: string
  onSubmit: (draft: MonitorDraft) => Promise<void> | void
  onCancel?: () => void
  lockType?: boolean
}) {
  const [draft, setDraft] = useState<MonitorDraft>(initialValue)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState(draft.tags.join(', '))
  const [submitError, setSubmitError] = useState<string | null>(null)

  const selectedType = useMemo(() => monitorTypes.find((item) => item.value === draft.type)!, [draft.type])
  const set = <K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setSubmitError(null)
    try {
      await onSubmit({ ...draft, tags: tagInput.split(',').map((tag) => tag.trim()).filter(Boolean) })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The monitor could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="monitor-form" onSubmit={handleSubmit}>
      <section className="form-section">
        <h3 className="form-section__title">What should we monitor?</h3>
        <div className="monitor-type-grid">
          {monitorTypes.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className={draft.type === value ? 'is-selected' : ''}
              disabled={lockType && draft.type !== value}
              onClick={() => {
                if (lockType) return
                set('type', value)
                if (value === 'heartbeat') set('target', '86400')
                else if (draft.type === 'heartbeat') set('target', value === 'http' || value === 'keyword' ? 'https://' : '')
              }}
            >
              <Icon size={21} />
              <span><strong>{label}</strong><small>{description}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="form-section">
        <div className="form-grid">
          <Field label="Friendly name" hint="Shown in dashboard, alerts and status pages.">
            <input value={draft.name} onChange={(event) => set('name', event.target.value)} required maxLength={200} placeholder={`${selectedType.label} monitor`} />
          </Field>
          <Field label={targetLabel(draft.type)}>
            {draft.type === 'heartbeat' ? (
              <Select value={draft.target} onChange={(event) => set('target', event.target.value)}>
                <option value="300">Every 5 minutes</option>
                <option value="3600">Every hour</option>
                <option value="86400">Every 24 hours</option>
                <option value="604800">Every week</option>
              </Select>
            ) : (
              <input value={draft.target} onChange={(event) => set('target', event.target.value)} required placeholder={draft.type === 'domain' || draft.type === 'dns' ? 'example.com' : draft.type === 'http' || draft.type === 'keyword' ? 'https://example.com/health' : 'example.com:443'} />
            )}
          </Field>
        </div>

        {draft.type === 'keyword' && (
          <div className="form-grid monitor-form__conditional">
            <Field label="Keyword to look for" hint="HTML markup and JSON are supported.">
              <input value={draft.keyword} onChange={(event) => set('keyword', event.target.value)} required placeholder="status: ok" />
            </Field>
            <Field label="Start an incident when">
              <Select value={draft.keywordMode} onChange={(event) => set('keywordMode', event.target.value as 'present' | 'absent')}>
                <option value="present">Keyword is not present</option>
                <option value="absent">Keyword is present</option>
              </Select>
            </Field>
          </div>
        )}

        {draft.type === 'dns' && (
          <div className="form-grid monitor-form__conditional">
            <Field label="Record type"><Select value={draft.dnsRecordType} onChange={(event) => set('dnsRecordType', event.target.value as DNSConfig['record_type'])}><option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option><option>NS</option><option>TXT</option><option>SRV</option><option>CAA</option></Select></Field>
            <Field label="Expected value" hint="Optional: comma-separated values to verify."><input value={draft.dnsExpected} onChange={(event) => set('dnsExpected', event.target.value)} placeholder="203.0.113.10" /></Field>
          </div>
        )}

        {draft.type === 'heartbeat' && (
          <div className="form-grid monitor-form__conditional">
            <Field label="Grace period" hint="Extra time allowed before the heartbeat becomes late.">
              <Select value={draft.heartbeatGraceSeconds} onChange={(event) => set('heartbeatGraceSeconds', Number(event.target.value))}>
                <option value={0}>No grace period</option><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={1800}>30 minutes</option><option value={3600}>1 hour</option>
              </Select>
            </Field>
          </div>
        )}

        <div className="form-grid monitor-form__conditional">
          <Field label="Group"><Select value={draft.group} onChange={(event) => set('group', event.target.value)}><option>Monitors</option><option>Production</option><option>Core API</option><option>Infrastructure</option><option>Security</option></Select></Field>
          <Field label="Tags" hint="Comma-separated labels for filtering and alert routing."><input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="production, critical" /></Field>
        </div>
      </section>

      <section className="form-section">
        <h3 className="form-section__title">Schedule & locations</h3>
        <div className="form-grid form-grid--three">
          <Field label="Monitor interval"><Select value={draft.intervalSeconds} onChange={(event) => set('intervalSeconds', Number(event.target.value))}><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={1800}>30 minutes</option><option value={3600}>1 hour</option><option value={43200}>12 hours</option><option value={86400}>24 hours</option></Select></Field>
          <Field label="Request timeout"><Select value={draft.timeoutSeconds} onChange={(event) => set('timeoutSeconds', Number(event.target.value))}><option value={5}>5 seconds</option><option value={10}>10 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></Select></Field>
          <Field label="Location"><Select value={draft.regions[0]} onChange={(event) => set('regions', [event.target.value])}><option value="local">Default (auto-select)</option><option value="eu-west">Europe</option><option value="us-east">North America</option><option value="ap-south">Asia Pacific</option></Select></Field>
        </div>
      </section>

      {(draft.type === 'http' || draft.type === 'keyword' || draft.type === 'tls') && (
        <section className="form-section">
          <h3 className="form-section__title">SSL certificate & domain checks</h3>
          <div className="monitor-toggle-grid">
            <div className="toggle-row"><Toggle checked={draft.checkSSLErrors} onChange={(value) => set('checkSSLErrors', value)} label="Check SSL errors" /><div className="toggle-row__copy"><strong>Check SSL errors</strong><span>Fail on hostname, trust or chain errors.</span></div></div>
            <div className="toggle-row"><Toggle checked={draft.sslReminders} onChange={(value) => set('sslReminders', value)} label="SSL expiry reminders" /><div className="toggle-row__copy"><strong>SSL expiry reminders</strong><span>Notify 30, 14, 7 and 0 days before expiry.</span></div></div>
            <div className="toggle-row"><Toggle checked={draft.domainReminders} onChange={(value) => set('domainReminders', value)} label="Domain expiry reminders" /><div className="toggle-row__copy"><strong>Domain expiry reminders</strong><span>Track registration through RDAP.</span></div></div>
          </div>
        </section>
      )}

      <section className="form-section monitor-advanced">
        <button type="button" className="monitor-advanced__toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          <KeyRound size={18} /> Advanced settings <span>{advanced ? '−' : '+'}</span>
        </button>
        {advanced && (
          <div className="monitor-advanced__content">
            <div className="form-grid form-grid--three">
              <Field label="Failure threshold"><input type="number" min={1} max={10} value={draft.failureThreshold} onChange={(event) => set('failureThreshold', Number(event.target.value))} /></Field>
              <Field label="Recovery threshold"><input type="number" min={1} max={10} value={draft.recoveryThreshold} onChange={(event) => set('recoveryThreshold', Number(event.target.value))} /></Field>
              <Field label="Slow response alert"><input type="number" min={0} value={draft.slowThresholdMs} onChange={(event) => set('slowThresholdMs', Number(event.target.value))} placeholder="Disabled" /></Field>
            </div>
            {(draft.type === 'http' || draft.type === 'keyword') && (
              <>
                <Field label="HTTP method"><div className="http-methods">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => <button type="button" key={method} className={draft.method === method ? 'is-active' : ''} onClick={() => set('method', method)}>{method}</button>)}</div></Field>
                <div className="monitor-toggle-grid">
                  <div className="toggle-row"><Toggle checked={draft.followRedirects} onChange={(value) => set('followRedirects', value)} label="Follow redirects" /><div className="toggle-row__copy"><strong>Follow redirects</strong><span>Resolve all 3xx responses before evaluating status.</span></div></div>
                </div>
                <div className="form-grid">
                  <Field label="Authentication"><Select><option>None</option><option>Basic auth</option><option>Bearer token</option></Select></Field>
                  <Field label="Accepted HTTP codes"><input defaultValue="2xx, 3xx" /></Field>
                </div>
                <Field label="Request body"><textarea placeholder={'{"key":"value"}'} /></Field>
                <div className="form-grid"><Field label="Request header"><input placeholder="X-Header-Name" /></Field><Field label="Value"><input placeholder="Value" /></Field></div>
              </>
            )}
          </div>
        )}
      </section>

      <div className="form-actions">
        {submitError && <span className="field__error" role="alert">{submitError}</span>}
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}><Clock3 size={17} />{saving ? 'Saving…' : submitLabel}</Button>
      </div>
    </form>
  )
}
