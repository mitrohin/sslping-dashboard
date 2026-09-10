import { useI18n } from '../app/I18nProvider'
import type { AvailabilityCoverage, ExpirySnapshot } from '../data/models'
import { formatDate, formatDuration, formatRelativeTime } from '../lib/format'

export function AvailabilityNote({ coverage }: { coverage?: AvailabilityCoverage }) {
  const { locale } = useI18n()
  const ru = locale === 'ru'
  if (!coverage) return null
  const incomplete = coverage.complete === false
  return <small className={incomplete || coverage.known === false ? 'warning-text availability-note' : 'muted availability-note'}>
    {coverage.known === false ? (ru ? 'Нет сохранённых проверок за период.' : 'No retained observations for this period.')
      : coverage.complete === undefined ? (ru ? 'Полнота истории неизвестна.' : 'History coverage is unknown.')
        : incomplete ? (ru ? 'История неполная.' : 'Incomplete history.') : null}
    {incomplete && coverage.unknownSeconds !== undefined ? ` ${ru ? 'Без наблюдений' : 'Unobserved'}: ${formatDuration(coverage.unknownSeconds)}.` : ''}
    {coverage.method === 'incident_duration' ? ` ${ru ? 'Доступность рассчитана по длительности инцидентов.' : 'Availability is based on incident duration.'}` : ''}
    {coverage.sampleFrom && coverage.sampleTo && incomplete ? ` ${ru ? 'Сохранённые проверки' : 'Retained checks'}: ${formatDate(coverage.sampleFrom, { includeYear: true })} – ${formatDate(coverage.sampleTo, { includeYear: true })}.` : ''}
    {coverage.resolutionSeconds && coverage.resolutionSeconds > 1 ? ` ${ru ? 'Точность покрытия' : 'Coverage resolution'}: ${formatDuration(coverage.resolutionSeconds)}.` : ''}
  </small>
}

export function EvidenceFreshness({ evidence, now }: { evidence: ExpirySnapshot; now: number }) {
  const { locale } = useI18n()
  const ru = locale === 'ru'
  const stale = evidence.stale === true || (evidence.refreshAfter !== undefined && Date.parse(evidence.refreshAfter) < now)
  return <small className={stale ? 'warning-text' : 'muted'}>
    {stale ? (ru ? 'Сохранённые данные устарели. ' : 'Cached evidence is stale. ') : ''}
    {evidence.checkedAt ? `${ru ? 'Проверено' : 'Checked'} ${formatRelativeTime(evidence.checkedAt, now)}.` : (ru ? 'Время последней проверки неизвестно.' : 'Last evidence check time is unknown.')}
  </small>
}
