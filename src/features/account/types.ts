import type {
  ApiKeyScope,
  ApiKeyViewModel,
  IntegrationEvent,
  IntegrationType,
  IntegrationViewModel,
  TeamMemberViewModel,
  TeamRole,
} from '../../data'

export interface TeamDetails {
  name: string
  slug: string
  timezone: string
  notificationEmail: string
}

export interface InviteMemberInput {
  email: string
  role: Exclude<TeamRole, 'owner'>
  phone?: string
}

export interface TeamMemberPatch {
  role?: Exclude<TeamRole, 'owner'>
  status?: TeamMemberViewModel['status']
}

export interface IntegrationInput {
  name: string
  type: IntegrationType
  active: boolean
  events: readonly IntegrationEvent[]
  monitorIds: readonly string[]
  config: Readonly<Record<string, string>>
}

export interface ApiKeyCreateInput {
  name: string
  kind: ApiKeyViewModel['kind']
  scopes: readonly ApiKeyScope[]
  monitorId?: string
  expiresAt?: string
}

export interface ApiKeyCreateResult {
  key: ApiKeyViewModel
  secret: string
}

export interface AuditEntry {
  id: string
  occurredAt: string
  actorName: string
  actorEmail?: string
  action: string
  category: 'auth' | 'team' | 'monitor' | 'incident' | 'integration' | 'api-key' | 'workspace'
  target: string
  ipAddress?: string
  outcome: 'success' | 'warning' | 'failure'
  detail?: string
}

export type SaveIntegrationCallback = (
  input: IntegrationInput,
  existingId?: string,
) => Promise<IntegrationViewModel | void>
