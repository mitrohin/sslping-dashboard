import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PublicStatusSnapshot } from '../../api'
import { PublicStatusPage, type PublicStatusApi } from './PublicStatusPage'

afterEach(() => {
  cleanup()
  localStorage.clear()
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
    { name: 'Public API', status: 'up', uptime_24h: 100, last_checked_at: '2026-07-25T12:59:30.000Z' },
    { name: 'Checkout', status: 'up', uptime_24h: 99.998, last_checked_at: '2026-07-25T12:59:10.000Z' },
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
})
