import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as localeMessages from './localeMessages'
import { I18nProvider, LanguageSelect, useI18n } from './I18nProvider'

const updateLocale = vi.fn().mockResolvedValue(undefined)
const authState = vi.hoisted(() => ({ authenticated: true, user: { locale: 'en' } as { locale: string } | null }))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    ...authState,
    updateLocale,
  }),
}))

function TranslationProbe() {
  const { t } = useI18n()
  return <><strong>{t('billing.title')}</strong><span>{t('monitorDetail.domainUnpublished')}</span></>
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  updateLocale.mockClear()
  authState.authenticated = true
  authState.user = { locale: 'en' }
  vi.restoreAllMocks()
})

describe('dashboard localization', () => {
  it('keeps the same input and unsaved value while a language chunk is loading', async () => {
    const realLoad = localeMessages.loadMessages
    let finish: ((messages: Record<string, string>) => void) | undefined
    vi.spyOn(localeMessages, 'loadMessages').mockImplementation((locale, admin) => locale === 'ru'
      ? new Promise((resolve) => { finish = resolve })
      : realLoad(locale, admin))
    render(<I18nProvider><LanguageSelect /><TranslationProbe /><input aria-label="Unsaved monitor" /></I18nProvider>)
    const input = screen.getByRole('textbox', { name: 'Unsaved monitor' })
    fireEvent.change(input, { target: { value: 'Customer portal draft' } })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } })
    expect(screen.getByRole('textbox', { name: 'Unsaved monitor' })).toBe(input)
    expect(input).toHaveValue('Customer portal draft')
    finish?.(await realLoad('ru'))
    expect(await screen.findByText('Тарифы и оплата')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Unsaved monitor' })).toBe(input)
    expect(input).toHaveValue('Customer portal draft')
  })

  it('offers all supported languages and persists a user override', async () => {
    render(<I18nProvider><LanguageSelect /><TranslationProbe /></I18nProvider>)

    const language = await screen.findByRole('combobox', { name: 'Language' })
    expect(Array.from(language.querySelectorAll('option')).map((option) => option.value)).toEqual(['en', 'es', 'zh', 'ka', 'tr', 'ru'])

    fireEvent.change(language, { target: { value: 'ru' } })

    expect(await screen.findByText('Тарифы и оплата')).toBeInTheDocument()
    expect(screen.getByText('Реестр не публикует дату')).toBeInTheDocument()
    await waitFor(() => expect(updateLocale).toHaveBeenCalledWith('ru'))
    expect(localStorage.getItem('sslping.locale')).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
  })
})


describe('locale storage restrictions', () => {
  it('renders the guest UI even when reading and writing site storage is denied', async () => {
    authState.authenticated = false
    authState.user = null
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError') })
    render(<I18nProvider><LanguageSelect /><TranslationProbe /></I18nProvider>)
    expect(await screen.findByRole('combobox', { name: 'Language' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('continues changing locale in memory when persistence fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError') })
    render(<I18nProvider><LanguageSelect /><TranslationProbe /></I18nProvider>)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } })
    expect(await screen.findByText('Тарифы и оплата')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
  })
})
