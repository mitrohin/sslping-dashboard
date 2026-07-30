import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, MailCheck, ShieldCheck, UserPlus } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { useAuth } from '../../app/AuthProvider'
import { Brand } from '../../components/AppShell'
import { Button, Field } from '../../components/ui'
import { AuthPage } from './AuthPage'
import type { CustomerRegion } from '../../api/types'
import type { RegisterValues } from './AuthPage'
import { useI18n } from '../../app/I18nProvider'

const DEFAULT_AUTH_DESTINATION = '/monitors'

type LocationState = {
  from?: unknown
  email?: unknown
  verificationToken?: unknown
  inviteToken?: unknown
  resetToken?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeLocalPath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) return null
  return path
}

type AuthReturnDestination = { to: string; state?: unknown }

export function authReturnDestination(state: unknown): AuthReturnDestination {
  if (!isRecord(state)) return { to: DEFAULT_AUTH_DESTINATION }
  const from = state.from
  if (typeof from === 'string') return { to: safeLocalPath(from) ?? DEFAULT_AUTH_DESTINATION }
  if (!isRecord(from) || typeof from.pathname !== 'string') return { to: DEFAULT_AUTH_DESTINATION }

  const pathname = safeLocalPath(from.pathname)
  if (!pathname) return { to: DEFAULT_AUTH_DESTINATION }
  const search = typeof from.search === 'string' && from.search.startsWith('?') ? from.search : ''
  const hash = typeof from.hash === 'string' && from.hash.startsWith('#') ? from.hash : ''
  return { to: `${pathname}${search}${hash}`, state: from.state }
}

export function authReturnPath(state: unknown): string {
  return authReturnDestination(state).to
}

function forwardedFrom(state: unknown): unknown {
  return isRecord(state) && state.from !== undefined ? state.from : authReturnPath(state)
}

function fragmentSearchParams(hash: string): URLSearchParams | null {
  const raw = hash.replace(/^#/, '')
  if (!raw || raw.startsWith('/')) return null
  return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
}

export function sensitiveTokenFromLocation(search: string, hash: string): string | null {
  const queryToken = new URLSearchParams(search).get('token')?.trim()
  if (queryToken) return queryToken
  return fragmentSearchParams(hash)?.get('token')?.trim() || null
}

function useConsumedSensitiveToken(stateKey: 'verificationToken' | 'inviteToken' | 'resetToken'): string | null {
  const location = useLocation()
  const navigate = useNavigate()
  const state = isRecord(location.state) ? location.state : undefined
  const [token] = useState(() => sensitiveTokenFromLocation(location.search, location.hash)
    ?? (typeof state?.[stateKey] === 'string' ? state[stateKey].trim() || null : null))

  useEffect(() => {
    const query = new URLSearchParams(location.search)
    const hadQueryToken = query.has('token')
    query.delete('token')

    const fragment = fragmentSearchParams(location.hash)
    const hadFragmentToken = fragment?.has('token') ?? false
    fragment?.delete('token')
    const nextHash = fragment
      ? fragment.toString() ? `#${fragment.toString()}` : ''
      : location.hash

    const nextState = state ? { ...state } : undefined
    const hadStateToken = Boolean(nextState && stateKey in nextState)
    if (nextState) delete nextState[stateKey]

    if (hadQueryToken || hadFragmentToken || hadStateToken) {
      const nextSearch = query.toString()
      navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '', hash: nextHash },
        { replace: true, state: nextState },
      )
    }
  // The initial location is intentionally consumed exactly once. The token is
  // retained only in component memory after the URL/history state is cleaned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return token
}

export function authErrorMessage(error: unknown, translate?: (key: string) => string): string {
  const message = (key: string, fallback: string) => {
    const translated = translate?.(key)
    return translated && translated !== key ? translated : fallback
  }
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') return message('authError.rateLimited', 'Too many attempts. Please wait a moment and try again.')
    if (error.code === 'unauthorized') return message('authError.unauthorized', 'The email, password, or security code is incorrect.')
    if (error.code === 'forbidden') return message('authError.forbidden', 'This action is not available for this account.')
    if (error.code === 'not_found') return message('authError.notFound', 'This link is invalid, expired, or has already been used.')
    if (error.code === 'conflict') return error.problem.detail || message('authError.conflict', 'This account information is already in use.')
    if (error.code === 'invalid_request') {
      const fieldErrors = error.problem.errors ? Object.values(error.problem.errors) : []
      return fieldErrors[0] ?? error.problem.detail ?? message('authError.invalid', 'Please check the entered information.')
    }
    return message('authError.unavailable', 'SSLPing is temporarily unavailable. Please try again later.')
  }

  if (error instanceof TypeError) return message('authError.network', 'Unable to reach SSLPing. Check your connection and try again.')
  if (error instanceof Error && error.message) return error.message
  return message('authError.generic', 'Something went wrong. Please try again.')
}

export function LoginController() {
  const { t } = useI18n()
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const state = isRecord(location.state) ? location.state : {}
  const success = state.emailVerified === true ? t('authFlow.emailVerifiedMessage') : undefined

  const submit = async (values: { email: string; password: string }) => {
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await auth.login(values)
      if (outcome.status === 'authenticated') {
        const destination = authReturnDestination(location.state)
        navigate(destination.to, { replace: true, state: destination.state })
      } else if (outcome.status === 'two_factor_required') {
        navigate('/login/2fa', { state: { from: forwardedFrom(location.state) } })
      } else {
        navigate('/verify-email', {
          state: { from: forwardedFrom(location.state), email: outcome.email },
        })
      }
    } catch (cause) {
      setError(authErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return <AuthPage mode="login" busy={busy} error={error} success={success} onSubmit={submit} />
}

export function RegisterController() {
  const { t } = useI18n()
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [regions, setRegions] = useState<CustomerRegion[]>([])
  const [regionsLoading, setRegionsLoading] = useState(true)
  const [challengeReset, setChallengeReset] = useState(0)

  useEffect(() => {
    let cancelled = false
    auth.api.listCustomerRegions()
      .then((response) => { if (!cancelled) setRegions(response.items.filter((region) => region.active)) })
      .catch((cause) => { if (!cancelled) setError(authErrorMessage(cause, t)) })
      .finally(() => { if (!cancelled) setRegionsLoading(false) })
    return () => { cancelled = true }
  }, [auth.api, t])

  const submit = async (values: RegisterValues) => {
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await auth.register({
        email: values.email,
        password: values.password,
        name: values.name,
        workspace_name: values.workspaceName.trim() || undefined,
        region_code: values.regionCode,
        locale: values.locale,
        turnstile_token: values.turnstileToken,
      })
      if (outcome.status === 'authenticated') {
        const destination = authReturnDestination(location.state)
        navigate(destination.to, { replace: true, state: destination.state })
      } else {
        navigate('/verify-email', {
          replace: true,
          state: {
            from: forwardedFrom(location.state),
            email: outcome.email,
            verificationToken: outcome.verificationToken,
          },
        })
      }
    } catch (cause) {
      setError(authErrorMessage(cause, t))
      setChallengeReset((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  return <AuthPage mode="register" busy={busy} error={error} regions={regions} regionsLoading={regionsLoading} challengeReset={challengeReset} onSubmit={submit} />
}

export function ForgotPasswordController() {
  const { t } = useI18n()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()

  const submit = async ({ email }: { email: string }) => {
    setBusy(true)
    setError(undefined)
    setSuccess(undefined)
    try {
      await auth.forgot(email)
      setSuccess(t('authFlow.resetSent'))
    } catch (cause) {
      setError(authErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return <AuthPage mode="forgot" busy={busy} error={error} success={success} onSubmit={submit} />
}

function validPassword(value: string): boolean {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)
}

export function ResetPasswordController() {
  const { t } = useI18n()
  const { api } = useAuth()
  const token = useConsumedSensitiveToken('resetToken')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    if (!validPassword(password)) {
      setError(t('authFlow.passwordRequirements'))
      return
    }
    if (password !== confirmation) {
      setError(t('authFlow.passwordMismatch'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await api.resetPassword({ token, new_password: password })
      setPassword('')
      setConfirmation('')
      setComplete(true)
    } catch (cause) {
      setError(authErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SecureAuthFrame
      icon={complete ? <CheckCircle2 size={27} /> : <LockKeyhole size={27} />}
      title={complete ? t('authFlow.passwordResetComplete') : t('authFlow.choosePassword')}
      description={complete ? t('authFlow.passwordResetCompleteHint') : t('authFlow.choosePasswordHint')}
    >
      {!token ? (
        <div className="auth-form">
          <div className="auth-message auth-message--error" role="alert">{t('authFlow.missingResetToken')}</div>
          <Link className="button button--primary button--lg" to="/forgot-password">{t('authFlow.requestNewReset')}</Link>
        </div>
      ) : complete ? (
        <div className="auth-form">
          <div className="auth-message auth-message--success" role="status">{t('authFlow.passwordResetSuccess')}</div>
          <Link className="button button--primary button--lg" to="/login">{t('authFlow.continueSignIn')}</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <Field label={t('authFlow.newPassword')} hint={t('auth.passwordHint')}>
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required />
          </Field>
          <Field label={t('authFlow.confirmPassword')}>
            <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required />
          </Field>
          {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? t('authFlow.resettingPassword') : t('authFlow.resetPasswordAction')}
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </Button>
        </form>
      )}
    </SecureAuthFrame>
  )
}

export function AcceptInvitationController() {
  const { t } = useI18n()
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const token = useConsumedSensitiveToken('inviteToken')
  const started = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (auth.loading || !token || started.current) return
    if (!auth.authenticated) {
      navigate('/login', {
        replace: true,
        state: { from: { pathname: location.pathname, state: { inviteToken: token } } },
      })
      return
    }

    started.current = true
    setError(undefined)
    auth.api.acceptInvitation({ token })
      .then(() => setComplete(true))
      .catch((cause) => {
        started.current = false
        setError(authErrorMessage(cause, t))
      })
  }, [attempt, auth.api, auth.authenticated, auth.loading, location.pathname, navigate, t, token])

  return (
    <SecureAuthFrame
      icon={complete ? <CheckCircle2 size={27} /> : <UserPlus size={27} />}
      title={complete ? t('authFlow.invitationAccepted') : t('authFlow.acceptInvitation')}
      description={complete ? t('authFlow.invitationAcceptedHint') : t('authFlow.acceptInvitationHint')}
    >
      {!token ? (
        <div className="auth-message auth-message--error" role="alert">{t('authFlow.missingInviteToken')}</div>
      ) : error ? (
        <div className="auth-form">
          <div className="auth-message auth-message--error" role="alert">{error}</div>
          <Button type="button" size="lg" onClick={() => setAttempt((value) => value + 1)}>
            {t('authFlow.retryInvitation')}
          </Button>
          <Link className="button button--primary button--lg" to="/monitors">{t('app.returnMonitoring')}</Link>
        </div>
      ) : complete ? (
        <div className="auth-form">
          <div className="auth-message auth-message--success" role="status">{t('authFlow.invitationAcceptedMessage')}</div>
          <a className="button button--primary button--lg" href="/monitors">{t('app.returnMonitoring')}</a>
        </div>
      ) : (
        <div className="auth-form"><p aria-live="polite">{t('authFlow.acceptingInvitation')}</p></div>
      )}
    </SecureAuthFrame>
  )
}

function SecureAuthFrame({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <main className="auth-layout">
      <section className="auth-showcase" aria-label={t('authFlow.security')}>
        <div className="auth-showcase__content">
          <Brand />
          <div className="auth-showcase__copy">
            <p className="eyebrow">{t('authFlow.security')}</p>
            <h1>{t('authFlow.yourMonitors')}<br /><span>{t('authFlow.protected')}</span></h1>
            <p>{t('authFlow.securityHint')}</p>
          </div>
        </div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-form-card">
          <div className="auth-form-card__icon" aria-hidden="true">{icon}</div>
          <h2>{title}<span className="title-dot">.</span></h2>
          <p>{description}</p>
          {children}
        </div>
        <p className="auth-legal">{t('authFlow.securityLegal')}</p>
      </section>
    </main>
  )
}

export function TwoFactorController() {
  const { t } = useI18n()
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [challenge] = useState(auth.twoFactorChallenge)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (!challenge) {
    return <Navigate to="/login" replace state={{ from: forwardedFrom(location.state) }} />
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await auth.complete2FA(code.trim())
      const destination = authReturnDestination(location.state)
      navigate(destination.to, { replace: true, state: destination.state })
    } catch (cause) {
      setError(authErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SecureAuthFrame
      icon={<KeyRound size={27} />}
      title={t('authFlow.twoFactor')}
      description={t('authFlow.twoFactorHint', { email: challenge.user.email })}
    >
      <form className="auth-form" onSubmit={submit}>
        <Field label={t('authFlow.authenticationCode')} hint={t('authFlow.codeHint')}>
          <div className="input-with-icon">
            <ShieldCheck size={18} aria-hidden="true" />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              autoFocus
              minLength={6}
              maxLength={64}
              aria-describedby={error ? 'two-factor-error' : undefined}
              required
            />
          </div>
        </Field>
        {error && <div id="two-factor-error" className="auth-message auth-message--error" role="alert">{error}</div>}
        <Button type="submit" size="lg" disabled={busy || code.trim().length < 6}>
          {busy ? t('authFlow.verifying') : t('authFlow.verifyContinue')}
          {!busy && <ArrowRight size={18} aria-hidden="true" />}
        </Button>
      </form>
      <p className="auth-switch"><Link to="/login">{t('auth.backSignIn')}</Link></p>
    </SecureAuthFrame>
  )
}

export function EmailVerificationController() {
  const { t } = useI18n()
  const auth = useAuth()
  const confirmEmailVerification = auth.confirmEmailVerification
  const requestEmailVerification = auth.requestEmailVerification
  const location = useLocation()
  const navigate = useNavigate()
  const state = (isRecord(location.state) ? location.state : {}) as LocationState
  const token = useConsumedSensitiveToken('verificationToken')
  const initialEmail = useMemo(() => {
    if (typeof state.email === 'string') return state.email
    return auth.pendingVerificationEmail ?? auth.user?.email ?? ''
  }, [auth.pendingVerificationEmail, auth.user?.email, state.email])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    confirmEmailVerification(token)
      .then(() => {
        if (!cancelled) {
          navigate('/login', {
            replace: true,
            state: { from: forwardedFrom(location.state), emailVerified: true },
          })
        }
      })
      .catch((cause) => { if (!cancelled) setError(authErrorMessage(cause, t)) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [confirmEmailVerification, location.state, navigate, t, token])

  const resend = async () => {
    if (!initialEmail) return
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await requestEmailVerification(initialEmail)
      setMessage(t('authFlow.verificationSent'))
    } catch (cause) {
      setError(authErrorMessage(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SecureAuthFrame
      icon={<MailCheck size={27} />}
      title={t('authFlow.verifyEmail')}
      description={token
        ? t('authFlow.confirmLinkHint')
        : t('authFlow.checkInbox')}
    >
      {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
      {message && <div className="auth-message auth-message--success" role="status">{message}</div>}

      {token ? (
        <div className="auth-form">
          {busy && <div className="auth-message" role="status">{t('authFlow.confirming')}</div>}
        </div>
      ) : (
        <div className="auth-form">
          {initialEmail && <p>{initialEmail}</p>}
          <Button type="button" size="lg" onClick={resend} disabled={busy || !initialEmail}>
            {busy ? t('authFlow.sending') : t('authFlow.resendVerification')}
          </Button>
        </div>
      )}
      <p className="auth-switch"><Link to="/login">{t('auth.backSignIn')}</Link></p>
    </SecureAuthFrame>
  )
}

export const TwoFactorChallengeController = TwoFactorController
export const VerifyEmailController = EmailVerificationController
