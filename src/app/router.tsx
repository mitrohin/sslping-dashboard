import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PageLoadingSkeleton } from '../components/ui'
import {
  AcceptInvitationController,
  EmailVerificationController,
  ForgotPasswordController,
  LoginController,
  RegisterController,
  ResetPasswordController,
  TwoFactorController,
} from '../features/auth/AuthFlows'
import { DashboardGate, DemoEntry } from './DashboardGate'
import { GuestOnly, RequireSystemAdmin, RequireWorkspaceAccess } from './AuthProvider'
import { demoPublicStatusApi } from './demoPublicStatus'
import { useI18n } from './I18nProvider'

const LiveMonitorsPage = lazy(() => import('../features/monitors/LiveMonitorRoutes').then((module) => ({ default: module.LiveMonitorsPage })))
const LiveMonitorDetailPage = lazy(() => import('../features/monitors/LiveMonitorRoutes').then((module) => ({ default: module.LiveMonitorDetailPage })))
const LiveMonitorEditPage = lazy(() => import('../features/monitors/LiveMonitorRoutes').then((module) => ({ default: module.LiveMonitorEditPage })))
const PublicStatusPageRoute = lazy(() => import('../features/public-status/PublicStatusPage').then((module) => ({ default: module.PublicStatusPageRoute })))
const LiveIncidentsPage = lazy(() => import('./LiveOperations').then((module) => ({ default: module.LiveIncidentsPage })))
const LiveMaintenancePage = lazy(() => import('./LiveOperations').then((module) => ({ default: module.LiveMaintenancePage })))
const LiveStatusPagesPage = lazy(() => import('./LiveOperations').then((module) => ({ default: module.LiveStatusPagesPage })))
const LiveStatusPageEditorPage = lazy(() => import('./LiveOperations').then((module) => ({ default: module.LiveStatusPageEditorPage })))
const LiveIntegrationsPage = lazy(() => import('./LiveAccount').then((module) => ({ default: module.LiveIntegrationsPage })))
const LiveTeamPage = lazy(() => import('./LiveAccount').then((module) => ({ default: module.LiveTeamPage })))
const SupportPage = lazy(() => import('../features/support/SupportPage').then((module) => ({ default: module.SupportPage })))
const AdminConsolePage = lazy(() => import('../features/admin/AdminConsolePage').then((module) => ({ default: module.AdminConsolePage })))

function RouteSuspense({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <Suspense fallback={<div className="page page--wide"><PageLoadingSkeleton label={t('app.loadingWorkspace')} /></div>}>
      {children}
    </Suspense>
  )
}

function NotFoundPage() {
  const { t } = useI18n()
  return (
    <main className="not-found">
      <span>404</span>
      <h1>{t('app.notFoundTitle')}<span className="title-dot">.</span></h1>
      <p>{t('app.notFoundHint')}</p>
      <a className="button button--primary" href="/monitors">{t('app.returnMonitoring')}</a>
    </main>
  )
}

function PublicStatusRoute() {
  return <RouteSuspense><PublicStatusPageRoute api={import.meta.env.DEV ? demoPublicStatusApi : undefined} /></RouteSuspense>
}

const workspaceChildren = [
  { path: 'monitors', element: <RouteSuspense><LiveMonitorsPage /></RouteSuspense> },
  { path: 'monitors/:monitorId', element: <RouteSuspense><LiveMonitorDetailPage /></RouteSuspense> },
  { path: 'monitors/:monitorId/edit', element: <RouteSuspense><LiveMonitorEditPage /></RouteSuspense> },
  { path: 'incidents', element: <RouteSuspense><LiveIncidentsPage /></RouteSuspense> },
  { path: 'status-pages', element: <RouteSuspense><LiveStatusPagesPage /></RouteSuspense> },
  { path: 'status-pages/:statusPageId/edit', element: <RouteSuspense><LiveStatusPageEditorPage /></RouteSuspense> },
  { path: 'maintenance', element: <RouteSuspense><LiveMaintenancePage /></RouteSuspense> },
  { path: 'team', element: <RouteSuspense><LiveTeamPage /></RouteSuspense> },
  { path: 'integrations', element: <RouteSuspense><LiveIntegrationsPage /></RouteSuspense> },
  { path: 'support', element: <RouteSuspense><SupportPage /></RouteSuspense> },
]

const dashboardChildren = [
  { index: true, element: <Navigate to="/monitors" replace /> },
  { element: <RequireWorkspaceAccess />, children: workspaceChildren },
  { element: <RequireSystemAdmin />, children: [{ path: 'admin', element: <RouteSuspense><AdminConsolePage /></RouteSuspense> }] },
]

export const router = createBrowserRouter([
  { path: '/demo', element: <DemoEntry /> },
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginController /> },
      { path: '/register', element: <RegisterController /> },
      { path: '/forgot-password', element: <ForgotPasswordController /> },
    ],
  },
  { path: '/login/2fa', element: <TwoFactorController /> },
  { path: '/verify-email', element: <EmailVerificationController /> },
  { path: '/reset-password', element: <ResetPasswordController /> },
  { path: '/accept-invite', element: <AcceptInvitationController /> },
  { path: '/status/:slug', element: <PublicStatusRoute /> },
  {
    path: '/',
    element: <DashboardGate />,
    children: [{ element: <AppShell />, children: dashboardChildren }],
  },
  { path: '*', element: <NotFoundPage /> },
])
