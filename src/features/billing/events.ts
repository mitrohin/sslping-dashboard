export const OPEN_BILLING_EVENT = 'sslping:open-billing'

export function openWorkspaceBilling() {
  window.dispatchEvent(new CustomEvent(OPEN_BILLING_EVENT))
}
