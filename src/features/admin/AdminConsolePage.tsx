import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BellRing, Check, CreditCard, LogIn, MessageSquare, Pencil, Plus, Search, Send, Settings2, Shield, Trash2, Users } from 'lucide-react'
import type { AdminUser, JsonObject, Plan, PlanLimits, SupportMessage, SupportNotificationChannel, SupportTicket, SupportTicketDetail, SupportTicketPriority, SupportTicketStatus, Workspace } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Badge, Button, Field, IconButton, Modal, PageHeader, Panel, Select, Toggle } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { saveAdministratorSession } from '../../app/impersonation'
import './admin.css'

type Section = 'users' | 'plans' | 'tickets' | 'notifications'

const emptyLimits: PlanLimits = {
  max_monitors: 100,
  min_interval_seconds: 60,
  max_team_members: 3,
  max_status_pages: 1,
  max_integrations: 3,
  max_locations: 1,
  data_retention_days: 30,
}

function asMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function statusTone(status: SupportTicketStatus) {
  if (status === 'resolved' || status === 'closed') return 'success' as const
  if (status === 'waiting') return 'warning' as const
  return 'info' as const
}

export function AdminConsolePage() {
  const { api, user } = useAuth()
  const [section, setSection] = useState<Section>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [channels, setChannels] = useState<SupportNotificationChannel[]>([])
  const [loading, setLoading] = useState(true)
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
  const [creatingChannel, setCreatingChannel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [userPage, planList, ticketPage, channelList] = await Promise.all([
        api.adminListUsers({ limit: 200 }), api.adminListPlans(), api.adminListTickets({ limit: 200 }), api.adminListNotificationChannels(),
      ])
      setUsers(userPage.items)
      setPlans(planList.items)
      setTickets(ticketPage.items)
      setChannels(channelList.items)
      setError('')
    } catch (reason) {
      setError(asMessage(reason, 'Could not load the system administration data.'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

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
    try { setTicketDetail(await api.adminGetTicket(ticket.id)); setError('') } catch (reason) { setError(asMessage(reason, 'Could not open the ticket.')) } finally { setBusy(false) }
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

  const replyTicket = async (event: FormEvent) => {
    event.preventDefault()
    if (!ticketDetail || ticketReply.trim().length < 1) return
    setBusy(true)
    try {
      const result = await api.adminReplyTicket(ticketDetail.ticket.id, { message: ticketReply.trim(), internal: internalReply })
      setTicketDetail((detail) => detail ? { ticket: result.ticket, messages: [...detail.messages, result.message] } : detail)
      setTickets((items) => items.map((item) => item.id === result.ticket.id ? result.ticket : item))
      setTicketReply('')
      setInternalReply(false)
    } catch (reason) { setError(asMessage(reason, 'Could not send the reply.')) } finally { setBusy(false) }
  }

  const activeTickets = tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length

  return (
    <div className="page page--wide admin-page">
      <PageHeader eyebrow="System administration" title="Control center" description="Manage customers, workspace limits, support conversations and delivery channels across SSLPing." actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh data</Button>} />
      {notice && <div className="account-notice" role="status"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}
      {error && <div className="account-error account-error--page" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
      <div className="admin-kpis">
        <div><Users /><span>Registered users<strong>{users.length}</strong></span></div>
        <div><CreditCard /><span>Active plans<strong>{plans.filter((plan) => plan.active).length}</strong></span></div>
        <div><MessageSquare /><span>Tickets requiring attention<strong>{activeTickets}</strong></span></div>
        <div><BellRing /><span>Support channels<strong>{channels.filter((channel) => channel.active).length}</strong></span></div>
      </div>
      <nav className="admin-tabs" aria-label="System administration sections">
        <button className={section === 'users' ? 'is-active' : ''} onClick={() => setSection('users')}><Users size={17} /> Users & workspaces</button>
        <button className={section === 'plans' ? 'is-active' : ''} onClick={() => setSection('plans')}><CreditCard size={17} /> Plans & limits</button>
        <button className={section === 'tickets' ? 'is-active' : ''} onClick={() => setSection('tickets')}><MessageSquare size={17} /> Tickets {activeTickets > 0 && <b>{activeTickets}</b>}</button>
        <button className={section === 'notifications' ? 'is-active' : ''} onClick={() => setSection('notifications')}><BellRing size={17} /> Notifications</button>
      </nav>
      {loading ? <div className="route-loading"><span className="spinner" /> Loading control center…</div> : section === 'users' ? (
        <UsersSection users={filteredUsers} plans={plans} query={query} setQuery={setQuery} busy={busy} onPlan={changePlan} onEdit={setEditingUser} onImpersonate={openImpersonation} />
      ) : section === 'plans' ? (
        <PlansSection plans={plans} onCreate={() => setCreatingPlan(true)} onEdit={setEditingPlan} onDelete={async (plan) => { if (!window.confirm(`Delete ${plan.name}? Workspaces still using it will prevent deletion.`)) return; try { await api.adminDeletePlan(plan.id); setPlans((items) => items.filter((item) => item.id !== plan.id)) } catch (reason) { setError(asMessage(reason, 'Could not delete the plan.')) } }} />
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
      <TicketModal detail={ticketDetail} users={users} busy={busy} reply={ticketReply} internal={internalReply} onClose={() => setTicketDetail(null)} onReply={setTicketReply} onInternal={setInternalReply} onUpdate={updateTicket} onSubmit={replyTicket} />
      <ChannelModal open={creatingChannel} busy={busy} onClose={() => setCreatingChannel(false)} onSave={async (input) => { setBusy(true); try { const channel = await api.adminCreateNotificationChannel(input); setChannels((items) => [...items, channel]); setCreatingChannel(false); setNotice(`${channel.name} will receive new ticket and reply notifications.`) } catch (reason) { setError(asMessage(reason, 'Could not create the channel.')) } finally { setBusy(false) } }} />
      {user?.system_role !== 'superadmin' && <div className="account-error">This page requires the super administrator role.</div>}
    </div>
  )
}

function userInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
}

function UsersSection({ users, plans, query, setQuery, busy, onPlan, onEdit, onImpersonate }: { users: AdminUser[]; plans: Plan[]; query: string; setQuery: (value: string) => void; busy: boolean; onPlan: (user: AdminUser, workspace: Workspace, code: string) => void; onEdit: (user: AdminUser) => void; onImpersonate: (user: AdminUser) => void }) {
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
              </span>
            </div>
            <div className="admin-user-cell" data-label="Workspace & plan">
              <div className="admin-workspaces">{entry.workspaces.map((workspace) => <label key={workspace.id}>
                <span title={workspace.name}>{workspace.name}</span>
                <Select aria-label={`Plan for ${workspace.name}`} value={workspace.plan} disabled={busy} onChange={(event) => void onPlan(entry, workspace, event.target.value)}>
                  {plans.filter((plan) => plan.active || plan.code === workspace.plan).map((plan) => <option key={plan.id} value={plan.code}>{plan.name}</option>)}
                </Select>
              </label>)}</div>
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

function PlansSection({ plans, onCreate, onEdit, onDelete }: { plans: Plan[]; onCreate: () => void; onEdit: (plan: Plan) => void; onDelete: (plan: Plan) => void }) {
  return <><div className="admin-section-heading"><div><h2>Plans and enforced limits</h2><p>Changes apply to new resource writes immediately.</p></div><Button onClick={onCreate}><Plus size={17} /> New plan</Button></div><div className="admin-plan-grid">{plans.map((plan) => <Panel key={plan.id} className={!plan.active ? 'is-inactive' : ''}><div className="admin-plan-header"><div><Badge tone={plan.public ? 'success' : 'neutral'}>{plan.public ? 'Public' : 'Private'}</Badge><h3>{plan.name}</h3><code>{plan.code}</code></div><div><IconButton label={`Edit ${plan.name}`} onClick={() => onEdit(plan)}><Pencil size={17} /></IconButton><IconButton label={`Delete ${plan.name}`} onClick={() => onDelete(plan)}><Trash2 size={17} /></IconButton></div></div><p>{plan.description || 'No public description.'}</p><strong className="admin-plan-price">{(plan.price_monthly_cents / 100).toLocaleString(undefined, { style: 'currency', currency: plan.currency })}<small>/month</small></strong><dl><div><dt>Monitors</dt><dd>{plan.limits.max_monitors}</dd></div><div><dt>Fastest interval</dt><dd>{plan.limits.min_interval_seconds}s</dd></div><div><dt>Team members</dt><dd>{plan.limits.max_team_members}</dd></div><div><dt>Status pages</dt><dd>{plan.limits.max_status_pages}</dd></div><div><dt>Integrations</dt><dd>{plan.limits.max_integrations}</dd></div><div><dt>Locations</dt><dd>{plan.limits.max_locations}</dd></div><div><dt>Retention</dt><dd>{plan.limits.data_retention_days} days</dd></div></dl></Panel>)}</div></>
}

function TicketsSection({ tickets, users, busy, onOpen }: { tickets: SupportTicket[]; users: AdminUser[]; busy: boolean; onOpen: (ticket: SupportTicket) => void }) {
  const userName = (id: string) => users.find((entry) => entry.id === id)?.name ?? id.slice(0, 8)
  return <Panel className="admin-table-panel"><div className="account-table-wrap"><table className="account-table"><thead><tr><th>Ticket</th><th>Customer</th><th>Priority</th><th>Status</th><th>Last activity</th><th /></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id}><td><strong>{ticket.subject}</strong><small>{ticket.id}</small></td><td>{userName(ticket.created_by)}</td><td><Badge tone={ticket.priority === 'urgent' ? 'danger' : ticket.priority === 'high' ? 'warning' : 'neutral'}>{ticket.priority}</Badge></td><td><Badge tone={statusTone(ticket.status)}>{ticket.status.replace('_', ' ')}</Badge></td><td>{formatDate(ticket.last_reply_at)}</td><td><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onOpen(ticket)}>Open conversation</Button></td></tr>)}</tbody></table></div></Panel>
}

function NotificationsSection({ channels, onCreate, onTest, onToggle, onDelete }: { channels: SupportNotificationChannel[]; onCreate: () => void; onTest: (channel: SupportNotificationChannel) => void; onToggle: (channel: SupportNotificationChannel) => void; onDelete: (channel: SupportNotificationChannel) => void }) {
  return <><div className="admin-section-heading"><div><h2>Support notifications</h2><p>Deliver new tickets and customer replies to Slack, Telegram or a webhook.</p></div><Button onClick={onCreate}><Plus size={17} /> Add channel</Button></div><div className="admin-channel-list">{channels.length === 0 ? <Panel className="empty-state"><BellRing size={34} /><h2>No delivery channels</h2><p>Add at least one channel to receive support events outside the dashboard.</p></Panel> : channels.map((channel) => <Panel key={channel.id}><span className="admin-channel-icon"><BellRing size={21} /></span><span><strong>{channel.name}</strong><small>{channel.type} · {channel.last_delivery_at ? `last attempted ${formatDate(channel.last_delivery_at)}` : 'not tested yet'}</small>{channel.last_delivery_error && <em>{channel.last_delivery_error}</em>}</span><Toggle checked={channel.active} onChange={() => void onToggle(channel)} label={`Enable ${channel.name}`} /><Button size="sm" variant="secondary" onClick={() => void onTest(channel)}>Send test</Button><IconButton label={`Delete ${channel.name}`} onClick={() => void onDelete(channel)}><Trash2 size={17} /></IconButton></Panel>)}</div></>
}

function UserModal({ user, busy, onClose, onSave }: { user: AdminUser | null; busy: boolean; onClose: () => void; onSave: (user: AdminUser, input: { name: string; system_role: AdminUser['system_role']; email_verified: boolean; revoke_sessions: boolean }) => void }) {
  const [name, setName] = useState(''); const [role, setRole] = useState<AdminUser['system_role']>('user'); const [verified, setVerified] = useState(false); const [revoke, setRevoke] = useState(false)
  useEffect(() => { if (user) { setName(user.name); setRole(user.system_role); setVerified(Boolean(user.email_verified_at)); setRevoke(false) } }, [user])
  return <Modal open={Boolean(user)} onClose={onClose} title="Manage user" icon={<Settings2 size={29} />}>{user && <form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave(user, { name: name.trim(), system_role: role, email_verified: verified, revoke_sessions: revoke }) }}><div className="admin-person"><strong>{user.email}</strong><span>Registered {formatDate(user.created_at)}</span></div><Field label="Display name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="System role"><Select value={role} onChange={(event) => setRole(event.target.value as AdminUser['system_role'])}><option value="user">Regular user</option><option value="superadmin">Super administrator</option></Select></Field><label className="admin-toggle-row"><Toggle checked={verified} onChange={setVerified} label="Email verified" /><span><strong>Email verified</strong><small>Use only after independently confirming ownership.</small></span></label><label className="admin-toggle-row"><Toggle checked={revoke} onChange={setRevoke} label="Revoke sessions" /><span><strong>Revoke all sessions</strong><small>Forces the user to sign in again on every device.</small></span></label><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || name.trim().length < 2}>Save user</Button></div></form>}</Modal>
}

type PlanDraft = Omit<Plan, 'id' | 'created_at' | 'updated_at'>
function PlanModal({ open, plan, busy, onClose, onSave }: { open: boolean; plan: Plan | null; busy: boolean; onClose: () => void; onSave: (plan: PlanDraft) => void }) {
  const [draft, setDraft] = useState<PlanDraft>({ code: '', name: '', description: '', price_monthly_cents: 0, currency: 'USD', public: true, active: true, limits: emptyLimits })
  useEffect(() => { setDraft(plan ? { code: plan.code, name: plan.name, description: plan.description, price_monthly_cents: plan.price_monthly_cents, currency: plan.currency, public: plan.public, active: plan.active, limits: { ...plan.limits } } : { code: '', name: '', description: '', price_monthly_cents: 0, currency: 'USD', public: true, active: true, limits: { ...emptyLimits } }) }, [open, plan])
  const limit = (key: keyof PlanLimits, value: string) => setDraft((current) => ({ ...current, limits: { ...current.limits, [key]: Math.max(0, Number(value) || 0) } }))
  return <Modal open={open} onClose={onClose} title={plan ? 'Edit plan' : 'Create plan'} icon={<CreditCard size={29} />} width="lg"><form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}><div className="form-grid"><Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Code"><input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} /></Field><Field label="Monthly price (cents)"><input type="number" min="0" value={draft.price_monthly_cents} onChange={(event) => setDraft({ ...draft, price_monthly_cents: Number(event.target.value) })} /></Field><Field label="Currency"><input maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} /></Field></div><Field label="Description"><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field><h3 className="form-section__title">Enforced limits</h3><div className="form-grid form-grid--three">{([['max_monitors','Monitors'],['min_interval_seconds','Minimum interval, seconds'],['max_team_members','Team members'],['max_status_pages','Status pages'],['max_integrations','Integrations'],['max_locations','Locations'],['data_retention_days','Retention, days']] as const).map(([key,label]) => <Field key={key} label={label}><input type="number" min={key === 'min_interval_seconds' ? 10 : 0} value={draft.limits[key]} onChange={(event) => limit(key, event.target.value)} /></Field>)}</div><div className="admin-toggle-grid"><label className="admin-toggle-row"><Toggle checked={draft.public} onChange={(value) => setDraft({ ...draft, public: value })} label="Public plan" /><span><strong>Public plan</strong><small>Available in customer-facing plan selection.</small></span></label><label className="admin-toggle-row"><Toggle checked={draft.active} onChange={(value) => setDraft({ ...draft, active: value })} label="Active plan" /><span><strong>Active plan</strong><small>Can be assigned to workspaces.</small></span></label></div><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || draft.name.length < 2 || draft.code.length < 2}>Save plan</Button></div></form></Modal>
}

function TicketModal({ detail, users, busy, reply, internal, onClose, onReply, onInternal, onUpdate, onSubmit }: { detail: SupportTicketDetail | null; users: AdminUser[]; busy: boolean; reply: string; internal: boolean; onClose: () => void; onReply: (value: string) => void; onInternal: (value: boolean) => void; onUpdate: (patch: Partial<Pick<SupportTicket, 'status' | 'priority'>>) => void; onSubmit: (event: FormEvent) => void }) {
  const author = (message: SupportMessage) => users.find((entry) => entry.id === message.author_id)?.name ?? (message.author_role === 'superadmin' ? 'SSLPing support' : 'Customer')
  return <Modal open={Boolean(detail)} onClose={onClose} title={detail?.ticket.subject ?? 'Support ticket'} icon={<MessageSquare size={29} />} width="lg">{detail && <div className="admin-ticket-detail"><div className="form-grid"><Field label="Status"><Select value={detail.ticket.status} disabled={busy} onChange={(event) => void onUpdate({ status: event.target.value as SupportTicketStatus })}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting">Waiting for customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option></Select></Field><Field label="Priority"><Select value={detail.ticket.priority} disabled={busy} onChange={(event) => void onUpdate({ priority: event.target.value as SupportTicketPriority })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field></div><div className="admin-ticket-messages">{detail.messages.map((message) => <article key={message.id} className={message.internal ? 'is-internal' : ''}><div><strong>{author(message)}</strong>{message.internal && <Badge tone="warning">Internal note</Badge>}<time>{formatDate(message.created_at)}</time></div><p>{message.body}</p></article>)}</div><form onSubmit={onSubmit}><Field label={internal ? 'Internal note' : 'Reply to customer'}><textarea value={reply} onChange={(event) => onReply(event.target.value)} /></Field><div className="admin-ticket-compose"><label className="admin-toggle-row"><Toggle checked={internal} onChange={onInternal} label="Internal note" /><span><strong>Internal note</strong><small>Hidden from the customer.</small></span></label><Button type="submit" disabled={busy || reply.trim().length < 1}><Send size={16} /> {internal ? 'Add note' : 'Send reply'}</Button></div></form></div>}</Modal>
}

function ChannelModal({ open, busy, onClose, onSave }: { open: boolean; busy: boolean; onClose: () => void; onSave: (input: { name: string; type: SupportNotificationChannel['type']; config: JsonObject }) => void }) {
  const [name, setName] = useState(''); const [type, setType] = useState<SupportNotificationChannel['type']>('slack'); const [url, setURL] = useState(''); const [token, setToken] = useState(''); const [chat, setChat] = useState('')
  useEffect(() => { if (open) { setName(''); setType('slack'); setURL(''); setToken(''); setChat('') } }, [open])
  const config = (): JsonObject => type === 'telegram' ? { bot_token: token, chat_id: chat } : { url }
  const valid = name.trim().length >= 2 && (type === 'telegram' ? token.trim() && chat.trim() : /^https?:\/\//.test(url.trim()))
  return <Modal open={open} onClose={onClose} title="Add support notification" icon={<BellRing size={29} />}><form className="admin-modal-form" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), type, config: config() }) }}><Field label="Friendly name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Support alerts" /></Field><Field label="Channel"><Select value={type} onChange={(event) => setType(event.target.value as SupportNotificationChannel['type'])}><option value="slack">Slack incoming webhook</option><option value="telegram">Telegram bot</option><option value="webhook">Generic webhook</option></Select></Field>{type === 'telegram' ? <div className="form-grid"><Field label="Bot token"><input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></Field><Field label="Chat ID"><input value={chat} onChange={(event) => setChat(event.target.value)} /></Field></div> : <Field label={type === 'slack' ? 'Slack webhook URL' : 'Webhook URL'}><input value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://…" /></Field>}<div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !valid}>Create channel</Button></div></form></Modal>
}
