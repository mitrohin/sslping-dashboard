import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  Activity,
  BookOpenCheck,
  ChevronLeft,
  CircleGauge,
  CreditCard,
  LifeBuoy,
  LogOut,
  Menu,
  RadioTower,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { Button, IconButton, Modal } from './ui'
import { useAuth } from '../app/AuthProvider'
import { endDemoSession, isDemoSession } from '../app/DashboardGate'
import { clearAdministratorSessionBackup, restoreAdministratorSession } from '../app/impersonation'
import { SUPPORT_UNREAD_REFRESH_EVENT } from '../features/support/unread'
import { WorkspaceBillingModal } from '../features/billing/WorkspaceBillingModal'
import { LanguageSelect, useI18n } from '../app/I18nProvider'
import { INCIDENT_ASSIGNMENT_REFRESH_EVENT } from '../features/operations/events'
import type { BillingPlan } from '../api/types'
import { OPEN_BILLING_EVENT } from '../features/billing/events'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const navItems = [
  { to: '/monitors', labelKey: 'nav.monitoring', icon: CircleGauge },
  { to: '/incidents', labelKey: 'nav.incidents', icon: ShieldAlert },
  { to: '/checker-ips', labelKey: 'nav.checkerIPs', icon: ShieldCheck },
  { to: '/status-pages', labelKey: 'nav.statusPages', icon: RadioTower },
  { to: '/maintenance', labelKey: 'nav.maintenance', icon: Wrench },
  { to: '/team', labelKey: 'nav.team', icon: Users },
  { to: '/integrations', labelKey: 'nav.integrations', icon: Activity },
  { to: '/support', labelKey: 'nav.support', icon: LifeBuoy },
]

export function Brand({ compact = false, to = '/monitors' }: { compact?: boolean; to?: string }) {
  return (
    <NavLink to={to} className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__pulse"><span /></span>
      {!compact && <span>SSLPing</span>}
    </NavLink>
  )
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [supportUnread, setSupportUnread] = useState(0)
  const [adminUnread, setAdminUnread] = useState(0)
  const [assignedIncidentCount, setAssignedIncidentCount] = useState(0)
  const [activeBillingPlan, setActiveBillingPlan] = useState<BillingPlan>()
  const { api, user, workspace, workspaceRole, authenticated, logout, impersonation } = useAuth()
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const demo = !authenticated && isDemoSession()
  const displayName = user?.name || (demo ? 'Alex Morgan' : 'SSLPing user')
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const currentPlan = workspace?.plan || (demo ? 'demo' : 'free')
  const planLabel = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1).replaceAll('_', ' ')
  const isSystemAdministrator = user?.system_role === 'superadmin' && !impersonation
  const isAccountant = user?.system_role === 'accountant' && !impersonation
  const isManagedCatalog = currentPlan === 'public-catalog'
  const canManageBilling = authenticated && !demo && !impersonation && !isAccountant && !isManagedCatalog && (workspaceRole === 'owner' || workspaceRole === 'admin')
  const freePlan = activeBillingPlan ? activeBillingPlan.price_monthly_cents === 0 : currentPlan === 'free'
  const premiumPlan = activeBillingPlan?.limits.allow_manual_tests === true
  const billingButtonLabel = freePlan ? t('shell.plansBilling') : activeBillingPlan?.name || planLabel
  const adminNavigation = { to: '/admin', labelKey: isAccountant ? 'nav.billingAdmin' : 'nav.admin', icon: Shield }
  const availableNavItems = isAccountant ? [adminNavigation] : isSystemAdministrator ? [...navItems, adminNavigation] : navItems

  const refreshSupportUnread = useCallback(async () => {
    if (!authenticated || demo) {
      setSupportUnread(0)
      setAdminUnread(0)
      setAssignedIncidentCount(0)
      return
    }

    const [customerResult, adminResult, incidentsResult] = await Promise.allSettled([
      isAccountant ? Promise.resolve(null) : api.getSupportTicketSummary(),
      isSystemAdministrator ? api.adminGetSupportTicketSummary() : Promise.resolve(null),
      !isAccountant && workspace?.id ? api.listIncidents(workspace.id, { limit: 100 }) : Promise.resolve(null),
    ])
    if (customerResult.status === 'fulfilled') setSupportUnread(customerResult.value?.unread_tickets ?? 0)
    if (adminResult.status === 'fulfilled') setAdminUnread(adminResult.value?.unread_tickets ?? 0)
    if (incidentsResult.status === 'fulfilled') {
      const items = incidentsResult.value?.items ?? []
      setAssignedIncidentCount(items.filter((incident) => incident.status !== 'resolved' && incident.assigned_to === user?.id).length)
    }
  }, [api, authenticated, demo, isAccountant, isSystemAdministrator, workspace?.id])

  useEffect(() => {
    void refreshSupportUnread()
    const timer = window.setInterval(() => void refreshSupportUnread(), 30_000)
    const refresh = () => void refreshSupportUnread()
    window.addEventListener('focus', refresh)
    window.addEventListener(SUPPORT_UNREAD_REFRESH_EVENT, refresh)
    window.addEventListener(INCIDENT_ASSIGNMENT_REFRESH_EVENT, refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(SUPPORT_UNREAD_REFRESH_EVENT, refresh)
      window.removeEventListener(INCIDENT_ASSIGNMENT_REFRESH_EVENT, refresh)
    }
  }, [location.pathname, refreshSupportUnread])

  const refreshActiveBillingPlan = useCallback(async () => {
    if (!canManageBilling) {
      setActiveBillingPlan(undefined)
      return
    }
    try {
      const catalog = await api.listBillingPlans()
      setActiveBillingPlan(catalog.items.find((plan) => plan.code === currentPlan))
    } catch {
      setActiveBillingPlan(undefined)
    }
  }, [api, canManageBilling, currentPlan])

  useEffect(() => {
    void refreshActiveBillingPlan()
  }, [refreshActiveBillingPlan])

  useEffect(() => {
    if (!canManageBilling) return
    const openBilling = () => setUpgradeOpen(true)
    window.addEventListener(OPEN_BILLING_EVENT, openBilling)
    return () => window.removeEventListener(OPEN_BILLING_EVENT, openBilling)
  }, [canManageBilling])

  const openSupportRoute = (path: string) => {
    setSupportOpen(false)
    setMobileOpen(false)
    navigate(path)
  }

  const signOut = async () => {
    endDemoSession()
    clearAdministratorSessionBackup()
    if (authenticated) await logout()
    navigate('/login', { replace: true })
  }

  const leaveImpersonation = () => {
    if (restoreAdministratorSession(api)) window.location.assign('/admin')
  }

  return (
    <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
      <header className="mobile-header">
        <Brand to={isAccountant ? '/admin' : '/monitors'} />
        <IconButton label={t('shell.openNavigation')} onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </IconButton>
      </header>

      {mobileOpen && <button className="sidebar-backdrop" aria-label={t('shell.closeNavigation')} onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__top">
          <Brand compact={collapsed} to={isAccountant ? '/admin' : '/monitors'} />
          <IconButton className="sidebar__mobile-close" label={t('shell.closeNavigation')} onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </IconButton>
        </div>
        <nav className="sidebar__nav" aria-label={t('shell.primary')}>
          {availableNavItems.map(({ to, labelKey, icon: Icon }) => {
            const label = t(labelKey)
            const unread = to === '/support' ? supportUnread : to === '/admin' ? adminUnread : to === '/incidents' ? assignedIncidentCount : 0
            const unreadLabel = unread > 0 ? `${label}, ${unread} unread` : label
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''} ${unread > 0 ? 'has-unread' : ''}`}
                title={collapsed ? unreadLabel : undefined}
                aria-label={unreadLabel}
              >
                <Icon size={21} strokeWidth={1.8} />
                {!collapsed && <span className="nav-item__label">{label}</span>}
                {unread > 0 && <b className="nav-item__unread" aria-hidden="true">{unread > 99 ? '99+' : unread}</b>}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar__footer">
          <WorkspaceSwitcher onSwitched={() => setMobileOpen(false)} />
          <div className="user-card">
            <div className="avatar">{initials}<span>.</span></div>
            {!collapsed && (
              <div className="user-card__identity">
                <strong>{displayName}</strong>
                <span>{demo ? t('shell.demoWorkspace') : workspace?.name || t('shell.owner')}</span>
              </div>
            )}
            {!collapsed && (
              <button className="user-card__logout" type="button" onClick={() => void signOut()} aria-label={t('shell.signOut')} title={t('shell.signOut')}>
                <LogOut size={18} />
              </button>
            )}
          </div>
          <LanguageSelect showIcon className="sidebar-language-select" />
          {canManageBilling && (
            <button
              className={`upgrade-button ${premiumPlan ? 'upgrade-button--premium' : ''}`}
              type="button"
              onClick={() => setUpgradeOpen(true)}
              aria-label={freePlan ? t('shell.plansBilling') : `${billingButtonLabel} · ${t('shell.plansBilling')}`}
              title={collapsed ? billingButtonLabel : undefined}
            >
              <CreditCard size={21} />
              <span>{billingButtonLabel}</span>
            </button>
          )}
          <button
            className="collapse-button"
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t('shell.expand') : t('shell.collapse')}
            title={collapsed ? t('shell.expand') : t('shell.collapse')}
          >
            <ChevronLeft size={17} />
            {!collapsed && <span>{t('shell.collapse')}</span>}
          </button>
        </div>
      </aside>

      <main className="app-main">
        {impersonation && (
          <div className="impersonation-banner" role="status">
            <Shield size={18} />
            <span>{t('shell.supportSession', { name: displayName })} · {impersonation.reason}</span>
            <button type="button" onClick={leaveImpersonation}>{t('shell.returnAdmin')}</button>
          </div>
        )}
        <Outlet />
      </main>

      {!isAccountant && <button className="support-button" type="button" aria-label={locale === 'en' ? 'Open help and diagnostics' : t('shell.help')} onClick={() => setSupportOpen(true)}>
        <LifeBuoy size={23} />
      </button>}

      <Modal
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        title={t('shell.help')}
        icon={<LifeBuoy size={31} />}
      >
        <div className="shell-dialog-copy">
          <p>{t('shell.helpIntro')}</p>
        </div>
        <div className="support-shortcuts" aria-label="Support shortcuts">
          <button type="button" onClick={() => openSupportRoute('/incidents')}>
            <ShieldAlert size={21} />
            <span><strong>{t('shell.reviewIncidents')}</strong><small>{t('shell.reviewIncidentsHint')}</small></span>
          </button>
          <button type="button" onClick={() => openSupportRoute('/integrations')}>
            <BookOpenCheck size={21} />
            <span><strong>{t('shell.checkIntegrations')}</strong><small>{t('shell.checkIntegrationsHint')}</small></span>
          </button>
          <button type="button" onClick={() => openSupportRoute('/maintenance')}>
            <Wrench size={21} />
            <span><strong>{t('shell.reviewMaintenance')}</strong><small>{t('shell.reviewMaintenanceHint')}</small></span>
          </button>
          <button type="button" onClick={() => openSupportRoute('/support')}>
            <LifeBuoy size={21} />
            <span><strong>{t('shell.contactSupport')}</strong><small>{t('shell.contactSupportHint')}</small></span>
          </button>
        </div>
        <section className="diagnostic-summary" aria-labelledby="diagnostic-summary-title">
          <div>
            <h3 id="diagnostic-summary-title">{t('shell.diagnosticSummary')}</h3>
            <span className="diagnostic-summary__scope">{t('shell.localOnly')}</span>
          </div>
          <dl>
            <div><dt>{t('shell.workspace')}</dt><dd>{workspace?.name || (demo ? t('shell.demoWorkspace') : '—')}</dd></div>
            <div><dt>{t('shell.plan')}</dt><dd>{planLabel}</dd></div>
            <div><dt>{t('shell.session')}</dt><dd>{demo ? 'Demo' : authenticated ? t('shell.authenticated') : t('shell.guest')}</dd></div>
            <div><dt>{t('shell.currentPage')}</dt><dd>{location.pathname}</dd></div>
          </dl>
        </section>
        <p className="shell-dialog-notice">{t('shell.privacyNotice')}</p>
        <div className="shell-dialog-actions">
          <Button variant="secondary" onClick={() => setSupportOpen(false)}>{t('shell.close')}</Button>
        </div>
      </Modal>

      {canManageBilling && <WorkspaceBillingModal open={upgradeOpen} onClose={() => { setUpgradeOpen(false); void refreshActiveBillingPlan() }} />}
    </div>
  )
}
