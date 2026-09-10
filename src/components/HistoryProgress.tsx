import './history-progress.css'
import { useState } from 'react'
import type { HistoryRange } from '../lib/useCursorHistory'
import { Button, FeedbackBanner } from './ui'
import { useI18n } from '../app/I18nProvider'

export interface HistoryProgressProps {
  hasMore?: boolean
  loading?: boolean
  error?: string
  onLoadMore?: () => void
  onRetry?: () => void
  onRangeChange?: (range: HistoryRange) => void
}

export function HistoryProgress({ hasMore, loading, error, onLoadMore, onRetry, onRangeChange }: HistoryProgressProps) {
  const { locale, t } = useI18n()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const invalidRange = Boolean(from && to && from > to)
  const updateRange = (start: string, end: string) => {
    setFrom(start); setTo(end)
    if (start && end && start > end) return
    const until = end ? new Date(`${end}T00:00:00`) : undefined
    until?.setDate(until.getDate() + 1)
    onRangeChange?.({ from: start ? new Date(`${start}T00:00:00`).toISOString() : undefined, to: until?.toISOString() })
  }
  return <div className="history-progress" aria-live="polite">
    {onRangeChange && <div className="history-range">
      <label>{locale === 'ru' ? 'С даты' : 'From date'}<input type="date" value={from} max={to || undefined} onChange={(event) => updateRange(event.target.value, to)} /></label>
      <label>{locale === 'ru' ? 'По дату' : 'Through date'}<input type="date" value={to} min={from || undefined} aria-invalid={invalidRange || undefined} onChange={(event) => updateRange(from, event.target.value)} /></label>
      {invalidRange && <span role="alert">{locale === 'ru' ? 'Конец периода должен быть после начала.' : 'The end date must follow the start date.'}</span>}
    </div>}
    {error && <FeedbackBanner tone="error" action={<Button variant="secondary" size="sm" onClick={onRetry}>{t('common.tryAgain')}</Button>}>{error}</FeedbackBanner>}
    {hasMore && <p className="muted">{locale === 'ru' ? 'Показана часть истории. Загрузите более ранние записи или уточните поиск. Поиск и период охватывают всю историю; остальные фильтры — загруженные записи.' : 'More history is available. Load earlier entries or refine the search. Search and date range cover all history; other filters apply to loaded entries.'}</p>}
    {(loading || hasMore) && <Button type="button" variant="secondary" disabled={loading} onClick={onLoadMore}>{loading ? t('common.loading') : locale === 'ru' ? 'Загрузить ещё' : 'Load more'}</Button>}
  </div>
}
