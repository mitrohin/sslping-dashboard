import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Ban, BellRing, CreditCard, Download, FileCheck2, Landmark, LogIn, Mail, MessageSquare, Pencil, Plus, ReceiptText, Search, Send, Settings2, Shield, Trash2, Users } from 'lucide-react'
import type { AdminBillingWorkspace, AdminUser, BillingSettings, Invoice, InvoiceIssuerProfile, JsonObject, Plan, PlanLimits, SupportAttachment, SupportMessage, SupportNotificationChannel, SupportTicket, SupportTicketDetail, SupportTicketPriority, SupportTicketStatus, Workspace, WorkspacePaymentSettings } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Badge, Button, FeedbackBanner, Field, IconButton, Modal, PageHeader, Panel, Select, Toggle } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { saveAdministratorSession } from '../../app/impersonation'
import { AttachmentList, AttachmentPicker, openAttachmentBlob } from '../support/SupportAttachments'
import { requestSupportUnreadRefresh } from '../support/unread'
import './admin.css'

type Section = 'users' | 'plans' | 'invoices' | 'tickets' | 'notifications'

const emptyLimits: PlanLimits = {
  max_monitors: 100,
  min_interval_seconds: 60,
  max_team_members: 3,
  max_status_pages: 1,
  max_integrations: 3,
  max_locations: 1,
  data_retention_days: 30,
  allow_manual_tests: false,
}

function asMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function statusTone(status: SupportTicketStatus) {
  if (status === 'resolved' || status === 'closed') return 'success' as const
  if (status === 'waiting') return 'warning' as const
  return 'info' as const
}

function saveInvoiceDocument(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function AdminConsolePage() {
  const { api, user } = useAuth()
  const accountant = user?.system_role === 'accountant'
  const [section, setSection] = useState<Section>(() => accountant ? 'invoices' : 'users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [channels, setChannels] = useState<SupportNotificationChannel[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceCursor, setInvoiceCursor] = useState<string | undefined>()
  const [billingWorkspaces, setBillingWorkspaces] = useState<AdminBillingWorkspace[]>([])
  const [billingWorkspaceCursor, setBillingWorkspaceCursor] = useState<string | undefined>()
  const [billingWorkspaceQuery, setBillingWorkspaceQuery] = useState('')
  const [loadingBillingWorkspaces, setLoadingBillingWorkspaces] = useState(false)
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null)
  const [paymentSettings, setPaymentSettings] = useState<WorkspacePaymentSettings | null>(null)
  const [paymentWorkspaceName, setPaymentWorkspaceName] = useState('')
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMoreInvoices, setLoadingMoreInvoices] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [impersonatingUser, setImpersonatingUser] = useState<AdminUser | null>(null)
  const [impersonationWorkspace, setImpersonationWorkspace] = useState('')
  const [reason, setReason] = useState('')
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [creatingPlan, setCreatingPlan] = useState(false)
  const [ticketDetail, setTicketDetail] = useState<SupportTicketDetail | null>(null)
  const [ticketReply, setTicketReply] = useState('')
  const [internalReply, setInternalReply] = useState(false)
  const [ticketFiles, setTicketFiles] = useState<File[]>([])
  const [creatingChannel, setCreatingChannel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setBillingWorkspaceQuery('')
    try {
      if (accountant) {
        const [invoicePage, workspacePage] = await Promise.all([
          api.adminListInvoices({ limit: 200 }),
          api.adminListBillingWorkspaces({ limit: 50 }),
        ])
        setInvoices(invoicePage.items)
        setInvoiceCursor(invoicePage.next_cursor)
        setBillingWorkspaces(workspacePage.items)
        setBillingWorkspaceCursor(workspacePage.next_cursor)
        setError('')
        return
      }
      const [userPage, planList, ticketPage, channelList] = await Promise.all([
        api.adminListUsers({ limit: 200 }), api.adminListPlans(), api.adminListTickets({ limit: 200 }), api.adminListNotificationChannels(),
      ])
      setUsers(userPage.items)
      setPlans(planList.items)
      setTickets(ticketPage.items)
      setChannels(channelList.items)
      const [invoicePage, settings, workspacePage] = await Promise.all([
        api.adminListInvoices({ limit: 200 }),
        api.adminGetBillingSettings(),
        api.adminListBillingWorkspaces({ limit: 50 }),
      ])
      setInvoices(invoicePage.items)
      setInvoiceCursor(invoicePage.next_cursor)
      setBillingSettings(settings)
      setBillingWorkspaces(workspacePage.items)
      setBillingWorkspaceCursor(workspacePage.next_cursor)
      setError('')
    } catch (reason) {
      setError(asMessage(reason, 'Could not load the system administration data.'))
    } finally {
      setLoading(false)
    }
  }, [accountant, api])

  useEffect(() => { void load() }, [load])

  const loadMoreInvoices = async () => {
    if (!invoiceCursor || loadingMoreInvoices) return
    setLoadingMoreInvoices(true)
    setError('')
    try {
      const page = await api.adminListInvoices({ limit: 200, cursor: invoiceCursor })
      setInvoices((current) => {
        const existing = new Set(current.map((invoice) => invoice.id))
        return [...current, ...page.items.filter((invoice) => !existing.has(invoice.id))]
      })
      setInvoiceCursor(page.next_cursor)
    } catch (reason) {
      setError(asMessage(reason, 'Could not load older invoices.'))
    } finally {
      setLoadingMoreInvoices(false)
    }
  }

  const searchBillingWorkspaces = async (event?: FormEvent) => {
    event?.preventDefault()
    if (loadingBillingWorkspaces) return
    setLoadingBillingWorkspaces(true)
    setError('')
    try {
      const page = await api.adminListBillingWorkspaces({ limit: 50, search: billingWorkspaceQuery.trim() || undefined })
      setBillingWorkspaces(page.items)
      setBillingWorkspaceCursor(page.next_cursor)
    } catch (reason) {
      setError(asMessage(reason, 'Could not search billing workspaces.'))
    } finally {
      setLoadingBillingWorkspaces(false)
    }
  }

  const loadMoreBillingWorkspaces = async () => {
    if (!billingWorkspaceCursor || loadingBillingWorkspaces) return
    setLoadingBillingWorkspaces(true)
    setError('')
    try {
      const page = await api.adminListBillingWorkspaces({
        limit: 50,
        cursor: billingWorkspaceCursor,
        search: billingWorkspaceQuery.trim() || undefined,
      })
      setBillingWorkspaces((current) => {
        const existing = new Set(current.map((workspace) => workspace.id))
        return [...current, ...page.items.filter((workspace) => !existing.has(workspace.id))]
      })
      setBillingWorkspaceCursor(page.next_cursor)
    } catch (reason) {
      setError(asMessage(reason, 'Could not load more billing workspaces.'))
    } finally {
      setLoadingBillingWorkspaces(false)
    }
  }

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return users
    return users.filter((entry) => `${entry.name} ${entry.email} ${entry.workspaces.map((workspace) => workspace.name).join(' ')}`.toLowerCase().includes(term))
  }, [query, users])

  const changePlan = async (target: AdminUser, workspace: Workspace, code: string) => {
    setBusy(true)
    try {
      const updated = await api.adminUpdateWorkspace(workspace.id, { plan: code })
      setUsers((current) => current.map((entry) => entry.id === target.id ? { ...entry, workspaces: entry.workspaces.map((item) => item.id === updated.id ? updated : item) } : entry))
      setNotice(`${workspace.name} is now on the ${code} plan.`)
      setError('')
    } catch (reason) {
      setError(asMessage(reason, 'Could not change the workspace plan.'))
    } finally { setBusy(false) }
  }

  const openImpersonation = (target: AdminUser) => {
    setImpersonatingUser(target)
    setImpersonationWorkspace(target.workspaces[0]?.id ?? '')
    setReason('Customer support investigation')
  }

  const impersonate = async (event: FormEvent) => {
    event.preventDefault()
    if (!impersonatingUser || !impersonationWorkspace || reason.trim().length < 5 || !api.tokens) return
    setBusy(true)
    try {
      const tokens = await api.adminImpersonate({ user_id: impersonatingUser.id, workspace_id: impersonationWorkspace, reason: reason.trim() })
      if (!saveAdministratorSession(api)) throw new Error('Could not preserve the administrator session in this browser.')
      api.setTokens(tokens)
      window.location.assign('/monitors')
    } catch (reason) {
      setError(asMessage(reason, 'Could not start the support session.'))
      setBusy(false)
    }
  }

  const openTicket = async (ticket: SupportTicket) => {
    setBusy(true)
    try {
      const next = await api.adminGetTicket(ticket.id)
      setTicketDetail(next)
      setTicketFiles([])
      const latestCustomerMessage = [...next.messages].reverse().find((message) => message.author_role === 'user' && !message.internal)
      if ((ticket.unread_count > 0 || next.ticket.unread_count > 0) && latestCustomerMessage) {
        await api.adminMarkSupportTicketRead(ticket.id, latestCustomerMessage.id)
        const readTicket = { ...next.ticket, unread_count: 0 }
        setTicketDetail({ ...next, ticket: readTicket })
        setTickets((items) => items.map((item) => item.id === ticket.id ? readTicket : item))
        requestSupportUnreadRefresh()
      }
      setError('')
    } catch (reason) { setError(asMessage(reason, 'Could not open the ticket.')) } finally { setBusy(false) }
  }

  const updateTicket = async (patch: Partial<Pick<SupportTicket, 'status' | 'priority'>>) => {
    if (!ticketDetail) return
    setBusy(true)
    try {
      const current = ticketDetail.ticket
      const updated = await api.adminUpdateTicket(current.id, { status: patch.status ?? current.status, priority: patch.priority ?? current.priority, ...(current.assigned_to ? { assigned_to: current.assigned_to } : {}) })
      setTicketDetail((detail) => detail ? { ...detail, ticket: updated } : detail)
      setTickets((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (reason) { setError(asMessage(reason, 'Could not update the ticket.')) } finally { setBusy(false) }
  }

  const replyTicket = async (event: FormEvent, replyIsInternal: boolean) => {
    event.preventDefault()
    if (!ticketDetail || ticketReply.trim().length < 1) return
    setBusy(true)
    try {
      const result = await api.adminReplyTicket(ticketDetail.ticket.id, { message: ticketReply.trim(), internal: replyIsInternal })
      setTicketDetail((detail) => detail ? { ticket: result.ticket, messages: [...detail.messages, result.message] } : detail)
      setTickets((items) => items.map((item) => item.id === result.ticket.id ? result.ticket : item))
      if (ticketFiles.length > 0) {
        for (const file of ticketFiles) await api.adminUploadSupportAttachment(result.ticket.id, result.message.id, file)
        setTicketDetail(await api.adminGetTicket(result.ticket.id))
      }
      setTicketReply('')
      setInternalReply(false)
      setTicketFiles([])
      requestSupportUnreadRefresh()
    } catch (reason) { setError(asMessage(reason, 'Could not send the reply.')) } finally { setBusy(false) }
  }

  const openTicketAttachment = async (attachment: SupportAttachment) => {
    if (!ticketDetail) return
    setBusy(true)
    try {
      openAttachmentBlob(await api.adminDownloadSupportAttachment(ticketDetail.ticket.id, attachment.id), attachment.file_name)
      setError('')
    } catch (reason) {
      setError(asMessage(reason, 'Could not download the attachment.'))
    } finally {
      setBusy(false)
    }
  }

  const activeTickets = tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length
  const unreadTickets = tickets.filter((ticket) => ticket.unread_count > 0).length
  const openInvoices = invoices.filter((invoice) => invoice.status === 'open').length

  const openInvoice = async (invoice: Invoice) => {
    setBusy(true)
    try {
      const [detail, settings] = await Promise.all([
        api.adminGetInvoice(invoice.id),
        api.adminGetWorkspacePaymentSettings(invoice.workspace_id),
      ])
      setInvoiceDetail(detail)
      setPaymentSettings(settings)
      setPaymentWorkspaceName(detail.workspace_name || invoice.workspace_name || invoice.workspace_id)
      setError('')
    } catch (reason) { setError(asMessage(reason, 'Could not open the invoice.')) } finally { setBusy(false) }
  }

  const openWorkspacePayments = async (workspace: Workspace) => {
    setBusy(true)
    try {
      setPaymentSettings(await api.adminGetWorkspacePaymentSettings(workspace.id))
      setPaymentWorkspaceName(workspace.name)
      setError('')
    } catch (reason) { setError(asMessage(reason, 'Could not load payment access.')) } finally { setBusy(false) }
  }

  const openBillingWorkspacePayments = (workspace: AdminBillingWorkspace) => {
    setPaymentSettings(workspace.payment_settings)
    setPaymentWorkspaceName(workspace.name)
    setError('')
  }

  return (
    <div className="page page--wide admin-page">
      <PageHeader eyebrow={accountant ? 'Billing administration' : 'System administration'} title={accountant ? 'Invoices & payments' : 'Control center'} description={accountant ? 'Review invoices, confirm incoming payments and manage customer payment access.' : 'Manage customers, plans, billing, support conversations and delivery channels across SSLPing.'} actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh data</Button>} />
      {notice && <FeedbackBanner tone="success" className="feedback-banner--page" onDismiss={() => setNotice('')}>{notice}</FeedbackBanner>}
      {error && <FeedbackBanner tone="error" className="feedback-banner--page" onDismiss={() => setError('')}>{error}</FeedbackBanner>}
      <div className="admin-kpis">
        {accountant ? <>
          <div><ReceiptText /><span>Invoices loaded<strong>{invoices.length}{invoiceCursor ? '+' : ''}</strong></span></div>
          <div><CreditCard /><span>Open in loaded set<strong>{openInvoices}</strong></span></div>
          <div><FileCheck2 /><span>Paid in loaded set<strong>{invoices.filter((invoice) => invoice.status === 'paid').length}</strong></span></div>
          <div><Ban /><span>Voided in loaded set<strong>{invoices.filter((invoice) => invoice.status === 'void').length}</strong></span></div>
        </> : <>
          <div><Users /><span>Registered users<strong>{users.length}</strong></span></div>
          <div><CreditCard /><span>Open in loaded set<strong>{openInvoices}</strong></span></div>
          <div><MessageSquare /><span>Tickets requiring attention<strong>{activeTickets}</strong></span></div>
          <div><BellRing /><span>Support channels<strong>{channels.filter((channel) => channel.active).length}</strong></span></div>
        </>}
      </div>
      <nav className="admin-tabs" aria-label="System administration sections">
        {!accountant && <button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}><Users size={17} /> Users & workspaces</button>}
        {!accountant && <button className={section === 'plans' ? 'is-active' : ''} onClick={() => setSection('plans')}><CreditCard size={17} /> Plans & limits</button>}
        <button className={section === 'invoices' ? 'is-active' : ''} onClick={() => setSection('invoices')}><ReceiptText size={17} /> Invoices {openInvoices > 0 && <b aria-label={`${openInvoices} open invoices in the loaded set`}>{openInvoices}</b>}</button>
        {!accountant && <button className={section === 'tickets' ? 'is-active' : ''} onClick={() => setSection('tickets')}><MessageSquare size={17} /> Tickets {unreadTickets > 0 && <b aria-label={`${unreadTickets} unread tickets`}>{unreadTickets}</b>}</button>}
        {!accountant && <button className={section === 'notifications' ? 'is-active' : ''} onClick={() => setSection('notifications')}><BellRing size={17} /> Notifications</button>}
      </nav>
      {loading ? <div className="route-loading"><span className="spinner" /> Loading control center…</div> : section === 'users' ? (
        <UsersSection users={filteredUsers} plans={plans} query={query} setQuery={setQuery} busy={busy} onPlan={changePlan} onEdit={setEditingUser} onImpersonate={openImpersonation} onPayments={openWorkspacePayments} />
      ) : section === 'plans' ? (
        <PlansSection plans={plans} billingSettings={billingSettings} busy={busy} onDiscount={async (annual_discount_percent) => { setBusy(true); try { setBillingSettings(await api.adminUpdateBillingSettings({ annual_discount_percent })); setNotice('Annual billing discount updated.') } catch (reason) { setError(asMessage(reason, 'Could not update the annual discount.')) } finally { setBusy(false) } }} onCreate={() => setCreatingPlan(true)} onEdit={setEditingPlan} onDelete={async (plan) => { if (!window.confirm(`Delete ${plan.name}? Workspaces still using it will prevent deletion.`)) return; try { await api.adminDeletePlan(plan.id); setPlans((items) => items.filter((item) => item.id !== plan.id)) } catch (reason) { setError(asMessage(reason, 'Could not delete the plan.')) } }} />
      ) : section === 'invoices' ? (
        <InvoicesSection
          invoices={invoices}
          workspaces={billingWorkspaces}
          workspaceQuery={billingWorkspaceQuery}
          setWorkspaceQuery={setBillingWorkspaceQuery}
          busy={busy}
          hasMore={Boolean(invoiceCursor)}
          loadingMore={loadingMoreInvoices}
          hasMoreWorkspaces={Boolean(billingWorkspaceCursor)}
          loadingWorkspaces={loadingBillingWorkspaces}
          onLoadMore={() => void loadMoreInvoices()}
          onLoadMoreWorkspaces={() => void loadMoreBillingWorkspaces()}
          onSearchWorkspaces={(event) => void searchBillingWorkspaces(event)}
          onOpen={openInvoice}
          onOpenWorkspace={openBillingWorkspacePayments}
          billingSettings={billingSettings}
          onIssuer={async (invoice_issuer) => { setBusy(true); try { setBillingSettings(await api.adminUpdateBillingSettings({ invoice_issuer })); setNotice('Invoice legal and bank details updated. New invoices will use this profile.'); } catch (reason) { setError(asMessage(reason, 'Could not update invoice details.')) } finally { setBusy(false) } }}
        />
      ) : section === 'tickets' ? (
        <TicketsSection tickets={tickets} users={users} busy={busy} onOpen={openTicket} />
      ) : (
        <NotificationsSection channels={channels} onCreate={() => setCreatingChannel(true)} onTest={async (channel) => { setBusy(true); try { await api.adminTestNotificationChannel(channel.id); setNotice(`Test message sent to ${channel.name}.`) } catch (reason) { setError(asMessage(reason, 'Test delivery failed.')) } finally { setBusy(false) } }} onToggle={async (channel) => { try { const updated = await api.adminUpdateNotificationChannel(channel.id, { name: channel.name, active: !channel.active }); setChannels((items) => items.map((item) => item.id === updated.id ? updated : item)) } catch (reason) { setError(asMessage(reason, 'Could not update the channel.')) } }} onDelete={async (channel) => { if (!window.confirm(`Delete ${channel.name}?`)) return; try { await api.adminDeleteNotificationChannel(channel.id); setChannels((items) => items.filter((item) => item.id !== channel.id)) } catch (reason) { setError(asMessage(reason, 'Could not delete the channel.')) } }} />
      )}
      <UserModal user={editingUser} busy={busy} onClose={() => setEditingUser(null)} onSave={async (target, input) => { setBusy(true); try { const updated = await api.adminUpdateUser(target.id, input); setUsers((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); setEditingUser(null); setNotice(`${updated.name}'s account was updated.`) } catch (reason) { setError(asMessage(reason, 'Could not update the user.')) } finally { setBusy(false) } }} />
      <Modal open={Boolean(impersonatingUser)} onClose={() => setImpersonatingUser(null)} title="Start support session" icon={<LogIn size={29} />}>
        {impersonatingUser && <form className="admin-modal-form" onSubmit={impersonate}><div className="admin-callout"><Shield size={20} /><span>You will act as <strong>{impersonatingUser.name}</strong>. The reason and every resulting action are written to the audit log.</span></div><Field label="Workspace"><Select value={impersonationWorkspace} onChange={(event) => setImpersonationWorkspace(event.target.value)}>{impersonatingUser.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.plan}</option>)}</Select></Field><Field label="Reason" hint="Required for accountability and customer support history."><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setImpersonatingUser(null)}>Cancel</Button><Button type="submit" disabled={busy || reason.trim().length < 5}>Enter workspace</Button></div></form>}
      </Modal>
      <PlanModal open={creatingPlan || Boolean(editingPlan)} plan={editingPlan} busy={busy} onClose={() => { setCreatingPlan(false); setEditingPlan(null) }} onSave={async (draft) => { setBusy(true); try { if (editingPlan) { const updated = await api.adminUpdatePlan({ ...editingPlan, ...draft }); setPlans((items) => items.map((item) => item.id === updated.id ? updated : item)) } else { const created = await api.adminCreatePlan(draft); setPlans((items) => [...items, created]) } setCreatingPlan(false); setEditingPlan(null); setNotice('Plan saved and its limits are active.') } catch (reason) { setError(asMessage(reason, 'Could not save the plan.')) } finally { setBusy(false) } }} />
      <InvoiceModal invoice={invoiceDetail} paymentSettings={paymentSettings} workspaceName={paymentWorkspaceName} busy={busy} canVoid={user?.system_role === 'superadmin'} onClose={() => { setInvoiceDetail(null); setPaymentSettings(null) }} onDownload={async (invoice) => { setBusy(true); try { saveInvoiceDocument(await api.adminDownloadInvoicePdf(invoice.id), `${invoice.number}.pdf`) } catch (reason) { setError(asMessage(reason, 'Could not download the invoice PDF.')) } finally { setBusy(false) } }} onEmail={async (invoice) => { setBusy(true); try { const delivery = await api.adminEmailInvoicePdf(invoice.id); setNotice(`${invoice.number} PDF sent to ${delivery.recipient}.`) } catch (reason) { setError(asMessage(reason, 'Could not email the invoice PDF.')) } finally { setBusy(false) } }} onPaid={async (invoice, note, paidAt) => { if (!window.confirm(`Mark invoice ${invoice.number} as paid? This activates the purchased plan and recalculates its term.`)) return; setBusy(true); try { const updated = await api.adminMarkInvoicePaid(invoice.id, { ...(note.trim() ? { note: note.trim() } : {}), ...(paidAt ? { paid_at: new Date(paidAt).toISOString() } : {}) }); setInvoiceDetail(updated); setInvoices((items) => items.map((item) => item.id === updated.id ? updated : item)); setNotice(`${updated.number} marked paid; workspace limits have been updated.`) } catch (reason) { setError(asMessage(reason, 'Could not confirm payment.')) } finally { setBusy(false) } }} onVoid={async (invoice, note) => { if (!window.confirm(`Void invoice ${invoice.number}?`)) return; setBusy(true); try { const updated = await api.adminVoidInvoice(invoice.id, note.trim() ? { note: note.trim() } : {}); setInvoiceDetail(updated); setInvoices((items) => items.map((item) => item.id === updated.id ? updated : item)); setNotice(`${updated.number} was voided.`) } catch (reason) { setError(asMessage(reason, 'Could not void the invoice.')) } finally { setBusy(false) } }} onPaymentSettings={async (settings) => { setBusy(true); try { const updated = await api.adminUpdateWorkspacePaymentSettings(settings.workspace_id, { keepz_allowed: settings.keepz_allowed, cloudpayments_allowed: settings.cloudpayments_allowed }); setPaymentSettings(updated); setBillingWorkspaces((items) => items.map((workspace) => workspace.id === updated.workspace_id ? { ...workspace, payment_settings: updated } : workspace)); setNotice(`Payment access updated for ${paymentWorkspaceName}.`) } catch (reason) { setError(asMessage(reason, 'Could not update payment access.')) } finally { setBusy(false) } }} />
      <PaymentSettingsModal settings={!invoiceDetail ? paymentSettings : null} workspaceName={paymentWorkspaceName} busy={busy} onClose={() => setPaymentSettings(null)} onSave={async (settings) => { setBusy(true); try { const updated = await api.adminUpdateWorkspacePaymentSettings(settings.workspace_id, { keepz_allowed: settings.keepz_allowed, cloudpayments_allowed: settings.cloudpayments_allowed }); setBillingWorkspaces((items) => items.map((workspace) => workspace.id === updated.workspace_id ? { ...workspace, payment_settings: updated } : workspace)); setNotice(`Payment access updated for ${paymentWorkspaceName}.`); setPaymentSettings(null) } catch (reason) { setError(asMessage(reason, 'Could not update payment access.')) } finally { setBusy(false) } }} />
      <TicketModal detail={ticketDetail} users={users} busy={busy} reply={ticketReply} internal={internalReply} files={ticketFiles} onClose={() => { setTicketDetail(null); setTicketFiles([]) }} onReply={setTicketReply} onInternal={setInternalReply} onFiles={setTicketFiles} onOpenAttachment={(attachment) => void openTicketAttachment(attachment)} onUpdate={updateTicket} onSubmit={replyTicket} />
      <ChannelModal open={creatingChannel} busy={busy} onClose={() => setCreatingChannel(false)} onSave={async (input) => { setBusy(true); try { const channel = await api.adminCreateNotificationChannel(input); setChannels((items) => [...items, channel]); setCreatingChannel(false); setNotice(`${channel.name} will receive new ticket and reply notifications.`) } catch (reason) { setError(asMessage(reason, 'Could not create the channel.')) } finally { setBusy(false) } }} />
      {user?.system_role !== 'superadmin' && user?.system_role !== 'accountant' && <FeedbackBanner tone="error">This page requires a billing administration role.</FeedbackBanner>}
    </div>
  )
}

function userInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
}

function compatibleWorkspacePlans(plans: Plan[], workspace: Workspace) {
  const currentCurrency = plans.find((plan) => plan.code === workspace.plan)?.currency.toUpperCase()
  return plans.filter((plan) => {
    const assignable = plan.active || plan.code === workspace.plan
    return assignable && (!currentCurrency || plan.currency.toUpperCase() === currentCurrency)
  })
}

function UsersSection({ users, plans, query, setQuery, busy, onPlan, onEdit, onImpersonate, onPayments }: { users: AdminUser[]; plans: Plan[]; query: string; setQuery: (value: string) => void; busy: boolean; onPlan: (user: AdminUser, workspace: Workspace, code: string) => void; onEdit: (user: AdminUser) => void; onImpersonate: (user: AdminUser) => void; onPayments: (workspace: Workspace) => void }) {
  return <>
    <label className="admin-search">
      <Search size={18} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by user, email or workspace" />
    </label>
    <Panel className="admin-users-panel">
      <div className="admin-user-list-heading" aria-hidden="true">
        <span>User</span>
        <span>Workspace & plan</span>
        <span>Security</span>
        <span>Actions</span>
      </div>
      {users.length === 0 ? <div className="admin-users-empty"><Users size={28} /><strong>No users found</strong><span>Try another search query.</span></div> : (
        <div className="admin-user-list" role="list">
          {users.map((entry) => <article className="admin-user-row" role="listitem" key={entry.id}>
            <div className="admin-user-identity">
              <span className="admin-user-avatar" aria-hidden="true">{userInitials(entry.name)}</span>
              <span>
                <strong>{entry.name}</strong>
                <small>{entry.email}</small>
                <span className="admin-user-meta">Registered {formatDate(entry.created_at)}</span>
                {entry.system_role === 'superadmin' && <Badge tone="purple">Superadmin</Badge>}
                {entry.system_role === 'accountant' && <Badge tone="info">Accountant</Badge>}
              </span>
            </div>
            <div className="admin-user-cell" data-label="Workspace & plan">
              <div className="admin-workspaces">{entry.workspaces.map((workspace) => <div key={workspace.id}>
                <span title={workspace.name}>{workspace.name}</span>
                <Select aria-label={`Plan for ${workspace.name}`} value={workspace.plan} disabled={busy} onChange={(event) => void onPlan(entry, workspace, event.target.value)}>
                  {compatibleWorkspacePlans(plans, workspace).map((plan) => <option key={plan.id} value={plan.code}>{plan.name}</option>)}
                </Select>
                <IconButton label={`Payment access for ${workspace.name}`} disabled={busy} onClick={() => void onPayments(workspace)}><Settings2 size={15} /></IconButton>
              </div>)}</div>
            </div>
            <div className="admin-user-security admin-user-cell" data-label="Security">
              <Badge tone={entry.email_verified_at ? 'success' : 'warning'}>{entry.email_verified_at ? 'Verified' : 'Unverified'}</Badge>
              <small>{entry.two_factor_enabled ? '2FA enabled' : '2FA disabled'}</small>
            </div>
            <div className="admin-actions admin-user-cell" data-label="Actions">
              <Button size="sm" variant="secondary" onClick={() => onEdit(entry)}><Pencil size={15} /> Manage</Button>
              <Button size="sm" onClick={() => onImpersonate(entry)} disabled={entry.workspaces.length === 0}><LogIn size={15} /> Sign in as user</Button>
            </div>
          </article>)}
        </div>
      )}
    </Panel>
  </>
}

function PlansSection({ plans, billingSettings, busy, onDiscount, onCreate, onEdit, onDelete }: { plans: Plan[]; billingSettings: BillingSettings | null; busy: boolean; onDiscount: (value: number) => void; onCreate: () => void; onEdit: (plan: Plan) => void; onDelete: (plan: Plan) => void }) {
  const [discount, setDiscount] = useState(0)
  useEffect(() => setDiscount(billingSettings?.annual_discount_percent ?? 0), [billingSettings?.annual_discount_percent])
  return <>
    <div className="admin-section-heading"><div><h2>Plans and enforced limits</h2><p>Public prices and limits are used directly by the workspace billing screen.</p></div><Button onClick={onCreate}><Plus size={17} /> New plan</Button></div>
    <Panel className="admin-billing-settings">
      <span><CalendarDiscountIcon /><span><strong>Annual billing discount</strong><small>Applied centrally to every public plan; yearly prices are calculated from monthly prices.</small></span></span>
      <label><span className="sr-only">Annual discount percent</span><input type="number" min="0" max="100" step="1" value={discount} onChange={(event) => setDiscount(Math.min(100, Math.max(0, Math.trunc(Number(event.target.value) || 0))))} /><b>%</b></label>
      <Button size="sm" variant="secondary" disabled={busy || discount === billingSettings?.annual_discount_percent} onClick={() => onDiscount(discount)}>Save discount</Button>
    </Panel>
    <div className="admin-plan-grid">{plans.map((plan) => <Panel key={plan.id} className={!plan.active ? 'is-inactive' : ''}><div className="admin-plan-header"><div><Badge tone={plan.public ? 'success' : 'neutral'}>{plan.public ? 'Public' : 'Private'}</Badge><h3>{plan.name}</h3><code>{plan.code}</code></div><div><IconButton label={`Edit ${plan.name}`} onClick={() => onEdit(plan)}><Pencil size={17} /></IconButton><IconButton label={`Delete ${plan.name}`} onClick={() => onDelete(plan)}><Trash2 size={17} /></IconButton></div></div><p>{plan.description || 'No public description.'}</p><strong className="admin-plan-price">{(plan.price_monthly_cents / 100).toLocaleString(undefined, { style: 'currency', currency: plan.currency })}<small>/month</small></strong><small className="admin-plan-yearly">{((plan.price_monthly_cents * 12 * (100 - (billingSettings?.annual_discount_percent ?? 0))) / 10000).toLocaleString(undefined, { style: 'currency', currency: plan.currency })}/year · save {billingSettings?.annual_discount_percent ?? 0}%</small><dl><div><dt>Monitors</dt><dd>{plan.limits.max_monitors}</dd></div><div><dt>Fastest interval</dt><dd>{plan.limits.min_interval_seconds}s</dd></div><div><dt>Team members</dt><dd>{plan.limits.max_team_members}</dd></div><div><dt>Status pages</dt><dd>{plan.limits.max_status_pages}</dd></div><div><dt>Integrations</dt><dd>{plan.limits.max_integrations}</dd></div><div><dt>Locations</dt><dd>{plan.limits.max_locations}</dd></div><div><dt>Retention</dt><dd>{plan.limits.data_retention_days} days</dd></div><div><dt>Manual Test now</dt><dd>{plan.limits.allow_manual_tests ? 'Included' : 'Not included'}</dd></div></dl></Panel>)}</div>
  </>
}

function CalendarDiscountIcon() {
  return <span className="admin-billing-settings__icon"><CreditCard size={20} /></span>
}

function money(cents: number, currency: string) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency })
}

function invoiceStatusTone(status: Invoice['status']) {
  return status === 'paid' ? 'success' as const : status === 'void' ? 'neutral' as const : 'warning' as const
}

function InvoicesSection({
  invoices,
  workspaces,
  workspaceQuery,
  setWorkspaceQuery,
  busy,
  hasMore,
  loadingMore,
  hasMoreWorkspaces,
  loadingWorkspaces,
  onLoadMore,
  onLoadMoreWorkspaces,
  onSearchWorkspaces,
  onOpen,
  onOpenWorkspace,
  billingSettings,
  onIssuer,
}: {
  invoices: Invoice[]
  workspaces: AdminBillingWorkspace[]
  workspaceQuery: string
  setWorkspaceQuery: (value: string) => void
  busy: boolean
  hasMore: boolean
  loadingMore: boolean
  hasMoreWorkspaces: boolean
  loadingWorkspaces: boolean
  onLoadMore: () => void
  onLoadMoreWorkspaces: () => void
  onSearchWorkspaces: (event: FormEvent) => void
  onOpen: (invoice: Invoice) => void
  onOpenWorkspace: (workspace: AdminBillingWorkspace) => void
  billingSettings: BillingSettings | null
  onIssuer: (issuer: InvoiceIssuerProfile) => void
}) {
  const [status, setStatus] = useState<'all' | Invoice['status']>('all')
  const visible = status === 'all' ? invoices : invoices.filter((invoice) => invoice.status === status)
  return <>
    {billingSettings && <InvoiceIssuerEditor value={billingSettings.invoice_issuer} busy={busy} onSave={onIssuer} />}
    <section className="admin-billing-workspace-directory" aria-labelledby="billing-workspace-directory-title">
      <div className="admin-section-heading">
        <div>
          <h2 id="billing-workspace-directory-title">Workspace payment access</h2>
          <p>Find any customer workspace and configure payment providers before its first invoice is issued.</p>
        </div>
      </div>
      <form className="admin-billing-workspace-search" role="search" onSubmit={onSearchWorkspaces}>
        <label>
          <Search size={18} />
          <span className="sr-only">Search billing workspaces</span>
          <input value={workspaceQuery} onChange={(event) => setWorkspaceQuery(event.target.value)} placeholder="Search by workspace name or slug" />
        </label>
        <Button type="submit" variant="secondary" disabled={loadingWorkspaces}>{loadingWorkspaces ? 'Searching…' : 'Search'}</Button>
      </form>
      <Panel className="admin-billing-workspace-panel">
        {workspaces.length === 0 ? <div className="admin-billing-workspace-empty"><Search size={25} /><strong>No workspaces found</strong><span>Try another name or slug.</span></div> : <div className="admin-billing-workspace-list" role="list">
          {workspaces.map((workspace) => <article key={workspace.id} role="listitem" className="admin-billing-workspace-row">
            <span className="admin-billing-workspace-identity">
              <strong>{workspace.name}</strong>
              <small>{workspace.slug}</small>
            </span>
            <span className="admin-billing-workspace-plan"><Badge tone="neutral">{workspace.plan}</Badge><small>{workspace.currency}</small></span>
            <span className="admin-billing-workspace-providers">
              <Badge tone={workspace.payment_settings.keepz_allowed ? 'success' : 'neutral'}>Keepz {workspace.payment_settings.keepz_allowed ? 'allowed' : 'blocked'}</Badge>
              <Badge tone={workspace.payment_settings.cloudpayments_allowed ? 'success' : 'neutral'}>CloudPayments {workspace.payment_settings.cloudpayments_allowed ? 'allowed' : 'blocked'}</Badge>
            </span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onOpenWorkspace(workspace)}><Settings2 size={15} /> Configure access</Button>
          </article>)}
        </div>}
        {hasMoreWorkspaces && <div className="admin-invoice-list-more"><Button type="button" variant="secondary" disabled={loadingWorkspaces} onClick={onLoadMoreWorkspaces}>{loadingWorkspaces ? 'Loading…' : 'Load more workspaces'}</Button></div>}
      </Panel>
    </section>
    <div className="admin-section-heading admin-invoice-heading">
      <div><h2>Invoices & plan changes</h2><p>Payment confirmation activates upgrades immediately; downgrades remain scheduled for renewal.</p></div>
      <Select aria-label="Filter invoices by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="open">Open</option><option value="paid">Paid</option><option value="void">Void</option></Select>
    </div>
    <Panel className="admin-invoice-list-panel">
      {visible.length > 0 && <div className="admin-invoice-list-heading" aria-hidden="true"><span>Invoice & customer</span><span>Plan change</span><span>Amount</span><span>Status</span><span>Actions</span></div>}
      {visible.length === 0 ? <div className="admin-invoices-empty"><ReceiptText size={30} /><strong>No invoices found</strong><span>New upgrade invoices will appear here.</span></div> : <div className="admin-invoice-list" role="list">
        {visible.map((invoice) => <article className={`admin-invoice-row admin-invoice-row--${invoice.status}`} role="listitem" key={invoice.id}>
          <div className="admin-invoice-identity"><strong>{invoice.number}</strong><span>{invoice.workspace_name || invoice.workspace_id}</span><small>{invoice.customer_email || `Workspace ${invoice.workspace_id}`}</small></div>
          <div className="admin-invoice-change admin-invoice-cell" data-label="Plan change"><strong>{invoice.source_plan_code} → {invoice.target_plan_code}</strong><small>{invoice.billing_cycle} · {invoice.change_kind}</small></div>
          <div className="admin-invoice-amount admin-invoice-cell" data-label="Amount"><strong>{money(invoice.total_cents, invoice.currency)}</strong><small>Due {formatDate(invoice.due_at)}</small></div>
          <div className="admin-invoice-status admin-invoice-cell" data-label="Status"><Badge tone={invoiceStatusTone(invoice.status)}>{invoice.status}</Badge><small>{invoice.payment_provider}</small></div>
          <div className="admin-invoice-actions admin-invoice-cell" data-label="Actions"><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onOpen(invoice)}>Review invoice</Button></div>
        </article>)}
      </div>}
      {hasMore && <div className="admin-invoice-list-more"><Button variant="secondary" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Loading…' : 'Load older invoices'}</Button></div>}
    </Panel>
  </>
}

const emptyInvoiceIssuer: InvoiceIssuerProfile = {
  legal_name: '', address: '', email: '', bank_name: '', account_number: '',
}

function InvoiceIssuerEditor({ value, busy, onSave }: { value: InvoiceIssuerProfile; busy: boolean; onSave: (issuer: InvoiceIssuerProfile) => void }) {
  const [draft, setDraft] = useState<InvoiceIssuerProfile>(value ?? emptyInvoiceIssuer)
  useEffect(() => setDraft(value ?? emptyInvoiceIssuer), [value])
  const field = (key: keyof InvoiceIssuerProfile, next: string) => setDraft((current) => ({ ...current, [key]: next }))
  const valid = Boolean(draft.legal_name.trim() && draft.address.trim() && draft.email.trim() && draft.bank_name.trim() && draft.account_number.trim())
  return <Panel className="admin-invoice-issuer">
    <div className="admin-section-heading">
      <div><h2><Landmark size={21} /> Invoice details</h2><p>Legal and bank details are copied into each new invoice. Previously issued PDFs keep their original snapshot.</p></div>
      <Button type="button" disabled={busy || !valid || JSON.stringify(draft) === JSON.stringify(value)} onClick={() => onSave(draft)}>Save invoice details</Button>
    </div>
    <div className="admin-invoice-issuer__grid">
      <Field label="Legal company name"><input value={draft.legal_name} onChange={(event) => field('legal_name', event.target.value)} /></Field>
      <Field label="Brand name"><input value={draft.brand_name ?? ''} onChange={(event) => field('brand_name', event.target.value)} placeholder="SSLPing" /></Field>
      <Field label="Registration number"><input value={draft.registration_number ?? ''} onChange={(event) => field('registration_number', event.target.value)} /></Field>
      <Field label="Tax ID"><input value={draft.tax_id ?? ''} onChange={(event) => field('tax_id', event.target.value)} /></Field>
      <Field label="Billing email"><input type="email" value={draft.email} onChange={(event) => field('email', event.target.value)} /></Field>
      <Field label="Phone"><input value={draft.phone ?? ''} onChange={(event) => field('phone', event.target.value)} /></Field>
      <Field label="Legal address" className="admin-invoice-issuer__wide"><textarea value={draft.address} onChange={(event) => field('address', event.target.value)} /></Field>
      <Field label="Bank name"><input value={draft.bank_name} onChange={(event) => field('bank_name', event.target.value)} /></Field>
      <Field label="Account name"><input value={draft.account_name ?? ''} onChange={(event) => field('account_name', event.target.value)} /></Field>
      <Field label="Account number / IBAN"><input value={draft.account_number} onChange={(event) => field('account_number', event.target.value)} /></Field>
      <Field label="SWIFT / BIC"><input value={draft.swift ?? ''} onChange={(event) => field('swift', event.target.value)} /></Field>
      <Field label="Bank address" className="admin-invoice-issuer__wide"><textarea value={draft.bank_address ?? ''} onChange={(event) => field('bank_address', event.target.value)} /></Field>
      <Field label="Correspondent / intermediary bank" className="admin-invoice-issuer__wide"><textarea value={draft.correspondent_bank ?? ''} onChange={(event) => field('correspondent_bank', event.target.value)} /></Field>
      <Field label="Payment instructions" className="admin-invoice-issuer__wide"><textarea value={draft.payment_instructions ?? ''} onChange={(event) => field('payment_instructions', event.target.value)} placeholder="Optional text printed next to the payment reference" /></Field>
    </div>
  </Panel>
}

function PaymentAccessFields({ value, onChange, disabled }: { value: WorkspacePaymentSettings; onChange: (next: WorkspacePaymentSettings) => void; disabled: boolean }) {
  return <div className="admin-payment-access">
    <div className="admin-toggle-row">
      <Toggle checked={value.keepz_allowed} onChange={(checked) => onChange({ ...value, keepz_allowed: checked })} label="Allow Keepz payments" disabled={disabled} />
      <span><strong>Keepz</strong><small>Enabled for customer workspaces by default. Online checkout appears only when the system integration is configured.</small></span>
    </div>
    <div className="admin-toggle-row">
      <Toggle checked={value.cloudpayments_allowed} onChange={(checked) => onChange({ ...value, cloudpayments_allowed: checked })} label="Allow CloudPayments" disabled={disabled} />
      <span><strong>CloudPayments</strong><small>Grant this customer access to the secondary payment provider.</small></span>
    </div>
  </div>
}

function InvoiceModal({ invoice, paymentSettings, workspaceName, busy, canVoid, onClose, onDownload, onEmail, onPaid, onVoid, onPaymentSettings }: { invoice: Invoice | null; paymentSettings: WorkspacePaymentSettings | null; workspaceName: string; busy: boolean; canVoid: boolean; onClose: () => void; onDownload: (invoice: Invoice) => void; onEmail: (invoice: Invoice) => void; onPaid: (invoice: Invoice, note: string, paidAt: string) => void; onVoid: (invoice: Invoice, note: string) => void; onPaymentSettings: (settings: WorkspacePaymentSettings) => void }) {
  const [note, setNote] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [settingsDraft, setSettingsDraft] = useState<WorkspacePaymentSettings | null>(null)
  useEffect(() => { setNote(''); setPaidAt(''); setSettingsDraft(paymentSettings) }, [invoice?.id, paymentSettings])
  return <Modal open={Boolean(invoice)} onClose={onClose} title={invoice ? `Invoice ${invoice.number}` : 'Invoice'} icon={<ReceiptText size={29} />} width="lg" className="admin-invoice-modal">
    {invoice && <div className="admin-invoice-detail">
      <div className="admin-invoice-customer"><span><small>Customer</small><strong>{invoice.workspace_name || workspaceName || invoice.workspace_id}</strong><span>{invoice.customer_email || invoice.workspace_id}</span></span><Badge tone={invoiceStatusTone(invoice.status)}>{invoice.status}</Badge></div>
      <dl className="admin-invoice-breakdown">
        <div><dt>Change</dt><dd>{invoice.source_plan_code} → {invoice.target_plan_code}</dd></div><div><dt>Billing</dt><dd>{invoice.billing_cycle}</dd></div><div><dt>Provider</dt><dd>{invoice.payment_provider}</dd></div>
        <div><dt>Plan term</dt><dd>{money(invoice.subtotal_cents, invoice.currency)}</dd></div><div><dt>Annual discount</dt><dd>−{money(invoice.annual_discount_cents, invoice.currency)}</dd></div><div><dt>Unused-term credit</dt><dd>−{money(invoice.unused_credit_cents, invoice.currency)}</dd></div>
        <div className="admin-invoice-breakdown__total"><dt>Total</dt><dd>{money(invoice.total_cents, invoice.currency)}</dd></div><div><dt>Due</dt><dd>{formatDate(invoice.due_at)}</dd></div><div><dt>Term</dt><dd>{formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}</dd></div>
      </dl>
      <div className="admin-invoice-document-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => onDownload(invoice)}><Download size={16} /> Download PDF</Button><Button type="button" variant="secondary" disabled={busy || !invoice.customer_email} onClick={() => onEmail(invoice)}><Mail size={16} /> Email PDF{invoice.customer_email ? ` to ${invoice.customer_email}` : ''}</Button></div>
      {settingsDraft && <section className="admin-invoice-payment-settings"><div><h3>Customer payment access</h3><p>Keepz is available by default; CloudPayments is granted per workspace.</p></div><PaymentAccessFields value={settingsDraft} onChange={setSettingsDraft} disabled={busy} /><Button size="sm" variant="secondary" disabled={busy || (settingsDraft.keepz_allowed === paymentSettings?.keepz_allowed && settingsDraft.cloudpayments_allowed === paymentSettings?.cloudpayments_allowed)} onClick={() => onPaymentSettings(settingsDraft)}>Save payment access</Button></section>}
      {invoice.status === 'open' && <div className="admin-invoice-resolution"><div className="admin-invoice-payment-fields"><label><span>Payment received at <small>(optional)</small></span><input type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /><small>Leave blank to record the current time. Use the bank receipt time for a payment processed after the deadline.</small></label><label><span>Payment note <small>(optional)</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Bank reference, payment ID or reconciliation note" /></label></div><div>{canVoid && <Button variant="danger" disabled={busy} onClick={() => onVoid(invoice, note)}><Ban size={16} /> Void invoice</Button>}<Button variant="success" disabled={busy} onClick={() => onPaid(invoice, note, paidAt)}><FileCheck2 size={16} /> Mark as paid</Button></div></div>}
      {invoice.status === 'paid' && <div className="admin-payment-result admin-payment-result--paid"><FileCheck2 size={20} /><span><strong>Payment confirmed</strong><small>{invoice.paid_at ? `Marked paid ${formatDate(invoice.paid_at)}.` : 'The purchased plan and its limits are active.'}</small></span></div>}
      {invoice.status === 'void' && <div className="admin-payment-result"><Ban size={20} /><span><strong>Invoice voided</strong><small>No plan upgrade was applied.</small></span></div>}
    </div>}
  </Modal>
}

function PaymentSettingsModal({ settings, workspaceName, busy, onClose, onSave }: { settings: WorkspacePaymentSettings | null; workspaceName: string; busy: boolean; onClose: () => void; onSave: (settings: WorkspacePaymentSettings) => void }) {
  const [draft, setDraft] = useState<WorkspacePaymentSettings | null>(null)
  useEffect(() => setDraft(settings), [settings])
  return <Modal open={Boolean(settings)} onClose={onClose} title="Workspace payment access" icon={<CreditCard size={29} />} width="sm">
    {draft && <div className="admin-modal-form"><div className="admin-person"><strong>{workspaceName}</strong><span>Choose which payment providers this workspace may use.</span></div><PaymentAccessFields value={draft} onChange={setDraft} disabled={busy} /><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy} onClick={() => onSave(draft)}>Save access</Button></div></div>}
  </Modal>
}

function TicketsSection({ tickets, users, busy, onOpen }: { tickets: SupportTicket[]; users: AdminUser[]; busy: boolean; onOpen: (ticket: SupportTicket) => void }) {
  const userName = (id: string) => users.find((entry) => entry.id === id)?.name ?? id.slice(0, 8)
  return <Panel className="admin-ticket-list-panel">
    {tickets.length > 0 && <div className="admin-ticket-list-heading" aria-hidden="true">
      <span>Ticket & customer</span>
      <span>State</span>
      <span>Last activity</span>
      <span>Actions</span>
    </div>}
    {tickets.length === 0 ? <div className="admin-tickets-empty"><MessageSquare size={30} /><strong>No support tickets</strong><span>New customer conversations will appear here.</span></div> : (
      <div className="admin-ticket-list" role="list">
        {tickets.map((ticket) => <article className={`admin-ticket-row ${ticket.unread_count > 0 ? 'is-unread' : ''}`} role="listitem" key={ticket.id}>
          <div className="admin-ticket-identity">
            <strong>{ticket.subject}</strong>
            <small title={ticket.id}>{ticket.id}</small>
            <span>Customer · {userName(ticket.created_by)}</span>
            {ticket.unread_count > 0 && <b className="admin-ticket-unread">{ticket.unread_count === 1 ? 'New activity' : `${ticket.unread_count} new activities`}</b>}
          </div>
          <div className="admin-ticket-state admin-ticket-cell" data-label="State">
            <Badge tone={ticket.priority === 'urgent' ? 'danger' : ticket.priority === 'high' ? 'warning' : 'neutral'}>{ticket.priority}</Badge>
            <Badge tone={statusTone(ticket.status)}>{ticket.status.replace('_', ' ')}</Badge>
          </div>
          <div className="admin-ticket-activity admin-ticket-cell" data-label="Last activity">
            <small>Last activity</small>
            <time dateTime={ticket.last_reply_at}>{formatDate(ticket.last_reply_at)}</time>
          </div>
          <div className="admin-ticket-actions admin-ticket-cell" data-label="Actions">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onOpen(ticket)}>Open conversation</Button>
          </div>
        </article>)}
      </div>
    )}
  </Panel>
}

function NotificationsSection({ channels, onCreate, onTest, onToggle, onDelete }: { channels: SupportNotificationChannel[]; onCreate: () => void; onTest: (channel: SupportNotificationChannel) => void; onToggle: (channel: SupportNotificationChannel) => void; onDelete: (channel: SupportNotificationChannel) => void }) {
  return <><div className="admin-section-heading"><div><h2>Support notifications</h2><p>Deliver new tickets and customer replies to Slack, Telegram or a webhook.</p></div><Button onClick={onCreate}><Plus size={17} /> Add channel</Button></div><div className="admin-channel-list">{channels.length === 0 ? <Panel className="empty-state"><BellRing size={34} /><h2>No delivery channels</h2><p>Add at least one channel to receive support events outside the dashboard.</p></Panel> : channels.map((channel) => <Panel key={channel.id}><span className="admin-channel-icon"><BellRing size={21} /></span><span><strong>{channel.name}</strong><small>{channel.type} · {channel.last_delivery_at ? `last attempted ${formatDate(channel.last_delivery_at)}` : 'not tested yet'}</small>{channel.last_delivery_error && <em>{channel.last_delivery_error}</em>}</span><Toggle checked={channel.active} onChange={() => void onToggle(channel)} label={`Enable ${channel.name}`} /><Button size="sm" variant="secondary" onClick={() => void onTest(channel)}>Send test</Button><IconButton label={`Delete ${channel.name}`} onClick={() => void onDelete(channel)}><Trash2 size={17} /></IconButton></Panel>)}</div></>
}

function UserModal({ user, busy, onClose, onSave }: { user: AdminUser | null; busy: boolean; onClose: () => void; onSave: (user: AdminUser, input: { name: string; system_role: AdminUser['system_role']; email_verified: boolean; revoke_sessions: boolean }) => void }) {
  const [name, setName] = useState(''); const [role, setRole] = useState<AdminUser['system_role']>('user'); const [verified, setVerified] = useState(false); const [revoke, setRevoke] = useState(false)
  useEffect(() => { if (user) { setName(user.name); setRole(user.system_role); setVerified(Boolean(user.email_verified_at)); setRevoke(false) } }, [user])
  return <Modal open={Boolean(user)} onClose={onClose} title="Manage user" icon={<Settings2 size={29} />}>{user && <form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave(user, { name: name.trim(), system_role: role, email_verified: verified, revoke_sessions: revoke }) }}><div className="admin-person"><strong>{user.email}</strong><span>Registered {formatDate(user.created_at)}</span></div><Field label="Display name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="System role"><Select value={role} onChange={(event) => setRole(event.target.value as AdminUser['system_role'])}><option value="user">Regular user</option><option value="accountant">Accountant — invoices only</option><option value="superadmin">Super administrator</option></Select></Field><div className="admin-toggle-row"><Toggle checked={verified} onChange={setVerified} label="Email verified" /><span><strong>Email verified</strong><small>Use only after independently confirming ownership.</small></span></div><div className="admin-toggle-row"><Toggle checked={revoke} onChange={setRevoke} label="Revoke sessions" /><span><strong>Revoke all sessions</strong><small>Forces the user to sign in again on every device.</small></span></div><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || name.trim().length < 2}>Save user</Button></div></form>}</Modal>
}

type PlanDraft = Omit<Plan, 'id' | 'created_at' | 'updated_at'>

function majorPriceInput(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function parseMajorPrice(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null
  const cents = Math.round(Number(normalized) * 100)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
}

type NumericPlanLimit = Exclude<keyof PlanLimits, 'allow_manual_tests'>

const numericPlanLimits: ReadonlyArray<readonly [NumericPlanLimit, string]> = [
  ['max_monitors', 'Monitors'],
  ['min_interval_seconds', 'Minimum interval, seconds'],
  ['max_team_members', 'Team members'],
  ['max_status_pages', 'Status pages'],
  ['max_integrations', 'Integrations'],
  ['max_locations', 'Locations'],
  ['data_retention_days', 'Retention, days'],
]

function minimumPlanLimit(key: NumericPlanLimit) {
  if (key === 'min_interval_seconds') return 10
  if (key === 'max_status_pages' || key === 'max_integrations') return 0
  return 1
}

export function PlanModal({ open, plan, busy, onClose, onSave }: { open: boolean; plan: Plan | null; busy: boolean; onClose: () => void; onSave: (plan: PlanDraft) => void }) {
  const [draft, setDraft] = useState<PlanDraft>({ code: '', name: '', description: '', price_monthly_cents: 0, currency: 'USD', public: true, active: true, limits: emptyLimits })
  const [priceInput, setPriceInput] = useState('0')
  useEffect(() => {
    const next = plan ? { code: plan.code, name: plan.name, description: plan.description, price_monthly_cents: plan.price_monthly_cents, currency: plan.currency, public: plan.public, active: plan.active, limits: { ...plan.limits } } : { code: '', name: '', description: '', price_monthly_cents: 0, currency: 'USD', public: true, active: true, limits: { ...emptyLimits } }
    setDraft(next)
    setPriceInput(majorPriceInput(next.price_monthly_cents))
  }, [open, plan])
  const parsedPrice = parseMajorPrice(priceInput)
  const validLimits = numericPlanLimits.every(([key]) => draft.limits[key] >= minimumPlanLimit(key))
  const limit = (key: NumericPlanLimit, value: string) => {
    const minimum = minimumPlanLimit(key)
    setDraft((current) => ({ ...current, limits: { ...current.limits, [key]: Math.max(minimum, Number(value) || minimum) } }))
  }
  const planCodeValid = /^[a-z0-9][a-z0-9_-]{1,63}$/.test(draft.code)
  const planNameValid = draft.name.trim().length >= 2 && draft.name.trim().length <= 120
  const valid = planNameValid && planCodeValid && /^[A-Z]{3}$/.test(draft.currency) && parsedPrice !== null && validLimits

  return <Modal open={open} onClose={onClose} title={plan ? 'Edit plan' : 'Create plan'} icon={<CreditCard size={29} />} width="lg">
    <form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); if (parsedPrice !== null) onSave({ ...draft, price_monthly_cents: parsedPrice }) }}>
      <div className="form-grid">
        <Field label="Name" error={draft.name.length > 0 && !planNameValid ? 'Use between 2 and 120 characters.' : undefined}><input maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Code" error={draft.code.length > 0 && !planCodeValid ? 'Start with a letter or number and use 2–64 lowercase characters.' : undefined}><input maxLength={64} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} /></Field>
        <Field label="Monthly price" hint={`Amount in ${draft.currency}`} error={priceInput.trim() && parsedPrice === null ? 'Use a non-negative amount with no more than two decimal places.' : undefined}>
          <input type="text" inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} />
        </Field>
        <Field label="Currency" error={draft.currency.length > 0 && !/^[A-Z]{3}$/.test(draft.currency) ? 'Use a three-letter currency code.' : undefined}>
          <input maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
        </Field>
      </div>
      <Field label="Description"><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
      <h3 className="form-section__title">Enforced limits</h3>
      <div className="form-grid form-grid--three">
        {numericPlanLimits.map(([key,label]) => <Field key={key} label={label}>
          <input type="number" min={minimumPlanLimit(key)} step="1" value={draft.limits[key]} onChange={(event) => limit(key, event.target.value)} />
        </Field>)}
      </div>
      <div className="admin-toggle-grid">
        <div className="admin-toggle-row"><Toggle checked={draft.limits.allow_manual_tests} onChange={(value) => setDraft({ ...draft, limits: { ...draft.limits, allow_manual_tests: value } })} label="Manual Test now" /><span><strong>Manual Test now</strong><small>Lets users launch an immediate monitor check outside its normal schedule.</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={draft.public} onChange={(value) => setDraft({ ...draft, public: value })} label="Public plan" /><span><strong>Public plan</strong><small>Available in customer-facing plan selection.</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={draft.active} onChange={(value) => setDraft({ ...draft, active: value })} label="Active plan" /><span><strong>Active plan</strong><small>Can be assigned to workspaces.</small></span></div>
      </div>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !valid}>Save plan</Button></div>
    </form>
  </Modal>
}

export function TicketModal({ detail, users, busy, reply, internal, files, onClose, onReply, onInternal, onFiles, onOpenAttachment, onUpdate, onSubmit }: { detail: SupportTicketDetail | null; users: AdminUser[]; busy: boolean; reply: string; internal: boolean; files: File[]; onClose: () => void; onReply: (value: string) => void; onInternal: (value: boolean) => void; onFiles: (files: File[]) => void; onOpenAttachment: (attachment: SupportAttachment) => void; onUpdate: (patch: Partial<Pick<SupportTicket, 'status' | 'priority'>>) => void; onSubmit: (event: FormEvent, internal: boolean) => void }) {
  const author = (message: SupportMessage) => users.find((entry) => entry.id === message.author_id)?.name ?? (message.author_role === 'superadmin' ? 'SSLPing support' : 'Customer')
  return (
    <Modal
      open={Boolean(detail)}
      onClose={onClose}
      title={detail?.ticket.subject ?? 'Support ticket'}
      icon={<MessageSquare size={29} />}
      width="xl"
      className="admin-ticket-modal"
    >
      {detail && (
        <div className="admin-ticket-detail">
          <div className="form-grid admin-ticket-controls">
            <Field label="Status">
              <Select value={detail.ticket.status} disabled={busy} onChange={(event) => void onUpdate({ status: event.target.value as SupportTicketStatus })}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="waiting">Waiting for customer</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={detail.ticket.priority} disabled={busy} onChange={(event) => void onUpdate({ priority: event.target.value as SupportTicketPriority })}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
          </div>

          <div className="admin-ticket-messages">
            {detail.messages.map((message) => (
              <article key={message.id} className={message.internal ? 'is-internal' : ''}>
                <div><strong>{author(message)}</strong>{message.internal && <Badge tone="warning">Internal note</Badge>}<time>{formatDate(message.created_at)}</time></div>
                <p>{message.body}</p>
                <AttachmentList attachments={message.attachments} onOpen={onOpenAttachment} busy={busy} />
              </article>
            ))}
          </div>

          <form className="admin-ticket-reply-form" onSubmit={(event) => onSubmit(event, internal)}>
            <Field label={internal ? 'Internal note' : 'Reply to customer'}>
              <textarea value={reply} onChange={(event) => onReply(event.target.value)} />
            </Field>
            <AttachmentPicker files={files} onChange={onFiles} disabled={busy} />
            <div className="admin-ticket-compose">
              <div className="admin-toggle-row">
                <Toggle checked={internal} onChange={onInternal} label="Internal note" disabled={busy} />
                <span><strong>Internal note</strong><small>Hidden from the customer.</small></span>
              </div>
              <Button type="submit" disabled={busy || reply.trim().length < 1}><Send size={16} /> {internal ? 'Add note' : 'Send reply'}</Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  )
}

function ChannelModal({ open, busy, onClose, onSave }: { open: boolean; busy: boolean; onClose: () => void; onSave: (input: { name: string; type: SupportNotificationChannel['type']; config: JsonObject }) => void }) {
  const [name, setName] = useState(''); const [type, setType] = useState<SupportNotificationChannel['type']>('slack'); const [url, setURL] = useState(''); const [token, setToken] = useState(''); const [chat, setChat] = useState('')
  useEffect(() => { if (open) { setName(''); setType('slack'); setURL(''); setToken(''); setChat('') } }, [open])
  const config = (): JsonObject => type === 'telegram' ? { bot_token: token, chat_id: chat } : { url }
  const valid = name.trim().length >= 2 && (type === 'telegram' ? token.trim() && chat.trim() : /^https?:\/\//.test(url.trim()))
  return <Modal open={open} onClose={onClose} title="Add support notification" icon={<BellRing size={29} />}><form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), type, config: config() }) }}><Field label="Friendly name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Support alerts" /></Field><Field label="Channel"><Select value={type} onChange={(event) => setType(event.target.value as SupportNotificationChannel['type'])}><option value="slack">Slack incoming webhook</option><option value="telegram">Telegram bot</option><option value="webhook">Generic webhook</option></Select></Field>{type === 'telegram' ? <div className="form-grid"><Field label="Bot token"><input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></Field><Field label="Chat ID"><input value={chat} onChange={(event) => setChat(event.target.value)} /></Field></div> : <Field label={type === 'slack' ? 'Slack webhook URL' : 'Webhook URL'}><input value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://…" /></Field>}<div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !valid}>Create channel</Button></div></form></Modal>
}
