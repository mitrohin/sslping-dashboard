import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider, LanguageSelect, useI18n } from './I18nProvider'

const updateLocale = vi.fn().mockResolvedValue(undefined)

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    authenticated: true,
    user: { locale: 'en' },
    updateLocale,
  }),
}))

function TranslationProbe() {
  const { t } = useI18n()
  return <strong>{t('billing.title')}</strong>
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  updateLocale.mockClear()
})

describe('dashboard localization', () => {
  it('offers all supported languages and persists a user override', async () => {
    render(<I18nProvider><LanguageSelect /><TranslationProbe /></I18nProvider>)

    const language = screen.getByRole('combobox', { name: 'Language' })
    expect(Array.from(language.querySelectorAll('option')).map((option) => option.value)).toEqual(['en', 'es', 'zh', 'ka', 'tr', 'ru'])

    fireEvent.change(language, { target: { value: 'ru' } })

    expect(await screen.findByText('Тарифы и оплата')).toBeInTheDocument()
    await waitFor(() => expect(updateLocale).toHaveBeenCalledWith('ru'))
    expect(localStorage.getItem('sslping.locale')).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
  })
})
