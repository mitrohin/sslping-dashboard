import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../../api/client'
import type { Monitor, User, Workspace } from '../../api/types'
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

import { LiveMonitorsPage } from './LiveMonitorRoutes'

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

function fakeApi() {
  let stored = baseMonitor()
  const api = {
    listMonitors: vi.fn(async () => ({ items: [stored] })),
    getMetricsSummary: vi.fn().mockResolvedValue({ from: now, to: now, items: [] }),
    listIncidents: vi.fn().mockResolvedValue({ items: [] }),
    listMonitorChecks: vi.fn().mockResolvedValue({ items: [] }),
    createMonitor: vi.fn(),
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

describe('LiveMonitorsPage controls', () => {
  it('connects pause, resume, test and delete menu actions to the active workspace API', async () => {
    const api = fakeApi()
    mockAuth(api)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MemoryRouter><LiveMonitorsPage /></MemoryRouter>)
    expect(await screen.findByText('Checkout API')).toBeInTheDocument()

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
})
