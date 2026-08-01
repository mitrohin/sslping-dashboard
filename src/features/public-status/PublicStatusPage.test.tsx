import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PublicStatusSnapshot } from '../../api'
import { PublicStatusPage, type PublicStatusApi } from './PublicStatusPage'

afterEach(() => {
  cleanup()
  localStorage.clear()
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
  vi.restoreAllMocks()
})

const snapshot: PublicStatusSnapshot = {
  page: {
    name: 'Example Cloud status',
    slug: 'example-cloud',
    homepage_url: 'https://example.com',
    language: 'en',
    robots: 'index,follow',
    settings: {
      show_bar_charts: true,
      show_response_time: true,
      show_uptime_percentage: true,
      show_overall_percentage: true,
      show_outage_details: true,
      enable_details_page: true,
      show_monitor_url: false,
      hide_paused_monitors: true,
      enable_subscribe: true,
      show_latest_downtime: true,
      small_cookie_dialog: false,
      share_analytics: true,
    },
  },
  password_protected: false,
  overall_status: 'up',
  components: [
		{ id: 'component-api', name: 'Public API', status: 'up', uptime_24h: 100, last_checked_at: '2026-07-25T12:59:30.000Z', report_options: [{ key: 'not_working', label: 'Not working completely', standard: true }, { key: 'slow', label: 'Working, but slowly', standard: true }] },
		{ id: 'component-checkout', name: 'Checkout', status: 'up', uptime_24h: 99.998, last_checked_at: '2026-07-25T12:59:10.000Z' },
  ],
  announcements: [
    {
      id: 'announcement-1',
      title: 'API latency resolved',
      body: 'Response times have returned to normal.',
      status: 'resolved',
      published_at: '2026-07-24T10:00:00.000Z',
      resolved_at: '2026-07-24T10:22:00.000Z',
    },
  ],
  generated_at: '2026-07-25T13:00:00.000Z',
}

function renderRoute(api: PublicStatusApi, path = '/example-cloud') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/:slug" element={<PublicStatusPage api={api} />} /></Routes>
    </MemoryRouter>,
  )
}

function createApi(result: PublicStatusSnapshot = snapshot): PublicStatusApi {
  return {
    getPublicStatusPage: vi.fn().mockResolvedValue(result),
    accessPublicStatusPage: vi.fn().mockResolvedValue(result),
    subscribeStatusPage: vi.fn().mockResolvedValue({
      message: 'If the address can be subscribed, a confirmation email has been sent.',
    }),
		reportPublicStatusProblem: vi.fn().mockResolvedValue({ accepted: true }),
  }
}

describe('PublicStatusPage', () => {
  it('loads the slug and renders overall status, components, and announcements', async () => {
    const api = createApi()
    renderRoute(api)

    expect(screen.getByLabelText(/loading status page/i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'All systems operational' })).toBeInTheDocument()
    expect(screen.getByText('Public API')).toBeInTheDocument()
    expect(screen.getByText('API latency resolved')).toBeInTheDocument()
    expect(api.getPublicStatusPage).toHaveBeenCalledWith('example-cloud')
  })

  it('renders public interface text and metadata in the page language', async () => {
    const api = createApi({ ...snapshot, page: { ...snapshot.page, language: 'ru' } })
    renderRoute(api)

    expect(await screen.findByRole('heading', { name: 'Все системы работают' })).toBeInTheDocument()
    expect(screen.getByText('Текущий статус')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подписаться на обновления' })).toBeInTheDocument()
    expect(screen.getAllByText('Работает').length).toBeGreaterThan(0)
    expect(document.documentElement.lang).toBe('ru')
    expect(document.title).toContain('Текущий статус')
  })

  it('unlocks password-protected pages without storing the password', async () => {
    const locked: PublicStatusSnapshot = {
      ...snapshot,
      password_protected: true,
      components: null,
      announcements: null,
    }
    const getPublicStatusPage = vi.fn().mockResolvedValue(locked)
    const accessPublicStatusPage = vi.fn().mockImplementation((_slug: string, password: string) =>
      Promise.resolve(password === 'correct horse' ? { ...snapshot, password_protected: true } : locked),
    )
    const api: PublicStatusApi = {
      getPublicStatusPage,
      accessPublicStatusPage,
      subscribeStatusPage: vi.fn(),
    }
    renderRoute(api)

    const input = await screen.findByLabelText('Password')
    fireEvent.change(input, { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: /view status page/i }))

    expect(await screen.findByRole('heading', { name: 'All systems operational' })).toBeInTheDocument()
    expect(accessPublicStatusPage).toHaveBeenLastCalledWith('example-cloud', 'correct horse', undefined)
    expect(getPublicStatusPage).toHaveBeenCalledWith('example-cloud')
    expect(localStorage.getItem('correct horse')).toBeNull()
    expect(window.location.search).not.toContain('correct')
  })

  it('renders a dedicated not-found state for a 404 response', async () => {
    const notFound = Object.assign(new Error('missing'), { status: 404 })
    const api: PublicStatusApi = {
      getPublicStatusPage: vi.fn().mockRejectedValue(notFound),
      accessPublicStatusPage: vi.fn(),
      subscribeStatusPage: vi.fn(),
    }
    renderRoute(api)

    expect(await screen.findByText(/404 · status page not found/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /status page is unavailable/i })).toBeInTheDocument()
  })

  it('submits an email only after explicit subscription consent', async () => {
    const api = createApi()
    renderRoute(api)
    await screen.findByRole('heading', { name: 'All systems operational' })

    fireEvent.click(screen.getByRole('button', { name: /subscribe to updates/i }))
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'USER@EXAMPLE.COM' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /send confirmation email/i }))

    await waitFor(() => expect(api.subscribeStatusPage).toHaveBeenCalledWith('example-cloud', 'user@example.com'))
    expect(await screen.findByRole('heading', { name: /check your inbox/i })).toBeInTheDocument()
  })

  it('persists only the selected cookie-consent level', async () => {
    const api = createApi()
    renderRoute(api)
    await screen.findByRole('heading', { name: 'All systems operational' })

    fireEvent.click(screen.getByRole('button', { name: /accept optional/i }))
    expect(localStorage.getItem('sslping.public-status.cookie-consent.v1')).toBe('all')
    expect(screen.queryByLabelText(/cookie consent/i)).not.toBeInTheDocument()
  })

	it('locks a monitor report panel immediately and keeps a 24-hour receipt in a cookie', async () => {
		let resolveReport: ((value: { accepted: boolean }) => void) | undefined
		const api = createApi()
		api.reportPublicStatusProblem = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveReport = resolve }))
		const view = renderRoute(api)
		await screen.findByRole('heading', { name: 'All systems operational' })
		const componentRow = screen.getByText('Public API').closest('article')
		expect(componentRow).not.toBeNull()
		const component = within(componentRow as HTMLElement)

		fireEvent.click(component.getByRole('button', { name: 'Not working completely' }))

		expect(component.getByText('We are processing your report…')).toBeInTheDocument()
		expect(component.queryByRole('button', { name: 'Not working completely' })).not.toBeInTheDocument()
		expect(component.queryByRole('button', { name: 'Working, but slowly' })).not.toBeInTheDocument()
		await waitFor(() => expect(api.reportPublicStatusProblem).toHaveBeenCalledWith('example-cloud', 'component-api', 'not_working', undefined))
		await act(async () => { resolveReport?.({ accepted: true }) })

		expect(await component.findByText('Thank you — we received your signal')).toBeInTheDocument()
		expect(component.getByText('Signal: Not working completely')).toBeInTheDocument()
		expect(document.cookie).toContain('sslping_problem_report_v1_example-cloud_component-api=')

		view.unmount()
		renderRoute(api)
		await screen.findByRole('heading', { name: 'All systems operational' })
		const restoredRow = screen.getByText('Public API').closest('article')
		expect(within(restoredRow as HTMLElement).getByText('Thank you — we received your signal')).toBeInTheDocument()
		expect(api.reportPublicStatusProblem).toHaveBeenCalledTimes(1)
	})

	it('shows the same thank-you receipt when anti-abuse rejects a report', async () => {
		const api = createApi({ ...snapshot, page: { ...snapshot.page, language: 'ru' } })
		api.reportPublicStatusProblem = vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }))
		renderRoute(api)
		await screen.findByRole('heading', { name: 'Все системы работают' })
		const componentRow = screen.getByText('Public API').closest('article')
		const component = within(componentRow as HTMLElement)

		fireEvent.click(component.getByRole('button', { name: 'Работает, но медленно' }))

		expect(await component.findByText('Спасибо — мы получили ваш сигнал')).toBeInTheDocument()
		expect(component.getByText('Сигнал: Работает, но медленно')).toBeInTheDocument()
		expect(component.queryByText(/уже недавно получили/i)).not.toBeInTheDocument()
	})
})
