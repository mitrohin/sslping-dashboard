import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CheckerIPsPage from './CheckerIPsPage'

const originalClipboard = navigator.clipboard

const mocks = vi.hoisted(() => {
  const listRegions = vi.fn()
  return { demo: false, listRegions, api: { listRegions } }
})

vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({ api: mocks.api }),
}))

vi.mock('../../app/DashboardGate', () => ({
  isDemoSession: () => mocks.demo,
}))

afterEach(() => {
  cleanup()
  mocks.demo = false
  mocks.listRegions.mockReset()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
})

describe('CheckerIPsPage', () => {
  it('shows only published checker addresses and copies the deduplicated allowlist', async () => {
    mocks.listRegions.mockResolvedValue({
      items: [
        { id: 'local', display_code: 'fra-1', name: 'Frankfurt', color: '#34d77b', capabilities: ['http'], status: 'available', system: true },
        { id: 'nyc-1', name: 'New York', color: '#58a6ff', ip_address: '8.8.8.8', capabilities: ['http'], status: 'available' },
        { id: 'ams-1', name: 'Amsterdam', color: '#a78bfa', ip_address: '1.1.1.1', capabilities: ['http'], status: 'connecting' },
        { id: 'ams-2', name: 'Amsterdam backup', color: '#a78bfa', ip_address: '1.1.1.1', capabilities: ['http'], status: 'available' },
      ],
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    render(<CheckerIPsPage />)

    expect(await screen.findByText('1.1.1.1')).toBeInTheDocument()
    expect(screen.getByText('8.8.8.8')).toBeInTheDocument()
    expect(screen.queryByText('Frankfurt')).not.toBeInTheDocument()
    expect(screen.getByText('2 source IPs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy all IPs' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('1.1.1.1\n8.8.8.8'))
    expect(screen.getByRole('button', { name: 'All IPs copied' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy 8.8.8.8' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('8.8.8.8'))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('shows a recoverable load error and retries the live catalogue', async () => {
    mocks.listRegions
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ items: [{ id: 'edge-1', name: 'London', ip_address: '9.9.9.9', capabilities: ['http'], status: 'available' }] })

    render(<CheckerIPsPage />)

    expect(await screen.findByRole('heading', { name: 'Could not load checker IP addresses.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('9.9.9.9')).toBeInTheDocument()
    expect(mocks.listRegions).toHaveBeenCalledTimes(2)
  })

  it('uses clearly marked documentation addresses in the demo without calling the API', async () => {
    mocks.demo = true

    render(<CheckerIPsPage />)

    expect(await screen.findByText('192.0.2.42')).toBeInTheDocument()
    expect(screen.getByText(/documentation-only ranges/i)).toBeInTheDocument()
    expect(mocks.listRegions).not.toHaveBeenCalled()
  })

  it('keeps addresses selectable and reports a clipboard failure', async () => {
    mocks.listRegions.mockResolvedValue({ items: [{ id: 'edge-1', name: 'London', ip_address: '9.9.9.9', capabilities: ['http'], status: 'available' }] })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    })

    render(<CheckerIPsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy 9.9.9.9' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('copy it manually')
    expect(screen.getByText('9.9.9.9')).toBeInTheDocument()
  })
})
