// Local Vite QA entry, excluded from the production entry graph. All form results are in-memory.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthProvider } from '../src/app/AuthProvider'
import { I18nProvider } from '../src/app/I18nProvider'
import { AuthPage } from '../src/features/auth/AuthPage'
import { PublicStatusPage, type PublicStatusApi } from '../src/features/public-status/PublicStatusPage'
import type { PublicStatusSnapshot, StatusPageLanguage } from '../src/api'
import '../src/styles.css'
import '../src/features/public-status/public-status.css'

const query = new URLSearchParams(location.search)
const language = (['en', 'ru', 'tr', 'ar'].includes(query.get('lang') ?? '') ? query.get('lang') : 'en') as StatusPageLanguage
const snapshot: PublicStatusSnapshot = {
  page: { name: 'Local QA fixture', slug: 'local-qa', language, country_code: language === 'tr' ? 'TR' : language === 'ar' ? 'AE' : 'GB', monitoring_source: 'public_catalog', robots: 'noindex,nofollow', monitor_follow_enabled: false,
    settings: { show_bar_charts: false, show_response_time: false, show_uptime_percentage: false, show_overall_percentage: false, show_outage_details: false, enable_details_page: false, show_monitor_url: false, hide_paused_monitors: true, enable_subscribe: false, show_latest_downtime: false, small_cookie_dialog: false, share_analytics: false } },
  password_protected: false, overall_status: 'pending', generated_at: new Date().toISOString(), announcements: [],
  components: [{ id: 'local-only', name: 'Example website', status: 'pending', observation_stale: true, last_checked_at: new Date(Date.now() - 3600_000).toISOString(), check_regions: ['eu-west', 'ap-southeast'] }],
}
const api: PublicStatusApi = {
  getPublicStatusPage: async () => snapshot,
  accessPublicStatusPage: async () => snapshot,
  subscribeStatusPage: async () => ({ message: 'Local fixture only; no message sent.' }),
}
function AuthFixture() {
  const [feedback, setFeedback] = useState('')
  return <AuthProvider><I18nProvider><AuthPage mode="forgot" error={query.get('feedback') === 'error' ? feedback : undefined} success={query.get('feedback') === 'error' ? undefined : feedback} onSubmit={() => setFeedback(query.get('feedback') === 'error' ? 'Local QA: please try again.' : 'Local QA: success; no email was sent.')} /></I18nProvider></AuthProvider>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/local-qa']}><Routes><Route path="/:slug" element={query.get('view') === 'auth' ? <AuthFixture /> : <PublicStatusPage api={api} />} /></Routes></MemoryRouter>)
