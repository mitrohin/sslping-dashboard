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
import { useI18n } from '../../app/I18nProvider'
import { timeZoneGroups, timeZones } from '../../lib/timezones'
import { demoTeam, type TeamMemberViewModel, type TeamRole, type TeamSummary } from '../../data'
import { formatDate, formatStatus, statusTone } from '../../lib/format'
import { Badge, Button, FeedbackBanner, Field, IconButton, Modal, PageHeader, Panel, Select } from '../../components/ui'
import type { InviteMemberInput, TeamDetails, TeamMemberPatch } from './types'
import './account.css'

type Translate = (key: string, variables?: Record<string, string | number>) => string

function teamRoleLabel(role: TeamRole, t: Translate) {
  return t(`team.role.${role}`)
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
  const { t } = useI18n()
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
      setFeedback({ tone: 'warning', message: t('team.limitReached', { plan: summary.planName }) })
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
      if (!setup) throw new Error(t('team.2faSetupUnavailable'))
      setTwoFactorSetup(setup)
      setSecurityPassword('')
      setSecurityMode('verify')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('team.2faSetupFailed'))
    } finally {
      setSaving(false)
    }
  }

  const submitTwoFactorVerification = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(securityCode.trim())) {
      setFormError(t('team.enterSixDigit'))
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const codes = await onConfirmTwoFactor?.(securityCode.trim())
      if (!codes) throw new Error(t('team.2faConfirmUnavailable'))
      setMembers((current) => current.map((member) => (
        member.isCurrentUser ? { ...member, twoFactorEnabled: true } : member
      )))
      setRecoveryCodes(codes)
      setRecoveryRequiresSignIn(true)
      setSecurityCode('')
      setSecurityMode('recovery')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('team.codeRejected'))
    } finally {
      setSaving(false)
    }
  }

  const submitTwoFactorProof = async (event: FormEvent) => {
    event.preventDefault()
    if (!securityPassword || !securityCode.trim()) {
      setFormError(t('team.enterSecurityProof'))
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
      if (!codes) throw new Error(t('team.recoveryUnavailable'))
      setRecoveryCodes(codes)
      setRecoveryRequiresSignIn(false)
      setSecurityPassword('')
      setSecurityCode('')
      setSecurityMode('recovery')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('team.securityProofRejected'))
    } finally {
      setSaving(false)
    }
  }

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value)
    setFeedback({ tone: 'info', message: t('team.copied') })
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
    setFeedback({ tone: 'success', message: t('team.recoveryActive') })
  }

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault()
    const email = invite.email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFormError(t('team.invalidEmail'))
      return
    }
    if (members.some((member) => member.email.toLowerCase() === email)) {
      setFormError(t('team.alreadyMember'))
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
      setFeedback({ tone: 'success', message: t('team.invitationSent', { email }) })
    } catch (error) {
      setMembers((current) => current.filter((member) => member.id !== optimisticId))
      setFormError(error instanceof Error ? error.message : t('team.invitationFailed'))
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
      setFeedback({ tone: 'success', message: t('team.accessUpdated', { name: editing.name }) })
    } catch (error) {
      setMembers((current) => current.map((member) => (member.id === original.id ? original : member)))
      setFormError(error instanceof Error ? error.message : t('team.memberUpdateFailed'))
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
      setFeedback({ tone: 'success', message: t('team.detailsSaved') })
    } catch (error) {
      setDetails(original)
      setDetailsDraft(original)
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : t('team.detailsSaveFailed') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page account-page">
      <PageHeader
        title={t('team.title')}
        description={t('team.description', { count: activeMembers })}
        actions={
          section === 'members' ? (
            <Button onClick={openInvite} disabled={seatsRemaining === 0}><UserPlus size={18} /> {t('team.invite')}</Button>
          ) : undefined
        }
      />

      {feedback && <FeedbackBanner tone={feedback.tone} className="feedback-banner--page" onDismiss={() => setFeedback(null)}>{feedback.message}</FeedbackBanner>}

      <div className="account-layout">
        <nav className="account-subnav" aria-label={t('team.settings')}>
          <button
            type="button"
            className={section === 'members' ? 'is-active' : ''}
            onClick={() => setSection('members')}
          >
            <Users size={18} /> {t('team.title')}
          </button>
          <button
            type="button"
            className={section === 'details' ? 'is-active' : ''}
            onClick={() => setSection('details')}
          >
            <Settings size={18} /> {t('team.details')}
          </button>
          <button
            type="button"
            className={section === 'security' ? 'is-active' : ''}
            onClick={() => setSection('security')}
          >
            <LockKeyhole size={18} /> {t('team.security')}
          </button>
        </nav>

        {section === 'members' ? (
          <div className="account-content">
            <div className="account-stat-grid" aria-label={t('team.seatUsage')}>
              <div><span>{t('team.seats')} · {summary.planName}</span><strong>{summary.seatsUsed} / {summary.seatsTotal}</strong></div>
              <div><span>{t('team.accessMix')}</span><strong>{t('team.accessMixValue', { login: summary.loginSeatsUsed, notify: summary.notifySeatsUsed })}</strong></div>
              <div><span>{t('team.twoFactorProtected')}</span><strong>{members.filter((member) => member.twoFactorEnabled).length} / {activeMembers}</strong></div>
            </div>

            <Panel className="account-table-panel">
              <div className="account-table-wrap">
                <table className="account-table account-team-table">
                  <caption className="sr-only">{t('team.workspaceMembers')}</caption>
                  <thead>
                    <tr>
                      <th>{t('team.nameEmail')}</th>
                      <th>{t('team.phone')}</th>
                      <th>{t('team.role')}</th>
                      <th>2FA</th>
                      <th>{t('common.status')}</th>
                      <th><span className="sr-only">{t('team.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td data-label={t('team.member')}>
                          <div className="account-member">
                            <span className="account-avatar">{member.initials}<i /></span>
                            <span><strong>{member.name}</strong><small>{member.email}</small></span>
                          </div>
                        </td>
                        <td data-label={t('team.phone')}>{member.phone ? <span className="account-inline"><Phone size={14} />{member.phone}</span> : <span className="muted">{t('team.none')}</span>}</td>
                        <td data-label={t('team.role')}>{teamRoleLabel(member.role, t)}{member.isCurrentUser && <small className="account-you">{t('common.you')}</small>}</td>
                        <td data-label="2FA">
                          <span className={member.twoFactorEnabled ? 'success-text account-inline' : 'warning-text account-inline'}>
                            <ShieldCheck size={15} />{member.twoFactorEnabled ? t('team.enabled') : t('team.notEnabled')}
                          </span>
                        </td>
                        <td data-label={t('common.status')}><Badge tone={badgeToneForStatus(member.status)}>{formatStatus(member.status)}</Badge></td>
                        <td className="account-row-actions">
                          <IconButton
                            label={t('team.editMember', { name: member.name })}
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
                {t('team.seatSummary', { used: summary.seatsUsed, total: summary.seatsTotal, plan: summary.planName, remaining: seatsRemaining })}
                <Button variant="secondary" size="sm" type="button" onClick={() => setSeatsOpen(true)}>{t('team.manageSeats')}</Button>
              </footer>
            </Panel>
          </div>
        ) : section === 'details' ? (
          <div className="account-content">
            <Panel>
              <div className="panel__header"><h2>{t('team.workspaceDetails')}<span className="title-dot">.</span></h2></div>
              <form className="panel__body account-details-form" onSubmit={submitDetails}>
                <div className="form-grid">
                  <Field label={t('team.workspaceName')} hint={t('team.workspaceNameHint')}>
                    <input value={detailsDraft.name} onChange={(event) => setDetailsDraft((current) => ({ ...current, name: event.target.value }))} required />
                  </Field>
                  <Field label={t('team.workspaceSlug')} hint={t('team.workspaceSlugHint')}>
                    <input value={detailsDraft.slug} pattern="[a-z0-9-]+" onChange={(event) => setDetailsDraft((current) => ({ ...current, slug: event.target.value }))} required />
                  </Field>
                  <Field label={t('team.timeZone')} hint={t('team.timeZoneHint')}>
                    <Select value={detailsDraft.timezone} onChange={(event) => setDetailsDraft((current) => ({ ...current, timezone: event.target.value }))}>
                      {!timeZones.includes(detailsDraft.timezone) && <option value={detailsDraft.timezone}>{detailsDraft.timezone}</option>}
                      {timeZoneGroups.map((group) => <optgroup key={group.area} label={group.area}>{group.zones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</optgroup>)}
                    </Select>
                  </Field>
                  <Field label={t('team.notificationEmail')} hint={t('team.notificationEmailHint')}>
                    <input type="email" value={detailsDraft.notificationEmail} onChange={(event) => setDetailsDraft((current) => ({ ...current, notificationEmail: event.target.value }))} required />
                  </Field>
                </div>
                <div className="account-details-meta">
                  <span><Clock3 size={15} /> {t('team.currentZone')}: {details.timezone}</span>
                  <span><Mail size={15} /> {t('team.notices')}: {details.notificationEmail}</span>
                </div>
                <div className="form-actions"><Button type="submit" disabled={saving}><Save size={17} />{saving ? t('team.saving') : t('team.saveChanges')}</Button></div>
              </form>
            </Panel>
          </div>
        ) : (
          <div className="account-content">
            <Panel>
              <div className="panel__header">
                <div>
                  <h2>{t('team.authenticator')}<span className="title-dot">.</span></h2>
                  <p>{t('team.authenticatorHint')}</p>
                </div>
                <Badge tone={currentMember?.twoFactorEnabled ? 'success' : 'warning'}>
                  {currentMember?.twoFactorEnabled ? t('team.enabled') : t('team.notEnabled')}
                </Badge>
              </div>
              <div className="panel__body account-security-page">
                <div className="account-security-hero">
                  <span><ShieldCheck size={29} /></span>
                  <div>
                    <strong>{currentMember?.twoFactorEnabled ? t('team.2faActive') : t('team.addSecondStep')}</strong>
                    <p>
                      {currentMember?.twoFactorEnabled
                        ? t('team.2faActiveHint')
                        : t('team.2faAppsHint')}
                    </p>
                  </div>
                </div>
                {currentMember?.twoFactorEnabled ? (
                  <div className="account-security-actions">
                    <Button type="button" onClick={() => openTwoFactorProof('regenerate')}>
                      <KeyRound size={17} /> {t('team.generateRecovery')}
                    </Button>
                    <Button type="button" variant="danger" onClick={() => openTwoFactorProof('disable')}>
                      {t('team.disable2fa')}
                    </Button>
                  </div>
                ) : (
                  <div className="account-security-actions">
                    <Button type="button" onClick={openTwoFactorSetup}>
                      <ShieldCheck size={17} /> {t('team.setupAuthenticator')}
                    </Button>
                  </div>
                )}
                <div className="account-security-summary">
                  <LockKeyhole size={20} />
                  <span>
                    <strong>{t('team.securityChange')}</strong>
                    <small>{t('team.securityChangeHint')}</small>
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>

      <Modal open={inviteOpen} onClose={() => !saving && setInviteOpen(false)} title={t('team.invite')} icon={<UserPlus size={37} />}>
        <form onSubmit={submitInvite}>
          <div className="form-section">
            <Field label={t('team.email')} hint={t('team.inviteEmailHint')} error={formError}>
              <input autoFocus type="email" placeholder="teammate@example.com" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} required />
            </Field>
          </div>
          <div className="account-form-note">
            <Users size={18} /> {t('team.inviteSeatHint', { remaining: seatsRemaining, total: summary.seatsTotal, plan: summary.planName })}
          </div>
          <div className="form-section">
            <Field label={t('team.role')} hint={t('team.roleHint')}>
              <Select value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value as InviteMemberInput['role'] }))}>
                {editableRoles.map((role) => <option key={role} value={role}>{teamRoleLabel(role, t)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="form-section">
            <Field label={t('team.phoneNumber')} hint={t('team.phoneHint')}>
              <input type="tel" autoComplete="tel" placeholder="+1 555 010 0200" value={invite.phone ?? ''} onChange={(event) => setInvite((current) => ({ ...current, phone: event.target.value }))} />
            </Field>
          </div>
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setInviteOpen(false)} disabled={saving}>{t('common.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('team.sending') : t('team.sendInvite')}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => !saving && setEditing(null)} title={t('team.editTeamMember')} icon={<ShieldCheck size={36} />} width="sm">
        {editing && (
          <form onSubmit={submitEdit}>
            <div className="account-modal-person"><span className="account-avatar">{editing.initials}<i /></span><span><strong>{editing.name}</strong><small>{editing.email}</small></span></div>
            <div className="form-section">
              <Field label={t('team.role')} error={formError}>
                <Select autoFocus value={editRole} onChange={(event) => setEditRole(event.target.value as Exclude<TeamRole, 'owner'>)}>
                  {editableRoles.map((role) => <option key={role} value={role}>{teamRoleLabel(role, t)}</option>)}
                </Select>
              </Field>
            </div>
            <div className="account-security-summary"><ShieldCheck size={20} /><span><strong>{t('team.twoFactor')}</strong><small>{editing.twoFactorEnabled ? t('team.enabledJoined', { date: editing.joinedAt ? formatDate(editing.joinedAt) : t('team.previously') }) : t('team.recommend2fa')}</small></span></div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('team.updating') : t('team.updateAccess')}</Button></div>
          </form>
        )}
      </Modal>

      <Modal open={seatsOpen} onClose={() => setSeatsOpen(false)} title={t('team.workspaceSeats')} icon={<Users size={36} />} width="sm">
        <div className="account-seat-dialog">
          <p>{t('team.workspaceSeatsHint')}</p>
          <div className="account-seat-dialog__grid">
            <div><span>{t('team.sharedSeats')}</span><strong>{summary.seatsUsed} / {summary.seatsTotal}</strong></div>
            <div><span>{t('team.remaining')}</span><strong>{seatsRemaining}</strong></div>
            <div><span>{t('team.loginAccess')}</span><strong>{summary.loginSeatsUsed}</strong></div>
            <div><span>{t('team.notifyAccess')}</span><strong>{summary.notifySeatsUsed}</strong></div>
          </div>
          <div className="account-security-summary">
            <ShieldCheck size={20} />
            <span><strong>{t('team.planCapacity')}</strong><small>{t('team.planCapacityHint')}</small></span>
          </div>
          <div className="form-actions">
            <Button type="button" onClick={() => setSeatsOpen(false)}>{t('team.done')}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={securityMode !== null}
        onClose={() => {
          if (!saving && securityMode !== 'recovery') resetSecurityDialog()
        }}
        title={securityMode === 'recovery' ? t('team.saveRecoveryCodes') : t('team.twoFactor')}
        icon={<ShieldCheck size={36} />}
        width="sm"
      >
        {securityMode === 'setup' && (
          <form onSubmit={submitTwoFactorSetup}>
            <div className="account-form-note"><LockKeyhole size={19} /> {t('team.confirmPasswordHint')}</div>
            <Field label={t('team.currentPassword')} error={formError}>
              <input autoFocus type="password" autoComplete="current-password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} required />
            </Field>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={resetSecurityDialog}>{t('common.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('team.preparing') : t('team.continue')}</Button></div>
          </form>
        )}

        {securityMode === 'verify' && twoFactorSetup && (
          <form onSubmit={submitTwoFactorVerification} className="account-two-factor-setup">
            <p>{t('team.scanQr')}</p>
            <div className="account-two-factor-qr"><QRCodeSVG value={twoFactorSetup.otpauth_url} size={184} level="M" /></div>
            <div className="account-two-factor-secret">
              <span><small>{t('team.manualKey')}</small><code>{twoFactorSetup.secret}</code></span>
              <IconButton type="button" label={t('team.copyKey')} onClick={() => void copyText(twoFactorSetup.secret)}><Copy size={16} /></IconButton>
            </div>
            <Field label={t('team.authenticatorCode')} hint={t('team.accountName', { name: twoFactorSetup.account_name })} error={formError}>
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="000000" value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
            </Field>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={resetSecurityDialog}>{t('common.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('team.verifying') : t('team.enable2fa')}</Button></div>
          </form>
        )}

        {securityMode === 'proof' && (
          <form onSubmit={submitTwoFactorProof}>
            <div className="account-form-note"><KeyRound size={19} /> {proofAction === 'disable' ? t('team.disableSignsOut') : t('team.regenerateInvalidates')}</div>
            <div className="form-grid form-grid--single">
              <Field label={t('team.currentPassword')}>
                <input autoFocus type="password" autoComplete="current-password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} required />
              </Field>
              <Field label={t('team.authOrRecoveryCode')} error={formError}>
                <input autoComplete="one-time-code" value={securityCode} onChange={(event) => setSecurityCode(event.target.value)} required />
              </Field>
            </div>
            <div className="form-actions"><Button variant="secondary" type="button" onClick={resetSecurityDialog}>{t('common.cancel')}</Button><Button type="submit" variant={proofAction === 'disable' ? 'danger' : 'primary'} disabled={saving}>{saving ? t('team.confirming') : proofAction === 'disable' ? t('team.disableAndSignOut') : t('team.generateNewCodes')}</Button></div>
          </form>
        )}

        {securityMode === 'recovery' && (
          <div className="account-recovery-codes">
            <div className="account-warning"><KeyRound size={20} /><span><strong>{t('team.codeOnce')}</strong><small>{t('team.codeOnceHint')}</small></span></div>
            <div className="account-recovery-codes__grid">
              {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
            <div className="account-recovery-codes__tools">
              <Button variant="secondary" type="button" onClick={() => void copyText(recoveryCodes.join('\n'))}><Copy size={16} /> {t('team.copyAll')}</Button>
              <Button variant="secondary" type="button" onClick={downloadRecoveryCodes}><Download size={16} /> {t('team.download')}</Button>
            </div>
            <div className="form-actions"><Button type="button" onClick={() => void finishRecoveryCodes()}>{recoveryRequiresSignIn ? t('team.savedSignIn') : t('team.savedCodes')}</Button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
