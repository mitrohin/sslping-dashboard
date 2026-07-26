import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { demoIncidents } from '../../data'
import { IncidentsPage } from './IncidentsPage'

afterEach(cleanup)

describe('IncidentsPage', () => {
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
})
