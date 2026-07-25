import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'

const { mockLogout } = vi.hoisted(() => ({ mockLogout: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../app/AuthProvider', () => ({
  useAuth: () => ({
    user: { name: 'Jordan Lee' },
    workspace: { name: 'Production workspace', plan: 'free' },
    authenticated: true,
    logout: mockLogout,
  }),
}))

vi.mock('../app/DashboardGate', () => ({
  endDemoSession: vi.fn(),
  isDemoSession: () => false,
}))

afterEach(() => {
  cleanup()
  mockLogout.mockClear()
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

    await waitFor(() => expect(mockLogout).toHaveBeenCalledOnce())
    expect(screen.getByText('Login destination')).toBeInTheDocument()
  })
})
