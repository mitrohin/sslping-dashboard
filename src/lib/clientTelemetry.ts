import { onCLS, onINP, onLCP } from 'web-vitals'

type EventName = 'LCP' | 'INP' | 'CLS' | 'render_error' | 'chunk_error'
type Surface = 'dashboard' | 'marketing'
const names = new Set<EventName>(['LCP', 'INP', 'CLS', 'render_error', 'chunk_error'])

// Only five bounded measurements leave the browser. Never send URLs, IDs,
// form contents, exception text, stack traces, or authentication credentials.
export function createClientEventSender(endpoint: string, surface: Surface, mobile: boolean, send: typeof fetch = fetch) {
  let remaining = 10
  const sent = new Set<EventName>()
  return (name: EventName, value: number) => {
    if (!names.has(name) || !Number.isFinite(value) || value < 0 || remaining === 0 || sent.has(name)) return
    sent.add(name)
    remaining--
    const measured = name.endsWith('_error') ? 1 : value
    try {
      void send(endpoint, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value: measured, device: mobile ? 'mobile' : 'desktop', surface }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => { /* Reporting must never interrupt the application. */ })
    } catch { /* A browser may disable network access or AbortSignal.timeout. */ }
  }
}

let started = false
export function startClientTelemetry(surface: Surface) {
  if (started || !import.meta.env.PROD || import.meta.env.VITE_CLIENT_TELEMETRY === 'false') return
  // Local previews and embedded customer pages do not report production metrics.
  if (!/^(?:[a-z0-9-]+\.)?sslping\.(?:io|[a-z]{2}|com\.au|co\.uk)$/.test(location.hostname)) return
  started = true
  const base = (import.meta.env.VITE_API_URL || 'https://api.sslping.io').replace(/\/+$/, '')
  const report = createClientEventSender(`${base}/v1/client-events`, surface, matchMedia('(max-width: 767px)').matches)
  onLCP(({ value }) => report('LCP', value))
  onINP(({ value }) => report('INP', value))
  onCLS(({ value }) => report('CLS', value))
  window.addEventListener('sslping:update-required', () => report('chunk_error', 1))
  window.addEventListener('sslping:client-event', (event) => {
    const detail = (event as CustomEvent).detail
    if (detail?.name === 'render_error' || detail?.name === 'chunk_error') report(detail.name, 1)
  })
}
