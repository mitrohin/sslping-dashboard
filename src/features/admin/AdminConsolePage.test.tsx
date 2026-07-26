import { useState, type FormEvent } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SupportTicketDetail } from '../../api/types'
import { TicketModal } from './AdminConsolePage'

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
  },
  messages: [],
}

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
