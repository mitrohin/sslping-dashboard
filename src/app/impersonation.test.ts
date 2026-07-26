import { beforeEach, describe, expect, it } from 'vitest'
import { ApiClient } from '../api/client'
import { SessionStore } from '../api/session'
import type { Tokens } from '../api/types'
import { ADMIN_SESSION_BACKUP_KEY, restoreAdministratorSession, saveAdministratorSession } from './impersonation'

const tokens: Tokens = { access_token: 'admin-access', refresh_token: 'admin-refresh', token_type: 'Bearer', expires_at: '2030-01-01T00:00:00Z' }

describe('impersonation session handoff', () => {
  beforeEach(() => localStorage.clear())

  it('preserves and restores the administrator token pair', () => {
    const api = new ApiClient({ sessionStore: new SessionStore(localStorage) })
    api.setTokens(tokens)
    expect(saveAdministratorSession(api)).toBe(true)
    api.clearSession()

    expect(restoreAdministratorSession(api)).toBe(true)
    expect(api.tokens).toEqual(tokens)
    expect(localStorage.getItem(ADMIN_SESSION_BACKUP_KEY)).toBeNull()
  })

  it('rejects malformed backup data', () => {
    const api = new ApiClient({ sessionStore: new SessionStore(localStorage) })
    localStorage.setItem(ADMIN_SESSION_BACKUP_KEY, '{"access_token":"bad"}')
    expect(restoreAdministratorSession(api)).toBe(false)
    expect(api.tokens).toBeNull()
  })
})
