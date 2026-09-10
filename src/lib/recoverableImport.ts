export const UPDATE_REQUIRED_EVENT = 'sslping:update-required'

let updateRequired = false
const updateListeners = new Set<() => void>()

export function getUpdateRequired() { return updateRequired }

export function subscribeToUpdateRequired(listener: () => void) {
  updateListeners.add(listener)
  return () => { updateListeners.delete(listener) }
}

function requireUpdate() {
  // Initial route imports can fail before React commits the notice's listener.
  // Retain the state so mounting later still offers an explicit recovery action.
  updateRequired = true
  for (const listener of updateListeners) listener()
  window.dispatchEvent(new Event(UPDATE_REQUIRED_EVENT))
}

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .* failed|unable to preload css/i.test(error.message)
}

// A missing chunk after deployment must not tear down a mounted form. Keep the
// Suspense boundary pending while the user can navigate back or choose reload.
export async function recoverableImport<T>(load: () => Promise<T>): Promise<T> {
  try { return await load() } catch (error) {
    if (!isChunkLoadError(error)) throw error
    requireUpdate()
    return new Promise<T>(() => {})
  }
}
