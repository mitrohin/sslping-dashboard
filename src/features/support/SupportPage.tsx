import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, LifeBuoy, MessageSquarePlus, Send, Ticket } from 'lucide-react'
import type { SupportAttachment, SupportMessage, SupportTicket, SupportTicketDetail, SupportTicketPriority } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Badge, Button, EmptyState, FeedbackBanner, Field, PageHeader, Panel, Select } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { AttachmentList, AttachmentPicker, openAttachmentBlob } from './SupportAttachments'
import { requestSupportUnreadRefresh } from './unread'
import './support.css'

function ticketTone(status: SupportTicket['status']) {
  if (status === 'resolved' || status === 'closed') return 'success' as const
  if (status === 'waiting') return 'warning' as const
  return 'info' as const
}

export function SupportPage() {
  const { api, user } = useAuth()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [subject, setSubject] = useState('')
  const [priority, setPriority] = useState<SupportTicketPriority>('normal')
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [ticketFiles, setTicketFiles] = useState<File[]>([])
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await api.listSupportTickets({ limit: 100 })
      setTickets(result.items)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load support tickets.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const openTicket = async (ticket: SupportTicket) => {
    setBusy(true)
    try {
      const next = await api.getSupportTicket(ticket.id)
      setDetail(next)
      const latestStaffMessage = [...next.messages].reverse().find((message) => message.author_role === 'superadmin' && !message.internal)
      if ((ticket.unread_count > 0 || next.ticket.unread_count > 0) && latestStaffMessage) {
        await api.markSupportTicketRead(ticket.id, latestStaffMessage.id)
        const readTicket = { ...next.ticket, unread_count: 0 }
        setDetail({ ...next, ticket: readTicket })
        setTickets((current) => current.map((item) => item.id === ticket.id ? readTicket : item))
        requestSupportUnreadRefresh()
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this ticket.')
    } finally {
      setBusy(false)
    }
  }

  const submitTicket = async (event: FormEvent) => {
    event.preventDefault()
    if (subject.trim().length < 4 || message.trim().length < 2) return
    setBusy(true)
    try {
      let created = await api.createSupportTicket({ subject: subject.trim(), priority, message: message.trim() })
      setTickets((current) => [created.ticket, ...current])
      setDetail(created)
      if (ticketFiles.length > 0) {
        for (const file of ticketFiles) await api.uploadSupportAttachment(created.ticket.id, created.messages[0].id, file)
        created = await api.getSupportTicket(created.ticket.id)
        setDetail(created)
      }
      setCreating(false)
      setSubject('')
      setMessage('')
      setPriority('normal')
      setTicketFiles([])
      setError('')
      requestSupportUnreadRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the ticket.')
    } finally {
      setBusy(false)
    }
  }

  const submitReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail || reply.trim().length < 2) return
    setBusy(true)
    try {
      const result = await api.replySupportTicket(detail.ticket.id, reply.trim())
      setDetail((current) => current ? { ticket: result.ticket, messages: [...current.messages, result.message] } : current)
      setTickets((current) => current.map((ticket) => ticket.id === result.ticket.id ? result.ticket : ticket))
      if (replyFiles.length > 0) {
        for (const file of replyFiles) await api.uploadSupportAttachment(result.ticket.id, result.message.id, file)
        setDetail(await api.getSupportTicket(result.ticket.id))
      }
      setReply('')
      setReplyFiles([])
      setError('')
      requestSupportUnreadRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the reply.')
    } finally {
      setBusy(false)
    }
  }

  const messages = useMemo(() => detail?.messages ?? [], [detail])

  const openAttachment = async (attachment: SupportAttachment) => {
    if (!detail) return
    setBusy(true)
    try {
      openAttachmentBlob(await api.downloadSupportAttachment(detail.ticket.id, attachment.id), attachment.file_name)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not download the attachment.')
    } finally {
      setBusy(false)
    }
  }

  if (detail) {
    return (
      <div className="page support-page">
        <button className="support-back" type="button" onClick={() => setDetail(null)}><ArrowLeft size={17} /> All tickets</button>
        <PageHeader title={detail.ticket.subject} description={`Ticket opened ${formatDate(detail.ticket.created_at)}`} actions={<Badge tone={ticketTone(detail.ticket.status)}>{detail.ticket.status.replace('_', ' ')}</Badge>} />
        {error && <FeedbackBanner tone="error" className="feedback-banner--page" onDismiss={() => setError('')}>{error}</FeedbackBanner>}
        <Panel className="support-thread">
          <div className="support-thread__meta">
            <span>Priority <strong>{detail.ticket.priority}</strong></span>
            <span>Last activity <strong>{formatDate(detail.ticket.last_reply_at)}</strong></span>
          </div>
          <div className="support-messages">
            {messages.map((item: SupportMessage) => (
              <article key={item.id} className={`support-message ${item.author_role === 'superadmin' ? 'support-message--staff' : ''}`}>
                <div className="support-message__head"><strong>{item.author_role === 'superadmin' ? 'SSLPing support' : item.author_id === user?.id ? 'You' : 'Workspace member'}</strong><time>{formatDate(item.created_at)}</time></div>
                <p>{item.body}</p>
                <AttachmentList attachments={item.attachments} onOpen={(attachment) => void openAttachment(attachment)} busy={busy} />
              </article>
            ))}
          </div>
          {!['closed'].includes(detail.ticket.status) && (
            <form className="support-reply" onSubmit={submitReply}>
              <Field label="Reply" hint="Your message will be visible to the SSLPing support team.">
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add more context, expected behaviour or steps to reproduce…" />
              </Field>
              <AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={busy} />
              <Button type="submit" disabled={busy || reply.trim().length < 2}><Send size={17} /> Send reply</Button>
            </form>
          )}
        </Panel>
      </div>
    )
  }

  return (
    <div className="page support-page">
      <PageHeader title="Support" description="Create a ticket and continue the conversation with the SSLPing support team." actions={<Button onClick={() => setCreating((value) => !value)}><MessageSquarePlus size={18} /> New ticket</Button>} />
      {error && <FeedbackBanner tone="error" className="feedback-banner--page" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>} onDismiss={() => setError('')}>{error}</FeedbackBanner>}
      {creating && (
        <Panel className="support-create">
          <form onSubmit={submitTicket}>
            <div className="form-grid">
              <Field label="Subject" hint="A short description of what you need help with."><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Monitoring alert does not arrive" /></Field>
              <Field label="Priority" hint="Choose urgent only for production-impacting issues."><Select value={priority} onChange={(event) => setPriority(event.target.value as SupportTicketPriority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
            </div>
            <Field label="Message"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the problem, what you expected and what happened…" /></Field>
            <AttachmentPicker files={ticketFiles} onChange={setTicketFiles} disabled={busy} />
            <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={busy || subject.trim().length < 4 || message.trim().length < 2}>Create ticket</Button></div>
          </form>
        </Panel>
      )}
      {!creating && !loading && tickets.length === 0 ? (
        <Panel><EmptyState icon={<LifeBuoy size={34} />} title="No support tickets" description="When you need help, create a ticket and your full conversation will remain here." action={<Button onClick={() => setCreating(true)}>Create first ticket</Button>} /></Panel>
      ) : (
        <Panel className="support-list">
          {loading ? <div className="route-loading"><span className="spinner" /> Loading tickets…</div> : tickets.map((ticket) => (
            <button key={ticket.id} type="button" className={ticket.unread_count > 0 ? 'is-unread' : ''} onClick={() => void openTicket(ticket)} disabled={busy}>
              <span className="support-list__icon"><Ticket size={20} /></span>
              <span>
                <strong>{ticket.subject}</strong>
                <small>Updated {formatDate(ticket.updated_at)}</small>
                {ticket.unread_count > 0 && <span className="support-list__unread">{ticket.unread_count === 1 ? 'New reply' : `${ticket.unread_count} new replies`}</span>}
              </span>
              <Badge tone={ticket.priority === 'urgent' ? 'danger' : ticket.priority === 'high' ? 'warning' : 'neutral'}>{ticket.priority}</Badge>
              <Badge tone={ticketTone(ticket.status)}>{ticket.status.replace('_', ' ')}</Badge>
            </button>
          ))}
        </Panel>
      )}
    </div>
  )
}
