import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/client'
import { SessionStore } from '../../api/session'
import type {
  OAuthAuthorizationPreview,
  OAuthAuthorizationRequest,
  Problem,
  Workspace,
} from '../../api/types'
import { AuthProvider } from '../../app/AuthProvider'
import OAuthAuthorizePage from './OAuthAuthorizePage'

const request: OAuthAuthorizationRequest = {
  response_type: 'code',
  client_id: 'chatgpt-client',
  redirect_uri: 'https://chatgpt.com/connector/oauth/callback',
  scope: 'monitors:read incidents:read maintenance:write',
  state: 'opaque-state',
  code_challenge: 'pkce-challenge',
  code_challenge_method: 'S256',
  resource: 'https://api.sslping.test/mcp',
}

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Production Operations',
  slug: 'production-operations',
  plan: 'pro',
  timezone: 'UTC',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const preview: OAuthAuthorizationPreview = {
  client_id: request.client_id,
  client_name: 'ChatGPT',
  redirect_uri: request.redirect_uri,
  workspace,
  role: 'owner',
  requested_scopes: ['monitors:read', 'incidents:read', 'maintenance:write'],
  granted_scopes: ['monitors:read', 'incidents:read', 'maintenance:write'],
  excluded_scopes: [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })
}

function authorizationPath(input: OAuthAuthorizationRequest = request): string {
  return `/oauth/authorize?${new URLSearchParams(Object.entries(input)).toString()}`
}

function renderPage(fetchMock: typeof fetch, input: OAuthAuthorizationRequest = request) {
  const api = new ApiClient({ fetch: fetchMock, sessionStore: new SessionStore(localStorage) })
  return render(
    <AuthProvider api={api}>
      <MemoryRouter initialEntries={[authorizationPath(input)]}>
        <OAuthAuthorizePage />
      </MemoryRouter>
    </AuthProvider>,
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('OAuthAuthorizePage', () => {
  it('previews the full authorization query and shows the validated destination, workspace, and scopes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('/v1/oauth/authorize/preview')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual(request)
      return json(preview)
    })

    renderPage(fetchMock)

    expect(await screen.findByRole('heading', { name: 'Connect ChatGPT to SSLPing?' })).toBeInTheDocument()
    expect(screen.getByText('Production Operations')).toBeInTheDocument()
    expect(screen.getByText(/current workspace and role \(owner\)/i)).toBeInTheDocument()
    expect(screen.getByText(/return to chatgpt\.com/i)).toBeInTheDocument()
    expect(screen.getByText('View monitors')).toBeInTheDocument()
    expect(screen.getByText('View incidents')).toBeInTheDocument()
    expect(screen.getByText('Manage maintenance')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('approves with the original authorization query and follows the returned redirect', async () => {
    const redirectTo = `${window.location.origin}/#oauth-approved`
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/v1/oauth/authorize/preview') return json(preview)
      if (String(input) === '/v1/oauth/authorize') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ ...request, approved: true })
        return json({ redirect_to: redirectTo })
      }
      throw new Error(`Unexpected URL ${String(input)}`)
    })

    renderPage(fetchMock)
    fireEvent.click(await screen.findByRole('button', { name: /allow access/i }))

    await waitFor(() => expect(window.location.hash).toBe('#oauth-approved'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not allow approval when the current role grants none of the requested scopes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({
      ...preview,
      role: 'viewer',
      granted_scopes: [],
      excluded_scopes: preview.requested_scopes,
    } satisfies OAuthAuthorizationPreview))

    renderPage(fetchMock)

    expect(await screen.findByText('No permissions can be granted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /allow access/i })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('shows a server validation failure from the preview request', async () => {
    const problem: Problem = {
      type: 'https://sslping.test/problems/invalid-oauth-request',
      title: 'Invalid authorization request',
      status: 400,
      detail: 'The redirect URI is not registered for this client.',
      instance: '/v1/oauth/authorize/preview',
      code: 'invalid_request',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(problem, 400))

    renderPage(fetchMock)

    expect(await screen.findByText('Unable to authorize')).toBeInTheDocument()
    expect(screen.getByText(problem.detail)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /allow access/i })).not.toBeInTheDocument()
  })
})
