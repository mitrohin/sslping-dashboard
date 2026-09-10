import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, parseRetryAfter } from './client'
import { SessionRecoveryError, SessionStore, type SessionSnapshot } from './session'
import type { Tokens } from './types'

const oldTokens: Tokens = { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer', expires_at: '2030-01-01T00:00:00Z' }
const newTokens: Tokens = { ...oldTokens, access_token: 'new-access', refresh_token: 'new-refresh' }
const otherTokens: Tokens = { ...oldTokens, access_token: 'other-account', refresh_token: 'other-refresh' }
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers })
const authorization = (init?: RequestInit) => new Headers(init?.headers).get('Authorization')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const clients: ApiClient[] = []
function client(store: SessionStore, fetch: typeof globalThis.fetch, timeout?: number) {
  const value = new ApiClient({ baseUrl: '', sessionStore: store, fetch, requestTimeoutMs: timeout })
  clients.push(value)
  return value
}
let key: string
function store(tokens: Tokens = oldTokens) {
  const value = new SessionStore(localStorage, key)
  value.setTokens(tokens)
  return value
}
beforeEach(() => { key = `auth-test:${crypto.randomUUID()}` })
afterEach(() => {
  clients.splice(0).forEach((value) => value.dispose())
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('coordinated rotating sessions', () => {
  it('serializes two clients sharing browser storage and reuses the successor instead of replaying refresh', async () => {
    const firstStore = store()
    const secondStore = new SessionStore(localStorage, key)
    const response = deferred<Response>()
    const started = deferred<void>()
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (String(url).endsWith('/refresh')) { started.resolve(); return response.promise }
      return authorization(init) === 'Bearer old-access' ? json({}, 401) : json({ user: { id: 'user' } })
    })
    const first = client(firstStore, fetch)
    const second = client(secondStore, fetch)
    const reads = [first.me(), second.me()]
    await started.promise
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
    response.resolve(json(newTokens))
    await Promise.all(reads)
    expect(firstStore.getTokens()).toEqual(newTokens)
    expect(secondStore.getTokens()).toEqual(newTokens)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
  })

  it('never replays a pending refresh journal left by a closed tab', async () => {
    const previous = store()
    previous.setRefreshState(previous.getSnapshot(), { status: 'pending' })
    const reloaded = new SessionStore(localStorage, key)
    const fetch = vi.fn<typeof globalThis.fetch>()
    const api = client(reloaded, fetch)
    await expect(api.refresh()).rejects.toMatchObject({ name: 'SessionRecoveryError', reason: 'refresh_uncertain' })
    expect(fetch).not.toHaveBeenCalled()
    expect(api.tokens).toEqual(oldTokens)
  })

  it('does not risk a shared rotating token when cross-tab locking is unavailable', async () => {
    const locks = navigator.locks
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    try {
      const fetch = vi.fn<typeof globalThis.fetch>()
      const api = client(store(), fetch)
      await expect(api.refresh()).rejects.toBeInstanceOf(SessionRecoveryError)
      expect(fetch).not.toHaveBeenCalled()
      expect(api.tokens).toEqual(oldTokens)
    } finally { Object.defineProperty(navigator, 'locks', { configurable: true, value: locks }) }
  })

  it('refuses a shared refresh when current storage cannot be reread under the lock', async () => {
    const current = store()
    const fetch = vi.fn<typeof globalThis.fetch>()
    const api = client(current, fetch)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    await expect(api.refresh()).rejects.toMatchObject({ reason: 'coordination_unavailable' })
    expect(fetch).not.toHaveBeenCalled()
    expect(api.tokens).toEqual(oldTokens)
  })

  it('refuses a shared refresh if its pending marker cannot be persisted', async () => {
    const current = store()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError') })
    const fetch = vi.fn<typeof globalThis.fetch>()
    const api = client(current, fetch)
    await expect(api.refresh()).rejects.toMatchObject({ reason: 'coordination_unavailable' })
    expect(fetch).not.toHaveBeenCalled()
    expect(api.tokens).toEqual(oldTokens)
  })

  it('cancels a late refresh after logout even if the transport ignores AbortSignal', async () => {
    const current = store()
    const response = deferred<Response>()
    const started = deferred<void>()
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/refresh')) { started.resolve(); return response.promise }
      return new Response(null, { status: 204 })
    })
    const api = client(current, fetch)
    const refreshing = api.refresh().catch((error: unknown) => error)
    await started.promise
    await api.logout()
    expect(api.tokens).toBeNull()
    response.resolve(json(newTokens))
    expect(await refreshing).toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(api.tokens).toBeNull()
  })

  it('a delayed refresh cannot overwrite a newer account login', async () => {
    const current = store()
    const response = deferred<Response>()
    const started = deferred<void>()
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/refresh')) { started.resolve(); return response.promise }
      return json({ tokens: otherTokens })
    })
    const api = client(current, fetch)
    const refreshing = api.refresh().catch((error: unknown) => error)
    await started.promise
    await api.login({ email: 'other@example.test', password: 'not-real' })
    response.resolve(json(newTokens))
    expect(await refreshing).toMatchObject({ name: 'AbortError' })
    expect(api.tokens).toEqual(otherTokens)
  })

  it('logout cancels a pending login and does not need an already-persisted token', async () => {
    const response = deferred<Response>()
    const api = client(new SessionStore(localStorage, key), vi.fn(async () => response.promise))
    const login = api.login({ email: 'audit@example.test', password: 'not-real' }).catch((error: unknown) => error)
    await api.logout()
    response.resolve(json({ tokens: newTokens }))
    expect(await login).toMatchObject({ name: 'AbortError' })
    expect(api.tokens).toBeNull()
  })

  it('a slow logout response cannot clear a subsequent successful login', async () => {
    const response = deferred<Response>()
    const api = client(store(), vi.fn(async (url) => String(url).endsWith('/logout') ? response.promise : json({ tokens: otherTokens })))
    const logout = api.logout()
    expect(api.tokens).toBeNull()
    await api.login({ email: 'other@example.test', password: 'not-real' })
    response.resolve(new Response(null, { status: 204 }))
    await logout
    expect(api.tokens).toEqual(otherTokens)
  })

  it('synchronizes another client’s identity/logout and aborts responses from the old identity', async () => {
    const firstStore = store()
    const secondStore = new SessionStore(localStorage, key)
    const response = deferred<Response>()
    const api = client(firstStore, vi.fn(async () => response.promise))
    const second = client(secondStore, vi.fn<typeof globalThis.fetch>())
    const changed = vi.fn()
    const signedOut = vi.fn()
    api.onSessionChanged(changed)
    api.onAuthenticationRequired(signedOut)
    const reading = api.me().catch((error: unknown) => error)
    second.setTokens(otherTokens)
    expect(await reading).toMatchObject({ name: 'AbortError' })
    response.resolve(json({ user: { id: 'old-user' } }))
    expect(api.tokens).toEqual(otherTokens)
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ external: true, identityChanged: true }))
    second.clearSession()
    expect(api.tokens).toBeNull()
    expect(signedOut).toHaveBeenCalledOnce()
  })

  it('reads the newest stored value rather than a queued, stale storage event payload', () => {
    const current = store()
    const api = client(current, vi.fn<typeof globalThis.fetch>())
    const generation = crypto.randomUUID()
    localStorage.setItem(key, JSON.stringify({ version: 2, generation, tokens: otherTokens }))
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ version: 1, tokens: oldTokens }), storageArea: localStorage }))
    expect(api.tokens).toEqual(otherTokens)
    expect(api.sessionGeneration).toBe(generation)
  })
})

describe('recoverable refresh failures and business authorization', () => {
  it.each([429, 503])('preserves credentials for HTTP %s and respects shared Retry-After before the next attempt', async (status) => {
    vi.useFakeTimers()
    const current = store()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({}, status, { 'Retry-After': '120' })).mockResolvedValue(json(newTokens))
    const api = client(current, fetch)
    const signedOut = vi.fn()
    api.onAuthenticationRequired(signedOut)
    await expect(api.refresh()).rejects.toMatchObject({ status, retryAfterMs: 120_000 })
    expect(api.tokens).toEqual(oldTokens)
    const other = client(new SessionStore(localStorage, key), fetch)
    await expect(other.refresh()).rejects.toMatchObject({ status, retryAfterMs: 120_000 })
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(120_001)
    await expect(other.refresh()).resolves.toEqual(newTokens)
    expect(api.tokens).toEqual(newTokens)
    expect(signedOut).not.toHaveBeenCalled()
  })

  it('preserves tokens after a lost refresh response but never automatically replays the uncertain token', async () => {
    const current = store()
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('Network unavailable'))
    const api = client(current, fetch)
    const signedOut = vi.fn()
    api.onAuthenticationRequired(signedOut)
    await expect(api.refresh()).rejects.toThrow('Network unavailable')
    expect(api.tokens).toEqual(oldTokens)
    await expect(api.refresh()).rejects.toMatchObject({ reason: 'refresh_uncertain' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(signedOut).not.toHaveBeenCalled()
  })

  it('preserves tokens after malformed refresh success and prevents replay', async () => {
    const api = client(store(), vi.fn(async () => json({ access_token: 'incomplete' })))
    await expect(api.refresh()).rejects.toMatchObject({ reason: 'refresh_uncertain' })
    expect(api.tokens).toEqual(oldTokens)
    await expect(api.refresh()).rejects.toMatchObject({ reason: 'refresh_uncertain' })
  })

  it.each(['invitation', 'subscription'])('does not refresh, repeat or log out on an expired %s token', async (kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ detail: 'token expired' }, 401))
    const api = client(store(), fetch)
    const operation = kind === 'invitation' ? api.acceptInvitation({ token: 'expired' }) : api.acceptMonitorSubscription('tenant', 'expired')
    await expect(operation).rejects.toBeInstanceOf(ApiError)
    expect(fetch).toHaveBeenCalledOnce()
    expect(api.tokens).toEqual(oldTokens)
  })

  it('refreshes an expiring access token before sending a one-time invitation exactly once', async () => {
    const current = store({ ...oldTokens, expires_at: '2020-01-01T00:00:00Z' })
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => String(url).endsWith('/refresh') ? json(newTokens) : json({}, 401))
    const api = client(current, fetch)
    await expect(api.acceptInvitation({ token: 'expired' })).rejects.toMatchObject({ status: 401 })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/v1/auth/refresh', '/v1/invitations/accept'])
    expect(api.tokens).toEqual(newTokens)
  })
})

describe('request deadlines and storage fallback', () => {
  it('authenticates and refreshes a memory-only session when all persistence operations throw', async () => {
    const denied: Storage = { length: 0, clear() {}, key() { return null }, getItem() { throw new DOMException('Denied', 'SecurityError') }, setItem() { throw new DOMException('Denied', 'SecurityError') }, removeItem() { throw new DOMException('Denied', 'SecurityError') } }
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/login')) return json({ tokens: oldTokens })
      if (String(url).endsWith('/refresh')) return json(newTokens)
      return json({ user: {} })
    })
    const api = client(new SessionStore(denied), fetch)
    await api.login({ email: 'audit@example.test', password: 'not-real' })
    await api.me()
    expect(authorization(fetch.mock.calls[1][1])).toBe('Bearer old-access')
    await expect(api.refresh()).resolves.toEqual(newTokens)
    api.clearSession()
    expect(api.tokens).toBeNull()
  })

  it('cancels a superseded read through its optional signal without invalidating auth', async () => {
    const caller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined))
    const api = client(store(), fetch)
    const reading = api.listMonitors('tenant', { search: 'previous' }, { signal: caller.signal }).catch((error: unknown) => error)
    caller.abort()
    expect(await reading).toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(api.tokens).toEqual(oldTokens)
  })

  it('times out a stalled authenticated request, aborts the transport and preserves the session', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined))
    const api = client(store(), fetch, 50)
    const reading = api.me().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(51)
    expect(await reading).toMatchObject({ name: 'TimeoutError' })
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(api.tokens).toEqual(oldTokens)
  })

  it('a timed out refresh remains uncertain for another client after the lock is released', async () => {
    vi.useFakeTimers()
    const current = store()
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined))
    const api = client(current, fetch, 50)
    const refreshing = api.refresh().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(51)
    expect(await refreshing).toMatchObject({ name: 'TimeoutError' })
    const reloaded = client(new SessionStore(localStorage, key), fetch, 50)
    await expect(reloaded.refresh()).rejects.toMatchObject({ reason: 'refresh_uncertain' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(api.tokens).toEqual(oldTokens)
  })

  it('does not resurrect stale persisted tokens if logout cannot remove storage', () => {
    const current = store()
    const api = client(current, vi.fn<typeof globalThis.fetch>())
    const other = client(new SessionStore(localStorage, key), vi.fn<typeof globalThis.fetch>())
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    api.clearSession()
    expect(api.tokens).toBeNull()
    expect(other.tokens).toBeNull()
  })

  it('retains generation during refresh and replaces it for a new identity', () => {
    const current = store()
    const snapshot: SessionSnapshot = current.getSnapshot()
    current.replaceRefreshedTokens(snapshot, newTokens)
    expect(current.getSnapshot().generation).toBe(snapshot.generation)
    current.setTokens(otherTokens)
    expect(current.getSnapshot().generation).not.toBe(snapshot.generation)
  })

  it('parses both Retry-After formats without accepting malformed delays', () => {
    const now = Date.parse('2026-09-10T00:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter('Thu, 10 Sep 2026 00:02:00 GMT', now)).toBe(120_000)
    expect(parseRetryAfter('invalid', now)).toBeUndefined()
    expect(parseRetryAfter('-1', now)).toBeUndefined()
    expect(parseRetryAfter('0.5', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })
})
