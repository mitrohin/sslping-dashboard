import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoMonitors, type MonitorViewModel } from '../../data'
import { StatusPagesPage } from './StatusPagesPage'

afterEach(cleanup)

describe('StatusPagesPage monitor eligibility', () => {
  it('does not offer evidence-only monitors as public status components', () => {
    const leakMonitor: MonitorViewModel = {
      ...demoMonitors[0], id: 'leak-monitor', name: 'Account exposure', type: 'leakcheck',
      typeLabel: 'Leak exposure', target: 'a***@example.com', status: 'down',
    }
    const complianceMonitor: MonitorViewModel = {
      ...demoMonitors[0], id: 'compliance-monitor', name: '152-FZ review', type: 'compliance',
      typeLabel: 'Legal compliance', target: 'https://example.com', status: 'down',
    }
    render(<MemoryRouter><StatusPagesPage pages={[]} monitors={[demoMonitors[0], leakMonitor, complianceMonitor]} /></MemoryRouter>)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create status page' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Create status page' })
    expect(within(dialog).getByText(demoMonitors[0].name)).toBeInTheDocument()
    expect(within(dialog).queryByText(leakMonitor.name)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(complianceMonitor.name)).not.toBeInTheDocument()
  })

  it('submits the language selected during status-page creation', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<MemoryRouter><StatusPagesPage pages={[]} monitors={[demoMonitors[0]]} onCreate={onCreate} /></MemoryRouter>)

    fireEvent.click(screen.getAllByRole('button', { name: 'Create status page' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Create status page' })
    fireEvent.change(within(dialog).getByPlaceholderText('System status'), { target: { value: 'Russian status' } })
    fireEvent.change(within(dialog).getAllByRole('combobox')[1], { target: { value: 'ru' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create status page' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Russian status',
      slug: 'russian-status',
      language: 'ru',
    })))
  })
})
