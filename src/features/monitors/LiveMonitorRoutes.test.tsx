import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../../api/client'
import type { CheckResult, HistoryQuery, Monitor, MonitorSubscription, User, Workspace } from '../../api/types'
import type { AuthContextValue } from '../../app/AuthProvider'

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  isDemoSession: vi.fn(),
}))

vi.mock('../../app/AuthProvider', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../app/AuthProvider')>()
  return { ...original, useAuth: authMocks.useAuth }
})

vi.mock('../../app/DashboardGate', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../app/DashboardGate')>()
  return { ...original, isDemoSession: authMocks.isDemoSession }
})

import { LiveMonitorDetailPage, LiveMonitorsPage, loadMonitorCheckHistory } from './LiveMonitorRoutes'

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
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Olivia Owner',
  locale: 'en',
  timezone: 'UTC',
  two_factor_enabled: false,
  system_role: 'user',
  created_at: now,
  updated_at: now,
}

function baseMonitor(): Monitor {
  return {
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
}

function checkResult(id: string, latencyMs: number, startedAt = new Date().toISOString()): CheckResult {
  return {
    id,
    workspace_id: workspace.id,
    monitor_id: 'monitor-1',
    region: 'eu-west',
    status: 'ok',
    latency_ms: latencyMs,
    started_at: startedAt,
    finished_at: startedAt,
  }
}

function followedMonitor(): MonitorSubscription {
  return {
    subscription_id: 'subscription-1',
    page_name: 'Vendor status',
    read_only: true,
    monitor: {
      id: 'shared-monitor-1',
      name: 'Vendor API',
      type: 'http',
      status: 'up',
      target: 'https://vendor.example.com/health',
      interval_seconds: 60,
      timeout_seconds: 10,
      regions: ['eu-west'],
      last_check_at: now,
      paused: false,
    },
    stats: {
      from: now, to: now, availability: 100, average_latency_ms: 120, p50_latency_ms: 100,
      p95_latency_ms: 180, p99_latency_ms: 200, checks: 24, failures: 0, incidents: 0,
      downtime_seconds: 0, mtbf_seconds: 86_400,
    },
    history: [],
    latest: { monitor_id: 'shared-monitor-1', checked_at: now, latency_ms: 120 },
    events: ['monitor.down', 'monitor.up'],
    email_enabled: true,
    integration_ids: [],
  }
}

function fakeApi() {
  let stored = baseMonitor()
  const api = {
    baseUrl: 'https://api.sslping.test',
    listMonitors: vi.fn(async () => ({ items: [stored] })),
    getMetricsSummary: vi.fn().mockResolvedValue({ from: now, to: now, items: [] }),
    listIncidents: vi.fn().mockResolvedValue({ items: [] }),
    listMonitorSubscriptions: vi.fn().mockResolvedValue({ items: [] }),
    listMonitorChecks: vi.fn().mockResolvedValue({ items: [] }),
    getWorkspaceEntitlements: vi.fn().mockResolvedValue({
      plan_code: 'business',
      plan_name: 'Business',
      limits: { max_monitors: 500, min_interval_seconds: 30, max_team_members: 15, max_status_pages: 20, max_integrations: 50, max_locations: 10, data_retention_days: 365, allow_manual_tests: true },
    }),
    listRegions: vi.fn().mockResolvedValue({
      items: [{ id: 'eu-west', name: 'Europe West', capabilities: ['http', 'tcp', 'tls', 'dns', 'domain', 'reachability'], status: 'available' }],
    }),
    createMonitor: vi.fn(),
    rotateHeartbeatToken: vi.fn(),
    pauseMonitor: vi.fn(async () => {
      stored = { ...stored, status: 'paused', paused: true }
      return stored
    }),
    resumeMonitor: vi.fn(async () => {
      stored = { ...stored, status: 'pending', paused: false }
      return stored
    }),
    testMonitor: vi.fn().mockResolvedValue(undefined),
    deleteMonitor: vi.fn().mockResolvedValue(undefined),
    deleteMonitorSubscription: vi.fn().mockResolvedValue(undefined),
    updateMonitor: vi.fn(async (_workspaceId: string, _monitorId: string, request: Record<string, unknown>) => {
      stored = { ...stored, ...request, tags: request.tags as string[] ?? stored.tags }
      return stored
    }),
  }
  return api
}

function mockAuth(api: ReturnType<typeof fakeApi>) {
  authMocks.useAuth.mockReturnValue({
    api: api as unknown as ApiClient,
    user,
    workspace,
    tenant: workspace,
    tenants: [workspace],
    authenticated: true,
    loading: false,
  } as AuthContextValue)
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Checkout API' }))
  return screen.getByRole('menu', { name: 'Actions for Checkout API' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.isDemoSession.mockReturnValue(false)
})

describe('monitor check-history pagination', () => {
  it('loads every cursor page in the requested time range', async () => {
    const first = checkResult('check-1', 100)
    const second = checkResult('check-2', 300)
    const listMonitorChecks = vi.fn(async (_workspaceId: string, _monitorId: string, query?: HistoryQuery) => (
      query?.cursor === 'next-page'
        ? { items: [second] }
        : { items: [first], next_cursor: 'next-page' }
    ))
    const query = { from: '2026-07-25T08:00:00.000Z', to: '2026-07-26T08:00:00.000Z' }

    await expect(loadMonitorCheckHistory(
      { listMonitorChecks } as unknown as Pick<ApiClient, 'listMonitorChecks'>,
      workspace.id,
      'monitor-1',
      query,
    )).resolves.toEqual([first, second])

    expect(listMonitorChecks).toHaveBeenNthCalledWith(1, workspace.id, 'monitor-1', { ...query, limit: 250, cursor: undefined })
    expect(listMonitorChecks).toHaveBeenNthCalledWith(2, workspace.id, 'monitor-1', { ...query, limit: 250, cursor: 'next-page' })
  })

  it('fails explicitly instead of silently truncating or looping forever', async () => {
    const overLimit = vi.fn().mockResolvedValue({ items: [checkResult('check-1', 100), checkResult('check-2', 200)] })
    await expect(loadMonitorCheckHistory(
      { listMonitorChecks: overLimit } as unknown as Pick<ApiClient, 'listMonitorChecks'>,
      workspace.id,
      'monitor-1',
      {},
      { maxItems: 1 },
    )).rejects.toThrow(/too large to display safely/i)

    const repeatedCursor = vi.fn()
      .mockResolvedValueOnce({ items: [], next_cursor: 'same-page' })
      .mockResolvedValueOnce({ items: [], next_cursor: 'same-page' })
    await expect(loadMonitorCheckHistory(
      { listMonitorChecks: repeatedCursor } as unknown as Pick<ApiClient, 'listMonitorChecks'>,
      workspace.id,
      'monitor-1',
      {},
    )).rejects.toThrow(/repeated check-history cursor/i)
  })
})

describe('LiveMonitorsPage controls', () => {
  it('loads followed monitors in one extra list request and unsubscribes by subscription id', async () => {
    const api = fakeApi()
    api.listMonitorSubscriptions.mockResolvedValue({ items: [followedMonitor()] })
    mockAuth(api)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)

    expect(await screen.findByText('Vendor API')).toBeInTheDocument()
    expect(api.listMonitorSubscriptions).toHaveBeenCalledTimes(1)
    expect(api.listMonitorSubscriptions).toHaveBeenCalledWith(workspace.id)
    expect(screen.queryByRole('checkbox', { name: 'Select Vendor API' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Vendor API' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Actions for Vendor API' })).getByRole('menuitem', { name: 'Stop following' }))

    await waitFor(() => expect(api.deleteMonitorSubscription).toHaveBeenCalledWith(workspace.id, 'subscription-1'))
  })

  it('renders the new-workspace empty state when list endpoints return null items', async () => {
    const api = fakeApi()
    api.listMonitors.mockResolvedValue({ items: null as never })
    api.getMetricsSummary.mockResolvedValue({ from: now, to: now, items: null as never })
    api.listIncidents.mockResolvedValue({ items: null as never })
    mockAuth(api)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)

    expect(await screen.findByText('No monitors found')).toBeInTheDocument()
    expect(screen.getByText('Try another filter or create a new monitor.')).toBeInTheDocument()
    expect(api.listMonitorChecks).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('connects pause, resume, test and delete menu actions to the active workspace API', async () => {
    const api = fakeApi()
    mockAuth(api)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)
    expect(await screen.findByText('Checkout API')).toBeInTheDocument()
    expect(api.listMonitorChecks).not.toHaveBeenCalled()

    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /pause/i }))
    await waitFor(() => expect(api.pauseMonitor).toHaveBeenCalledWith(workspace.id, 'monitor-1'))
    await screen.findByText('paused')
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /resume/i }))
    await waitFor(() => expect(api.resumeMonitor).toHaveBeenCalledWith(workspace.id, 'monitor-1'))

    await screen.findByText('pending')
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /test now/i }))
    await waitFor(() => expect(api.testMonitor).toHaveBeenCalledWith(workspace.id, 'monitor-1'))

    await screen.findByText('Test completed for Checkout API.')
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /delete/i }))
    await waitFor(() => expect(api.deleteMonitor).toHaveBeenCalledWith(workspace.id, 'monitor-1'))
    expect(window.confirm).toHaveBeenCalledWith('Delete “Checkout API”? This cannot be undone.')
    expect(api.listMonitors.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('hides manual test actions when the active plan does not include them', async () => {
    const api = fakeApi()
    api.getWorkspaceEntitlements.mockResolvedValue({
      plan_code: 'starter',
      plan_name: 'Starter',
      limits: { max_monitors: 100, min_interval_seconds: 60, max_team_members: 3, max_status_pages: 3, max_integrations: 10, max_locations: 3, data_retention_days: 90, allow_manual_tests: false },
    })
    mockAuth(api)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)
    expect(await screen.findByText('Checkout API')).toBeInTheDocument()
    expect(within(openMenu()).queryByRole('menuitem', { name: /test now/i })).not.toBeInTheDocument()
    expect(api.testMonitor).not.toHaveBeenCalled()
  })

  it('shows the full one-time URL returned when a heartbeat monitor is created', async () => {
    const api = fakeApi()
    const monitor: Monitor = {
      ...baseMonitor(),
      id: 'heartbeat-1',
      name: 'Nightly backup',
      type: 'heartbeat',
      status: 'pending',
      config: { heartbeat: { period_seconds: 86_400, grace_seconds: 300 } },
    }
    api.createMonitor.mockResolvedValue({
      monitor,
      heartbeat_token: 'one-time-secret',
      heartbeat_url: '/v1/heartbeat/one-time-secret',
    })
    mockAuth(api)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)
    await screen.findByText('Checkout API')
    fireEvent.click(screen.getByRole('button', { name: /new monitor/i }))
    const createDialog = screen.getByRole('dialog', { name: /create monitor/i })
    fireEvent.click(within(createDialog).getByRole('button', { name: /heartbeat/i }))
    fireEvent.change(within(createDialog).getByPlaceholderText('Heartbeat monitor'), { target: { value: 'Nightly backup' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create monitor' }))

    await waitFor(() => expect(api.createMonitor).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({ type: 'heartbeat', name: 'Nightly backup' }),
    ))
    expect(await screen.findByRole('dialog', { name: /heartbeat is ready/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Heartbeat URL' }))
      .toHaveValue('https://api.sslping.test/v1/heartbeat/one-time-secret')
    expect(api.rotateHeartbeatToken).not.toHaveBeenCalled()
  })

  it('keeps demo actions local without touching a monitor endpoint', async () => {
    const api = fakeApi()
    authMocks.isDemoSession.mockReturnValue(true)
    mockAuth(api)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)
    expect(await screen.findByText('Marketing website')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Marketing website' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Actions for Marketing website' })).getByRole('menuitem', { name: /pause/i }))

    expect(await screen.findByText('Paused Marketing website.')).toBeInTheDocument()
    expect(api.pauseMonitor).not.toHaveBeenCalled()
    expect(api.listMonitors).not.toHaveBeenCalled()
  })

  it('applies bulk tag updates through the monitor API', async () => {
    const api = fakeApi()
    mockAuth(api)
    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)

    expect(await screen.findByText('Checkout API')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Checkout API' }))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk monitor actions' })).getByRole('button', { name: /manage tags/i }))
    const dialog = screen.getByRole('dialog', { name: /manage tags/i })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search bulk tags' }), { target: { value: 'critical' } })
    fireEvent.click(within(dialog).getByRole('option', { name: /create “critical”/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply bulk tag changes' }))

    await waitFor(() => expect(api.updateMonitor).toHaveBeenCalledWith(
      workspace.id,
      'monitor-1',
      expect.objectContaining({ tags: ['production', 'critical'] }),
    ))
  })
})

describe('LiveMonitorDetailPage refresh', () => {
  it('uses all paginated checks for the 24-hour bars and response chart', async () => {
    const api = fakeApi()
    const monitor = {
      ...baseMonitor(),
      last_check_at: new Date().toISOString(),
    }
    const first = checkResult('check-page-1', 100, new Date(Date.now() - 30_000).toISOString())
    const second = checkResult('check-page-2', 300, new Date(Date.now() - 15_000).toISOString())
    const listMonitorChecks = vi.fn(async (_workspaceId: string, _monitorId: string, query?: HistoryQuery) => (
      query?.cursor === 'next-page'
        ? { items: [second] }
        : { items: [first], next_cursor: 'next-page' }
    ))
    Object.assign(api, {
      getMonitor: vi.fn().mockResolvedValue(monitor),
      listMonitorChecks,
      getMonitorMetrics: vi.fn().mockResolvedValue({ availability: 100, incidents: 0, downtime_seconds: 0 }),
      listCertificateEvidence: vi.fn().mockResolvedValue({ items: [] }),
      listDnsEvidence: vi.fn().mockResolvedValue({ items: [] }),
      listDomainEvidence: vi.fn().mockResolvedValue({ items: [] }),
      listMaintenanceWindows: vi.fn().mockResolvedValue({ items: [] }),
      listIntegrations: vi.fn().mockResolvedValue({ items: [] }),
      listStatusPages: vi.fn().mockResolvedValue({ items: [] }),
      listStatusPageComponents: vi.fn().mockResolvedValue({ items: [] }),
    })
    mockAuth(api)

    render(
      <MemoryRouter initialEntries={['/monitors/monitor-1']}>
        <Routes><Route path="/monitors/:monitorId" element={<LiveMonitorDetailPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Checkout API')).toBeInTheDocument()
    await waitFor(() => expect(listMonitorChecks).toHaveBeenCalledWith(
      workspace.id,
      'monitor-1',
      expect.objectContaining({ cursor: 'next-page', limit: 250 }),
    ))
    expect(await screen.findByText('200 ms')).toBeInTheDocument()
  })

  it('reloads monitor data after the configured check interval has elapsed', async () => {
    const api = fakeApi()
    const monitor = {
      ...baseMonitor(),
      last_check_at: new Date(Date.now() - 61_000).toISOString(),
    }
    const getMonitor = vi.fn().mockResolvedValue(monitor)
    Object.assign(api, {
      getMonitor,
      getMonitorMetrics: vi.fn().mockResolvedValue({ availability: 100, incidents: 0, downtime_seconds: 0 }),
      listCertificateEvidence: vi.fn().mockResolvedValue({ items: [] }),
      listDnsEvidence: vi.fn().mockResolvedValue({ items: [] }),
      listDomainEvidence: vi.fn().mockResolvedValue({ items: [] }),
      listMaintenanceWindows: vi.fn().mockResolvedValue({ items: [] }),
      listIntegrations: vi.fn().mockResolvedValue({ items: [] }),
      listStatusPages: vi.fn().mockResolvedValue({ items: [] }),
      listStatusPageComponents: vi.fn().mockResolvedValue({ items: [] }),
    })
    mockAuth(api)

    render(
      <MemoryRouter initialEntries={['/monitors/monitor-1']}>
        <Routes><Route path="/monitors/:monitorId" element={<LiveMonitorDetailPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Checkout API')).toBeInTheDocument()
    await waitFor(() => expect(getMonitor).toHaveBeenCalledTimes(2), { timeout: 2500 })
    expect(screen.getByText(/refreshing from backend|checked every/i)).toBeInTheDocument()
  })
})
