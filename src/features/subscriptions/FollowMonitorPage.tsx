import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Bell, CheckCircle2, LoaderCircle, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { ApiClient } from '../../api/client'
import type { MonitorSubscriptionPreview } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { LanguageSelect, useI18n } from '../../app/I18nProvider'
import { Button, Field } from '../../components/ui'
import { authErrorMessage, SecureAuthFrame, useConsumedSensitiveToken, validPassword } from '../auth/AuthFlows'
import { TurnstileWidget } from '../auth/TurnstileWidget'

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()

export type FollowMonitorApi = Pick<
  ApiClient,
  'previewMonitorSubscription' | 'requestMonitorSubscription' | 'acceptMonitorSubscription' | 'registerMonitorSubscriber'
>

type FollowMonitorPageProps = {
  api?: FollowMonitorApi
  onComplete?: () => void
}

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function FollowMonitorPage({ api: apiOverride, onComplete }: FollowMonitorPageProps) {
  const auth = useAuth()
  const api = apiOverride ?? auth.api
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const consumedToken = useConsumedSensitiveToken('monitorSubscriptionToken')
  const [token, setToken] = useState(consumedToken)
  const [preview, setPreview] = useState<MonitorSubscriptionPreview | null>(null)
  const [loading, setLoading] = useState(Boolean(consumedToken))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [pendingRegistration, setPendingRegistration] = useState<{ workspaceId: string; workspaceName: string } | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [challengeReset, setChallengeReset] = useState(0)

  const loadPreview = useCallback(async () => {
    if (!token) {
      setLoading(false)
      setError(t('follow.badLinkBody'))
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await api.previewMonitorSubscription(token)
      setPreview(response)
      if (response.email) setEmail(response.email)
    } catch (cause) {
      setError(authErrorMessage(cause, t))
    } finally {
      setLoading(false)
    }
  }, [api, t, token])

  useEffect(() => { void loadPreview() }, [loadPreview])

  const finish = () => {
    if (onComplete) onComplete()
    else window.location.assign('/monitors')
  }

  const accept = async () => {
    if (!token || !auth.workspace) return
    setBusy(true)
    setError('')
    try {
      await api.acceptMonitorSubscription(auth.workspace.id, token)
      finish()
    } catch (cause) {
      setError(authErrorMessage(cause, t))
      setBusy(false)
    }
  }

  const requestLink = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    setBusy(true)
    setError('')
    try {
      const response = await api.requestMonitorSubscription(token, email.trim().toLowerCase(), turnstileToken || undefined)
      const activationToken = response.activation_token?.trim()
      if (activationToken) {
        setLoading(true)
        setPreview(null)
        setToken(activationToken)
        setBusy(false)
        return
      }
      setSent(true)
    } catch (cause) {
      setError(authErrorMessage(cause, t))
      setChallengeReset((value) => value + 1)
      setBusy(false)
    }
  }

  const register = async (event: FormEvent) => {
    event.preventDefault()
    if (!token || !preview?.email) return
    if (!validPassword(password)) {
      setError(t('follow.passwordHint'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await api.registerMonitorSubscriber({
        token,
        name: name.trim(),
        password,
        locale,
        timezone: currentTimezone(),
      })
      if (response.subscription_pending || !response.subscription) {
        setPendingRegistration({ workspaceId: response.tenant.id, workspaceName: response.tenant.name })
        try {
          await api.acceptMonitorSubscription(response.tenant.id, token)
        } catch (cause) {
          setError(authErrorMessage(cause, t))
          setBusy(false)
          return
        }
      }
      finish()
    } catch (cause) {
      setError(authErrorMessage(cause, t))
      setBusy(false)
    }
  }

  const login = () => {
    if (!token) return
    navigate('/login', {
      state: {
        email: preview?.email,
        from: {
          pathname: '/follow-monitor',
          state: { monitorSubscriptionToken: token },
        },
      },
    })
  }

  const retryPendingRegistration = async () => {
    if (!token || !pendingRegistration) return
    setBusy(true)
    setError('')
    try {
      await api.acceptMonitorSubscription(pendingRegistration.workspaceId, token)
      finish()
    } catch (cause) {
      setError(authErrorMessage(cause, t))
      setBusy(false)
    }
  }

  if (loading || auth.loading) {
    return (
      <SecureAuthFrame icon={<LoaderCircle className="follow-monitor-spinner" size={27} />} title={t('follow.loading')} description="">
        <div className="follow-monitor-language"><LanguageSelect /></div>
      </SecureAuthFrame>
    )
  }

  if (!preview) {
    return (
      <SecureAuthFrame icon={<Bell size={27} />} title={t('follow.badLinkTitle')} description={error || t('follow.badLinkBody')}>
        {token && <Button type="button" size="lg" onClick={() => void loadPreview()}>{t('follow.retry')}</Button>}
      </SecureAuthFrame>
    )
  }

  if (pendingRegistration) {
    return (
      <SecureAuthFrame icon={<Bell size={27} />} title={t('follow.title', { monitor: preview.monitor_name })} description={t('follow.pendingBody')}>
        <div className="auth-form">
          <div className="follow-monitor-summary">{t('follow.workspace', { workspace: pendingRegistration.workspaceName })}</div>
          {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
          <Button type="button" size="lg" disabled={busy} onClick={() => void retryPendingRegistration()}>
            {busy ? t('follow.confirming') : t('follow.retry')} {!busy && <ArrowRight size={18} />}
          </Button>
        </div>
      </SecureAuthFrame>
    )
  }

  if (auth.authenticated) {
    return (
      <SecureAuthFrame
        icon={<Bell size={27} />}
        title={t('follow.title', { monitor: preview.monitor_name })}
        description={t('follow.description')}
      >
        <div className="auth-form">
          {auth.workspace && <div className="follow-monitor-summary">{t('follow.workspace', { workspace: auth.workspace.name })}</div>}
          {!auth.workspace && <div className="auth-message auth-message--error">{t('authError.forbidden')}</div>}
          {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
          <Button type="button" size="lg" disabled={busy || !auth.workspace} onClick={() => void accept()}>
            {busy ? t('follow.confirming') : t('follow.confirm')} {!busy && <ArrowRight size={18} />}
          </Button>
        </div>
      </SecureAuthFrame>
    )
  }

  if (sent) {
    return (
      <SecureAuthFrame icon={<CheckCircle2 size={27} />} title={t('follow.sentTitle')} description={t('follow.sentBody')}>
        <div className="follow-monitor-summary">{email.trim().toLowerCase()}</div>
      </SecureAuthFrame>
    )
  }

  if (preview.kind === 'capability') {
    return (
      <SecureAuthFrame
        icon={<Mail size={27} />}
        title={t('follow.emailTitle', { monitor: preview.monitor_name })}
        description={t('follow.emailDescription')}
      >
        <form className="auth-form" onSubmit={requestLink}>
          <Field label={t('follow.email')}>
            <div className="input-with-icon"><Mail size={18} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          </Field>
          {TURNSTILE_SITE_KEY && <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} action="register" resetSignal={challengeReset} onToken={setTurnstileToken} />}
          {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
          <Button type="submit" size="lg" disabled={busy || Boolean(TURNSTILE_SITE_KEY) && !turnstileToken}>
            {busy ? t('follow.sending') : t('follow.sendLink')} {!busy && <ArrowRight size={18} />}
          </Button>
        </form>
      </SecureAuthFrame>
    )
  }

  if (preview.account_exists) {
    return (
      <SecureAuthFrame
        icon={<LockKeyhole size={27} />}
        title={t('follow.loginTitle')}
        description={t('follow.loginBody', { email: preview.email ?? email })}
      >
        {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
        <Button type="button" size="lg" onClick={login}>{t('follow.login')} <ArrowRight size={18} /></Button>
      </SecureAuthFrame>
    )
  }

  return (
    <SecureAuthFrame
      icon={<UserRound size={27} />}
      title={t('follow.registerTitle')}
      description={t('follow.registerBody', { monitor: preview.monitor_name })}
    >
      <form className="auth-form" onSubmit={register}>
        <Field label={t('follow.email')}><div className="input-with-icon"><Mail size={18} /><input value={preview.email ?? email} readOnly aria-readonly="true" /></div></Field>
        <Field label={t('follow.name')}><div className="input-with-icon"><UserRound size={18} /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} /></div></Field>
        <Field label={t('follow.password')} hint={t('follow.passwordHint')}><div className="input-with-icon"><LockKeyhole size={18} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={12} /></div></Field>
        {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
        <Button type="submit" size="lg" disabled={busy || name.trim().length < 2 || !validPassword(password)}>
          {busy ? t('follow.creating') : t('follow.create')} {!busy && <ArrowRight size={18} />}
        </Button>
      </form>
    </SecureAuthFrame>
  )
}

export default FollowMonitorPage
