import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../api/client'
import { SessionStore } from '../api/session'
import type { MeResponse, Problem, Tokens, User, Workspace } from '../api/types'
import {
  AuthProvider,
  GuestOnly,
  RequireAuth,
  useAuth,
  type AuthContextValue,
  type LoginOutcome,
} from './AuthProvider'

const user: User = {
  id: 'user-1',
  email: 'alex@example.test',
  name: 'Alex',
  locale: 'en',
  timezone: 'UTC',
  email_verified_at: '2026-01-01T00:00:00Z',
  two_factor_enabled: true,
  system_role: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const firstWorkspace: Workspace = {
  id: 'tenant-1',
  name: 'First workspace',
  slug: 'first-workspace',
  plan: 'free',
  timezone: 'UTC',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const secondWorkspace: Workspace = {
  ...firstWorkspace,
  id: 'tenant-2',
  name: 'Second workspace',
  slug: 'second-workspace',
}

const oldTokens: Tokens = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  token_type: 'Bearer',
  expires_at: '2030-01-01T00:00:00Z',
}

const newTokens: Tokens = {
  access_token: 'access-2',
  refresh_token: 'refresh-2',
  token_type: 'Bearer',
  expires_at: '2030-01-02T00:00:00Z',
}

function identity(active_tenant_id = firstWorkspace.id): MeResponse {
  return { user, tenants: [firstWorkspace, secondWorkspace], active_tenant_id, workspace_role: 'owner' }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

let currentAuth: AuthContextValue | null = null

function CaptureAuth() {
  currentAuth = useAuth()
  return (
    <output data-testid="auth-state">
      {currentAuth.loading ? 'loading' : currentAuth.authenticated ? currentAuth.workspace?.id : 'guest'}
    </output>
  )
}

function auth(): AuthContextValue {
  if (!currentAuth) throw new Error('Auth context was not captured.')
  return currentAuth
}

afterEach(() => {
  currentAuth = null
  localStorage.clear()
})

describe('AuthProvider', () => {
  it('restores a persisted session through /v1/me', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(identity()))
    const api = new ApiClient({ sessionStore: store, fetch: fetchMock })

    render(
      <AuthProvider api={api}>
        <CaptureAuth />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('tenant-1'))
    expect(auth().user).toEqual(user)
    expect(auth().tenant).toEqual(firstWorkspace)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/me')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('keeps a two-factor challenge until completion, then hydrates the active workspace', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === '/v1/auth/login') {
        return response({
          user,
          two_factor_required: true,
          challenge_token: 'challenge-1',
          challenge_expires_at: '2035-01-01T00:00:00Z',
        })
      }
      if (url === '/v1/auth/login/2fa') return response({ user, tokens: newTokens })
      if (url === '/v1/me') return response(identity(secondWorkspace.id))
      throw new Error(`Unexpected request: ${url}`)
    })
    const api = new ApiClient({ sessionStore: new SessionStore(localStorage), fetch: fetchMock })
    render(
      <AuthProvider api={api}>
        <CaptureAuth />
      </AuthProvider>,
    )
    await waitFor(() => expect(auth().loading).toBe(false))

    let outcome: LoginOutcome | undefined
    await act(async () => {
      outcome = await auth().login({ email: user.email, password: 'Password1234' })
    })

    expect(outcome?.status).toBe('two_factor_required')
    expect(auth().twoFactorChallenge?.token).toBe('challenge-1')
    expect(auth().authenticated).toBe(false)

    await act(async () => auth().complete2FA('123456'))

    expect(auth().authenticated).toBe(true)
    expect(auth().workspace).toEqual(secondWorkspace)
    expect(auth().twoFactorChallenge).toBeNull()
    expect(api.tokens).toEqual(newTokens)
  })

  it('returns an explicit email-verification outcome for an unverified login', async () => {
    const problem: Problem = {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'email address must be verified',
      instance: '/v1/auth/login',
      code: 'forbidden',
    }
    const api = new ApiClient({
      sessionStore: new SessionStore(localStorage),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(problem, 403)),
    })
    render(
      <AuthProvider api={api}>
        <CaptureAuth />
      </AuthProvider>,
    )
    await waitFor(() => expect(auth().loading).toBe(false))

    let outcome: LoginOutcome | undefined
    await act(async () => {
      outcome = await auth().login({ email: user.email, password: 'Password1234' })
    })

    expect(outcome).toEqual({ status: 'email_verification_required', email: user.email })
    expect(auth().emailVerificationRequired).toBe(true)
    expect(auth().pendingVerificationEmail).toBe(user.email)
    expect(auth().authenticated).toBe(false)
  })

  it('changes workspace by re-authenticating for the requested tenant', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    let meCalls = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === '/v1/me') {
        meCalls += 1
        return response(identity(meCalls === 1 ? firstWorkspace.id : secondWorkspace.id))
      }
      if (url === '/v1/auth/login') {
        expect(JSON.parse(String(init?.body))).toEqual({
          email: user.email,
          password: 'Password1234',
          tenant_id: secondWorkspace.id,
        })
        return response({ user, tokens: newTokens, two_factor_required: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const api = new ApiClient({ sessionStore: store, fetch: fetchMock })
    render(
      <AuthProvider api={api}>
        <CaptureAuth />
      </AuthProvider>,
    )
    await waitFor(() => expect(auth().workspace?.id).toBe(firstWorkspace.id))

    await act(async () => {
      await auth().changeWorkspace(secondWorkspace.id, 'Password1234')
    })

    expect(auth().workspace?.id).toBe(secondWorkspace.id)
    expect(api.tokens).toEqual(newTokens)
  })
})

describe('auth route guards', () => {
  it('RequireAuth redirects guests and GuestOnly redirects authenticated users', async () => {
    const guestApi = new ApiClient({
      sessionStore: new SessionStore(localStorage, 'guest-session'),
      fetch: vi.fn<typeof fetch>(),
    })
    const guestView = render(
      <AuthProvider api={guestApi}>
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/private" element={<div>Private</div>} />
            </Route>
            <Route path="/login" element={<div>Login</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Login')).toBeInTheDocument()
    guestView.unmount()

    const authenticatedStore = new SessionStore(localStorage, 'authenticated-session')
    authenticatedStore.setTokens(oldTokens)
    const authenticatedApi = new ApiClient({
      sessionStore: authenticatedStore,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(identity())),
    })
    render(
      <AuthProvider api={authenticatedApi}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<div>Login form</div>} />
            </Route>
            <Route path="/" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
  })
})
