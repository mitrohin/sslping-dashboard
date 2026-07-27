import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CalendarClock,
  Edit3,
  Plus,
  Repeat2,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react'
import {
  demoMaintenanceWindows,
  demoMonitors,
  type MaintenanceRecurrence,
  type MaintenanceWindowViewModel,
  type MonitorViewModel,
} from '../../data'
import { formatDate, formatDuration, formatStatus } from '../../lib/format'
import { Badge, Button, EmptyState, FeedbackBanner, Field, IconButton, Modal, PageHeader, Panel, SearchInput, Select, Toggle } from '../../components/ui'
import './operations.css'

type MaybePromise<T> = T | Promise<T>

export interface MaintenanceWindowInput {
  name: string
  monitorIds: readonly string[]
  startsAt: string
  durationMinutes: number
  timezone: string
  recurrence: MaintenanceRecurrence
  weekdays: readonly number[]
  endsAt?: string
  active: boolean
}

export interface MaintenancePageProps {
  windows?: readonly MaintenanceWindowViewModel[]
  monitors?: readonly MonitorViewModel[]
  initialCreateMonitorId?: string
  onCreate?: (input: MaintenanceWindowInput) => MaybePromise<MaintenanceWindowViewModel | void>
  onUpdate?: (windowId: string, input: MaintenanceWindowInput) => MaybePromise<MaintenanceWindowViewModel | void>
  onDelete?: (windowId: string) => MaybePromise<void>
}

interface MaintenanceDraft {
  id?: string
  name: string
  monitorIds: readonly string[]
  startsAt: string
  durationMinutes: number
  timezone: string
  recurrence: MaintenanceRecurrence
  weekdays: readonly number[]
  endsAt: string
  active: boolean
}

const weekdays = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const

const timezones = ['UTC', 'Europe/London', 'Europe/Moscow', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo'] as const

const emptyDraft = (): MaintenanceDraft => ({
  name: '',
  monitorIds: [],
  startsAt: '',
  durationMinutes: 60,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  recurrence: 'once',
  weekdays: [],
  endsAt: '',
  active: true,
})

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

const recurrenceLabel = (recurrence: MaintenanceRecurrence): string =>
  recurrence === 'once' ? 'Does not repeat' : recurrence === 'daily' ? 'Repeats daily' : 'Repeats weekly'

export function MaintenancePage({
  windows: initialWindows = demoMaintenanceWindows,
  monitors = demoMonitors,
  initialCreateMonitorId,
  onCreate,
  onUpdate,
  onDelete,
}: MaintenancePageProps) {
  const [windows, setWindows] = useState<MaintenanceWindowViewModel[]>(() => [...initialWindows])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<MaintenanceDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const monitorById = useMemo(() => new Map(monitors.map((monitor) => [monitor.id, monitor])), [monitors])
  const filteredWindows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return windows
    return windows.filter((window) =>
      window.name.toLowerCase().includes(normalized) ||
      window.monitorNames.some((name) => name.toLowerCase().includes(normalized)),
    )
  }, [query, windows])

  useEffect(() => {
    if (!initialCreateMonitorId || !monitors.some((monitor) => monitor.id === initialCreateMonitorId)) return
    const monitor = monitors.find((item) => item.id === initialCreateMonitorId)
    setError('')
    setDraft({
      ...emptyDraft(),
      name: monitor ? `Maintenance on ${monitor.name}` : '',
      monitorIds: [initialCreateMonitorId],
    })
  }, [initialCreateMonitorId, monitors])

  const openCreate = () => {
    setError('')
    setDraft(emptyDraft())
  }

  const openEdit = (window: MaintenanceWindowViewModel) => {
    setError('')
    setDraft({
      id: window.id,
      name: window.name,
      monitorIds: [...window.monitorIds],
      startsAt: window.startsAt.slice(0, 16),
      durationMinutes: window.durationMinutes,
      timezone: window.timezone,
      recurrence: window.recurrence,
      weekdays: [...window.weekdays],
      endsAt: window.endsAt?.slice(0, 16) ?? '',
      active: window.active,
    })
  }

  const updateDraft = <Key extends keyof MaintenanceDraft>(key: Key, value: MaintenanceDraft[Key]) =>
    setDraft((current) => current ? { ...current, [key]: value } : current)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    if (!draft.name.trim() || draft.monitorIds.length === 0 || !draft.startsAt) {
      setError('Name, start time, and at least one monitor are required.')
      return
    }
    if (draft.recurrence === 'weekly' && draft.weekdays.length === 0) {
      setError('Choose at least one weekday for a weekly window.')
      return
    }
    const parsedStart = new Date(draft.startsAt)
    if (Number.isNaN(parsedStart.getTime())) {
      setError('Choose a valid start date and time.')
      return
    }
    const input: MaintenanceWindowInput = {
      name: draft.name.trim(),
      monitorIds: draft.monitorIds,
      startsAt: parsedStart.toISOString(),
      durationMinutes: Math.max(1, Math.min(525_600, draft.durationMinutes)),
      timezone: draft.timezone,
      recurrence: draft.recurrence,
      weekdays: draft.recurrence === 'weekly' ? draft.weekdays : [],
      ...(draft.endsAt ? { endsAt: new Date(draft.endsAt).toISOString() } : {}),
      active: draft.active,
    }
    const optimistic: MaintenanceWindowViewModel = {
      id: draft.id ?? makeId(),
      ...input,
      monitorNames: input.monitorIds.map((id) => monitorById.get(id)?.name ?? 'Unknown monitor'),
      state: input.active ? 'upcoming' : 'disabled',
    }
    const snapshot = windows
    setWindows((current) => draft.id
      ? current.map((window) => window.id === draft.id ? optimistic : window)
      : [optimistic, ...current],
    )
    setBusy(true)
    setError('')
    try {
      const persisted = draft.id
        ? await onUpdate?.(draft.id, input)
        : await onCreate?.(input)
      if (persisted) {
        setWindows((current) => current.map((window) => window.id === optimistic.id ? persisted : window))
      }
      setDraft(null)
    } catch (caught) {
      setWindows(snapshot)
      setError(caught instanceof Error ? caught.message : 'The maintenance window could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (window: MaintenanceWindowViewModel) => {
    if (!globalThis.confirm(`Delete “${window.name}”?`)) return
    const snapshot = windows
    setWindows((current) => current.filter((item) => item.id !== window.id))
    try {
      await onDelete?.(window.id)
    } catch (caught) {
      setWindows(snapshot)
      setError(caught instanceof Error ? caught.message : 'The maintenance window could not be deleted.')
    }
  }

  return (
    <div className="page page--wide ops-page">
      <PageHeader
        title="Maintenance windows"
        description="Suppress alerts during planned work and keep maintenance out of uptime statistics."
        actions={<Button type="button" onClick={openCreate}><Plus size={18} /> Create maintenance</Button>}
      />

      {windows.length === 0 ? (
        <Panel className="ops-maintenance-empty">
          <EmptyState
            icon={<Wrench size={38} />}
            title="Plan your first maintenance"
            description="Choose affected monitors and a schedule. Alerts are paused while the maintenance window is active."
            action={<Button type="button" onClick={openCreate}><CalendarClock size={18} /> Create maintenance window</Button>}
          />
        </Panel>
      ) : (
        <>
          <div className="ops-toolbar ops-toolbar--compact">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by maintenance name or monitor" aria-label="Search maintenance windows" />
            <span className="ops-result-count">{filteredWindows.length} windows</span>
          </div>
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          <Panel className="ops-table-panel">
            <div className="ops-table-scroll ops-desktop-only">
              <table className="ops-data-table">
                <thead><tr><th>Maintenance</th><th>Monitors</th><th>Next start</th><th>Duration</th><th>Repeat</th><th>Status</th><th className="ops-actions-column">Actions</th></tr></thead>
                <tbody>
                  {filteredWindows.map((window) => (
                    <tr key={window.id}>
                      <td><div className="ops-name-cell"><span className="ops-round-icon"><Wrench size={17} /></span><span><strong>{window.name}</strong><small>{window.timezone}</small></span></div></td>
                      <td>{window.monitorNames.join(', ')}</td>
                      <td>{formatDate(window.startsAt)}</td>
                      <td>{formatDuration(window.durationMinutes * 60)}</td>
                      <td><span className="ops-inline-meta"><Repeat2 size={15} />{recurrenceLabel(window.recurrence)}</span></td>
                      <td><Badge tone={window.state === 'upcoming' || window.state === 'active' ? 'success' : 'neutral'}>{formatStatus(window.state)}</Badge></td>
                      <td><div className="ops-row-actions"><IconButton label={`Edit ${window.name}`} onClick={() => openEdit(window)}><Edit3 size={17} /></IconButton><IconButton label={`Delete ${window.name}`} onClick={() => void remove(window)}><Trash2 size={17} /></IconButton></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ops-mobile-only ops-card-list">
              {filteredWindows.map((window) => (
                <article className="ops-resource-card" key={window.id}>
                  <div className="ops-card-row"><span className="ops-round-icon"><Wrench size={17} /></span><Badge tone={window.active ? 'success' : 'neutral'}>{formatStatus(window.state)}</Badge></div>
                  <h2>{window.name}</h2>
                  <p>{window.monitorNames.join(', ')}</p>
                  <dl><div><dt>Starts</dt><dd>{formatDate(window.startsAt)}</dd></div><div><dt>Duration</dt><dd>{formatDuration(window.durationMinutes * 60)}</dd></div><div><dt>Repeat</dt><dd>{recurrenceLabel(window.recurrence)}</dd></div></dl>
                  <div className="ops-card-actions"><Button size="sm" variant="secondary" type="button" onClick={() => openEdit(window)}><Edit3 size={16} /> Edit</Button><IconButton label={`Delete ${window.name}`} onClick={() => void remove(window)}><Trash2 size={17} /></IconButton></div>
                </article>
              ))}
            </div>
            {filteredWindows.length === 0 && <div className="ops-filter-empty"><Search size={28} /><strong>No matching windows</strong><span>Try another maintenance name or monitor.</span></div>}
          </Panel>
        </>
      )}

      <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? 'Edit maintenance window' : 'Create maintenance window'} icon={<Wrench size={36} />} width="lg">
        {draft && (
          <form className="ops-form" onSubmit={submit}>
            <Field label="Friendly name"><input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} required placeholder="Maintenance on production API" /></Field>
            <fieldset className="ops-check-grid">
              <legend>Monitors</legend>
              {monitors.map((monitor) => (
                <label key={monitor.id}>
                  <input type="checkbox" checked={draft.monitorIds.includes(monitor.id)} onChange={(event) => updateDraft('monitorIds', event.target.checked ? [...draft.monitorIds, monitor.id] : draft.monitorIds.filter((id) => id !== monitor.id))} />
                  <span><strong>{monitor.name}</strong><small>{monitor.target}</small></span>
                </label>
              ))}
            </fieldset>
            <div className="form-grid">
              <Field label="Repeat"><Select value={draft.recurrence} onChange={(event) => updateDraft('recurrence', event.target.value as MaintenanceRecurrence)}><option value="once">Don't repeat</option><option value="daily">Repeat daily</option><option value="weekly">Repeat weekly</option></Select></Field>
              <Field label="Time zone"><Select value={draft.timezone} onChange={(event) => updateDraft('timezone', event.target.value)}>{timezones.includes(draft.timezone as typeof timezones[number]) ? null : <option value={draft.timezone}>{draft.timezone}</option>}{timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</Select></Field>
            </div>
            {draft.recurrence === 'weekly' && (
              <fieldset className="ops-weekdays"><legend>Days in week to repeat</legend>{weekdays.map((day) => <label key={day.value} className={draft.weekdays.includes(day.value) ? 'is-selected' : ''}><input type="checkbox" checked={draft.weekdays.includes(day.value)} onChange={(event) => updateDraft('weekdays', event.target.checked ? [...draft.weekdays, day.value] : draft.weekdays.filter((value) => value !== day.value))} /><span>{day.label}</span></label>)}</fieldset>
            )}
            <div className="form-grid">
              <Field label="Start date & time"><input type="datetime-local" value={draft.startsAt} onChange={(event) => updateDraft('startsAt', event.target.value)} required /></Field>
              <Field label="Duration (minutes)"><input type="number" min={1} max={525_600} value={draft.durationMinutes} onChange={(event) => updateDraft('durationMinutes', Number(event.target.value))} required /></Field>
            </div>
            {draft.recurrence !== 'once' && <Field label="Repeat until" hint="Optional end for this recurring schedule."><input type="datetime-local" value={draft.endsAt} onChange={(event) => updateDraft('endsAt', event.target.value)} /></Field>}
            {draft.id && <div className="toggle-row"><Toggle checked={draft.active} onChange={(value) => updateDraft('active', value)} label="Maintenance active" /><div className="toggle-row__copy"><strong>Active schedule</strong><span>Disabled windows remain in history but do not suppress alerts.</span></div></div>}
            {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
            <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setDraft(null)}>Close</Button><Button type="submit" disabled={busy}><CalendarClock size={17} /> {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create window'}</Button></div>
          </form>
        )}
      </Modal>
    </div>
  )
}

export default MaintenancePage
