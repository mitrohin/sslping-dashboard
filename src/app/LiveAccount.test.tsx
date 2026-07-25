import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/client'
import type {
  APIKey,
  AuditLog,
  Integration,
  Invitation,
  Membership,
  Monitor,
  User,
  Workspace,
} from '../api/types'
import type { AuthContextValue } from './AuthProvider'

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  isDemoSession: vi.fn(),
}))

vi.mock('./AuthProvider', async (importOriginal) => {
  const original = await importOriginal<typeof import('./AuthProvider')>()
  return { ...original, useAuth: authMocks.useAuth }
})

vi.mock('./DashboardGate', async (importOriginal) => {
  const original = await importOriginal<typeof import('./DashboardGate')>()
  return { ...original, isDemoSession: authMocks.isDemoSession }
})

import { LiveIntegrationsPage, LiveTeamPage } from './LiveAccount'

const now = '2026-07-26T08:00:00.000Z'

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Acme production',
  slug: 'acme-production',
  plan: 'team',
  timezone: 'UTC',
  created_at: now,
  updated_at: now,
}

const user: User = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olivia Owner',
  locale: 'en',
  timezone: 'UTC',
  two_factor_enabled: true,
  created_at: now,
  updated_at: now,
}

function membership(
  id: string,
  name: string,
  email: string,
  role: Membership['role'],
  status: Membership['status'] = 'active',
): Membership {
  return {
    workspace_id: workspace.id,
    user_id: id,
    role,
    status,
    created_at: now,
    updated_at: now,
    user: {
      ...user,
      id,
      name,
      email,
      two_factor_enabled: id === user.id,
    },
  }
}

const ownerMembership = membership(user.id, user.name, user.email, 'owner')
const viewerMembership = membership('user-viewer', 'Rita Reader', 'reader@example.com', 'viewer')
const notifierMembership = membership('user-notifier', 'Nina Notifier', 'notify@example.com', 'notifier')

const monitor: Monitor = {
  id: 'monitor-1',
  workspace_id: workspace.id,
  name: 'Checkout API',
  type: 'http',
  status: 'up',
  config: { http: { url: 'https://checkout.example.com/health' } },
  interval_seconds: 60,
  timeout_seconds: 10,
  regions: ['eu-west'],
  tags: ['production'],
  group_name: 'APIs',
  retry_policy: {
    failure_threshold: 2,
    recovery_threshold: 2,
    confirmation_delay_seconds: 0,
  },
  paused: false,
  next_check_at: now,
  consecutive_failures: 0,
  consecutive_recoveries: 3,
  created_at: now,
  updated_at: now,
}

const storedIntegration: Integration = {
  id: 'integration-1',
  workspace_id: workspace.id,
  name: 'Production Slack',
  type: 'slack',
  events: ['monitor.down', 'monitor.up'],
  monitor_ids: [],
  active: true,
  config: {
    configured: true,
    endpoint_host: 'hooks.slack.com',
    signing_secret: 'must-never-reach-the-view',
  },
  created_at: now,
  updated_at: now,
}

const storedKey: APIKey = {
  id: 'key-1',
  workspace_id: workspace.id,
  name: 'Read reports',
  prefix: 'sp_live_reports',
  scopes: ['read'],
  created_by: user.id,
  created_at: now,
}

const auditLog: AuditLog = {
  id: 'audit-1',
  workspace_id: workspace.id,
  actor_id: user.id,
  action: 'integration.updated',
  resource: 'integration',
  resource_id: storedIntegration.id,
  ip: '203.0.113.10',
  metadata: { target: 'Production Slack', outcome: 'success' },
  created_at: now,
}

function fakeApi() {
  return {
    getTenant: vi.fn().mockResolvedValue(workspace),
    listMembers: vi.fn().mockResolvedValue({
      items: [ownerMembership, viewerMembership, notifierMembership],
    }),
    inviteMember: vi.fn(),
    updateMember: vi.fn(),
    updateTenant: vi.fn(),
    listIntegrations: vi.fn().mockResolvedValue({ items: [storedIntegration] }),
    createIntegration: vi.fn(),
    updateIntegration: vi.fn(),
    deleteIntegration: vi.fn().mockResolvedValue(undefined),
    listApiKeys: vi.fn().mockResolvedValue({ items: [storedKey] }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn().mockResolvedValue(undefined),
    listAuditLogs: vi.fn().mockResolvedValue({ items: [auditLog] }),
    listMonitors: vi.fn().mockResolvedValue({ items: [monitor] }),
  }
}

function mockAuth(api: ReturnType<typeof fakeApi>, overrides: Partial<AuthContextValue> = {}) {
  authMocks.useAuth.mockReturnValue({
    api: api as unknown as ApiClient,
    user,
    workspace,
    tenant: workspace,
    ...overrides,
  } as AuthContextValue)
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.isDemoSession.mockReturnValue(false)
})

describe('LiveTeamPage', () => {
  it('keeps demo data local and never calls an account endpoint', async () => {
    const api = fakeApi()
    authMocks.isDemoSession.mockReturnValue(true)
    mockAuth(api, { user: null, workspace: null, tenant: null })

    render(<LiveTeamPage />)

    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    await Promise.resolve()
    for (const method of Object.values(api)) expect(method).not.toHaveBeenCalled()
  })

  it('loads members, maps roles in both directions, and never exposes invitation tokens', async () => {
    const api = fakeApi()
    const invitation: Invitation = {
      id: 'invitation-1',
      workspace_id: workspace.id,
      email: 'new.reader@example.com',
      role: 'viewer',
      invited_by: user.id,
      expires_at: '2026-08-02T08:00:00.000Z',
      created_at: now,
    }
    api.inviteMember.mockResolvedValue({
      invitation,
      invite_token: 'private-invitation-token',
    })
    api.updateMember.mockResolvedValue({ ...viewerMembership, role: 'notifier' })
    mockAuth(api)

    render(<LiveTeamPage />)

    expect(await screen.findByText('Rita Reader')).toBeInTheDocument()
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(screen.getByText('Notify only')).toBeInTheDocument()
    expect(api.getTenant).toHaveBeenCalledWith(workspace.id)
    expect(api.listMembers).toHaveBeenCalledWith(workspace.id)

    fireEvent.click(screen.getByRole('button', { name: /invite team member/i }))
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'NEW.READER@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }))

    await waitFor(() => expect(api.inviteMember).toHaveBeenCalledWith(workspace.id, {
      email: 'new.reader@example.com',
      role: 'viewer',
    }))
    await waitFor(() => expect(screen.getByText('new.reader@example.com')).toBeInTheDocument())
    expect(document.body).not.toHaveTextContent('private-invitation-token')

    fireEvent.click(screen.getByRole('button', { name: /edit rita reader/i }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'notify-only' } })
    fireEvent.click(screen.getByRole('button', { name: /update access/i }))

    await waitFor(() => expect(api.updateMember).toHaveBeenCalledWith(
      workspace.id,
      viewerMembership.user_id,
      { role: 'notifier' },
    ))
  })

  it('updates only supported workspace fields while preserving the notice address locally', async () => {
    const api = fakeApi()
    api.updateTenant.mockImplementation(async (_workspaceId: string, patch: Partial<Workspace>) => ({
      ...workspace,
      ...patch,
      updated_at: '2026-07-26T09:00:00.000Z',
    }))
    mockAuth(api)
    render(<LiveTeamPage />)

    await screen.findByText('Rita Reader')
    fireEvent.click(screen.getByRole('button', { name: /team details/i }))
    fireEvent.change(screen.getByLabelText(/workspace name/i), { target: { value: 'Acme Global' } })
    fireEvent.change(screen.getByLabelText(/workspace slug/i), { target: { value: 'acme-global' } })
    fireEvent.change(screen.getByLabelText(/notification email/i), { target: { value: 'ops@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(api.updateTenant).toHaveBeenCalledWith(workspace.id, {
      name: 'Acme Global',
      slug: 'acme-global',
      timezone: 'UTC',
    }))
    expect(screen.getByLabelText(/notification email/i)).toHaveValue('ops@example.com')
  })
})

describe('LiveIntegrationsPage', () => {
  it('keeps the existing demo integration defaults without hitting live endpoints', async () => {
    const api = fakeApi()
    authMocks.isDemoSession.mockReturnValue(true)
    mockAuth(api, { user: null, workspace: null, tenant: null })

    render(<LiveIntegrationsPage />)

    expect(screen.getAllByText('Production alerts').length).toBeGreaterThan(0)
    await Promise.resolve()
    for (const method of Object.values(api)) expect(method).not.toHaveBeenCalled()
  })

  it('loads all account resources and maps audit data without rendering stored secrets', async () => {
    const api = fakeApi()
    mockAuth(api)
    render(<LiveIntegrationsPage />)

    expect((await screen.findAllByText('Production Slack')).length).toBeGreaterThan(0)
    expect(screen.getByText('hooks.slack.com')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('must-never-reach-the-view')
    expect(api.listIntegrations).toHaveBeenCalledWith(workspace.id)
    expect(api.listApiKeys).toHaveBeenCalledWith(workspace.id)
    expect(api.listAuditLogs).toHaveBeenCalledWith(workspace.id, { limit: 100 })
    expect(api.listMonitors).toHaveBeenCalledWith(workspace.id, { limit: 100 })

    fireEvent.click(screen.getByRole('tab', { name: 'Audit log' }))
    expect(screen.getByText('integration · updated')).toBeInTheDocument()
    expect(screen.getByText(user.email)).toBeInTheDocument()
  })

  it('creates provider-specific payloads and only uses sanitized response configuration', async () => {
    const api = fakeApi()
    api.createIntegration.mockImplementation(async (_workspaceId: string, input: Integration) => ({
      ...storedIntegration,
      id: 'integration-created',
      name: input.name,
      events: input.events,
      active: input.active,
      config: { configured: true, endpoint_host: 'hooks.slack.com' },
    }))
    mockAuth(api)
    render(<LiveIntegrationsPage />)

    await screen.findAllByText('Production Slack')
    const slackCard = screen.getByRole('heading', { name: 'Slack' }).closest('section')
    expect(slackCard).not.toBeNull()
    fireEvent.click(within(slackCard as HTMLElement).getByRole('button', { name: /add/i }))
    fireEvent.change(screen.getByLabelText(/friendly name/i), { target: { value: 'Release alerts' } })
    fireEvent.change(screen.getByLabelText(/slack webhook url/i), {
      target: { value: 'https://hooks.slack.com/services/private-value' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create integration/i }))

    await waitFor(() => expect(api.createIntegration).toHaveBeenCalledWith(workspace.id, {
      name: 'Release alerts',
      type: 'slack',
      events: ['monitor.down', 'monitor.up'],
      monitor_ids: [],
      active: true,
      config: { url: 'https://hooks.slack.com/services/private-value' },
    }))
    await waitFor(() => expect(screen.getByText('Release alerts')).toBeInTheDocument())
    expect(document.body).not.toHaveTextContent('private-value')
  })

  it('creates monitor-specific keys with least-privilege scopes and exposes the secret once', async () => {
    const api = fakeApi()
    api.createApiKey.mockImplementation(async (_workspaceId: string, input: APIKey) => ({
      api_key: {
        ...storedKey,
        id: 'key-created',
        name: input.name,
        scopes: input.scopes,
        monitor_id: input.monitor_id,
        prefix: 'sp_live_created',
      },
      secret: 'sp_live_one_time_secret',
    }))
    mockAuth(api)
    render(<LiveIntegrationsPage />)

    await screen.findAllByText('Production Slack')
    fireEvent.click(screen.getByRole('tab', { name: 'API keys' }))
    fireEvent.click(screen.getByRole('button', { name: /create api key/i }))
    fireEvent.change(screen.getByLabelText(/friendly name/i), { target: { value: 'Public widget' } })
    fireEvent.change(screen.getByLabelText(/key type/i), { target: { value: 'monitor-specific' } })
    const keyDialog = screen.getByRole('dialog')
    const keySelects = within(keyDialog).getAllByRole('combobox')
    fireEvent.change(keySelects[1], { target: { value: monitor.id } })
    fireEvent.click(within(keyDialog).getByRole('button', { name: /^create api key$/i }))

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledWith(workspace.id, {
      name: 'Public widget',
      scopes: ['monitors:read'],
      monitor_id: monitor.id,
    }))
    const secret = await screen.findByLabelText(/api key secret/i)
    expect(secret).toHaveValue('sp_live_one_time_secret')
    expect(screen.getByText('Checkout API')).toBeInTheDocument()
  })
})
