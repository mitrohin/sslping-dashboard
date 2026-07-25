import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Activity,
  BellRing,
  ChevronLeft,
  CircleGauge,
  LifeBuoy,
  Menu,
  RadioTower,
  ShieldAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { IconButton } from './ui'
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
  const { user, workspace, authenticated, logout } = useAuth()
  const navigate = useNavigate()
  const demo = !authenticated && isDemoSession()
  const displayName = user?.name || (demo ? 'Alex Morgan' : 'SSLPing user')
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

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
            {!collapsed && <button className="user-card__logout" type="button" onClick={() => void signOut()} title="Sign out"><BellRing size={18} /></button>}
          </div>
          {!collapsed && <button className="upgrade-button">Upgrade workspace</button>}
          <button className="collapse-button" onClick={() => setCollapsed(!collapsed)}>
            <ChevronLeft size={17} />
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>

      <button className="support-button" aria-label="Open support chat">
        <LifeBuoy size={23} />
      </button>
    </div>
  )
}
