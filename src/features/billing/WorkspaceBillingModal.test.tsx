import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingPlan, BillingSubscription, Invoice, PlanChangeQuote } from '../../api/types'
import { WorkspaceBillingModal } from './WorkspaceBillingModal'

const mocks = vi.hoisted(() => {
  const plan = (code: string, name: string, monthly: number, yearly: number, currency = 'USD'): BillingPlan => ({ id: `plan-${code}`, code, name, description: `${name} monitoring`, price_monthly_cents: monthly, price_yearly_cents: yearly, annual_discount_percent: 20, currency, public: true, active: true, limits: { max_monitors: code === 'free' ? 5 : 100, min_interval_seconds: code === 'free' ? 300 : 30, max_team_members: 10, max_status_pages: 5, max_integrations: 10, max_locations: 4, data_retention_days: 365, allow_manual_tests: code === 'business' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
  const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({ id: 'invoice-1', number: 'INV-0001', workspace_id: 'workspace-1', source_plan_code: 'free', source_billing_cycle: 'monthly', target_plan_code: 'pro', billing_cycle: 'monthly', change_kind: 'upgrade', currency: 'USD', subtotal_cents: 2000, annual_discount_cents: 0, unused_credit_cents: 0, total_cents: 2000, status: 'open', payment_provider: 'manual', period_start: '2026-07-26T20:00:00Z', period_end: '2026-08-26T20:00:00Z', due_at: '2099-08-02T20:00:00Z', created_at: '2026-07-26T20:00:00Z', updated_at: '2026-07-26T20:00:00Z', ...overrides })
  const listPlans = vi.fn().mockResolvedValue({ annual_discount_percent: 20, items: [plan('free', 'Free', 0, 0), plan('pro', 'Pro', 2000, 19200)] })
  const subscription: BillingSubscription = { id: 'sub-1', workspace_id: 'workspace-1', plan_code: 'free', billing_cycle: 'monthly', status: 'active', payment_provider: 'manual', current_period_amount_cents: 0, currency: 'USD', current_period_start: '2026-07-01T00:00:00Z', current_period_end: '2026-08-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }
  const getSubscription = vi.fn().mockResolvedValue(subscription)
  const listInvoices = vi.fn().mockResolvedValue({ items: [] })
  const preview = vi.fn()
  const change = vi.fn()
  const logout = vi.fn().mockResolvedValue(undefined)
  return { plan, invoice, listPlans, getSubscription, listInvoices, preview, change, logout, subscription, api: { listBillingPlans: listPlans, getBillingSubscription: getSubscription, listBillingInvoices: listInvoices, previewPlanChange: preview, changeBillingPlan: change } }
})

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({ api: mocks.api, workspace: { id: 'workspace-1', name: 'Production', plan: 'free' }, logout: mocks.logout }),
}))

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  mocks.listPlans.mockReset().mockResolvedValue({ annual_discount_percent: 20, items: [mocks.plan('free', 'Free', 0, 0), mocks.plan('pro', 'Pro', 2000, 19200)] })
  mocks.getSubscription.mockReset().mockResolvedValue(mocks.subscription)
  mocks.listInvoices.mockReset().mockResolvedValue({ items: [] })
  mocks.preview.mockReset()
  mocks.change.mockReset()
  mocks.logout.mockReset().mockResolvedValue(undefined)
})

describe('workspace billing', () => {
  it('replaces a raw authentication error with a friendly sign-in state', async () => {
    const onClose = vi.fn()
    mocks.listPlans.mockRejectedValueOnce(new Error('authentication required'))
    render(<WorkspaceBillingModal open onClose={onClose} />)

    expect(await screen.findByRole('heading', { name: 'Your session has expired' })).toBeInTheDocument()
    expect(screen.getByText('Nothing has been changed.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('authentication required')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Invoices' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses live annual prices and falls back to a manual invoice when Keepz is not configured', async () => {
    const quote: PlanChangeQuote = { change_kind: 'upgrade', source_plan_code: 'free', target_plan_code: 'pro', billing_cycle: 'yearly', currency: 'USD', subtotal_cents: 24000, annual_discount_cents: 4800, unused_credit_cents: 0, total_cents: 19200, effective_at: '2026-07-26T20:00:00Z', warning: '', available_payment_providers: [{ code: 'keepz', allowed: true, configured: false }, { code: 'cloudpayments', allowed: false, configured: true }, { code: 'manual', allowed: true, configured: true }] }
    const invoice = mocks.invoice({ billing_cycle: 'yearly', subtotal_cents: 24000, annual_discount_cents: 4800, total_cents: 19200, period_end: '2027-07-26T20:00:00Z' })
    mocks.preview.mockResolvedValue(quote)
    mocks.change.mockResolvedValue({ change_kind: 'upgrade', quote, subscription: mocks.subscription, invoice })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    await screen.findByRole('heading', { name: 'Pro' })
    fireEvent.click(screen.getByRole('radio', { name: /yearly/i }))
    expect(screen.getByText('$192.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose Pro' }))

    expect(await screen.findByRole('radio', { name: /keepz/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /invoice/i })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }))
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith({ plan_code: 'pro', billing_cycle: 'yearly', payment_provider: 'manual' }))
    const notice = await screen.findByRole('dialog', { name: 'Invoice created' })
    expect(within(notice).getByText('Invoice created')).toBeInTheDocument()
    expect(within(notice).getByText('INV-0001')).toBeInTheDocument()
    expect(within(notice).getByText('Your new limits will activate as soon as the payment is confirmed.')).toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('button', { name: 'I understand' }))
    expect(screen.queryByRole('dialog', { name: 'Invoice created' })).not.toBeInTheDocument()
  })

  it('explains that a downgrade keeps current limits until renewal', async () => {
    mocks.getSubscription.mockResolvedValueOnce({ ...mocks.subscription, plan_code: 'pro' })
    const quote: PlanChangeQuote = { change_kind: 'downgrade', source_plan_code: 'pro', target_plan_code: 'free', billing_cycle: 'monthly', currency: 'USD', subtotal_cents: 500, annual_discount_cents: 0, unused_credit_cents: 0, total_cents: 500, effective_at: '2026-08-01T00:00:00Z', warning: 'Your current limits remain active until renewal.', available_payment_providers: [{ code: 'manual', allowed: true, configured: true }] }
    mocks.preview.mockResolvedValue(quote)
    mocks.change.mockResolvedValue({ change_kind: 'downgrade', quote, subscription: { ...mocks.subscription, plan_code: 'pro', pending_plan_code: 'free', pending_effective_at: quote.effective_at } })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    await screen.findByRole('heading', { name: 'Free' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Free' }))
    expect(await screen.findByText('Your current limits remain active until renewal.')).toBeInTheDocument()
    expect(screen.getByText('Next term')).toBeInTheDocument()
    expect(screen.getByText('At renewal')).toBeInTheDocument()
    expect(screen.queryByText('Amount due')).not.toBeInTheDocument()
    expect(screen.queryByText('Due now')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Keep Pro and retain these capabilities' })).toBeInTheDocument()
    expect(screen.getByText('Fewer services can be monitored at the same time.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep Pro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule downgrade' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Payment method' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Schedule downgrade' }))
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith({ plan_code: 'free', billing_cycle: 'monthly' }))
  })

  it('flags a past-due subscription with its payment grace deadline', async () => {
    mocks.getSubscription.mockResolvedValueOnce({ ...mocks.subscription, status: 'past_due', current_period_end: '2020-01-01T00:00:00Z', grace_ends_at: '2026-08-05T00:00:00Z' })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    expect(await screen.findByText(/Payment overdue · due by/)).toBeInTheDocument()
    expect(screen.queryByText(/renews Jan 1, 2020/i)).not.toBeInTheDocument()
  })

  it('makes a suspended subscription state explicit', async () => {
    mocks.getSubscription.mockResolvedValueOnce({ ...mocks.subscription, status: 'suspended' })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    expect(await screen.findByText('Subscription suspended · payment required')).toBeInTheDocument()
  })

  it('confirms immediate activation when a zero-total change is auto-settled', async () => {
    const quote: PlanChangeQuote = { change_kind: 'upgrade', source_plan_code: 'free', target_plan_code: 'pro', billing_cycle: 'monthly', currency: 'USD', subtotal_cents: 2000, annual_discount_cents: 0, unused_credit_cents: 2000, total_cents: 0, effective_at: '2026-07-26T20:00:00Z', warning: '', available_payment_providers: [] }
    const invoice = mocks.invoice({ id: 'invoice-zero', number: 'INV-0002', unused_credit_cents: 2000, total_cents: 0, status: 'paid', paid_at: '2026-07-26T20:00:00Z' })
    mocks.preview.mockResolvedValue(quote)
    mocks.change.mockResolvedValue({ change_kind: 'upgrade', quote, subscription: { ...mocks.subscription, plan_code: 'pro' }, invoice })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    await screen.findByRole('heading', { name: 'Pro' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Pro' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply plan change' }))

    expect(await screen.findByText('The plan has been activated and the new limits are available immediately.')).toBeInTheDocument()
    expect(mocks.change).toHaveBeenCalledWith({ plan_code: 'pro', billing_cycle: 'monthly' })
  })

  it('shows a pay-now action in the centered result when checkout is configured', async () => {
    const quote: PlanChangeQuote = { change_kind: 'upgrade', source_plan_code: 'free', target_plan_code: 'pro', billing_cycle: 'monthly', currency: 'USD', subtotal_cents: 2000, annual_discount_cents: 0, unused_credit_cents: 0, total_cents: 2000, effective_at: '2026-07-26T20:00:00Z', available_payment_providers: [{ code: 'keepz', allowed: true, configured: true }, { code: 'manual', allowed: true, configured: true }] }
    const invoice = mocks.invoice({ payment_provider: 'keepz', payment_url: 'https://pay.example.test/checkout' })
    mocks.preview.mockResolvedValue(quote)
    mocks.change.mockResolvedValue({ change_kind: 'upgrade', quote, subscription: mocks.subscription, invoice })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Choose Pro' }))
    expect(await screen.findByRole('radio', { name: /keepz/i })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create invoice' }))

    const result = await screen.findByRole('dialog', { name: 'Invoice created' })
    expect(within(result).getByRole('link', { name: /pay now/i })).toHaveAttribute('href', 'https://pay.example.test/checkout')
  })

  it('lets the customer cancel a scheduled downgrade', async () => {
    const pending: BillingSubscription = { ...mocks.subscription, plan_code: 'pro', pending_plan_code: 'free', pending_billing_cycle: 'monthly', pending_effective_at: '2026-08-01T00:00:00Z' }
    mocks.getSubscription.mockResolvedValueOnce(pending)
    mocks.change.mockResolvedValueOnce({ change_kind: 'no_change', quote: { change_kind: 'no_change', source_plan_code: 'pro', target_plan_code: 'pro', billing_cycle: 'monthly', currency: 'USD', subtotal_cents: 2000, annual_discount_cents: 0, unused_credit_cents: 0, total_cents: 2000, effective_at: '2026-07-26T20:00:00Z', available_payment_providers: [] }, subscription: { ...pending, pending_plan_code: undefined, pending_billing_cycle: undefined, pending_effective_at: undefined } })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith({ plan_code: 'pro', billing_cycle: 'monthly' }))
    expect(await screen.findByRole('dialog', { name: 'Scheduled downgrade cancelled' })).toBeInTheDocument()
    expect(screen.queryByText(/free from/i)).not.toBeInTheDocument()
  })

  it('offers only active public plans in the current subscription currency', async () => {
    const euroPlan = mocks.plan('euro-pro', 'Euro Pro', 1800, 17280, 'EUR')
    const privatePlan = { ...mocks.plan('private', 'Private USD', 3000, 28800), public: false }
    const inactivePlan = { ...mocks.plan('retired', 'Retired USD', 1000, 9600), active: false }
    mocks.listPlans.mockResolvedValueOnce({
      annual_discount_percent: 20,
      items: [mocks.plan('free', 'Free', 0, 0), mocks.plan('pro', 'Pro', 2000, 19200), euroPlan, privatePlan, inactivePlan],
    })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    expect(await screen.findByRole('heading', { name: 'Pro' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Euro Pro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Private USD' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Retired USD' })).not.toBeInTheDocument()
  })

  it('renders a payment link only for an open invoice', async () => {
    const openInvoice = mocks.invoice({ id: 'invoice-open', number: 'INV-OPEN', payment_url: 'https://pay.example.test/open' })
    const paidInvoice = mocks.invoice({ id: 'invoice-paid', number: 'INV-PAID', status: 'paid', payment_url: 'https://pay.example.test/already-paid', paid_at: '2026-07-27T10:00:00Z' })
    const expiredInvoice = mocks.invoice({ id: 'invoice-expired', number: 'INV-EXPIRED', payment_url: 'https://pay.example.test/expired', due_at: '2020-01-01T00:00:00Z' })
    mocks.listInvoices.mockResolvedValueOnce({ items: [openInvoice, paidInvoice, expiredInvoice] })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    await screen.findByText('INV-PAID')
    const paymentLink = screen.getByRole('link', { name: /pay/i })
    expect(paymentLink).toHaveAttribute('href', 'https://pay.example.test/open')
    expect(screen.getAllByRole('link', { name: /pay/i })).toHaveLength(1)
    expect(within(screen.getByText('INV-PAID').closest('article')!).queryByRole('link', { name: /pay/i })).not.toBeInTheDocument()
    expect(within(screen.getByText('INV-EXPIRED').closest('article')!).getByText('Payment deadline passed')).toBeInTheDocument()
  })

  it('removes the payment link when an open invoice reaches its deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T20:00:00Z'))
    mocks.listInvoices.mockResolvedValueOnce({
      items: [mocks.invoice({ payment_url: 'https://pay.example.test/open', due_at: '2026-07-26T20:00:05Z' })],
    })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('link', { name: /pay/i })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(5_100))

    expect(screen.queryByRole('link', { name: /pay/i })).not.toBeInTheDocument()
    expect(screen.getByText('Payment deadline passed')).toBeInTheDocument()
  })

  it('loads older invoices with the returned cursor and appends the page', async () => {
    const recent = mocks.invoice({ id: 'invoice-recent', number: 'INV-RECENT' })
    const older = mocks.invoice({ id: 'invoice-older', number: 'INV-OLDER', status: 'paid', paid_at: '2026-06-27T10:00:00Z', created_at: '2026-06-27T09:00:00Z' })
    mocks.listInvoices
      .mockResolvedValueOnce({ items: [recent], next_cursor: 'invoice-cursor-2' })
      .mockResolvedValueOnce({ items: [older] })
    render(<WorkspaceBillingModal open onClose={() => undefined} />)

    expect(await screen.findByText('INV-RECENT')).toBeInTheDocument()
    expect(screen.getByText('Showing 1+')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load older invoices' }))

    expect(await screen.findByText('INV-OLDER')).toBeInTheDocument()
    expect(mocks.listInvoices).toHaveBeenNthCalledWith(1, { limit: 20 })
    expect(mocks.listInvoices).toHaveBeenNthCalledWith(2, { limit: 20, cursor: 'invoice-cursor-2' })
    expect(screen.getByText('Showing 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load older invoices' })).not.toBeInTheDocument()
  })
})
