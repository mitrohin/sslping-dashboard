import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupportTicket, SupportTicketDetail } from '../../api/types'
import { SUPPORT_UNREAD_REFRESH_EVENT } from './unread'
import { SupportPage } from './SupportPage'

const mocks = vi.hoisted(() => {
  const list = vi.fn()
  const detail = vi.fn()
  const markRead = vi.fn()
  const create = vi.fn()
  const reply = vi.fn()
  const upload = vi.fn()
  const download = vi.fn()
  return {
    list, detail, markRead, create, reply, upload, download,
    api: {
      listSupportTickets: list,
      getSupportTicket: detail,
      markSupportTicketRead: markRead,
      createSupportTicket: create,
      replySupportTicket: reply,
      uploadSupportAttachment: upload,
      downloadSupportAttachment: download,
    },
  }
})

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'customer-1', name: 'Customer' },
    api: mocks.api,
  }),
}))

const unreadTicket: SupportTicket = {
  id: 'ticket-1',
  workspace_id: 'workspace-1',
  created_by: 'customer-1',
  subject: 'Certificate problem',
  status: 'waiting',
  priority: 'high',
  created_at: '2026-07-26T17:00:00Z',
  updated_at: '2026-07-26T17:05:00Z',
  last_reply_at: '2026-07-26T17:05:00Z',
  unread_count: 2,
}

const detail: SupportTicketDetail = {
  ticket: unreadTicket,
  messages: [
    { id: 'message-1', ticket_id: 'ticket-1', author_id: 'customer-1', author_role: 'user', body: 'Please help', internal: false, created_at: '2026-07-26T17:00:00Z', attachments: [] },
    { id: 'message-2', ticket_id: 'ticket-1', author_id: 'admin-1', author_role: 'superadmin', body: 'First answer', internal: false, created_at: '2026-07-26T17:04:00Z', attachments: [] },
    { id: 'message-3', ticket_id: 'ticket-1', author_id: 'admin-1', author_role: 'superadmin', body: 'Latest answer', internal: false, created_at: '2026-07-26T17:05:00Z', attachments: [] },
  ],
}

beforeEach(() => {
  mocks.list.mockResolvedValue({ items: [unreadTicket] })
  mocks.detail.mockResolvedValue(detail)
  mocks.markRead.mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('customer support unread state', () => {
  it('creates a ticket without exposing or accepting a customer priority', async () => {
    mocks.list.mockResolvedValue({ items: [] })
    const created: SupportTicketDetail = {
      ticket: { ...unreadTicket, id: 'ticket-new', subject: 'New support request', priority: 'normal', unread_count: 0 },
      messages: [{ id: 'message-new', ticket_id: 'ticket-new', author_id: 'customer-1', author_role: 'user', body: 'Details for support', internal: false, created_at: '2026-07-26T17:00:00Z', attachments: [] }],
    }
    mocks.create.mockResolvedValue(created)
    render(<SupportPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'New ticket' }))
    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Monitoring alert does not arrive'), { target: { value: 'New support request' } })
    fireEvent.change(screen.getByPlaceholderText('Describe the problem, what you expected and what happened…'), { target: { value: 'Details for support' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ subject: 'New support request', message: 'Details for support' }))
  })

  it('highlights an unread ticket and clears it after marking the latest staff reply', async () => {
    const refresh = vi.fn()
    window.addEventListener(SUPPORT_UNREAD_REFRESH_EVENT, refresh)
    render(<SupportPage />)

    const row = await screen.findByRole('button', { name: /certificate problem/i })
    expect(row).toHaveClass('is-unread')
    expect(row).toHaveTextContent('2 new replies')

    fireEvent.click(row)
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith('ticket-1', 'message-3'))
    expect(refresh).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'All tickets' }))
    expect(screen.getByRole('button', { name: /certificate problem/i })).not.toHaveClass('is-unread')
    window.removeEventListener(SUPPORT_UNREAD_REFRESH_EVENT, refresh)
  })

  it('keeps a ticket unread when the read-state request fails', async () => {
    mocks.markRead.mockRejectedValue(new Error('Read state unavailable'))
    render(<SupportPage />)

    fireEvent.click(await screen.findByRole('button', { name: /certificate problem/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Read state unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'All tickets' }))
    expect(screen.getByRole('button', { name: /certificate problem/i })).toHaveClass('is-unread')
  })
})
