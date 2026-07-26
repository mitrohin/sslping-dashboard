import { useState, type FormEvent } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupportTicketDetail } from '../../api/types'
import { AdminConsolePage, TicketModal } from './AdminConsolePage'

const mocks = vi.hoisted(() => {
  const users = vi.fn()
  const plans = vi.fn()
  const tickets = vi.fn()
  const channels = vi.fn()
  const ticketDetail = vi.fn()
  const markRead = vi.fn()
  return {
    users, plans, tickets, channels, ticketDetail, markRead,
    api: {
      adminListUsers: users,
      adminListPlans: plans,
      adminListTickets: tickets,
      adminListNotificationChannels: channels,
      adminGetTicket: ticketDetail,
      adminMarkSupportTicketRead: markRead,
    },
  }
})

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', name: 'Administrator', system_role: 'superadmin' },
    api: mocks.api,
  }),
}))

const detail: SupportTicketDetail = {
  ticket: {
    id: 'ticket-1',
    workspace_id: 'workspace-1',
    created_by: 'customer-1',
    subject: 'Delivery problem',
    status: 'open',
    priority: 'high',
    created_at: '2026-07-26T17:00:00Z',
    updated_at: '2026-07-26T17:00:00Z',
    last_reply_at: '2026-07-26T17:00:00Z',
    unread_count: 0,
  },
  messages: [],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function ReplyHarness({ onSubmit }: { onSubmit: (event: FormEvent, internal: boolean) => void }) {
  const [reply, setReply] = useState('Visible to the customer')
  const [internal, setInternal] = useState(true)
  return (
    <TicketModal
      detail={detail}
      users={[]}
      busy={false}
      reply={reply}
      internal={internal}
      files={[]}
      onClose={() => undefined}
      onReply={setReply}
      onInternal={setInternal}
      onFiles={() => undefined}
      onOpenAttachment={() => undefined}
      onUpdate={() => undefined}
      onSubmit={onSubmit}
    />
  )
}

describe('administrator ticket reply', () => {
  it('submits a customer reply as public after turning off internal-note mode', () => {
    const onSubmit = vi.fn((event: FormEvent, _internal: boolean) => event.preventDefault())
    render(<ReplyHarness onSubmit={onSubmit} />)

    expect(screen.getByRole('dialog')).toHaveClass('modal--xl', 'admin-ticket-modal')
    const toggle = screen.getByRole('switch', { name: 'Internal note' })
    expect(toggle.closest('label')).toBeNull()
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0]?.[1]).toBe(false)
  })
})

describe('administrator ticket unread state', () => {
  it('highlights new customer activity and clears it only after marking the latest customer message', async () => {
    const unreadDetail: SupportTicketDetail = {
      ticket: { ...detail.ticket, unread_count: 1 },
      messages: [
        { id: 'customer-message', ticket_id: 'ticket-1', author_id: 'customer-1', author_role: 'user', body: 'New details', internal: false, created_at: '2026-07-26T17:01:00Z', attachments: [] },
        { id: 'internal-note', ticket_id: 'ticket-1', author_id: 'admin-1', author_role: 'superadmin', body: 'Private note', internal: true, created_at: '2026-07-26T17:02:00Z', attachments: [] },
      ],
    }
    mocks.users.mockResolvedValue({ items: [] })
    mocks.plans.mockResolvedValue({ items: [] })
    mocks.tickets.mockResolvedValue({ items: [unreadDetail.ticket] })
    mocks.channels.mockResolvedValue({ items: [] })
    mocks.ticketDetail.mockResolvedValue(unreadDetail)
    mocks.markRead.mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: /tickets/i }))
    const row = await screen.findByRole('listitem')
    expect(row).toHaveClass('is-unread')
    expect(row).toHaveTextContent('New activity')

    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith('ticket-1', 'customer-message'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('listitem')).not.toHaveClass('is-unread')
  })
})
