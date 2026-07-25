import { describe, expect, it } from 'vitest'
import type { Monitor } from '../../api/types'
import { defaultMonitorDraft, type MonitorDraft } from './MonitorForm'
import {
  monitorDraftToCreateRequest,
  monitorDraftToUpdateRequest,
  monitorToDraft,
  toResponseTimeSeries,
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
      checkSSLErrors: false,
    }))
    expect(http).toMatchObject({
      type: 'http',
      config: { http: { url: 'https://example.com/health', method: 'POST', follow_redirects: false, validate_tls: false } },
      retry_policy: { failure_threshold: 2, recovery_threshold: 1 },
    })

    const keyword = monitorDraftToCreateRequest(draft({
      type: 'keyword',
      target: 'https://api.example.com',
      keyword: 'healthy',
      keywordMode: 'absent',
    }))
    expect(keyword.config.http?.keyword).toEqual({ value: 'healthy', mode: 'absent', case_sensitive: false })
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

  it('omits immutable type from update requests and rejects missing socket ports', () => {
    expect(monitorDraftToUpdateRequest(draft({ type: 'domain', target: 'example.com' }))).not.toHaveProperty('type')
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

  it('groups response samples by region and calculates statistics', () => {
    const series = toResponseTimeSeries([
      { id: 'a', workspace_id: 'w', monitor_id: 'm', region: 'eu-west', status: 'ok', latency_ms: 100, started_at: '2026-07-26T10:00:00.000Z', finished_at: '2026-07-26T10:00:01.000Z' },
      { id: 'b', workspace_id: 'w', monitor_id: 'm', region: 'eu-west', status: 'degraded', latency_ms: 300, started_at: '2026-07-26T10:01:00.000Z', finished_at: '2026-07-26T10:01:01.000Z' },
    ])
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ regionId: 'eu-west', averageMs: 200, minimumMs: 100, maximumMs: 300 })
  })
})
