import type { Role } from '../api/types'

export function workspaceCapabilities(role: Role | null | undefined) {
  return {
    edit: role === 'owner' || role === 'admin' || role === 'editor',
    administer: role === 'owner' || role === 'admin',
  }
}
