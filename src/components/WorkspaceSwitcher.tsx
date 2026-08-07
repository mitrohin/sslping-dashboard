import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../app/AuthProvider'
import { useI18n } from '../app/I18nProvider'
import { Button, Field, Modal, Select } from './ui'

type SwitchStep = 'password' | 'two_factor'

function switchErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return t('authError.rateLimited')
    if (error.status === 401 || error.status === 403) return t('authError.unauthorized')
    return t('authError.unavailable')
  }
  if (error instanceof TypeError) return t('authError.network')
  return t('authError.generic')
}

export function WorkspaceSwitcher({ onSwitched }: { onSwitched?: () => void }) {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const tenants = auth.tenants ?? []
  const alternatives = useMemo(
    () => tenants.filter((tenant) => tenant.id !== auth.workspace?.id),
    [auth.workspace?.id, tenants],
  )
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<SwitchStep>('password')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!alternatives.some((tenant) => tenant.id === targetId)) setTargetId(alternatives[0]?.id ?? '')
  }, [alternatives, targetId])

  const reset = () => {
    setOpen(false)
    setPassword('')
    setCode('')
    setStep('password')
    setBusy(false)
    setError(undefined)
  }

  const finish = () => {
    reset()
    onSwitched?.()
    navigate('/monitors', { replace: true })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      if (step === 'two_factor') {
        await auth.complete2FA(code.trim())
        finish()
        return
      }

      const outcome = await auth.changeWorkspace(targetId, password)
      setPassword('')
      if (outcome.status === 'authenticated') {
        finish()
      } else if (outcome.status === 'two_factor_required') {
        setStep('two_factor')
      } else {
        setError(t('authError.forbidden'))
      }
    } catch (cause) {
      setError(switchErrorMessage(cause, t))
      if (step === 'two_factor') setCode('')
    } finally {
      setBusy(false)
    }
  }

  const canShow = auth.authenticated && auth.user?.system_role !== 'accountant' && !auth.impersonation && tenants.length > 1 && alternatives.length > 0
  if (!canShow) return null

  const currentName = auth.workspace?.name ?? t('shell.workspace')
  const selectedWorkspace = alternatives.find((tenant) => tenant.id === targetId)

  return (
    <>
      <button
        className="workspace-switcher-button"
        type="button"
        aria-label={`${t('shell.switchWorkspace')}: ${currentName}`}
        title={`${t('shell.switchWorkspace')}: ${currentName}`}
        onClick={() => setOpen(true)}
      >
        <Building2 size={20} aria-hidden="true" />
        <span className="workspace-switcher-button__copy">
          <small>{t('shell.workspace')}</small>
          <strong>{currentName}</strong>
        </span>
        <span className="workspace-switcher-button__mark" aria-hidden="true">↕</span>
      </button>

      <Modal
        open={open}
        onClose={() => { if (!busy) reset() }}
        title={t('shell.switchWorkspace')}
        icon={step === 'two_factor' ? <KeyRound size={31} /> : <Building2 size={31} />}
        width="sm"
      >
        <form className="workspace-switcher-form" onSubmit={submit}>
          {step === 'password' ? (
            <>
              <p>{t('shell.switchWorkspaceHint')}</p>
              <Field label={t('shell.workspace')}>
                <Select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={busy} autoFocus>
                  {alternatives.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                </Select>
              </Field>
              <Field label={t('auth.password')} hint={t('shell.passwordToSwitch')}>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={busy}
                  required
                />
              </Field>
            </>
          ) : (
            <>
              <p>{t('authFlow.twoFactorHint', { email: auth.user?.email ?? '' })}</p>
              <div className="workspace-switcher-form__target" role="status">
                <span>{t('shell.workspace')}</span>
                <strong>{selectedWorkspace?.name}</strong>
              </div>
              <Field label={t('authFlow.authenticationCode')} hint={t('authFlow.codeHint')}>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  autoFocus
                  minLength={6}
                  maxLength={64}
                  disabled={busy}
                  required
                />
              </Field>
            </>
          )}

          {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
          <div className="workspace-switcher-form__actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={reset}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              disabled={busy || !targetId || (step === 'password' ? password.length === 0 : code.trim().length < 6)}
            >
              {busy
                ? step === 'two_factor' ? t('authFlow.verifying') : t('shell.switchingWorkspace')
                : step === 'two_factor' ? t('authFlow.verifyContinue') : t('shell.switchWorkspace')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
