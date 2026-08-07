import { describe, expect, it } from 'vitest'
import { publicStatusCopy, statusPageLocale, type PublicStatusCopy } from './i18n'
import type { ExtendedStatusPageLanguage } from './extended-i18n'

const extendedLanguages: ExtendedStatusPageLanguage[] = [
  'de', 'nl', 'cs', 'da', 'fi', 'el', 'hr', 'hu', 'he', 'it', 'ja', 'ms',
  'no', 'fil', 'ur', 'pl', 'ro', 'sr', 'sv', 'sl', 'sk', 'tr', 'uk',
]

const fallbackSensitiveKeys = [
  'statusPageNotFound',
  'monitoringUnavailable',
  'reportProcessingBody',
  'privacyBody',
  'cookiesBody',
  'passwordPrompt',
  'passwordSecurity',
  'subscriptionIntro',
  'subscriptionConsent',
  'cookieConsent',
  'necessaryOnly',
  'acceptOptional',
  'sendConfirmation',
  'checkInbox',
] as const satisfies ReadonlyArray<keyof PublicStatusCopy>

describe('extended public status translations', () => {
  const english = publicStatusCopy('en')
  const englishKeys = Object.keys(english).sort()
  const englishOverallKeys = Object.keys(english.overall).sort()

  it.each(extendedLanguages)('%s contains the complete public status copy', (language) => {
    const copy = publicStatusCopy(language)

    expect(Object.keys(copy).sort()).toEqual(englishKeys)
    expect(Object.keys(copy.overall).sort()).toEqual(englishOverallKeys)

    for (const [key, value] of Object.entries(copy)) {
      if (key === 'overall') continue
      expect(value, `${language}.${key}`).toEqual(expect.any(String))
      expect((value as string).trim(), `${language}.${key}`).not.toBe('')
    }

    for (const [status, summary] of Object.entries(copy.overall)) {
      expect(summary.title.trim(), `${language}.overall.${status}.title`).not.toBe('')
      expect(summary.description.trim(), `${language}.overall.${status}.description`).not.toBe('')
    }
  })

  it.each(extendedLanguages)('%s does not fall back to English for dialog and error copy', (language) => {
    const copy = publicStatusCopy(language)

    for (const key of fallbackSensitiveKeys) {
      expect(copy[key], `${language}.${key}`).not.toBe(english[key])
    }

    expect(copy.necessaryOnly, `${language}.necessaryOnly`).not.toBe(copy.acceptOptional)
  })

  it('uses Traditional Chinese copy and canonical locale tags for Hong Kong and Taiwan', () => {
    const copy = publicStatusCopy('zh-Hant')

    expect(Object.keys(copy).sort()).toEqual(englishKeys)
    expect(copy.currentStatus).toBe('目前狀態')
    expect(copy.monitoringUnavailable).toContain('監控服務')
    expect(copy.passwordSecurity).toContain('瀏覽器')
    expect(copy.overall.degraded.title).toContain('效能下降')
    expect(statusPageLocale('zh-Hant', 'HK')).toBe('zh-Hant-HK')
    expect(statusPageLocale('zh-Hant', 'TW')).toBe('zh-Hant-TW')
    expect(statusPageLocale('zh')).toBe('zh-CN')
  })
})
