import { describe, expect, it } from 'vitest'
import type { Monitor } from '../../api/types'
import { defaultMonitorDraft, type MonitorDraft } from './MonitorForm'
import {
  monitorDraftToCreateRequest,
  monitorDraftToUpdateRequest,
  monitorToDraft,
  toResponseTimeSeries,
  toResponseTimeSeriesFromHistory,
} from './monitorData'

function draft(overrides: Partial<MonitorDraft>): MonitorDraft {
  return { ...defaultMonitorDraft, name: 'Production check', ...overrides }
}

describe('monitor request conversion', () => {
  it('maps HTTP and keyword settings to the backend config', () => {
    const http = monitorDraftToCreateRequest(draft({
      type: 'http',
      target: 'https://example.com/health',
      method: 'POST',
      followRedirects: false,
      allowedStatusClasses: [2, 3],
      allowedStatusCodes: [404, 429],
      checkSSLErrors: false,
      sslReminders: false,
      domainReminders: true,
    }))
    expect(http).toMatchObject({
      type: 'http',
      config: {
        http: {
          url: 'https://example.com/health',
          method: 'POST',
          follow_redirects: false,
          allowed_status_classes: [2, 3],
          allowed_status_codes: [404, 429],
          validate_tls: false,
          tls_expiry_warn_days: null,
          domain_expiry_warn_days: [30, 14, 7, 0],
        },
      },
      retry_policy: { failure_threshold: 2, recovery_threshold: 1 },
    })

    const keyword = monitorDraftToCreateRequest(draft({
      type: 'keyword',
      target: 'https://api.example.com',
      keyword: 'healthy',
      keywordMode: 'absent',
    }))
    expect(keyword.config.http).toMatchObject({
      keyword: { value: 'healthy', mode: 'absent', case_sensitive: false },
      tls_expiry_warn_days: [30, 14, 7, 0],
      domain_expiry_warn_days: [30, 14, 7, 0],
    })
  })

  it('maps socket targets, including bracketed IPv6, and certificate reminders', () => {
    expect(monitorDraftToCreateRequest(draft({ type: 'tcp', target: '[2001:db8::1]:587' })).config.tcp)
      .toEqual({ host: '2001:db8::1', port: 587 })
    expect(monitorDraftToCreateRequest(draft({ type: 'udp', target: 'dns.example.com:53' })).config.udp)
      .toEqual({ host: 'dns.example.com', port: 53 })
    expect(monitorDraftToCreateRequest(draft({ type: 'tls', target: 'secure.example.com', sslReminders: true })).config.tls)
      .toEqual({ host: 'secure.example.com', port: 443, warn_days: [30, 14, 7, 0] })
    expect(monitorDraftToCreateRequest(draft({ type: 'reachability', target: 'router.example.com' })).config.reachability)
      .toEqual({ host: 'router.example.com' })
  })

  it('maps DNS, domain, and heartbeat type-specific fields', () => {
    expect(monitorDraftToCreateRequest(draft({
      type: 'dns', target: 'example.com', dnsRecordType: 'MX', dnsExpected: '10 mx1.example.com, 20 mx2.example.com',
    })).config.dns).toEqual({
      name: 'example.com',
      record_type: 'MX',
      expected: ['10 mx1.example.com', '20 mx2.example.com'],
    })
    expect(monitorDraftToCreateRequest(draft({ type: 'domain', target: 'example.com', domainReminders: false })).config.domain)
      .toEqual({ domain: 'example.com', warn_days: null })
    expect(monitorDraftToCreateRequest(draft({ type: 'heartbeat', target: '3600', heartbeatGraceSeconds: 300 })).config.heartbeat)
      .toEqual({ period_seconds: 3600, grace_seconds: 300 })
  })

  it('maps a 152-FZ compliance review and enforces its daily minimum', () => {
    expect(monitorDraftToCreateRequest(draft({
      type: 'compliance',
      target: 'https://example.com',
      intervalSeconds: 86400,
      timeoutSeconds: 60,
      complianceFramework: 'ru_152_fz',
    }))).toMatchObject({
      type: 'compliance',
      interval_seconds: 86400,
      timeout_seconds: 60,
      group_name: 'Monitors',
      config: { compliance: { url: 'https://example.com', framework: 'ru_152_fz' } },
    })

    expect(() => monitorDraftToCreateRequest(draft({
      type: 'compliance', target: 'https://example.com', intervalSeconds: 86399,
    }))).toThrow(/24 hours/i)
  })

  it('omits immutable type from update requests and rejects missing socket ports', () => {
    const create = monitorDraftToCreateRequest(draft({ type: 'domain', target: 'example.com', regions: ['local', 'ams-1'] }))
    const update = monitorDraftToUpdateRequest(draft({ type: 'domain', target: 'example.com', regions: ['local', 'ams-1'] }))
    expect(create).not.toHaveProperty('regions')
    expect(update).not.toHaveProperty('regions')
    expect(update).not.toHaveProperty('type')
    expect(() => monitorDraftToCreateRequest(draft({ type: 'tcp', target: 'example.com' }))).toThrow(/host:port/i)
  })
})

describe('monitor edit and chart adapters', () => {
  it('restores all editable type-specific values from a monitor', () => {
    const monitor: Monitor = {
      id: 'monitor-1',
      workspace_id: 'workspace-1',
      name: 'DNS check',
      type: 'dns',
      status: 'up',
      config: { dns: { name: 'example.com', record_type: 'AAAA', expected: ['2001:db8::1'] } },
      interval_seconds: 300,
      timeout_seconds: 10,
      regions: ['eu-west'],
      tags: ['production'],
      group_name: 'DNS',
      retry_policy: { failure_threshold: 3, recovery_threshold: 2, confirmation_delay_seconds: 0 },
      slow_threshold_ms: 500,
      paused: false,
      next_check_at: '2026-07-26T12:00:00.000Z',
      consecutive_failures: 0,
      consecutive_recoveries: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-07-26T11:55:00.000Z',
    }
    expect(monitorToDraft(monitor)).toMatchObject({
      name: 'DNS check',
      target: 'example.com',
      dnsRecordType: 'AAAA',
      dnsExpected: '2001:db8::1',
      failureThreshold: 3,
      recoveryThreshold: 2,
      slowThresholdMs: 500,
    })
  })

  it('restores supplemental certificate and domain settings from an HTTP monitor', () => {
    const monitor: Monitor = {
      id: 'monitor-http',
      workspace_id: 'workspace-1',
      name: 'Production website',
      type: 'http',
      status: 'up',
      config: {
        http: {
          url: 'https://example.com',
          allowed_status_classes: [2, 3],
          allowed_status_codes: [404],
          validate_tls: false,
          tls_expiry_warn_days: null,
          domain_expiry_warn_days: [30, 14, 7, 0],
        },
      },
      interval_seconds: 60,
      timeout_seconds: 15,
      regions: ['local'],
      tags: [],
      retry_policy: { failure_threshold: 2, recovery_threshold: 1, confirmation_delay_seconds: 0 },
      paused: false,
      next_check_at: '2026-07-26T12:00:00.000Z',
      consecutive_failures: 0,
      consecutive_recoveries: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-07-26T11:55:00.000Z',
    }

    expect(monitorToDraft(monitor)).toMatchObject({
      checkSSLErrors: false,
      sslReminders: false,
      domainReminders: true,
      allowedStatusClasses: [2, 3],
      allowedStatusCodes: [404],
    })
  })

  it('keeps supplemental expiry checks enabled for legacy HTTP configs without explicit fields', () => {
    const monitor: Monitor = {
      id: 'monitor-legacy-http',
      workspace_id: 'workspace-1',
      name: 'Legacy website',
      type: 'http',
      status: 'pending',
      config: { http: { url: 'https://legacy.example.com' } },
      interval_seconds: 60,
      timeout_seconds: 15,
      regions: ['local'],
      tags: [],
      retry_policy: { failure_threshold: 2, recovery_threshold: 1, confirmation_delay_seconds: 0 },
      paused: false,
      next_check_at: '2026-07-26T12:00:00.000Z',
      consecutive_failures: 0,
      consecutive_recoveries: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-07-26T11:55:00.000Z',
    }

    expect(monitorToDraft(monitor)).toMatchObject({
      sslReminders: true,
      domainReminders: true,
      allowedStatusClasses: [2],
      allowedStatusCodes: [],
    })
  })

  it('groups response samples by region and calculates statistics', () => {
    const series = toResponseTimeSeries([
      { id: 'a', workspace_id: 'w', monitor_id: 'm', region: 'eu-west', status: 'ok', latency_ms: 100, started_at: '2026-07-26T10:00:00.000Z', finished_at: '2026-07-26T10:00:01.000Z' },
      { id: 'b', workspace_id: 'w', monitor_id: 'm', region: 'eu-west', status: 'degraded', latency_ms: 300, started_at: '2026-07-26T10:01:00.000Z', finished_at: '2026-07-26T10:01:01.000Z' },
    ], [{ id: 'eu-west', name: 'Amsterdam', color: '#c084fc' }])
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ regionId: 'eu-west', regionLabel: 'Amsterdam', color: '#c084fc', averageMs: 200, minimumMs: 100, maximumMs: 300 })
  })

  it('builds weighted response charts from bounded aggregate buckets', () => {
    const series = toResponseTimeSeriesFromHistory([
      { at: '2026-08-04T10:00:00.000Z', region: 'eu-west', status: 'ok', latency_sum_ms: 400, samples: 2 },
      { at: '2026-08-04T10:15:00.000Z', region: 'eu-west', status: 'degraded', latency_sum_ms: 900, samples: 3 },
    ], [{ id: 'eu-west', name: 'Amsterdam', color: '#c084fc' }])

    expect(series).toHaveLength(1)
    expect(series[0]?.points.map((point) => point.valueMs)).toEqual([200, 300])
    expect(series[0]).toMatchObject({ averageMs: 260, minimumMs: 200, maximumMs: 300 })
  })

  it('reuses the previous chart value for an isolated timeout when another location is reachable', () => {
    const series = toResponseTimeSeries([
      { id: 'eu-1', workspace_id: 'w', monitor_id: 'm', region: 'eu', status: 'ok', latency_ms: 100, started_at: '2026-08-04T10:00:00.000Z', finished_at: '2026-08-04T10:00:01.000Z' },
      { id: 'eu-2', workspace_id: 'w', monitor_id: 'm', region: 'eu', status: 'failed', root_cause: 'timeout', latency_ms: 15_000, started_at: '2026-08-04T10:01:00.000Z', finished_at: '2026-08-04T10:01:15.000Z' },
      { id: 'eu-3', workspace_id: 'w', monitor_id: 'm', region: 'eu', status: 'ok', latency_ms: 120, started_at: '2026-08-04T10:02:00.000Z', finished_at: '2026-08-04T10:02:01.000Z' },
      { id: 'us-1', workspace_id: 'w', monitor_id: 'm', region: 'us', status: 'degraded', latency_ms: 200, started_at: '2026-08-04T10:00:10.000Z', finished_at: '2026-08-04T10:00:11.000Z' },
      { id: 'us-2', workspace_id: 'w', monitor_id: 'm', region: 'us', status: 'degraded', latency_ms: 210, started_at: '2026-08-04T10:01:10.000Z', finished_at: '2026-08-04T10:01:11.000Z' },
      { id: 'us-3', workspace_id: 'w', monitor_id: 'm', region: 'us', status: 'degraded', latency_ms: 220, started_at: '2026-08-04T10:02:10.000Z', finished_at: '2026-08-04T10:02:11.000Z' },
    ])
    const eu = series.find((item) => item.regionId === 'eu')

    expect(eu?.points.map((point) => point.valueMs)).toEqual([100, 100, 120])
    expect(eu).toMatchObject({ averageMs: 107, minimumMs: 100, maximumMs: 120 })
  })

  it('keeps timeout values when no peer location is reachable in the same attempt', () => {
    const series = toResponseTimeSeries([
      { id: 'eu-1', workspace_id: 'w', monitor_id: 'm', region: 'eu', status: 'ok', latency_ms: 100, started_at: '2026-08-04T10:00:00.000Z', finished_at: '2026-08-04T10:00:01.000Z' },
      { id: 'us-1', workspace_id: 'w', monitor_id: 'm', region: 'us', status: 'ok', latency_ms: 110, started_at: '2026-08-04T10:00:00.000Z', finished_at: '2026-08-04T10:00:01.000Z' },
      { id: 'eu-2', workspace_id: 'w', monitor_id: 'm', region: 'eu', status: 'failed', root_cause: 'timeout', latency_ms: 15_000, started_at: '2026-08-04T10:01:00.000Z', finished_at: '2026-08-04T10:01:15.000Z' },
      { id: 'us-2', workspace_id: 'w', monitor_id: 'm', region: 'us', status: 'failed', root_cause: 'timeout', latency_ms: 15_000, started_at: '2026-08-04T10:01:00.000Z', finished_at: '2026-08-04T10:01:15.000Z' },
    ])

    expect(series.find((item) => item.regionId === 'eu')?.maximumMs).toBe(15_000)
    expect(series.find((item) => item.regionId === 'us')?.maximumMs).toBe(15_000)
  })

  it('keeps fallback colors stable when the check response order changes', () => {
    const eu = { id: 'eu', workspace_id: 'w', monitor_id: 'm', region: 'eu-west', status: 'ok' as const, latency_ms: 100, started_at: '2026-07-26T10:00:00.000Z', finished_at: '2026-07-26T10:00:01.000Z' }
    const us = { id: 'us', workspace_id: 'w', monitor_id: 'm', region: 'us-east', status: 'ok' as const, latency_ms: 120, started_at: '2026-07-26T10:00:00.000Z', finished_at: '2026-07-26T10:00:01.000Z' }

    const first = Object.fromEntries(toResponseTimeSeries([eu, us]).map((series) => [series.regionId, series.color]))
    const refreshed = Object.fromEntries(toResponseTimeSeries([us, eu]).map((series) => [series.regionId, series.color]))

    expect(refreshed).toEqual(first)
  })
})
