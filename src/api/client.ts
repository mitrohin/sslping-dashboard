import { isTokens, SessionRecoveryError, SessionStore, sessionChangedError, type SessionChange, type SessionSnapshot } from './session'
import type * as Api from './types'

type QueryValue = string | number | boolean | null | undefined

export interface ApiRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

interface RequestOptions extends ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: HeadersInit
  auth?: boolean
  retryUnauthorized?: boolean
  responseType?: 'json' | 'blob'
  preserveUnauthorized?: boolean
  sessionBound?: boolean
}

export interface ApiClientOptions {
  baseUrl?: string
  sessionStore?: SessionStore
  fetch?: typeof fetch
  requestTimeoutMs?: number
}

function normalizeBaseUrl(baseUrl?: string): string {
  const configured = baseUrl ?? import.meta.env.VITE_API_URL ?? ''
  return configured.trim().replace(/\/+$/, '')
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

function withQuery(path: string, query?: object): string {
  if (!query) return path

  const search = new URLSearchParams()
  for (const [key, rawValue] of Object.entries(query)) {
    const value = rawValue as QueryValue
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }

  const encoded = search.toString()
  return encoded.length > 0 ? `${path}?${encoded}` : path
}

function isProblem(value: unknown): value is Api.Problem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<Api.Problem>
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'number' &&
    typeof candidate.detail === 'string' &&
    typeof candidate.instance === 'string' &&
    typeof candidate.code === 'string'
  )
}

function fallbackProblem(response: Response, detail: string): Api.Problem {
  const codeByStatus: Partial<Record<number, Api.ProblemCode>> = {
    400: 'invalid_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    413: 'payload_too_large',
    429: 'rate_limited',
  }

  return {
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
    detail: detail || `HTTP ${response.status}`,
    instance: '',
    code: codeByStatus[response.status] ?? 'internal_error',
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: Api.ProblemCode
  readonly problem: Api.Problem
  readonly requestId?: string
  readonly retryAfterMs?: number
  readonly retryAt?: number

  constructor(problem: Api.Problem, requestId?: string, retryAfterMs?: number) {
    super(problem.detail || problem.title)
    this.name = 'ApiError'
    this.status = problem.status
    this.code = problem.code
    this.problem = problem
    this.requestId = requestId
    this.retryAfterMs = retryAfterMs
    this.retryAt = retryAfterMs === undefined ? undefined : Date.now() + retryAfterMs
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000
    return Number.isFinite(milliseconds) ? milliseconds : undefined
  }
  if (/^[+-]?\d/.test(trimmed)) return undefined
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

async function responseToError(response: Response): Promise<ApiError> {
  let body: unknown
  let text = ''

  try {
    text = await response.text()
    body = text.length > 0 ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }

  const problem = isProblem(body) ? body : fallbackProblem(response, text)
  return new ApiError(problem, response.headers.get('X-Request-ID') ?? undefined, parseRetryAfter(response.headers.get('Retry-After')))
}

function missingRefreshTokenError(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Authentication required',
    status: 401,
    detail: 'No refresh token is available.',
    instance: '',
    code: 'unauthorized',
  })
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? sessionChangedError())
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? sessionChangedError())
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

export class ApiClient {
  readonly baseUrl: string
  readonly session: SessionStore
  readonly #fetch: typeof fetch
  readonly #requestTimeoutMs: number
  #refreshInFlight: Promise<Api.Tokens> | null = null
  #epoch = 0
  readonly #controllers = new Set<AbortController>()
  readonly #authenticationRequiredListeners = new Set<() => void>()
  readonly #sessionChangedListeners = new Set<(change: SessionChange) => void>()
  readonly #unsubscribeSession: () => void

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.session = options.sessionStore ?? new SessionStore()
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.#unsubscribeSession = this.session.subscribe((change) => {
      if (!change.identityChanged) return
      this.#invalidateRequests()
      for (const listener of this.#sessionChangedListeners) listener(change)
      if (change.external && !change.snapshot.tokens) {
        for (const listener of this.#authenticationRequiredListeners) listener()
      }
    })
  }

  get tokens(): Api.Tokens | null { return this.session.getTokens() }
  get sessionGeneration(): string | null { return this.session.getSnapshot().generation }

  setTokens(tokens: Api.Tokens): void { this.session.setTokens(tokens) }

  clearSession(): void {
    // Also invalidate an unauthenticated login that has not produced tokens yet.
    this.#invalidateRequests()
    this.session.clear()
  }

  dispose(): void {
    this.#invalidateRequests()
    this.#unsubscribeSession()
    this.#authenticationRequiredListeners.clear()
    this.#sessionChangedListeners.clear()
  }

  onAuthenticationRequired(listener: () => void): () => void {
    this.#authenticationRequiredListeners.add(listener)
    return () => this.#authenticationRequiredListeners.delete(listener)
  }

  onSessionChanged(listener: (change: SessionChange) => void): () => void {
    this.#sessionChangedListeners.add(listener)
    return () => this.#sessionChangedListeners.delete(listener)
  }

  #invalidateRequests(): void {
    this.#epoch += 1
    this.#refreshInFlight = null
    for (const controller of this.#controllers) controller.abort(sessionChangedError())
    this.#controllers.clear()
  }

  #assertCurrent(epoch: number): void {
    this.session.getSnapshot()
    if (epoch !== this.#epoch) throw sessionChangedError()
  }

  #requireAuthentication(): void {
    this.clearSession()
    for (const listener of this.#authenticationRequiredListeners) listener()
  }

  async #request<T>(path: string, options: RequestOptions = {}, epoch = this.#epoch): Promise<T> {
    const auth = options.auth ?? true
    const bound = options.sessionBound ?? auth
    const requestTokens = auth ? this.session.getTokens() : null
    if (bound) this.#assertCurrent(epoch)
    options.signal?.throwIfAborted()
    const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json')
    if (requestTokens) headers.set('Authorization', `Bearer ${requestTokens.access_token}`)
    const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData
    if (options.body !== undefined && !multipart) headers.set('Content-Type', 'application/json')
    const body: BodyInit | undefined = options.body === undefined ? undefined
      : multipart ? options.body as FormData : JSON.stringify(options.body)
    const controller = new AbortController()
    if (bound) this.#controllers.add(controller)
    const abortFromCaller = () => controller.abort(options.signal?.reason ?? sessionChangedError())
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(new DOMException('The request timed out. Please try again.', 'TimeoutError')), options.timeoutMs ?? this.#requestTimeoutMs)
    let result: { response: Response; value?: T; error?: ApiError }
    try {
      result = await abortable((async () => {
        const response = await this.#fetch(`${this.baseUrl}${path}`, {
          method: options.method ?? 'GET', headers, body,
          credentials: 'same-origin', signal: controller.signal,
        })
        controller.signal.throwIfAborted()
        if (!response.ok) return { response, error: await responseToError(response) }
        if (response.status === 204) return { response }
        if (options.responseType === 'blob') return { response, value: await response.blob() as T }
        const text = await response.text()
        return { response, value: (text.length === 0 ? undefined : JSON.parse(text)) as T }
      })(), controller.signal)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortFromCaller)
      this.#controllers.delete(controller)
    }
    if (bound) this.#assertCurrent(epoch)
    options.signal?.throwIfAborted()
    if (result.response.status === 401 && auth && (options.retryUnauthorized ?? true) && requestTokens) {
      const current = this.session.getSnapshot()
      if (!current.tokens) throw sessionChangedError()
      if (current.tokens.access_token === requestTokens.access_token) await this.#refreshSession(current)
      this.#assertCurrent(epoch)
      options.signal?.throwIfAborted()
      return this.#request<T>(path, { ...options, retryUnauthorized: false }, epoch)
    }
    if (result.response.status === 401 && auth && !options.preserveUnauthorized) this.#requireAuthentication()
    if (result.error) throw result.error
    return result.value as T
  }

  #refreshSession(expected: SessionSnapshot): Promise<Api.Tokens> {
    if (this.#refreshInFlight) return this.#refreshInFlight
    const epoch = this.#epoch
    const controller = new AbortController()
    this.#controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(new DOMException('Session refresh timed out. Please try again.', 'TimeoutError')), this.#requestTimeoutMs)
    const work = this.session.withRefreshLock(controller.signal, async () => {
      this.#assertCurrent(epoch)
      controller.signal.throwIfAborted()
      const current = this.session.getRefreshSnapshot()
      if (!current.tokens || current.generation !== expected.generation) throw sessionChangedError()
      if (current.tokens.refresh_token !== expected.tokens?.refresh_token) return current.tokens
      if (current.refresh?.status === 'pending' || current.refresh?.status === 'uncertain') throw new SessionRecoveryError('refresh_uncertain')
      if (current.refresh?.status === 'cooldown' && current.refresh.retryAt > Date.now()) {
        throw new ApiError({ type: 'about:blank', title: 'Please try again shortly', status: current.refresh.httpStatus,
          detail: 'The session service is temporarily unavailable. Please wait before retrying.', instance: '',
          code: current.refresh.httpStatus === 429 ? 'rate_limited' : 'internal_error' }, undefined, current.refresh.retryAt - Date.now())
      }
      this.session.setRefreshState(current, { status: 'pending' })
      try {
        const tokens = await this.#request<Api.Tokens>('/v1/auth/refresh', {
          method: 'POST', body: { refresh_token: current.tokens.refresh_token },
          auth: false, sessionBound: true, retryUnauthorized: false, signal: controller.signal,
        }, epoch)
        this.#assertCurrent(epoch)
        controller.signal.throwIfAborted()
        if (!isTokens(tokens)) throw new SessionRecoveryError('refresh_uncertain')
        this.session.replaceRefreshedTokens(current, tokens)
        return tokens
      } catch (error) {
        // Never let a completed old request clear/overwrite a newer account.
        this.#assertCurrent(epoch)
        if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
          // Preserve this definitive server error for all refresh waiters while
          // canceling the other requests belonging to the rejected session.
          this.#controllers.delete(controller)
          this.#requireAuthentication()
        } else if (error instanceof ApiError && (error.status === 429 || error.status >= 500)) {
          this.session.setRefreshState(current, { status: 'cooldown', httpStatus: error.status, retryAt: Date.now() + Math.max(error.retryAfterMs ?? 5_000, 1_000) })
        } else {
          // A network loss/timeout can happen after server-side rotation. Do
          // not send this one-time token again, including after tab closure.
          this.session.setRefreshState(current, { status: 'uncertain' })
        }
        throw error
      }
    })
    const promise = abortable(work, controller.signal).finally(() => {
      clearTimeout(timeout)
      this.#controllers.delete(controller)
      if (this.#refreshInFlight === promise) this.#refreshInFlight = null
    })
    this.#refreshInFlight = promise
    return promise
  }

  async #oneTimeRequest<T>(path: string, body: unknown): Promise<T> {
    const epoch = this.#epoch
    const current = this.session.getSnapshot()
    if (current.tokens && Date.parse(current.tokens.expires_at) <= Date.now() + 60_000) await this.#refreshSession(current)
    this.#assertCurrent(epoch)
    return this.#request(path, { method: 'POST', body, retryUnauthorized: false, preserveUnauthorized: true }, epoch)
  }

  async register(input: Api.RegisterRequest): Promise<Api.RegisterResponse> {
    this.#invalidateRequests()
    const epoch = this.#epoch
    const result = await this.#request<Api.RegisterResponse>('/v1/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
      sessionBound: true,
    })
    this.#assertCurrent(epoch)
    if (result.tokens) this.session.setTokens(result.tokens)
    return result
  }

  async login(input: Api.LoginRequest): Promise<Api.LoginResult> {
    this.#invalidateRequests()
    const epoch = this.#epoch
    const result = await this.#request<Api.LoginResult>('/v1/auth/login', {
      method: 'POST',
      body: input,
      auth: false,
      sessionBound: true,
    })
    this.#assertCurrent(epoch)
    if (!result.two_factor_required) this.session.setTokens(result.tokens)
    return result
  }

  async completeTwoFactorLogin(input: Api.TwoFactorLoginRequest): Promise<Api.LoginResponse> {
    this.#invalidateRequests()
    const epoch = this.#epoch
    const result = await this.#request<Api.LoginResponse>('/v1/auth/login/2fa', {
      method: 'POST',
      body: input,
      auth: false,
      sessionBound: true,
    })
    this.#assertCurrent(epoch)
    this.session.setTokens(result.tokens)
    return result
  }

  requestEmailVerification(input: Api.EmailRequest): Promise<Api.EmailVerificationRequestedResponse> {
    return this.#request('/v1/auth/email-verification/request', { method: 'POST', body: input, auth: false })
  }

  confirmEmailVerification(input: Api.TokenRequest): Promise<Api.EmailVerifiedResponse> {
    return this.#request('/v1/auth/email-verification/confirm', { method: 'POST', body: input, auth: false })
  }

  forgotPassword(input: Api.EmailRequest): Promise<Api.PasswordResetRequestedResponse> {
    return this.#request('/v1/auth/password/forgot', { method: 'POST', body: input, auth: false })
  }

  resetPassword(input: Api.PasswordResetRequest): Promise<void> {
    return this.#request('/v1/auth/password/reset', { method: 'POST', body: input, auth: false })
  }

  async refresh(): Promise<Api.Tokens> {
    const current = this.session.getSnapshot()
    if (!current.tokens) throw missingRefreshTokenError()
    return this.#refreshSession(current)
  }

  async logout(): Promise<void> {
    const refreshToken = this.session.getTokens()?.refresh_token
    // Local logout completes before waiting for the network. A later login
    // must not be erased by the completion/failure of this revocation request.
    this.clearSession()
    if (!refreshToken) return
    await this.#request<void>('/v1/auth/logout', {
      method: 'POST', body: { refresh_token: refreshToken }, auth: false, sessionBound: false,
    })
  }

  me(options: ApiRequestOptions = {}): Promise<Api.MeResponse> {
    return this.#request('/v1/me', options)
  }

  updateMe(input: { locale: Api.Locale }): Promise<Api.User> {
    return this.#request('/v1/me', { method: 'PATCH', body: input })
  }

  previewOAuthAuthorization(input: Api.OAuthAuthorizationRequest): Promise<Api.OAuthAuthorizationPreview> {
    return this.#request('/v1/oauth/authorize/preview', { method: 'POST', body: input })
  }

  decideOAuthAuthorization(input: Api.OAuthAuthorizationDecision): Promise<Api.OAuthAuthorizationDecisionResponse> {
    return this.#request('/v1/oauth/authorize', { method: 'POST', body: input })
  }

  async changePassword(input: Api.PasswordChangeRequest): Promise<void> {
    const epoch = this.#epoch
    await this.#request<void>('/v1/auth/password/change', { method: 'POST', body: input })
    this.#assertCurrent(epoch)
    this.clearSession()
  }

  setupTwoFactor(input: Api.PasswordProofRequest): Promise<Api.TwoFactorSetup> {
    return this.#request('/v1/auth/2fa/setup', { method: 'POST', body: input })
  }

  async confirmTwoFactor(input: Api.TOTPCodeRequest): Promise<Api.RecoveryCodesResponse> {
    const epoch = this.#epoch
    const result = await this.#request<Api.RecoveryCodesResponse>('/v1/auth/2fa/confirm', {
      method: 'POST',
      body: input,
    })
    this.#assertCurrent(epoch)
    this.clearSession()
    return result
  }

  async disableTwoFactor(input: Api.TwoFactorProofRequest): Promise<void> {
    const epoch = this.#epoch
    await this.#request<void>('/v1/auth/2fa/disable', { method: 'POST', body: input })
    this.#assertCurrent(epoch)
    this.clearSession()
  }

  regenerateRecoveryCodes(input: Api.TwoFactorProofRequest): Promise<Api.RecoveryCodesResponse> {
    return this.#request('/v1/auth/2fa/recovery-codes/regenerate', { method: 'POST', body: input })
  }

  listRegions(): Promise<Api.ItemList<Api.Region>> {
    return this.#request('/v1/regions', { auth: false })
  }

  listCustomerRegions(): Promise<Api.ItemList<Api.CustomerRegion>> {
    return this.#request('/v1/customer-regions', { auth: false })
  }

  listTenants(options: ApiRequestOptions = {}): Promise<Api.ItemList<Api.Workspace>> {
    return this.#request('/v1/tenants', options)
  }

  getTenant(tenantId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.Workspace> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/`, options)
  }

  updateTenant(tenantId: Api.UUID, input: Api.WorkspacePatch): Promise<Api.Workspace> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/`, { method: 'PATCH', body: input })
  }

  listMembers(tenantId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.ItemList<Api.Membership>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/members`, options)
  }

  listInvitations(tenantId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.ItemList<Api.Invitation>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/invitations`, options)
  }

  updateMember(tenantId: Api.UUID, memberId: Api.UUID, input: Api.MembershipPatch): Promise<Api.Membership> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/members/${encodePath(memberId)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  removeMember(tenantId: Api.UUID, memberId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/members/${encodePath(memberId)}`, {
      method: 'DELETE',
    })
  }

  inviteMember(tenantId: Api.UUID, input: Api.InvitationRequest): Promise<Api.InvitationCreateResponse> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/invitations`, { method: 'POST', body: input })
  }

  acceptInvitation(input: Api.TokenRequest): Promise<Api.Membership> {
    return this.#oneTimeRequest('/v1/invitations/accept', input)
  }

  listMonitors(tenantId: Api.UUID, query?: Api.ListQuery, options: ApiRequestOptions = {}): Promise<Api.Page<Api.Monitor>> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors`, query), options)
  }

  createMonitor(tenantId: Api.UUID, input: Api.MonitorCreateRequest): Promise<Api.MonitorCreateResponse> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitors`, { method: 'POST', body: input })
  }

  getMonitor(tenantId: Api.UUID, monitorId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.Monitor> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}`, options)
  }

  getMonitorDashboard(tenantId: Api.UUID, query?: Api.MonitorDashboardQuery, options: ApiRequestOptions = {}): Promise<Api.MonitorDashboard> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/dashboard`, query), options)
  }

  getMonitorOverview(
    tenantId: Api.UUID,
    monitorId: Api.UUID,
    responseRange: '1h' | '24h' | '7d',
    options: ApiRequestOptions = {},
  ): Promise<Api.MonitorOverview> {
    return this.#request(withQuery(
      `/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/overview`,
      { response_range: responseRange },
    ), options)
  }

  updateMonitor(
    tenantId: Api.UUID,
    monitorId: Api.UUID,
    input: Api.MonitorUpdateRequest,
  ): Promise<Api.Monitor> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteMonitor(tenantId: Api.UUID, monitorId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}`, {
      method: 'DELETE',
    })
  }

  pauseMonitor(tenantId: Api.UUID, monitorId: Api.UUID): Promise<Api.Monitor> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/actions/pause`,
      { method: 'POST' },
    )
  }

  resumeMonitor(tenantId: Api.UUID, monitorId: Api.UUID): Promise<Api.Monitor> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/actions/resume`,
      { method: 'POST' },
    )
  }

  testMonitor(tenantId: Api.UUID, monitorId: Api.UUID, region?: string): Promise<Api.CheckResult> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/actions/test`, { region }),
      { method: 'POST' },
    )
  }

  scanLeakCheckMonitor(tenantId: Api.UUID, monitorId: Api.UUID): Promise<Api.LeakCheckScanResponse> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/actions/scan`,
      { method: 'POST' },
    )
  }

  getWorkspaceEntitlements(tenantId: Api.UUID): Promise<Api.WorkspaceEntitlements> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/entitlements`)
  }

  rotateHeartbeatToken(tenantId: Api.UUID, monitorId: Api.UUID): Promise<Api.HeartbeatTokenResponse> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/heartbeat-token/rotate`,
      { method: 'POST' },
    )
  }

  listMonitorChecks(
    tenantId: Api.UUID,
    monitorId: Api.UUID,
    query?: Api.HistoryQuery,
  ): Promise<Api.Page<Api.CheckResult>> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/checks`, query),
    )
  }

  listChecks(tenantId: Api.UUID, monitorId: Api.UUID, query?: Api.HistoryQuery): Promise<Api.Page<Api.CheckResult>> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/checks`, { ...query, monitor_id: monitorId }),
    )
  }

  getMonitorMetrics(tenantId: Api.UUID, monitorId: Api.UUID, query?: Api.TimeRangeQuery): Promise<Api.UptimeStats> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/metrics`, query),
    )
  }

  getMetricsSummary(tenantId: Api.UUID, query?: Api.MetricsSummaryQuery): Promise<Api.MetricsSummary> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/metrics/summary`, query))
  }

  listCertificateEvidence(
    tenantId: Api.UUID,
    monitorId: Api.UUID,
    query?: Api.HistoryQuery,
  ): Promise<Api.Page<Api.CheckResult>> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/certificates`, query),
    )
  }

  listDnsEvidence(
    tenantId: Api.UUID,
    monitorId: Api.UUID,
    query?: Api.HistoryQuery,
  ): Promise<Api.Page<Api.CheckResult>> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/dns-snapshots`, query),
    )
  }

  listDomainEvidence(
    tenantId: Api.UUID,
    monitorId: Api.UUID,
    query?: Api.HistoryQuery,
  ): Promise<Api.Page<Api.CheckResult>> {
    return this.#request(
      withQuery(`/v1/tenants/${encodePath(tenantId)}/monitors/${encodePath(monitorId)}/domain-snapshots`, query),
    )
  }

  listIncidents(tenantId: Api.UUID, query?: Api.HistoryQuery, options: ApiRequestOptions = {}): Promise<Api.Page<Api.Incident>> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/incidents`, query), options)
  }

  getIncidentSummary(tenantId: Api.UUID, options: ApiRequestOptions = {}): Promise<{ open_count: number; assigned_to_me_count: number }> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/incidents/summary`, options)
  }

  getIncident(tenantId: Api.UUID, incidentId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.IncidentDetail> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}`, options)
  }

  acknowledgeIncident(tenantId: Api.UUID, incidentId: Api.UUID): Promise<Api.Incident> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}/actions/acknowledge`,
      { method: 'POST' },
    )
  }

  assignIncident(tenantId: Api.UUID, incidentId: Api.UUID, userId: Api.UUID): Promise<Api.Incident> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}/actions/assign`,
      { method: 'POST', body: { user_id: userId } },
    )
  }

  resolveIncident(tenantId: Api.UUID, incidentId: Api.UUID): Promise<Api.Incident> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}/actions/resolve`,
      { method: 'POST' },
    )
  }

  listIncidentComments(tenantId: Api.UUID, incidentId: Api.UUID): Promise<Api.ItemList<Api.IncidentUpdate>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}/comments`)
  }

  addIncidentComment(tenantId: Api.UUID, incidentId: Api.UUID, message: string): Promise<Api.IncidentUpdate> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}/comments`, {
      method: 'POST',
      body: { message },
    })
  }

  listMaintenanceWindows(tenantId: Api.UUID): Promise<Api.ItemList<Api.MaintenanceWindow>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/maintenance-windows`)
  }

  createMaintenanceWindow(
    tenantId: Api.UUID,
    input: Api.MaintenanceWindowWrite,
  ): Promise<Api.MaintenanceWindow> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/maintenance-windows`, {
      method: 'POST',
      body: input,
    })
  }

  getMaintenanceWindow(tenantId: Api.UUID, maintenanceId: Api.UUID): Promise<Api.MaintenanceWindow> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/maintenance-windows/${encodePath(maintenanceId)}`)
  }

  updateMaintenanceWindow(
    tenantId: Api.UUID,
    maintenanceId: Api.UUID,
    input: Api.MaintenanceWindowWrite,
  ): Promise<Api.MaintenanceWindow> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/maintenance-windows/${encodePath(maintenanceId)}`, {
      method: 'PUT',
      body: input,
    })
  }

  deleteMaintenanceWindow(tenantId: Api.UUID, maintenanceId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/maintenance-windows/${encodePath(maintenanceId)}`, {
      method: 'DELETE',
    })
  }

  listStatusPages(tenantId: Api.UUID, query?: Api.ListQuery, options: ApiRequestOptions = {}): Promise<Api.Page<Api.StatusPage>> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/status-pages`, query), options)
  }

  getStatusPageDashboard(tenantId: Api.UUID, query?: Api.ListQuery, options: ApiRequestOptions = {}): Promise<Api.StatusPageDashboard> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/status-pages/dashboard`, query), options)
  }

  createStatusPage(tenantId: Api.UUID, input: Api.StatusPageCreateRequest): Promise<Api.StatusPage> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/status-pages`, { method: 'POST', body: input })
  }

  getStatusPage(tenantId: Api.UUID, statusPageId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.StatusPageDetail> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}`, options)
  }

  updateStatusPage(
    tenantId: Api.UUID,
    statusPageId: Api.UUID,
    input: Api.StatusPageUpdateRequest,
  ): Promise<Api.StatusPage> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}`, {
      method: 'PUT',
      body: input,
    })
  }

  deleteStatusPage(tenantId: Api.UUID, statusPageId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}`, {
      method: 'DELETE',
    })
  }

  claimStatusPageCustomDomain(
    tenantId: Api.UUID,
    statusPageId: Api.UUID,
    domain: string,
  ): Promise<Api.CustomDomainClaimResponse> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/custom-domain`,
      { method: 'PUT', body: { domain } },
    )
  }

  verifyStatusPageCustomDomain(tenantId: Api.UUID, statusPageId: Api.UUID): Promise<Api.StatusPage> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/custom-domain/verify`,
      { method: 'POST' },
    )
  }

  listStatusPageComponents(tenantId: Api.UUID, statusPageId: Api.UUID): Promise<Api.ItemList<Api.StatusPageComponent>> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/components`,
    )
  }

  replaceStatusPageComponents(
    tenantId: Api.UUID,
    statusPageId: Api.UUID,
    monitorIds: Api.UUID[],
  ): Promise<Api.StatusPage> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/components`,
      { method: 'PUT', body: { monitor_ids: monitorIds } },
    )
  }

	updateStatusPageComponentReportReasons(
		tenantId: Api.UUID,
		statusPageId: Api.UUID,
		componentId: Api.UUID,
		reasons: string[],
		threshold: number,
	): Promise<Api.StatusPageComponent> {
		return this.#request(
			`/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/components/${encodePath(componentId)}/report-reasons`,
			{ method: 'PUT', body: { reasons, threshold } },
		)
	}

  listAnnouncements(tenantId: Api.UUID, statusPageId: Api.UUID): Promise<Api.ItemList<Api.Announcement>> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/announcements`,
    )
  }

  createAnnouncement(
    tenantId: Api.UUID,
    statusPageId: Api.UUID,
    input: Api.AnnouncementRequest,
  ): Promise<Api.Announcement> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/status-pages/${encodePath(statusPageId)}/announcements`,
      { method: 'POST', body: input },
    )
  }

  getPublicStatusPage(slug: string, password?: string): Promise<Api.PublicStatusSnapshot> {
    return this.#request(`/v1/public/status-pages/${encodePath(slug)}`, {
      auth: false,
      headers: password ? { 'X-Status-Page-Password': password } : undefined,
    })
  }

  accessPublicStatusPage(slug: string, password: string, turnstileToken?: string): Promise<Api.PublicStatusSnapshot> {
    return this.#request(`/v1/public/status-pages/${encodePath(slug)}/access`, {
      method: 'POST',
      body: { password, turnstile_token: turnstileToken },
      auth: false,
    })
  }

  getPublicStatusPageByDomain(customDomain: string, password?: string): Promise<Api.PublicStatusSnapshot> {
    return this.#request(`/v1/public/status-pages/by-domain/${encodePath(customDomain)}`, {
      auth: false,
      headers: password ? { 'X-Status-Page-Password': password } : undefined,
    })
  }

  accessPublicStatusPageByDomain(customDomain: string, password: string, turnstileToken?: string): Promise<Api.PublicStatusSnapshot> {
    return this.#request(`/v1/public/status-pages/by-domain/${encodePath(customDomain)}/access`, {
      method: 'POST',
      body: { password, turnstile_token: turnstileToken },
      auth: false,
    })
  }

	reportPublicStatusProblem(slug: string, componentId: Api.UUID, reasonKey: string, turnstileToken?: string): Promise<Api.ProblemReportAcceptedResponse> {
		return this.#request(`/v1/public/status-pages/${encodePath(slug)}/components/${encodePath(componentId)}/reports`, {
			method: 'POST',
			body: { reason_key: reasonKey, turnstile_token: turnstileToken },
			auth: false,
		})
	}

  previewMonitorSubscription(token: string): Promise<Api.MonitorSubscriptionPreview> {
    return this.#request('/v1/public/monitor-subscription-requests/preview', {
      method: 'POST',
      body: { token },
      auth: false,
    })
  }

  requestMonitorSubscription(token: string, email: string, turnstileToken?: string): Promise<Api.MonitorSubscriptionRequestAccepted> {
    return this.#request('/v1/public/monitor-subscription-requests', {
      method: 'POST',
      body: { token, email, turnstile_token: turnstileToken },
      auth: false,
    })
  }

  acceptMonitorSubscription(tenantId: Api.UUID, token: string): Promise<void> {
    return this.#oneTimeRequest(`/v1/tenants/${encodePath(tenantId)}/monitor-subscriptions`, { token })
  }

  listMonitorSubscriptions(tenantId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.ItemList<Api.MonitorSubscription>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitor-subscriptions`, options)
  }

  getMonitorSubscription(tenantId: Api.UUID, subscriptionId: Api.UUID): Promise<Api.MonitorSubscriptionDetail> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/monitor-subscriptions/${encodePath(subscriptionId)}/detail`,
    )
  }

  listMonitorSubscriptionIncidents(tenantId: Api.UUID, options: ApiRequestOptions = {}): Promise<Api.ItemList<Api.MonitorSubscriptionIncident>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitor-subscription-incidents`, options)
  }

  updateMonitorSubscriptionNotifications(
    tenantId: Api.UUID,
    subscriptionId: Api.UUID,
    input: Api.MonitorSubscriptionNotificationsRequest,
  ): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitor-subscriptions/${encodePath(subscriptionId)}/notifications`, {
      method: 'PUT',
      body: input,
    })
  }

  deleteMonitorSubscription(tenantId: Api.UUID, subscriptionId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/monitor-subscriptions/${encodePath(subscriptionId)}`, {
      method: 'DELETE',
    })
  }

  async registerMonitorSubscriber(input: Api.MonitorSubscriberRegisterRequest): Promise<Api.MonitorSubscriberRegistrationResponse> {
    this.#invalidateRequests()
    const epoch = this.#epoch
    const response = await this.#request<Api.MonitorSubscriberRegistrationResponse>('/v1/public/monitor-subscription-requests/register', {
      method: 'POST',
      body: input,
      auth: false,
      sessionBound: true,
    })
    this.#assertCurrent(epoch)
    this.session.setTokens(response.tokens)
    return response
  }

  subscribeStatusPage(slug: string, email: string): Promise<Api.SubscriptionAcceptedResponse> {
    return this.#request(`/v1/public/status-pages/${encodePath(slug)}/subscribers`, {
      method: 'POST',
      body: { email },
      auth: false,
    })
  }

  confirmStatusPageSubscription(token: string): Promise<void> {
    return this.#request('/v1/public/status-page-subscriptions/confirm', {
      method: 'POST',
      body: { token },
      auth: false,
    })
  }

  unsubscribeStatusPage(token: string): Promise<void> {
    return this.#request('/v1/public/status-page-subscriptions/unsubscribe', {
      method: 'POST',
      body: { token },
      auth: false,
    })
  }

  listIntegrations(tenantId: Api.UUID): Promise<Api.ItemList<Api.Integration>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/integrations`)
  }

  createIntegration(tenantId: Api.UUID, input: Api.IntegrationCreateRequest): Promise<Api.Integration> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/integrations`, { method: 'POST', body: input })
  }

  getIntegration(tenantId: Api.UUID, integrationId: Api.UUID): Promise<Api.Integration> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/integrations/${encodePath(integrationId)}`)
  }

  updateIntegration(
    tenantId: Api.UUID,
    integrationId: Api.UUID,
    input: Api.IntegrationUpdateRequest,
  ): Promise<Api.Integration> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/integrations/${encodePath(integrationId)}`, {
      method: 'PUT',
      body: input,
    })
  }

  deleteIntegration(tenantId: Api.UUID, integrationId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/integrations/${encodePath(integrationId)}`, {
      method: 'DELETE',
    })
  }

  testIntegration(tenantId: Api.UUID, integrationId: Api.UUID): Promise<Api.SentResponse> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/integrations/${encodePath(integrationId)}/actions/test`,
      { method: 'POST' },
    )
  }

  listApiKeys(tenantId: Api.UUID): Promise<Api.ItemList<Api.APIKey>> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/api-keys`)
  }

  createApiKey(tenantId: Api.UUID, input: Api.APIKeyRequest): Promise<Api.APIKeyCreateResponse> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/api-keys`, { method: 'POST', body: input })
  }

  revokeApiKey(tenantId: Api.UUID, apiKeyId: Api.UUID): Promise<void> {
    return this.#request(`/v1/tenants/${encodePath(tenantId)}/api-keys/${encodePath(apiKeyId)}`, {
      method: 'DELETE',
    })
  }

  listAuditLogs(tenantId: Api.UUID, query?: Api.HistoryQuery, options: ApiRequestOptions = {}): Promise<Api.Page<Api.AuditLog>> {
    return this.#request(withQuery(`/v1/tenants/${encodePath(tenantId)}/audit-logs`, query), options)
  }

  listBillingPlans(): Promise<Api.BillingPlanCatalog> {
    return this.#request('/v1/billing/plans')
  }

  getBillingSubscription(): Promise<Api.BillingSubscription> {
    return this.#request('/v1/billing/subscription')
  }

  listBillingInvoices(query?: Api.ListQuery): Promise<Api.Page<Api.Invoice>> {
    return this.#request(withQuery('/v1/billing/invoices', query))
  }

  getBillingInvoice(invoiceId: Api.UUID): Promise<Api.Invoice> {
    return this.#request(`/v1/billing/invoices/${encodePath(invoiceId)}`)
  }

  downloadBillingInvoicePdf(invoiceId: Api.UUID): Promise<Blob> {
    return this.#request(`/v1/billing/invoices/${encodePath(invoiceId)}/pdf`, { responseType: 'blob' })
  }

  downloadComplianceIncidentPdf(tenantId: Api.UUID, incidentId: Api.UUID): Promise<Blob> {
    return this.#request(
      `/v1/tenants/${encodePath(tenantId)}/incidents/${encodePath(incidentId)}/compliance-report.pdf`,
      { responseType: 'blob' },
    )
  }

  emailBillingInvoicePdf(invoiceId: Api.UUID): Promise<{ message: string; recipient: string }> {
    return this.#request(`/v1/billing/invoices/${encodePath(invoiceId)}/actions/email`, { method: 'POST' })
  }

  previewPlanChange(input: { plan_code: string; billing_cycle: Api.BillingCycle }): Promise<Api.PlanChangeQuote> {
    return this.#request('/v1/billing/plan-changes/preview', { method: 'POST', body: input })
  }

  changeBillingPlan(input: { plan_code: string; billing_cycle: Api.BillingCycle; payment_provider?: Api.PaymentProvider }): Promise<Api.PlanChangeResult> {
    return this.#request('/v1/billing/plan-changes', { method: 'POST', body: input })
  }

  listSupportTickets(query?: Api.ListQuery): Promise<Api.Page<Api.SupportTicket>> {
    return this.#request(withQuery('/v1/support/tickets', query))
  }

  getSupportTicketSummary(): Promise<Api.SupportUnreadSummary> {
    return this.#request('/v1/support/tickets/summary')
  }

  createSupportTicket(input: { subject: string; message: string }): Promise<Api.SupportTicketDetail> {
    return this.#request('/v1/support/tickets', { method: 'POST', body: input })
  }

  getSupportTicket(ticketId: Api.UUID): Promise<Api.SupportTicketDetail> {
    return this.#request(`/v1/support/tickets/${encodePath(ticketId)}`)
  }

  markSupportTicketRead(ticketId: Api.UUID, throughMessageId: Api.UUID): Promise<void> {
    return this.#request(`/v1/support/tickets/${encodePath(ticketId)}/read-state`, {
      method: 'PUT',
      body: { through_message_id: throughMessageId },
    })
  }

  replySupportTicket(ticketId: Api.UUID, message: string): Promise<{ ticket: Api.SupportTicket; message: Api.SupportMessage }> {
    return this.#request(`/v1/support/tickets/${encodePath(ticketId)}/messages`, { method: 'POST', body: { message } })
  }

  uploadSupportAttachment(ticketId: Api.UUID, messageId: Api.UUID, file: File): Promise<Api.SupportAttachment> {
    const body = new FormData()
    body.append('file', file)
    return this.#request(`/v1/support/tickets/${encodePath(ticketId)}/messages/${encodePath(messageId)}/attachments`, { method: 'POST', body })
  }

  downloadSupportAttachment(ticketId: Api.UUID, attachmentId: Api.UUID): Promise<Blob> {
    return this.#request(`/v1/support/tickets/${encodePath(ticketId)}/attachments/${encodePath(attachmentId)}`, { responseType: 'blob' })
  }

  adminListUsers(query?: Api.ListQuery): Promise<Api.Page<Api.AdminUser>> {
    return this.#request(withQuery('/v1/admin/users', query))
  }

  adminListProblemReportIPProfiles(search?: string): Promise<Api.ItemList<Api.ProblemReportIPProfile>> {
    return this.#request(withQuery('/v1/admin/problem-report-ip-profiles', { search }))
  }

  adminGetUser(userId: Api.UUID): Promise<Api.AdminUser> {
    return this.#request(`/v1/admin/users/${encodePath(userId)}`)
  }

  adminUpdateUser(userId: Api.UUID, input: Partial<Pick<Api.User, 'name' | 'locale' | 'region_id' | 'timezone' | 'system_role'>> & { email_verified?: boolean; revoke_sessions?: boolean }): Promise<Api.AdminUser> {
    return this.#request(`/v1/admin/users/${encodePath(userId)}`, { method: 'PATCH', body: input })
  }

  adminUpdateWorkspace(workspaceId: Api.UUID, input: { name?: string; timezone?: string; plan?: string }): Promise<Api.Workspace> {
    return this.#request(`/v1/admin/workspaces/${encodePath(workspaceId)}`, { method: 'PATCH', body: input })
  }

  async adminImpersonate(input: { user_id: Api.UUID; workspace_id: Api.UUID; reason: string }): Promise<Api.Tokens> {
    const result = await this.#request<{ tokens: Api.Tokens }>('/v1/admin/impersonations', { method: 'POST', body: input })
    return result.tokens
  }

  adminListPlans(): Promise<Api.ItemList<Api.Plan>> {
    return this.#request('/v1/admin/plans')
  }

  adminListRegions(): Promise<Api.ItemList<Api.CustomerRegion>> {
    return this.#request('/v1/admin/regions')
  }

  adminCreateRegion(region: Omit<Api.CustomerRegion, 'id' | 'created_at' | 'updated_at'>): Promise<Api.CustomerRegion> {
    return this.#request('/v1/admin/regions', { method: 'POST', body: region })
  }

  adminUpdateRegion(region: Api.CustomerRegion): Promise<Api.CustomerRegion> {
    return this.#request(`/v1/admin/regions/${encodePath(region.id)}`, { method: 'PATCH', body: region })
  }

  adminListCheckLocations(): Promise<Api.ItemList<Api.CheckLocation>> {
    return this.#request('/v1/admin/check-locations')
  }

  adminCreateCheckLocation(input: Api.CheckLocationCreateInput): Promise<Api.CheckLocation> {
    return this.#request('/v1/admin/check-locations', { method: 'POST', body: input })
  }

  adminUpdateCheckLocation(locationId: Api.UUID, input: Api.CheckLocationUpdateInput): Promise<Api.CheckLocation> {
    const body = { ...input }
    if (body.key?.trim()) body.key = body.key.trim()
    else delete body.key
    return this.#request(`/v1/admin/check-locations/${encodePath(locationId)}`, { method: 'PATCH', body })
  }

  adminCreatePlan(plan: Omit<Api.Plan, 'id' | 'created_at' | 'updated_at' | 'region_id'> & { region_id: Api.UUID }): Promise<Api.Plan> {
    return this.#request('/v1/admin/plans', { method: 'POST', body: plan })
  }

  adminUpdatePlan(plan: Api.Plan): Promise<Api.Plan> {
    return this.#request(`/v1/admin/plans/${encodePath(plan.id)}`, { method: 'PATCH', body: plan })
  }

  adminDeletePlan(planId: Api.UUID): Promise<void> {
    return this.#request(`/v1/admin/plans/${encodePath(planId)}`, { method: 'DELETE' })
  }

  adminGetBillingSettings(): Promise<Api.BillingSettings> {
    return this.#request('/v1/admin/billing/settings')
  }

  adminUpdateBillingSettings(input: Partial<Pick<Api.BillingSettings, 'annual_discount_percent' | 'invoice_issuer'>>): Promise<Api.BillingSettings> {
    return this.#request('/v1/admin/billing/settings', { method: 'PATCH', body: input })
  }

  adminListInvoices(query?: Api.ListQuery): Promise<Api.Page<Api.Invoice>> {
    return this.#request(withQuery('/v1/admin/invoices', query))
  }

  adminListBillingWorkspaces(query?: Api.ListQuery): Promise<Api.Page<Api.AdminBillingWorkspace>> {
    return this.#request(withQuery('/v1/admin/billing/workspaces', query))
  }

  adminGetInvoice(invoiceId: Api.UUID): Promise<Api.Invoice> {
    return this.#request(`/v1/admin/invoices/${encodePath(invoiceId)}`)
  }

  adminDownloadInvoicePdf(invoiceId: Api.UUID): Promise<Blob> {
    return this.#request(`/v1/admin/invoices/${encodePath(invoiceId)}/pdf`, { responseType: 'blob' })
  }

  adminEmailInvoicePdf(invoiceId: Api.UUID): Promise<{ message: string; recipient: string }> {
    return this.#request(`/v1/admin/invoices/${encodePath(invoiceId)}/actions/email`, { method: 'POST' })
  }

  adminMarkInvoicePaid(invoiceId: Api.UUID, input: { paid_at?: Api.ISODateTime; note?: string } = {}): Promise<Api.Invoice> {
    return this.#request(`/v1/admin/invoices/${encodePath(invoiceId)}/actions/paid`, { method: 'POST', body: input })
  }

  adminVoidInvoice(invoiceId: Api.UUID, input: { note?: string } = {}): Promise<Api.Invoice> {
    return this.#request(`/v1/admin/invoices/${encodePath(invoiceId)}/actions/void`, { method: 'POST', body: input })
  }

  adminGetWorkspacePaymentSettings(workspaceId: Api.UUID): Promise<Api.WorkspacePaymentSettings> {
    return this.#request(`/v1/admin/workspaces/${encodePath(workspaceId)}/payment-settings`)
  }

  adminUpdateWorkspacePaymentSettings(workspaceId: Api.UUID, input: Pick<Api.WorkspacePaymentSettings, 'keepz_allowed' | 'cloudpayments_allowed'>): Promise<Api.WorkspacePaymentSettings> {
    return this.#request(`/v1/admin/workspaces/${encodePath(workspaceId)}/payment-settings`, { method: 'PATCH', body: input })
  }

  adminListTickets(query?: Api.ListQuery): Promise<Api.Page<Api.SupportTicket>> {
    return this.#request(withQuery('/v1/admin/tickets', query))
  }

  adminGetSupportTicketSummary(): Promise<Api.SupportUnreadSummary> {
    return this.#request('/v1/admin/tickets/summary')
  }

  adminGetTicket(ticketId: Api.UUID): Promise<Api.SupportTicketDetail> {
    return this.#request(`/v1/admin/tickets/${encodePath(ticketId)}`)
  }

  adminMarkSupportTicketRead(ticketId: Api.UUID, throughMessageId: Api.UUID): Promise<void> {
    return this.#request(`/v1/admin/tickets/${encodePath(ticketId)}/read-state`, {
      method: 'PUT',
      body: { through_message_id: throughMessageId },
    })
  }

  adminUpdateTicket(ticketId: Api.UUID, input: { assigned_to?: Api.UUID; status: Api.SupportTicketStatus; priority: Api.SupportTicketPriority }): Promise<Api.SupportTicket> {
    return this.#request(`/v1/admin/tickets/${encodePath(ticketId)}`, { method: 'PATCH', body: input })
  }

  adminReplyTicket(ticketId: Api.UUID, input: { message: string; internal: boolean }): Promise<{ ticket: Api.SupportTicket; message: Api.SupportMessage }> {
    return this.#request(`/v1/admin/tickets/${encodePath(ticketId)}/messages`, { method: 'POST', body: input })
  }

  adminUploadSupportAttachment(ticketId: Api.UUID, messageId: Api.UUID, file: File): Promise<Api.SupportAttachment> {
    const body = new FormData()
    body.append('file', file)
    return this.#request(`/v1/admin/tickets/${encodePath(ticketId)}/messages/${encodePath(messageId)}/attachments`, { method: 'POST', body })
  }

  adminDownloadSupportAttachment(ticketId: Api.UUID, attachmentId: Api.UUID): Promise<Blob> {
    return this.#request(`/v1/admin/tickets/${encodePath(ticketId)}/attachments/${encodePath(attachmentId)}`, { responseType: 'blob' })
  }

  adminListNotificationChannels(): Promise<Api.ItemList<Api.SupportNotificationChannel>> {
    return this.#request('/v1/admin/notification-channels')
  }

  adminCreateNotificationChannel(input: { name: string; type: Api.SupportNotificationChannel['type']; config: Api.JsonObject }): Promise<Api.SupportNotificationChannel> {
    return this.#request('/v1/admin/notification-channels', { method: 'POST', body: input })
  }

  adminUpdateNotificationChannel(channelId: Api.UUID, input: { name: string; active: boolean; config?: Api.JsonObject }): Promise<Api.SupportNotificationChannel> {
    return this.#request(`/v1/admin/notification-channels/${encodePath(channelId)}`, { method: 'PATCH', body: input })
  }

  adminDeleteNotificationChannel(channelId: Api.UUID): Promise<void> {
    return this.#request(`/v1/admin/notification-channels/${encodePath(channelId)}`, { method: 'DELETE' })
  }

  adminTestNotificationChannel(channelId: Api.UUID): Promise<void> {
    return this.#request(`/v1/admin/notification-channels/${encodePath(channelId)}/actions/test`, { method: 'POST' })
  }
}
