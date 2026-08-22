import type { ReactElement } from 'react'
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { demoIncidents } from '../../data'
import { IncidentsPage } from './IncidentsPage'

afterEach(cleanup)

const render = (view: ReactElement) => renderView(view, { wrapper: MemoryRouter })

describe('IncidentsPage', () => {
  it('links the checker-network notice to the current IP allowlist', () => {
    render(<IncidentsPage />)

    expect(screen.getByRole('link', { name: /view ip addresses/i })).toHaveAttribute('href', '/checker-ips')
  })

  it('shows only the safe public summary for a followed-monitor incident', () => {
    const incident = {
      ...demoIncidents[0],
      id: 'shared-incident',
      access: 'subscription' as const,
      subscriptionId: 'subscription-1',
      monitorName: 'Shared checkout',
      rootCause: 'Public outage cause',
      assignedTo: 'Private owner',
      commentCount: 42,
    }
    render(<IncidentsPage incidents={[incident]} />)

    expect(screen.queryByRole('columnheader', { name: 'Comments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Assignee' })).not.toBeInTheDocument()
    expect(screen.queryByText('Private owner')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Shared checkout' }))

    expect(screen.getByText('Public incident summary')).toBeInTheDocument()
    expect(screen.getAllByText('Public outage cause')).not.toHaveLength(0)
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add comment/i })).not.toBeInTheDocument()
  })

  it('shows the assignee for an open incident and removes the visibility column', () => {
    render(<IncidentsPage incidents={[demoIncidents[0]]} />)

    expect(screen.getByRole('columnheader', { name: 'Assignee' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Visibility' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Alex Morgan')).not.toHaveLength(0)
  })

  it('applies filters immediately and can reset them from the toolbar', () => {
    render(<IncidentsPage />)

    const search = screen.getByRole('searchbox', { name: /search incidents/i })
    const filters = screen.getByRole('button', { name: 'Filters' })
    expect(filters).toBeDisabled()

    fireEvent.change(search, { target: { value: 'Checkout' } })
    const clear = screen.getByRole('button', { name: /clear filters/i })
    expect(clear).toBeEnabled()

    fireEvent.click(clear)
    expect(search).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Filters' })).toBeDisabled()
  })

  it('renders every loaded incident update in the timeline', () => {
    const incident = demoIncidents[0]
    render(
      <IncidentsPage
        incidents={[incident]}
        initialComments={{
          [incident.id]: [
            { id: 'event-1', author: 'Incident opened', message: 'Connection failed', createdAt: incident.startedAt, status: 'investigating' },
            { id: 'comment-1', author: 'Alex Morgan', message: 'Provider investigation started', createdAt: incident.startedAt, status: 'investigating' },
            { id: 'event-2', author: 'Incident resolved', message: 'Monitor recovered', createdAt: incident.resolvedAt ?? incident.startedAt, status: 'resolved' },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: incident.monitorName }))

    expect(screen.getByText('Connection failed')).toBeInTheDocument()
    expect(screen.getByText('Provider investigation started')).toBeInTheDocument()
    expect(screen.getByText('Monitor recovered')).toBeInTheDocument()
  })

  it('loads incident details on demand, caches them, and preserves incident actions', async () => {
    const incident = demoIncidents[0]
    let finishLoading: ((detail: {
      comments: Array<{ id: string; author: string; message: string; createdAt: string; status: 'investigating' }>
      reports: []
    }) => void) | undefined
    const onLoadIncidentDetails = vi.fn(() => new Promise<{
      comments: Array<{ id: string; author: string; message: string; createdAt: string; status: 'investigating' }>
      reports: []
    }>((resolve) => {
      finishLoading = resolve
    }))
    const onComment = vi.fn().mockResolvedValue(undefined)
    const onResolve = vi.fn().mockResolvedValue(undefined)

    render(
      <IncidentsPage
        incidents={[incident]}
        onLoadIncidentDetails={onLoadIncidentDetails}
        onComment={onComment}
        onResolve={onResolve}
      />,
    )

    expect(onLoadIncidentDetails).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: incident.monitorName }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(onLoadIncidentDetails).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishLoading?.({
        comments: [{
          id: 'lazy-comment',
          author: 'Incident opened',
          message: 'Loaded only after selection',
          createdAt: incident.startedAt,
          status: 'investigating',
        }],
        reports: [],
      })
    })
    expect(await screen.findByText('Loaded only after selection')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Share context or the next action…'), { target: { value: 'Operator update' } })
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }))
    await waitFor(() => expect(onComment).toHaveBeenCalledWith(incident.id, 'Operator update'))
    expect(screen.getByText('Operator update')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^resolve$/i }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(incident.id))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: incident.monitorName }))
    expect(screen.getByText('Loaded only after selection')).toBeInTheDocument()
    expect(onLoadIncidentDetails).toHaveBeenCalledTimes(1)
  })

  it('shows a detail error and retries only the selected incident', async () => {
    const incident = demoIncidents[0]
    const onLoadIncidentDetails = vi.fn()
      .mockRejectedValueOnce(new Error('Incident details are temporarily unavailable'))
      .mockResolvedValueOnce({
        comments: [{ id: 'recovered-comment', author: 'Incident opened', message: 'Details recovered', createdAt: incident.startedAt, status: 'investigating' }],
        reports: [],
      })

    render(<IncidentsPage incidents={[incident]} onLoadIncidentDetails={onLoadIncidentDetails} />)
    fireEvent.click(screen.getByRole('button', { name: incident.monitorName }))

    expect(await screen.findByText('Incident details are temporarily unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Details recovered')).toBeInTheDocument()
    expect(onLoadIncidentDetails).toHaveBeenCalledTimes(2)
  })

  it('renders visitor reports as an interactive mountain chart with a baseline and watermark', () => {
    const now = Date.now()
    const incident = {
      ...demoIncidents[0],
      id: 'visitor-report-incident',
      source: 'user_report' as const,
      startedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      resolvedAt: undefined,
      reportReasonLabel: 'Not working completely',
    }
    const reports = [
      { id: 'report-1', reported_at: new Date(now - 90 * 60 * 1000).toISOString() },
      { id: 'report-2', reported_at: new Date(now - 30 * 60 * 1000).toISOString() },
    ].map((report) => ({
      ...report,
      incident_id: incident.id,
      workspace_id: 'workspace-1',
      status_page_id: 'status-page-1',
      monitor_id: incident.monitorId,
      reason_key: 'not_working',
      reason_label: 'Not working completely',
      ip_address: '192.0.2.1',
    }))

    render(<IncidentsPage incidents={[incident]} initialReports={{ [incident.id]: reports }} />)
    fireEvent.click(screen.getByRole('button', { name: incident.monitorName }))

    const chart = screen.getByRole('img', { name: 'Report activity over time' })
    expect(chart).toBeInTheDocument()
    expect(chart.querySelector('.ops-report-activity__area')).toBeInTheDocument()
    expect(chart.querySelector('.ops-report-activity__baseline')).toBeInTheDocument()
    expect(screen.getByText('SSLPing')).toBeInTheDocument()

    fireEvent.focus(chart)
    expect(screen.getByText('Baseline:')).toBeInTheDocument()
    expect(screen.getByText('Reports:')).toBeInTheDocument()
  })

  it('shows the location evidence that confirmed an incident', () => {
    const incident = {
      ...demoIncidents[0],
      locationQuorum: {
        policy: 'two-location-confirmation',
        expectedLocations: 3,
        requiredFailures: 2,
        requiredRecoveries: 2,
        observations: [
          { region: 'eu-west', status: 'failed' as const, rootCause: 'timeout', latencyMs: 30000, finishedAt: '2026-07-27T17:00:00Z' },
          { region: 'us-east', status: 'failed' as const, rootCause: 'connection refused', latencyMs: 120, finishedAt: '2026-07-27T17:00:01Z' },
          { region: 'ap-south', status: 'ok' as const, latencyMs: 220, finishedAt: '2026-07-27T17:00:02Z' },
        ],
      },
    }
    render(<IncidentsPage incidents={[incident]} />)

    fireEvent.click(screen.getByRole('button', { name: incident.monitorName }))

    expect(screen.getByText('Location confirmation')).toBeInTheDocument()
    expect(screen.getByText('2 locations reported failure; 2 of 3 were required to open this incident.')).toBeInTheDocument()
    expect(screen.getByText('eu-west')).toBeInTheDocument()
    expect(screen.getByText('us-east')).toBeInTheDocument()
    expect(screen.getByText('ap-south')).toBeInTheDocument()
  })

  it('opens a LeakCheck incident report from its direct URL', () => {
    const report = {
      provider: 'leakcheck.io' as const,
      query_type: 'phone' as const,
      query_masked: '*******58',
      found: 1,
      checked_at: '2026-07-27T17:00:00Z',
      sources: [{ name: 'Example breach', unverified: false, passwordless: false, compilation: false, records: 1, fields: ['phone'] }],
      records: [{ source: { name: 'Example breach', unverified: false, passwordless: false, compilation: false }, data: { phone: '*******58' } }],
    }
    const incident = { ...demoIncidents[0], id: 'leak-incident', monitorType: 'leakcheck' as const, leakReport: report }
    window.history.pushState({}, '', '/incidents?incident=leak-incident')

    render(<IncidentsPage incidents={[incident]} />)

    expect(screen.getByRole('dialog', { name: incident.monitorName })).toBeInTheDocument()
    expect(screen.getAllByText('Example breach')).not.toHaveLength(0)
    expect(screen.getAllByText('*******58')).not.toHaveLength(0)
    window.history.pushState({}, '', '/')
  })
})
