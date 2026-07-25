import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from '../../components/AppShell'
import { Button, Field } from '../../components/ui'

type LoginValues = { email: string; password: string }
type RegisterValues = LoginValues & { name: string; workspaceName: string }

export type AuthPageProps =
  | {
      mode: 'login'
      busy?: boolean
      error?: string
      onSubmit: (values: LoginValues) => Promise<void> | void
    }
  | {
      mode: 'register'
      busy?: boolean
      error?: string
      onSubmit: (values: RegisterValues) => Promise<void> | void
    }
  | {
      mode: 'forgot'
      busy?: boolean
      error?: string
      success?: string
      onSubmit: (values: { email: string }) => Promise<void> | void
    }

export function AuthPage(props: AuthPageProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (props.mode === 'login') await props.onSubmit({ email, password })
    if (props.mode === 'register') await props.onSubmit({ email, password, name, workspaceName })
    if (props.mode === 'forgot') await props.onSubmit({ email })
  }

  const title = props.mode === 'login' ? 'Welcome back' : props.mode === 'register' ? 'Create your workspace' : 'Reset your password'
  const subtitle = props.mode === 'login'
    ? 'Sign in to monitor your entire stack.'
    : props.mode === 'register'
      ? 'Start monitoring in less than two minutes.'
      : 'We will send a secure reset link to your email.'

  return (
    <main className="auth-layout">
      <section className="auth-showcase" aria-label="SSLPing overview">
        <div className="auth-showcase__content">
          <Brand />
          <div className="auth-showcase__copy">
            <p className="eyebrow">Incident intelligence</p>
            <h1>Know first.<br /><span>Respond faster.</span></h1>
            <p>Monitor websites, APIs, SSL, DNS, ports and scheduled jobs from one calm control room.</p>
          </div>
          <div className="auth-signal-card">
            <div className="auth-signal-card__header">
              <span><span className="status-dot status-dot--up" /> All systems operational</span>
              <strong>99.99%</strong>
            </div>
            <div className="auth-signal-card__bars" aria-hidden="true">
              {Array.from({ length: 28 }, (_, index) => <span key={index} className={index === 21 ? 'is-warning' : ''} />)}
            </div>
            <div className="auth-signal-card__stats">
              <span><strong>142 ms</strong> Avg. response</span>
              <span><strong>24</strong> Active monitors</span>
              <span><strong>0</strong> Open incidents</span>
            </div>
          </div>
          <ul className="auth-benefits">
            <li><Check size={16} /> Multi-region verification</li>
            <li><Check size={16} /> Actionable alerts, not noise</li>
            <li><Check size={16} /> GDPR-ready status pages</li>
          </ul>
        </div>
      </section>

      <section className="auth-form-wrap">
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-form-card">
          <div className="auth-form-card__icon"><ShieldCheck size={27} /></div>
          <h2>{title}<span className="title-dot">.</span></h2>
          <p>{subtitle}</p>

          <form onSubmit={handleSubmit} className="auth-form">
            {props.mode === 'register' && (
              <div className="form-grid">
                <Field label="Your name">
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Alex Mitrohin" required minLength={2} />
                </Field>
                <Field label="Workspace">
                  <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Acme Operations" maxLength={120} />
                </Field>
              </div>
            )}
            <Field label="E-mail">
              <div className="input-with-icon">
                <Mail size={18} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@company.com" required />
              </div>
            </Field>
            {props.mode !== 'forgot' && (
              <Field
                label="Password"
                hint={props.mode === 'register' ? '12+ characters with upper, lower case and a number.' : undefined}
              >
                <div className="input-with-icon">
                  <LockKeyhole size={18} />
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={props.mode === 'register' ? 'new-password' : 'current-password'} placeholder="••••••••••••" required minLength={props.mode === 'register' ? 12 : 1} />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
            )}

            {props.error && <div className="auth-message auth-message--error">{props.error}</div>}
            {'success' in props && props.success && <div className="auth-message auth-message--success">{props.success}</div>}

            {props.mode === 'login' && <div className="auth-form__meta"><Link to="/forgot-password">Forgot password?</Link></div>}
            <Button type="submit" size="lg" disabled={props.busy}>
              {props.busy ? 'Please wait…' : props.mode === 'login' ? 'Sign in' : props.mode === 'register' ? 'Create account' : 'Send reset link'}
              {!props.busy && <ArrowRight size={18} />}
            </Button>
          </form>

          <p className="auth-switch">
            {props.mode === 'login' && <>New to SSLPing? <Link to="/register">Create an account</Link></>}
            {props.mode === 'register' && <>Already have an account? <Link to="/login">Sign in</Link></>}
            {props.mode === 'forgot' && <><Link to="/login">Back to sign in</Link></>}
          </p>
          {props.mode === 'login' && (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') && (
            <Link className="auth-demo-link" to="/demo">Preview the complete demo dashboard</Link>
          )}
        </div>
        <p className="auth-legal">By continuing, you agree to the Terms and Privacy Policy.</p>
      </section>
    </main>
  )
}
