import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { Brand } from '../../components/AppShell'
import { Button, Field, Select } from '../../components/ui'
import type { CustomerRegion, Locale } from '../../api/types'
import { LanguageSelect, useI18n } from '../../app/I18nProvider'
import { TurnstileWidget } from './TurnstileWidget'

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()

type LoginValues = { email: string; password: string; turnstileToken?: string }
export type RegisterValues = LoginValues & { name: string; workspaceName: string; regionCode: string; locale: Locale; turnstileToken?: string }

export type AuthPageProps =
  | {
      mode: 'login'
      busy?: boolean
      error?: string
      success?: string
      captchaRequired?: boolean
      challengeReset?: number
      onSubmit: (values: LoginValues) => Promise<void> | void
    }
  | {
      mode: 'register'
      busy?: boolean
      error?: string
      regions: CustomerRegion[]
      regionsLoading?: boolean
      challengeReset?: number
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
  const { locale, setLocale, t } = useI18n()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [regionCode, setRegionCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')

  useEffect(() => {
    if (props.mode !== 'register' || regionCode || props.regions.length === 0) return
    const initial = props.regions.find((region) => region.default) ?? props.regions[0]
    setRegionCode(initial.code)
    void setLocale(initial.default_locale, false)
  }, [props, regionCode, setLocale])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (props.mode === 'login') await props.onSubmit({ email, password, turnstileToken: turnstileToken || undefined })
    if (props.mode === 'register') await props.onSubmit({ email, password, name, workspaceName, regionCode, locale, turnstileToken: turnstileToken || undefined })
    if (props.mode === 'forgot') await props.onSubmit({ email })
  }

  const title = props.mode === 'login' ? t('auth.welcome') : props.mode === 'register' ? t('auth.createWorkspace') : t('auth.resetPassword')
  const subtitle = props.mode === 'login'
    ? t('auth.signInSubtitle')
    : props.mode === 'register'
      ? t('auth.registerSubtitle')
      : t('auth.resetSubtitle')

  return (
    <main className="auth-layout">
      <section className="auth-showcase" aria-label="SSLPing overview">
        <div className="auth-showcase__content">
          <Brand />
          <div className="auth-showcase__copy">
            <p className="eyebrow">{t('auth.incidentIntelligence')}</p>
            <h1>{t('auth.heroTitle')}</h1>
            <p>{t('auth.heroText')}</p>
          </div>
          <div className="auth-signal-card">
            <div className="auth-signal-card__header">
              <span><span className="status-dot status-dot--up" /> {t('auth.allOperational')}</span>
              <strong>99.99%</strong>
            </div>
            <div className="auth-signal-card__bars" aria-hidden="true">
              {Array.from({ length: 28 }, (_, index) => <span key={index} className={index === 21 ? 'is-warning' : ''} />)}
            </div>
            <div className="auth-signal-card__stats">
              <span><strong>142 ms</strong> {t('auth.avgResponse')}</span>
              <span><strong>24</strong> {t('auth.activeMonitors')}</span>
              <span><strong>0</strong> {t('auth.openIncidents')}</span>
            </div>
          </div>
          <ul className="auth-benefits">
            <li><Check size={16} /> {t('auth.multiRegion')}</li>
            <li><Check size={16} /> {t('auth.actionableAlerts')}</li>
            <li><Check size={16} /> {t('auth.gdpr')}</li>
          </ul>
        </div>
      </section>

      <section className="auth-form-wrap">
        <LanguageSelect className="auth-language-select" />
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-form-card">
          <div className="auth-form-card__icon"><ShieldCheck size={27} /></div>
          <h2>{title}<span className="title-dot">.</span></h2>
          <p>{subtitle}</p>

          <form onSubmit={handleSubmit} className="auth-form">
            {props.mode === 'register' && (
              <div className="form-grid">
                <Field label={t('auth.name')}>
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Alex Mitrohin" required minLength={2} />
                </Field>
                <Field label={t('auth.workspace')}>
                  <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Acme Operations" maxLength={120} />
                </Field>
              </div>
            )}
            {props.mode === 'register' && (
              <div className="form-grid auth-region-grid">
                <Field label={t('region.label')} hint={t('auth.regionHint')}>
                  <Select
                    value={regionCode}
                    disabled={props.regionsLoading || props.regions.length === 0}
                    required
                    onChange={(event) => {
                      const next = props.regions.find((region) => region.code === event.target.value)
                      setRegionCode(event.target.value)
                      if (next) void setLocale(next.default_locale, false)
                    }}
                  >
                    {props.regions.map((region) => <option key={region.id} value={region.code}>{region.name} · {region.currency}</option>)}
                  </Select>
                </Field>
                <div className="auth-region-summary" aria-live="polite">
                  <span>{t('auth.billingCurrency')}</span>
                  <strong>{props.regions.find((region) => region.code === regionCode)?.currency ?? '—'}</strong>
                  <small>{t('auth.regionManaged')}</small>
                </div>
              </div>
            )}
            <Field label={t('auth.email')}>
              <div className="input-with-icon">
                <Mail size={18} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@company.com" required />
              </div>
            </Field>
            {props.mode !== 'forgot' && (
              <Field
                label={t('auth.password')}
                hint={props.mode === 'register' ? t('auth.passwordHint') : undefined}
              >
                <div className="input-with-icon">
                  <LockKeyhole size={18} />
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={props.mode === 'register' ? 'new-password' : 'current-password'} placeholder="••••••••••••" required minLength={props.mode === 'register' ? 12 : 1} />
                  <button type="button" aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
            )}

            {props.error && <div className="auth-message auth-message--error">{props.error}</div>}
            {'success' in props && props.success && <div className="auth-message auth-message--success">{props.success}</div>}

            {((props.mode === 'register') || (props.mode === 'login' && props.captchaRequired)) && TURNSTILE_SITE_KEY && (
              <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} action={props.mode === 'login' ? 'login' : 'register'} resetSignal={props.challengeReset ?? 0} onToken={setTurnstileToken} />
            )}

            {props.mode === 'login' && <div className="auth-form__meta"><Link to="/forgot-password" state={location.state}>{t('auth.forgot')}</Link></div>}
            <Button type="submit" size="lg" disabled={props.busy || Boolean(TURNSTILE_SITE_KEY) && ((props.mode === 'register') || (props.mode === 'login' && props.captchaRequired)) && !turnstileToken}>
              {props.busy ? t('auth.wait') : props.mode === 'login' ? t('auth.signIn') : props.mode === 'register' ? t('auth.createAccount') : t('auth.sendReset')}
              {!props.busy && <ArrowRight size={18} />}
            </Button>
          </form>

          <p className="auth-switch">
            {props.mode === 'login' && <>{t('auth.new')} <Link to="/register" state={location.state}>{t('auth.createLink')}</Link></>}
            {props.mode === 'register' && <>{t('auth.existing')} <Link to="/login" state={location.state}>{t('auth.signIn')}</Link></>}
            {props.mode === 'forgot' && <><Link to="/login" state={location.state}>{t('auth.backSignIn')}</Link></>}
          </p>
          {props.mode === 'login' && (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') && (
            <Link className="auth-demo-link" to="/demo">{t('auth.demo')}</Link>
          )}
        </div>
        <p className="auth-legal">{t('auth.legal')}</p>
      </section>
    </main>
  )
}
