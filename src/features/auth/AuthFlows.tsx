import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, KeyRound, MailCheck, ShieldCheck } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useAuth } from '../../app/AuthProvider'
import { Brand } from '../../components/AppShell'
import { Button, Field } from '../../components/ui'
import { AuthPage } from './AuthPage'

const DEFAULT_AUTH_DESTINATION = '/monitors'

type LocationState = {
  from?: unknown
  email?: unknown
  verificationToken?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeLocalPath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) return null
  return path
}

export function authReturnPath(state: unknown): string {
  if (!isRecord(state)) return DEFAULT_AUTH_DESTINATION
  const from = state.from
  if (typeof from === 'string') return safeLocalPath(from) ?? DEFAULT_AUTH_DESTINATION
  if (!isRecord(from) || typeof from.pathname !== 'string') return DEFAULT_AUTH_DESTINATION

  const pathname = safeLocalPath(from.pathname)
  if (!pathname) return DEFAULT_AUTH_DESTINATION
  const search = typeof from.search === 'string' && from.search.startsWith('?') ? from.search : ''
  const hash = typeof from.hash === 'string' && from.hash.startsWith('#') ? from.hash : ''
  return `${pathname}${search}${hash}`
}

function forwardedFrom(state: unknown): unknown {
  return isRecord(state) && state.from !== undefined ? state.from : authReturnPath(state)
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') return 'Too many attempts. Please wait a moment and try again.'
    if (error.code === 'unauthorized') return 'The email, password, or security code is incorrect.'
    if (error.code === 'forbidden') return 'This action is not available for this account.'
    if (error.code === 'not_found') return 'This link is invalid, expired, or has already been used.'
    if (error.code === 'conflict') return error.problem.detail || 'This account information is already in use.'
    if (error.code === 'invalid_request') {
      const fieldErrors = error.problem.errors ? Object.values(error.problem.errors) : []
      return fieldErrors[0] ?? error.problem.detail ?? 'Please check the entered information.'
    }
    return 'SSLPing is temporarily unavailable. Please try again later.'
  }

  if (error instanceof TypeError) return 'Unable to reach SSLPing. Check your connection and try again.'
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

export function LoginController() {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (values: { email: string; password: string }) => {
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await auth.login(values)
      if (outcome.status === 'authenticated') {
        navigate(authReturnPath(location.state), { replace: true })
      } else if (outcome.status === 'two_factor_required') {
        navigate('/login/2fa', { state: { from: forwardedFrom(location.state) } })
      } else {
        navigate('/verify-email', {
          state: { from: forwardedFrom(location.state), email: outcome.email },
        })
      }
    } catch (cause) {
      setError(authErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <AuthPage mode="login" busy={busy} error={error} onSubmit={submit} />
}

export function RegisterController() {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (values: { email: string; password: string; name: string; workspaceName: string }) => {
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await auth.register({
        email: values.email,
        password: values.password,
        name: values.name,
        workspace_name: values.workspaceName.trim() || undefined,
      })
      if (outcome.status === 'authenticated') {
        navigate(authReturnPath(location.state), { replace: true })
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
      setError(authErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <AuthPage mode="register" busy={busy} error={error} onSubmit={submit} />
}

export function ForgotPasswordController() {
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
      setSuccess('If an account exists for this address, a password reset email has been sent.')
    } catch (cause) {
      setError(authErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <AuthPage mode="forgot" busy={busy} error={error} success={success} onSubmit={submit} />
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
  return (
    <main className="auth-layout">
      <section className="auth-showcase" aria-label="SSLPing account security">
        <div className="auth-showcase__content">
          <Brand />
          <div className="auth-showcase__copy">
            <p className="eyebrow">Account security</p>
            <h1>Your monitors.<br /><span>Protected.</span></h1>
            <p>Secure access keeps incidents, integrations and operational data inside your team.</p>
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
        <p className="auth-legal">SSLPing security controls protect every workspace.</p>
      </section>
    </main>
  )
}

export function TwoFactorController() {
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
      navigate(authReturnPath(location.state), { replace: true })
    } catch (cause) {
      setError(authErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SecureAuthFrame
      icon={<KeyRound size={27} />}
      title="Two-factor authentication"
      description={`Enter the code from your authenticator app for ${challenge.user.email}, or use an unused recovery code.`}
    >
      <form className="auth-form" onSubmit={submit}>
        <Field label="Authentication code" hint="Six-digit TOTP or recovery code">
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
          {busy ? 'Verifying…' : 'Verify and continue'}
          {!busy && <ArrowRight size={18} aria-hidden="true" />}
        </Button>
      </form>
      <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
    </SecureAuthFrame>
  )
}

export function EmailVerificationController() {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const state = (isRecord(location.state) ? location.state : {}) as LocationState
  const stateToken = typeof state.verificationToken === 'string' ? state.verificationToken : null
  const token = searchParams.get('token') ?? stateToken
  const initialEmail = useMemo(() => {
    if (typeof state.email === 'string') return state.email
    return auth.pendingVerificationEmail ?? auth.user?.email ?? ''
  }, [auth.pendingVerificationEmail, auth.user?.email, state.email])
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [confirmed, setConfirmed] = useState(false)

  const confirm = async () => {
    if (!token) return
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await auth.confirmEmailVerification(token)
      setConfirmed(true)
      setMessage('Your email address has been verified. You can now sign in.')
    } catch (cause) {
      setError(authErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const resend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await auth.requestEmailVerification(email)
      setMessage('If this address needs verification, a new confirmation email has been sent.')
    } catch (cause) {
      setError(authErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SecureAuthFrame
      icon={<MailCheck size={27} />}
      title={confirmed ? 'Email verified' : 'Verify your email'}
      description={token
        ? 'Confirm this one-time link to activate email sign-in for your account.'
        : 'Check your inbox for a confirmation link. Delivery can take a few minutes.'}
    >
      {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
      {message && <div className="auth-message auth-message--success" role="status">{message}</div>}

      {confirmed ? (
        <div className="auth-form">
          <Button type="button" size="lg" onClick={() => navigate('/login', { replace: true, state: { from: forwardedFrom(location.state) } })}>
            Continue to sign in <ArrowRight size={18} aria-hidden="true" />
          </Button>
        </div>
      ) : token ? (
        <div className="auth-form">
          <Button type="button" size="lg" onClick={confirm} disabled={busy}>
            {busy ? 'Confirming…' : 'Confirm email'}
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </Button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={resend}>
          <Field label="E-mail" hint="Use the same address you registered with.">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Button type="submit" size="lg" disabled={busy || email.trim().length === 0}>
            {busy ? 'Sending…' : 'Resend verification email'}
          </Button>
        </form>
      )}
      {!confirmed && <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>}
    </SecureAuthFrame>
  )
}

export const TwoFactorChallengeController = TwoFactorController
export const VerifyEmailController = EmailVerificationController
