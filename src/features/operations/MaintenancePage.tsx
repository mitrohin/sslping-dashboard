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
import { useI18n } from '../../app/I18nProvider'
import { dateTimeInputToUTC, dateToTimeZoneInput, timeZoneGroups, timeZones } from '../../lib/timezones'

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
  defaultTimezone?: string
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

const emptyDraft = (defaultTimezone?: string): MaintenanceDraft => ({
  name: '',
  monitorIds: [],
  startsAt: '',
  durationMinutes: 60,
  timezone: defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  recurrence: 'once',
  weekdays: [],
  endsAt: '',
  active: true,
})

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function MaintenancePage({
  windows: initialWindows = demoMaintenanceWindows,
  monitors = demoMonitors,
  initialCreateMonitorId,
  defaultTimezone,
  onCreate,
  onUpdate,
  onDelete,
}: MaintenancePageProps) {
  const { t } = useI18n()
  const recurrenceLabel = (recurrence: MaintenanceRecurrence): string => t(`maintenance.recurrence.${recurrence}`)
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
      ...emptyDraft(defaultTimezone),
      name: monitor ? t('maintenance.onMonitor', { name: monitor.name }) : '',
      monitorIds: [initialCreateMonitorId],
    })
  }, [defaultTimezone, initialCreateMonitorId, monitors])

  const openCreate = () => {
    setError('')
    setDraft(emptyDraft(defaultTimezone))
  }

  const openEdit = (window: MaintenanceWindowViewModel) => {
    setError('')
    setDraft({
      id: window.id,
      name: window.name,
      monitorIds: [...window.monitorIds],
      startsAt: dateToTimeZoneInput(window.startsAt, window.timezone),
      durationMinutes: window.durationMinutes,
      timezone: window.timezone,
      recurrence: window.recurrence,
      weekdays: [...window.weekdays],
      endsAt: window.endsAt ? dateToTimeZoneInput(window.endsAt, window.timezone) : '',
      active: window.active,
    })
  }

  const updateDraft = <Key extends keyof MaintenanceDraft>(key: Key, value: MaintenanceDraft[Key]) =>
    setDraft((current) => current ? { ...current, [key]: value } : current)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    if (!draft.name.trim() || draft.monitorIds.length === 0 || !draft.startsAt) {
      setError(t('maintenance.validationRequired'))
      return
    }
    if (draft.recurrence === 'weekly' && draft.weekdays.length === 0) {
      setError(t('maintenance.validationWeekday'))
      return
    }
    const parsedStart = dateTimeInputToUTC(draft.startsAt, draft.timezone)
    const parsedEnd = draft.endsAt ? dateTimeInputToUTC(draft.endsAt, draft.timezone) : null
    if (!parsedStart || (draft.endsAt && !parsedEnd)) {
      setError(t('maintenance.validationDate'))
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
      ...(parsedEnd ? { endsAt: parsedEnd.toISOString() } : {}),
      active: draft.active,
    }
    const optimistic: MaintenanceWindowViewModel = {
      id: draft.id ?? makeId(),
      ...input,
      monitorNames: input.monitorIds.map((id) => monitorById.get(id)?.name ?? t('maintenance.unknownMonitor')),
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
      setError(caught instanceof Error ? caught.message : t('maintenance.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (window: MaintenanceWindowViewModel) => {
    if (!globalThis.confirm(t('maintenance.confirmDelete', { name: window.name }))) return
    const snapshot = windows
    setWindows((current) => current.filter((item) => item.id !== window.id))
    try {
      await onDelete?.(window.id)
    } catch (caught) {
      setWindows(snapshot)
      setError(caught instanceof Error ? caught.message : t('maintenance.deleteFailed'))
    }
  }

  return (
    <div className="page page--wide ops-page">
      <PageHeader
        title={t('maintenance.title')}
        description={t('maintenance.description')}
        actions={<Button type="button" onClick={openCreate}><Plus size={18} /> {t('maintenance.create')}</Button>}
      />

      {windows.length === 0 ? (
        <Panel className="ops-maintenance-empty">
          <EmptyState
            icon={<Wrench size={38} />}
            title={t('maintenance.first')}
            description={t('maintenance.firstHint')}
            action={<Button type="button" onClick={openCreate}><CalendarClock size={18} /> {t('maintenance.createWindow')}</Button>}
          />
        </Panel>
      ) : (
        <>
          <div className="ops-toolbar ops-toolbar--compact">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('maintenance.search')} aria-label={t('maintenance.searchLabel')} />
            <span className="ops-result-count">{t('maintenance.windowCount', { count: filteredWindows.length })}</span>
          </div>
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          <Panel className="ops-table-panel">
            <div className="ops-table-scroll ops-desktop-only">
              <table className="ops-data-table">
                <thead><tr><th>{t('nav.maintenance')}</th><th>{t('monitors.title')}</th><th>{t('maintenance.nextStart')}</th><th>{t('incidents.duration')}</th><th>{t('maintenance.repeat')}</th><th>{t('common.status')}</th><th className="ops-actions-column">{t('common.actions')}</th></tr></thead>
                <tbody>
                  {filteredWindows.map((window) => (
                    <tr key={window.id}>
                      <td><div className="ops-name-cell"><span className="ops-round-icon"><Wrench size={17} /></span><span><strong>{window.name}</strong><small>{window.timezone}</small></span></div></td>
                      <td>{window.monitorNames.join(', ')}</td>
                      <td>{formatDate(window.startsAt)}</td>
                      <td>{formatDuration(window.durationMinutes * 60)}</td>
                      <td><span className="ops-inline-meta"><Repeat2 size={15} />{recurrenceLabel(window.recurrence)}</span></td>
                      <td><Badge tone={window.state === 'upcoming' || window.state === 'active' ? 'success' : 'neutral'}>{formatStatus(window.state)}</Badge></td>
                      <td><div className="ops-row-actions"><IconButton label={t('maintenance.editNamed', { name: window.name })} onClick={() => openEdit(window)}><Edit3 size={17} /></IconButton><IconButton label={t('maintenance.deleteNamed', { name: window.name })} onClick={() => void remove(window)}><Trash2 size={17} /></IconButton></div></td>
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
                  <dl><div><dt>{t('maintenance.starts')}</dt><dd>{formatDate(window.startsAt)}</dd></div><div><dt>{t('incidents.duration')}</dt><dd>{formatDuration(window.durationMinutes * 60)}</dd></div><div><dt>{t('maintenance.repeat')}</dt><dd>{recurrenceLabel(window.recurrence)}</dd></div></dl>
                  <div className="ops-card-actions"><Button size="sm" variant="secondary" type="button" onClick={() => openEdit(window)}><Edit3 size={16} /> {t('common.edit')}</Button><IconButton label={t('maintenance.deleteNamed', { name: window.name })} onClick={() => void remove(window)}><Trash2 size={17} /></IconButton></div>
                </article>
              ))}
            </div>
            {filteredWindows.length === 0 && <div className="ops-filter-empty"><Search size={28} /><strong>{t('maintenance.empty')}</strong><span>{t('maintenance.emptyHint')}</span></div>}
          </Panel>
        </>
      )}

      <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? t('maintenance.editWindow') : t('maintenance.createWindow')} icon={<Wrench size={36} />} width="lg">
        {draft && (
          <form className="ops-form" onSubmit={submit}>
            <Field label={t('monitorForm.friendlyName')}><input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} required placeholder={t('maintenance.namePlaceholder')} /></Field>
            <fieldset className="ops-check-grid">
              <legend>{t('monitors.title')}</legend>
              {monitors.map((monitor) => (
                <label key={monitor.id}>
                  <input type="checkbox" checked={draft.monitorIds.includes(monitor.id)} onChange={(event) => updateDraft('monitorIds', event.target.checked ? [...draft.monitorIds, monitor.id] : draft.monitorIds.filter((id) => id !== monitor.id))} />
                  <span><strong>{monitor.name}</strong><small>{monitor.target}</small></span>
                </label>
              ))}
            </fieldset>
            <div className="form-grid">
              <Field label={t('maintenance.repeat')}><Select value={draft.recurrence} onChange={(event) => updateDraft('recurrence', event.target.value as MaintenanceRecurrence)}><option value="once">{t('maintenance.dontRepeat')}</option><option value="daily">{t('maintenance.repeatDaily')}</option><option value="weekly">{t('maintenance.repeatWeekly')}</option></Select></Field>
              <Field label={t('maintenance.timezone')}><Select value={draft.timezone} onChange={(event) => updateDraft('timezone', event.target.value)}>{!timeZones.includes(draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}{timeZoneGroups.map((group) => <optgroup key={group.area} label={group.area}>{group.zones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</optgroup>)}</Select></Field>
            </div>
            {draft.recurrence === 'weekly' && (
              <fieldset className="ops-weekdays"><legend>{t('maintenance.weekdays')}</legend>{weekdays.map((day) => <label key={day.value} className={draft.weekdays.includes(day.value) ? 'is-selected' : ''}><input type="checkbox" checked={draft.weekdays.includes(day.value)} onChange={(event) => updateDraft('weekdays', event.target.checked ? [...draft.weekdays, day.value] : draft.weekdays.filter((value) => value !== day.value))} /><span>{t(`weekday.${day.value}`)}</span></label>)}</fieldset>
            )}
            <div className="form-grid">
              <Field label={t('maintenance.startDate')}><input type="datetime-local" value={draft.startsAt} onChange={(event) => updateDraft('startsAt', event.target.value)} required /></Field>
              <Field label={t('maintenance.durationMinutes')}><input type="number" min={1} max={525_600} value={draft.durationMinutes} onChange={(event) => updateDraft('durationMinutes', Number(event.target.value))} required /></Field>
            </div>
            {draft.recurrence !== 'once' && <Field label={t('maintenance.repeatUntil')} hint={t('maintenance.repeatUntilHint')}><input type="datetime-local" value={draft.endsAt} onChange={(event) => updateDraft('endsAt', event.target.value)} /></Field>}
            {draft.id && <div className="toggle-row"><Toggle checked={draft.active} onChange={(value) => updateDraft('active', value)} label={t('maintenance.active')} /><div className="toggle-row__copy"><strong>{t('maintenance.activeSchedule')}</strong><span>{t('maintenance.activeHint')}</span></div></div>}
            {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
            <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setDraft(null)}>{t('common.close')}</Button><Button type="submit" disabled={busy}><CalendarClock size={17} /> {busy ? t('common.saving') : draft.id ? t('common.saveChanges') : t('maintenance.createWindow')}</Button></div>
          </form>
        )}
      </Modal>
    </div>
  )
}

export default MaintenancePage
