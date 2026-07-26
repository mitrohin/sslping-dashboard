import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoMonitors } from '../../data'
import { MonitorDetailPage } from './MonitorDetailPage'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

describe('MonitorDetailPage live controls', () => {
  it('increments the last-check age every second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T10:00:00.000Z'))
    const monitor = {
      ...demoMonitors[0],
      lastCheckedAt: '2026-07-26T09:59:02.000Z',
      statusChangedAt: undefined,
    }

    render(<MemoryRouter><MonitorDetailPage monitor={monitor} responseTime={[]} uptimePeriods={[]} incidents={[]} /></MemoryRouter>)
    expect(screen.getByText('58 seconds ago')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('1 minute ago')).toBeInTheDocument()
  })

  it('filters the response chart through an accessible regions menu', () => {
    const responseTime = [
      { regionId: 'eu', regionLabel: 'Europe', color: '#34d77b', averageMs: 100, minimumMs: 90, maximumMs: 110, points: [{ timestamp: '2026-07-26T09:00:00Z', valueMs: 100, status: 'ok' as const }] },
      { regionId: 'us', regionLabel: 'North America', color: '#6558f5', averageMs: 200, minimumMs: 190, maximumMs: 210, points: [{ timestamp: '2026-07-26T09:00:00Z', valueMs: 200, status: 'ok' as const }] },
    ]
    render(<MemoryRouter><MonitorDetailPage monitor={demoMonitors[0]} responseTime={responseTime} uptimePeriods={[]} incidents={[]} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'All regions' }))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'North America' }))

    expect(screen.getByRole('button', { name: 'Europe' })).toBeInTheDocument()
    expect(screen.getAllByText('100 ms')).toHaveLength(3)
  })

  it('saves a response-time alert through the monitor callback', async () => {
    const onUpdateResponseAlert = vi.fn().mockResolvedValue(undefined)
    render(<MemoryRouter><MonitorDetailPage monitor={{ ...demoMonitors[0], slowThresholdMs: undefined }} responseTime={[]} uptimePeriods={[]} incidents={[]} onUpdateResponseAlert={onUpdateResponseAlert} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /set response alert/i }))
    const dialog = screen.getByRole('dialog', { name: 'Response time alert' })
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Slow response alert' }))
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '2300' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save alert' }))

    await waitFor(() => expect(onUpdateResponseAlert).toHaveBeenCalledWith(2300))
    expect(screen.queryByRole('dialog', { name: 'Response time alert' })).not.toBeInTheDocument()
  })

  it('opens a multi-action menu without immediately asking to delete', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter><MonitorDetailPage monitor={demoMonitors[0]} responseTime={[]} uptimePeriods={[]} incidents={[]} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /more actions for/i }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Edit monitor' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Run test now' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Export incident log' })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete monitor' }))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('exports incident logs through the connected action', () => {
    const onExportLogs = vi.fn()
    render(<MemoryRouter><MonitorDetailPage monitor={demoMonitors[0]} responseTime={[]} uptimePeriods={[]} incidents={[]} onExportLogs={onExportLogs} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /export logs/i }))
    expect(onExportLogs).toHaveBeenCalledTimes(1)
  })
})
