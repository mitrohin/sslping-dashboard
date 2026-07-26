import type { ApiClient } from '../api/client'
import { isTokens } from '../api/session'

export const ADMIN_SESSION_BACKUP_KEY = 'sslping.dashboard.admin-session.v1'

export function saveAdministratorSession(api: ApiClient): boolean {
  if (!api.tokens) return false
  try {
    window.localStorage.setItem(ADMIN_SESSION_BACKUP_KEY, JSON.stringify(api.tokens))
    return true
  } catch {
    return false
  }
}

export function restoreAdministratorSession(api: ApiClient): boolean {
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_BACKUP_KEY)
    if (!raw) return false
    const tokens: unknown = JSON.parse(raw)
    if (!isTokens(tokens)) return false
    api.setTokens(tokens)
    window.localStorage.removeItem(ADMIN_SESSION_BACKUP_KEY)
    return true
  } catch {
    return false
  }
}

export function clearAdministratorSessionBackup() {
  try { window.localStorage.removeItem(ADMIN_SESSION_BACKUP_KEY) } catch { /* unavailable storage */ }
}
