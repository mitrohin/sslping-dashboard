import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  BookOpenCheck,
  ChevronLeft,
  CircleGauge,
  LifeBuoy,
  LogOut,
  Menu,
  RadioTower,
  Shield,
  ShieldAlert,
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

const navItems = [
  { to: '/monitors', label: 'Monitoring', icon: CircleGauge },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/status-pages', label: 'Status pages', icon: RadioTower },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/team', label: 'Team members', icon: Users },
  { to: '/integrations', label: 'Integrations & API', icon: Activity },
  { to: '/support', label: 'Support tickets', icon: LifeBuoy },
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
  const { api, user, workspace, workspaceRole, authenticated, logout, impersonation } = useAuth()
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
  const canManageBilling = authenticated && !demo && !impersonation && !isAccountant && (workspaceRole === 'owner' || workspaceRole === 'admin')
  const adminNavigation = { to: '/admin', label: isAccountant ? 'Billing administration' : 'System administration', icon: Shield }
  const availableNavItems = isAccountant ? [adminNavigation] : isSystemAdministrator ? [...navItems, adminNavigation] : navItems

  const refreshSupportUnread = useCallback(async () => {
    if (!authenticated || demo) {
      setSupportUnread(0)
      setAdminUnread(0)
      return
    }

    const [customerResult, adminResult] = await Promise.allSettled([
      isAccountant ? Promise.resolve(null) : api.getSupportTicketSummary(),
      isSystemAdministrator ? api.adminGetSupportTicketSummary() : Promise.resolve(null),
    ])
    if (customerResult.status === 'fulfilled') setSupportUnread(customerResult.value?.unread_tickets ?? 0)
    if (adminResult.status === 'fulfilled') setAdminUnread(adminResult.value?.unread_tickets ?? 0)
  }, [api, authenticated, demo, isAccountant, isSystemAdministrator, workspace?.id])

  useEffect(() => {
    void refreshSupportUnread()
    const timer = window.setInterval(() => void refreshSupportUnread(), 30_000)
    const refresh = () => void refreshSupportUnread()
    window.addEventListener('focus', refresh)
    window.addEventListener(SUPPORT_UNREAD_REFRESH_EVENT, refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(SUPPORT_UNREAD_REFRESH_EVENT, refresh)
    }
  }, [location.pathname, refreshSupportUnread])

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
        <IconButton label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </IconButton>
      </header>

      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__top">
          <Brand compact={collapsed} to={isAccountant ? '/admin' : '/monitors'} />
          <IconButton className="sidebar__mobile-close" label="Close navigation" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </IconButton>
        </div>
        <nav className="sidebar__nav" aria-label="Primary">
          {availableNavItems.map(({ to, label, icon: Icon }) => {
            const unread = to === '/support' ? supportUnread : to === '/admin' ? adminUnread : 0
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
          <div className="user-card">
            <div className="avatar">{initials}<span>.</span></div>
            {!collapsed && (
              <div className="user-card__identity">
                <strong>{displayName}</strong>
                <span>{demo ? 'Demo workspace' : workspace?.name || 'Owner'}</span>
              </div>
            )}
            {!collapsed && (
              <button className="user-card__logout" type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
                <LogOut size={18} />
              </button>
            )}
          </div>
          {!collapsed && canManageBilling && <button className="upgrade-button" type="button" onClick={() => setUpgradeOpen(true)}>Plans & billing</button>}
          <button
            className="collapse-button"
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={17} />
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        </div>
      </aside>

      <main className="app-main">
        {impersonation && (
          <div className="impersonation-banner" role="status">
            <Shield size={18} />
            <span>Support session: acting as <strong>{displayName}</strong> · {impersonation.reason}</span>
            <button type="button" onClick={leaveImpersonation}>Return to administration</button>
          </div>
        )}
        <Outlet />
      </main>

      {!isAccountant && <button className="support-button" type="button" aria-label="Open help and diagnostics" onClick={() => setSupportOpen(true)}>
        <LifeBuoy size={23} />
      </button>}

      <Modal
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        title="Help & diagnostics"
        icon={<LifeBuoy size={31} />}
      >
        <div className="shell-dialog-copy">
          <p>Use these local shortcuts to investigate a problem without sending any account data.</p>
        </div>
        <div className="support-shortcuts" aria-label="Support shortcuts">
          <button type="button" onClick={() => openSupportRoute('/incidents')}>
            <ShieldAlert size={21} />
            <span><strong>Review recent incidents</strong><small>Inspect failures, causes, and resolution times.</small></span>
          </button>
          <button type="button" onClick={() => openSupportRoute('/integrations')}>
            <BookOpenCheck size={21} />
            <span><strong>Check integrations & API</strong><small>Review alert delivery and API access.</small></span>
          </button>
          <button type="button" onClick={() => openSupportRoute('/maintenance')}>
            <Wrench size={21} />
            <span><strong>Review maintenance</strong><small>Confirm that planned work is configured correctly.</small></span>
          </button>
          <button type="button" onClick={() => openSupportRoute('/support')}>
            <LifeBuoy size={21} />
            <span><strong>Contact SSLPing support</strong><small>Create a ticket or continue an existing conversation.</small></span>
          </button>
        </div>
        <section className="diagnostic-summary" aria-labelledby="diagnostic-summary-title">
          <div>
            <h3 id="diagnostic-summary-title">Local diagnostic summary</h3>
            <span className="diagnostic-summary__scope">Local only</span>
          </div>
          <dl>
            <div><dt>Workspace</dt><dd>{workspace?.name || (demo ? 'Demo workspace' : 'Not selected')}</dd></div>
            <div><dt>Plan</dt><dd>{planLabel}</dd></div>
            <div><dt>Session</dt><dd>{demo ? 'Demo' : authenticated ? 'Authenticated' : 'Guest'}</dd></div>
            <div><dt>Current page</dt><dd>{location.pathname}</dd></div>
          </dl>
        </section>
        <p className="shell-dialog-notice">Account data is shared with support only when you explicitly create a ticket.</p>
        <div className="shell-dialog-actions">
          <Button variant="secondary" onClick={() => setSupportOpen(false)}>Close</Button>
        </div>
      </Modal>

      {canManageBilling && <WorkspaceBillingModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />}
    </div>
  )
}
