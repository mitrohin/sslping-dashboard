import { describe, expect, it } from 'vitest'
import {
  demoApiKeys,
  demoDashboard,
  demoIncidents,
  demoIntegrationCatalog,
  demoIntegrations,
  demoMaintenanceWindows,
  demoMonitorList,
  demoMonitors,
  demoResponseTimeSeries,
  demoStatusPages,
  demoTeamMembers,
  demoUptimeBars,
  demoUptimeBarsByMonitor,
} from './demo'
import type { DemoStateSet, MonitorStatus } from './models'

const expectUniqueIds = (items: readonly { id: string }[]): void => {
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
}

describe('demo monitor data', () => {
  it('has stable unique identifiers and complete 24-hour bars', () => {
    expectUniqueIds(demoMonitors)
    expect(demoMonitors.length).toBeGreaterThanOrEqual(8)

    for (const monitor of demoMonitors) {
      expect(monitor.last24Hours).toHaveLength(30)
      expectUniqueIds(monitor.last24Hours)
      expect(monitor.regions.length).toBeGreaterThan(0)
      expect(demoUptimeBarsByMonitor[monitor.id]).toBe(monitor.last24Hours)
    }

    expect(demoUptimeBars).toBe(demoMonitors[0].last24Hours)
  })

  it('keeps summary counts synchronized with monitor statuses', () => {
    const count = (status: MonitorStatus): number =>
      demoMonitors.filter((monitor) => monitor.status === status).length

    expect(demoMonitorList.summary.total).toBe(demoMonitors.length)
    expect(demoMonitorList.summary.up).toBe(count('up'))
    expect(demoMonitorList.summary.down).toBe(count('down'))
    expect(demoMonitorList.summary.degraded).toBe(count('degraded'))
    expect(demoMonitorList.summary.paused).toBe(count('paused'))
    expect(demoMonitorList.summary.pending).toBe(count('pending'))
  })

  it('provides realistic response-time series with exact aggregates', () => {
    expect(demoResponseTimeSeries.length).toBeGreaterThanOrEqual(3)

    for (const series of demoResponseTimeSeries) {
      const values = series.points.map((point) => point.valueMs)
      expect(series.points).toHaveLength(48)
      expect(series.minimumMs).toBe(Math.min(...values))
      expect(series.maximumMs).toBe(Math.max(...values))
      expect(series.averageMs).toBe(
        Math.round(values.reduce((total, value) => total + value, 0) / values.length),
      )
    }
  })
})

describe('demo screen collections', () => {
  it('uses unique identifiers in every entity collection', () => {
    ;[
      demoIncidents,
      demoStatusPages,
      demoMaintenanceWindows,
      demoTeamMembers,
      demoIntegrations,
      demoApiKeys,
    ].forEach(expectUniqueIds)
  })

  it('references monitors that exist', () => {
    const monitorIds = new Set(demoMonitors.map((monitor) => monitor.id))
    for (const incident of demoIncidents) expect(monitorIds.has(incident.monitorId)).toBe(true)
    for (const window of demoMaintenanceWindows) {
      window.monitorIds.forEach((monitorId) => expect(monitorIds.has(monitorId)).toBe(true))
    }
  })

  it('contains every configured integration in the catalog', () => {
    const availableTypes = new Set(demoIntegrationCatalog.map((integration) => integration.type))
    demoIntegrations.forEach((integration) => {
      expect(availableTypes.has(integration.type)).toBe(true)
    })
  })

  it('does not embed usable credentials or webhook destinations', () => {
    const serialized = JSON.stringify({ demoApiKeys, demoIntegrations })
    expect(serialized).not.toContain('hooks.slack.com')
    expect(serialized).not.toContain('api.telegram.org')
    expect(serialized).not.toMatch(/sp_live_[A-Za-z0-9]{20,}/)
    demoApiKeys.forEach((key) => expect(key.prefix).toContain('…'))
  })
})

describe('demo visual states', () => {
  it('exposes loading, empty, and filled variants for every list screen', () => {
    const screens: readonly DemoStateSet<unknown>[] = [
      demoDashboard.monitors,
      demoDashboard.incidents,
      demoDashboard.statusPages,
      demoDashboard.maintenance,
      demoDashboard.team,
      demoDashboard.integrations,
      demoDashboard.apiKeys,
      demoDashboard.responseTime,
      demoDashboard.uptimeBars,
    ]

    for (const states of screens) {
      expect(states.loading.kind).toBe('loading')
      expect(states.loading.data).toBeNull()
      expect(states.empty.kind).toBe('empty')
      expect(states.filled.kind).toBe('filled')
    }
  })
})
