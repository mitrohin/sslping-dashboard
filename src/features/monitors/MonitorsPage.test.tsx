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
