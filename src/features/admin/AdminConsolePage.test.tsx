import { useState, type FormEvent } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminBillingWorkspace, AdminUser, CustomerRegion, Invoice, SupportTicketDetail } from '../../api/types'
import { I18nProvider, LanguageSelect } from '../../app/I18nProvider'
import { AdminConsolePage, PlanModal, TicketModal } from './AdminConsolePage'

const mocks = vi.hoisted(() => {
  const users = vi.fn()
  const plans = vi.fn()
  const regions = vi.fn().mockResolvedValue({ items: [] })
  const checkLocations = vi.fn().mockResolvedValue({ items: [] })
  const createCheckLocation = vi.fn()
  const updateCheckLocation = vi.fn()
  const tickets = vi.fn()
  const channels = vi.fn()
  const ticketDetail = vi.fn()
  const markRead = vi.fn()
  const invoices = vi.fn().mockResolvedValue({ items: [] })
  const billingWorkspaces = vi.fn().mockResolvedValue({ items: [] })
  const billingSettings = vi.fn().mockResolvedValue({ annual_discount_percent: 15, updated_at: '2026-07-26T17:00:00Z' })
  const invoiceDetail = vi.fn()
  const workspacePayments = vi.fn()
  const updateWorkspacePayments = vi.fn()
  const markInvoicePaid = vi.fn()
  const updateBillingSettings = vi.fn()
  return {
    users, plans, regions, checkLocations, createCheckLocation, updateCheckLocation, tickets, channels, ticketDetail, markRead, invoices, billingWorkspaces, billingSettings, invoiceDetail, workspacePayments, updateWorkspacePayments, markInvoicePaid, updateBillingSettings,
    auth: { user: { id: 'admin-1', name: 'Administrator', system_role: 'superadmin' as 'user' | 'accountant' | 'superadmin' } },
    api: {
      adminListUsers: users,
      adminListPlans: plans,
      adminListRegions: regions,
      adminListCheckLocations: checkLocations,
      adminCreateCheckLocation: createCheckLocation,
      adminUpdateCheckLocation: updateCheckLocation,
      adminListTickets: tickets,
      adminListNotificationChannels: channels,
      adminGetTicket: ticketDetail,
      adminMarkSupportTicketRead: markRead,
      adminListInvoices: invoices,
      adminListBillingWorkspaces: billingWorkspaces,
      adminGetBillingSettings: billingSettings,
      adminUpdateBillingSettings: updateBillingSettings,
      adminGetInvoice: invoiceDetail,
      adminGetWorkspacePaymentSettings: workspacePayments,
      adminUpdateWorkspacePaymentSettings: updateWorkspacePayments,
      adminMarkInvoicePaid: markInvoicePaid,
    },
  }
})

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({
    user: mocks.auth.user,
    api: mocks.api,
  }),
}))

const detail: SupportTicketDetail = {
  ticket: {
    id: 'ticket-1',
    workspace_id: 'workspace-1',
    created_by: 'customer-1',
    subject: 'Delivery problem',
    status: 'open',
    priority: 'high',
    created_at: '2026-07-26T17:00:00Z',
    updated_at: '2026-07-26T17:00:00Z',
    last_reply_at: '2026-07-26T17:00:00Z',
    unread_count: 0,
  },
  messages: [],
}

const globalRegion: CustomerRegion = {
  id: 'region-global',
  code: 'global',
  name: 'Global',
  default_locale: 'en',
  currency: 'USD',
  payment_providers: ['manual', 'keepz', 'cloudpayments'],
  default_plan_code: 'free',
  active: true,
  default: true,
  created_at: '2026-07-26T17:00:00Z',
  updated_at: '2026-07-26T17:00:00Z',
}

afterEach(() => {
  cleanup()
  window.localStorage.removeItem('sslping.locale')
  vi.clearAllMocks()
  mocks.invoices.mockReset().mockResolvedValue({ items: [] })
  mocks.billingWorkspaces.mockReset().mockResolvedValue({ items: [] })
  mocks.regions.mockReset().mockResolvedValue({ items: [globalRegion] })
  mocks.checkLocations.mockReset().mockResolvedValue({ items: [] })
  mocks.createCheckLocation.mockReset()
  mocks.updateCheckLocation.mockReset()
  mocks.auth.user = { id: 'admin-1', name: 'Administrator', system_role: 'superadmin' }
})

describe('administrator localization', () => {
  it('updates the complete administration overview when the dashboard language changes', async () => {
    mocks.users.mockResolvedValue({ items: [] })
    mocks.plans.mockResolvedValue({ items: [] })
    mocks.tickets.mockResolvedValue({ items: [] })
    mocks.channels.mockResolvedValue({ items: [] })
    mocks.regions.mockResolvedValue({ items: [globalRegion] })

    render(
      <I18nProvider>
        <LanguageSelect />
        <AdminConsolePage />
      </I18nProvider>,
    )

    expect(await screen.findByRole('heading', { name: /Control center/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } })

    expect(await screen.findByRole('heading', { name: /Центр управления/ })).toBeInTheDocument()
    expect(screen.getByText('Зарегистрированные пользователи')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пользователи и пространства' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Точки проверки' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Поиск по пользователю, email или пространству')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Control center/ })).not.toBeInTheDocument()
  })
})

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    number: 'INV-0001',
    workspace_id: 'workspace-1',
    workspace_name: 'Acme',
    customer_email: 'owner@acme.test',
    source_plan_code: 'free',
    source_billing_cycle: 'monthly',
    target_plan_code: 'pro',
    billing_cycle: 'yearly',
    change_kind: 'upgrade',
    currency: 'USD',
    subtotal_cents: 24000,
    annual_discount_cents: 4800,
    unused_credit_cents: 0,
    total_cents: 19200,
    status: 'open',
    payment_provider: 'manual',
    period_start: '2026-07-26T17:00:00Z',
    period_end: '2027-07-26T17:00:00Z',
    due_at: '2026-08-02T17:00:00Z',
    created_at: '2026-07-26T17:00:00Z',
    updated_at: '2026-07-26T17:00:00Z',
    ...overrides,
  }
}

function ReplyHarness({ onSubmit }: { onSubmit: (event: FormEvent, internal: boolean) => void }) {
  const [reply, setReply] = useState('Visible to the customer')
  const [internal, setInternal] = useState(true)
  return (
    <TicketModal
      detail={detail}
      users={[]}
      busy={false}
      reply={reply}
      internal={internal}
      files={[]}
      onClose={() => undefined}
      onReply={setReply}
      onInternal={setInternal}
      onFiles={() => undefined}
      onOpenAttachment={() => undefined}
      onUpdate={() => undefined}
      onSubmit={onSubmit}
    />
  )
}

describe('administrator ticket reply', () => {
  it('submits a customer reply as public after turning off internal-note mode', () => {
    const onSubmit = vi.fn((event: FormEvent, _internal: boolean) => event.preventDefault())
    render(<ReplyHarness onSubmit={onSubmit} />)

    expect(screen.getByRole('dialog')).toHaveClass('modal--xl', 'admin-ticket-modal')
    const toggle = screen.getByRole('switch', { name: 'Internal note' })
    expect(toggle.closest('label')).toBeNull()
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0]?.[1]).toBe(false)
  })
})

describe('plan price editor', () => {
  it('keeps a decimal draft stable and converts it to integer cents before saving', () => {
    const onSave = vi.fn()
    render(<PlanModal open plan={null} regions={[globalRegion]} busy={false} onClose={() => undefined} onSave={onSave} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Pro' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'pro' } })
    const price = screen.getByRole('textbox', { name: /Monthly price/ })
    expect(price).toHaveAttribute('inputmode', 'decimal')
    fireEvent.change(price, { target: { value: '29.' } })
    expect(price).toHaveValue('29.')
    fireEvent.change(price, { target: { value: '29.99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ price_monthly_cents: 2999, currency: 'USD' }))
  })

  it('uses the backend minimums and clamps invalid limit input', () => {
    render(<PlanModal open plan={null} regions={[globalRegion]} busy={false} onClose={() => undefined} onSave={() => undefined} />)

    const monitors = screen.getByRole('spinbutton', { name: 'Monitors' })
    const interval = screen.getByRole('spinbutton', { name: 'Minimum interval, seconds' })
    const statusPages = screen.getByRole('spinbutton', { name: 'Status pages' })
    const integrations = screen.getByRole('spinbutton', { name: 'Integrations' })
    const locations = screen.getByRole('spinbutton', { name: 'Locations' })

    expect(monitors).toHaveAttribute('min', '1')
    expect(interval).toHaveAttribute('min', '10')
    expect(statusPages).toHaveAttribute('min', '0')
    expect(integrations).toHaveAttribute('min', '0')
    expect(locations).toHaveAttribute('min', '1')

    fireEvent.change(monitors, { target: { value: '-5' } })
    fireEvent.change(statusPages, { target: { value: '-5' } })
    expect(monitors).toHaveValue(1)
    expect(statusPages).toHaveValue(0)
  })

  it('matches backend plan code and name validation before saving', () => {
    const onSave = vi.fn()
    render(<PlanModal open plan={null} regions={[globalRegion]} busy={false} onClose={() => undefined} onSave={onSave} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Pro' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Code/ }), { target: { value: '--' } })
    expect(screen.getByText(/Start with a letter or number/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: /^Code/ }), { target: { value: 'pro' } })
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled()
  })
})

describe('annual billing discount', () => {
  it('normalizes the administrator value to the integer contract', async () => {
    mocks.users.mockResolvedValue({ items: [] })
    mocks.plans.mockResolvedValue({ items: [] })
    mocks.tickets.mockResolvedValue({ items: [] })
    mocks.channels.mockResolvedValue({ items: [] })
    mocks.billingSettings.mockResolvedValue({ annual_discount_percent: 15, updated_at: '2026-07-26T17:00:00Z' })
    mocks.updateBillingSettings.mockResolvedValue({ annual_discount_percent: 12, updated_at: '2026-07-26T18:00:00Z' })
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: /plans & limits/i }))
    const discount = screen.getByRole('spinbutton', { name: /Annual discount percent/ })
    expect(discount).toHaveAttribute('step', '1')
    fireEvent.change(discount, { target: { value: '12.5' } })
    expect(discount).toHaveValue(12)
    fireEvent.click(screen.getByRole('button', { name: 'Save discount' }))

    await waitFor(() => expect(mocks.updateBillingSettings).toHaveBeenCalledWith({ annual_discount_percent: 12 }))
  })
})

describe('administrator data loading', () => {
  it('keeps successful sections visible when one newer endpoint is unavailable', async () => {
    const loadedUser: AdminUser = {
      id: 'customer-1',
      email: 'customer@example.test',
      name: 'Example Customer',
      locale: 'en',
      region_id: globalRegion.id,
      region: globalRegion,
      timezone: 'UTC',
      email_verified_at: '2026-07-26T17:00:00Z',
      two_factor_enabled: false,
      system_role: 'user',
      created_at: '2026-07-26T17:00:00Z',
      updated_at: '2026-07-26T17:00:00Z',
      workspaces: [],
    }
    mocks.users.mockResolvedValue({ items: [loadedUser] })
    mocks.plans.mockResolvedValue({ items: [] })
    mocks.regions.mockRejectedValueOnce(new Error('404 page not found'))
    mocks.tickets.mockResolvedValue({ items: [] })
    mocks.channels.mockResolvedValue({ items: [] })

    render(<AdminConsolePage />)

    expect(await screen.findByText('Example Customer')).toBeInTheDocument()
    expect(screen.getByText('404 page not found')).toBeInTheDocument()
  })
})

describe('administrator ticket unread state', () => {
  it('highlights new customer activity and clears it only after marking the latest customer message', async () => {
    const unreadDetail: SupportTicketDetail = {
      ticket: { ...detail.ticket, unread_count: 1 },
      messages: [
        { id: 'customer-message', ticket_id: 'ticket-1', author_id: 'customer-1', author_role: 'user', body: 'New details', internal: false, created_at: '2026-07-26T17:01:00Z', attachments: [] },
        { id: 'internal-note', ticket_id: 'ticket-1', author_id: 'admin-1', author_role: 'superadmin', body: 'Private note', internal: true, created_at: '2026-07-26T17:02:00Z', attachments: [] },
      ],
    }
    mocks.users.mockResolvedValue({ items: [] })
    mocks.plans.mockResolvedValue({ items: [] })
    mocks.tickets.mockResolvedValue({ items: [unreadDetail.ticket] })
    mocks.channels.mockResolvedValue({ items: [] })
    mocks.ticketDetail.mockResolvedValue(unreadDetail)
    mocks.markRead.mockResolvedValue({ unread_tickets: 0, unread_messages: 0 })
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: /tickets/i }))
    const row = await screen.findByRole('listitem')
    expect(row).toHaveClass('is-unread')
    expect(row).toHaveTextContent('New activity')

    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith('ticket-1', 'customer-message'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('listitem')).not.toHaveClass('is-unread')
  })
})

describe('check location access', () => {
  it('loads the dedicated check-location section for a superadministrator', async () => {
    mocks.users.mockResolvedValue({ items: [] })
    mocks.plans.mockResolvedValue({ items: [] })
    mocks.tickets.mockResolvedValue({ items: [] })
    mocks.channels.mockResolvedValue({ items: [] })
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check locations' }))

    expect(await screen.findByRole('heading', { name: 'Check locations' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.checkLocations).toHaveBeenCalledOnce())
  })
})

describe('accountant access', () => {
  it('loads and exposes only invoice administration', async () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Billing', system_role: 'accountant' }
    mocks.invoices.mockResolvedValueOnce({ items: [] })
    render(<AdminConsolePage />)

    expect(await screen.findByRole('heading', { name: /invoices & payments/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /invoices/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /users & workspaces/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check locations/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /plans & limits/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /tickets/i })).not.toBeInTheDocument()
    expect(mocks.users).not.toHaveBeenCalled()
    expect(mocks.plans).not.toHaveBeenCalled()
    expect(mocks.checkLocations).not.toHaveBeenCalled()
    expect(mocks.tickets).not.toHaveBeenCalled()
  })

  it('shows region-managed payment access and lets an accountant confirm an invoice payment', async () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Billing', system_role: 'accountant' }
    const currentInvoice = invoice()
    mocks.invoices.mockResolvedValueOnce({ items: [currentInvoice] })
    mocks.invoiceDetail.mockResolvedValue(currentInvoice)
    mocks.markInvoicePaid.mockResolvedValue({ ...currentInvoice, status: 'paid', paid_at: '2026-07-26T18:00:00Z' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Review invoice' }))
    expect(await screen.findByRole('dialog', { name: /invoice inv-0001/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /void invoice/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Allow CloudPayments' })).not.toBeInTheDocument()
    expect(mocks.updateWorkspacePayments).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /mark as paid/i }))
    await waitFor(() => expect(mocks.markInvoicePaid).toHaveBeenCalledWith('invoice-1', {}))
    confirm.mockRestore()
  })

  it('sends an explicitly entered bank receipt time when confirming payment', async () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Billing', system_role: 'accountant' }
    const currentInvoice = invoice()
    const settings = { workspace_id: 'workspace-1', keepz_allowed: true, cloudpayments_allowed: false, updated_at: '2026-07-26T17:00:00Z' }
    mocks.invoices.mockResolvedValueOnce({ items: [currentInvoice] })
    mocks.invoiceDetail.mockResolvedValue(currentInvoice)
    mocks.workspacePayments.mockResolvedValue(settings)
    mocks.markInvoicePaid.mockResolvedValue({ ...currentInvoice, status: 'paid', paid_at: '2026-07-26T15:30:00.000Z' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Review invoice' }))
    const receivedAt = '2026-07-26T18:30'
    const receivedAtField = await screen.findByLabelText(/Payment received at/i)
    const paymentNoteField = screen.getByLabelText(/Payment note/i)
    expect(receivedAtField.closest('label')).toHaveClass('field')
    expect(paymentNoteField.closest('label')).toHaveClass('field')
    fireEvent.change(receivedAtField, { target: { value: receivedAt } })
    fireEvent.change(paymentNoteField, { target: { value: 'Bank transfer 1042' } })
    fireEvent.click(screen.getByRole('button', { name: /mark as paid/i }))

    await waitFor(() => expect(mocks.markInvoicePaid).toHaveBeenCalledWith('invoice-1', {
      paid_at: new Date(receivedAt).toISOString(),
      note: 'Bank transfer 1042',
    }))
    confirm.mockRestore()
  })

  it('loads older invoices by cursor and keeps KPI labels scoped to the loaded set', async () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Billing', system_role: 'accountant' }
    const recent = invoice({ id: 'invoice-recent', number: 'INV-RECENT' })
    const older = invoice({ id: 'invoice-older', number: 'INV-OLDER', status: 'paid', paid_at: '2026-06-26T17:00:00Z' })
    mocks.invoices
      .mockResolvedValueOnce({ items: [recent], next_cursor: 'invoice-cursor-2' })
      .mockResolvedValueOnce({ items: [older] })
    render(<AdminConsolePage />)

    expect(await screen.findByText('INV-RECENT')).toBeInTheDocument()
    const loadedKpi = screen.getByText('Invoices loaded').closest('div')!
    expect(within(loadedKpi).getByText('1+')).toBeInTheDocument()
    expect(screen.getByText('Currencies loaded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load older invoices' }))

    expect(await screen.findByText('INV-OLDER')).toBeInTheDocument()
    expect(mocks.invoices).toHaveBeenNthCalledWith(1, { limit: 200 })
    expect(mocks.invoices).toHaveBeenNthCalledWith(2, { limit: 200, cursor: 'invoice-cursor-2' })
    expect(within(loadedKpi).getByText('2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load older invoices' })).not.toBeInTheDocument()
  })

  it('shows the regional payment policy before a workspace has an invoice', async () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Billing', system_role: 'accountant' }
    const workspace: AdminBillingWorkspace = {
      id: 'workspace-no-invoice',
      name: 'No Invoice Yet',
      slug: 'no-invoice-yet',
      plan: 'free',
      currency: 'USD',
      region: globalRegion,
      payment_providers: ['manual', 'keepz', 'cloudpayments'],
      created_at: '2026-07-26T17:00:00Z',
      updated_at: '2026-07-26T17:00:00Z',
    }
    mocks.billingWorkspaces.mockResolvedValue({ items: [workspace] })
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: /Regional payment policies/i }))
    expect(screen.queryByText('No Invoice Yet')).not.toBeInTheDocument()
    expect(mocks.billingWorkspaces).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search billing workspaces' }), { target: { value: 'No Invoice' } })
    await waitFor(() => expect(mocks.billingWorkspaces).toHaveBeenCalledWith({ limit: 5, search: 'No Invoice' }))
    expect(await screen.findByText('No Invoice Yet')).toBeInTheDocument()
    expect(screen.getByText('Global · USD')).toBeInTheDocument()
    expect(screen.getByText('Keepz')).toBeInTheDocument()
    expect(screen.getByText('CloudPayments')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure access' })).not.toBeInTheDocument()
  })

  it('clears workspace results when the directory closes and never preloads the full directory', async () => {
    mocks.auth.user = { id: 'accountant-1', name: 'Billing', system_role: 'accountant' }
    render(<AdminConsolePage />)

    fireEvent.click(await screen.findByRole('button', { name: /Regional payment policies/i }))
    const search = await screen.findByRole('textbox', { name: 'Search billing workspaces' })
    fireEvent.change(search, { target: { value: 'Acme' } })
    await waitFor(() => expect(mocks.billingWorkspaces).toHaveBeenCalledWith({ limit: 5, search: 'Acme' }))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: /Regional payment policies/i }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search billing workspaces' })).toHaveValue(''))
    expect(mocks.billingWorkspaces).toHaveBeenCalledTimes(1)
  })
})
