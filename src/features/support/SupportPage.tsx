import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, LifeBuoy, MessageSquarePlus, Send, Ticket } from 'lucide-react'
import type { SupportAttachment, SupportMessage, SupportTicket, SupportTicketDetail } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Badge, Button, EmptyState, FeedbackBanner, Field, PageHeader, PageLoadingSkeleton, Panel } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { AttachmentList, AttachmentPicker, openAttachmentBlob } from './SupportAttachments'
import { requestSupportUnreadRefresh } from './unread'
import { useI18n } from '../../app/I18nProvider'
import './support.css'

// Binary support uploads remain disabled until object storage, quotas,
// retention and malware scanning are in place. Text support is available.
const supportAttachmentsAvailable = false

function ticketTone(status: SupportTicket['status']) {
  if (status === 'resolved' || status === 'closed') return 'success' as const
  if (status === 'waiting') return 'warning' as const
  return 'info' as const
}

export function SupportPage() {
  const { api, user } = useAuth()
  const { t } = useI18n()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [subject, setSubject] = useState('')
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
      setError(reason instanceof Error ? reason.message : t('support.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

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
      setError(reason instanceof Error ? reason.message : t('support.openFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submitTicket = async (event: FormEvent) => {
    event.preventDefault()
    if (subject.trim().length < 4 || message.trim().length < 2) return
    setBusy(true)
    try {
      let created = await api.createSupportTicket({ subject: subject.trim(), message: message.trim() })
      setTickets((current) => [created.ticket, ...current])
      setDetail(created)
      if (supportAttachmentsAvailable && ticketFiles.length > 0) {
        for (const file of ticketFiles) await api.uploadSupportAttachment(created.ticket.id, created.messages[0].id, file)
        created = await api.getSupportTicket(created.ticket.id)
        setDetail(created)
      }
      setCreating(false)
      setSubject('')
      setMessage('')
      setTicketFiles([])
      setError('')
      requestSupportUnreadRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('support.createFailed'))
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
      if (supportAttachmentsAvailable && replyFiles.length > 0) {
        for (const file of replyFiles) await api.uploadSupportAttachment(result.ticket.id, result.message.id, file)
        setDetail(await api.getSupportTicket(result.ticket.id))
      }
      setReply('')
      setReplyFiles([])
      setError('')
      requestSupportUnreadRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('support.replyFailed'))
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
      setError(reason instanceof Error ? reason.message : t('support.downloadFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && tickets.length === 0 && !detail) {
    return (
      <div className="page page--wide support-page">
        <PageLoadingSkeleton label={t('support.loading')} />
      </div>
    )
  }

  if (detail) {
    return (
      <div className="page support-page">
        <button className="support-back" type="button" onClick={() => setDetail(null)}><ArrowLeft size={17} /> {t('support.allTickets')}</button>
        <PageHeader title={detail.ticket.subject} description={t('support.opened', { date: formatDate(detail.ticket.created_at) })} actions={<Badge tone={ticketTone(detail.ticket.status)}>{t(`support.status.${detail.ticket.status}`)}</Badge>} />
        {error && <FeedbackBanner tone="error" className="feedback-banner--page" onDismiss={() => setError('')}>{error}</FeedbackBanner>}
        <Panel className="support-thread">
          <div className="support-thread__meta">
            <span>{t('support.priority')} <strong>{t(`support.priority.${detail.ticket.priority}`)}</strong></span>
            <span>{t('support.lastActivity')} <strong>{formatDate(detail.ticket.last_reply_at)}</strong></span>
          </div>
          <div className="support-messages">
            {messages.map((item: SupportMessage) => (
              <article key={item.id} className={`support-message ${item.author_role === 'superadmin' ? 'support-message--staff' : ''}`}>
                <div className="support-message__head"><strong>{item.author_role === 'superadmin' ? t('support.staff') : item.author_id === user?.id ? t('support.you') : t('support.workspaceMember')}</strong><time>{formatDate(item.created_at)}</time></div>
                <p>{item.body}</p>
                {supportAttachmentsAvailable && <AttachmentList attachments={item.attachments} onOpen={(attachment) => void openAttachment(attachment)} busy={busy} />}
              </article>
            ))}
          </div>
          {!['closed'].includes(detail.ticket.status) && (
            <form className="support-reply" onSubmit={submitReply}>
              <Field label={t('support.reply')} hint={t('support.replyHint')}>
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={t('support.replyPlaceholder')} />
              </Field>
              {supportAttachmentsAvailable && <AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={busy} />}
              <Button type="submit" disabled={busy || reply.trim().length < 2}><Send size={17} /> {t('support.sendReply')}</Button>
            </form>
          )}
        </Panel>
      </div>
    )
  }

  return (
    <div className="page support-page">
      <PageHeader title={t('support.title')} description={t('support.description')} actions={<Button onClick={() => setCreating((value) => !value)}><MessageSquarePlus size={18} /> {t('support.newTicket')}</Button>} />
      {error && <FeedbackBanner tone="error" className="feedback-banner--page" action={<Button size="sm" variant="secondary" onClick={() => void load()}>{t('support.retry')}</Button>} onDismiss={() => setError('')}>{error}</FeedbackBanner>}
      {creating && (
        <Panel className="support-create">
          <form onSubmit={submitTicket}>
            <Field label={t('support.subject')} hint={t('support.subjectHint')}><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={t('support.subjectPlaceholder')} /></Field>
            <Field label={t('support.message')}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('support.messagePlaceholder')} /></Field>
            {supportAttachmentsAvailable && <AttachmentPicker files={ticketFiles} onChange={setTicketFiles} disabled={busy} />}
            <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setCreating(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || subject.trim().length < 4 || message.trim().length < 2}>{t('support.createTicket')}</Button></div>
          </form>
        </Panel>
      )}
      {!creating && (tickets.length === 0 ? (
        <Panel><EmptyState icon={<LifeBuoy size={34} />} title={t('support.noTickets')} description={t('support.noTicketsHint')} action={<Button onClick={() => setCreating(true)}>{t('support.createFirst')}</Button>} /></Panel>
      ) : (
        <Panel className="support-list">
          {tickets.map((ticket) => (
            <button key={ticket.id} type="button" className={ticket.unread_count > 0 ? 'is-unread' : ''} onClick={() => void openTicket(ticket)} disabled={busy}>
              <span className="support-list__icon"><Ticket size={20} /></span>
              <span>
                <strong>{ticket.subject}</strong>
                <small>{t('support.updated', { date: formatDate(ticket.updated_at) })}</small>
                {ticket.unread_count > 0 && <span className="support-list__unread">{ticket.unread_count === 1 ? t('support.newReply') : t('support.newReplies', { count: ticket.unread_count })}</span>}
              </span>
              <Badge tone={ticket.priority === 'urgent' ? 'danger' : ticket.priority === 'high' ? 'warning' : 'neutral'}>{t(`support.priority.${ticket.priority}`)}</Badge>
              <Badge tone={ticketTone(ticket.status)}>{t(`support.status.${ticket.status}`)}</Badge>
            </button>
          ))}
        </Panel>
      ))}
    </div>
  )
}
