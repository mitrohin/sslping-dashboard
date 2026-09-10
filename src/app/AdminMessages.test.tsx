import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminMessages } from './AdminMessages'
import { I18nProvider, LanguageSelect, useI18n } from './I18nProvider'
import * as localeMessages from './localeMessages'

vi.mock('./AuthProvider', () => ({ useAuth: () => ({ authenticated: false, user: null, updateLocale: vi.fn() }) }))

function AdminForm() {
  const [draft, setDraft] = useState('')
  const { t } = useI18n()
  return <><h1>{t('admin.heading')}</h1><input aria-label="Admin announcement draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></>
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('admin language loading', () => {
  it.each(['loaded', 'failed'] as const)('preserves an unsaved admin form while the next language is %s', async (outcome) => {
    let finish: ((messages: Record<string, string>) => void) | undefined
    let fail: ((error: Error) => void) | undefined
    const load = vi.spyOn(localeMessages, 'loadMessages').mockImplementation((locale, admin) => {
      if (locale === 'ru') return new Promise((resolve, reject) => { finish = resolve; fail = reject })
      return Promise.resolve({ 'language.label': 'Language', 'common.loading': 'Loading', ...(admin ? { 'admin.heading': 'Administration' } : {}) })
    })
    render(<I18nProvider><LanguageSelect /><AdminMessages><AdminForm /></AdminMessages></I18nProvider>)
    const input = await screen.findByRole('textbox', { name: 'Admin announcement draft' })
    fireEvent.change(input, { target: { value: 'Maintenance announcement draft' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } })
    await waitFor(() => expect(load).toHaveBeenCalledWith('ru', true))
    expect(screen.getByRole('textbox', { name: 'Admin announcement draft' })).toBe(input)
    expect(input).toHaveValue('Maintenance announcement draft')
    await act(async () => {
      if (outcome === 'loaded') finish?.({ 'language.label': 'Язык', 'admin.heading': 'Администрирование' })
      else fail?.(new TypeError('Failed to fetch dynamically imported module'))
    })
    if (outcome === 'loaded') expect(screen.getByRole('heading', { name: 'Администрирование' })).toBeInTheDocument()
    else expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить язык интерфейса')
    expect(screen.getByRole('textbox', { name: 'Admin announcement draft' })).toBe(input)
    expect(input).toHaveValue('Maintenance announcement draft')
  })
})
