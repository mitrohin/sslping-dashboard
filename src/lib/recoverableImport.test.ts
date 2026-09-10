import { describe, expect, it, vi } from 'vitest'
import { recoverableImport, UPDATE_REQUIRED_EVENT } from './recoverableImport'

describe('deployment chunk recovery', () => {
  it('delivers a successfully loaded route normally', async () => {
    const route = { default: () => null }
    expect(await recoverableImport(async () => route)).toBe(route)
  })
  it('keeps an obsolete chunk pending and notifies the user without reloading', async () => {
    const notice = vi.fn()
    window.addEventListener(UPDATE_REQUIRED_EVENT, notice)
    let settled = false
    void recoverableImport(async () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/old.js') }).then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notice).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    window.removeEventListener(UPDATE_REQUIRED_EVENT, notice)
  })
  it('does not disguise application bugs as an update', async () => {
    const failure = new Error('Invalid application state')
    await expect(recoverableImport(async () => { throw failure })).rejects.toBe(failure)
  })
})
