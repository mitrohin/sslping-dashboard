import { ApiError, type PublicStatusSnapshot } from '../api'
import { DEMO_NOW, demoIncidents, demoMonitors, demoStatusPages } from '../data'
import type { PublicStatusApi } from '../features/public-status'

const missingPage = () => new ApiError({
  type: 'about:blank',
  title: 'Status page not found',
  status: 404,
  detail: 'This status page does not exist.',
  instance: '',
  code: 'not_found',
})

export const demoPublicStatusApi: PublicStatusApi = {
  async getPublicStatusPage(slug, password) {
    const page = demoStatusPages.find((item) => item.slug === slug)
    if (!page) throw missingPage()
    const locked = page.accessLevel === 'password' && !password

    const snapshot: PublicStatusSnapshot = {
      page: {
        name: page.name,
        slug: page.slug,
        homepage_url: 'https://sslping.example',
        language: 'en',
        robots: 'noindex,nofollow',
        branding: { accent_color: '#266f52' },
        settings: {
          show_bar_charts: true,
          show_uptime_percentage: true,
          show_overall_percentage: true,
          show_outage_details: true,
          enable_details_page: true,
          show_monitor_url: false,
          hide_paused_monitors: true,
          enable_subscribe: true,
          show_latest_downtime: true,
          small_cookie_dialog: true,
          share_analytics: false,
        },
      },
      password_protected: page.accessLevel === 'password',
      overall_status: demoMonitors.some((monitor) => monitor.status === 'down') ? 'degraded' : 'up',
      components: locked ? null : demoMonitors.slice(0, page.monitorCount).map((monitor) => ({
        name: monitor.name,
        status: monitor.status,
        uptime_24h: monitor.uptime24h,
        last_checked_at: monitor.lastCheckedAt,
      })),
      announcements: locked ? null : demoIncidents.slice(0, 3).map((incident) => ({
        id: incident.id,
        title: incident.rootCause,
        body: `${incident.monitorName}: our team is ${incident.status === 'resolved' ? 'confirming normal operation' : 'actively investigating'}.`,
        status: incident.status,
        published_at: incident.startedAt,
        resolved_at: incident.resolvedAt,
      })),
      generated_at: DEMO_NOW,
    }
    return snapshot
  },
  async subscribeStatusPage() {
    return { message: 'If the address can be subscribed, a confirmation email has been sent.' }
  },
}
