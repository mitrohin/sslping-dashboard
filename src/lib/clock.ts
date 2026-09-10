export const DEMO_NOW = '2026-07-25T13:00:00.000Z'

/** A single reference time for the dated demonstration dataset. */
export function presentationNow(): number {
  try {
    const demoAvailable = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true'
    if (demoAvailable && window.sessionStorage.getItem('sslping.dashboard.demo') === 'true') return Date.parse(DEMO_NOW)
  } catch { /* Storage may be unavailable in a restricted browser. */ }
  return Date.now()
}
