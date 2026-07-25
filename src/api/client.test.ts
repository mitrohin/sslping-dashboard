import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './client'
import { SessionStore } from './session'
import type { Problem, Tokens } from './types'

const oldTokens: Tokens = {
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  token_type: 'Bearer',
  expires_at: '2030-01-01T00:00:00Z',
}

const newTokens: Tokens = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  token_type: 'Bearer',
  expires_at: '2030-01-02T00:00:00Z',
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function authorization(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization')
}

describe('ApiClient', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normalizes the configured base URL and safely builds path/query values', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }))
    const client = new ApiClient({
      baseUrl: 'https://api.example.test///',
      sessionStore: new SessionStore(localStorage),
      fetch: fetchMock,
    })

    await client.listMonitors('tenant/id', {
      limit: 25,
      cursor: 'next token',
      search: 'api & web',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/v1/tenants/tenant%2Fid/monitors?limit=25&cursor=next+token&search=api+%26+web',
    )
  })

  it('uses one refresh request for concurrent 401 responses and retries with the new bearer token', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    let refreshCalls = 0

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(init?.body).toBe(JSON.stringify({ refresh_token: 'old-refresh' }))
        expect(authorization(init)).toBeNull()
        return jsonResponse(newTokens)
      }

      if (authorization(init) === 'Bearer old-access') {
        return jsonResponse(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Expired token',
            instance: url,
            code: 'unauthorized',
          } satisfies Problem,
          401,
        )
      }

      expect(authorization(init)).toBe('Bearer new-access')
      return jsonResponse(url.endsWith('/monitors/monitor-1') ? { id: 'monitor-1' } : { items: [] })
    })

    const client = new ApiClient({ baseUrl: '/api', sessionStore: store, fetch: fetchMock })
    await Promise.all([client.getMonitor('tenant-1', 'monitor-1'), client.listMonitors('tenant-1')])

    expect(refreshCalls).toBe(1)
    expect(store.getTokens()).toEqual(newTokens)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('surfaces RFC 9457-style problem details and the request id', async () => {
    const problem: Problem = {
      type: 'https://sslping.example/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'Slug is already in use.',
      instance: '/v1/tenants/t/status-pages',
      code: 'conflict',
      errors: { slug: 'already exists' },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(problem, 409, {
        'Content-Type': 'application/problem+json',
        'X-Request-ID': 'request-123',
      }),
    )
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock })

    const result = client.listStatusPages('tenant-1')

    await expect(result).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      requestId: 'request-123',
      problem,
    } satisfies Partial<ApiError>)
  })

  it('clears persisted credentials when refresh is rejected', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/auth/refresh')) {
        return jsonResponse(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Refresh token revoked.',
            instance: url,
            code: 'unauthorized',
          } satisfies Problem,
          401,
        )
      }
      return jsonResponse({}, 401)
    })
    const client = new ApiClient({ sessionStore: store, fetch: fetchMock })

    await expect(client.me()).rejects.toMatchObject({ status: 401 })
    expect(store.getTokens()).toBeNull()
  })
})
