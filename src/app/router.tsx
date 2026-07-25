import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import {
  EmailVerificationController,
  ForgotPasswordController,
  LoginController,
  RegisterController,
  TwoFactorController,
} from '../features/auth/AuthFlows'
import { DashboardGate, DemoEntry } from './DashboardGate'
import { GuestOnly } from './AuthProvider'
import { demoPublicStatusApi } from './demoPublicStatus'

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

function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="route-loading" role="status"><span className="spinner" /> Loading workspace…</div>}>
      {children}
    </Suspense>
  )
}

function NotFoundPage() {
  return (
    <main className="not-found">
      <span>404</span>
      <h1>This page is off the radar<span className="title-dot">.</span></h1>
      <p>The page may have moved, or the monitor link is no longer available.</p>
      <a className="button button--primary" href="/monitors">Return to monitoring</a>
    </main>
  )
}

function PublicStatusRoute() {
  return <RouteSuspense><PublicStatusPageRoute api={import.meta.env.DEV ? demoPublicStatusApi : undefined} /></RouteSuspense>
}

const dashboardChildren = [
  { index: true, element: <Navigate to="/monitors" replace /> },
  { path: 'monitors', element: <RouteSuspense><LiveMonitorsPage /></RouteSuspense> },
  { path: 'monitors/:monitorId', element: <RouteSuspense><LiveMonitorDetailPage /></RouteSuspense> },
  { path: 'monitors/:monitorId/edit', element: <RouteSuspense><LiveMonitorEditPage /></RouteSuspense> },
  { path: 'incidents', element: <RouteSuspense><LiveIncidentsPage /></RouteSuspense> },
  { path: 'status-pages', element: <RouteSuspense><LiveStatusPagesPage /></RouteSuspense> },
  { path: 'status-pages/:statusPageId/edit', element: <RouteSuspense><LiveStatusPageEditorPage /></RouteSuspense> },
  { path: 'maintenance', element: <RouteSuspense><LiveMaintenancePage /></RouteSuspense> },
  { path: 'team', element: <RouteSuspense><LiveTeamPage /></RouteSuspense> },
  { path: 'integrations', element: <RouteSuspense><LiveIntegrationsPage /></RouteSuspense> },
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
  { path: '/status/:slug', element: <PublicStatusRoute /> },
  {
    path: '/',
    element: <DashboardGate />,
    children: [{ element: <AppShell />, children: dashboardChildren }],
  },
  { path: '*', element: <NotFoundPage /> },
])
