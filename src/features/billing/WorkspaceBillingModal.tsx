import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowDownRight, CalendarClock, Check, CreditCard, Download, ExternalLink, FileText, LockKeyhole, LogIn, Mail, ReceiptText, RotateCcw, Sparkles } from 'lucide-react'
import { ApiError } from '../../api/client'
import type { BillingCycle, BillingPlan, BillingSubscription, Invoice, PaymentProvider, PlanChangeQuote } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { useI18n } from '../../app/I18nProvider'
import { Badge, Button, FeedbackBanner, Modal } from '../../components/ui'
import { formatDate } from '../../lib/format'
import './billing.css'

type BillingError = {
  kind: 'authentication' | 'request'
  title: string
  message: string
}

type Translate = (key: string, variables?: Record<string, string | number>) => string

function billingErrorFrom(reason: unknown, fallback: string, t: Translate): BillingError {
  const technicalMessage = reason instanceof Error ? reason.message.trim() : ''
  const authenticationRequired = (reason instanceof ApiError && reason.status === 401)
    || /authentication required|unauthenticated|session (?:has )?expired|sign in again/i.test(technicalMessage)

  if (authenticationRequired) {
    return {
      kind: 'authentication',
      title: t('billing.sessionExpired'),
      message: t('billing.sessionExpiredHint'),
    }
  }

  return {
    kind: 'request',
    title: t('billing.requestFailed'),
    message: technicalMessage || fallback,
  }
}

export function formatMoney(cents: number, currency: string, locale?: string) {
  return (cents / 100).toLocaleString(locale, { style: 'currency', currency })
}

function cycleLabel(cycle: BillingCycle, t: Translate) {
  return cycle === 'yearly' ? t('billing.year') : t('billing.month')
}

function invoiceTone(status: Invoice['status']) {
  return status === 'paid' ? 'success' as const : status === 'void' ? 'neutral' as const : 'warning' as const
}

type BillingNotice = {
  kind: 'activated' | 'invoice' | 'scheduled' | 'cancelled'
  title: string
  message: string
  reference?: string
  paymentUrl?: string
  invoiceId?: string
  emailedTo?: string
  emailWarning?: string
}

type PlanLoss = { label: string; before: string; after: string; detail: string }

function downgradeLosses(current: BillingPlan | null, target: BillingPlan | null, t: Translate): PlanLoss[] {
  if (!current || !target) return []
  const result: PlanLoss[] = []
  const lowerIsLoss = (label: string, before: number, after: number, detail: string, suffix = '') => {
    if (after < before) result.push({ label, before: `${before.toLocaleString()}${suffix}`, after: `${after.toLocaleString()}${suffix}`, detail })
  }
  lowerIsLoss(t('billing.monitors'), current.limits.max_monitors, target.limits.max_monitors, t('billing.loss.monitors'))
  if (target.limits.min_interval_seconds > current.limits.min_interval_seconds) {
    result.push({ label: t('billing.fastestChecks'), before: `${current.limits.min_interval_seconds}s`, after: `${target.limits.min_interval_seconds}s`, detail: t('billing.loss.interval') })
  }
  lowerIsLoss(t('billing.teamMembers'), current.limits.max_team_members, target.limits.max_team_members, t('billing.loss.team'))
  lowerIsLoss(t('billing.statusPages'), current.limits.max_status_pages, target.limits.max_status_pages, t('billing.loss.statusPages'))
  lowerIsLoss(t('billing.integrations'), current.limits.max_integrations, target.limits.max_integrations, t('billing.loss.integrations'))
  lowerIsLoss(t('billing.locations'), current.limits.max_locations, target.limits.max_locations, t('billing.loss.locations'))
  lowerIsLoss(t('billing.retention'), current.limits.data_retention_days, target.limits.data_retention_days, t('billing.loss.retention'), ` ${t('billing.days')}`)
  if (current.limits.allow_manual_tests && !target.limits.allow_manual_tests) {
    result.push({ label: t('billing.manualTest'), before: t('billing.included'), after: t('billing.notIncluded'), detail: t('billing.loss.manualTest') })
  }
  return result
}

function PlanLimits({ plan, t }: { plan: BillingPlan; t: Translate }) {
  const limits = plan.limits
  return <dl className="billing-plan__limits">
    <div><dt>{t('billing.monitors')}</dt><dd>{limits.max_monitors.toLocaleString()}</dd></div>
    <div><dt>{t('billing.fastestChecks')}</dt><dd>{limits.min_interval_seconds}s</dd></div>
    <div><dt>{t('billing.teamMembers')}</dt><dd>{limits.max_team_members}</dd></div>
    <div><dt>{t('billing.statusPages')}</dt><dd>{limits.max_status_pages}</dd></div>
    <div><dt>{t('billing.integrations')}</dt><dd>{limits.max_integrations}</dd></div>
    <div><dt>{t('billing.locations')}</dt><dd>{limits.max_locations}</dd></div>
    <div><dt>{t('billing.retention')}</dt><dd>{limits.data_retention_days} {t('billing.days')}</dd></div>
    <div><dt>{t('billing.manualTest')}</dt><dd>{limits.allow_manual_tests ? t('billing.included') : '—'}</dd></div>
  </dl>
}

function saveInvoicePdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function InvoiceRow({ invoice, busy, onDownload, locale, t }: { invoice: Invoice; busy: boolean; onDownload: (invoice: Invoice) => void; locale: string; t: Translate }) {
  const dueAt = new Date(invoice.due_at).getTime()
  const [paymentDeadlinePassed, setPaymentDeadlinePassed] = useState(() => invoice.status === 'open' && dueAt <= Date.now())

  useEffect(() => {
    if (invoice.status !== 'open' || !Number.isFinite(dueAt)) {
      setPaymentDeadlinePassed(false)
      return
    }

    let timer: number | undefined
    const refreshDeadline = () => {
      const remaining = dueAt - Date.now()
      if (remaining <= 0) {
        setPaymentDeadlinePassed(true)
        return
      }
      setPaymentDeadlinePassed(false)
      timer = window.setTimeout(refreshDeadline, Math.min(remaining + 25, 60_000))
    }
    refreshDeadline()
    return () => window.clearTimeout(timer)
  }, [dueAt, invoice.status])

  return <article className="billing-invoice-row">
    <span className="billing-invoice-row__icon"><ReceiptText size={18} /></span>
    <span>
      <strong>{invoice.number}</strong>
      <small>{invoice.target_plan_code} · {t(`billing.cycle.${invoice.billing_cycle}`)} · {t('billing.issued')} {formatDate(invoice.created_at)}</small>
    </span>
    <Badge tone={invoiceTone(invoice.status)}>{invoice.status}</Badge>
    <strong>{formatMoney(invoice.total_cents, invoice.currency, locale)}</strong>
    <span className="billing-invoice-row__actions">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onDownload(invoice)}><Download size={14} /> PDF</Button>
      {invoice.status === 'open' && !paymentDeadlinePassed && invoice.payment_url
        ? <a href={invoice.payment_url} target="_blank" rel="noreferrer">{t('billing.pay')} <ExternalLink size={14} /></a>
        : <small>{paymentDeadlinePassed ? t('billing.deadlinePassed') : invoice.status === 'open' ? t('billing.awaitingPayment') : invoice.paid_at ? t('billing.paidAt', { date: formatDate(invoice.paid_at) }) : t('billing.noPaymentRequired')}</small>}
    </span>
  </article>
}

export function WorkspaceBillingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, workspace, logout } = useAuth()
  const { locale, t } = useI18n()
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [annualDiscount, setAnnualDiscount] = useState(0)
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceCursor, setInvoiceCursor] = useState<string | undefined>()
  const [selectedCode, setSelectedCode] = useState('')
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null)
  const [provider, setProvider] = useState<PaymentProvider>('keepz')
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [loadingMoreInvoices, setLoadingMoreInvoices] = useState(false)
  const [busy, setBusy] = useState(false)
  const [invoiceAction, setInvoiceAction] = useState('')
  const [error, setError] = useState<BillingError | null>(null)
  const [notice, setNotice] = useState<BillingNotice | null>(null)
  const quoteRequest = useRef(0)
  const quoteSection = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotice(null)
    setQuote(null)
    setPreviewing(false)
    quoteRequest.current += 1
    setPlans([])
    setAnnualDiscount(0)
    setSubscription(null)
    setInvoices([])
    setInvoiceCursor(undefined)
    Promise.all([api.listBillingPlans(), api.getBillingSubscription(), api.listBillingInvoices({ limit: 20 })])
      .then(([catalog, current, invoicePage]) => {
        if (cancelled) return
        setPlans(catalog.items.filter((plan) => plan.active && plan.public && plan.currency.toUpperCase() === current.currency.toUpperCase()))
        setAnnualDiscount(catalog.annual_discount_percent)
        setSubscription(current)
        setCycle(current.billing_cycle)
        setSelectedCode(current.plan_code)
        setInvoices(invoicePage.items)
        setInvoiceCursor(invoicePage.next_cursor)
      })
      .catch((reason) => { if (!cancelled) setError(billingErrorFrom(reason, t('billing.loadFailed'), t)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, open, t, workspace?.id])

  useEffect(() => {
    if (!quote) return
    const frame = window.requestAnimationFrame(() => quoteSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [quote])

  const loadMoreInvoices = async () => {
    if (!invoiceCursor || loadingMoreInvoices) return
    setLoadingMoreInvoices(true)
    setError(null)
    try {
      const page = await api.listBillingInvoices({ limit: 20, cursor: invoiceCursor })
      setInvoices((current) => {
        const existing = new Set(current.map((invoice) => invoice.id))
        return [...current, ...page.items.filter((invoice) => !existing.has(invoice.id))]
      })
      setInvoiceCursor(page.next_cursor)
    } catch (reason) {
      setError(billingErrorFrom(reason, t('billing.loadInvoicesFailed'), t))
    } finally {
      setLoadingMoreInvoices(false)
    }
  }

  const selectedPlan = useMemo(() => plans.find((plan) => plan.code === selectedCode) ?? null, [plans, selectedCode])
  const currentPlan = useMemo(() => plans.find((plan) => plan.code === subscription?.plan_code), [plans, subscription?.plan_code])
  const losses = useMemo(() => quote?.change_kind === 'downgrade' ? downgradeLosses(currentPlan ?? null, selectedPlan, t) : [], [currentPlan, quote?.change_kind, selectedPlan, t])
  const subscriptionTerm = subscription?.status === 'suspended'
    ? t('billing.subscriptionSuspended')
    : subscription?.status === 'past_due'
      ? t('billing.paymentOverdue', { date: formatDate(subscription.grace_ends_at ?? subscription.current_period_end) })
      : subscription
        ? t('billing.renews', { cycle: t(`billing.cycle.${subscription.billing_cycle}`), date: formatDate(subscription.current_period_end) })
        : ''

  const preview = async (planCode: string, billingCycle: BillingCycle) => {
    if (!planCode) return
    const request = ++quoteRequest.current
    setQuote(null)
    setPreviewing(true)
    setError(null)
    try {
      const next = await api.previewPlanChange({ plan_code: planCode, billing_cycle: billingCycle })
      if (request !== quoteRequest.current) return
      setQuote(next)
      const preferred = next.available_payment_providers.find((item) => item.code === 'keepz' && item.allowed && item.configured)
        ?? next.available_payment_providers.find((item) => item.code !== 'manual' && item.allowed && item.configured)
        ?? next.available_payment_providers.find((item) => item.code === 'manual' && item.allowed)
      setProvider(preferred?.code ?? 'manual')
    } catch (reason) {
      if (request === quoteRequest.current) setError(billingErrorFrom(reason, t('billing.previewFailed'), t))
    } finally {
      if (request === quoteRequest.current) setPreviewing(false)
    }
  }

  const selectPlan = (code: string) => {
    setSelectedCode(code)
    setNotice(null)
    if (code === subscription?.plan_code && cycle === subscription.billing_cycle) {
      quoteRequest.current += 1
      setPreviewing(false)
      setQuote(null)
      return
    }
    void preview(code, cycle)
  }

  const selectCycle = (nextCycle: BillingCycle) => {
    setCycle(nextCycle)
    setNotice(null)
    const planCode = selectedCode || subscription?.plan_code || ''
    if (planCode === subscription?.plan_code && nextCycle === subscription.billing_cycle) {
      quoteRequest.current += 1
      setPreviewing(false)
      setQuote(null)
      return
    }
    void preview(planCode, nextCycle)
  }

  const keepCurrentPlan = () => {
    quoteRequest.current += 1
    setPreviewing(false)
    setQuote(null)
    setError(null)
    setSelectedCode(subscription?.plan_code ?? '')
    if (subscription) setCycle(subscription.billing_cycle)
  }

  const confirm = async () => {
    if (!quote) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.changeBillingPlan({
        plan_code: quote.target_plan_code,
        billing_cycle: quote.billing_cycle,
        ...(quote.change_kind !== 'downgrade' && quote.total_cents > 0 ? { payment_provider: provider } : {}),
      })
      setSubscription(result.subscription)
      if (result.invoice) setInvoices((items) => [result.invoice!, ...items.filter((item) => item.id !== result.invoice!.id)])
      let emailedTo = ''
      let emailWarning = ''
      if (result.invoice && provider === 'manual' && typeof api.emailBillingInvoicePdf === 'function') {
        try {
          const delivery = await api.emailBillingInvoicePdf(result.invoice.id)
          emailedTo = delivery.recipient
        } catch (reason) {
          emailWarning = reason instanceof Error ? reason.message : t('billing.emailUnavailable')
        }
      }
      setNotice(result.change_kind === 'downgrade'
        ? { kind: 'scheduled', title: t('billing.changeScheduled'), message: t('billing.downgradeEffective', { date: formatDate(result.quote.effective_at) }) }
        : result.quote.total_cents === 0 || result.invoice?.status === 'paid'
          ? { kind: 'activated', title: t('billing.planActivated'), message: t('billing.planActivatedHint') }
        : result.invoice
          ? { kind: 'invoice', title: t('billing.invoiceCreated'), reference: result.invoice.number, invoiceId: result.invoice.id, paymentUrl: result.invoice.payment_url, emailedTo, emailWarning, message: t('billing.invoiceActivationHint') }
          : { kind: 'activated', title: t('billing.updated'), message: t('billing.updatedHint') })
      setQuote(null)
    } catch (reason) {
      setError(billingErrorFrom(reason, t('billing.submitFailed'), t))
    } finally { setBusy(false) }
  }

  const downloadInvoice = async (invoice: Invoice) => {
    setInvoiceAction(invoice.id + ':download')
    setError(null)
    try {
      saveInvoicePdf(await api.downloadBillingInvoicePdf(invoice.id), `${invoice.number}.pdf`)
    } catch (reason) {
      setError(billingErrorFrom(reason, t('billing.downloadFailed'), t))
    } finally { setInvoiceAction('') }
  }

  const cancelPendingDowngrade = async () => {
    if (!subscription?.pending_plan_code) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.changeBillingPlan({ plan_code: subscription.plan_code, billing_cycle: subscription.billing_cycle })
      setSubscription(result.subscription)
      setSelectedCode(result.subscription.plan_code)
      setCycle(result.subscription.billing_cycle)
      setQuote(null)
      setNotice({ kind: 'cancelled', title: t('billing.downgradeCancelled'), message: t('billing.downgradeCancelledHint', { plan: currentPlan?.name ?? result.subscription.plan_code }) })
    } catch (reason) {
      setError(billingErrorFrom(reason, t('billing.cancelDowngradeFailed'), t))
    } finally { setBusy(false) }
  }

  const providerOptions = quote?.available_payment_providers.filter((item) => item.allowed) ?? []

  const signInAgain = async () => {
    setBusy(true)
    try {
      await logout()
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return <Modal open={open} onClose={onClose} title={t('billing.title')} icon={<Sparkles size={31} />} width="xl" className="billing-modal">
    {loading ? <div className="route-loading" role="status"><span className="spinner" /> {t('billing.loading')}</div> : <div className="billing-dialog">
      {error?.kind === 'authentication' ? <section className="billing-auth-error" role="alert" aria-labelledby="billing-auth-error-title">
        <span className="billing-auth-error__icon"><LockKeyhole size={29} /></span>
        <small>{t('billing.secureSession')}</small>
        <h3 id="billing-auth-error-title">{error.title}</h3>
        <p>{error.message}</p>
        <div className="billing-auth-error__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{t('common.close')}</Button>
          <Button type="button" onClick={() => void signInAgain()} disabled={busy}><LogIn size={16} /> {busy ? t('billing.signingOut') : t('billing.signInAgain')}</Button>
        </div>
      </section> : <>
      {error && <FeedbackBanner tone="error" title={error.title} onDismiss={() => setError(null)}>{error.message}</FeedbackBanner>}

      <section className="billing-current" aria-label={t('billing.currentSubscription')}>
        <article><CreditCard size={20} /><span><small>{t('billing.currentPlan')}</small><strong>{currentPlan?.name ?? subscription?.plan_code ?? workspace?.plan ?? 'Free'}</strong></span></article>
        {subscription && <article><CalendarClock size={20} /><span><small>{t('billing.currentTerm')}</small><strong>{subscriptionTerm}</strong></span></article>}
        {subscription?.pending_plan_code && <article className="billing-current__pending"><CalendarClock size={20} /><span><small>{t('billing.scheduledChange')}</small><strong>{t('billing.planFromDate', { plan: subscription.pending_plan_code, date: formatDate(subscription.pending_effective_at ?? subscription.current_period_end) })}</strong></span><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void cancelPendingDowngrade()}><RotateCcw size={14} /> {t('common.cancel')}</Button></article>}
      </section>

      <div className="billing-cycle" role="radiogroup" aria-label={t('billing.period')}>
        <button type="button" role="radio" aria-checked={cycle === 'monthly'} className={cycle === 'monthly' ? 'is-active' : ''} onClick={() => selectCycle('monthly')}>{t('billing.monthly')}</button>
        <button type="button" role="radio" aria-checked={cycle === 'yearly'} className={cycle === 'yearly' ? 'is-active' : ''} onClick={() => selectCycle('yearly')}>{t('billing.yearly')} <span>{t('billing.saveUpTo', { percent: annualDiscount })}</span></button>
      </div>

      <div className="billing-plan-grid" aria-label={t('billing.availablePlans')}>
        {plans.map((plan) => {
          const current = plan.code === subscription?.plan_code && cycle === subscription.billing_cycle
          const selected = plan.code === selectedCode
          const price = cycle === 'yearly' ? plan.price_yearly_cents : plan.price_monthly_cents
          return <article key={plan.id} className={`${selected ? 'is-selected' : ''} ${current ? 'is-current' : ''}`}>
            <div className="billing-plan__top">
              <span>{current ? <Badge tone="success">{t('billing.current')}</Badge> : <Badge tone="neutral">{plan.code}</Badge>}</span>
              {cycle === 'yearly' && plan.annual_discount_percent > 0 && <Badge tone="purple">{t('billing.savePercent', { percent: plan.annual_discount_percent })}</Badge>}
            </div>
            <h3>{plan.name}</h3>
            <p>{plan.description || t('billing.planFallback')}</p>
            <strong className="billing-plan__price">{formatMoney(price, plan.currency, locale)}<small>/{cycleLabel(cycle, t)}</small></strong>
            {cycle === 'yearly' && <small className="billing-plan__monthly-equivalent">{t('billing.perMonth', { amount: formatMoney(Math.round(price / 12), plan.currency, locale) })}</small>}
            <PlanLimits plan={plan} t={t} />
            <Button type="button" variant={selected ? 'success' : 'secondary'} onClick={() => selectPlan(plan.code)} aria-pressed={selected} disabled={busy}>
              {selected && previewing ? t('billing.calculating') : current ? t('billing.selectedCurrent') : selected ? t('billing.selected') : t('billing.choosePlan', { plan: plan.name })}
            </Button>
          </article>
        })}
      </div>

      {previewing && <div className="billing-preview-loading" role="status"><span className="spinner" /><span><strong>{t('billing.calculatingExact')}</strong><small>{t('billing.calculatingExactHint')}</small></span></div>}

      {quote && <section ref={quoteSection} className={`billing-quote billing-quote--${quote.change_kind === 'downgrade' ? 'scheduled' : 'invoice'}`} aria-label={t('billing.quote')}>
        <div>
          <span><FileText size={22} /></span>
          <div><h3>{quote.change_kind === 'downgrade' ? t('billing.scheduledPlanChange') : quote.total_cents > 0 ? t('billing.invoicePreview') : t('billing.changeSummary')}</h3><p>{quote.warning || (quote.change_kind === 'downgrade' ? t('billing.currentLimitsRemain') : quote.total_cents > 0 ? t('billing.unusedTimeCredited') : t('billing.noAdditionalPayment'))}</p></div>
        </div>
        <dl>
          <div><dt>{t('billing.planTerm')}</dt><dd>{formatMoney(quote.subtotal_cents, quote.currency, locale)}</dd></div>
          {quote.annual_discount_cents > 0 && <div><dt>{t('billing.annualDiscount')}</dt><dd>−{formatMoney(quote.annual_discount_cents, quote.currency, locale)}</dd></div>}
          {quote.unused_credit_cents > 0 && <div><dt>{t('billing.unusedCredit')}</dt><dd>−{formatMoney(quote.unused_credit_cents, quote.currency, locale)}</dd></div>}
          <div className="billing-quote__total"><dt>{quote.change_kind === 'downgrade' ? t('billing.nextTerm') : quote.total_cents > 0 ? t('billing.amountDue') : t('billing.dueNow')}</dt><dd>{formatMoney(quote.total_cents, quote.currency, locale)}</dd></div>
          <div><dt>{quote.change_kind === 'downgrade' ? t('billing.atRenewal') : t('billing.effective')}</dt><dd>{formatDate(quote.effective_at)}</dd></div>
        </dl>
        {quote.change_kind === 'downgrade' && <section className="billing-losses" aria-labelledby="billing-losses-title">
          <header><span><AlertTriangle size={22} /></span><div><small>{t('billing.beforeDowngrade')}</small><h4 id="billing-losses-title">{t('billing.keepCapabilities', { plan: currentPlan?.name ?? quote.source_plan_code })}</h4><p>{t('billing.downgradeLossHint')}</p></div></header>
          {losses.length > 0 ? <ul>{losses.map((loss) => <li key={loss.label}><span><strong>{loss.label}</strong><small>{loss.detail}</small></span><span className="billing-losses__values"><b>{loss.before}</b><ArrowDownRight size={16} /><em>{loss.after}</em></span></li>)}</ul> : <p className="billing-losses__fallback">{t('billing.downgradeFallback')}</p>}
          <div className="billing-losses__retention"><Button type="button" variant="success" onClick={keepCurrentPlan} disabled={busy}>{t('billing.keepPlan', { plan: currentPlan?.name ?? t('billing.currentPlanLower') })}</Button><span>{t('billing.noChangesHint')}</span></div>
        </section>}
        {quote.change_kind !== 'downgrade' && quote.total_cents > 0 && <fieldset className="billing-providers">
          <legend>{t('billing.paymentMethod')}</legend>
          {providerOptions.map((item) => {
            const selectable = item.code === 'manual' || item.configured
            return <label key={item.code} className={`${provider === item.code ? 'is-selected' : ''} ${!selectable ? 'is-disabled' : ''}`}>
            <input type="radio" name="billing-provider" value={item.code} checked={provider === item.code} disabled={!selectable} onChange={() => setProvider(item.code)} />
            <span><strong>{item.code === 'keepz' ? 'Keepz' : item.code === 'cloudpayments' ? 'CloudPayments' : t('billing.invoice')}</strong><small>{item.code === 'manual' ? t('billing.invoiceMethodHint') : item.configured ? t('billing.onlineAvailable') : t('billing.integrationRequired')}</small></span>
          </label>
          })}
        </fieldset>}
        <div className="billing-quote__actions">
          <Button type="button" variant="secondary" onClick={keepCurrentPlan} disabled={busy}>{quote.change_kind === 'downgrade' ? t('billing.keepCurrent') : t('billing.cancelChange')}</Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>{busy ? t('billing.submitting') : quote.change_kind === 'downgrade' ? t('billing.scheduleDowngrade') : quote.total_cents > 0 ? t('billing.createInvoice') : t('billing.applyChange')}</Button>
        </div>
      </section>}

      <section className="billing-invoices" aria-labelledby="workspace-invoices-title">
        <div><div><h3 id="workspace-invoices-title">{t('billing.invoices')}</h3><p>{t('billing.invoicesHint')}</p></div><Badge tone="neutral">{t('billing.showing', { count: `${invoices.length}${invoiceCursor ? '+' : ''}` })}</Badge></div>
        {invoices.length === 0 ? <p className="billing-invoices__empty">{t('billing.noInvoices')}</p> : <div>{invoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} busy={invoiceAction.startsWith(invoice.id)} onDownload={(item) => void downloadInvoice(item)} locale={locale} t={t} />)}</div>}
        {invoiceCursor && <div className="billing-invoices__more"><Button type="button" variant="secondary" disabled={loadingMoreInvoices} onClick={() => void loadMoreInvoices()}>{loadingMoreInvoices ? t('common.loading') : t('billing.loadOlder')}</Button></div>}
      </section>

      {notice && createPortal(<div className="billing-result-backdrop" role="presentation">
        <section className={`billing-result billing-result--${notice.kind}`} role="dialog" aria-modal="true" aria-labelledby="billing-result-title">
          <span className="billing-result__icon"><Check size={29} /></span>
          <small>{notice.kind === 'invoice' ? t('billing.upgradeReady') : notice.kind === 'scheduled' ? t('billing.changeScheduled') : notice.kind === 'cancelled' ? t('billing.scheduleRemoved') : t('billing.planUpdated')}</small>
          <h3 id="billing-result-title">{notice.title}</h3>
          {notice.reference && <code>{notice.reference}</code>}
          <p>{notice.message}</p>
          {notice.emailedTo && <p className="billing-result__delivery"><Mail size={16} /> {t('billing.sentTo')} <strong>{notice.emailedTo}</strong></p>}
          {notice.emailWarning && <p className="billing-result__warning"><AlertTriangle size={16} /> {t('billing.emailFailed', { error: notice.emailWarning })}</p>}
          <div className="billing-result__actions">
            {notice.invoiceId && <Button type="button" variant="secondary" disabled={invoiceAction === notice.invoiceId + ':download'} onClick={() => { const invoice = invoices.find((item) => item.id === notice.invoiceId); if (invoice) void downloadInvoice(invoice) }}><Download size={16} /> {t('billing.downloadPdf')}</Button>}
            {notice.paymentUrl && <a className="button button--success" href={notice.paymentUrl} target="_blank" rel="noreferrer">{t('billing.payNow')} <ExternalLink size={16} /></a>}
            {notice.kind === 'scheduled' && <Button type="button" variant="secondary" disabled={busy} onClick={() => void cancelPendingDowngrade()}><RotateCcw size={16} /> {t('billing.cancelDowngrade')}</Button>}
            <Button type="button" onClick={() => setNotice(null)}>{t('billing.understand')}</Button>
          </div>
        </section>
      </div>, document.body)}
      </>}
    </div>}
  </Modal>
}
