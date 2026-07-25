import { beforeEach, describe, expect, it } from 'vitest'
import { SESSION_STORAGE_KEY, SessionStore } from './session'
import type { Tokens } from './types'

const tokens: Tokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'Bearer',
  expires_at: '2030-01-01T00:00:00Z',
}

describe('SessionStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips only a validated token envelope', () => {
    const store = new SessionStore(localStorage)

    store.setTokens(tokens)

    expect(store.getTokens()).toEqual(tokens)
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '{}')).toEqual({
      version: 1,
      tokens,
    })
  })

  it('removes malformed or stale session data instead of trusting it', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, tokens: { ...tokens, token_type: 'Basic' } }),
    )
    const store = new SessionStore(localStorage)

    expect(store.getTokens()).toBeNull()
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('does not throw when storage access is denied', () => {
    const deniedStorage = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage
    const store = new SessionStore(deniedStorage)

    expect(store.getTokens()).toBeNull()
    expect(() => store.setTokens(tokens)).not.toThrow()
    expect(() => store.clear()).not.toThrow()
  })
})
