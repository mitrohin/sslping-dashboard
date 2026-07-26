import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'

const mocks = vi.hoisted(() => {
  const supportSummary = vi.fn().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  const adminSummary = vi.fn().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  return {
    logout: vi.fn().mockResolvedValue(undefined),
    supportSummary,
    adminSummary,
    auth: {
      api: { getSupportTicketSummary: supportSummary, adminGetSupportTicketSummary: adminSummary },
    user: { id: 'user-1', name: 'Jordan Lee', system_role: 'user' },
    workspace: { id: 'workspace-1', name: 'Production workspace', plan: 'free' },
    authenticated: true,
    impersonation: null as null | { reason: string },
    },
  }
})

vi.mock('../app/AuthProvider', () => ({
  useAuth: () => ({ ...mocks.auth, logout: mocks.logout }),
}))

vi.mock('../app/DashboardGate', () => ({
  endDemoSession: vi.fn(),
  isDemoSession: () => false,
}))

afterEach(() => {
  cleanup()
  mocks.logout.mockClear()
  mocks.supportSummary.mockReset().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  mocks.adminSummary.mockReset().mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
  mocks.auth.user = { id: 'user-1', name: 'Jordan Lee', system_role: 'user' }
  mocks.auth.impersonation = null
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

  it('shows honest plan options without initiating a payment', () => {
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: /upgrade workspace/i }))

    expect(screen.getByRole('dialog', { name: /workspace plans/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/current plan/i)).toHaveTextContent('Free')
    expect(screen.getByText(/online billing is not connected yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /prepare enquiry/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:\?subject=/),
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses a clear sign-out control and completes logout', async () => {
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
    expect(screen.getByText('Login destination')).toBeInTheDocument()
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
})
