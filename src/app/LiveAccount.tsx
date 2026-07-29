import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  APIKey,
  APIKeyRequest,
  APIKeyScope,
  IntegrationConfigInput,
  IntegrationCreateRequest,
  IntegrationEvent as ApiIntegrationEvent,
  IntegrationUpdateRequest,
  Invitation,
  MembershipPatch,
  Role,
  Workspace,
} from '../api/types'
import { Button, PageLoadingSkeleton, Panel } from '../components/ui'
import {
  demoApiKeys,
  demoIntegrationCatalog,
  demoIntegrations,
  demoMonitors,
  type ApiKeyViewModel,
  type IntegrationEvent,
  type IntegrationType,
  type IntegrationViewModel,
  type MonitorViewModel,
  type TeamMemberViewModel,
  type TeamRole,
  type TeamSummary,
} from '../data'
import {
  IntegrationsPage,
  TeamPage,
  demoAuditEntries,
  type ApiKeyCreateInput,
  type ApiKeyCreateResult,
  type AuditEntry,
  type IntegrationInput,
  type InviteMemberInput,
  type TeamDetails,
  type TeamMemberPatch,
} from '../features/account'
import {
  toApiKeyViewModel,
  toAuditLogViewModel,
  toIntegrationViewModel,
  toMonitorViewModel,
  toTeamMemberViewModel,
} from './viewAdapters'
import { useAuth } from './AuthProvider'
import { isDemoSession } from './DashboardGate'

const integrationEvents = new Set<ApiIntegrationEvent>([
  'monitor.down',
  'monitor.up',
  'monitor.slow',
  'ssl.expiry',
  'domain.expiry',
  'incident.updated',
  'maintenance.started',
])

const apiKeyScopes = new Set<APIKeyScope>([
  'read',
  'write',
  'monitors:read',
  'monitors:write',
  'incidents:read',
  'incidents:write',
  'status:read',
])

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: T }

interface TeamRouteData {
  workspace: Workspace
  members: readonly TeamMemberViewModel[]
  summary: TeamSummary
}

interface IntegrationRouteData {
  integrations: readonly IntegrationViewModel[]
  apiKeys: readonly ApiKeyViewModel[]
  auditEntries: readonly AuditEntry[]
  monitors: readonly MonitorViewModel[]
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function frontendRole(role: Role): TeamRole {
  if (role === 'viewer') return 'reader'
  if (role === 'notifier') return 'notify-only'
  return role
}

function backendRole(role: Exclude<TeamRole, 'owner'>): Exclude<Role, 'owner'> {
  if (role === 'reader') return 'viewer'
  if (role === 'notify-only') return 'notifier'
  return role
}

function backendMemberPatch(patch: TeamMemberPatch): MembershipPatch {
  return {
    ...(patch.role ? { role: backendRole(patch.role) } : {}),
    ...(patch.status
      ? { status: patch.status === 'suspended' ? 'disabled' : patch.status }
      : {}),
  }
}

function teamDetails(workspace: Workspace, notificationEmail: string): TeamDetails {
  return {
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    notificationEmail,
  }
}

function summarizeTeam(
  members: readonly TeamMemberViewModel[],
  seatsTotal: number,
  planName: string,
): TeamSummary {
  const seated = members.filter((member) => member.status !== 'suspended')
  const notifySeatsUsed = seated.filter((member) => member.role === 'notify-only').length
  const loginSeatsUsed = seated.length - notifySeatsUsed
  return {
    seatsUsed: seated.length,
    seatsTotal: Math.max(seatsTotal, seated.length),
    loginSeatsUsed,
    notifySeatsUsed,
    planName,
  }
}

function invitedMember(invitation: Invitation): TeamMemberViewModel {
  const email = invitation.email.trim().toLowerCase()
  const localPart = email.split('@')[0] || 'Invited member'
  const name = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ') || 'Invited member'
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?'

  return {
    id: invitation.id,
    name,
    email,
    initials,
    role: frontendRole(invitation.role),
    twoFactorEnabled: false,
    status: invitation.accepted_at ? 'active' : 'invited',
    isCurrentUser: false,
    joinedAt: invitation.created_at,
    ...(invitation.phone?.trim() ? { phone: invitation.phone.trim() } : {}),
  }
}

function cleanConfigValue(config: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = config[key]?.trim()
  return value || undefined
}

function integrationConfig(
  type: IntegrationType,
  config: Readonly<Record<string, string>>,
): IntegrationConfigInput | undefined {
  const value = (key: string) => cleanConfigValue(config, key)

  switch (type) {
    case 'slack':
    case 'microsoft_teams':
    case 'discord':
    case 'google_chat': {
      const url = value('url')
      return url ? { url } : undefined
    }
    case 'webhook': {
      const url = value('url')
      const signingSecret = value('signing_secret')
      const customValue = value('custom_value')
      const headerName = value('header_name')
      const headerValue = value('header_value')
      if (!url && !signingSecret && !customValue && !(headerName && headerValue)) return undefined
      return {
        ...(url ? { url } : {}),
        ...(signingSecret ? { signing_secret: signingSecret } : {}),
        ...(customValue ? { custom_value: customValue } : {}),
        ...(headerName && headerValue ? { headers: { [headerName]: headerValue } } : {}),
      } as IntegrationConfigInput
    }
    case 'telegram': {
      const botToken = value('bot_token')
      const chatId = value('chat_id')
      return botToken && chatId ? { bot_token: botToken, chat_id: chatId } : undefined
    }
    case 'pagerduty': {
      const routingKey = value('routing_key')
      return routingKey ? { routing_key: routingKey } : undefined
    }
    case 'opsgenie': {
      const apiKey = value('api_key')
      const region = value('region')
      return apiKey ? { api_key: apiKey, ...(region ? { region } : {}) } : undefined
    }
    case 'pushover': {
      const apiToken = value('api_token')
      const userKey = value('user_key')
      const device = value('device')
      return apiToken && userKey
        ? { api_token: apiToken, user_key: userKey, ...(device ? { device } : {}) }
        : undefined
    }
    case 'pushbullet': {
      const accessToken = value('access_token')
      return accessToken ? { access_token: accessToken } : undefined
    }
    case 'email': {
      const recipients = uniqueNonEmpty((value('recipients') ?? '').split(','))
      return recipients.length > 0 ? { to: recipients } : undefined
    }
    case 'sms':
    case 'voice': {
      const accountSid = value('account_sid')
      const authToken = value('auth_token')
      const from = value('from')
      const to = value('to')
      return accountSid && authToken && from && to
        ? { account_sid: accountSid, auth_token: authToken, from, to }
        : undefined
    }
  }
}

function safeEvents(events: readonly IntegrationEvent[]): ApiIntegrationEvent[] {
  return uniqueNonEmpty(events).filter((event): event is ApiIntegrationEvent =>
    integrationEvents.has(event as ApiIntegrationEvent),
  )
}

function integrationCreatePayload(input: IntegrationInput): IntegrationCreateRequest {
  const config = integrationConfig(input.type, input.config)
  if (!config) throw new Error('Complete the integration provider configuration.')
  const events = safeEvents(input.events)
  if (events.length === 0) throw new Error('Choose at least one supported event.')
  return {
    name: input.name.trim(),
    type: input.type,
    events,
    monitor_ids: uniqueNonEmpty(input.monitorIds),
    active: input.active,
    config,
  }
}

function integrationUpdatePayload(input: IntegrationInput): IntegrationUpdateRequest {
  const events = safeEvents(input.events)
  if (events.length === 0) throw new Error('Choose at least one supported event.')
  const config = integrationConfig(input.type, input.config)
  return {
    name: input.name.trim(),
    type: input.type,
    events,
    monitor_ids: uniqueNonEmpty(input.monitorIds),
    active: input.active,
    ...(config ? { config } : {}),
  }
}

function apiKeyPayload(input: ApiKeyCreateInput): APIKeyRequest {
  const requested = uniqueNonEmpty(input.scopes).filter((scope): scope is APIKeyScope =>
    apiKeyScopes.has(scope as APIKeyScope),
  )

  let scopes: APIKeyScope[]
  if (input.kind === 'monitor-specific') {
    if (!input.monitorId?.trim()) throw new Error('Choose a monitor for this API key.')
    scopes = ['monitors:read']
  } else if (input.kind === 'read-only') {
    scopes = requested.filter((scope) => scope === 'read' || scope.endsWith(':read'))
    if (scopes.length === 0) scopes = ['read']
  } else {
    scopes = requested
    if (!scopes.some((scope) => scope === 'write' || scope.endsWith(':write'))) {
      throw new Error('Main API keys require at least one write scope.')
    }
  }

  return {
    name: input.name.trim(),
    scopes,
    ...(input.kind === 'monitor-specific' ? { monitor_id: input.monitorId?.trim() } : {}),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
  }
}

function keyViewModel(key: APIKey, monitors: readonly MonitorViewModel[]): ApiKeyViewModel {
  const monitor = key.monitor_id
    ? monitors.find((candidate) => candidate.id === key.monitor_id)
    : undefined
  return toApiKeyViewModel(key, {
    ...(monitor ? { monitor: { id: monitor.id, name: monitor.name } } : {}),
  })
}

interface RouteStateProps {
  label: string
  error?: Error
  onRetry?: () => void
}

function RouteState({ label, error, onRetry }: RouteStateProps) {
  if (!error) {
    return (
      <div className="page page--wide account-page">
        <PageLoadingSkeleton label={`Loading ${label}`} />
      </div>
    )
  }
  return (
    <div className="page account-page" aria-live="polite">
      <Panel>
        <div className="panel__body">
          <h1>Unable to load {label}</h1>
          <p role="alert">{error.message}</p>
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
        </div>
      </Panel>
    </div>
  )
}

export function LiveTeamPage() {
  const { api, logout, user, workspace } = useAuth()
  const demo = isDemoSession()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState<TeamRouteData>>({ status: 'loading' })

  useEffect(() => {
    if (demo || !workspace) return
    let cancelled = false
    setState({ status: 'loading' })

    void Promise.all([
      api.getTenant(workspace.id),
      api.listMembers(workspace.id),
      api.listInvitations(workspace.id),
      api.getBillingSubscription(),
    ])
      .then(([freshWorkspace, response, invitationResponse, subscription]) => {
        if (cancelled) return
        const members = (response.items ?? []).map((membership) =>
          toTeamMemberViewModel(membership, {
            currentUserId: user?.id,
            ...(user && membership.user_id === user.id ? { user } : {}),
          }),
        )
        const pendingInvitations = (invitationResponse.items ?? []).map(invitedMember)
        const team = [...members, ...pendingInvitations]
        setState({
          status: 'ready',
          data: {
            workspace: freshWorkspace,
            members: team,
            summary: summarizeTeam(
              team,
              subscription.plan_snapshot?.limits.max_team_members ?? team.length,
              subscription.plan_snapshot?.name ?? subscription.plan_code,
            ),
          },
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: asError(error, 'Could not load the team.') })
      })

    return () => {
      cancelled = true
    }
  }, [api, attempt, demo, user, workspace])

  const invite = useCallback(async (input: InviteMemberInput) => {
    if (!workspace) throw new Error('No active workspace is available.')
    const result = await api.inviteMember(workspace.id, {
      email: input.email.trim().toLowerCase(),
      role: backendRole(input.role),
      ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    })
    return invitedMember(result.invitation)
  }, [api, workspace])

  const updateMember = useCallback(async (memberId: string, patch: TeamMemberPatch) => {
    if (!workspace) throw new Error('No active workspace is available.')
    const membership = await api.updateMember(workspace.id, memberId, backendMemberPatch(patch))
    return toTeamMemberViewModel(membership, {
      currentUserId: user?.id,
      ...(user && membership.user_id === user.id ? { user } : {}),
    })
  }, [api, user, workspace])

  const updateDetails = useCallback(async (details: TeamDetails) => {
    if (!workspace) throw new Error('No active workspace is available.')
    const updated = await api.updateTenant(workspace.id, {
      name: details.name.trim(),
      slug: details.slug.trim().toLowerCase(),
      timezone: details.timezone,
    })
    return teamDetails(updated, details.notificationEmail.trim())
  }, [api, workspace])

  const setupTwoFactor = useCallback(
    (password: string) => api.setupTwoFactor({ password }),
    [api],
  )

  const confirmTwoFactor = useCallback(
    async (code: string) => (await api.confirmTwoFactor({ code })).recovery_codes,
    [api],
  )

  const disableTwoFactor = useCallback(async (password: string, code: string) => {
    await api.disableTwoFactor({ password, code })
    await logout()
  }, [api, logout])

  const regenerateRecoveryCodes = useCallback(
    async (password: string, code: string) => (
      await api.regenerateRecoveryCodes({ password, code })
    ).recovery_codes,
    [api],
  )

  if (demo) return <TeamPage />
  if (!workspace) return <RouteState label="team" error={new Error('No active workspace is available.')} />
  if (state.status === 'loading') return <RouteState label="team" />
  if (state.status === 'error') {
    return <RouteState label="team" error={state.error} onRetry={() => setAttempt((value) => value + 1)} />
  }

  return (
    <TeamPage
      key={state.data.workspace.id}
      initialMembers={state.data.members}
      initialSummary={state.data.summary}
      initialDetails={teamDetails(state.data.workspace, user?.email ?? '')}
      onInvite={invite}
      onUpdateMember={updateMember}
      onUpdateDetails={updateDetails}
      onSetupTwoFactor={setupTwoFactor}
      onConfirmTwoFactor={confirmTwoFactor}
      onDisableTwoFactor={disableTwoFactor}
      onRegenerateRecoveryCodes={regenerateRecoveryCodes}
      onSecuritySessionEnd={logout}
    />
  )
}

export function LiveIntegrationsPage() {
  const { api, user, workspace } = useAuth()
  const focusMonitorId = new URLSearchParams(window.location.search).get('monitor') ?? undefined
  const demo = isDemoSession()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState<IntegrationRouteData>>({ status: 'loading' })
  const integrationsRef = useRef(new Map<string, IntegrationViewModel>())
  const apiKeysRef = useRef(new Map<string, ApiKeyViewModel>())
  const monitorsRef = useRef<readonly MonitorViewModel[]>([])

  useEffect(() => {
    if (demo || !workspace) return
    let cancelled = false
    setState({ status: 'loading' })

    void Promise.all([
      api.listIntegrations(workspace.id),
      api.listApiKeys(workspace.id),
      api.listAuditLogs(workspace.id, { limit: 100 }),
      api.listMonitors(workspace.id, { limit: 100 }),
    ])
      .then(([integrationResponse, keyResponse, auditResponse, monitorResponse]) => {
        if (cancelled) return
        const monitors = (monitorResponse.items ?? []).map((monitor) => toMonitorViewModel(monitor))
        const integrations = (integrationResponse.items ?? []).map(toIntegrationViewModel)
        const apiKeys = (keyResponse.items ?? []).map((key) => keyViewModel(key, monitors))
        const auditEntries = (auditResponse.items ?? []).map((entry) =>
          toAuditLogViewModel(entry, {
            ...(user ? { actor: { id: user.id, name: user.name, email: user.email } } : {}),
          }),
        )

        monitorsRef.current = monitors
        integrationsRef.current = new Map(integrations.map((integration) => [integration.id, integration]))
        apiKeysRef.current = new Map(apiKeys.map((key) => [key.id, key]))
        setState({ status: 'ready', data: { integrations, apiKeys, auditEntries, monitors } })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: asError(error, 'Could not load integrations and API access.') })
        }
      })

    return () => {
      cancelled = true
    }
  }, [api, attempt, demo, user, workspace])

  const saveIntegration = useCallback(async (input: IntegrationInput, existingId?: string) => {
    if (!workspace) throw new Error('No active workspace is available.')
    const saved = existingId
      ? await api.updateIntegration(workspace.id, existingId, integrationUpdatePayload(input))
      : await api.createIntegration(workspace.id, integrationCreatePayload(input))
    const viewModel = toIntegrationViewModel(saved)
    integrationsRef.current.set(viewModel.id, viewModel)
    return viewModel
  }, [api, workspace])

  const toggleIntegration = useCallback(async (integrationId: string, active: boolean) => {
    if (!workspace) throw new Error('No active workspace is available.')
    const current = integrationsRef.current.get(integrationId)
    if (!current) throw new Error('This integration is no longer available.')
    const saved = await api.updateIntegration(workspace.id, integrationId, {
      events: safeEvents(current.events),
      active,
    })
    const viewModel = toIntegrationViewModel(saved)
    integrationsRef.current.set(viewModel.id, viewModel)
    return viewModel
  }, [api, workspace])

  const deleteIntegration = useCallback(async (integrationId: string) => {
    if (!workspace) throw new Error('No active workspace is available.')
    await api.deleteIntegration(workspace.id, integrationId)
    integrationsRef.current.delete(integrationId)
  }, [api, workspace])

  const createApiKey = useCallback(async (input: ApiKeyCreateInput): Promise<ApiKeyCreateResult> => {
    if (!workspace) throw new Error('No active workspace is available.')
    const result = await api.createApiKey(workspace.id, apiKeyPayload(input))
    const key = keyViewModel(result.api_key, monitorsRef.current)
    apiKeysRef.current.set(key.id, key)
    return { key, secret: result.secret }
  }, [api, workspace])

  const revokeApiKey = useCallback(async (keyId: string) => {
    if (!workspace) throw new Error('No active workspace is available.')
    await api.revokeApiKey(workspace.id, keyId)
    const current = apiKeysRef.current.get(keyId)
    if (!current) return undefined
    const revoked: ApiKeyViewModel = {
      ...current,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    }
    apiKeysRef.current.set(keyId, revoked)
    return revoked
  }, [api, workspace])

  const catalog = useMemo(() => demoIntegrationCatalog, [])

  if (demo) {
    return (
      <IntegrationsPage
        initialIntegrations={demoIntegrations}
        catalog={demoIntegrationCatalog}
        monitors={demoMonitors}
        initialApiKeys={demoApiKeys}
        auditEntries={demoAuditEntries}
        focusMonitorId={focusMonitorId}
      />
    )
  }
  if (!workspace) {
    return <RouteState label="integrations" error={new Error('No active workspace is available.')} />
  }
  if (state.status === 'loading') return <RouteState label="integrations" />
  if (state.status === 'error') {
    return (
      <RouteState
        label="integrations"
        error={state.error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }

  return (
    <IntegrationsPage
      key={workspace.id}
      initialIntegrations={state.data.integrations}
      catalog={catalog}
      monitors={state.data.monitors}
      focusMonitorId={focusMonitorId}
      initialApiKeys={state.data.apiKeys}
      auditEntries={state.data.auditEntries}
      onSaveIntegration={saveIntegration}
      onToggleIntegration={toggleIntegration}
      onDeleteIntegration={deleteIntegration}
      onCreateApiKey={createApiKey}
      onRevokeApiKey={revokeApiKey}
    />
  )
}
