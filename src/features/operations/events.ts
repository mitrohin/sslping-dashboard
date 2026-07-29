export const INCIDENT_ASSIGNMENT_REFRESH_EVENT = 'sslping:incident-assignment-refresh'

export function notifyIncidentAssignmentChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INCIDENT_ASSIGNMENT_REFRESH_EVENT))
}
