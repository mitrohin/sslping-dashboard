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
  Plus,
  Radio,
  Scale,
  ServerCog,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Button, Field, Select, Toggle } from '../../components/ui'
import type { DNSConfig, Region } from '../../api/types'
import type { MonitorType } from '../../data'
import { useI18n } from '../../app/I18nProvider'

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
  leakQueryType: 'email' | 'phone' | 'username'
  complianceFramework: 'ru_152_fz'
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
  { value: 'leakcheck', label: 'Leak exposure', description: 'Email, phone or username breach lookup', icon: ShieldAlert },
  { value: 'compliance', label: 'Legal compliance', description: 'Scheduled website legislation review', icon: Scale },
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
  leakQueryType: 'email',
  complianceFramework: 'ru_152_fz',
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

export function MonitorForm({
  initialValue = defaultMonitorDraft,
  submitLabel = 'Create monitor',
  onSubmit,
  onCancel,
  lockType = false,
  availableTags = [],
  availableLocations = [],
  maxLocations = 20,
}: {
  initialValue?: MonitorDraft
  submitLabel?: string
  onSubmit: (draft: MonitorDraft) => Promise<void> | void
  onCancel?: () => void
  lockType?: boolean
  availableTags?: readonly string[]
  availableLocations?: readonly Region[]
  maxLocations?: number
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<MonitorDraft>(initialValue)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedTagValues, setSelectedTagValues] = useState<string[]>([...draft.tags])
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [statusPickerOpen, setStatusPickerOpen] = useState(false)
  const [statusQuery, setStatusQuery] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const tagPickerRef = useRef<HTMLDivElement>(null)
  const statusPickerRef = useRef<HTMLDivElement>(null)

  const tagSuggestions = useMemo(() => {
    const selected = new Set(selectedTagValues.map((tag) => tag.toLocaleLowerCase()))
    const query = tagQuery.trim().toLocaleLowerCase()
    return [...new Set(availableTags.map((tag) => tag.trim()).filter(Boolean))]
      .filter((tag) => !selected.has(tag.toLocaleLowerCase()))
      .map((tag) => ({ tag, score: tagMatchScore(tag, query) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
      .slice(0, 20)
  }, [availableTags, selectedTagValues, tagQuery])
  const canCreateTag = tagQuery.trim().length > 0
    && ![...availableTags, ...selectedTagValues].some((tag) => tag.toLocaleLowerCase() === tagQuery.trim().toLocaleLowerCase())
  const filteredStatusCodes = useMemo(() => {
    const query = statusQuery.trim().toLocaleLowerCase()
    if (!query) return knownHttpStatusCodes
    return knownHttpStatusCodes.filter(([code, label]) => `${code} ${label}`.toLocaleLowerCase().includes(query))
  }, [statusQuery])

  useEffect(() => {
    if (!tagPickerOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!tagPickerRef.current?.contains(event.target as Node)) setTagPickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [tagPickerOpen])

  useEffect(() => {
    if (!statusPickerOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!statusPickerRef.current?.contains(event.target as Node)) setStatusPickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [statusPickerOpen])

  const locationLimit = Math.max(1, Math.min(20, Math.floor(maxLocations) || 1))

  useEffect(() => {
    if ((draft.type === 'heartbeat' || draft.type === 'compliance') && (draft.regions.length !== 1 || draft.regions[0] !== 'local')) {
      setDraft((current) => ({ ...current, regions: ['local'] }))
      return
    }
    if (draft.type !== 'heartbeat' && draft.type !== 'compliance' && draft.type !== 'leakcheck') {
      const regions = ['local', ...draft.regions.filter((region, index, all) => region !== 'local' && all.indexOf(region) === index)].slice(0, locationLimit)
      if (regions.length !== draft.regions.length || regions.some((region, index) => region !== draft.regions[index])) {
        setDraft((current) => ({ ...current, regions }))
      }
    }
  }, [draft.regions, draft.type, locationLimit])

  const selectedType = useMemo(() => monitorTypes.find((item) => item.value === draft.type)!, [draft.type])
  const locationOptions = useMemo(() => {
    const selected = new Set(draft.regions)
    const items = availableLocations
      .filter((location) => selected.has(location.id) || location.capabilities.includes(draft.type as Region['capabilities'][number]))
      .map((location) => ({ ...location, legacy: false }))
    const known = new Set(items.map((location) => location.id))
    for (const region of draft.regions) {
      if (!known.has(region)) {
        items.push({
          id: region as Region['id'],
          name: region === 'local' ? 'Frankfurt' : region,
          capabilities: [],
          status: region === 'local' ? 'available' : 'connecting',
          system: region === 'local',
          legacy: true,
        })
      }
    }
    if (items.length === 0) {
      items.push({ id: 'local', name: 'Frankfurt', capabilities: [], status: 'available', system: true, legacy: true })
    }
    return items
  }, [availableLocations, draft.regions, draft.type, t])
  const visibleMonitorTypes = lockType
    ? monitorTypes.filter((item) => item.value === draft.type)
    : creatableMonitorTypes
  const set = <K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const toggleLocation = (location: string) => {
    if (location === 'local') return
    setDraft((current) => {
      const selected = current.regions.includes(location)
      if (selected) {
        if (current.regions.length === 1) return current
        return { ...current, regions: current.regions.filter((region) => region !== location) }
      }
      if (current.regions.length >= locationLimit) return current
      return { ...current, regions: [...current.regions, location] }
    })
  }

  const addTag = (tag: string) => {
    const value = tag.trim()
    if (!value || selectedTagValues.some((selected) => selected.toLocaleLowerCase() === value.toLocaleLowerCase())) return
    setSelectedTagValues((selected) => [...selected, value])
    setTagQuery('')
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
      await onSubmit({ ...draft, tags: selectedTagValues })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('monitorForm.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="monitor-form" onSubmit={handleSubmit}>
      <section className="form-section">
        <h3 className="form-section__title">{t('monitorForm.what')}</h3>
        <div className="monitor-type-grid">
          {visibleMonitorTypes.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className={draft.type === value ? 'is-selected' : ''}
              disabled={lockType && draft.type !== value}
              onClick={() => {
                if (lockType) return
                set('type', value)
                if (value === 'heartbeat') {
                  set('target', '86400')
                  set('regions', ['local'])
                }
                else if (value === 'leakcheck') set('target', '')
                else if (value === 'compliance') {
                  set('target', 'https://')
                  set('intervalSeconds', 86400)
                  set('timeoutSeconds', 60)
                  set('regions', ['local'])
                  set('group', 'Compliance')
                  set('failureThreshold', 1)
                  set('recoveryThreshold', 1)
                } else if (draft.type === 'heartbeat' || draft.type === 'compliance') {
                  set('target', value === 'http' || value === 'keyword' ? 'https://' : '')
                  set('intervalSeconds', 60)
                  set('timeoutSeconds', 15)
                  set('regions', ['local'])
                  set('group', 'Monitors')
                }
              }}
            >
              <Icon size={21} />
              <span><strong>{t(`monitorType.${value}.label`)}</strong><small>{t(`monitorType.${value}.description`)}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="form-section">
        <div className="form-grid">
          <Field label={t('monitorForm.friendlyName')} hint={t('monitorForm.friendlyNameHint')}>
            <input value={draft.name} onChange={(event) => set('name', event.target.value)} required maxLength={200} placeholder={t('monitorForm.namePlaceholder', { type: t(`monitorType.${selectedType.value}.label`) })} />
          </Field>
          <Field label={t(draft.type === 'leakcheck' ? 'monitorForm.leakIdentifier' : draft.type === 'heartbeat' ? 'monitorForm.targetHeartbeat' : draft.type === 'dns' ? 'monitorForm.targetDNS' : draft.type === 'domain' ? 'monitorForm.targetDomain' : draft.type === 'tcp' || draft.type === 'udp' || draft.type === 'tls' || draft.type === 'reachability' ? 'monitorForm.targetHost' : 'monitorForm.targetURL')}>
            {draft.type === 'heartbeat' ? (
              <Select value={draft.target} onChange={(event) => set('target', event.target.value)}>
                <option value="300">{t('monitorForm.every5m')}</option>
                <option value="3600">{t('monitorForm.everyHour')}</option>
                <option value="86400">{t('monitorForm.every24h')}</option>
                <option value="604800">{t('monitorForm.everyWeek')}</option>
              </Select>
            ) : draft.type === 'leakcheck' ? (
              <input value={draft.target} onChange={(event) => set('target', event.target.value)} required autoComplete="off" placeholder={draft.leakQueryType === 'email' ? 'name@example.com' : draft.leakQueryType === 'phone' ? '+1 202 555 0100' : 'username'} />
            ) : (
              <input value={draft.target} onChange={(event) => set('target', event.target.value)} required placeholder={draft.type === 'domain' || draft.type === 'dns' ? 'example.com' : draft.type === 'http' || draft.type === 'keyword' || draft.type === 'compliance' ? 'https://example.com/health' : 'example.com:443'} />
            )}
          </Field>
        </div>

        {draft.type === 'leakcheck' && <div className="form-grid monitor-form__conditional"><Field label={t('monitorForm.leakIdentifierType')} hint={t('monitorForm.leakCacheHint')}><Select value={draft.leakQueryType} onChange={(event) => set('leakQueryType', event.target.value as MonitorDraft['leakQueryType'])}><option value="email">Email</option><option value="phone">{t('monitorForm.phone')}</option><option value="username">Username</option></Select></Field><div className="leakcheck-privacy-note"><ShieldAlert size={20} /><span>{t('monitorForm.leakPrivacy')}</span></div></div>}

        {draft.type === 'compliance' && <div className="form-grid monitor-form__conditional"><Field label={t('monitorForm.legislation')} hint={t('monitorForm.legislationHint')}><Select value={draft.complianceFramework} onChange={(event) => set('complianceFramework', event.target.value as MonitorDraft['complianceFramework'])}><option value="ru_152_fz">{t('monitorForm.ru152fz')}</option></Select></Field><div className="leakcheck-privacy-note"><Scale size={20} /><span>{t('monitorForm.complianceDisclaimer')}</span></div></div>}

        {draft.type === 'keyword' && (
          <div className="form-grid monitor-form__conditional">
            <Field label={t('monitorForm.keyword')} hint={t('monitorForm.keywordHint')}>
              <input value={draft.keyword} onChange={(event) => set('keyword', event.target.value)} required placeholder="status: ok" />
            </Field>
            <Field label={t('monitorForm.incidentWhen')}>
              <Select value={draft.keywordMode} onChange={(event) => set('keywordMode', event.target.value as 'present' | 'absent')}>
                <option value="present">{t('monitorForm.keywordMissing')}</option>
                <option value="absent">{t('monitorForm.keywordPresent')}</option>
              </Select>
            </Field>
          </div>
        )}

        {draft.type === 'dns' && (
          <div className="form-grid monitor-form__conditional">
            <Field label={t('monitorForm.recordType')}><Select value={draft.dnsRecordType} onChange={(event) => set('dnsRecordType', event.target.value as DNSConfig['record_type'])}><option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option><option>NS</option><option>TXT</option><option>SRV</option><option>CAA</option></Select></Field>
            <Field label={t('monitorForm.expectedValue')} hint={t('monitorForm.expectedValueHint')}><input value={draft.dnsExpected} onChange={(event) => set('dnsExpected', event.target.value)} placeholder="203.0.113.10" /></Field>
          </div>
        )}

        {draft.type === 'heartbeat' && (
          <div className="form-grid monitor-form__conditional">
            <Field label={t('monitorForm.gracePeriod')} hint={t('monitorForm.graceHint')}>
              <Select value={draft.heartbeatGraceSeconds} onChange={(event) => set('heartbeatGraceSeconds', Number(event.target.value))}>
                <option value={0}>{t('monitorForm.noGrace')}</option><option value={60}>{t('time.1m')}</option><option value={300}>{t('time.5m')}</option><option value={1800}>{t('time.30m')}</option><option value={3600}>{t('time.1h')}</option>
              </Select>
            </Field>
          </div>
        )}

        <div className="form-grid monitor-form__conditional">
          <Field label={t('monitorForm.group')}><Select value={draft.group} onChange={(event) => set('group', event.target.value)}><option>Monitors</option><option>Production</option><option>Core API</option><option>Infrastructure</option><option>Security</option><option>Compliance</option></Select></Field>
          <Field label={t('monitorForm.tags')} hint={t('monitorForm.tagsHint')}>
            <div className="tag-picker" ref={tagPickerRef}>
              <div
                className={`tag-picker__control${tagPickerOpen ? ' is-open' : ''}`}
                data-testid="tag-picker-control"
                tabIndex={0}
                aria-label={t('monitorForm.tags')}
                aria-haspopup="listbox"
                aria-expanded={tagPickerOpen}
                onClick={(event) => {
                  event.preventDefault()
                  setTagPickerOpen((open) => !open)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setTagPickerOpen((open) => !open)
                  } else if (event.key === 'Escape') setTagPickerOpen(false)
                }}
              >
                <div className="tag-picker__chips">
                  {selectedTagValues.map((tag) => <span className="tag-chip" key={tag}><strong>{tag}</strong><button type="button" aria-label={t('monitorForm.removeTag', { tag })} onClick={(event) => { event.stopPropagation(); setSelectedTagValues((selected) => selected.filter((value) => value !== tag)) }}><X size={13} /></button></span>)}
                  <span className="tag-picker__placeholder">{t('monitorForm.addTag')}</span>
                </div>
                <ChevronDown className="dropdown-chevron" size={18} aria-hidden="true" />
              </div>
              {tagPickerOpen && (
                <div className="tag-picker__menu" role="listbox" aria-label={t('monitorForm.workspaceTags')}>
                  <input aria-label={t('monitorForm.filterTags')} value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder={t('monitorForm.searchCreateTag')} autoFocus />
                  {tagSuggestions.map(({ tag }) => <button type="button" role="option" aria-selected="false" key={tag} onClick={() => addTag(tag)}><span>{tag}</span><small>{t('monitors.tags.existing')}</small></button>)}
                  {canCreateTag && <button type="button" role="option" aria-selected="false" className="tag-picker__create" onClick={() => addTag(tagQuery)}><Plus size={14} /><span>{t('monitors.tags.create', { tag: tagQuery.trim() })}</span></button>}
                  {tagSuggestions.length === 0 && !canCreateTag && <p>{t('monitorForm.noMoreTags')}</p>}
                </div>
              )}
            </div>
          </Field>
        </div>
      </section>

      {draft.type !== 'leakcheck' && <section className="form-section">
        <h3 className="form-section__title">{t('monitorForm.schedule')}</h3>
        <div className="form-grid form-grid--three">
          <Field label={t('monitorForm.interval')}><Select value={draft.intervalSeconds} onChange={(event) => set('intervalSeconds', Number(event.target.value))}>{draft.type === 'compliance' ? <><option value={86400}>{t('time.24h')}</option><option value={604800}>{t('monitorForm.everyWeek')}</option><option value={2592000}>{t('monitorForm.every30d')}</option></> : <><option value={30}>{t('time.30s')}</option><option value={60}>{t('time.1m')}</option><option value={300}>{t('time.5m')}</option><option value={1800}>{t('time.30m')}</option><option value={3600}>{t('time.1h')}</option><option value={43200}>{t('time.12h')}</option><option value={86400}>{t('time.24h')}</option></>}</Select></Field>
          <Field label={t('monitorForm.timeout')}><Select value={draft.timeoutSeconds} onChange={(event) => set('timeoutSeconds', Number(event.target.value))}><option value={5}>{t('time.5s')}</option><option value={10}>{t('time.10s')}</option><option value={15}>{t('time.15s')}</option><option value={30}>{t('time.30s')}</option><option value={60}>{t('time.60s')}</option></Select></Field>
          <Field label={t('monitorForm.location')} hint={t('monitorForm.locationLimit', { count: locationLimit })}>
            {draft.type === 'compliance' || draft.type === 'heartbeat' ? (
              <div className="monitor-location-fixed">{t(draft.type === 'compliance' ? 'monitorForm.complianceCrawler' : 'monitorForm.heartbeatProcessor')}</div>
            ) : (
              <div className="monitor-location-picker" role="group" aria-label={t('monitorForm.locations')}>
                {locationOptions.map((location) => {
                  const checked = draft.regions.includes(location.id)
                  const atLimit = !checked && draft.regions.length >= locationLimit
                  return <label className={checked ? 'is-selected' : ''} key={location.id}>
                    <input type="checkbox" checked={checked} disabled={location.id === 'local' || atLimit} onChange={() => toggleLocation(location.id)} />
                    <span><strong>{location.name}</strong><small>{location.id} · {location.id === 'local' ? t('monitorForm.locationPermanent') : t(`monitorForm.locationStatus.${location.status}`)}</small></span>
                  </label>
                })}
              </div>
            )}
          </Field>
        </div>
      </section>}

      {(draft.type === 'http' || draft.type === 'keyword' || draft.type === 'tls') && (
        <section className="form-section">
          <h3 className="form-section__title">{t('monitorForm.sslDomain')}</h3>
          <div className="monitor-toggle-grid">
            <div className="toggle-row"><Toggle checked={draft.checkSSLErrors} onChange={(value) => set('checkSSLErrors', value)} label={t('monitorForm.checkSSL')} /><div className="toggle-row__copy"><strong>{t('monitorForm.checkSSL')}</strong><span>{t('monitorForm.checkSSLHint')}</span></div></div>
            <div className="toggle-row"><Toggle checked={draft.sslReminders} onChange={(value) => set('sslReminders', value)} label={t('monitorForm.sslReminders')} /><div className="toggle-row__copy"><strong>{t('monitorForm.sslReminders')}</strong><span>{t('monitorForm.sslRemindersHint')}</span></div></div>
            <div className="toggle-row"><Toggle checked={draft.domainReminders} onChange={(value) => set('domainReminders', value)} label={t('monitorForm.domainReminders')} /><div className="toggle-row__copy"><strong>{t('monitorForm.domainReminders')}</strong><span>{t('monitorForm.domainRemindersHint')}</span></div></div>
          </div>
        </section>
      )}

      {draft.type !== 'leakcheck' && draft.type !== 'compliance' && <section className="form-section monitor-advanced">
        <button type="button" className="monitor-advanced__toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          <KeyRound size={18} /> {t('monitorForm.advanced')} <span>{advanced ? '−' : '+'}</span>
        </button>
        {advanced && (
          <div className="monitor-advanced__content">
            <div className="form-grid form-grid--three">
              <Field label={t('monitorForm.failureThreshold')}><input type="number" min={1} max={10} value={draft.failureThreshold} onChange={(event) => set('failureThreshold', Number(event.target.value))} /></Field>
              <Field label={t('monitorForm.recoveryThreshold')}><input type="number" min={1} max={10} value={draft.recoveryThreshold} onChange={(event) => set('recoveryThreshold', Number(event.target.value))} /></Field>
              <Field label={t('monitorForm.slowAlert')}><input type="number" min={0} value={draft.slowThresholdMs} onChange={(event) => set('slowThresholdMs', Number(event.target.value))} placeholder={t('common.disabled')} /></Field>
            </div>
            {(draft.type === 'http' || draft.type === 'keyword') && (
              <>
                <Field label={t('monitorForm.httpMethod')}><div className="http-methods">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => <button type="button" key={method} className={draft.method === method ? 'is-active' : ''} onClick={() => set('method', method)}>{method}</button>)}</div></Field>
                <div className="monitor-toggle-grid">
                  <div className="toggle-row"><Toggle checked={draft.followRedirects} onChange={(value) => set('followRedirects', value)} label={t('monitorForm.followRedirects')} /><div className="toggle-row__copy"><strong>{t('monitorForm.followRedirects')}</strong><span>{t('monitorForm.followRedirectsHint')}</span></div></div>
                </div>
                <div className="form-grid">
                  <Field label={t('monitorForm.authentication')}><Select><option>{t('common.none')}</option><option>Basic auth</option><option>Bearer token</option></Select></Field>
                  <Field label={t('monitorForm.acceptedCodes')} hint={t('monitorForm.acceptedCodesHint')}>
                    <div className="http-status-editor" ref={statusPickerRef}>
                      <div
                        className={`http-status-editor__control${statusPickerOpen ? ' is-open' : ''}`}
                        data-testid="http-status-control"
                        tabIndex={0}
                        aria-label={t('monitorForm.acceptedStatuses')}
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
                          <span className="http-status-editor__placeholder">{t('monitorForm.addStatus')}</span>
                        </div>
                        <ChevronDown className="dropdown-chevron" size={18} aria-hidden="true" />
                      </div>
                      {statusPickerOpen && (
                        <div className="http-status-menu" role="listbox" aria-label={t('monitorForm.knownStatuses')}>
                          <input aria-label={t('monitorForm.filterStatuses')} value={statusQuery} onChange={(event) => setStatusQuery(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder={t('monitorForm.searchStatus')} autoFocus />
                          {!statusQuery.trim() && <section><strong>{t('monitorForm.statusClasses')}</strong>{httpStatusClasses.map(({ value, label, description }) => {
                            const selected = draft.allowedStatusClasses.includes(value)
                            return <button type="button" role="option" aria-selected={selected} key={value} disabled={selected} onClick={() => addAcceptedStatus(`class:${value}`)}><span className={`http-status-menu__dot http-status-menu__dot--${value}`} /><span><b>{label}</b><small>{description}</small></span>{selected && <Check size={15} />}</button>
                          })}</section>}
                          {[1, 2, 3, 4, 5].map((statusClass) => {
                            const codes = filteredStatusCodes.filter(([code]) => Math.floor(code / 100) === statusClass)
                            if (!codes.length) return null
                            return <section key={statusClass}><strong>{t('monitorForm.exactCodes', { class: statusClass })}</strong>{codes.map(([code, label]) => {
                              const selected = draft.allowedStatusCodes.includes(code)
                              return <button type="button" role="option" aria-selected={selected} key={code} disabled={selected} onClick={() => addAcceptedStatus(`code:${code}`)}><span className={`http-status-menu__dot http-status-menu__dot--${statusClass}`} /><span><b>{code}</b><small>{label}</small></span>{selected && <Check size={15} />}</button>
                            })}</section>
                          })}
                          {filteredStatusCodes.length === 0 && <p className="http-status-menu__empty">{t('monitorForm.noStatus')}</p>}
                        </div>
                      )}
                    </div>
                  </Field>
                </div>
                <Field label={t('monitorForm.requestBody')}><textarea placeholder={'{"key":"value"}'} /></Field>
                <div className="form-grid"><Field label={t('monitorForm.requestHeader')}><input placeholder="X-Header-Name" /></Field><Field label={t('monitorForm.value')}><input placeholder={t('monitorForm.value')} /></Field></div>
              </>
            )}
          </div>
        )}
      </section>}

      <div className="form-actions">
        {submitError && <span className="field__error" role="alert">{submitError}</span>}
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>}
        <Button type="submit" disabled={saving}><Clock3 size={17} />{saving ? t('common.saving') : submitLabel === 'Create monitor' ? t('monitors.create') : submitLabel === 'Save changes' ? t('common.saveChanges') : submitLabel}</Button>
      </div>
    </form>
  )
}
