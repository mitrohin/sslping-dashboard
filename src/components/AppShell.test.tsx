import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'

const mocks = vi.hoisted(() => {
  const supportSummary = vi.fn().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  const adminSummary = vi.fn().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  const billingPlans = vi.fn().mockResolvedValue({ annual_discount_percent: 20, items: [{ id: 'plan-free', code: 'free', name: 'Free', description: 'Free monitoring', price_monthly_cents: 0, price_yearly_cents: 0, annual_discount_percent: 20, currency: 'USD', public: true, active: true, limits: { max_monitors: 5, min_interval_seconds: 300, max_team_members: 1, max_status_pages: 1, max_integrations: 1, max_locations: 1, data_retention_days: 7, allow_manual_tests: false }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }, { id: 'plan-pro', code: 'pro', name: 'Pro', description: 'Production monitoring', price_monthly_cents: 2000, price_yearly_cents: 19200, annual_discount_percent: 20, currency: 'USD', public: true, active: true, limits: { max_monitors: 100, min_interval_seconds: 30, max_team_members: 10, max_status_pages: 10, max_integrations: 20, max_locations: 5, data_retention_days: 365, allow_manual_tests: false }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] })
  const billingSubscription = vi.fn().mockResolvedValue({ id: 'sub-1', workspace_id: 'workspace-1', plan_code: 'free', billing_cycle: 'monthly', status: 'active', payment_provider: 'manual', current_period_amount_cents: 0, currency: 'USD', current_period_start: '2026-07-01T00:00:00Z', current_period_end: '2026-08-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' })
  const billingInvoices = vi.fn().mockResolvedValue({ items: [] })
  return {
    logout: vi.fn().mockResolvedValue(undefined),
    supportSummary,
    adminSummary,
    auth: {
      api: { getSupportTicketSummary: supportSummary, adminGetSupportTicketSummary: adminSummary, listBillingPlans: billingPlans, getBillingSubscription: billingSubscription, listBillingInvoices: billingInvoices },
    user: { id: 'user-1', name: 'Jordan Lee', system_role: 'user' },
    workspace: { id: 'workspace-1', name: 'Production workspace', plan: 'free' },
    authenticated: true,
    workspaceRole: 'owner' as 'owner' | 'admin' | 'editor' | 'viewer' | 'notifier' | null,
    impersonation: null as null | { reason: string },
    },
    demoSession: false,
  }
})

vi.mock('../app/AuthProvider', () => ({
  useAuth: () => ({ ...mocks.auth, logout: mocks.logout }),
}))

vi.mock('../app/DashboardGate', () => ({
  endDemoSession: vi.fn(),
  isDemoSession: () => mocks.demoSession,
}))

afterEach(() => {
  cleanup()
  mocks.logout.mockClear()
  mocks.supportSummary.mockReset().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  mocks.adminSummary.mockReset().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  mocks.auth.user = { id: 'user-1', name: 'Jordan Lee', system_role: 'user' }
  mocks.auth.authenticated = true
  mocks.auth.workspaceRole = 'owner'
  mocks.auth.impersonation = null
  mocks.demoSession = false
})

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/monitors']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/monitors" element={<div>Monitor destination</div>} />
          <Route path="/incidents" element={<div>Incident destination</div>} />
          <Route path="/maintenance" element={<div>Maintenance destination</div>} />
          <Route path="/integrations" element={<div>Integration destination</div>} />
        </Route>
        <Route path="/login" element={<div>Login destination</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppShell actions', () => {
  it('opens local support diagnostics and follows a quick investigation route', () => {
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: /open help and diagnostics/i }))

    const dialog = screen.getByRole('dialog', { name: /help & diagnostics/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('Production workspace')).toBeInTheDocument()
    expect(within(dialog).getByText('Authenticated')).toBeInTheDocument()
    expect(within(dialog).getByText('/monitors')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /review recent incidents/i }))
    expect(screen.getByText('Incident destination')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows live priced plan options and invoice history', async () => {
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: /plans & billing/i }))

    expect(screen.getByRole('dialog', { name: /workspace plans & billing/i })).toBeInTheDocument()
    expect(await screen.findByLabelText(/current subscription/i)).toHaveTextContent('Free')
    expect(screen.getByText('$20.00')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['owner', 'admin'] as const)('shows billing management to a %s workspace member', (role) => {
    mocks.auth.workspaceRole = role
    renderShell()

    expect(screen.getByRole('button', { name: 'Plans & billing' })).toBeInTheDocument()
  })

  it.each(['editor', 'viewer', 'notifier'] as const)('hides billing management from a %s workspace member', (role) => {
    mocks.auth.workspaceRole = role
    renderShell()

    expect(screen.queryByRole('button', { name: 'Plans & billing' })).not.toBeInTheDocument()
  })

  it('hides billing management in demo and impersonation sessions', () => {
    mocks.auth.authenticated = false
    mocks.demoSession = true
    const demo = renderShell()
    expect(screen.queryByRole('button', { name: 'Plans & billing' })).not.toBeInTheDocument()

    demo.unmount()
    mocks.auth.authenticated = true
    mocks.demoSession = false
    mocks.auth.impersonation = { reason: 'Customer support' }
    renderShell()
    expect(screen.queryByRole('button', { name: 'Plans & billing' })).not.toBeInTheDocument()
  })

  it('uses a clear sign-out control and completes logout', async () => {
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
    expect(await screen.findByText('Login destination')).toBeInTheDocument()
  })

  it('shows the customer unread count in expanded and collapsed navigation', async () => {
    mocks.supportSummary.mockResolvedValue({ unread_tickets: 3, unread_messages: 5 })
    renderShell()

    const supportLink = await screen.findByRole('link', { name: 'Support tickets, 3 unread' })
    expect(within(supportLink).getByText('3')).toHaveClass('nav-item__unread')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('link', { name: 'Support tickets, 3 unread' })).toHaveAttribute('title', 'Support tickets, 3 unread')
  })

  it('shows administrator unread tickets only outside an impersonation session', async () => {
    mocks.auth.user = { id: 'admin-1', name: 'Jordan Lee', system_role: 'superadmin' }
    mocks.adminSummary.mockResolvedValue({ unread_tickets: 2, unread_messages: 4 })
    const view = renderShell()

    expect(await screen.findByRole('link', { name: 'System administration, 2 unread' })).toBeInTheDocument()
    expect(mocks.adminSummary).toHaveBeenCalled()

    view.unmount()
    mocks.auth.impersonation = { reason: 'Customer support' }
    renderShell()
    expect(screen.queryByRole('link', { name: /system administration/i })).not.toBeInTheDocument()
  })

  it('restricts accountant navigation to billing administration', () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Accounts', system_role: 'accountant' }
    mocks.auth.workspaceRole = null
    renderShell()

    expect(screen.getByRole('link', { name: 'Billing administration' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Monitoring' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support tickets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plans & billing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /help and diagnostics/i })).not.toBeInTheDocument()
  })
})
