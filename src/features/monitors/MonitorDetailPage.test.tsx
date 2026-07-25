import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoMonitors } from '../../data'
import { MonitorDetailPage } from './MonitorDetailPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MonitorDetailPage heartbeat token rotation', () => {
  it('confirms invalidation and displays the newly rotated one-time URL', async () => {
    const heartbeat = demoMonitors.find((monitor) => monitor.type === 'heartbeat')!
    const url = 'https://api.sslping.test/v1/heartbeat/rotated-secret'
    const onRotateHeartbeat = vi.fn().mockResolvedValue({ monitorName: heartbeat.name, url })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <MemoryRouter>
        <MonitorDetailPage monitor={heartbeat} responseTime={[]} uptimePeriods={[]} incidents={[]} onRotateHeartbeat={onRotateHeartbeat} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rotate URL' }))

    expect(window.confirm).toHaveBeenCalledWith('Rotate this heartbeat URL? The current URL will stop working immediately.')
    await waitFor(() => expect(onRotateHeartbeat).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('dialog', { name: /heartbeat is ready/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Heartbeat URL' })).toHaveValue(url)
  })

  it('does not rotate when the invalidation warning is cancelled', () => {
    const heartbeat = demoMonitors.find((monitor) => monitor.type === 'heartbeat')!
    const onRotateHeartbeat = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<MemoryRouter><MonitorDetailPage monitor={heartbeat} onRotateHeartbeat={onRotateHeartbeat} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Rotate URL' }))

    expect(onRotateHeartbeat).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
