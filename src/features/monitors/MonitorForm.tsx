import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Activity,
  Braces,
  Check,
  ChevronDown,
  Clock3,
  DatabaseZap,
  Globe2,
  HeartPulse,
  KeyRound,
  LockKeyhole,
  Network,
  Radio,
  ServerCog,
  X,
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
  allowedStatusClasses: number[]
  allowedStatusCodes: number[]
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

const creatableMonitorTypes = monitorTypes.filter(({ value }) => value !== 'tls' && value !== 'domain')

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
  allowedStatusClasses: [2],
  allowedStatusCodes: [],
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

const httpStatusClasses = [
  { value: 1, label: '1xx', description: 'Informational' },
  { value: 2, label: '2xx', description: 'Success' },
  { value: 3, label: '3xx', description: 'Redirect' },
  { value: 4, label: '4xx', description: 'Client error' },
  { value: 5, label: '5xx', description: 'Server error' },
] as const

const knownHttpStatusCodes = [
  [100, 'Continue'], [101, 'Switching Protocols'], [102, 'Processing'], [103, 'Early Hints'],
  [200, 'OK'], [201, 'Created'], [202, 'Accepted'], [203, 'Non-Authoritative Information'], [204, 'No Content'], [205, 'Reset Content'], [206, 'Partial Content'], [207, 'Multi-Status'], [208, 'Already Reported'], [226, 'IM Used'],
  [300, 'Multiple Choices'], [301, 'Moved Permanently'], [302, 'Found'], [303, 'See Other'], [304, 'Not Modified'], [307, 'Temporary Redirect'], [308, 'Permanent Redirect'],
  [400, 'Bad Request'], [401, 'Unauthorized'], [402, 'Payment Required'], [403, 'Forbidden'], [404, 'Not Found'], [405, 'Method Not Allowed'], [406, 'Not Acceptable'], [407, 'Proxy Authentication Required'], [408, 'Request Timeout'], [409, 'Conflict'], [410, 'Gone'], [411, 'Length Required'], [412, 'Precondition Failed'], [413, 'Content Too Large'], [414, 'URI Too Long'], [415, 'Unsupported Media Type'], [416, 'Range Not Satisfiable'], [417, 'Expectation Failed'], [418, "I'm a teapot"], [421, 'Misdirected Request'], [422, 'Unprocessable Content'], [423, 'Locked'], [424, 'Failed Dependency'], [425, 'Too Early'], [426, 'Upgrade Required'], [428, 'Precondition Required'], [429, 'Too Many Requests'], [431, 'Request Header Fields Too Large'], [451, 'Unavailable For Legal Reasons'],
  [500, 'Internal Server Error'], [501, 'Not Implemented'], [502, 'Bad Gateway'], [503, 'Service Unavailable'], [504, 'Gateway Timeout'], [505, 'HTTP Version Not Supported'], [506, 'Variant Also Negotiates'], [507, 'Insufficient Storage'], [508, 'Loop Detected'], [510, 'Not Extended'], [511, 'Network Authentication Required'],
] as const

function tagMatchScore(tag: string, query: string): number {
  if (!query) return 1
  const candidate = tag.toLocaleLowerCase()
  if (candidate === query) return 100
  if (candidate.startsWith(query)) return 80
  if (candidate.includes(query)) return 60
  let position = 0
  for (const character of query) {
    position = candidate.indexOf(character, position)
    if (position < 0) return 0
    position += 1
  }
  return 30
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
  availableTags = [],
}: {
  initialValue?: MonitorDraft
  submitLabel?: string
  onSubmit: (draft: MonitorDraft) => Promise<void> | void
  onCancel?: () => void
  lockType?: boolean
  availableTags?: readonly string[]
}) {
  const [draft, setDraft] = useState<MonitorDraft>(initialValue)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState(draft.tags.join(', '))
  const [statusPickerOpen, setStatusPickerOpen] = useState(false)
  const [statusQuery, setStatusQuery] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const statusPickerRef = useRef<HTMLDivElement>(null)

  const selectedTags = useMemo(() => tagInput.split(',').map((tag) => tag.trim()).filter(Boolean), [tagInput])
  const currentTagQuery = tagInput.split(',').at(-1)?.trim().toLocaleLowerCase() ?? ''
  const tagSuggestions = useMemo(() => {
    const selected = new Set(selectedTags.map((tag) => tag.toLocaleLowerCase()))
    return [...new Set(availableTags.map((tag) => tag.trim()).filter(Boolean))]
      .filter((tag) => !selected.has(tag.toLocaleLowerCase()))
      .map((tag) => ({ tag, score: tagMatchScore(tag, currentTagQuery) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
      .slice(0, 8)
  }, [availableTags, currentTagQuery, selectedTags])
  const filteredStatusCodes = useMemo(() => {
    const query = statusQuery.trim().toLocaleLowerCase()
    if (!query) return knownHttpStatusCodes
    return knownHttpStatusCodes.filter(([code, label]) => `${code} ${label}`.toLocaleLowerCase().includes(query))
  }, [statusQuery])

  useEffect(() => {
    if (!statusPickerOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!statusPickerRef.current?.contains(event.target as Node)) setStatusPickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [statusPickerOpen])

  const selectedType = useMemo(() => monitorTypes.find((item) => item.value === draft.type)!, [draft.type])
  const visibleMonitorTypes = lockType
    ? monitorTypes.filter((item) => item.value === draft.type)
    : creatableMonitorTypes
  const set = <K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const addSuggestedTag = (tag: string) => {
    const completed = tagInput.split(',').slice(0, -1).map((value) => value.trim()).filter(Boolean)
    setTagInput(`${[...new Set([...completed, tag])].join(', ')}, `)
  }

  const acceptedRuleCount = draft.allowedStatusClasses.length + draft.allowedStatusCodes.length
  const addAcceptedStatus = (value: string) => {
    if (!value) return
    const [kind, raw] = value.split(':')
    const status = Number(raw)
    if (kind === 'class' && status >= 1 && status <= 5 && !draft.allowedStatusClasses.includes(status)) {
      set('allowedStatusClasses', [...draft.allowedStatusClasses, status].sort())
    } else if (kind === 'code' && knownHttpStatusCodes.some(([code]) => code === status) && !draft.allowedStatusCodes.includes(status)) {
      set('allowedStatusCodes', [...draft.allowedStatusCodes, status].sort())
    }
  }

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
          {visibleMonitorTypes.map(({ value, label, description, icon: Icon }) => (
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
          <Field label="Tags" hint="Type a new tag or choose an existing workspace tag.">
            <div className="tag-editor">
              <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="production, critical" autoComplete="off" />
              {tagSuggestions.length > 0 && <div className="tag-suggestions" aria-label="Existing tag suggestions">{tagSuggestions.map(({ tag }) => <button type="button" key={tag} onMouseDown={(event) => event.preventDefault()} onClick={() => addSuggestedTag(tag)}>{tag}</button>)}</div>}
            </div>
          </Field>
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
                  <Field label="Accepted HTTP codes" hint="A response is up when it matches any selected class or exact code.">
                    <div className="http-status-editor" ref={statusPickerRef}>
                      <div
                        className={`http-status-editor__control${statusPickerOpen ? ' is-open' : ''}`}
                        data-testid="http-status-control"
                        tabIndex={0}
                        aria-label="Accepted HTTP statuses"
                        aria-haspopup="listbox"
                        aria-expanded={statusPickerOpen}
                        onClick={(event) => {
                          event.preventDefault()
                          setStatusPickerOpen((open) => !open)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setStatusPickerOpen((open) => !open)
                          } else if (event.key === 'Escape') setStatusPickerOpen(false)
                        }}
                      >
                        <div className="http-status-editor__chips">
                          {draft.allowedStatusClasses.map((statusClass) => <span key={`class-${statusClass}`} className={`http-status-chip http-status-chip--${statusClass}`}><strong>{statusClass}xx</strong><button type="button" aria-label={`Remove ${statusClass}xx`} disabled={acceptedRuleCount === 1} onClick={(event) => { event.stopPropagation(); set('allowedStatusClasses', draft.allowedStatusClasses.filter((value) => value !== statusClass)) }}><X size={13} /></button></span>)}
                          {draft.allowedStatusCodes.map((statusCode) => <span key={`code-${statusCode}`} className={`http-status-chip http-status-chip--${Math.floor(statusCode / 100)}`}><strong>{statusCode}</strong><button type="button" aria-label={`Remove ${statusCode}`} disabled={acceptedRuleCount === 1} onClick={(event) => { event.stopPropagation(); set('allowedStatusCodes', draft.allowedStatusCodes.filter((value) => value !== statusCode)) }}><X size={13} /></button></span>)}
                          <span className="http-status-editor__placeholder">Add status…</span>
                        </div>
                        <ChevronDown size={17} aria-hidden="true" />
                      </div>
                      {statusPickerOpen && (
                        <div className="http-status-menu" role="listbox" aria-label="Known HTTP statuses">
                          <input aria-label="Filter HTTP statuses" value={statusQuery} onChange={(event) => setStatusQuery(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder="Search by code or name…" autoFocus />
                          {!statusQuery.trim() && <section><strong>Status classes</strong>{httpStatusClasses.map(({ value, label, description }) => {
                            const selected = draft.allowedStatusClasses.includes(value)
                            return <button type="button" role="option" aria-selected={selected} key={value} disabled={selected} onClick={() => addAcceptedStatus(`class:${value}`)}><span className={`http-status-menu__dot http-status-menu__dot--${value}`} /><span><b>{label}</b><small>{description}</small></span>{selected && <Check size={15} />}</button>
                          })}</section>}
                          {[1, 2, 3, 4, 5].map((statusClass) => {
                            const codes = filteredStatusCodes.filter(([code]) => Math.floor(code / 100) === statusClass)
                            if (!codes.length) return null
                            return <section key={statusClass}><strong>{statusClass}xx exact codes</strong>{codes.map(([code, label]) => {
                              const selected = draft.allowedStatusCodes.includes(code)
                              return <button type="button" role="option" aria-selected={selected} key={code} disabled={selected} onClick={() => addAcceptedStatus(`code:${code}`)}><span className={`http-status-menu__dot http-status-menu__dot--${statusClass}`} /><span><b>{code}</b><small>{label}</small></span>{selected && <Check size={15} />}</button>
                            })}</section>
                          })}
                          {filteredStatusCodes.length === 0 && <p className="http-status-menu__empty">No known HTTP status found.</p>}
                        </div>
                      )}
                    </div>
                  </Field>
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
