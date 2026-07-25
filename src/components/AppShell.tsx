import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  BookOpenCheck,
  ChevronLeft,
  CircleGauge,
  CreditCard,
  LifeBuoy,
  LogOut,
  Mail,
  Menu,
  RadioTower,
  ShieldAlert,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { Button, IconButton, Modal } from './ui'
import { useAuth } from '../app/AuthProvider'
import { endDemoSession, isDemoSession } from '../app/DashboardGate'

const navItems = [
  { to: '/monitors', label: 'Monitoring', icon: CircleGauge },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/status-pages', label: 'Status pages', icon: RadioTower },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/team', label: 'Team members', icon: Users },
  { to: '/integrations', label: 'Integrations & API', icon: Activity },
]

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <NavLink to="/monitors" className={`brand ${compact ? 'brand--compact' : ''}`}>
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
  const { user, workspace, authenticated, logout } = useAuth()
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
  const salesSubject = encodeURIComponent(`SSLPing plan enquiry — ${workspace?.name || 'workspace'}`)

  const openSupportRoute = (path: string) => {
    setSupportOpen(false)
    setMobileOpen(false)
    navigate(path)
  }

  const signOut = async () => {
    endDemoSession()
    if (authenticated) await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
      <header className="mobile-header">
        <Brand />
        <IconButton label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </IconButton>
      </header>

      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__top">
          <Brand compact={collapsed} />
          <IconButton className="sidebar__mobile-close" label="Close navigation" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </IconButton>
        </div>
        <nav className="sidebar__nav" aria-label="Primary">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon size={21} strokeWidth={1.8} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
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
          {!collapsed && <button className="upgrade-button" type="button" onClick={() => setUpgradeOpen(true)}>Upgrade workspace</button>}
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
        <Outlet />
      </main>

      <button className="support-button" type="button" aria-label="Open help and diagnostics" onClick={() => setSupportOpen(true)}>
        <LifeBuoy size={23} />
      </button>

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
        <p className="shell-dialog-notice">This panel does not create a support ticket. It is safe to close at any time.</p>
        <div className="shell-dialog-actions">
          <Button variant="secondary" onClick={() => setSupportOpen(false)}>Close</Button>
        </div>
      </Modal>

      <Modal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Workspace plans"
        icon={<Sparkles size={31} />}
        width="lg"
      >
        <section className="current-plan" aria-label="Current plan">
          <span><CreditCard size={20} /> Current plan</span>
          <strong>{planLabel}</strong>
        </section>
        <div className="plan-options">
          <article>
            <span>For independent projects</span>
            <h3>Starter</h3>
            <ul>
              <li>1-minute monitoring intervals</li>
              <li>Multiple alert integrations</li>
              <li>Public status pages</li>
            </ul>
          </article>
          <article className="plan-options__featured">
            <span>For production teams</span>
            <h3>Business</h3>
            <ul>
              <li>30-second monitoring intervals</li>
              <li>Advanced roles and audit history</li>
              <li>Priority incident workflows</li>
            </ul>
          </article>
        </div>
        <p className="shell-dialog-notice">Online billing is not connected yet. Contacting sales opens your email client; no plan change or charge is made from this dashboard.</p>
        <div className="shell-dialog-actions">
          <Button variant="secondary" onClick={() => setUpgradeOpen(false)}>Keep current plan</Button>
          <a className="button button--primary button--md" href={`mailto:?subject=${salesSubject}`}>
            <Mail size={18} /> Prepare enquiry
          </a>
        </div>
      </Modal>
    </div>
  )
}
