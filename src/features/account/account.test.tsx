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
