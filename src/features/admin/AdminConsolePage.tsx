import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Ban, BellRing, ChevronRight, CreditCard, Download, FileCheck2, Globe2, Landmark, LogIn, MessageSquare, Pencil, Plus, ReceiptText, Search, Send, ServerCog, Settings2, Shield, Trash2, Users } from 'lucide-react'
import type { AdminBillingWorkspace, AdminUser, BillingSettings, CustomerRegion, Invoice, InvoiceIssuerProfile, JsonObject, Locale, PaymentProvider, Plan, PlanLimits, SupportAttachment, SupportMessage, SupportNotificationChannel, SupportTicket, SupportTicketDetail, SupportTicketPriority, SupportTicketStatus, Workspace } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Badge, Button, FeedbackBanner, Field, IconButton, Modal, PageHeader, PageLoadingSkeleton, Panel, Select, Toggle } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { saveAdministratorSession } from '../../app/impersonation'
import { AttachmentList, AttachmentPicker, openAttachmentBlob } from '../support/SupportAttachments'
import { requestSupportUnreadRefresh } from '../support/unread'
import { CheckLocationsSection } from './CheckLocationsSection'
import './admin.css'

const supportAttachmentsAvailable = false
import { localeOptions, useI18n } from '../../app/I18nProvider'

type Section = 'users' | 'regions' | 'locations' | 'plans' | 'invoices' | 'tickets' | 'notifications'

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
  const { t } = useI18n()
  const accountant = user?.system_role === 'accountant'
  const [section, setSection] = useState<Section>(() => accountant ? 'invoices' : 'users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [regions, setRegions] = useState<CustomerRegion[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [channels, setChannels] = useState<SupportNotificationChannel[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceCursor, setInvoiceCursor] = useState<string | undefined>()
  const [billingWorkspaces, setBillingWorkspaces] = useState<AdminBillingWorkspace[]>([])
  const [billingWorkspaceQuery, setBillingWorkspaceQuery] = useState('')
  const [loadingBillingWorkspaces, setLoadingBillingWorkspaces] = useState(false)
  const billingWorkspaceRequest = useRef(0)
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null)
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
  const [editingRegion, setEditingRegion] = useState<CustomerRegion | null>(null)
  const [creatingRegion, setCreatingRegion] = useState(false)
  const [ticketDetail, setTicketDetail] = useState<SupportTicketDetail | null>(null)
  const [ticketReply, setTicketReply] = useState('')
  const [internalReply, setInternalReply] = useState(false)
  const [ticketFiles, setTicketFiles] = useState<File[]>([])
  const [creatingChannel, setCreatingChannel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setBillingWorkspaceQuery('')
    setError('')
    try {
      if (accountant) {
        const failures: string[] = []
        const [invoiceResult] = await Promise.allSettled([
          api.adminListInvoices({ limit: 200 }),
        ])
        if (invoiceResult.status === 'fulfilled') {
          setInvoices(invoiceResult.value.items)
          setInvoiceCursor(invoiceResult.value.next_cursor)
        } else {
          failures.push(asMessage(invoiceResult.reason, t('admin.error.loadInvoices')))
        }
        setBillingWorkspaces([])
        setError([...new Set(failures)].join(' '))
        return
      }
      const failures: string[] = []
      const [userResult, planResult, regionResult, ticketResult, channelResult, invoiceResult, settingsResult] = await Promise.allSettled([
        api.adminListUsers({ limit: 200 }),
        api.adminListPlans(),
        api.adminListRegions(),
        api.adminListTickets({ limit: 200 }),
        api.adminListNotificationChannels(),
        api.adminListInvoices({ limit: 200 }),
        api.adminGetBillingSettings(),
      ])
      if (userResult.status === 'fulfilled') setUsers(userResult.value.items)
      else failures.push(asMessage(userResult.reason, t('admin.error.loadUsers')))
      if (planResult.status === 'fulfilled') setPlans(planResult.value.items)
      else failures.push(asMessage(planResult.reason, t('admin.error.loadPlans')))
      if (regionResult.status === 'fulfilled') setRegions(regionResult.value.items)
      else failures.push(asMessage(regionResult.reason, t('admin.error.loadRegions')))
      if (ticketResult.status === 'fulfilled') setTickets(ticketResult.value.items)
      else failures.push(asMessage(ticketResult.reason, t('admin.error.loadTickets')))
      if (channelResult.status === 'fulfilled') setChannels(channelResult.value.items)
      else failures.push(asMessage(channelResult.reason, t('admin.error.loadChannels')))
      if (invoiceResult.status === 'fulfilled') {
        setInvoices(invoiceResult.value.items)
        setInvoiceCursor(invoiceResult.value.next_cursor)
      } else failures.push(asMessage(invoiceResult.reason, t('admin.error.loadInvoices')))
      if (settingsResult.status === 'fulfilled') setBillingSettings(settingsResult.value)
      else failures.push(asMessage(settingsResult.reason, t('admin.error.loadBillingSettings')))
      setBillingWorkspaces([])
      setError([...new Set(failures)].join(' '))
    } catch (reason) {
      setError(asMessage(reason, t('admin.error.loadSystem')))
    } finally {
      setLoading(false)
    }
  }, [accountant, api, t])

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
      setError(asMessage(reason, t('admin.error.loadOlderInvoices')))
    } finally {
      setLoadingMoreInvoices(false)
    }
  }

  const searchBillingWorkspaces = useCallback(async (term: string) => {
    const requestID = ++billingWorkspaceRequest.current
    const search = term.trim()
    if (!search) {
      setBillingWorkspaces([])
      setLoadingBillingWorkspaces(false)
      return
    }
    setLoadingBillingWorkspaces(true)
    setError('')
    try {
      const page = await api.adminListBillingWorkspaces({ limit: 5, search })
      if (requestID === billingWorkspaceRequest.current) setBillingWorkspaces(page.items.slice(0, 5))
    } catch (reason) {
      if (requestID === billingWorkspaceRequest.current) setError(asMessage(reason, t('admin.error.searchWorkspaces')))
    } finally {
      if (requestID === billingWorkspaceRequest.current) setLoadingBillingWorkspaces(false)
    }
  }, [api, t])

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
      setNotice(t('admin.notice.planChanged', { workspace: workspace.name, plan: code }))
      setError('')
    } catch (reason) {
      setError(asMessage(reason, t('admin.error.changePlan')))
    } finally { setBusy(false) }
  }

  const openImpersonation = (target: AdminUser) => {
    setImpersonatingUser(target)
    setImpersonationWorkspace(target.workspaces[0]?.id ?? '')
    setReason(t('admin.session.defaultReason'))
  }

  const impersonate = async (event: FormEvent) => {
    event.preventDefault()
    if (!impersonatingUser || !impersonationWorkspace || reason.trim().length < 5 || !api.tokens) return
    setBusy(true)
    try {
      const tokens = await api.adminImpersonate({ user_id: impersonatingUser.id, workspace_id: impersonationWorkspace, reason: reason.trim() })
      if (!saveAdministratorSession(api)) throw new Error(t('admin.error.preserveSession'))
      api.setTokens(tokens)
      window.location.assign('/monitors')
    } catch (reason) {
      setError(asMessage(reason, t('admin.error.startSession')))
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
    } catch (reason) { setError(asMessage(reason, t('admin.error.openTicket'))) } finally { setBusy(false) }
  }

  const updateTicket = async (patch: Partial<Pick<SupportTicket, 'status' | 'priority'>>) => {
    if (!ticketDetail) return
    setBusy(true)
    try {
      const current = ticketDetail.ticket
      const updated = await api.adminUpdateTicket(current.id, { status: patch.status ?? current.status, priority: patch.priority ?? current.priority, ...(current.assigned_to ? { assigned_to: current.assigned_to } : {}) })
      setTicketDetail((detail) => detail ? { ...detail, ticket: updated } : detail)
      setTickets((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (reason) { setError(asMessage(reason, t('admin.error.updateTicket'))) } finally { setBusy(false) }
  }

  const replyTicket = async (event: FormEvent, replyIsInternal: boolean) => {
    event.preventDefault()
    if (!ticketDetail || ticketReply.trim().length < 1) return
    setBusy(true)
    try {
      const result = await api.adminReplyTicket(ticketDetail.ticket.id, { message: ticketReply.trim(), internal: replyIsInternal })
      setTicketDetail((detail) => detail ? { ticket: result.ticket, messages: [...detail.messages, result.message] } : detail)
      setTickets((items) => items.map((item) => item.id === result.ticket.id ? result.ticket : item))
      if (supportAttachmentsAvailable && ticketFiles.length > 0) {
        for (const file of ticketFiles) await api.adminUploadSupportAttachment(result.ticket.id, result.message.id, file)
        setTicketDetail(await api.adminGetTicket(result.ticket.id))
      }
      setTicketReply('')
      setInternalReply(false)
      setTicketFiles([])
      requestSupportUnreadRefresh()
    } catch (reason) { setError(asMessage(reason, t('admin.error.replyTicket'))) } finally { setBusy(false) }
  }

  const openTicketAttachment = async (attachment: SupportAttachment) => {
    if (!ticketDetail) return
    setBusy(true)
    try {
      openAttachmentBlob(await api.adminDownloadSupportAttachment(ticketDetail.ticket.id, attachment.id), attachment.file_name)
      setError('')
    } catch (reason) {
      setError(asMessage(reason, t('admin.error.downloadAttachment')))
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
      const detail = await api.adminGetInvoice(invoice.id)
      setInvoiceDetail(detail)
      setPaymentWorkspaceName(detail.workspace_name || invoice.workspace_name || invoice.workspace_id)
      setError('')
    } catch (reason) { setError(asMessage(reason, t('admin.error.openInvoice'))) } finally { setBusy(false) }
  }

  if (loading) {
    return (
      <div className="page page--wide admin-page">
        <PageLoadingSkeleton label={t('admin.loading')} rows={5} />
      </div>
    )
  }

  return (
    <div className="page page--wide admin-page">
      <PageHeader eyebrow={t(accountant ? 'admin.eyebrow.billing' : 'admin.eyebrow.system')} title={t(accountant ? 'admin.title.billing' : 'admin.title.system')} description={t(accountant ? 'admin.description.billing' : 'admin.description.system')} actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>{t('admin.refresh')}</Button>} />
      {notice && <FeedbackBanner tone="success" className="feedback-banner--page" onDismiss={() => setNotice('')}>{notice}</FeedbackBanner>}
      {error && <FeedbackBanner tone="error" className="feedback-banner--page" onDismiss={() => setError('')}>{error}</FeedbackBanner>}
      <div className="admin-kpis">
        {accountant ? <>
          <div><ReceiptText /><span>{t('admin.kpi.invoicesLoaded')}<strong>{invoices.length}{invoiceCursor ? '+' : ''}</strong></span></div>
          <div><Globe2 /><span>{t('admin.kpi.currenciesLoaded')}<strong>{new Set(billingWorkspaces.map((workspace) => workspace.currency)).size}</strong></span></div>
          <div><FileCheck2 /><span>{t('admin.kpi.paidLoaded')}<strong>{invoices.filter((invoice) => invoice.status === 'paid').length}</strong></span></div>
          <div><Ban /><span>{t('admin.kpi.voidedLoaded')}<strong>{invoices.filter((invoice) => invoice.status === 'void').length}</strong></span></div>
        </> : <>
          <div><Users /><span>{t('admin.kpi.registeredUsers')}<strong>{users.length}</strong></span></div>
          <div><CreditCard /><span>{t('admin.kpi.openInvoices')}<strong>{openInvoices}</strong></span></div>
          <div><MessageSquare /><span>{t('admin.kpi.tickets')}<strong>{activeTickets}</strong></span></div>
          <div><BellRing /><span>{t('admin.kpi.channels')}<strong>{channels.filter((channel) => channel.active).length}</strong></span></div>
        </>}
      </div>
      <nav className="admin-tabs" aria-label={t('admin.sections')}>
        {!accountant && <button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}><Users size={17} /> {t('admin.tab.users')}</button>}
        {!accountant && <button className={section === 'regions' ? 'is-active' : ''} onClick={() => setSection('regions')}><Globe2 size={17} /> {t('admin.tab.regions')}</button>}
        {!accountant && <button className={section === 'locations' ? 'is-active' : ''} onClick={() => setSection('locations')}><ServerCog size={17} /> {t('admin.tab.locations')}</button>}
        {!accountant && <button className={section === 'plans' ? 'is-active' : ''} onClick={() => setSection('plans')}><CreditCard size={17} /> {t('admin.tab.plans')}</button>}
        <button className={section === 'invoices' ? 'is-active' : ''} onClick={() => setSection('invoices')}><ReceiptText size={17} /> {t('admin.tab.invoices')} {openInvoices > 0 && <b aria-label={t('admin.openInvoices', { count: openInvoices })}>{openInvoices}</b>}</button>
        {!accountant && <button className={section === 'tickets' ? 'is-active' : ''} onClick={() => setSection('tickets')}><MessageSquare size={17} /> {t('admin.tab.tickets')} {unreadTickets > 0 && <b aria-label={t('admin.unreadTickets', { count: unreadTickets })}>{unreadTickets}</b>}</button>}
        {!accountant && <button className={section === 'notifications' ? 'is-active' : ''} onClick={() => setSection('notifications')}><BellRing size={17} /> {t('admin.tab.notifications')}</button>}
      </nav>
      {section === 'users' ? (
        <UsersSection users={filteredUsers} plans={plans} query={query} setQuery={setQuery} busy={busy} onPlan={changePlan} onEdit={setEditingUser} onImpersonate={openImpersonation} />
      ) : section === 'regions' ? (
        <RegionsSection regions={regions} plans={plans} onCreate={() => setCreatingRegion(true)} onEdit={setEditingRegion} />
      ) : section === 'locations' ? (
        <CheckLocationsSection api={api} />
      ) : section === 'plans' ? (
        <PlansSection plans={plans} regions={regions} billingSettings={billingSettings} busy={busy} onDiscount={async (annual_discount_percent) => { setBusy(true); try { setBillingSettings(await api.adminUpdateBillingSettings({ annual_discount_percent })); setNotice(t('admin.notice.discount')) } catch (reason) { setError(asMessage(reason, t('admin.error.discount'))) } finally { setBusy(false) } }} onCreate={() => setCreatingPlan(true)} onEdit={setEditingPlan} onDelete={async (plan) => { if (!window.confirm(t('admin.confirm.deletePlan', { name: plan.name }))) return; try { await api.adminDeletePlan(plan.id); setPlans((items) => items.filter((item) => item.id !== plan.id)) } catch (reason) { setError(asMessage(reason, t('admin.error.deletePlan'))) } }} />
      ) : section === 'invoices' ? (
        <InvoicesSection
          invoices={invoices}
          workspaces={billingWorkspaces}
          workspaceQuery={billingWorkspaceQuery}
          setWorkspaceQuery={setBillingWorkspaceQuery}
          busy={busy}
          hasMore={Boolean(invoiceCursor)}
          loadingMore={loadingMoreInvoices}
          loadingWorkspaces={loadingBillingWorkspaces}
          onLoadMore={() => void loadMoreInvoices()}
          onSearchWorkspaces={searchBillingWorkspaces}
          onOpen={openInvoice}
          billingSettings={billingSettings}
          onIssuer={async (invoice_issuer) => { setBusy(true); try { setBillingSettings(await api.adminUpdateBillingSettings({ invoice_issuer })); setNotice(t('admin.notice.issuer')); } catch (reason) { setError(asMessage(reason, t('admin.error.issuer'))) } finally { setBusy(false) } }}
        />
      ) : section === 'tickets' ? (
        <TicketsSection tickets={tickets} users={users} busy={busy} onOpen={openTicket} />
      ) : (
        <NotificationsSection channels={channels} onCreate={() => setCreatingChannel(true)} onTest={async (channel) => { setBusy(true); try { await api.adminTestNotificationChannel(channel.id); setNotice(t('admin.notice.channelTest', { name: channel.name })) } catch (reason) { setError(asMessage(reason, t('admin.error.testChannel'))) } finally { setBusy(false) } }} onToggle={async (channel) => { try { const updated = await api.adminUpdateNotificationChannel(channel.id, { name: channel.name, active: !channel.active }); setChannels((items) => items.map((item) => item.id === updated.id ? updated : item)) } catch (reason) { setError(asMessage(reason, t('admin.error.updateChannel'))) } }} onDelete={async (channel) => { if (!window.confirm(t('admin.confirm.deleteChannel', { name: channel.name }))) return; try { await api.adminDeleteNotificationChannel(channel.id); setChannels((items) => items.filter((item) => item.id !== channel.id)) } catch (reason) { setError(asMessage(reason, t('admin.error.deleteChannel'))) } }} />
      )}
      <UserModal user={editingUser} regions={regions} busy={busy} onClose={() => setEditingUser(null)} onSave={async (target, input) => { setBusy(true); try { const updated = await api.adminUpdateUser(target.id, input); setUsers((items) => items.map((item) => item.id === updated.id ? updated : item)); setEditingUser(null); setNotice(t('admin.notice.user', { name: updated.name })) } catch (reason) { setError(asMessage(reason, t('admin.error.updateUser'))) } finally { setBusy(false) } }} />
      <Modal open={Boolean(impersonatingUser)} onClose={() => setImpersonatingUser(null)} title={t('admin.session.title')} icon={<LogIn size={29} />}>
        {impersonatingUser && <form className="admin-modal-form" onSubmit={impersonate}><div className="admin-callout"><Shield size={20} /><span>{t('admin.session.intro', { name: impersonatingUser.name })}</span></div><Field label={t('admin.session.workspace')}><Select value={impersonationWorkspace} onChange={(event) => setImpersonationWorkspace(event.target.value)}>{impersonatingUser.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.plan}</option>)}</Select></Field><Field label={t('admin.session.reason')} hint={t('admin.session.reasonHint')}><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setImpersonatingUser(null)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || reason.trim().length < 5}>{t('admin.session.enter')}</Button></div></form>}
      </Modal>
      <RegionModal open={creatingRegion || Boolean(editingRegion)} region={editingRegion} plans={plans} busy={busy} onClose={() => { setCreatingRegion(false); setEditingRegion(null) }} onSave={async (draft) => { setBusy(true); try { if (editingRegion) await api.adminUpdateRegion({ ...editingRegion, ...draft }); else await api.adminCreateRegion(draft); setRegions((await api.adminListRegions()).items); setCreatingRegion(false); setEditingRegion(null); setNotice(t('admin.notice.region')) } catch (reason) { setError(asMessage(reason, t('admin.error.saveRegion'))) } finally { setBusy(false) } }} />
      <PlanModal open={creatingPlan || Boolean(editingPlan)} plan={editingPlan} regions={regions} busy={busy} onClose={() => { setCreatingPlan(false); setEditingPlan(null) }} onSave={async (draft) => { setBusy(true); try { if (editingPlan) { const updated = await api.adminUpdatePlan({ ...editingPlan, ...draft }); setPlans((items) => items.map((item) => item.id === updated.id ? updated : item)) } else { const created = await api.adminCreatePlan(draft); setPlans((items) => [...items, created]) } setCreatingPlan(false); setEditingPlan(null); setNotice(t('admin.notice.plan')) } catch (reason) { setError(asMessage(reason, t('admin.error.savePlan'))) } finally { setBusy(false) } }} />
      <InvoiceModal invoice={invoiceDetail} workspaceName={paymentWorkspaceName} busy={busy} canVoid={user?.system_role === 'superadmin'} onClose={() => setInvoiceDetail(null)} onDownload={async (invoice) => { setBusy(true); try { saveInvoiceDocument(await api.adminDownloadInvoicePdf(invoice.id), `${invoice.number}.pdf`) } catch (reason) { setError(asMessage(reason, t('admin.error.downloadInvoice'))) } finally { setBusy(false) } }} onPaid={async (invoice, note, paidAt) => { if (!window.confirm(t('admin.confirm.invoicePaid', { number: invoice.number }))) return; setBusy(true); try { const updated = await api.adminMarkInvoicePaid(invoice.id, { ...(note.trim() ? { note: note.trim() } : {}), ...(paidAt ? { paid_at: new Date(paidAt).toISOString() } : {}) }); setInvoiceDetail(updated); setInvoices((items) => items.map((item) => item.id === updated.id ? updated : item)); setNotice(t('admin.notice.invoicePaid', { number: updated.number })) } catch (reason) { setError(asMessage(reason, t('admin.error.confirmPayment'))) } finally { setBusy(false) } }} onVoid={async (invoice, note) => { if (!window.confirm(t('admin.confirm.invoiceVoid', { number: invoice.number }))) return; setBusy(true); try { const updated = await api.adminVoidInvoice(invoice.id, note.trim() ? { note: note.trim() } : {}); setInvoiceDetail(updated); setInvoices((items) => items.map((item) => item.id === updated.id ? updated : item)); setNotice(t('admin.notice.invoiceVoided', { number: updated.number })) } catch (reason) { setError(asMessage(reason, t('admin.error.voidInvoice'))) } finally { setBusy(false) } }} />
      <TicketModal detail={ticketDetail} users={users} busy={busy} reply={ticketReply} internal={internalReply} files={ticketFiles} onClose={() => { setTicketDetail(null); setTicketFiles([]) }} onReply={setTicketReply} onInternal={setInternalReply} onFiles={setTicketFiles} onOpenAttachment={(attachment) => void openTicketAttachment(attachment)} onUpdate={updateTicket} onSubmit={replyTicket} />
      <ChannelModal open={creatingChannel} busy={busy} onClose={() => setCreatingChannel(false)} onSave={async (input) => { setBusy(true); try { const channel = await api.adminCreateNotificationChannel(input); setChannels((items) => [...items, channel]); setCreatingChannel(false); setNotice(t('admin.notice.channelCreated', { name: channel.name })) } catch (reason) { setError(asMessage(reason, t('admin.error.createChannel'))) } finally { setBusy(false) } }} />
      {user?.system_role !== 'superadmin' && user?.system_role !== 'accountant' && <FeedbackBanner tone="error">{t('admin.error.roleRequired')}</FeedbackBanner>}
    </div>
  )
}

function userInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
}

function compatibleWorkspacePlans(plans: Plan[], workspace: Workspace, regionId?: string) {
  const currentPlan = plans.find((plan) => plan.code === workspace.plan)
  const effectiveRegionId = regionId || currentPlan?.region_id
  return plans.filter((plan) => {
    const assignable = plan.active || plan.code === workspace.plan
    return assignable && (!effectiveRegionId || plan.region_id === effectiveRegionId)
  })
}

function UsersSection({ users, plans, query, setQuery, busy, onPlan, onEdit, onImpersonate }: { users: AdminUser[]; plans: Plan[]; query: string; setQuery: (value: string) => void; busy: boolean; onPlan: (user: AdminUser, workspace: Workspace, code: string) => void; onEdit: (user: AdminUser) => void; onImpersonate: (user: AdminUser) => void }) {
  const { t } = useI18n()
  return <>
    <label className="admin-search">
      <Search size={18} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('admin.user.search')} />
    </label>
    <Panel className="admin-users-panel">
      <div className="admin-user-list-heading" aria-hidden="true">
        <span>{t('admin.user.user')}</span>
        <span>{t('admin.user.workspacePlan')}</span>
        <span>{t('admin.user.security')}</span>
        <span>{t('admin.user.actions')}</span>
      </div>
      {users.length === 0 ? <div className="admin-users-empty"><Users size={28} /><strong>{t('admin.user.empty')}</strong><span>{t('admin.user.emptyHint')}</span></div> : (
        <div className="admin-user-list" role="list">
          {users.map((entry) => <article className="admin-user-row" role="listitem" key={entry.id}>
            <div className="admin-user-identity">
              <span className="admin-user-avatar" aria-hidden="true">{userInitials(entry.name)}</span>
              <span className="admin-user-details">
                <span className="admin-user-name">
                  <strong>{entry.name}</strong>
                  {entry.system_role === 'superadmin' && <Badge tone="purple">{t('admin.user.superadmin')}</Badge>}
                  {entry.system_role === 'accountant' && <Badge tone="info">{t('admin.user.accountant')}</Badge>}
                </span>
                <small>{entry.email}</small>
                <span className="admin-user-meta">{t('admin.user.registered', { date: formatDate(entry.created_at) })} · {entry.region?.name ?? t('admin.user.regionUnavailable')} · {entry.locale.toUpperCase()}</span>
              </span>
            </div>
            <div className="admin-user-cell" data-label={t('admin.user.workspacePlan')}>
              <div className="admin-workspaces">{entry.workspaces.map((workspace) => <div key={workspace.id}>
                <span title={workspace.name}>{workspace.name}</span>
                <Select aria-label={t('admin.user.planFor', { name: workspace.name })} value={workspace.plan} disabled={busy} onChange={(event) => void onPlan(entry, workspace, event.target.value)}>
                  {compatibleWorkspacePlans(plans, workspace, entry.region_id).map((plan) => <option key={plan.id} value={plan.code}>{plan.name}</option>)}
                </Select>
              </div>)}</div>
            </div>
            <div className="admin-user-security admin-user-cell" data-label={t('admin.user.security')}>
              <Badge tone={entry.email_verified_at ? 'success' : 'warning'}>{t(entry.email_verified_at ? 'admin.user.verified' : 'admin.user.unverified')}</Badge>
              <small>{t(entry.two_factor_enabled ? 'admin.user.twoFactorEnabled' : 'admin.user.twoFactorDisabled')}</small>
            </div>
            <div className="admin-actions admin-user-cell" data-label={t('admin.user.actions')}>
              <Button size="sm" variant="secondary" onClick={() => onEdit(entry)}><Pencil size={15} /> {t('admin.user.manage')}</Button>
              <Button size="sm" aria-label={t('admin.user.signInAs', { name: entry.name })} onClick={() => onImpersonate(entry)} disabled={entry.workspaces.length === 0}><LogIn size={15} /> {t('admin.user.signIn')}</Button>
            </div>
          </article>)}
        </div>
      )}
    </Panel>
  </>
}

function providerName(provider: PaymentProvider, invoiceLabel = 'Invoice') {
  if (provider === 'keepz') return 'Keepz'
  if (provider === 'cloudpayments') return 'CloudPayments'
  return invoiceLabel
}

function RegionsSection({ regions, plans, onCreate, onEdit }: { regions: CustomerRegion[]; plans: Plan[]; onCreate: () => void; onEdit: (region: CustomerRegion) => void }) {
  const { t } = useI18n()
  return <>
    <div className="admin-section-heading">
      <div><h2>{t('admin.region.title')}</h2><p>{t('admin.region.description')}</p></div>
      <Button onClick={onCreate}><Plus size={17} /> {t('admin.region.new')}</Button>
    </div>
    <div className="admin-region-grid">
      <div className="admin-region-list-heading" aria-hidden="true">
        <span>{t('admin.region.name')}</span>
        <span>{t('admin.region.currency')} · {t('admin.region.defaultLanguage')}</span>
        <span>{t('admin.region.defaultPlan')} · {t('admin.region.plans')}</span>
        <span>{t('admin.region.paymentMethods')}</span>
        <span>{t('common.edit')}</span>
      </div>
      {regions.map((region) => {
        const regionPlans = plans.filter((plan) => plan.region_id === region.id)
        return <Panel key={region.id} className={`admin-region-card ${!region.active ? 'is-inactive' : ''}`}>
          <header className="admin-region-card__identity">
            <span className="admin-region-card__icon"><Globe2 size={21} /></span>
            <span><strong>{region.name}</strong><small>{region.code}</small></span>
            <span className="admin-region-card__badges">{region.default && <Badge tone="success">{t('admin.region.default')}</Badge>}<Badge tone={region.active ? 'info' : 'neutral'}>{t(region.active ? 'admin.region.active' : 'admin.region.draft')}</Badge></span>
          </header>
          <dl className="admin-region-card__market">
            <div><dt>{t('admin.region.currency')}</dt><dd>{region.currency}</dd></div>
            <div><dt>{t('admin.region.defaultLanguage')}</dt><dd>{localeOptions.find((item) => item.code === region.default_locale)?.native ?? region.default_locale}</dd></div>
          </dl>
          <dl className="admin-region-card__plans">
            <div><dt>{t('admin.region.defaultPlan')}</dt><dd>{regionPlans.find((plan) => plan.code === region.default_plan_code)?.name ?? t('admin.region.notConfigured')}</dd></div>
            <div><dt>{t('admin.region.plans')}</dt><dd>{regionPlans.length}</dd></div>
          </dl>
          <div className="admin-region-card__providers"><span>{t('admin.region.paymentMethods')}</span><div>{region.payment_providers.map((provider) => <Badge key={provider} tone="neutral">{providerName(provider, t('admin.payment.invoice'))}</Badge>)}</div></div>
          <IconButton className="admin-region-card__edit" label={t('admin.region.editNamed', { name: region.name })} onClick={() => onEdit(region)}><Pencil size={17} /></IconButton>
        </Panel>
      })}
    </div>
  </>
}

type RegionDraft = Omit<CustomerRegion, 'id' | 'created_at' | 'updated_at'>

const emptyRegion: RegionDraft = {
  code: '', name: '', default_locale: 'en', currency: 'USD', payment_providers: ['manual'],
  default_plan_code: '', active: false, default: false,
}

function RegionModal({ open, region, plans, busy, onClose, onSave }: { open: boolean; region: CustomerRegion | null; plans: Plan[]; busy: boolean; onClose: () => void; onSave: (region: RegionDraft) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<RegionDraft>(emptyRegion)
  useEffect(() => {
    if (!open) return
    setDraft(region ? {
      code: region.code, name: region.name, default_locale: region.default_locale, currency: region.currency,
      payment_providers: [...region.payment_providers], default_plan_code: region.default_plan_code,
      active: region.active, default: region.default,
    } : { ...emptyRegion, payment_providers: [...emptyRegion.payment_providers] })
  }, [open, region])
  const regionPlans = region ? plans.filter((plan) => plan.region_id === region.id && plan.active && plan.currency === draft.currency) : []
  const toggleProvider = (provider: PaymentProvider, checked: boolean) => {
    const next = checked ? [...new Set([...draft.payment_providers, provider])] : draft.payment_providers.filter((item) => item !== provider)
    setDraft({ ...draft, payment_providers: next })
  }
  const valid = /^[a-z0-9][a-z0-9-]{1,63}$/.test(draft.code)
    && draft.name.trim().length >= 2
    && /^[A-Z]{3}$/.test(draft.currency)
    && draft.payment_providers.length > 0
    && (!draft.active || Boolean(draft.default_plan_code))
    && (!draft.default || draft.active)
  return <Modal open={open} onClose={onClose} title={t(region ? 'admin.region.edit' : 'admin.region.create')} icon={<Globe2 size={29} />} width="lg">
    <form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSave(draft) }}>
      {!region && <div className="admin-callout"><Globe2 size={20} /><span>{t('admin.region.newHint')}</span></div>}
      <div className="form-grid">
        <Field label={t('admin.region.name')}><input maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Georgia" /></Field>
        <Field label={t('admin.region.code')} hint={t('admin.region.codeHint')}><input maxLength={64} value={draft.code} disabled={Boolean(region)} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="georgia" /></Field>
        <Field label={t('admin.region.defaultLanguage')}><Select value={draft.default_locale} onChange={(event) => setDraft({ ...draft, default_locale: event.target.value as Locale })}>{localeOptions.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}</Select></Field>
        <Field label={t('admin.region.currency')} hint={t(regionPlans.length > 0 ? 'admin.region.currencyLocked' : 'admin.region.currencyHint')}><input maxLength={3} value={draft.currency} disabled={regionPlans.length > 0} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></Field>
      </div>
      <div className="admin-region-provider-fieldset">
        <h3>{t('admin.region.allowedPayments')}</h3>
        <p>{t('admin.region.checkoutCurrency', { currency: draft.currency })}</p>
        <div className="admin-toggle-grid">
          {(['manual', 'keepz', 'cloudpayments'] as PaymentProvider[]).map((provider) => {
            const name = providerName(provider, t('admin.payment.invoice'))
            return <div className="admin-toggle-row" key={provider}><Toggle checked={draft.payment_providers.includes(provider)} onChange={(checked) => toggleProvider(provider, checked)} label={t('admin.region.allowProvider', { provider: name })} /><span><strong>{name}</strong><small>{provider === 'manual' ? t('admin.region.manualHint') : t('admin.region.onlineHint', { currency: draft.currency })}</small></span></div>
          })}
        </div>
      </div>
      <Field label={t('admin.region.registrationPlan')} hint={t(region ? 'admin.region.registrationPlanHint' : 'admin.region.registrationPlanNewHint')}>
        <Select value={draft.default_plan_code} disabled={!region || regionPlans.length === 0} onChange={(event) => setDraft({ ...draft, default_plan_code: event.target.value })}>
          <option value="">{t('admin.region.notConfigured')}</option>
          {regionPlans.map((plan) => <option key={plan.id} value={plan.code}>{plan.name} · {plan.code}</option>)}
        </Select>
      </Field>
      <div className="admin-toggle-grid">
        <div className="admin-toggle-row"><Toggle checked={draft.active} disabled={!draft.default_plan_code} onChange={(active) => setDraft({ ...draft, active, default: active ? draft.default : false })} label={t('admin.region.activeRegion')} /><span><strong>{t('admin.region.acceptRegistrations')}</strong><small>{t('admin.region.acceptRegistrationsHint')}</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={draft.default} disabled={!draft.active} onChange={(value) => setDraft({ ...draft, default: value })} label={t('admin.region.defaultRegion')} /><span><strong>{t('admin.region.systemDefault')}</strong><small>{t('admin.region.systemDefaultHint')}</small></span></div>
      </div>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || !valid}>{t('admin.region.save')}</Button></div>
    </form>
  </Modal>
}

function PlansSection({ plans, regions, billingSettings, busy, onDiscount, onCreate, onEdit, onDelete }: { plans: Plan[]; regions: CustomerRegion[]; billingSettings: BillingSettings | null; busy: boolean; onDiscount: (value: number) => void; onCreate: () => void; onEdit: (plan: Plan) => void; onDelete: (plan: Plan) => void }) {
  const { t } = useI18n()
  const [discount, setDiscount] = useState(0)
  const [regionFilter, setRegionFilter] = useState('all')
  useEffect(() => setDiscount(billingSettings?.annual_discount_percent ?? 0), [billingSettings?.annual_discount_percent])
  const visiblePlans = regionFilter === 'all' ? plans : plans.filter((plan) => plan.region_id === regionFilter)
  return <>
    <div className="admin-section-heading"><div><h2>{t('admin.plan.title')}</h2><p>{t('admin.plan.description')}</p></div><div className="admin-section-heading__actions"><Select aria-label={t('admin.plan.filterRegion')} value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}><option value="all">{t('admin.plan.allRegions')}</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</Select><Button onClick={onCreate}><Plus size={17} /> {t('admin.plan.new')}</Button></div></div>
    <Panel className="admin-billing-settings">
      <span><CalendarDiscountIcon /><span><strong>{t('admin.plan.annualDiscount')}</strong><small>{t('admin.plan.annualDiscountHint')}</small></span></span>
      <label><span className="sr-only">{t('admin.plan.discountPercent')}</span><input type="number" min="0" max="100" step="1" value={discount} onChange={(event) => setDiscount(Math.min(100, Math.max(0, Math.trunc(Number(event.target.value) || 0))))} /><b>%</b></label>
      <Button size="sm" variant="secondary" disabled={busy || discount === billingSettings?.annual_discount_percent} onClick={() => onDiscount(discount)}>{t('admin.plan.saveDiscount')}</Button>
    </Panel>
    <div className="admin-plan-grid">{visiblePlans.map((plan) => <Panel key={plan.id} className={!plan.active ? 'is-inactive' : ''}><div className="admin-plan-header"><div><span className="admin-plan-badges"><Badge tone={plan.public ? 'success' : 'neutral'}>{t(plan.public ? 'admin.plan.public' : 'admin.plan.private')}</Badge><Badge tone="info">{regions.find((region) => region.id === plan.region_id)?.name ?? t('admin.plan.unknownRegion')}</Badge></span><h3>{plan.name}</h3><code>{plan.code}</code></div><div><IconButton label={t('admin.plan.editNamed', { name: plan.name })} onClick={() => onEdit(plan)}><Pencil size={17} /></IconButton><IconButton label={t('admin.plan.deleteNamed', { name: plan.name })} onClick={() => onDelete(plan)}><Trash2 size={17} /></IconButton></div></div><p>{plan.description || t('admin.plan.noDescription')}</p><strong className="admin-plan-price">{(plan.price_monthly_cents / 100).toLocaleString(undefined, { style: 'currency', currency: plan.currency })}<small>{t('admin.plan.perMonth')}</small></strong><small className="admin-plan-yearly">{((plan.price_monthly_cents * 12 * (100 - (billingSettings?.annual_discount_percent ?? 0))) / 10000).toLocaleString(undefined, { style: 'currency', currency: plan.currency })}{t('admin.plan.perYearSave', { discount: billingSettings?.annual_discount_percent ?? 0 })}</small><dl><div><dt>{t('admin.plan.monitors')}</dt><dd>{plan.limits.max_monitors}</dd></div><div><dt>{t('admin.plan.fastestInterval')}</dt><dd>{plan.limits.min_interval_seconds}s</dd></div><div><dt>{t('admin.plan.teamMembers')}</dt><dd>{plan.limits.max_team_members}</dd></div><div><dt>{t('admin.plan.statusPages')}</dt><dd>{plan.limits.max_status_pages}</dd></div><div><dt>{t('admin.plan.integrations')}</dt><dd>{plan.limits.max_integrations}</dd></div><div><dt>{t('admin.plan.locations')}</dt><dd>{plan.limits.max_locations}</dd></div><div><dt>{t('admin.plan.retention')}</dt><dd>{t('admin.plan.days', { count: plan.limits.data_retention_days })}</dd></div><div><dt>{t('admin.plan.manualTest')}</dt><dd>{t(plan.limits.allow_manual_tests ? 'admin.plan.included' : 'admin.plan.notIncluded')}</dd></div></dl></Panel>)}</div>
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
  loadingWorkspaces,
  onLoadMore,
  onSearchWorkspaces,
  onOpen,
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
  loadingWorkspaces: boolean
  onLoadMore: () => void
  onSearchWorkspaces: (term: string) => void
  onOpen: (invoice: Invoice) => void
  billingSettings: BillingSettings | null
  onIssuer: (issuer: InvoiceIssuerProfile) => void
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'all' | Invoice['status']>('all')
  const [issuerOpen, setIssuerOpen] = useState(false)
  const [workspaceDirectoryOpen, setWorkspaceDirectoryOpen] = useState(false)
  const searchedForWorkspace = workspaceQuery.trim().length > 0
  const visible = status === 'all' ? invoices : invoices.filter((invoice) => invoice.status === status)

  useEffect(() => {
    if (!workspaceDirectoryOpen) return
    const term = workspaceQuery.trim()
    if (!term) {
      onSearchWorkspaces('')
      return
    }
    const timer = window.setTimeout(() => onSearchWorkspaces(term), 300)
    return () => window.clearTimeout(timer)
  }, [onSearchWorkspaces, workspaceDirectoryOpen, workspaceQuery])

  const closeWorkspaceDirectory = () => {
    setWorkspaceDirectoryOpen(false)
    setWorkspaceQuery('')
    onSearchWorkspaces('')
  }

  const changeWorkspaceQuery = (value: string) => {
    setWorkspaceQuery(value)
    onSearchWorkspaces('')
  }

  return <>
    <section className="admin-invoice-tools" aria-label={t('admin.invoice.settings')}>
      <button type="button" onClick={() => setIssuerOpen(true)} disabled={!billingSettings}>
        <span className="admin-invoice-tools__icon"><Landmark size={20} /></span>
        <span><strong>{t('admin.invoice.details')}</strong><small>{billingSettings?.invoice_issuer?.legal_name || t('admin.invoice.addDetails')}</small></span>
        <ChevronRight size={18} />
      </button>
      <button type="button" onClick={() => setWorkspaceDirectoryOpen(true)}>
        <span className="admin-invoice-tools__icon"><CreditCard size={20} /></span>
        <span><strong>{t('admin.invoice.regionalPolicies')}</strong><small>{t('admin.invoice.searchPlaceholder')}</small></span>
        <ChevronRight size={18} />
      </button>
    </section>
    {billingSettings && <InvoiceIssuerEditor open={issuerOpen} onClose={() => setIssuerOpen(false)} value={billingSettings.invoice_issuer} busy={busy} onSave={onIssuer} />}
    <Modal open={workspaceDirectoryOpen} onClose={closeWorkspaceDirectory} title={t('admin.invoice.regionalPolicies')} icon={<Globe2 size={29} />} width="lg" className="admin-workspace-directory-modal">
      <div className="admin-billing-workspace-directory">
      <p className="admin-workspace-directory-modal__intro">{t('admin.invoice.policyIntro')}</p>
      <div className="admin-billing-workspace-search" role="search">
        <label>
          <Search size={18} />
          <span className="sr-only">{t('admin.invoice.searchWorkspaces')}</span>
          <input value={workspaceQuery} onChange={(event) => changeWorkspaceQuery(event.target.value)} placeholder={t('admin.invoice.searchPlaceholder')} autoComplete="off" />
        </label>
        {loadingWorkspaces && <span className="admin-billing-workspace-search__loading" aria-label={t('admin.invoice.searching')} />}
      </div>
      {searchedForWorkspace && <Panel className="admin-billing-workspace-panel">
        {!loadingWorkspaces && workspaces.length === 0 ? <div className="admin-billing-workspace-empty"><Search size={25} /><strong>{t('admin.invoice.noWorkspaces')}</strong><span>{t('admin.invoice.noWorkspacesHint')}</span></div> : <div className="admin-billing-workspace-list" role="list">
          {workspaces.map((workspace) => <article key={workspace.id} role="listitem" className="admin-billing-workspace-row">
            <span className="admin-billing-workspace-identity">
              <strong>{workspace.name}</strong>
              <small>{workspace.slug}</small>
            </span>
            <span className="admin-billing-workspace-plan"><Badge tone="neutral">{workspace.plan}</Badge><small>{workspace.region?.name ?? t('admin.user.regionUnavailable')} · {workspace.currency}</small></span>
            <span className="admin-billing-workspace-providers">
              {workspace.payment_providers.map((provider) => <Badge key={provider} tone="success">{providerName(provider, t('admin.payment.invoice'))}</Badge>)}
            </span>
          </article>)}
        </div>}
      </Panel>}
      </div>
    </Modal>
    <div className="admin-section-heading admin-invoice-heading">
      <div><h2>{t('admin.invoice.title')}</h2><p>{t('admin.invoice.description')}</p></div>
      <Select aria-label={t('admin.invoice.filterStatus')} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">{t('admin.invoice.status.all')}</option><option value="open">{t('admin.invoice.status.open')}</option><option value="paid">{t('admin.invoice.status.paid')}</option><option value="void">{t('admin.invoice.status.void')}</option></Select>
    </div>
    <Panel className="admin-invoice-list-panel">
      {visible.length > 0 && <div className="admin-invoice-list-heading" aria-hidden="true"><span>{t('admin.invoice.customerHeading')}</span><span>{t('admin.invoice.planChange')}</span><span>{t('admin.invoice.amount')}</span><span>{t('admin.invoice.status')}</span><span>{t('admin.invoice.actions')}</span></div>}
      {visible.length === 0 ? <div className="admin-invoices-empty"><ReceiptText size={30} /><strong>{t('admin.invoice.empty')}</strong><span>{t('admin.invoice.emptyHint')}</span></div> : <div className="admin-invoice-list" role="list">
        {visible.map((invoice) => <article className={`admin-invoice-row admin-invoice-row--${invoice.status}`} role="listitem" key={invoice.id}>
          <div className="admin-invoice-identity"><strong>{invoice.number}</strong><span>{invoice.workspace_name || invoice.workspace_id}</span><small>{invoice.customer_email || t('admin.invoice.workspace', { id: invoice.workspace_id })}</small></div>
          <div className="admin-invoice-change admin-invoice-cell" data-label={t('admin.invoice.planChange')}><strong>{invoice.source_plan_code} → {invoice.target_plan_code}</strong><small>{t(`admin.invoice.cycle.${invoice.billing_cycle}`)} · {t(`admin.invoice.change.${invoice.change_kind}`)}</small></div>
          <div className="admin-invoice-amount admin-invoice-cell" data-label={t('admin.invoice.amount')}><strong>{money(invoice.total_cents, invoice.currency)}</strong><small>{t('admin.invoice.dueDate', { date: formatDate(invoice.due_at) })}</small></div>
          <div className="admin-invoice-status admin-invoice-cell" data-label={t('admin.invoice.status')}><Badge tone={invoiceStatusTone(invoice.status)}>{t(`admin.invoice.status.${invoice.status}`)}</Badge><small>{providerName(invoice.payment_provider, t('admin.payment.invoice'))}</small></div>
          <div className="admin-invoice-actions admin-invoice-cell" data-label={t('admin.invoice.actions')}><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onOpen(invoice)}>{t('admin.invoice.review')}</Button></div>
        </article>)}
      </div>}
      {hasMore && <div className="admin-invoice-list-more"><Button variant="secondary" disabled={loadingMore} onClick={onLoadMore}>{t(loadingMore ? 'common.loading' : 'admin.invoice.loadOlder')}</Button></div>}
    </Panel>
  </>
}

const emptyInvoiceIssuer: InvoiceIssuerProfile = {
  legal_name: '', address: '', email: '', bank_name: '', account_number: '',
}

function InvoiceIssuerEditor({ open, onClose, value, busy, onSave }: { open: boolean; onClose: () => void; value: InvoiceIssuerProfile; busy: boolean; onSave: (issuer: InvoiceIssuerProfile) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<InvoiceIssuerProfile>(value ?? emptyInvoiceIssuer)
  useEffect(() => { if (open) setDraft(value ?? emptyInvoiceIssuer) }, [open, value])
  const field = (key: keyof InvoiceIssuerProfile, next: string) => setDraft((current) => ({ ...current, [key]: next }))
  const valid = Boolean(draft.legal_name.trim() && draft.address.trim() && draft.email.trim() && draft.bank_name.trim() && draft.account_number.trim())
  return <Modal open={open} onClose={onClose} title={t('admin.invoice.details')} icon={<Landmark size={29} />} width="lg" className="admin-invoice-issuer-modal">
    <div className="admin-invoice-issuer">
      <p>{t('admin.invoice.issuerIntro')}</p>
      <div className="admin-invoice-issuer__grid">
      <Field label={t('admin.invoice.legalName')}><input value={draft.legal_name} onChange={(event) => field('legal_name', event.target.value)} /></Field>
      <Field label={t('admin.invoice.brandName')}><input value={draft.brand_name ?? ''} onChange={(event) => field('brand_name', event.target.value)} placeholder="SSLPing" /></Field>
      <Field label={t('admin.invoice.registrationNumber')}><input value={draft.registration_number ?? ''} onChange={(event) => field('registration_number', event.target.value)} /></Field>
      <Field label={t('admin.invoice.taxId')}><input value={draft.tax_id ?? ''} onChange={(event) => field('tax_id', event.target.value)} /></Field>
      <Field label={t('admin.invoice.billingEmail')}><input type="email" value={draft.email} onChange={(event) => field('email', event.target.value)} /></Field>
      <Field label={t('admin.invoice.phone')}><input value={draft.phone ?? ''} onChange={(event) => field('phone', event.target.value)} /></Field>
      <Field label={t('admin.invoice.legalAddress')} className="admin-invoice-issuer__wide"><textarea value={draft.address} onChange={(event) => field('address', event.target.value)} /></Field>
      <Field label={t('admin.invoice.bankName')}><input value={draft.bank_name} onChange={(event) => field('bank_name', event.target.value)} /></Field>
      <Field label={t('admin.invoice.accountName')}><input value={draft.account_name ?? ''} onChange={(event) => field('account_name', event.target.value)} /></Field>
      <Field label={t('admin.invoice.accountNumber')}><input value={draft.account_number} onChange={(event) => field('account_number', event.target.value)} /></Field>
      <Field label={t('admin.invoice.swift')}><input value={draft.swift ?? ''} onChange={(event) => field('swift', event.target.value)} /></Field>
      <Field label={t('admin.invoice.bankAddress')} className="admin-invoice-issuer__wide"><textarea value={draft.bank_address ?? ''} onChange={(event) => field('bank_address', event.target.value)} /></Field>
      <Field label={t('admin.invoice.correspondentBank')} className="admin-invoice-issuer__wide"><textarea value={draft.correspondent_bank ?? ''} onChange={(event) => field('correspondent_bank', event.target.value)} /></Field>
      <Field label={t('admin.invoice.paymentInstructions')} className="admin-invoice-issuer__wide"><textarea value={draft.payment_instructions ?? ''} onChange={(event) => field('payment_instructions', event.target.value)} placeholder={t('admin.invoice.paymentInstructionsPlaceholder')} /></Field>
      </div>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('shell.close')}</Button><Button type="button" disabled={busy || !valid || JSON.stringify(draft) === JSON.stringify(value)} onClick={() => onSave(draft)}>{t('admin.invoice.saveDetails')}</Button></div>
    </div>
  </Modal>
}

function InvoiceModal({ invoice, workspaceName, busy, canVoid, onClose, onDownload, onPaid, onVoid }: { invoice: Invoice | null; workspaceName: string; busy: boolean; canVoid: boolean; onClose: () => void; onDownload: (invoice: Invoice) => void; onPaid: (invoice: Invoice, note: string, paidAt: string) => void; onVoid: (invoice: Invoice, note: string) => void }) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [paidAt, setPaidAt] = useState('')
  useEffect(() => { setNote(''); setPaidAt('') }, [invoice?.id])
  return <Modal open={Boolean(invoice)} onClose={onClose} title={invoice ? t('admin.invoice.named', { number: invoice.number }) : t('admin.payment.invoice')} icon={<ReceiptText size={29} />} width="lg" className="admin-invoice-modal">
    {invoice && <div className="admin-invoice-detail">
      <div className="admin-invoice-customer"><span><small>{t('admin.invoice.customer')}</small><strong>{invoice.workspace_name || workspaceName || invoice.workspace_id}</strong><span>{invoice.customer_email || invoice.workspace_id}</span></span><Badge tone={invoiceStatusTone(invoice.status)}>{t(`admin.invoice.status.${invoice.status}`)}</Badge></div>
      <dl className="admin-invoice-breakdown">
        <div><dt>{t('admin.invoice.change')}</dt><dd>{invoice.source_plan_code} → {invoice.target_plan_code}</dd></div><div><dt>{t('admin.invoice.billing')}</dt><dd>{t(`admin.invoice.cycle.${invoice.billing_cycle}`)}</dd></div><div><dt>{t('admin.invoice.provider')}</dt><dd>{providerName(invoice.payment_provider, t('admin.payment.invoice'))}</dd></div>
        <div><dt>{t('admin.invoice.planTerm')}</dt><dd>{money(invoice.subtotal_cents, invoice.currency)}</dd></div><div><dt>{t('admin.invoice.annualDiscount')}</dt><dd>−{money(invoice.annual_discount_cents, invoice.currency)}</dd></div><div><dt>{t('admin.invoice.unusedCredit')}</dt><dd>−{money(invoice.unused_credit_cents, invoice.currency)}</dd></div>
        <div className="admin-invoice-breakdown__total"><dt>{t('admin.invoice.total')}</dt><dd>{money(invoice.total_cents, invoice.currency)}</dd></div><div><dt>{t('admin.invoice.due')}</dt><dd>{formatDate(invoice.due_at)}</dd></div><div><dt>{t('admin.invoice.term')}</dt><dd>{formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}</dd></div>
      </dl>
      <div className="admin-invoice-document-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => onDownload(invoice)}><Download size={16} /> {t('admin.invoice.downloadPdf')}</Button></div>
      {invoice.status === 'open' && <div className="admin-invoice-resolution">
        <div className="admin-invoice-payment-fields">
          <Field label={t('admin.invoice.receivedAt')} hint={t('admin.invoice.receivedAtHint')}>
            <input type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          </Field>
          <Field label={t('admin.invoice.paymentNote')} hint={t('admin.invoice.paymentNoteHint')}>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('admin.invoice.paymentNotePlaceholder')} />
          </Field>
        </div>
        <div className="admin-invoice-resolution__actions">{canVoid && <Button variant="danger" disabled={busy} onClick={() => onVoid(invoice, note)}><Ban size={16} /> {t('admin.invoice.void')}</Button>}<Button variant="success" disabled={busy} onClick={() => onPaid(invoice, note, paidAt)}><FileCheck2 size={16} /> {t('admin.invoice.markPaid')}</Button></div>
      </div>}
      {invoice.status === 'paid' && <div className="admin-payment-result admin-payment-result--paid"><FileCheck2 size={20} /><span><strong>{t('admin.invoice.paymentConfirmed')}</strong><small>{invoice.paid_at ? t('admin.invoice.markedPaid', { date: formatDate(invoice.paid_at) }) : t('admin.invoice.planActive')}</small></span></div>}
      {invoice.status === 'void' && <div className="admin-payment-result"><Ban size={20} /><span><strong>{t('admin.invoice.voided')}</strong><small>{t('admin.invoice.noUpgrade')}</small></span></div>}
    </div>}
  </Modal>
}

function TicketsSection({ tickets, users, busy, onOpen }: { tickets: SupportTicket[]; users: AdminUser[]; busy: boolean; onOpen: (ticket: SupportTicket) => void }) {
  const { t } = useI18n()
  const userName = (id: string) => users.find((entry) => entry.id === id)?.name ?? id.slice(0, 8)
  return <Panel className="admin-ticket-list-panel">
    {tickets.length > 0 && <div className="admin-ticket-list-heading" aria-hidden="true">
      <span>{t('admin.ticket.customerHeading')}</span>
      <span>{t('admin.ticket.state')}</span>
      <span>{t('admin.ticket.lastActivity')}</span>
      <span>{t('admin.ticket.actions')}</span>
    </div>}
    {tickets.length === 0 ? <div className="admin-tickets-empty"><MessageSquare size={30} /><strong>{t('admin.ticket.empty')}</strong><span>{t('admin.ticket.emptyHint')}</span></div> : (
      <div className="admin-ticket-list" role="list">
        {tickets.map((ticket) => <article className={`admin-ticket-row ${ticket.unread_count > 0 ? 'is-unread' : ''}`} role="listitem" key={ticket.id}>
          <div className="admin-ticket-identity">
            <strong>{ticket.subject}</strong>
            <small title={ticket.id}>{ticket.id}</small>
            <span>{t('admin.ticket.customer')} · {userName(ticket.created_by)}</span>
            {ticket.unread_count > 0 && <b className="admin-ticket-unread">{ticket.unread_count === 1 ? t('admin.ticket.newActivity') : t('admin.ticket.newActivities', { count: ticket.unread_count })}</b>}
          </div>
          <div className="admin-ticket-state admin-ticket-cell" data-label={t('admin.ticket.state')}>
            <Badge tone={ticket.priority === 'urgent' ? 'danger' : ticket.priority === 'high' ? 'warning' : 'neutral'}>{t(`admin.ticket.priority.${ticket.priority}`)}</Badge>
            <Badge tone={statusTone(ticket.status)}>{t(`admin.ticket.status.${ticket.status}`)}</Badge>
          </div>
          <div className="admin-ticket-activity admin-ticket-cell" data-label={t('admin.ticket.lastActivity')}>
            <small>{t('admin.ticket.lastActivity')}</small>
            <time dateTime={ticket.last_reply_at}>{formatDate(ticket.last_reply_at)}</time>
          </div>
          <div className="admin-ticket-actions admin-ticket-cell" data-label={t('admin.ticket.actions')}>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onOpen(ticket)}>{t('admin.ticket.openConversation')}</Button>
          </div>
        </article>)}
      </div>
    )}
  </Panel>
}

function NotificationsSection({ channels, onCreate, onTest, onToggle, onDelete }: { channels: SupportNotificationChannel[]; onCreate: () => void; onTest: (channel: SupportNotificationChannel) => void; onToggle: (channel: SupportNotificationChannel) => void; onDelete: (channel: SupportNotificationChannel) => void }) {
  const { t } = useI18n()
  return <><div className="admin-section-heading"><div><h2>{t('admin.notification.title')}</h2><p>{t('admin.notification.description')}</p></div><Button onClick={onCreate}><Plus size={17} /> {t('admin.notification.add')}</Button></div><div className="admin-channel-list">{channels.length === 0 ? <Panel className="empty-state"><BellRing size={34} /><h2>{t('admin.notification.empty')}</h2><p>{t('admin.notification.emptyHint')}</p></Panel> : channels.map((channel) => <Panel key={channel.id}><span className="admin-channel-icon"><BellRing size={21} /></span><span><strong>{channel.name}</strong><small>{channel.type} · {channel.last_delivery_at ? t('admin.notification.lastAttempted', { date: formatDate(channel.last_delivery_at) }) : t('admin.notification.notTested')}</small>{channel.last_delivery_error && <em>{channel.last_delivery_error}</em>}</span><Toggle checked={channel.active} onChange={() => void onToggle(channel)} label={t('admin.notification.enable', { name: channel.name })} /><Button size="sm" variant="secondary" onClick={() => void onTest(channel)}>{t('admin.notification.sendTest')}</Button><IconButton label={t('admin.notification.delete', { name: channel.name })} onClick={() => void onDelete(channel)}><Trash2 size={17} /></IconButton></Panel>)}</div></>
}

type UserAdminInput = {
  name: string
  system_role: AdminUser['system_role']
  email_verified: boolean
  revoke_sessions: boolean
  locale: Locale
  region_id: string
}

function UserModal({ user, regions, busy, onClose, onSave }: { user: AdminUser | null; regions: CustomerRegion[]; busy: boolean; onClose: () => void; onSave: (user: AdminUser, input: UserAdminInput) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [role, setRole] = useState<AdminUser['system_role']>('user')
  const [locale, setLocale] = useState<Locale>('en')
  const [regionID, setRegionID] = useState('')
  const [verified, setVerified] = useState(false)
  const [revoke, setRevoke] = useState(false)
  useEffect(() => {
    if (!user) return
    setName(user.name)
    setRole(user.system_role)
    setLocale(user.locale)
    setRegionID(user.region_id ?? user.region?.id ?? '')
    setVerified(Boolean(user.email_verified_at))
    setRevoke(false)
  }, [user])
  const originalRegionID = user?.region_id ?? user?.region?.id ?? ''
  const regionChanged = Boolean(user && regionID && regionID !== originalRegionID)
  const selectableRegions = regions.filter((region) => region.active || region.id === originalRegionID)
  return <Modal open={Boolean(user)} onClose={onClose} title={t('admin.user.manageTitle')} icon={<Settings2 size={29} />} width="lg">
    {user && <form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave(user, { name: name.trim(), system_role: role, email_verified: verified, revoke_sessions: revoke, locale, region_id: regionID }) }}>
      <div className="admin-person"><strong>{user.email}</strong><span>{t('admin.user.registered', { date: formatDate(user.created_at) })}</span></div>
      <div className="form-grid">
        <Field label={t('admin.user.displayName')}><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label={t('admin.user.systemRole')}><Select value={role} onChange={(event) => setRole(event.target.value as AdminUser['system_role'])}><option value="user">{t('admin.user.roleRegular')}</option><option value="accountant">{t('admin.user.roleAccountant')}</option><option value="superadmin">{t('admin.user.roleSuperadmin')}</option></Select></Field>
        <Field label={t('admin.user.commercialRegion')} hint={t('admin.user.regionHint')}><Select value={regionID} onChange={(event) => setRegionID(event.target.value)}><option value="" disabled>{t('admin.user.selectRegion')}</option>{selectableRegions.map((region) => <option key={region.id} value={region.id}>{region.name} · {region.currency}{region.active ? '' : ` · ${t('admin.user.inactive')}`}</option>)}</Select></Field>
        <Field label={t('admin.user.dashboardLanguage')} hint={t('admin.user.languageHint')}><Select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>{localeOptions.map((option) => <option key={option.code} value={option.code}>{option.native}</option>)}</Select></Field>
      </div>
      {regionChanged && <div className="admin-callout admin-callout--warning"><Globe2 size={20} /><span><strong>{t('admin.user.regionMigration')}</strong> {t('admin.user.regionMigrationHint')}</span></div>}
      <div className="admin-toggle-grid">
        <div className="admin-toggle-row"><Toggle checked={verified} onChange={setVerified} label={t('admin.user.emailVerified')} /><span><strong>{t('admin.user.emailVerified')}</strong><small>{t('admin.user.emailVerifiedHint')}</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={revoke} onChange={setRevoke} label={t('admin.user.revokeSessions')} /><span><strong>{t('admin.user.revokeSessions')}</strong><small>{t('admin.user.revokeSessionsHint')}</small></span></div>
      </div>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || name.trim().length < 2 || !regionID}>{t('admin.user.save')}</Button></div>
    </form>}
  </Modal>
}

type PlanDraft = Omit<Plan, 'id' | 'created_at' | 'updated_at' | 'region_id'> & { region_id: string }

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
  ['max_monitors', 'admin.plan.monitors'],
  ['min_interval_seconds', 'admin.plan.minimumInterval'],
  ['max_team_members', 'admin.plan.teamMembers'],
  ['max_status_pages', 'admin.plan.statusPages'],
  ['max_integrations', 'admin.plan.integrations'],
  ['max_locations', 'admin.plan.locations'],
  ['data_retention_days', 'admin.plan.retentionDays'],
]

function minimumPlanLimit(key: NumericPlanLimit) {
  if (key === 'min_interval_seconds') return 10
  if (key === 'max_status_pages' || key === 'max_integrations') return 0
  return 1
}

export function PlanModal({ open, plan, regions, busy, onClose, onSave }: { open: boolean; plan: Plan | null; regions: CustomerRegion[]; busy: boolean; onClose: () => void; onSave: (plan: PlanDraft) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<PlanDraft>({ code: '', name: '', description: '', price_monthly_cents: 0, currency: 'USD', region_id: '', public: true, active: true, limits: emptyLimits })
  const [priceInput, setPriceInput] = useState('0')
  useEffect(() => {
    const initialRegion = regions.find((region) => region.default) ?? regions.find((region) => region.active) ?? regions[0]
    const next: PlanDraft = plan
      ? { code: plan.code, name: plan.name, description: plan.description, price_monthly_cents: plan.price_monthly_cents, currency: plan.currency, region_id: plan.region_id ?? '', public: plan.public, active: plan.active, limits: { ...plan.limits } }
      : { code: '', name: '', description: '', price_monthly_cents: 0, currency: initialRegion?.currency ?? 'USD', region_id: initialRegion?.id ?? '', public: true, active: true, limits: { ...emptyLimits } }
    setDraft(next)
    setPriceInput(majorPriceInput(next.price_monthly_cents))
  }, [open, plan, regions])
  const parsedPrice = parseMajorPrice(priceInput)
  const validLimits = numericPlanLimits.every(([key]) => draft.limits[key] >= minimumPlanLimit(key))
  const limit = (key: NumericPlanLimit, value: string) => {
    const minimum = minimumPlanLimit(key)
    setDraft((current) => ({ ...current, limits: { ...current.limits, [key]: Math.max(minimum, Number(value) || minimum) } }))
  }
  const planCodeValid = /^[a-z0-9][a-z0-9_-]{1,63}$/.test(draft.code)
  const planNameValid = draft.name.trim().length >= 2 && draft.name.trim().length <= 120
  const valid = planNameValid && planCodeValid && Boolean(draft.region_id) && /^[A-Z]{3}$/.test(draft.currency) && parsedPrice !== null && validLimits

  return <Modal open={open} onClose={onClose} title={t(plan ? 'admin.plan.edit' : 'admin.plan.create')} icon={<CreditCard size={29} />} width="lg">
    <form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); if (parsedPrice !== null) onSave({ ...draft, price_monthly_cents: parsedPrice }) }}>
      <div className="form-grid">
        <Field label={t('admin.plan.name')} error={draft.name.length > 0 && !planNameValid ? t('admin.plan.nameError') : undefined}><input maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label={t('admin.plan.code')} error={draft.code.length > 0 && !planCodeValid ? t('admin.plan.codeError') : undefined}><input maxLength={64} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} /></Field>
        <Field label={t('admin.user.commercialRegion')} hint={t(plan ? 'admin.plan.regionLocked' : 'admin.plan.regionHint')}><Select value={draft.region_id} disabled={Boolean(plan)} onChange={(event) => { const selected = regions.find((region) => region.id === event.target.value); setDraft({ ...draft, region_id: event.target.value, currency: selected?.currency ?? draft.currency }) }}><option value="" disabled>{t('admin.user.selectRegion')}</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.name} · {region.currency}</option>)}</Select></Field>
        <Field label={t('admin.region.currency')} hint={t('admin.plan.currencyHint')}><input value={draft.currency} readOnly /></Field>
        <Field label={t('admin.plan.monthlyPrice')} hint={t('admin.plan.amountIn', { currency: draft.currency })} error={priceInput.trim() && parsedPrice === null ? t('admin.plan.priceError') : undefined}>
          <input type="text" inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} />
        </Field>
      </div>
      <Field label={t('admin.plan.descriptionField')}><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
      <h3 className="form-section__title">{t('admin.plan.enforcedLimits')}</h3>
      <div className="form-grid form-grid--three">
        {numericPlanLimits.map(([key,label]) => <Field key={key} label={t(label)}>
          <input type="number" min={minimumPlanLimit(key)} step="1" value={draft.limits[key]} onChange={(event) => limit(key, event.target.value)} />
        </Field>)}
      </div>
      <div className="admin-toggle-grid">
        <div className="admin-toggle-row"><Toggle checked={draft.limits.allow_manual_tests} onChange={(value) => setDraft({ ...draft, limits: { ...draft.limits, allow_manual_tests: value } })} label={t('admin.plan.manualTest')} /><span><strong>{t('admin.plan.manualTest')}</strong><small>{t('admin.plan.manualTestHint')}</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={draft.public} onChange={(value) => setDraft({ ...draft, public: value })} label={t('admin.plan.publicPlan')} /><span><strong>{t('admin.plan.publicPlan')}</strong><small>{t('admin.plan.publicPlanHint')}</small></span></div>
        <div className="admin-toggle-row"><Toggle checked={draft.active} onChange={(value) => setDraft({ ...draft, active: value })} label={t('admin.plan.activePlan')} /><span><strong>{t('admin.plan.activePlan')}</strong><small>{t('admin.plan.activePlanHint')}</small></span></div>
      </div>
      <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || !valid}>{t('admin.plan.save')}</Button></div>
    </form>
  </Modal>
}

export function TicketModal({ detail, users, busy, reply, internal, files, onClose, onReply, onInternal, onFiles, onOpenAttachment, onUpdate, onSubmit }: { detail: SupportTicketDetail | null; users: AdminUser[]; busy: boolean; reply: string; internal: boolean; files: File[]; onClose: () => void; onReply: (value: string) => void; onInternal: (value: boolean) => void; onFiles: (files: File[]) => void; onOpenAttachment: (attachment: SupportAttachment) => void; onUpdate: (patch: Partial<Pick<SupportTicket, 'status' | 'priority'>>) => void; onSubmit: (event: FormEvent, internal: boolean) => void }) {
  const { t } = useI18n()
  const author = (message: SupportMessage) => users.find((entry) => entry.id === message.author_id)?.name ?? t(message.author_role === 'superadmin' ? 'admin.ticket.support' : 'admin.ticket.customer')
  return (
    <Modal
      open={Boolean(detail)}
      onClose={onClose}
      title={detail?.ticket.subject ?? t('admin.ticket.title')}
      icon={<MessageSquare size={29} />}
      width="xl"
      className="admin-ticket-modal"
    >
      {detail && (
        <div className="admin-ticket-detail">
          <div className="form-grid admin-ticket-controls">
            <Field label={t('admin.ticket.status')}>
              <Select value={detail.ticket.status} disabled={busy} onChange={(event) => void onUpdate({ status: event.target.value as SupportTicketStatus })}>
                <option value="open">{t('admin.ticket.status.open')}</option>
                <option value="in_progress">{t('admin.ticket.status.in_progress')}</option>
                <option value="waiting">{t('admin.ticket.status.waiting')}</option>
                <option value="resolved">{t('admin.ticket.status.resolved')}</option>
                <option value="closed">{t('admin.ticket.status.closed')}</option>
              </Select>
            </Field>
            <Field label={t('admin.ticket.priority')}>
              <Select value={detail.ticket.priority} disabled={busy} onChange={(event) => void onUpdate({ priority: event.target.value as SupportTicketPriority })}>
                <option value="low">{t('admin.ticket.priority.low')}</option>
                <option value="normal">{t('admin.ticket.priority.normal')}</option>
                <option value="high">{t('admin.ticket.priority.high')}</option>
                <option value="urgent">{t('admin.ticket.priority.urgent')}</option>
              </Select>
            </Field>
          </div>

          <div className="admin-ticket-messages">
            {detail.messages.map((message) => (
              <article key={message.id} className={message.internal ? 'is-internal' : ''}>
                <div><strong>{author(message)}</strong>{message.internal && <Badge tone="warning">{t('admin.ticket.internalNote')}</Badge>}<time>{formatDate(message.created_at)}</time></div>
                <p>{message.body}</p>
                {supportAttachmentsAvailable && <AttachmentList attachments={message.attachments} onOpen={onOpenAttachment} busy={busy} />}
              </article>
            ))}
          </div>

          <form className="admin-ticket-reply-form" onSubmit={(event) => onSubmit(event, internal)}>
            <Field label={t(internal ? 'admin.ticket.internalNote' : 'admin.ticket.replyCustomer')}>
              <textarea value={reply} onChange={(event) => onReply(event.target.value)} />
            </Field>
            {supportAttachmentsAvailable && <AttachmentPicker files={files} onChange={onFiles} disabled={busy} />}
            <div className="admin-ticket-compose">
              <div className="admin-toggle-row">
                <Toggle checked={internal} onChange={onInternal} label={t('admin.ticket.internalNote')} disabled={busy} />
                <span><strong>{t('admin.ticket.internalNote')}</strong><small>{t('admin.ticket.hidden')}</small></span>
              </div>
              <Button type="submit" disabled={busy || reply.trim().length < 1}><Send size={16} /> {t(internal ? 'admin.ticket.addNote' : 'admin.ticket.sendReply')}</Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  )
}

function ChannelModal({ open, busy, onClose, onSave }: { open: boolean; busy: boolean; onClose: () => void; onSave: (input: { name: string; type: SupportNotificationChannel['type']; config: JsonObject }) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(''); const [type, setType] = useState<SupportNotificationChannel['type']>('slack'); const [url, setURL] = useState(''); const [token, setToken] = useState(''); const [chat, setChat] = useState('')
  useEffect(() => { if (open) { setName(''); setType('slack'); setURL(''); setToken(''); setChat('') } }, [open])
  const config = (): JsonObject => type === 'telegram' ? { bot_token: token, chat_id: chat } : { url }
  const valid = name.trim().length >= 2 && (type === 'telegram' ? token.trim() && chat.trim() : /^https?:\/\//.test(url.trim()))
  return <Modal open={open} onClose={onClose} title={t('admin.notification.addTitle')} icon={<BellRing size={29} />}><form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), type, config: config() }) }}><Field label={t('admin.notification.name')}><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('admin.notification.namePlaceholder')} /></Field><Field label={t('admin.notification.channel')}><Select value={type} onChange={(event) => setType(event.target.value as SupportNotificationChannel['type'])}><option value="slack">{t('admin.notification.slack')}</option><option value="telegram">{t('admin.notification.telegram')}</option><option value="webhook">{t('admin.notification.webhook')}</option></Select></Field>{type === 'telegram' ? <div className="form-grid"><Field label={t('admin.notification.botToken')}><input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></Field><Field label={t('admin.notification.chatId')}><input value={chat} onChange={(event) => setChat(event.target.value)} /></Field></div> : <Field label={t(type === 'slack' ? 'admin.notification.slackUrl' : 'admin.notification.webhookUrl')}><input value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://…" /></Field>}<div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || !valid}>{t('admin.notification.create')}</Button></div></form></Modal>
}
