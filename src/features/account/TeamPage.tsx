import { useMemo, useState, type FormEvent } from 'react'
import {
  Check,
  Clock3,
  Mail,
  Pencil,
  Phone,
  Save,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { demoTeam, type TeamMemberViewModel, type TeamRole, type TeamSummary } from '../../data'
import { formatDate, formatStatus, statusTone } from '../../lib/format'
import { Badge, Button, Field, IconButton, Modal, PageHeader, Panel, Select } from '../../components/ui'
import type { InviteMemberInput, TeamDetails, TeamMemberPatch } from './types'
import './account.css'

const teamRoleLabels: Readonly<Record<TeamRole, string>> = {
  owner: 'Owner',
  admin: 'Administrator',
  editor: 'Editor',
  reader: 'Read only',
  'notify-only': 'Notify only',
}

const editableRoles: readonly Exclude<TeamRole, 'owner'>[] = [
  'admin',
  'editor',
  'reader',
  'notify-only',
]

const defaultTeamDetails: TeamDetails = {
  name: 'SSLPing production',
  slug: 'sslping-production',
  timezone: 'Europe/Moscow',
  notificationEmail: 'ops@example.com',
}

export interface TeamPageProps {
  initialMembers?: readonly TeamMemberViewModel[]
  initialSummary?: TeamSummary
  initialDetails?: TeamDetails
  onInvite?: (input: InviteMemberInput) => Promise<TeamMemberViewModel | void>
  onUpdateMember?: (
    memberId: string,
    patch: TeamMemberPatch,
  ) => Promise<TeamMemberViewModel | void>
  onUpdateDetails?: (details: TeamDetails) => Promise<TeamDetails | void>
}

function badgeToneForStatus(status: TeamMemberViewModel['status']) {
  const tone = statusTone(status)
  if (tone === 'positive') return 'success' as const
  if (tone === 'negative') return 'danger' as const
  if (tone === 'warning') return 'warning' as const
  return 'neutral' as const
}

export function TeamPage({
  initialMembers = demoTeam.members,
  initialSummary = demoTeam.summary,
  initialDetails = defaultTeamDetails,
  onInvite,
  onUpdateMember,
  onUpdateDetails,
}: TeamPageProps) {
  const [members, setMembers] = useState<readonly TeamMemberViewModel[]>(initialMembers)
  const [summary] = useState(initialSummary)
  const [details, setDetails] = useState(initialDetails)
  const [detailsDraft, setDetailsDraft] = useState(initialDetails)
  const [section, setSection] = useState<'members' | 'details'>('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [seatsOpen, setSeatsOpen] = useState(false)
  const [editing, setEditing] = useState<TeamMemberViewModel | null>(null)
  const [invite, setInvite] = useState<InviteMemberInput>({ email: '', role: 'reader' })
  const [editRole, setEditRole] = useState<Exclude<TeamRole, 'owner'>>('reader')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active').length,
    [members],
  )

  const openInvite = () => {
    setInvite({ email: '', role: 'reader' })
    setFormError('')
    setInviteOpen(true)
  }

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault()
    const email = invite.email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFormError('Enter a valid email address.')
      return
    }
    if (members.some((member) => member.email.toLowerCase() === email)) {
      setFormError('This person is already a team member or has a pending invite.')
      return
    }

    const optimisticId = `local-${crypto.randomUUID()}`
    const optimistic: TeamMemberViewModel = {
      id: optimisticId,
      name: email.split('@')[0],
      email,
      initials: email.slice(0, 2).toUpperCase(),
      role: invite.role,
      twoFactorEnabled: false,
      status: 'invited',
      isCurrentUser: false,
      ...(invite.phone?.trim() ? { phone: invite.phone.trim() } : {}),
    }

    setSaving(true)
    setFormError('')
    setMembers((current) => [...current, optimistic])
    try {
      const saved = await onInvite?.({ ...invite, email })
      if (saved) {
        setMembers((current) => current.map((member) => (member.id === optimisticId ? saved : member)))
      }
      setInviteOpen(false)
      setNotice(`Invitation sent to ${email}.`)
    } catch (error) {
      setMembers((current) => current.filter((member) => member.id !== optimisticId))
      setFormError(error instanceof Error ? error.message : 'Could not send the invitation.')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (member: TeamMemberViewModel) => {
    if (member.role === 'owner') return
    setEditing(member)
    setEditRole(member.role)
    setFormError('')
  }

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const original = editing
    const optimistic = { ...editing, role: editRole }

    setSaving(true)
    setMembers((current) => current.map((member) => (member.id === editing.id ? optimistic : member)))
    try {
      const saved = await onUpdateMember?.(editing.id, { role: editRole })
      if (saved) {
        setMembers((current) => current.map((member) => (member.id === editing.id ? saved : member)))
      }
      setEditing(null)
      setNotice(`${editing.name}'s access has been updated.`)
    } catch (error) {
      setMembers((current) => current.map((member) => (member.id === original.id ? original : member)))
      setFormError(error instanceof Error ? error.message : 'Could not update this member.')
    } finally {
      setSaving(false)
    }
  }

  const submitDetails = async (event: FormEvent) => {
    event.preventDefault()
    if (!detailsDraft.name.trim() || !detailsDraft.slug.trim()) return
    const original = details
    const optimistic = {
      ...detailsDraft,
      name: detailsDraft.name.trim(),
      slug: detailsDraft.slug.trim().toLowerCase(),
      notificationEmail: detailsDraft.notificationEmail.trim(),
    }
    setDetails(optimistic)
    setDetailsDraft(optimistic)
    setSaving(true)
    try {
      const saved = await onUpdateDetails?.(optimistic)
      if (saved) {
        setDetails(saved)
        setDetailsDraft(saved)
      }
      setNotice('Team details saved.')
    } catch (error) {
      setDetails(original)
      setDetailsDraft(original)
      setNotice(error instanceof Error ? error.message : 'Could not save team details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page account-page">
      <PageHeader
        title="Team members"
        description={`${activeMembers} active teammates share this workspace.`}
        actions={
          section === 'members' ? (
            <Button onClick={openInvite}><UserPlus size={18} /> Invite team member</Button>
          ) : undefined
        }
      />

      {notice && (
        <div className="account-notice" role="status">
          <Check size={17} /> <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      <div className="account-layout">
        <nav className="account-subnav" aria-label="Team settings">
          <button
            type="button"
            className={section === 'members' ? 'is-active' : ''}
            onClick={() => setSection('members')}
          >
            <Users size={18} /> Team members
          </button>
          <button
            type="button"
            className={section === 'details' ? 'is-active' : ''}
            onClick={() => setSection('details')}
          >
            <Settings size={18} /> Team details
          </button>
        </nav>

        {section === 'members' ? (
          <div className="account-content">
            <div className="account-stat-grid" aria-label="Seat usage">
              <div><span>Login seats</span><strong>{summary.loginSeatsUsed} / {summary.loginSeatsTotal}</strong></div>
              <div><span>Notify-only seats</span><strong>{summary.notifySeatsUsed} / {summary.notifySeatsTotal}</strong></div>
              <div><span>Two-factor protected</span><strong>{members.filter((member) => member.twoFactorEnabled).length} / {activeMembers}</strong></div>
            </div>

            <Panel className="account-table-panel">
              <div className="account-table-wrap">
                <table className="account-table account-team-table">
                  <caption className="sr-only">Workspace team members</caption>
                  <thead>
                    <tr>
                      <th>Name and email</th>
                      <th>Phone</th>
                      <th>Role</th>
                      <th>2FA</th>
                      <th>Status</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td data-label="Member">
                          <div className="account-member">
                            <span className="account-avatar">{member.initials}<i /></span>
                            <span><strong>{member.name}</strong><small>{member.email}</small></span>
                          </div>
                        </td>
                        <td data-label="Phone">{member.phone ? <span className="account-inline"><Phone size={14} />{member.phone}</span> : <span className="muted">None</span>}</td>
                        <td data-label="Role">{teamRoleLabels[member.role]}{member.isCurrentUser && <small className="account-you">You</small>}</td>
                        <td data-label="2FA">
                          <span className={member.twoFactorEnabled ? 'success-text account-inline' : 'warning-text account-inline'}>
                            <ShieldCheck size={15} />{member.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
                          </span>
                        </td>
                        <td data-label="Status"><Badge tone={badgeToneForStatus(member.status)}>{formatStatus(member.status)}</Badge></td>
                        <td className="account-row-actions">
                          <IconButton
                            label={`Edit ${member.name}`}
                            onClick={() => openEdit(member)}
                            disabled={member.role === 'owner'}
                          ><Pencil size={16} /></IconButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="account-table-footer">
                Currently using {summary.notifySeatsUsed} of {summary.notifySeatsTotal} notify-only seats and {summary.loginSeatsUsed} of {summary.loginSeatsTotal} login seats.
                <Button variant="secondary" size="sm" type="button" onClick={() => setSeatsOpen(true)}>Manage seats</Button>
              </footer>
            </Panel>
          </div>
        ) : (
          <div className="account-content">
            <Panel>
              <div className="panel__header"><h2>Workspace details<span className="title-dot">.</span></h2></div>
              <form className="panel__body account-details-form" onSubmit={submitDetails}>
                <div className="form-grid">
                  <Field label="Workspace name" hint="Shown to every member in this workspace.">
                    <input value={detailsDraft.name} onChange={(event) => setDetailsDraft((current) => ({ ...current, name: event.target.value }))} required />
                  </Field>
                  <Field label="Workspace slug" hint="Used in workspace URLs and API context.">
                    <input value={detailsDraft.slug} pattern="[a-z0-9-]+" onChange={(event) => setDetailsDraft((current) => ({ ...current, slug: event.target.value }))} required />
                  </Field>
                  <Field label="Time zone" hint="Dates in reports and scheduled maintenance use this zone.">
                    <Select value={detailsDraft.timezone} onChange={(event) => setDetailsDraft((current) => ({ ...current, timezone: event.target.value }))}>
                      <option value="UTC">UTC</option>
                      <option value="Europe/Moscow">Europe/Moscow</option>
                      <option value="Europe/London">Europe/London</option>
                      <option value="America/New_York">America/New York</option>
                      <option value="Asia/Singapore">Asia/Singapore</option>
                    </Select>
                  </Field>
                  <Field label="Notification email" hint="Operational account notices are delivered here.">
                    <input type="email" value={detailsDraft.notificationEmail} onChange={(event) => setDetailsDraft((current) => ({ ...current, notificationEmail: event.target.value }))} required />
                  </Field>
                </div>
                <div className="account-details-meta">
                  <span><Clock3 size={15} /> Current zone: {details.timezone}</span>
                  <span><Mail size={15} /> Notices: {details.notificationEmail}</span>
                </div>
                <div className="form-actions"><Button type="submit" disabled={saving}><Save size={17} />{saving ? 'Saving…' : 'Save changes'}</Button></div>
              </form>
            </Panel>
          </div>
        )}
      </div>

      <Modal open={inviteOpen} onClose={() => !saving && setInviteOpen(false)} title={<>Invite <span className="success-text">team member</span></>} icon={<UserPlus size={37} />}>
        <form onSubmit={submitInvite}>
          <div className="form-section">
            <Field label="Email" hint="They will receive an invitation that must be confirmed." error={formError}>
              <input autoFocus type="email" placeholder="teammate@example.com" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} required />
            </Field>
          </div>
          <div className="form-section">
            <Field label="Role" hint="Choose their access level. You can change it later.">
              <Select value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value as InviteMemberInput['role'] }))}>
                {editableRoles.map((role) => <option key={role} value={role}>{teamRoleLabels[role]}</option>)}
              </Select>
            </Field>
          </div>
          <div className="form-section">
            <Field label="Phone number" hint="Optional. Used only for enabled SMS or voice notifications.">
              <input type="tel" autoComplete="tel" placeholder="+1 555 010 0200" value={invite.phone ?? ''} onChange={(event) => setInvite((current) => ({ ...current, phone: event.target.value }))} />
            </Field>
          </div>
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setInviteOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Sending…' : 'Send invite'}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => !saving && setEditing(null)} title="Edit team member" icon={<ShieldCheck size={36} />} width="sm">
        {editing && (
          <form onSubmit={submitEdit}>
            <div className="account-modal-person"><span className="account-avatar">{editing.initials}<i /></span><span><strong>{editing.name}</strong><small>{editing.email}</small></span></div>
            <div className="form-section">
              <Field label="Role" error={formError}>
                <Select autoFocus value={editRole} onChange={(event) => setEditRole(event.target.value as Exclude<TeamRole, 'owner'>)}>
                  {editableRoles.map((role) => <option key={role} value={role}>{teamRoleLabels[role]}</option>)}
                </Select>
              </Field>
            </div>
            <div className="account-security-summary"><ShieldCheck size={20} /><span><strong>Two-factor authentication</strong><small>{editing.twoFactorEnabled ? `Enabled · joined ${editing.joinedAt ? formatDate(editing.joinedAt) : 'previously'}` : 'Not enabled — recommend enabling it for this role.'}</small></span></div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Updating…' : 'Update access'}</Button></div>
          </form>
        )}
      </Modal>

      <Modal open={seatsOpen} onClose={() => setSeatsOpen(false)} title="Workspace seats" icon={<Users size={36} />} width="sm">
        <div className="account-seat-dialog">
          <p>Review the access capacity currently available to this workspace.</p>
          <div className="account-seat-dialog__grid">
            <div><span>Login seats</span><strong>{summary.loginSeatsUsed} / {summary.loginSeatsTotal}</strong></div>
            <div><span>Notify-only seats</span><strong>{summary.notifySeatsUsed} / {summary.notifySeatsTotal}</strong></div>
          </div>
          <div className="account-security-summary">
            <ShieldCheck size={20} />
            <span><strong>Billing-safe workflow</strong><small>Seat purchases are intentionally unavailable until a billing provider is connected. No charge will be created from this dashboard.</small></span>
          </div>
          <div className="form-actions">
            <Button type="button" onClick={() => setSeatsOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
