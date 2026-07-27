import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './client'
import { SessionStore } from './session'
import type { Problem, Tokens } from './types'

const oldTokens: Tokens = {
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  token_type: 'Bearer',
  expires_at: '2030-01-01T00:00:00Z',
}

const newTokens: Tokens = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  token_type: 'Bearer',
  expires_at: '2030-01-02T00:00:00Z',
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function authorization(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization')
}

describe('ApiClient', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normalizes the configured base URL and safely builds path/query values', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }))
    const client = new ApiClient({
      baseUrl: 'https://api.example.test///',
      sessionStore: new SessionStore(localStorage),
      fetch: fetchMock,
    })

    await client.listMonitors('tenant/id', {
      limit: 25,
      cursor: 'next token',
      search: 'api & web',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/v1/tenants/tenant%2Fid/monitors?limit=25&cursor=next+token&search=api+%26+web',
    )
  })

  it('uses one refresh request for concurrent 401 responses and retries with the new bearer token', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    let refreshCalls = 0

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(init?.body).toBe(JSON.stringify({ refresh_token: 'old-refresh' }))
        expect(authorization(init)).toBeNull()
        return jsonResponse(newTokens)
      }

      if (authorization(init) === 'Bearer old-access') {
        return jsonResponse(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Expired token',
            instance: url,
            code: 'unauthorized',
          } satisfies Problem,
          401,
        )
      }

      expect(authorization(init)).toBe('Bearer new-access')
      return jsonResponse(url.endsWith('/monitors/monitor-1') ? { id: 'monitor-1' } : { items: [] })
    })

    const client = new ApiClient({ baseUrl: '/api', sessionStore: store, fetch: fetchMock })
    await Promise.all([client.getMonitor('tenant-1', 'monitor-1'), client.listMonitors('tenant-1')])

    expect(refreshCalls).toBe(1)
    expect(store.getTokens()).toEqual(newTokens)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('surfaces RFC 9457-style problem details and the request id', async () => {
    const problem: Problem = {
      type: 'https://sslping.example/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'Slug is already in use.',
      instance: '/v1/tenants/t/status-pages',
      code: 'conflict',
      errors: { slug: 'already exists' },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(problem, 409, {
        'Content-Type': 'application/problem+json',
        'X-Request-ID': 'request-123',
      }),
    )
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock })

    const result = client.listStatusPages('tenant-1')

    await expect(result).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      requestId: 'request-123',
      problem,
    } satisfies Partial<ApiError>)
  })

  it('clears persisted credentials when refresh is rejected', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/auth/refresh')) {
        return jsonResponse(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Refresh token revoked.',
            instance: url,
            code: 'unauthorized',
          } satisfies Problem,
          401,
        )
      }
      return jsonResponse({}, 401)
    })
    const client = new ApiClient({ sessionStore: store, fetch: fetchMock })

    await expect(client.me()).rejects.toMatchObject({ status: 401 })
    expect(store.getTokens()).toBeNull()
  })

  it('uses the dedicated support and system-administration endpoints', async () => {
    const store = new SessionStore(localStorage)
    store.setTokens(oldTokens)
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === '/v1/admin/impersonations') return jsonResponse({ tokens: newTokens })
      if (url === '/v1/support/tickets' || url === '/v1/admin/users' || url === '/v1/admin/plans') return jsonResponse({ items: [] })
      return new Response(null, { status: 204 })
    })
    const client = new ApiClient({ sessionStore: store, fetch: fetchMock })

    await client.listSupportTickets()
    await client.adminListUsers()
    await client.adminListPlans()
    const tokens = await client.adminImpersonate({ user_id: 'user-1', workspace_id: 'workspace-1', reason: 'Investigating ticket SUP-42' })
    await client.adminTestNotificationChannel('channel/id')

    expect(tokens).toEqual(newTokens)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/v1/support/tickets',
      '/v1/admin/users',
      '/v1/admin/plans',
      '/v1/admin/impersonations',
      '/v1/admin/notification-channels/channel%2Fid/actions/test',
    ])
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ user_id: 'user-1', workspace_id: 'workspace-1', reason: 'Investigating ticket SUP-42' }),
    })
    expect(authorization(fetchMock.mock.calls[3]?.[1])).toBe('Bearer old-access')
  })

  it('preserves an explicit false flag for a public administrator ticket reply', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ticket: {}, message: {} }, 201))
    const client = new ApiClient({ baseUrl: '/api', fetch: fetchMock })

    await client.adminReplyTicket('ticket-1', { message: 'Visible to the customer', internal: false })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/tickets/ticket-1/messages')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ message: 'Visible to the customer', internal: false }),
    })
  })

  it('uses the billing and invoice administration contract', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/actions/paid') || url.endsWith('/actions/void')) return jsonResponse({ id: 'invoice-1' })
      if (url.endsWith('/plan-changes/preview')) return jsonResponse({ change_kind: 'upgrade' })
      if (url.endsWith('/plan-changes')) return jsonResponse({ change_kind: 'upgrade' })
      return jsonResponse({ items: [] })
    })
    const client = new ApiClient({ baseUrl: '/api', fetch: fetchMock })

    await client.listBillingPlans()
    await client.getBillingSubscription()
    await client.listBillingInvoices({ limit: 20 })
    await client.previewPlanChange({ plan_code: 'business', billing_cycle: 'yearly' })
    await client.changeBillingPlan({ plan_code: 'business', billing_cycle: 'yearly', payment_provider: 'manual' })
    await client.adminListInvoices({ limit: 200 })
    await client.adminMarkInvoicePaid('invoice/1', { note: 'Bank transfer', paid_at: '2026-07-26T15:30:00.000Z' })
    await client.adminVoidInvoice('invoice/2')
    await client.adminUpdateWorkspacePaymentSettings('workspace/1', { keepz_allowed: true, cloudpayments_allowed: true })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/billing/plans',
      '/api/v1/billing/subscription',
      '/api/v1/billing/invoices?limit=20',
      '/api/v1/billing/plan-changes/preview',
      '/api/v1/billing/plan-changes',
      '/api/v1/admin/invoices?limit=200',
      '/api/v1/admin/invoices/invoice%2F1/actions/paid',
      '/api/v1/admin/invoices/invoice%2F2/actions/void',
      '/api/v1/admin/workspaces/workspace%2F1/payment-settings',
    ])
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ plan_code: 'business', billing_cycle: 'yearly' }) })
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ plan_code: 'business', billing_cycle: 'yearly', payment_provider: 'manual' }) })
    expect(fetchMock.mock.calls[6]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ note: 'Bank transfer', paid_at: '2026-07-26T15:30:00.000Z' }) })
  })

  it('downloads and emails customer and administrator invoice PDFs', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/pdf')) {
        return new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      }
      return jsonResponse({ message: 'Invoice sent.', recipient: 'billing@example.com' })
    })
    const client = new ApiClient({ baseUrl: '/api', fetch: fetchMock })

    await expect(client.downloadBillingInvoicePdf('invoice/customer')).resolves.toMatchObject({ type: 'application/pdf' })
    await expect(client.emailBillingInvoicePdf('invoice/customer')).resolves.toMatchObject({ recipient: 'billing@example.com' })
    await expect(client.adminDownloadInvoicePdf('invoice/admin')).resolves.toMatchObject({ type: 'application/pdf' })
    await expect(client.adminEmailInvoicePdf('invoice/admin')).resolves.toMatchObject({ recipient: 'billing@example.com' })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/billing/invoices/invoice%2Fcustomer/pdf',
      '/api/v1/billing/invoices/invoice%2Fcustomer/actions/email',
      '/api/v1/admin/invoices/invoice%2Fadmin/pdf',
      '/api/v1/admin/invoices/invoice%2Fadmin/actions/email',
    ])
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' })
  })

  it('reads support summaries and updates customer and administrator read state', async () => {
    const summary = { unread_tickets: 2, unread_messages: 3 }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new ApiClient({ baseUrl: '/api', fetch: fetchMock })

    await expect(client.getSupportTicketSummary()).resolves.toEqual(summary)
    await expect(client.markSupportTicketRead('ticket/customer', 'message/customer')).resolves.toBeUndefined()
    await expect(client.adminGetSupportTicketSummary()).resolves.toEqual(summary)
    await expect(client.adminMarkSupportTicketRead('ticket/admin', 'message/admin')).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/support/tickets/summary',
      '/api/v1/support/tickets/ticket%2Fcustomer/read-state',
      '/api/v1/admin/tickets/summary',
      '/api/v1/admin/tickets/ticket%2Fadmin/read-state',
    ])
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ through_message_id: 'message/customer' }),
    })
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ through_message_id: 'message/admin' }),
    })
  })

  it('uploads support attachments as multipart data and downloads their binary body', async () => {
    const attachment = {
      id: 'attachment-1',
      ticket_id: 'ticket-1',
      message_id: 'message-1',
      file_name: 'status.pdf',
      content_type: 'application/pdf',
      size_bytes: 12,
      created_at: '2026-07-26T17:00:00Z',
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(attachment, 201))
      .mockResolvedValueOnce(new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
    const client = new ApiClient({ baseUrl: '/api', fetch: fetchMock })
    const file = new File(['%PDF-1.7'], 'status.pdf', { type: 'application/pdf' })

    await expect(client.uploadSupportAttachment('ticket-1', 'message-1', file)).resolves.toEqual(attachment)
    const upload = fetchMock.mock.calls[0]
    expect(upload?.[0]).toBe('/api/v1/support/tickets/ticket-1/messages/message-1/attachments')
    expect(upload?.[1]?.method).toBe('POST')
    expect(upload?.[1]?.body).toBeInstanceOf(FormData)
    expect(new Headers(upload?.[1]?.headers).has('Content-Type')).toBe(false)
    expect((upload?.[1]?.body as FormData).get('file')).toBe(file)

    const downloaded = await client.downloadSupportAttachment('ticket-1', 'attachment-1')
    expect(downloaded.size).toBe(8)
    expect(downloaded.type).toBe('application/pdf')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/support/tickets/ticket-1/attachments/attachment-1')
  })
})
