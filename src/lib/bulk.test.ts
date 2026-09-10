import { expect, it } from 'vitest'
import { runBulk } from './bulk'
import { workspaceCapabilities } from './capabilities'

it('bounds concurrency and preserves failures alongside successes', async () => {
  let active = 0
  let peak = 0
  const outcomes = await runBulk(Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Monitor ${i}` })), async (row) => {
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    if (row.id === '3') throw new Error('Rate limited')
  }, 3)
  expect(peak).toBe(3)
  expect(outcomes).toHaveLength(12)
  expect(outcomes.filter((outcome) => outcome.error)).toEqual([{ id: '3', name: 'Monitor 3', error: 'Rate limited' }])
})

it('fails closed for unknown roles and separates operations from administration', () => {
  expect(workspaceCapabilities(null).edit).toBe(false)
  expect(workspaceCapabilities('viewer').edit).toBe(false)
  expect(workspaceCapabilities('notifier').edit).toBe(false)
  expect(workspaceCapabilities('editor')).toEqual({ edit: true, administer: false })
  expect(workspaceCapabilities('owner')).toEqual({ edit: true, administer: true })
})
