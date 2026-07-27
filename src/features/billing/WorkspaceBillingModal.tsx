import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowDownRight, CalendarClock, Check, CreditCard, Download, ExternalLink, FileText, LockKeyhole, LogIn, Mail, ReceiptText, RotateCcw, Sparkles } from 'lucide-react'
import { ApiError } from '../../api/client'
import type { BillingCycle, BillingPlan, BillingSubscription, Invoice, PaymentProvider, PlanChangeQuote } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Badge, Button, FeedbackBanner, Modal } from '../../components/ui'
import { formatDate } from '../../lib/format'
import './billing.css'

type BillingError = {
  kind: 'authentication' | 'request'
  title: string
  message: string
}

function billingErrorFrom(reason: unknown, fallback: string): BillingError {
  const technicalMessage = reason instanceof Error ? reason.message.trim() : ''
  const authenticationRequired = (reason instanceof ApiError && reason.status === 401)
    || /authentication required|unauthenticated|session (?:has )?expired|sign in again/i.test(technicalMessage)

  if (authenticationRequired) {
    return {
      kind: 'authentication',
      title: 'Your session has expired',
      message: 'Sign in again to continue managing plans, invoices and payments. Nothing has been changed.',
    }
  }

  return {
    kind: 'request',
    title: 'We could not complete that billing request',
    message: technicalMessage || fallback,
  }
}

export function formatMoney(cents: number, currency: string) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency })
}

function cycleLabel(cycle: BillingCycle) {
  return cycle === 'yearly' ? 'year' : 'month'
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

function downgradeLosses(current: BillingPlan | null, target: BillingPlan | null): PlanLoss[] {
  if (!current || !target) return []
  const result: PlanLoss[] = []
  const lowerIsLoss = (label: string, before: number, after: number, detail: string, suffix = '') => {
    if (after < before) result.push({ label, before: `${before.toLocaleString()}${suffix}`, after: `${after.toLocaleString()}${suffix}`, detail })
  }
  lowerIsLoss('Monitors', current.limits.max_monitors, target.limits.max_monitors, 'Fewer services can be monitored at the same time.')
  if (target.limits.min_interval_seconds > current.limits.min_interval_seconds) {
    result.push({ label: 'Fastest checks', before: `${current.limits.min_interval_seconds}s`, after: `${target.limits.min_interval_seconds}s`, detail: 'Incidents may be detected later.' })
  }
  lowerIsLoss('Team members', current.limits.max_team_members, target.limits.max_team_members, 'Fewer teammates can access this workspace.')
  lowerIsLoss('Status pages', current.limits.max_status_pages, target.limits.max_status_pages, 'Fewer public or private status pages remain available.')
  lowerIsLoss('Integrations', current.limits.max_integrations, target.limits.max_integrations, 'Some alert destinations may need to be removed.')
  lowerIsLoss('Monitoring locations', current.limits.max_locations, target.limits.max_locations, 'You lose geographic coverage and regional verification.')
  lowerIsLoss('Data retention', current.limits.data_retention_days, target.limits.data_retention_days, 'Older monitoring history will no longer be retained.', ' days')
  if (current.limits.allow_manual_tests && !target.limits.allow_manual_tests) {
    result.push({ label: 'Manual Test now', before: 'Included', after: 'Not included', detail: 'Immediate on-demand monitor checks will no longer be available.' })
  }
  return result
}

function PlanLimits({ plan }: { plan: BillingPlan }) {
  const limits = plan.limits
  return <dl className="billing-plan__limits">
    <div><dt>Monitors</dt><dd>{limits.max_monitors.toLocaleString()}</dd></div>
    <div><dt>Fastest checks</dt><dd>{limits.min_interval_seconds}s</dd></div>
    <div><dt>Team members</dt><dd>{limits.max_team_members}</dd></div>
    <div><dt>Status pages</dt><dd>{limits.max_status_pages}</dd></div>
    <div><dt>Integrations</dt><dd>{limits.max_integrations}</dd></div>
    <div><dt>Locations</dt><dd>{limits.max_locations}</dd></div>
    <div><dt>Data retention</dt><dd>{limits.data_retention_days} days</dd></div>
    <div><dt>Manual Test now</dt><dd>{limits.allow_manual_tests ? 'Included' : '—'}</dd></div>
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

function InvoiceRow({ invoice, busy, onDownload, onEmail }: { invoice: Invoice; busy: boolean; onDownload: (invoice: Invoice) => void; onEmail: (invoice: Invoice) => void }) {
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
      <small>{invoice.target_plan_code} · {invoice.billing_cycle} · issued {formatDate(invoice.created_at)}</small>
    </span>
    <Badge tone={invoiceTone(invoice.status)}>{invoice.status}</Badge>
    <strong>{formatMoney(invoice.total_cents, invoice.currency)}</strong>
    <span className="billing-invoice-row__actions">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onDownload(invoice)}><Download size={14} /> PDF</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy || !invoice.customer_email} onClick={() => onEmail(invoice)}><Mail size={14} /> Email</Button>
      {invoice.status === 'open' && !paymentDeadlinePassed && invoice.payment_url
        ? <a href={invoice.payment_url} target="_blank" rel="noreferrer">Pay <ExternalLink size={14} /></a>
        : <small>{paymentDeadlinePassed ? 'Payment deadline passed' : invoice.status === 'open' ? 'Awaiting payment confirmation' : invoice.paid_at ? `Paid ${formatDate(invoice.paid_at)}` : 'No payment required'}</small>}
    </span>
  </article>
}

export function WorkspaceBillingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, workspace, logout } = useAuth()
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
      .catch((reason) => { if (!cancelled) setError(billingErrorFrom(reason, 'Could not load billing information.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, open, workspace?.id])

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
      setError(billingErrorFrom(reason, 'Could not load older invoices.'))
    } finally {
      setLoadingMoreInvoices(false)
    }
  }

  const selectedPlan = useMemo(() => plans.find((plan) => plan.code === selectedCode) ?? null, [plans, selectedCode])
  const currentPlan = useMemo(() => plans.find((plan) => plan.code === subscription?.plan_code), [plans, subscription?.plan_code])
  const losses = useMemo(() => quote?.change_kind === 'downgrade' ? downgradeLosses(currentPlan ?? null, selectedPlan) : [], [currentPlan, quote?.change_kind, selectedPlan])
  const subscriptionTerm = subscription?.status === 'suspended'
    ? 'Subscription suspended · payment required'
    : subscription?.status === 'past_due'
      ? `Payment overdue · due by ${formatDate(subscription.grace_ends_at ?? subscription.current_period_end)}`
      : subscription
        ? `${subscription.billing_cycle} · renews ${formatDate(subscription.current_period_end)}`
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
      if (request === quoteRequest.current) setError(billingErrorFrom(reason, 'Could not calculate the plan change.'))
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
          emailWarning = reason instanceof Error ? reason.message : 'Email delivery is temporarily unavailable.'
        }
      }
      setNotice(result.change_kind === 'downgrade'
        ? { kind: 'scheduled', title: 'Plan change scheduled', message: `The downgrade will take effect on ${formatDate(result.quote.effective_at)}. Your current limits stay active until then.` }
        : result.quote.total_cents === 0 || result.invoice?.status === 'paid'
          ? { kind: 'activated', title: 'Plan activated', message: 'The plan has been activated and the new limits are available immediately.' }
        : result.invoice
          ? { kind: 'invoice', title: 'Invoice created', reference: result.invoice.number, invoiceId: result.invoice.id, paymentUrl: result.invoice.payment_url, emailedTo, emailWarning, message: 'Your new limits will activate as soon as the payment is confirmed.' }
          : { kind: 'activated', title: 'Billing updated', message: 'Your workspace billing settings are up to date.' })
      setQuote(null)
    } catch (reason) {
      setError(billingErrorFrom(reason, 'Could not submit the plan change.'))
    } finally { setBusy(false) }
  }

  const downloadInvoice = async (invoice: Invoice) => {
    setInvoiceAction(invoice.id + ':download')
    setError(null)
    try {
      saveInvoicePdf(await api.downloadBillingInvoicePdf(invoice.id), `${invoice.number}.pdf`)
    } catch (reason) {
      setError(billingErrorFrom(reason, 'Could not download the invoice PDF.'))
    } finally { setInvoiceAction('') }
  }

  const emailInvoice = async (invoice: Invoice) => {
    setInvoiceAction(invoice.id + ':email')
    setError(null)
    try {
      const delivery = await api.emailBillingInvoicePdf(invoice.id)
      setNotice({ kind: 'invoice', title: 'Invoice sent by email', reference: invoice.number, invoiceId: invoice.id, emailedTo: delivery.recipient, message: 'A PDF copy has been delivered to the workspace billing contact.' })
    } catch (reason) {
      setError(billingErrorFrom(reason, 'Could not email the invoice PDF.'))
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
      setNotice({ kind: 'cancelled', title: 'Scheduled downgrade cancelled', message: `Your ${currentPlan?.name ?? result.subscription.plan_code} plan and its current limits will continue without interruption.` })
    } catch (reason) {
      setError(billingErrorFrom(reason, 'Could not cancel the scheduled downgrade.'))
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

  return <Modal open={open} onClose={onClose} title="Workspace plans & billing" icon={<Sparkles size={31} />} width="xl" className="billing-modal">
    {loading ? <div className="route-loading" role="status"><span className="spinner" /> Loading plans and invoices…</div> : <div className="billing-dialog">
      {error?.kind === 'authentication' ? <section className="billing-auth-error" role="alert" aria-labelledby="billing-auth-error-title">
        <span className="billing-auth-error__icon"><LockKeyhole size={29} /></span>
        <small>Secure billing session</small>
        <h3 id="billing-auth-error-title">{error.title}</h3>
        <p>{error.message}</p>
        <div className="billing-auth-error__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="button" onClick={() => void signInAgain()} disabled={busy}><LogIn size={16} /> {busy ? 'Signing out…' : 'Sign in again'}</Button>
        </div>
      </section> : <>
      {error && <FeedbackBanner tone="error" title={error.title} onDismiss={() => setError(null)}>{error.message}</FeedbackBanner>}

      <section className="billing-current" aria-label="Current subscription">
        <article><CreditCard size={20} /><span><small>Current plan</small><strong>{currentPlan?.name ?? subscription?.plan_code ?? workspace?.plan ?? 'Free'}</strong></span></article>
        {subscription && <article><CalendarClock size={20} /><span><small>Current term</small><strong>{subscriptionTerm}</strong></span></article>}
        {subscription?.pending_plan_code && <article className="billing-current__pending"><CalendarClock size={20} /><span><small>Scheduled change</small><strong>{subscription.pending_plan_code} from {formatDate(subscription.pending_effective_at ?? subscription.current_period_end)}</strong></span><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void cancelPendingDowngrade()}><RotateCcw size={14} /> Cancel</Button></article>}
      </section>

      <div className="billing-cycle" role="radiogroup" aria-label="Billing period">
        <button type="button" role="radio" aria-checked={cycle === 'monthly'} className={cycle === 'monthly' ? 'is-active' : ''} onClick={() => selectCycle('monthly')}>Monthly</button>
        <button type="button" role="radio" aria-checked={cycle === 'yearly'} className={cycle === 'yearly' ? 'is-active' : ''} onClick={() => selectCycle('yearly')}>Yearly <span>save up to {annualDiscount}%</span></button>
      </div>

      <div className="billing-plan-grid" aria-label="Available workspace plans">
        {plans.map((plan) => {
          const current = plan.code === subscription?.plan_code && cycle === subscription.billing_cycle
          const selected = plan.code === selectedCode
          const price = cycle === 'yearly' ? plan.price_yearly_cents : plan.price_monthly_cents
          return <article key={plan.id} className={`${selected ? 'is-selected' : ''} ${current ? 'is-current' : ''}`}>
            <div className="billing-plan__top">
              <span>{current ? <Badge tone="success">Current</Badge> : <Badge tone="neutral">{plan.code}</Badge>}</span>
              {cycle === 'yearly' && plan.annual_discount_percent > 0 && <Badge tone="purple">Save {plan.annual_discount_percent}%</Badge>}
            </div>
            <h3>{plan.name}</h3>
            <p>{plan.description || 'A flexible plan for your monitoring workspace.'}</p>
            <strong className="billing-plan__price">{formatMoney(price, plan.currency)}<small>/{cycleLabel(cycle)}</small></strong>
            {cycle === 'yearly' && <small className="billing-plan__monthly-equivalent">{formatMoney(Math.round(price / 12), plan.currency)} per month</small>}
            <PlanLimits plan={plan} />
            <Button type="button" variant={selected ? 'success' : 'secondary'} onClick={() => selectPlan(plan.code)} aria-pressed={selected} disabled={busy}>
              {selected && previewing ? 'Calculating…' : current ? 'Selected current plan' : selected ? 'Selected' : `Choose ${plan.name}`}
            </Button>
          </article>
        })}
      </div>

      {previewing && <div className="billing-preview-loading" role="status"><span className="spinner" /><span><strong>Calculating your exact plan change</strong><small>Unused-term credit, effective date and limits are being checked.</small></span></div>}

      {quote && <section ref={quoteSection} className={`billing-quote billing-quote--${quote.change_kind === 'downgrade' ? 'scheduled' : 'invoice'}`} aria-label="Plan change quote">
        <div>
          <span><FileText size={22} /></span>
          <div><h3>{quote.change_kind === 'downgrade' ? 'Scheduled plan change' : quote.total_cents > 0 ? 'Invoice preview' : 'Plan change summary'}</h3><p>{quote.warning || (quote.change_kind === 'downgrade' ? 'Your current limits remain available through the paid term.' : quote.total_cents > 0 ? 'Unused time is credited before the amount due is calculated.' : 'This change can be applied without an additional payment.')}</p></div>
        </div>
        <dl>
          <div><dt>Plan term</dt><dd>{formatMoney(quote.subtotal_cents, quote.currency)}</dd></div>
          {quote.annual_discount_cents > 0 && <div><dt>Annual discount</dt><dd>−{formatMoney(quote.annual_discount_cents, quote.currency)}</dd></div>}
          {quote.unused_credit_cents > 0 && <div><dt>Unused-term credit</dt><dd>−{formatMoney(quote.unused_credit_cents, quote.currency)}</dd></div>}
          <div className="billing-quote__total"><dt>{quote.change_kind === 'downgrade' ? 'Next term' : quote.total_cents > 0 ? 'Amount due' : 'Due now'}</dt><dd>{formatMoney(quote.total_cents, quote.currency)}</dd></div>
          <div><dt>{quote.change_kind === 'downgrade' ? 'At renewal' : 'Effective'}</dt><dd>{formatDate(quote.effective_at)}</dd></div>
        </dl>
        {quote.change_kind === 'downgrade' && <section className="billing-losses" aria-labelledby="billing-losses-title">
          <header><span><AlertTriangle size={22} /></span><div><small>Before you downgrade</small><h4 id="billing-losses-title">Keep {currentPlan?.name ?? quote.source_plan_code} and retain these capabilities</h4><p>The lower price also reduces the protection, history and collaboration available to your workspace.</p></div></header>
          {losses.length > 0 ? <ul>{losses.map((loss) => <li key={loss.label}><span><strong>{loss.label}</strong><small>{loss.detail}</small></span><span className="billing-losses__values"><b>{loss.before}</b><ArrowDownRight size={16} /><em>{loss.after}</em></span></li>)}</ul> : <p className="billing-losses__fallback">This change reduces your current plan benefits and will only take effect at renewal.</p>}
          <div className="billing-losses__retention"><Button type="button" variant="success" onClick={keepCurrentPlan} disabled={busy}>Keep {currentPlan?.name ?? 'current plan'}</Button><span>No changes will be made and all current limits stay active.</span></div>
        </section>}
        {quote.change_kind !== 'downgrade' && quote.total_cents > 0 && <fieldset className="billing-providers">
          <legend>Payment method</legend>
          {providerOptions.map((item) => {
            const selectable = item.code === 'manual' || item.configured
            return <label key={item.code} className={`${provider === item.code ? 'is-selected' : ''} ${!selectable ? 'is-disabled' : ''}`}>
            <input type="radio" name="billing-provider" value={item.code} checked={provider === item.code} disabled={!selectable} onChange={() => setProvider(item.code)} />
            <span><strong>{item.code === 'keepz' ? 'Keepz' : item.code === 'cloudpayments' ? 'CloudPayments' : 'Invoice'}</strong><small>{item.code === 'manual' ? 'Issue an invoice for administrator confirmation' : item.configured ? 'Online payment available' : 'Available after the system integration is configured'}</small></span>
          </label>
          })}
        </fieldset>}
        <div className="billing-quote__actions">
          <Button type="button" variant="secondary" onClick={keepCurrentPlan} disabled={busy}>{quote.change_kind === 'downgrade' ? 'Keep current plan' : 'Cancel change'}</Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>{busy ? 'Submitting…' : quote.change_kind === 'downgrade' ? 'Schedule downgrade' : quote.total_cents > 0 ? 'Create invoice' : 'Apply plan change'}</Button>
        </div>
      </section>}

      <section className="billing-invoices" aria-labelledby="workspace-invoices-title">
        <div><div><h3 id="workspace-invoices-title">Invoices</h3><p>Plan changes and their payment status.</p></div><Badge tone="neutral">Showing {invoices.length}{invoiceCursor ? '+' : ''}</Badge></div>
        {invoices.length === 0 ? <p className="billing-invoices__empty">No invoices have been issued for this workspace.</p> : <div>{invoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} busy={invoiceAction.startsWith(invoice.id)} onDownload={(item) => void downloadInvoice(item)} onEmail={(item) => void emailInvoice(item)} />)}</div>}
        {invoiceCursor && <div className="billing-invoices__more"><Button type="button" variant="secondary" disabled={loadingMoreInvoices} onClick={() => void loadMoreInvoices()}>{loadingMoreInvoices ? 'Loading…' : 'Load older invoices'}</Button></div>}
      </section>

      {notice && createPortal(<div className="billing-result-backdrop" role="presentation">
        <section className={`billing-result billing-result--${notice.kind}`} role="dialog" aria-modal="true" aria-labelledby="billing-result-title">
          <span className="billing-result__icon"><Check size={29} /></span>
          <small>{notice.kind === 'invoice' ? 'Plan upgrade ready' : notice.kind === 'scheduled' ? 'Plan change scheduled' : notice.kind === 'cancelled' ? 'Schedule removed' : 'Plan updated'}</small>
          <h3 id="billing-result-title">{notice.title}</h3>
          {notice.reference && <code>{notice.reference}</code>}
          <p>{notice.message}</p>
          {notice.emailedTo && <p className="billing-result__delivery"><Mail size={16} /> Sent to <strong>{notice.emailedTo}</strong></p>}
          {notice.emailWarning && <p className="billing-result__warning"><AlertTriangle size={16} /> The invoice was created, but email delivery failed: {notice.emailWarning}</p>}
          <div className="billing-result__actions">
            {notice.invoiceId && <Button type="button" variant="secondary" disabled={invoiceAction === notice.invoiceId + ':download'} onClick={() => { const invoice = invoices.find((item) => item.id === notice.invoiceId); if (invoice) void downloadInvoice(invoice) }}><Download size={16} /> Download PDF</Button>}
            {notice.invoiceId && <Button type="button" variant="secondary" disabled={invoiceAction === notice.invoiceId + ':email'} onClick={() => { const invoice = invoices.find((item) => item.id === notice.invoiceId); if (invoice) void emailInvoice(invoice) }}><Mail size={16} /> Email PDF</Button>}
            {notice.paymentUrl && <a className="button button--success" href={notice.paymentUrl} target="_blank" rel="noreferrer">Pay now <ExternalLink size={16} /></a>}
            {notice.kind === 'scheduled' && <Button type="button" variant="secondary" disabled={busy} onClick={() => void cancelPendingDowngrade()}><RotateCcw size={16} /> Cancel downgrade</Button>}
            <Button type="button" onClick={() => setNotice(null)}>I understand</Button>
          </div>
        </section>
      </div>, document.body)}
      </>}
    </div>}
  </Modal>
}
