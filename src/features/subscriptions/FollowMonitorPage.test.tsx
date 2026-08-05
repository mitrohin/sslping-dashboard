import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Workspace } from '../../api/types'
import { FollowMonitorPage, type FollowMonitorApi } from './FollowMonitorPage'

const authHarness = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => authHarness.current,
}))

const workspace = {
  id: 'workspace-1',
  name: 'Acme Operations',
  slug: 'acme',
  plan: 'business',
  timezone: 'Europe/Moscow',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
} satisfies Workspace

function createApi(preview: Awaited<ReturnType<FollowMonitorApi['previewMonitorSubscription']>>): FollowMonitorApi {
  return {
    previewMonitorSubscription: vi.fn().mockResolvedValue(preview),
    requestMonitorSubscription: vi.fn().mockResolvedValue({ message: 'accepted' }),
    acceptMonitorSubscription: vi.fn().mockResolvedValue(undefined),
    registerMonitorSubscriber: vi.fn().mockResolvedValue({
      user: {},
      tenant: workspace,
      tokens: {},
      subscription: { subscription_id: 'subscription-1', read_only: true },
    }),
  } as unknown as FollowMonitorApi
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, hash: location.hash, state: location.state })}</output>
}

function renderPage(api: FollowMonitorApi, onComplete = vi.fn()) {
  const result = render(
    <MemoryRouter initialEntries={['/follow-monitor#token=secret-capability']}>
      <LocationProbe />
      <Routes>
        <Route path="/follow-monitor" element={<FollowMonitorPage api={api} onComplete={onComplete} />} />
        <Route path="/login" element={<div>Ordinary login</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return { ...result, onComplete }
}

beforeEach(() => {
  authHarness.current = {
    api: {},
    authenticated: false,
    loading: false,
    workspace: null,
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FollowMonitorPage', () => {
  it('consumes the fragment token and sends a generic email onboarding request', async () => {
    const api = createApi({ kind: 'capability', page_name: 'Example status', monitor_name: 'Public API', monitor_status: 'up' })
    renderPage(api)

    expect(await screen.findByRole('heading', { name: /^Follow Public API/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('"hash":""'))
    expect(api.previewMonitorSubscription).toHaveBeenCalledWith('secret-capability')

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'USER@EXAMPLE.COM' } })
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }))

    await waitFor(() => expect(api.requestMonitorSubscription).toHaveBeenCalledWith('secret-capability', 'user@example.com', undefined))
    expect(await screen.findByRole('heading', { name: /^Check your inbox/ })).toBeInTheDocument()
    expect(screen.getByText(/If this address can be used/i)).toBeInTheDocument()
  })

  it('continues directly with a raw activation token when email delivery is disabled', async () => {
    const api = createApi({ kind: 'capability', page_name: 'Example status', monitor_name: 'Public API', monitor_status: 'up' })
    vi.mocked(api.previewMonitorSubscription)
      .mockResolvedValueOnce({ kind: 'capability', page_name: 'Example status', monitor_name: 'Public API', monitor_status: 'up' })
      .mockResolvedValueOnce({
        kind: 'email',
        page_name: 'Example status',
        monitor_name: 'Public API',
        monitor_status: 'up',
        email: 'new@example.com',
        account_exists: false,
      })
    vi.mocked(api.requestMonitorSubscription).mockResolvedValue({ message: 'accepted', activation_token: 'raw-activation-token' })
    renderPage(api)

    await screen.findByRole('heading', { name: /^Follow Public API/ })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }))

    expect(await screen.findByRole('heading', { name: /finish creating your account/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('new@example.com')).toHaveAttribute('readonly')
    expect(api.previewMonitorSubscription).toHaveBeenNthCalledWith(2, 'raw-activation-token')
    expect(screen.queryByRole('heading', { name: /check your inbox/i })).not.toBeInTheDocument()
  })

  it('requires an authenticated user to confirm before adding to the current workspace', async () => {
    authHarness.current = { api: {}, authenticated: true, loading: false, workspace }
    const api = createApi({ kind: 'capability', page_name: 'Example status', monitor_name: 'Checkout', monitor_status: 'up' })
    const { onComplete } = renderPage(api)

    expect(await screen.findByText('The monitor will be added to Acme Operations.')).toBeInTheDocument()
    expect(api.acceptMonitorSubscription).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /follow this monitor/i }))

    await waitFor(() => expect(api.acceptMonitorSubscription).toHaveBeenCalledWith('workspace-1', 'secret-capability'))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('routes an existing account through ordinary login while preserving the token in route state', async () => {
    const api = createApi({
      kind: 'email',
      page_name: 'Example status',
      monitor_name: 'Checkout',
      monitor_status: 'up',
      email: 'owner@example.com',
      account_exists: true,
    })
    renderPage(api)

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Ordinary login')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('"pathname":"/login"')
    expect(screen.getByTestId('location')).toHaveTextContent('"monitorSubscriptionToken":"secret-capability"')
    expect(screen.getByTestId('location')).not.toHaveTextContent('#token=')
  })

  it('creates a new account from an email activation token and completes the flow', async () => {
    const api = createApi({
      kind: 'email',
      page_name: 'Example status',
      monitor_name: 'Checkout',
      monitor_status: 'up',
      email: 'new@example.com',
      account_exists: false,
    })
    const { onComplete } = renderPage(api)

    expect(await screen.findByDisplayValue('new@example.com')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'SecurePassword1' } })
    fireEvent.click(screen.getByRole('button', { name: /create account and follow/i }))

    await waitFor(() => expect(api.registerMonitorSubscriber).toHaveBeenCalledWith(expect.objectContaining({
      token: 'secret-capability',
      name: 'Alex',
      password: 'SecurePassword1',
      locale: 'en',
      timezone: expect.any(String),
    })))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('retries subscription activation without registering the account twice after partial success', async () => {
    const api = createApi({
      kind: 'email',
      page_name: 'Example status',
      monitor_name: 'Checkout',
      monitor_status: 'up',
      email: 'new@example.com',
      account_exists: false,
    })
    vi.mocked(api.registerMonitorSubscriber).mockResolvedValue({
      user: {} as never,
      tenant: workspace,
      tokens: {} as never,
      subscription_pending: true,
    })
    vi.mocked(api.acceptMonitorSubscription)
      .mockRejectedValueOnce(new Error('Temporary activation failure'))
      .mockResolvedValueOnce(undefined)
    const { onComplete } = renderPage(api)

    await screen.findByDisplayValue('new@example.com')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'SecurePassword1' } })
    fireEvent.click(screen.getByRole('button', { name: /create account and follow/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary activation failure')
    expect(api.acceptMonitorSubscription).toHaveBeenCalledWith(workspace.id, 'secret-capability')
    expect(api.registerMonitorSubscriber).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.acceptMonitorSubscription).toHaveBeenCalledTimes(2))
    expect(api.registerMonitorSubscriber).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
