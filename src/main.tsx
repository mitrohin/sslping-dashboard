import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { AuthProvider } from './app/AuthProvider'
import { I18nProvider } from './app/I18nProvider'
import { router } from './app/router'
import { AppErrorBoundary, ApplicationUpdateNotice } from './components/AppErrorBoundary'
import './styles.css'
// Public status HTML is server-rendered with the stable /assets/app.css link.
// Its first paint must not wait for the lazy route's JavaScript or stylesheet.
import './features/public-status/public-status.css'
import { startClientTelemetry } from './lib/clientTelemetry'

startClientTelemetry('dashboard')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
    <ApplicationUpdateNotice />
    <AuthProvider>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
