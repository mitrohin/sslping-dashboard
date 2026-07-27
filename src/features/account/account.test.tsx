import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntegrationsPage } from './IntegrationsPage'
import { TeamPage } from './TeamPage'

afterEach(cleanup)

describe('TeamPage', () => {
  it('optimistically adds a pending invitation and invokes its callback', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined)
    render(<TeamPage onInvite={onInvite} />)

    fireEvent.click(screen.getByRole('button', { name: /invite team member/i }))
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new.member@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }))

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({
      email: 'new.member@example.com',
      role: 'reader',
    }))
    expect(await screen.findByText('new.member@example.com')).toBeInTheDocument()
  })

  it('switches to editable team details without leaving the page', () => {
    render(<TeamPage />)
    fireEvent.click(screen.getByRole('button', { name: /team details/i }))
    expect(screen.getByRole('heading', { name: /workspace details/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/workspace name/i)).toHaveValue('SSLPing production')
  })

  it('shows seat usage without pretending to start a billing action', () => {
    render(<TeamPage />)
    fireEvent.click(screen.getByRole('button', { name: /manage seats/i }))
    expect(screen.getByRole('heading', { name: /workspace seats/i })).toBeInTheDocument()
    expect(screen.getByText(/comes directly from the active subscription snapshot/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('heading', { name: /workspace seats/i })).not.toBeInTheDocument()
  })

  it('enrolls the current user in authenticator 2FA and exposes one-time recovery codes', async () => {
    const onSetupTwoFactor = vi.fn().mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauth_url: 'otpauth://totp/SSLPing:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=SSLPing',
      account_name: 'test@example.com',
    })
    const onConfirmTwoFactor = vi.fn().mockResolvedValue(['AAAAA-BBBBB', 'CCCCC-DDDDD'])
    const onSecuritySessionEnd = vi.fn().mockResolvedValue(undefined)
    render(
      <TeamPage
        initialMembers={[{
          id: 'member-1',
          name: 'Test User',
          email: 'test@example.com',
          initials: 'TU',
          role: 'owner',
          twoFactorEnabled: false,
          status: 'active',
          isCurrentUser: true,
        }]}
        initialSummary={{ seatsUsed: 1, seatsTotal: 3, loginSeatsUsed: 1, notifySeatsUsed: 0, planName: 'Starter' }}
        onSetupTwoFactor={onSetupTwoFactor}
        onConfirmTwoFactor={onConfirmTwoFactor}
        onSecuritySessionEnd={onSecuritySessionEnd}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /my security/i }))
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }))
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onSetupTwoFactor).toHaveBeenCalledWith('correct horse'))

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/authenticator code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /enable 2fa/i }))
    await waitFor(() => expect(onConfirmTwoFactor).toHaveBeenCalledWith('123456'))
    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /i saved the codes/i }))
    await waitFor(() => expect(onSecuritySessionEnd).toHaveBeenCalledTimes(1))
  })
})

describe('IntegrationsPage', () => {
  it('creates a local Slack integration through the provider-aware form', async () => {
    render(<IntegrationsPage />)
    const slackCard = screen.getByRole('heading', { name: 'Slack' }).closest('section')
    expect(slackCard).not.toBeNull()
    fireEvent.click(within(slackCard as HTMLElement).getByRole('button', { name: /add/i }))

    fireEvent.change(screen.getByLabelText(/friendly name/i), { target: { value: 'Release alerts' } })
    fireEvent.change(screen.getByLabelText(/slack webhook url/i), { target: { value: 'https://example.com/demo-hook' } })
    fireEvent.click(screen.getByRole('button', { name: /create integration/i }))

    expect(await screen.findByText('Release alerts')).toBeInTheDocument()
  })

  it('supports keyboard-accessible tab switching', () => {
    render(<IntegrationsPage />)
    const integrationsTab = screen.getByRole('tab', { name: 'Integrations' })
    integrationsTab.focus()
    fireEvent.keyDown(integrationsTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'API keys' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: /api keys/i })).toBeInTheDocument()
  })
})
