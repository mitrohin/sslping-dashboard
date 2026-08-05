import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from '../../api/client'
import { SessionStore } from '../../api/session'
import type { MeResponse, Problem, Tokens, User, Workspace } from '../../api/types'
import { AuthProvider } from '../../app/AuthProvider'
import {
  AcceptInvitationController,
  EmailVerificationController,
  ForgotPasswordController,
  LoginController,
  RegisterController,
  ResetPasswordController,
  TwoFactorController,
  authErrorMessage,
  authReturnDestination,
  authReturnPath,
  sensitiveTokenFromLocation,
} from './AuthFlows'

const user: User = {
  id: 'user-1',
  email: 'alex@example.test',
  name: 'Alex',
  locale: 'en',
  timezone: 'UTC',
  email_verified_at: '2026-01-01T00:00:00Z',
  two_factor_enabled: false,
  system_role: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const workspace: Workspace = {
  id: 'tenant-1',
  name: 'Operations',
  slug: 'operations',
  plan: 'free',
  timezone: 'UTC',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const tokens: Tokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'Bearer',
  expires_at: '2030-01-01T00:00:00Z',
}

const me: MeResponse = { user, tenants: [workspace], active_tenant_id: workspace.id, workspace_role: 'owner' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

function CurrentLocation() {
  const location = useLocation()
  return <div>{`${location.pathname}${location.search}${location.hash}`}</div>
}

function CurrentLocationState() {
  const location = useLocation()
  return <div data-testid="location-state">{JSON.stringify(location.state)}</div>
}

function renderWithAuth(
  api: ApiClient,
  initialEntry: string | { pathname: string; search?: string; state?: unknown },
  routes: React.ReactNode,
  strict = false,
) {
  const tree = (
    <AuthProvider api={api}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </AuthProvider>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('auth UI controllers', () => {
  it('logs in and returns to the saved local location', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === '/v1/auth/login') return json({ user, tokens, two_factor_required: false })
      if (String(input) === '/v1/me') return json(me)
      throw new Error(`Unexpected URL ${String(input)}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      {
        pathname: '/login',
        state: { from: { pathname: '/incidents', search: '?status=open', hash: '#latest' } },
      },
      <>
        <Route path="/login" element={<LoginController />} />
        <Route path="/incidents" element={<CurrentLocation />} />
      </>,
    )

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('/incidents?status=open#latest')).toBeInTheDocument()
  })

  it('moves a pending login through the accessible 2FA challenge', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/v1/auth/login') {
        return json({
          user: { ...user, two_factor_enabled: true },
          two_factor_required: true,
          challenge_token: 'challenge-token',
          challenge_expires_at: '2035-01-01T00:00:00Z',
        })
      }
      if (url === '/v1/auth/login/2fa') {
        expect(JSON.parse(String(init?.body))).toEqual({ challenge_token: 'challenge-token', code: '123456' })
        return json({ user, tokens })
      }
      if (url === '/v1/me') return json(me)
      throw new Error(`Unexpected URL ${url}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      '/login',
      <>
        <Route path="/login" element={<LoginController />} />
        <Route path="/login/2fa" element={<TwoFactorController />} />
        <Route path="/monitors" element={<div>Monitor dashboard</div>} />
      </>,
    )

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Authentication code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }))

    expect(await screen.findByText('Monitor dashboard')).toBeInTheDocument()
  })

  it('keeps the monitor-follow return token when restarting sign-in from 2FA', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === '/v1/auth/login') {
        return json({
          user: { ...user, two_factor_enabled: true },
          two_factor_required: true,
          challenge_token: 'challenge-token',
          challenge_expires_at: '2035-01-01T00:00:00Z',
        })
      }
      throw new Error(`Unexpected URL ${String(input)}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      {
        pathname: '/login',
        state: {
          from: {
            pathname: '/follow-monitor',
            state: { monitorSubscriptionToken: 'follow-secret' },
          },
        },
      },
      <>
        <Route path="/login" element={<><LoginController /><CurrentLocationState /></>} />
        <Route path="/login/2fa" element={<TwoFactorController />} />
      </>,
    )

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /back to sign in/i }))

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.getByTestId('location-state')).toHaveTextContent('"monitorSubscriptionToken":"follow-secret"')
  })

  it('routes an unverified registration to an explicit email confirmation action', async () => {
    const unverifiedUser = { ...user, email_verified_at: undefined }
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/v1/customer-regions') {
        return json({ items: [{ id: 'region-global', code: 'global', name: 'Global', default_locale: 'en', currency: 'USD', payment_providers: ['manual'], default_plan_code: 'free', active: true, default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] })
      }
      if (url === '/v1/auth/register') {
        expect(JSON.parse(String(init?.body))).toMatchObject({ workspace_name: 'Acme Operations' })
        return json({ user: unverifiedUser, tenant: workspace, verification_token: 'verification-token' }, 201)
      }
      if (url === '/v1/auth/email-verification/confirm') {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'verification-token' })
        return json({ status: 'verified', user })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      '/register',
      <>
        <Route path="/register" element={<RegisterController />} />
        <Route path="/verify-email" element={<EmailVerificationController />} />
        <Route path="/login" element={<LoginController />} />
      </>,
    )

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'Acme Operations' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } })
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), { target: { value: 'Password1234' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.getByText('Your email address has been verified. You can now sign in.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps the registered address fixed while waiting for email verification', () => {
    const fetchMock = vi.fn<typeof fetch>()
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      { pathname: '/verify-email', state: { email: user.email } },
      <Route path="/verify-email" element={<EmailVerificationController />} />,
    )

    expect(screen.getByText(user.email)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend verification email/i })).toBeEnabled()
  })

  it('submits the anti-enumeration forgot-password flow', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({ message: 'If the account exists, a password reset email has been sent.' }, 202),
    )
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(api, '/forgot-password', <Route path="/forgot-password" element={<ForgotPasswordController />} />)

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => expect(screen.getByText(/if an account exists/i)).toBeInTheDocument())
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/password/forgot')
  })

  it('consumes a reset token from the URL and changes the password through the public endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('/v1/auth/password/reset')
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'reset-secret', new_password: 'NewPassword1234' })
      return new Response(null, { status: 204 })
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      '/reset-password?token=reset-secret&lang=en',
      <Route path="/reset-password" element={<><ResetPasswordController /><CurrentLocation /></>} />,
    )

    expect(await screen.findByText('/reset-password?lang=en')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'NewPassword1234' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPassword1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^reset password/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/changed securely/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns an unauthenticated invitee through login and accepts the invitation from cleaned history state', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/v1/auth/login') return json({ user, tokens, two_factor_required: false })
      if (url === '/v1/me') return json(me)
      if (url === '/v1/invitations/accept') {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'invite-secret' })
        return json({
          workspace_id: workspace.id,
          user_id: user.id,
          role: 'viewer',
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      '/accept-invite#token=invite-secret',
      <>
        <Route path="/accept-invite" element={<><AcceptInvitationController /><CurrentLocation /></>} />
        <Route path="/login" element={<LoginController />} />
        <Route path="/monitors" element={<div>Monitor dashboard</div>} />
      </>,
      true,
    )

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1234' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/workspace has been added/i)
    expect(screen.getByText('/accept-invite')).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/v1/auth/login',
      '/v1/me',
      '/v1/invitations/accept',
    ])
  })

  it('preserves an invitation while a new invitee moves from login to registration', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === '/v1/customer-regions') {
        return json({ items: [{ id: 'region-global', code: 'global', name: 'Global', default_locale: 'en', currency: 'USD', payment_providers: ['manual'], default_plan_code: 'free', active: true, default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] })
      }
      throw new Error(`Unexpected URL ${String(input)}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
    renderWithAuth(
      api,
      '/accept-invite#token=new-invitee-secret',
      <>
        <Route path="/accept-invite" element={<AcceptInvitationController />} />
        <Route path="/login" element={<LoginController />} />
        <Route path="/register" element={<><RegisterController /><CurrentLocationState /></>} />
      </>,
    )

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /create an account/i }))

    expect(await screen.findByRole('heading', { name: /create your workspace/i })).toBeInTheDocument()
    expect(screen.getByTestId('location-state')).toHaveTextContent('new-invitee-secret')
  })

  it('retains a consumed invitation token in memory for a safe retry', async () => {
    let invitationAttempts = 0
    const store = new SessionStore(localStorage)
    store.setTokens(tokens)
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === '/v1/me') return json(me)
      if (url === '/v1/invitations/accept') {
        invitationAttempts += 1
        if (invitationAttempts === 1) throw new TypeError('temporary network failure')
        return json({
          workspace_id: workspace.id,
          user_id: user.id,
          role: 'viewer',
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const api = new ApiClient({ fetch: fetchMock, sessionStore: store })
    renderWithAuth(
      api,
      '/accept-invite?token=retry-secret',
      <Route path="/accept-invite" element={<><AcceptInvitationController /><CurrentLocation /></>} />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to reach sslping/i)
    expect(screen.getByText('/accept-invite')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try accepting again/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/workspace has been added/i)
    expect(invitationAttempts).toBe(2)
  })
})

describe('auth flow safety helpers', () => {
  it('rejects external return destinations and maps backend problems', () => {
    expect(authReturnPath({ from: '//evil.example/path' })).toBe('/monitors')
    expect(authReturnPath({ from: 'https://evil.example/path' })).toBe('/monitors')
    expect(authReturnPath({ from: '/\\evil.example/path' })).toBe('/monitors')
    expect(authReturnPath({ from: '/safe\nredirect' })).toBe('/monitors')
    expect(authReturnDestination({ from: { pathname: '/accept-invite', state: { inviteToken: 'secret' } } })).toEqual({
      to: '/accept-invite',
      state: { inviteToken: 'secret' },
    })
    expect(sensitiveTokenFromLocation('', '#token=fragment-secret')).toBe('fragment-secret')
    expect(sensitiveTokenFromLocation('?token=query-secret', '#token=fragment-secret')).toBe('query-secret')

    const error = new ApiError({
      type: 'about:blank',
      title: 'Rate limited',
      status: 429,
      detail: 'raw backend detail',
      instance: '/v1/auth/login',
      code: 'rate_limited',
    } satisfies Problem)
    expect(authErrorMessage(error)).toMatch(/too many attempts/i)
  })
})
