import type { Tokens } from './types'

export const SESSION_STORAGE_KEY = 'sslping.dashboard.session.v1'

export type RefreshState =
  | { status: 'pending' | 'uncertain' }
  | { status: 'cooldown'; retryAt: number; httpStatus: number }

export interface SessionSnapshot {
  tokens: Tokens | null
  generation: string | null
  refresh?: RefreshState
  shared: boolean
}

export interface SessionChange {
  snapshot: SessionSnapshot
  identityChanged: boolean
  external: boolean
}

interface StoredSessionEnvelope {
  version: 2
  tokens: Tokens
  generation: string
  refresh?: RefreshState
}

export class SessionRecoveryError extends Error {
  constructor(readonly reason: 'coordination_unavailable' | 'refresh_uncertain') {
    super(reason === 'refresh_uncertain'
      ? 'The previous session refresh could not be confirmed. Please sign in again to reconnect safely.'
      : 'The browser could not safely refresh this shared session. Allow site storage and use a current browser, then try again.')
    this.name = 'SessionRecoveryError'
  }
}

export function sessionChangedError(): DOMException {
  return new DOMException('The session changed. The previous request was canceled.', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTokens(value: unknown): value is Tokens {
  if (!isRecord(value)) return false
  return typeof value.access_token === 'string' && value.access_token.length > 0
    && typeof value.refresh_token === 'string' && value.refresh_token.length > 0
    && value.token_type === 'Bearer' && typeof value.expires_at === 'string'
    && Number.isFinite(Date.parse(value.expires_at))
}

function defaultStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

const emptySnapshot = (): SessionSnapshot => ({ tokens: null, generation: null, shared: false })
const copySnapshot = (value: SessionSnapshot): SessionSnapshot => ({ ...value, tokens: value.tokens ? { ...value.tokens } : null, refresh: value.refresh ? { ...value.refresh } : undefined })
const localEvents = new EventTarget()
const localQueues = new WeakMap<object, Map<string, Promise<unknown>>>()

function parseStored(raw: string | null): SessionSnapshot {
  if (raw === null) return emptySnapshot()
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !isTokens(parsed.tokens)) throw new Error('Invalid session envelope')
  // Preserve existing installations. The first coordinated refresh upgrades
  // the envelope; no independently generated per-tab migration id is needed.
  if (parsed.version === 1) return { tokens: parsed.tokens, generation: 'legacy', shared: true }
  if (parsed.version !== 2 || typeof parsed.generation !== 'string' || !parsed.generation) throw new Error('Invalid session version')
  const state = parsed.refresh
  let refresh: RefreshState | undefined
  if (state !== undefined) {
    if (!isRecord(state)) throw new Error('Invalid refresh state')
    if (state.status === 'pending' || state.status === 'uncertain') refresh = { status: state.status }
    else if (state.status === 'cooldown' && typeof state.retryAt === 'number' && Number.isFinite(state.retryAt) && typeof state.httpStatus === 'number') {
      refresh = { status: 'cooldown', retryAt: state.retryAt, httpStatus: state.httpStatus }
    } else throw new Error('Invalid refresh state')
  }
  return { tokens: parsed.tokens, generation: parsed.generation, refresh, shared: true }
}

/** Memory owns the active session; persistence is optional, never an auth prerequisite. */
export class SessionStore {
  readonly #storage: Storage | undefined
  readonly #key: string
  readonly #browserStorage: boolean
  #memory = emptySnapshot()
  #unpersisted = false
  #readFailed = false
  readonly #listeners = new Set<(change: SessionChange) => void>()
  #stopListening?: () => void
  #channel?: BroadcastChannel

  constructor(storage: Storage | undefined = defaultStorage(), key = SESSION_STORAGE_KEY) {
    this.#storage = storage
    this.#key = key
    this.#browserStorage = storage !== undefined && storage === defaultStorage()
    this.#read()
  }

  getSnapshot(): SessionSnapshot {
    if (!this.#unpersisted) this.#read()
    return copySnapshot(this.#memory)
  }

  getTokens(): Tokens | null { return this.getSnapshot().tokens }

  getRefreshSnapshot(): SessionSnapshot {
    const snapshot = this.getSnapshot()
    if (snapshot.shared && this.#readFailed) throw new SessionRecoveryError('coordination_unavailable')
    return snapshot
  }

  subscribe(listener: (change: SessionChange) => void): () => void {
    this.#listeners.add(listener)
    if (!this.#stopListening) this.#listen()
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) {
        this.#stopListening?.()
        this.#stopListening = undefined
        this.#channel?.close()
        this.#channel = undefined
      }
    }
  }

  setTokens(tokens: Tokens): void {
    if (!isTokens(tokens)) return
    this.#write({ tokens: { ...tokens }, generation: crypto.randomUUID(), shared: false })
  }

  clear(): void { this.#write(emptySnapshot()) }

  setRefreshState(expected: SessionSnapshot, refresh: RefreshState): void {
    const current = this.#expect(expected)
    const persisted = this.#write({ ...current, refresh })
    // A shared rotating token must never leave the browser before its pending
    // marker is durable. Otherwise another tab could replay it after a crash.
    if (current.shared && !persisted) throw new SessionRecoveryError('coordination_unavailable')
  }

  replaceRefreshedTokens(expected: SessionSnapshot, tokens: Tokens): void {
    if (!isTokens(tokens)) throw new SessionRecoveryError('refresh_uncertain')
    const current = this.#expect(expected)
    this.#write({ tokens: { ...tokens }, generation: current.generation, shared: false })
  }

  async withRefreshLock<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    const scope = this.#storage ?? this
    let queues = localQueues.get(scope)
    if (!queues) { queues = new Map(); localQueues.set(scope, queues) }
    const previous = queues.get(this.#key) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(async () => {
      signal.throwIfAborted()
      if (this.#browserStorage && this.getSnapshot().shared) {
        if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new SessionRecoveryError('coordination_unavailable')
        return navigator.locks.request(`sslping:refresh:${this.#key}`, { signal }, async () => {
          signal.throwIfAborted()
          return action()
        })
      }
      return action()
    })
    queues.set(this.#key, task)
    try { return await task } finally { if (queues.get(this.#key) === task) queues.delete(this.#key) }
  }

  #expect(expected: SessionSnapshot): SessionSnapshot {
    const current = this.getRefreshSnapshot()
    if (!current.tokens || current.generation !== expected.generation || current.tokens.refresh_token !== expected.tokens?.refresh_token) throw sessionChangedError()
    return current
  }

  #accept(snapshot: SessionSnapshot, external: boolean): void {
    const previous = this.#memory
    this.#memory = copySnapshot(snapshot)
    const identityChanged = previous.generation !== snapshot.generation
    const tokenChanged = previous.tokens?.access_token !== snapshot.tokens?.access_token
    if (identityChanged || tokenChanged) {
      for (const listener of this.#listeners) listener({ snapshot: copySnapshot(snapshot), identityChanged, external })
    }
  }

  #read(): void {
    if (!this.#storage) return
    let raw: string | null
    try { raw = this.#storage.getItem(this.#key); this.#readFailed = false } catch { this.#readFailed = true; return }
    try { this.#accept(parseStored(raw), true) } catch {
      try { this.#storage.removeItem(this.#key) } catch { /* Keep malformed credentials out of memory even if removal fails. */ }
      this.#accept(emptySnapshot(), true)
    }
  }

  #write(snapshot: SessionSnapshot): boolean {
    const previousGeneration = this.#memory.generation
    let persisted = false
    try {
      if (this.#storage) {
        if (snapshot.tokens) {
          const envelope: StoredSessionEnvelope = { version: 2, tokens: snapshot.tokens, generation: snapshot.generation!, refresh: snapshot.refresh }
          this.#storage.setItem(this.#key, JSON.stringify(envelope))
        } else this.#storage.removeItem(this.#key)
        persisted = true
      }
    } catch { /* A live session continues in memory; a pending shared refresh stays journaled. */ }
    this.#unpersisted = !persisted
    const next = { ...snapshot, shared: persisted && snapshot.tokens !== null }
    this.#accept(next, false)
    localEvents.dispatchEvent(new CustomEvent('session', { detail: { source: this, storage: this.#storage, key: this.#key, snapshot: next, persisted } }))
    if (persisted || !snapshot.tokens) this.#channel?.postMessage({ key: this.#key, signedOut: !snapshot.tokens, previousGeneration, persisted })
    return persisted
  }

  #listen(): void {
    const local = (event: Event) => {
      const detail = (event as CustomEvent).detail as { source: SessionStore; storage: Storage | undefined; key: string; snapshot: SessionSnapshot; persisted: boolean }
      if (detail.source === this || !this.#storage || detail.storage !== this.#storage || detail.key !== this.#key) return
      this.#unpersisted = !detail.persisted
      this.#accept(detail.snapshot, true)
    }
    const storage = (event: StorageEvent) => {
      if (!this.#browserStorage || (event.storageArea && event.storageArea !== this.#storage) || (event.key !== null && event.key !== this.#key)) return
      // Read current storage instead of event.newValue: queued events may refer
      // to an older login/refresh than the value already committed by another tab.
      this.#unpersisted = false
      this.#read()
    }
    const focus = () => { if (this.#browserStorage && !this.#unpersisted) this.#read() }
    localEvents.addEventListener('session', local)
    if (this.#browserStorage && typeof window !== 'undefined') {
      window.addEventListener('storage', storage)
      window.addEventListener('focus', focus)
      if (typeof window.BroadcastChannel === 'function') {
        try {
          this.#channel = new window.BroadcastChannel(`sslping:session:${this.#key}`)
          this.#channel.onmessage = (event: MessageEvent<unknown>) => {
            if (!isRecord(event.data) || event.data.key !== this.#key) return
            // No credentials travel through BroadcastChannel. Storage remains
            // canonical. A failed removal is the one case needing a tombstone.
            if (event.data.signedOut === true && event.data.persisted === false && event.data.previousGeneration === this.#memory.generation) {
              this.#unpersisted = true
              this.#accept(emptySnapshot(), true)
              return
            }
            this.#unpersisted = false
            this.#read()
          }
        } catch { /* Storage events still synchronize persisted sessions. */ }
      }
    }
    this.#stopListening = () => {
      localEvents.removeEventListener('session', local)
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', storage)
        window.removeEventListener('focus', focus)
      }
    }
  }
}
