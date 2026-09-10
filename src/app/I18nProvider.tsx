import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from '../api/types'
import { useAuth } from './AuthProvider'
import { Select } from '../components/ui'
import { Languages } from 'lucide-react'

export const localeOptions: Array<{ code: Locale; label: string; native: string }> = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'ka', label: 'Georgian', native: 'ქართული' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
]

import en from 'virtual:sslping-fallback'
import { loadMessages } from './localeMessages'

function storedLocale(): Locale {
  try {
    const stored = window.localStorage.getItem('sslping.locale') as Locale | null
    return localeOptions.some((item) => item.code === stored) ? stored! : 'en'
  } catch { return 'en' }
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale, persist?: boolean) => Promise<void>
  requestAdminMessages: () => void
  adminReady: boolean
  t: (key: string, variables?: Record<string, string | number>) => string
}

const fallbackI18n: I18nContextValue = {
  locale: 'en',
  setLocale: async () => undefined,
  requestAdminMessages: () => undefined,
  adminReady: true,
  t: (key, variables) => {
    let value = en[key] ?? key
    for (const [name, replacement] of Object.entries(variables ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  },
}

// A real provider wraps the application. The English fallback keeps isolated
// components, Storybook-style renders and unit tests usable without duplicating
// provider setup in every harness.
const I18nContext = createContext<I18nContextValue>(fallbackI18n)

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, authenticated, updateLocale } = useAuth()
  const [locale, setLocaleState] = useState<Locale>(() => user?.locale ?? storedLocale())
  const [loaded, setLoaded] = useState<{ locale: Locale; messages: Record<string, string>; admin?: boolean }>(() => ({ locale: 'en', messages: en }))
  const [adminRequested, setAdminRequested] = useState(false)
  const requestAdminMessages = useCallback(() => setAdminRequested(true), [])
  const [localeError, setLocaleError] = useState(false)
  const [localeAttempt, setLocaleAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setLocaleError(false)
    void loadMessages(locale, adminRequested).then((messages) => {
      if (current) setLoaded({ locale, messages, admin: adminRequested })
    }).catch(() => { if (current) setLocaleError(true) })
    return () => { current = false }
  }, [locale, localeAttempt, adminRequested])

  useEffect(() => {
    if (user?.locale && user.locale !== locale) setLocaleState(user.locale)
  }, [user?.locale])

  useEffect(() => {
    document.documentElement.lang = loaded.locale
    try { window.localStorage.setItem('sslping.locale', locale) } catch { /* Locale still works for this tab when storage is unavailable. */ }
  }, [locale, loaded.locale])

  const setLocale = useCallback(async (next: Locale, persist = true) => {
    setLocaleState(next)
    if (persist && authenticated && user?.locale !== next) await updateLocale(next)
  }, [authenticated, updateLocale, user?.locale])

  const t = useCallback((key: string, variables?: Record<string, string | number>) => {
    let value = loaded.messages[key] ?? en[key] ?? key
    for (const [name, replacement] of Object.entries(variables ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }, [locale, loaded])

  const adminReady = Boolean(loaded.admin && loaded.locale === locale)
  const value = useMemo(() => ({ locale, setLocale, t, requestAdminMessages, adminReady }), [locale, setLocale, t, requestAdminMessages, adminReady])
  return <I18nContext.Provider value={value}>
    {localeError && <div className="locale-loading" role="alert">
      <p>{locale === 'ru' ? 'Не удалось загрузить язык интерфейса.' : 'Unable to load the interface language.'}</p>
      <button type="button" onClick={() => setLocaleAttempt((attempt) => attempt + 1)}>{locale === 'ru' ? 'Повторить' : 'Try again'}</button>
    </div>}
    {children}
  </I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export function LanguageSelect({ className = '', compact = false, showIcon = false }: { className?: string; compact?: boolean; showIcon?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  return <label
    className={`language-select ${compact ? 'language-select--compact' : ''} ${className}`.trim()}
    title={compact ? `${t('language.label')}: ${localeOptions.find((item) => item.code === locale)?.native ?? locale}` : undefined}
  >
    {(compact || showIcon) && <Languages size={21} aria-hidden="true" />}
    {!compact && <span>{t('language.label')}</span>}
    <Select aria-label={t('language.label')} value={locale} onChange={(event) => void setLocale(event.target.value as Locale)}>
      {localeOptions.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}
    </Select>
  </label>
}
