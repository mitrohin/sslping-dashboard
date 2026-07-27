import { useMemo, useState, type FormEvent } from 'react'
import {
  Copy,
  Clock3,
  Download,
  KeyRound,
  LockKeyhole,
  Mail,
  Pencil,
  Phone,
  Save,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { TwoFactorSetup } from '../../api/types'
import { demoTeam, type TeamMemberViewModel, type TeamRole, type TeamSummary } from '../../data'
import { formatDate, formatStatus, statusTone } from '../../lib/format'
import { Badge, Button, FeedbackBanner, Field, IconButton, Modal, PageHeader, Panel, Select } from '../../components/ui'
import type { InviteMemberInput, TeamDetails, TeamMemberPatch } from './types'
import './account.css'

const teamRoleLabels: Readonly<Record<TeamRole, string>> = {
  owner: 'Owner',
  admin: 'Administrator',
  editor: 'Editor',
  reader: 'Read only',
  'notify-only': 'Notify only',
}

type TeamFeedback = { tone: 'success' | 'error' | 'warning' | 'info'; message: string }

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
  onSetupTwoFactor?: (password: string) => Promise<TwoFactorSetup>
  onConfirmTwoFactor?: (code: string) => Promise<readonly string[]>
  onDisableTwoFactor?: (password: string, code: string) => Promise<void>
  onRegenerateRecoveryCodes?: (password: string, code: string) => Promise<readonly string[]>
  onSecuritySessionEnd?: () => Promise<void>
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
  onSetupTwoFactor,
  onConfirmTwoFactor,
  onDisableTwoFactor,
  onRegenerateRecoveryCodes,
  onSecuritySessionEnd,
}: TeamPageProps) {
  const [members, setMembers] = useState<readonly TeamMemberViewModel[]>(initialMembers)
  const [details, setDetails] = useState(initialDetails)
  const [detailsDraft, setDetailsDraft] = useState(initialDetails)
  const [section, setSection] = useState<'members' | 'details' | 'security'>('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [seatsOpen, setSeatsOpen] = useState(false)
  const [editing, setEditing] = useState<TeamMemberViewModel | null>(null)
  const [invite, setInvite] = useState<InviteMemberInput>({ email: '', role: 'reader' })
  const [editRole, setEditRole] = useState<Exclude<TeamRole, 'owner'>>('reader')
  const [formError, setFormError] = useState('')
  const [feedback, setFeedback] = useState<TeamFeedback | null>(null)
  const [saving, setSaving] = useState(false)
  const [securityMode, setSecurityMode] = useState<'setup' | 'verify' | 'proof' | 'recovery' | null>(null)
  const [proofAction, setProofAction] = useState<'disable' | 'regenerate'>('regenerate')
  const [securityPassword, setSecurityPassword] = useState('')
  const [securityCode, setSecurityCode] = useState('')
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([])
  const [recoveryRequiresSignIn, setRecoveryRequiresSignIn] = useState(false)

  const summary = useMemo(() => {
    const seated = members.filter((member) => member.status !== 'suspended')
    const notifySeatsUsed = seated.filter((member) => member.role === 'notify-only').length
    return {
      ...initialSummary,
      seatsUsed: seated.length,
      seatsTotal: Math.max(initialSummary.seatsTotal, seated.length),
      loginSeatsUsed: seated.length - notifySeatsUsed,
      notifySeatsUsed,
    }
  }, [initialSummary, members])

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active').length,
    [members],
  )

  const currentMember = useMemo(
    () => members.find((member) => member.isCurrentUser),
    [members],
  )

  const seatsRemaining = Math.max(0, summary.seatsTotal - summary.seatsUsed)

  const openInvite = () => {
    if (seatsRemaining === 0) {
      setFeedback({ tone: 'warning', message: `${summary.planName} plan team limit reached. Upgrade the workspace before inviting another person.` })
      return
    }
    setInvite({ email: '', role: 'reader' })
    setFormError('')
    setInviteOpen(true)
  }

  const resetSecurityDialog = () => {
    setSecurityMode(null)
    setSecurityPassword('')
    setSecurityCode('')
    setTwoFactorSetup(null)
    setRecoveryCodes([])
    setFormError('')
  }

  const openTwoFactorSetup = () => {
    resetSecurityDialog()
    setSecurityMode('setup')
  }

  const openTwoFactorProof = (action: 'disable' | 'regenerate') => {
    resetSecurityDialog()
    setProofAction(action)
    setSecurityMode('proof')
  }

  const submitTwoFactorSetup = async (event: FormEvent) => {
    event.preventDefault()
    if (!securityPassword) return
    setSaving(true)
    setFormError('')
    try {
      const setup = await onSetupTwoFactor?.(securityPassword)
      if (!setup) throw new Error('Two-factor setup is unavailable.')
      setTwoFactorSetup(setup)
      setSecurityPassword('')
      setSecurityMode('verify')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not start two-factor setup.')
    } finally {
      setSaving(false)
    }
  }

  const submitTwoFactorVerification = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(securityCode.trim())) {
      setFormError('Enter the current six-digit code from your authenticator app.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const codes = await onConfirmTwoFactor?.(securityCode.trim())
      if (!codes) throw new Error('Two-factor confirmation is unavailable.')
      setMembers((current) => current.map((member) => (
        member.isCurrentUser ? { ...member, twoFactorEnabled: true } : member
      )))
      setRecoveryCodes(codes)
      setRecoveryRequiresSignIn(true)
      setSecurityCode('')
      setSecurityMode('recovery')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The authenticator code was not accepted.')
    } finally {
      setSaving(false)
    }
  }

  const submitTwoFactorProof = async (event: FormEvent) => {
    event.preventDefault()
    if (!securityPassword || !securityCode.trim()) {
      setFormError('Enter your password and a current authenticator or recovery code.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (proofAction === 'disable') {
        await onDisableTwoFactor?.(securityPassword, securityCode.trim())
        return
      }
      const codes = await onRegenerateRecoveryCodes?.(securityPassword, securityCode.trim())
      if (!codes) throw new Error('Recovery-code regeneration is unavailable.')
      setRecoveryCodes(codes)
      setRecoveryRequiresSignIn(false)
      setSecurityPassword('')
      setSecurityCode('')
      setSecurityMode('recovery')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The security proof was not accepted.')
    } finally {
      setSaving(false)
    }
  }

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value)
    setFeedback({ tone: 'info', message: 'Copied to clipboard.' })
  }

  const downloadRecoveryCodes = () => {
    const blob = new Blob([`${recoveryCodes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'sslping-recovery-codes.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const finishRecoveryCodes = async () => {
    if (recoveryRequiresSignIn) {
      await onSecuritySessionEnd?.()
      return
    }
    resetSecurityDialog()
    setFeedback({ tone: 'success', message: 'New recovery codes are active. Previous recovery codes no longer work.' })
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
      setFeedback({ tone: 'success', message: `Invitation sent to ${email}.` })
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
      setFeedback({ tone: 'success', message: `${editing.name}'s access has been updated.` })
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
      setFeedback({ tone: 'success', message: 'Team details saved.' })
    } catch (error) {
      setDetails(original)
      setDetailsDraft(original)
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Could not save team details.' })
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
            <Button onClick={openInvite} disabled={seatsRemaining === 0}><UserPlus size={18} /> Invite team member</Button>
          ) : undefined
        }
      />

      {feedback && <FeedbackBanner tone={feedback.tone} className="feedback-banner--page" onDismiss={() => setFeedback(null)}>{feedback.message}</FeedbackBanner>}

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
          <button
            type="button"
            className={section === 'security' ? 'is-active' : ''}
            onClick={() => setSection('security')}
          >
            <LockKeyhole size={18} /> My security
          </button>
        </nav>

        {section === 'members' ? (
          <div className="account-content">
            <div className="account-stat-grid" aria-label="Seat usage">
              <div><span>Team seats · {summary.planName}</span><strong>{summary.seatsUsed} / {summary.seatsTotal}</strong></div>
              <div><span>Access mix</span><strong>{summary.loginSeatsUsed} login · {summary.notifySeatsUsed} notify</strong></div>
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
                Using {summary.seatsUsed} of {summary.seatsTotal} shared team seats on the {summary.planName} plan. {seatsRemaining} remaining.
                <Button variant="secondary" size="sm" type="button" onClick={() => setSeatsOpen(true)}>Manage seats</Button>
              </footer>
            </Panel>
          </div>
        ) : section === 'details' ? (
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
        ) : (
          <div className="account-content">
            <Panel>
              <div className="panel__header">
                <div>
                  <h2>Authenticator app<span className="title-dot">.</span></h2>
                  <p>Protect your account with time-based one-time codes from any RFC 6238 authenticator.</p>
                </div>
                <Badge tone={currentMember?.twoFactorEnabled ? 'success' : 'warning'}>
                  {currentMember?.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
                </Badge>
              </div>
              <div className="panel__body account-security-page">
                <div className="account-security-hero">
                  <span><ShieldCheck size={29} /></span>
                  <div>
                    <strong>{currentMember?.twoFactorEnabled ? 'Two-factor authentication is active' : 'Add a second step to sign-in'}</strong>
                    <p>
                      {currentMember?.twoFactorEnabled
                        ? 'A password alone cannot access this account. Keep your recovery codes somewhere safe and separate.'
                        : 'Use Google Authenticator, 1Password, Microsoft Authenticator, Authy or another compatible generator.'}
                    </p>
                  </div>
                </div>
                {currentMember?.twoFactorEnabled ? (
                  <div className="account-security-actions">
                    <Button type="button" onClick={() => openTwoFactorProof('regenerate')}>
                      <KeyRound size={17} /> Generate new recovery codes
                    </Button>
                    <Button type="button" variant="danger" onClick={() => openTwoFactorProof('disable')}>
                      Disable 2FA
                    </Button>
                  </div>
                ) : (
                  <div className="account-security-actions">
                    <Button type="button" onClick={openTwoFactorSetup}>
                      <ShieldCheck size={17} /> Set up authenticator
                    </Button>
                  </div>
                )}
                <div className="account-security-summary">
                  <LockKeyhole size={20} />
                  <span>
                    <strong>Security-sensitive change</strong>
                    <small>Enabling or disabling 2FA signs out every active session. After saving the recovery codes, sign in again using the new security policy.</small>
                  </span>
                </div>
              </div>
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
          <div className="account-form-note">
            <Users size={18} /> {seatsRemaining} of {summary.seatsTotal} seats remain on the {summary.planName} plan. Pending invitations reserve a seat in this view.
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
            <div><span>Shared team seats</span><strong>{summary.seatsUsed} / {summary.seatsTotal}</strong></div>
            <div><span>Remaining</span><strong>{seatsRemaining}</strong></div>
            <div><span>Login access</span><strong>{summary.loginSeatsUsed}</strong></div>
            <div><span>Notify-only access</span><strong>{summary.notifySeatsUsed}</strong></div>
          </div>
          <div className="account-security-summary">
            <ShieldCheck size={20} />
            <span><strong>Plan-controlled capacity</strong><small>This shared limit comes directly from the active subscription snapshot. Change the workspace plan in Plans &amp; billing to increase it.</small></span>
          </div>
          <div className="form-actions">
            <Button type="button" onClick={() => setSeatsOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={securityMode !== null}
        onClose={() => {
          if (!saving && securityMode !== 'recovery') resetSecurityDialog()
        }}
        title={securityMode === 'recovery' ? 'Save recovery codes' : 'Two-factor authentication'}
        icon={<ShieldCheck size={36} />}
        width="sm"
      >
        {securityMode === 'setup' && (
          <form onSubmit={submitTwoFactorSetup}>
            <div className="account-form-note"><LockKeyhole size={19} /> Confirm your current password before creating a new authenticator secret.</div>
            <Field label="Current password" error={formError}>
              <input autoFocus type="password" autoComplete="current-password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} required />
            </Field>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={resetSecurityDialog}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Preparing…' : 'Continue'}</Button></div>
          </form>
        )}

        {securityMode === 'verify' && twoFactorSetup && (
          <form onSubmit={submitTwoFactorVerification} className="account-two-factor-setup">
            <p>Scan this QR code with your authenticator app, then enter its current six-digit code.</p>
            <div className="account-two-factor-qr"><QRCodeSVG value={twoFactorSetup.otpauth_url} size={184} level="M" /></div>
            <div className="account-two-factor-secret">
              <span><small>Manual setup key</small><code>{twoFactorSetup.secret}</code></span>
              <IconButton type="button" label="Copy setup key" onClick={() => void copyText(twoFactorSetup.secret)}><Copy size={16} /></IconButton>
            </div>
            <Field label="Authenticator code" hint={`Account: ${twoFactorSetup.account_name}`} error={formError}>
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="000000" value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
            </Field>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={resetSecurityDialog}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Verifying…' : 'Enable 2FA'}</Button></div>
          </form>
        )}

        {securityMode === 'proof' && (
          <form onSubmit={submitTwoFactorProof}>
            <div className="account-form-note"><KeyRound size={19} /> {proofAction === 'disable' ? 'Disabling 2FA signs out every active session.' : 'Generating a new set immediately invalidates all previous recovery codes.'}</div>
            <div className="form-grid form-grid--single">
              <Field label="Current password">
                <input autoFocus type="password" autoComplete="current-password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} required />
              </Field>
              <Field label="Authenticator or recovery code" error={formError}>
                <input autoComplete="one-time-code" value={securityCode} onChange={(event) => setSecurityCode(event.target.value)} required />
              </Field>
            </div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={resetSecurityDialog}>Cancel</Button><Button type="submit" variant={proofAction === 'disable' ? 'danger' : 'primary'} disabled={saving}>{saving ? 'Confirming…' : proofAction === 'disable' ? 'Disable and sign out' : 'Generate new codes'}</Button></div>
          </form>
        )}

        {securityMode === 'recovery' && (
          <div className="account-recovery-codes">
            <div className="account-warning"><KeyRound size={20} /><span><strong>Each code works only once</strong><small>This is the only time these codes are shown. Store them outside this device.</small></span></div>
            <div className="account-recovery-codes__grid">
              {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
            <div className="account-recovery-codes__tools">
              <Button variant="secondary" type="button" onClick={() => void copyText(recoveryCodes.join('\n'))}><Copy size={16} /> Copy all</Button>
              <Button variant="secondary" type="button" onClick={downloadRecoveryCodes}><Download size={16} /> Download</Button>
            </div>
            <div className="form-actions"><Button type="button" onClick={() => void finishRecoveryCodes()}>{recoveryRequiresSignIn ? 'I saved the codes — sign in again' : 'I saved the codes'}</Button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
