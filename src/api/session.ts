import type { Tokens } from './types'

export const SESSION_STORAGE_KEY = 'sslping.dashboard.session.v1'

interface StoredSessionEnvelope {
  version: 1
  tokens: Tokens
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTokens(value: unknown): value is Tokens {
  if (!isRecord(value)) return false

  return (
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.refresh_token === 'string' &&
    value.refresh_token.length > 0 &&
    value.token_type === 'Bearer' &&
    typeof value.expires_at === 'string' &&
    value.expires_at.length > 0 &&
    Number.isFinite(Date.parse(value.expires_at))
  )
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Minimal, versioned localStorage session persistence.
 *
 * Browser storage cannot protect tokens from JavaScript running in the same
 * origin. This store limits accidental exposure by persisting only the token
 * pair, validating every read, never interpolating credentials into URLs and
 * removing malformed state immediately.
 */
export class SessionStore {
  readonly #storage: Storage | undefined
  readonly #key: string

  constructor(storage: Storage | undefined = defaultStorage(), key = SESSION_STORAGE_KEY) {
    this.#storage = storage
    this.#key = key
  }

  getTokens(): Tokens | null {
    if (!this.#storage) return null

    try {
      const raw = this.#storage.getItem(this.#key)
      if (raw === null) return null

      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || parsed.version !== 1 || !isTokens(parsed.tokens)) {
        this.clear()
        return null
      }

      return { ...parsed.tokens }
    } catch {
      this.clear()
      return null
    }
  }

  setTokens(tokens: Tokens): void {
    if (!this.#storage || !isTokens(tokens)) return

    const envelope: StoredSessionEnvelope = {
      version: 1,
      tokens: { ...tokens },
    }

    try {
      this.#storage.setItem(this.#key, JSON.stringify(envelope))
    } catch {
      // Quota/security failures must not break an otherwise valid login.
    }
  }

  clear(): void {
    try {
      this.#storage?.removeItem(this.#key)
    } catch {
      // Storage may be unavailable in private/restricted browsing modes.
    }
  }
}
