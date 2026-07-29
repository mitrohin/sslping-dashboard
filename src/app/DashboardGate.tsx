import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './AuthProvider'
import { useI18n } from './I18nProvider'

const demoStorageKey = 'sslping.dashboard.demo'

export const demoModeAvailable = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true'

export function isDemoSession(): boolean {
  return demoModeAvailable && window.sessionStorage.getItem(demoStorageKey) === 'true'
}

export function endDemoSession(): void {
  window.sessionStorage.removeItem(demoStorageKey)
}

export function DemoEntry() {
  useEffect(() => {
    if (demoModeAvailable) window.sessionStorage.setItem(demoStorageKey, 'true')
  }, [])

  return <Navigate to={demoModeAvailable ? '/monitors' : '/login'} replace />
}

export function DashboardGate() {
  const { authenticated, loading } = useAuth()
  const { t } = useI18n()
  const location = useLocation()

  if (loading) {
    return (
      <main className="preparing" aria-live="polite">
        <div className="preparing__mark">S<span>.</span></div>
        <div><p>SSLPing</p><h1>{t('app.restoring')}</h1></div>
      </main>
    )
  }

  if (authenticated || isDemoSession()) return <Outlet />
  return <Navigate to="/login" replace state={{ from: location }} />
}
