import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Integration, MonitorSubscriptionDetail } from '../../api/types'

const mocks = vi.hoisted(() => ({
  workspace: { id: 'workspace-1', name: 'My workspace' },
  workspaceRole: 'editor',
}))

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({ workspace: mocks.workspace, workspaceRole: mocks.workspaceRole, api: {} }),
}))

import { SubscribedMonitorDetailPage } from './SubscribedMonitorDetailPage'

const now = '2026-08-05T10:00:00.000Z'

function detail(): MonitorSubscriptionDetail {
  const stats = {
    from: '2026-08-04T10:00:00.000Z', to: now, availability: 99.9, average_latency_ms: 120,
    p50_latency_ms: 100, p95_latency_ms: 180, p99_latency_ms: 210, checks: 24, failures: 1,
    incidents: 1, downtime_seconds: 86, mtbf_seconds: 80_000,
  }
  const history = [{
    monitor_id: 'shared-monitor-1', at: now, region: 'eu-west', status: 'ok' as const,
    latency_sum_ms: 120, samples: 1,
  }]
  return {
    item: {
      subscription_id: 'subscription-1',
      page_name: 'Vendor status',
      read_only: true,
      monitor: {
        id: 'shared-monitor-1', name: 'Vendor API', type: 'http', status: 'up',
        target: 'https://vendor.example.com/health', interval_seconds: 60, timeout_seconds: 10,
        regions: ['eu-west'], last_check_at: now, paused: false,
      },
      stats,
      history,
      latest: { monitor_id: 'shared-monitor-1', checked_at: now, latency_ms: 120 },
      events: ['monitor.down', 'monitor.up'],
      email_enabled: true,
      integration_ids: [],
    },
    periods: [{ period: '24h', stats }],
    history,
    incidents: [{
      id: 'incident-1', subscription_id: 'subscription-1', monitor_id: 'shared-monitor-1',
      monitor_name: 'Vendor API', monitor_type: 'http', status: 'investigating',
      title: 'Vendor API is unavailable', root_cause: 'Public upstream outage',
      started_at: now, read_only: true,
    }],
  }
}

const integration: Integration = {
  id: 'integration-1',
  workspace_id: 'workspace-1',
  name: 'Slack incidents',
  type: 'slack',
  events: ['monitor.down'],
  active: true,
  created_at: now,
  updated_at: now,
}

function api() {
  return {
    getMonitorSubscription: vi.fn().mockResolvedValue(detail()),
    listIntegrations: vi.fn().mockResolvedValue({ items: [integration] }),
    updateMonitorSubscriptionNotifications: vi.fn().mockResolvedValue(undefined),
    deleteMonitorSubscription: vi.fn().mockResolvedValue(undefined),
  }
}

function renderPage(client: ReturnType<typeof api>) {
  return render(
    <MemoryRouter initialEntries={['/monitors/followed/subscription-1']}>
      <Routes>
        <Route path="/monitors/followed/:subscriptionId" element={<SubscribedMonitorDetailPage api={client} />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspaceRole = 'editor'
})
afterEach(cleanup)

describe('SubscribedMonitorDetailPage', () => {
  it('keeps personal notification settings editable for viewers but disables shared integrations', async () => {
    mocks.workspaceRole = 'viewer'
    const client = api()
    renderPage(client)

    expect(await screen.findByText(/workspace integrations can be assigned/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /slack incidents/i })).not.toBeInTheDocument()
    expect(client.listIntegrations).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Email notifications' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Response became slow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(client.updateMonitorSubscriptionNotifications).toHaveBeenCalled())
    const payload = client.updateMonitorSubscriptionNotifications.mock.calls[0][2]
    expect(payload).toEqual({
      events: ['monitor.down', 'monitor.up', 'monitor.slow'],
      email_enabled: true,
    })
    expect(payload).not.toHaveProperty('integration_ids')
  })

  it('renders only safe monitor data and saves subscriber-owned notification settings', async () => {
    const client = api()
    renderPage(client)

    expect(await screen.findByRole('heading', { name: /vendor api/i })).toBeInTheDocument()
    expect(screen.getByText('Following · read only')).toBeInTheDocument()
    expect(screen.getByText('Public upstream outage')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|pause|test monitor/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Email notifications' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Response became slow' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /slack incidents/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(client.updateMonitorSubscriptionNotifications).toHaveBeenCalledWith(
      'workspace-1',
      'subscription-1',
      {
        events: ['monitor.down', 'monitor.up', 'monitor.slow'],
        email_enabled: false,
        integration_ids: ['integration-1'],
      },
    ))
    expect(await screen.findByText('Notification settings saved.')).toBeInTheDocument()
  })
})
