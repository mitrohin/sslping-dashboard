import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoMonitors, type MonitorViewModel } from '../../data'
import { MonitorsPage } from './MonitorsPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPage(props: ComponentProps<typeof MonitorsPage> = {}) {
  return render(<MemoryRouter><MonitorsPage {...props} /></MemoryRouter>)
}

function actionsFor(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return screen.getByRole('menu', { name: `Actions for ${name}` })
}

describe('MonitorsPage selection', () => {
  it('selects individual and all currently visible monitors while reporting the real total', () => {
    const data = demoMonitors.slice(0, 2)
    renderPage({ data })

    fireEvent.change(screen.getByPlaceholderText(/search by name or url/i), { target: { value: 'Production API' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /select all visible monitors/i }))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /select production api/i })).toBeChecked()

    fireEvent.change(screen.getByPlaceholderText(/search by name or url/i), { target: { value: '' } })
    const selectAll = screen.getByRole('checkbox', { name: /select all visible monitors/i }) as HTMLInputElement
    expect(selectAll.indeterminate).toBe(true)
    fireEvent.click(selectAll)

    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /select marketing website/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /select production api/i })).toBeChecked()
  })

  it('filters monitors by known tags', () => {
    const production = { ...demoMonitors[0], tags: ['production', 'website'] }
    const staging = { ...demoMonitors[1], tags: ['staging', 'api'] }
    renderPage({ data: [production, staging] })

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by tag' }), { target: { value: 'staging' } })
    expect(screen.queryByRole('link', { name: production.name })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: staging.name })).toBeInTheDocument()
  })

  it('delegates bulk monitor and tag operations for the selected monitors', async () => {
    const data = demoMonitors.slice(0, 2)
    const onBulkAction = vi.fn().mockResolvedValue(undefined)
    const onBulkTags = vi.fn().mockResolvedValue(undefined)
    renderPage({ data, onBulkAction, onBulkTags })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all visible monitors' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk monitor actions' })
    fireEvent.click(within(toolbar).getByRole('button', { name: /test now/i }))
    await waitFor(() => expect(onBulkAction).toHaveBeenCalledWith(data, 'test'))
    fireEvent.click(within(toolbar).getByRole('button', { name: /pause/i }))
    await waitFor(() => expect(onBulkAction).toHaveBeenCalledWith(data, 'pause'))
    fireEvent.click(within(toolbar).getByRole('button', { name: /resume/i }))
    await waitFor(() => expect(onBulkAction).toHaveBeenCalledWith(data, 'resume'))

    fireEvent.click(within(toolbar).getByRole('button', { name: /manage tags/i }))
    let dialog = screen.getByRole('dialog', { name: /manage tags/i })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search bulk tags' }), { target: { value: 'release' } })
    fireEvent.click(within(dialog).getByRole('option', { name: /create “release”/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply bulk tag changes' }))
    await waitFor(() => expect(onBulkTags).toHaveBeenCalledWith(data, 'add', ['release']))

    fireEvent.click(within(toolbar).getByRole('button', { name: /manage tags/i }))
    dialog = screen.getByRole('dialog', { name: /manage tags/i })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove tags' }))
    fireEvent.click(within(dialog).getByRole('option', { name: /production/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply bulk tag changes' }))
    await waitFor(() => expect(onBulkTags).toHaveBeenLastCalledWith(data, 'remove', ['production']))

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(toolbar).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(onBulkAction).toHaveBeenCalledWith(data, 'delete'))
    expect(window.confirm).toHaveBeenCalledWith('Delete 2 selected monitors? This cannot be undone.')
  })
})

describe('MonitorsPage health summary', () => {
  it('uses monitor metrics and current health instead of placeholder values', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-26T12:00:00.000Z'))
    const monitor: MonitorViewModel = {
      ...demoMonitors[0],
      status: 'up',
      uptime24h: 99.87,
      incidentCount24h: 1,
      downtimeSeconds24h: 62,
      mtbfSeconds24h: 46_800,
      lastIncidentAt: '2026-07-26T06:15:00.000Z',
      hasOpenIncident: false,
      last24Hours: Array.from({ length: 24 }, (_, index) => ({
        id: `hour-${index}`,
        startedAt: new Date(Date.parse('2026-07-25T13:00:00.000Z') + index * 3_600_000).toISOString(),
        status: index === 17 ? 'down' as const : index < 10 ? 'no-data' as const : 'up' as const,
      })),
    }

    renderPage({ data: [monitor] })

    const current = screen.getByRole('heading', { name: /current status/i }).closest('.panel') as HTMLElement
    expect(within(current).getByText('✓')).toBeInTheDocument()
    expect(within(current).getByText('✓').parentElement).toHaveClass('status-summary__visual--up')

    const lastDay = screen.getByRole('heading', { name: /last 24 hours/i }).closest('.panel') as HTMLElement
    expect(within(lastDay).getByText('99.87%')).toBeInTheDocument()
    expect(within(lastDay).getByText('13h')).toBeInTheDocument()
    expect(within(lastDay).getByText('5h 45m')).toBeInTheDocument()
    expect(within(lastDay).getByText('1')).toBeInTheDocument()

    const bars = screen.getByLabelText('Hourly checks for the last 24 hours').querySelectorAll('span')
    expect(bars).toHaveLength(24)
    expect(bars[17]).toHaveClass('is-down')
    expect(bars[0]).toHaveClass('is-no-data')
  })
})

describe('MonitorsPage monitor creation', () => {
  it('keeps certificate and domain expiry as supplemental checks instead of standalone monitor types', () => {
    renderPage({ data: [] })

    fireEvent.click(screen.getByRole('button', { name: 'New monitor' }))
    const dialog = screen.getByRole('dialog', { name: 'Create monitor' })

    expect(within(dialog).queryByRole('button', { name: 'SSL / TLS Certificate validity and expiry' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Domain expiry RDAP registration and expiry' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: 'Check SSL errors' })).toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: 'SSL expiry reminders' })).toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: 'Domain expiry reminders' })).toBeInTheDocument()
  })
})

describe('MonitorsPage row actions', () => {
  it('exposes navigation and delegates pause, resume, test and delete actions', async () => {
    const up = demoMonitors[0]
    const paused = demoMonitors.find((monitor) => monitor.status === 'paused') as MonitorViewModel
    const onView = vi.fn()
    const onEdit = vi.fn()
    const onTogglePause = vi.fn().mockResolvedValue(undefined)
    const onTest = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage({ data: [up, paused], onView, onEdit, onTogglePause, onTest, onDelete })

    let menu = actionsFor(up.name)
    const view = within(menu).getByRole('menuitem', { name: /view/i })
    expect(view).toHaveAttribute('href', `/monitors/${up.id}`)
    fireEvent.click(view)
    expect(onView).toHaveBeenCalledWith(up)

    menu = actionsFor(up.name)
    const edit = within(menu).getByRole('menuitem', { name: /edit/i })
    expect(edit).toHaveAttribute('href', `/monitors/${up.id}/edit`)
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledWith(up)

    menu = actionsFor(up.name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /pause/i }))
    await waitFor(() => expect(onTogglePause).toHaveBeenCalledWith(up, true))

    menu = actionsFor(paused.name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /resume/i }))
    await waitFor(() => expect(onTogglePause).toHaveBeenCalledWith(paused, false))

    menu = actionsFor(up.name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /test now/i }))
    await waitFor(() => expect(onTest).toHaveBeenCalledWith(up))

    menu = actionsFor(up.name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /delete/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(up))
    expect(window.confirm).toHaveBeenCalledWith(`Delete “${up.name}”? This cannot be undone.`)
  })

  it('applies the same controls locally in demo mode', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    const name = 'Marketing website'
    let menu = actionsFor(name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /pause/i }))
    expect(await screen.findByText(`Paused ${name}.`)).toBeInTheDocument()
    let row = screen.getByRole('link', { name: `Open ${name}` }).closest('article') as HTMLElement
    expect(within(row).getByText('paused')).toBeInTheDocument()

    menu = actionsFor(name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /resume/i }))
    expect(await screen.findByText(`Resumed ${name}.`)).toBeInTheDocument()
    row = screen.getByRole('link', { name: `Open ${name}` }).closest('article') as HTMLElement
    expect(within(row).queryByText('paused')).not.toBeInTheDocument()

    menu = actionsFor(name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /test now/i }))
    expect(await screen.findByText(`Test completed for ${name}.`)).toBeInTheDocument()

    menu = actionsFor(name)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /delete/i }))
    expect(await screen.findByText(`Deleted ${name}.`)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: `Open ${name}` })).not.toBeInTheDocument()
  })
})
