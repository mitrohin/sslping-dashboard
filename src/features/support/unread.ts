export const SUPPORT_UNREAD_REFRESH_EVENT = 'sslping:support-unread-refresh'

export function requestSupportUnreadRefresh() {
  window.dispatchEvent(new Event(SUPPORT_UNREAD_REFRESH_EVENT))
}
