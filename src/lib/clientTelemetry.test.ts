import { describe, expect, it, vi } from 'vitest'
import { createClientEventSender } from './clientTelemetry'

describe('anonymous client measurements', () => {
  it('sends only allowed fields, excludes credentials/referrer and bounds duplicates', () => {
    const network = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const report = createClientEventSender('/v1/client-events', 'dashboard', true, network)
    report('INP', 214)
    report('INP', 1000)
    report('CLS', Number.NaN)
    report('LCP', -1)
    report('render_error', 400)
    expect(network).toHaveBeenCalledTimes(2)
    const options = network.mock.calls[0][1]
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true })
    expect(JSON.parse(options.body)).toEqual({ name: 'INP', value: 214, device: 'mobile', surface: 'dashboard' })
    expect(JSON.parse(network.mock.calls[1][1].body).value).toBe(1)
  })
  it('does not throw or retry when delivery fails', async () => {
    const network = vi.fn().mockRejectedValue(new Error('offline'))
    const report = createClientEventSender('/v1/client-events', 'marketing', false, network)
    expect(() => report('LCP', 1300)).not.toThrow()
    await Promise.resolve()
    report('LCP', 1400)
    expect(network).toHaveBeenCalledTimes(1)
  })
})
