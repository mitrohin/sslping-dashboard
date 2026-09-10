/** A deterministic Web Locks stand-in for jsdom, which does not implement it. */
export function createTestLockManager(): Pick<LockManager, 'request'> {
  const queues = new Map<string, Promise<unknown>>()
  return {
    request: ((name: string, options: LockOptions | LockGrantedCallback, callback?: LockGrantedCallback) => {
      const settings = typeof options === 'function' ? {} : options
      const action = typeof options === 'function' ? options : callback!
      const previous = queues.get(name) ?? Promise.resolve()
      const task = previous.catch(() => undefined).then(() => {
        settings.signal?.throwIfAborted()
        return action({ name, mode: 'exclusive' } as Lock)
      })
      queues.set(name, task)
      return task.finally(() => { if (queues.get(name) === task) queues.delete(name) })
    }) as LockManager['request'],
  }
}
