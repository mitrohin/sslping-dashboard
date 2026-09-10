import type { Locale } from '../api/types'
import englishMessages from 'virtual:sslping-fallback'

const loaders = {
  en: async () => ({ default: englishMessages }),
  es: () => import('virtual:sslping-locale/es'),
  zh: () => import('virtual:sslping-locale/zh'),
  ka: () => import('virtual:sslping-locale/ka'),
  tr: () => import('virtual:sslping-locale/tr'),
  ru: () => import('virtual:sslping-locale/ru'),
}
const adminLoaders = {
  en: () => import('virtual:sslping-admin-locale/en'),
  es: () => import('virtual:sslping-admin-locale/es'),
  zh: () => import('virtual:sslping-admin-locale/zh'),
  ka: () => import('virtual:sslping-admin-locale/ka'),
  tr: () => import('virtual:sslping-admin-locale/tr'),
  ru: () => import('virtual:sslping-admin-locale/ru'),
}

export async function loadMessages(locale: Locale, admin = false): Promise<Record<string, string>> {
  const primary = await loaders[locale]()
  const extra = admin ? await adminLoaders[locale]() : undefined
  return { ...primary.default, ...extra?.default }
}
