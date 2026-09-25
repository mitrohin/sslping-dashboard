import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../app/I18nProvider'
import { coreTranslations } from '../../app/coreTranslations'
import { AuthPage, type AuthPageProps } from './AuthPage'

vi.mock('../../app/AuthProvider', () => ({ useAuth: () => ({ authenticated: false, user: null, updateLocale: vi.fn() }) }))
afterEach(() => { cleanup(); localStorage.clear() })
const page = (props: AuthPageProps) => <MemoryRouter><I18nProvider><AuthPage {...props} /></I18nProvider></MemoryRouter>

describe('authentication feedback and context', () => {
  it('announces a late error and successful recovery without replacing entered data', () => {
    const onSubmit = vi.fn()
    const view = render(page({ mode: 'forgot', onSubmit }))
    const alert = screen.getByRole('alert')
    const status = screen.getByRole('status')
    const email = screen.getByRole('textbox', { name: 'E-mail' })
    fireEvent.change(email, { target: { value: 'draft@example.com' } })
    view.rerender(page({ mode: 'forgot', onSubmit, error: 'Try again later.' }))
    expect(screen.getByRole('alert')).toBe(alert)
    expect(alert).toHaveTextContent('Try again later.')
    expect(email).toHaveValue('draft@example.com')
    view.rerender(page({ mode: 'forgot', onSubmit, success: 'Check your inbox.' }))
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('Check your inbox.')
    expect(email).toHaveValue('draft@example.com')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('labels fixed numbers as examples and links to actual localized documents', async () => {
    render(page({ mode: 'login', onSubmit: vi.fn() }))
    expect(screen.getByText('Illustrative example · sample data')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Privacy information' })).toHaveAttribute('href', 'https://sslping.io/privacy')
    const input = screen.getByRole('textbox', { name: 'E-mail' })
    fireEvent.change(input, { target: { value: 'draft@example.com' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } })
    expect(await screen.findByText('Пример интерфейса · демонстрационные данные')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Условия использования' })).toHaveAttribute('href', 'https://sslping.io/ru/terms')
    expect(screen.getByRole('link', { name: 'Информация о приватности' })).toHaveAttribute('href', 'https://sslping.io/ru/privacy')
    expect(input).toHaveValue('draft@example.com')
  })

  it('provides explicit example and document labels for every dashboard language', () => {
    for (const copy of Object.values(coreTranslations)) {
      for (const key of ['auth.demoExample', 'auth.terms', 'auth.privacy', 'auth.legalLinks']) expect(copy[key]).toBeTruthy()
      expect(copy['auth.gdpr']).not.toMatch(/GDPR|RGPD/)
    }
  })
})
