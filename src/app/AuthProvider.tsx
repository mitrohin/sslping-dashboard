import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ApiClient, ApiError } from '../api/client'
import type {
  EmailVerificationRequestedResponse,
  LoginRequest,
  PasswordChangeRequest,
  PasswordResetRequestedResponse,
  RegisterRequest,
  User,
  UUID,
  Workspace,
} from '../api/types'

export interface TwoFactorChallenge {
  token: string
  expiresAt: string
  user: User
  targetTenantId?: UUID
}

export type LoginOutcome =
  | { status: 'authenticated' }
  | { status: 'two_factor_required'; challenge: TwoFactorChallenge }
  | { status: 'email_verification_required'; email: string }

export type RegisterOutcome =
  | { status: 'authenticated' }
  | { status: 'email_verification_required'; email: string; verificationToken?: string }

export interface AuthContextValue {
  api: ApiClient
  user: User | null
  workspace: Workspace | null
  tenant: Workspace | null
  tenants: Workspace[]
  authenticated: boolean
  loading: boolean
  twoFactorChallenge: TwoFactorChallenge | null
  emailVerificationRequired: boolean
  pendingVerificationEmail: string | null
  restorationError: Error | null
  login: (input: LoginRequest) => Promise<LoginOutcome>
  register: (input: RegisterRequest) => Promise<RegisterOutcome>
  complete2FA: (code: string) => Promise<void>
  forgot: (email: string) => Promise<PasswordResetRequestedResponse>
  logout: () => Promise<void>
  changePassword: (input: PasswordChangeRequest) => Promise<void>
  changeWorkspace: (tenantId: UUID, password: string) => Promise<LoginOutcome>
  requestEmailVerification: (email?: string) => Promise<EmailVerificationRequestedResponse>
  confirmEmailVerification: (token: string) => Promise<User>
}

export interface AuthProviderProps {
  children: ReactNode
  api?: ApiClient
}

const defaultApi = new ApiClient()
const AuthContext = createContext<AuthContextValue | null>(null)

function isUnverifiedEmailError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    /email(?: address)? must be verified|verify your email/i.test(error.problem.detail)
  )
}

export function AuthProvider({ children, api = defaultApi }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tenants, setTenants] = useState<Workspace[]>([])
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<TwoFactorChallenge | null>(null)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)
  const [restorationError, setRestorationError] = useState<Error | null>(null)

  const clearIdentity = useCallback(() => {
    setUser(null)
    setWorkspace(null)
    setTenants([])
    setAuthenticated(false)
    setTwoFactorChallenge(null)
  }, [])

  const hydrateIdentity = useCallback(async () => {
    const identity = await api.me()
    const activeWorkspace = identity.tenants.find((item) => item.id === identity.active_tenant_id) ?? null
    setUser(identity.user)
    setTenants(identity.tenants)
    setWorkspace(activeWorkspace)
    setAuthenticated(true)
    setTwoFactorChallenge(null)
    setPendingVerificationEmail(null)
    setRestorationError(null)
    return identity
  }, [api])

  useEffect(() => {
    let cancelled = false

    const restore = async () => {
      if (!api.tokens) {
        if (!cancelled) setLoading(false)
        return
      }

      try {
        const identity = await api.me()
        if (cancelled) return
        const activeWorkspace = identity.tenants.find((item) => item.id === identity.active_tenant_id) ?? null
        setUser(identity.user)
        setTenants(identity.tenants)
        setWorkspace(activeWorkspace)
        setAuthenticated(true)
        setRestorationError(null)
      } catch (error) {
        if (cancelled) return
        clearIdentity()
        setRestorationError(error instanceof Error ? error : new Error('Unable to restore the session.'))
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) api.clearSession()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [api, clearIdentity])

  const startLogin = useCallback(
    async (input: LoginRequest, preserveCurrentIdentity: boolean): Promise<LoginOutcome> => {
      if (!preserveCurrentIdentity) {
        api.clearSession()
        clearIdentity()
      }
      setPendingVerificationEmail(null)

      try {
        const result = await api.login(input)
        if (result.two_factor_required) {
          const challenge: TwoFactorChallenge = {
            token: result.challenge_token,
            expiresAt: result.challenge_expires_at,
            user: result.user,
            targetTenantId: input.tenant_id,
          }
          setTwoFactorChallenge(challenge)
          if (!preserveCurrentIdentity) setUser(result.user)
          return { status: 'two_factor_required', challenge }
        }

        await hydrateIdentity()
        return { status: 'authenticated' }
      } catch (error) {
        if (isUnverifiedEmailError(error)) {
          setPendingVerificationEmail(input.email)
          if (!preserveCurrentIdentity) clearIdentity()
          return { status: 'email_verification_required', email: input.email }
        }
        throw error
      }
    },
    [api, clearIdentity, hydrateIdentity],
  )

  const login = useCallback(
    (input: LoginRequest) => startLogin(input, false),
    [startLogin],
  )

  const register = useCallback(
    async (input: RegisterRequest): Promise<RegisterOutcome> => {
      api.clearSession()
      clearIdentity()
      setPendingVerificationEmail(null)
      const result = await api.register(input)

      if (result.tokens) {
        await hydrateIdentity()
        return { status: 'authenticated' }
      }

      setUser(result.user)
      setWorkspace(result.tenant)
      setTenants([result.tenant])
      setPendingVerificationEmail(result.user.email)
      return {
        status: 'email_verification_required',
        email: result.user.email,
        verificationToken: result.verification_token,
      }
    },
    [api, clearIdentity, hydrateIdentity],
  )

  const complete2FA = useCallback(
    async (code: string) => {
      if (!twoFactorChallenge) throw new Error('No two-factor login is pending.')
      if (Date.parse(twoFactorChallenge.expiresAt) <= Date.now()) {
        setTwoFactorChallenge(null)
        throw new Error('The two-factor challenge has expired. Please sign in again.')
      }

      await api.completeTwoFactorLogin({ challenge_token: twoFactorChallenge.token, code })
      await hydrateIdentity()
    },
    [api, hydrateIdentity, twoFactorChallenge],
  )

  const forgot = useCallback(
    (email: string) => api.forgotPassword({ email }),
    [api],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      clearIdentity()
      setPendingVerificationEmail(null)
      setRestorationError(null)
    }
  }, [api, clearIdentity])

  const changePassword = useCallback(
    async (input: PasswordChangeRequest) => {
      await api.changePassword(input)
      clearIdentity()
    },
    [api, clearIdentity],
  )

  const changeWorkspace = useCallback(
    async (tenantId: UUID, password: string): Promise<LoginOutcome> => {
      if (!user) throw new Error('You must be signed in to change workspace.')
      if (workspace?.id === tenantId) return { status: 'authenticated' }
      if (!tenants.some((item) => item.id === tenantId)) throw new Error('Workspace is not available to this account.')

      return startLogin({ email: user.email, password, tenant_id: tenantId }, true)
    },
    [startLogin, tenants, user, workspace?.id],
  )

  const requestEmailVerification = useCallback(
    (email?: string) => {
      const address = email ?? pendingVerificationEmail ?? user?.email
      if (!address) throw new Error('An email address is required.')
      return api.requestEmailVerification({ email: address })
    },
    [api, pendingVerificationEmail, user?.email],
  )

  const confirmEmailVerification = useCallback(
    async (token: string) => {
      const result = await api.confirmEmailVerification({ token })
      setUser(result.user)
      setPendingVerificationEmail(null)
      return result.user
    },
    [api],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      api,
      user,
      workspace,
      tenant: workspace,
      tenants,
      authenticated,
      loading,
      twoFactorChallenge,
      emailVerificationRequired: pendingVerificationEmail !== null,
      pendingVerificationEmail,
      restorationError,
      login,
      register,
      complete2FA,
      forgot,
      logout,
      changePassword,
      changeWorkspace,
      requestEmailVerification,
      confirmEmailVerification,
    }),
    [
      api,
      authenticated,
      changePassword,
      changeWorkspace,
      complete2FA,
      confirmEmailVerification,
      forgot,
      loading,
      login,
      logout,
      pendingVerificationEmail,
      register,
      requestEmailVerification,
      restorationError,
      tenants,
      twoFactorChallenge,
      user,
      workspace,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}

export function RequireAuth() {
  const { authenticated, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  return authenticated ? <Outlet /> : <Navigate to="/login" replace state={{ from: location }} />
}

export function GuestOnly() {
  const { authenticated, loading } = useAuth()
  if (loading) return null
  return authenticated ? <Navigate to="/" replace /> : <Outlet />
}
