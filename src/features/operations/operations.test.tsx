import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { demoIncidents } from '../../data'
import { IncidentsPage } from './IncidentsPage'

afterEach(cleanup)

describe('IncidentsPage', () => {
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
