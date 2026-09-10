import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../app/I18nProvider'
import { demoMonitors } from '../../data'
import { formatDate } from '../../lib/format'
import { MonitorDetailPage } from './MonitorDetailPage'

vi.mock('../../app/AuthProvider', () => ({ useAuth: () => ({ authenticated: false, user: null, updateLocale: vi.fn() }) }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.lang = 'en'
})

it('shows localized periods and an absolute status start with the selected demo monitor history', async () => {
  localStorage.setItem('sslping.locale', 'ru')
  const checkout = demoMonitors.find((monitor) => monitor.name === 'Checkout API')!
  render(<I18nProvider><MemoryRouter initialEntries={[`/monitors/${checkout.id}`]}><Routes>
    <Route path="/monitors/:monitorId" element={<MonitorDetailPage responseTime={[]} />} />
  </Routes></MemoryRouter></I18nProvider>)
  const week = (await screen.findByText('Последние 7 дней', { selector: 'span' })).parentElement!
  expect(week).toHaveTextContent('99,948%')
  expect(week).toHaveTextContent('Инцидентов: 1, недоступен 5 мин 12 с')
  const month = screen.getByText('Последние 30 дней').parentElement!
  expect(month).toHaveTextContent('99,965%')
  expect(month).toHaveTextContent('Инцидентов: 2, недоступен 15 мин 18 с')
  expect(screen.getByText('Последние 365 дней')).toBeInTheDocument()
  expect(screen.getByText(`С ${formatDate(checkout.statusChangedAt!, { locale: 'ru' })}`)).toBeInTheDocument()
  expect(screen.queryByText(/С .*назад/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Последние (7d|30d|365d)/)).not.toBeInTheDocument()
})
