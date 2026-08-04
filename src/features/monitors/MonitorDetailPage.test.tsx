import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoMonitors } from '../../data'
import { MonitorDetailPage, buildResponseTimeChartData } from './MonitorDetailPage'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('response-time chart data', () => {
  it('merges asynchronous location samples by timestamp and sorts them chronologically', () => {
    const data = buildResponseTimeChartData([
      {
        regionId: 'eu', regionLabel: 'Europe', color: '#34d77b', averageMs: 105, minimumMs: 100, maximumMs: 110,
        points: [
          { timestamp: '2026-07-29T09:02:00Z', valueMs: 110, status: 'ok' },
          { timestamp: '2026-07-29T09:00:00Z', valueMs: 100, status: 'ok' },
        ],
      },
      {
        regionId: 'us', regionLabel: 'North America', color: '#6558f5', averageMs: 210, minimumMs: 200, maximumMs: 220,
        points: [
          { timestamp: '2026-07-29T09:01:00Z', valueMs: 200, status: 'ok' },
          { timestamp: '2026-07-29T09:02:00Z', valueMs: 220, status: 'ok' },
        ],
      },
    ])

    expect(data).toEqual([
      { timestamp: Date.parse('2026-07-29T09:00:00Z'), eu: 100 },
      { timestamp: Date.parse('2026-07-29T09:01:00Z'), us: 200 },
      { timestamp: Date.parse('2026-07-29T09:02:00Z'), eu: 110, us: 220 },
    ])
  })
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
  it('shows assigned location names instead of infrastructure codes', () => {
    const monitor = { ...demoMonitors[0], regions: ['local', 'blr-1'] }
    render(
      <MemoryRouter>
        <MonitorDetailPage monitor={monitor} locationNames={{ local: 'Frankfurt', 'blr-1': 'Bangalore' }} responseTime={[]} uptimePeriods={[]} incidents={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Frankfurt')).toBeInTheDocument()
    expect(screen.getByText('Bangalore')).toBeInTheDocument()
    expect(screen.queryByText('blr-1')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Monitoring regions: Frankfurt, Bangalore' })).toBeInTheDocument()
    expect(screen.getByTestId('region-marker-local')).toHaveStyle({ left: '52.41%' })
    expect(screen.getByTestId('region-marker-blr-1')).toHaveStyle({ left: '71.55%' })
  })

  it('shows an in-progress first compliance scan instead of a false violation', () => {
    const monitor = {
      ...demoMonitors[0],
      id: 'compliance-pending',
      type: 'compliance' as const,
      typeLabel: 'Legal compliance',
      status: 'down' as const,
      lastCheckedAt: undefined,
      statusChangedAt: undefined,
      complianceReport: undefined,
    }

    render(<MemoryRouter><MonitorDetailPage monitor={monitor} responseTime={[]} uptimePeriods={[]} incidents={[]} /></MemoryRouter>)

    expect(screen.getByText('Scan in progress')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Scanning site pages')
    expect(screen.getByText('The first check is running')).toBeInTheDocument()
    expect(screen.queryByText('Issues found')).not.toBeInTheDocument()
  })

  it('keeps LeakCheck evidence inside the incident and links directly to it', () => {
    const report = {
      provider: 'leakcheck.io' as const,
      query_type: 'email' as const,
      query_masked: 'a***@example.com',
      found: 2,
      checked_at: '2026-07-27T17:00:00Z',
      sources: [{ name: 'Example breach', unverified: false, passwordless: false, compilation: false, records: 2, fields: ['email'] }],
      records: [{ source: { name: 'Example breach', unverified: false, passwordless: false, compilation: false }, data: { email: 'a***@example.com' } }],
    }
    const monitor = { ...demoMonitors[0], id: 'leak-monitor', type: 'leakcheck' as const, typeLabel: 'Leak exposure', target: 'a***@example.com', status: 'down' as const, leakReport: report }
    const incident = { id: 'leak-incident', monitorId: monitor.id, monitorName: monitor.name, monitorType: monitor.type, status: 'investigating' as const, rootCause: 'Leak exposure detected', rootCauseCode: 'LEAK', startedAt: report.checked_at, durationSeconds: 60, commentCount: 0, visibility: 'excluded' as const, leakReport: report }

    render(<MemoryRouter><MonitorDetailPage monitor={monitor} responseTime={[]} uptimePeriods={[]} incidents={[incident]} /></MemoryRouter>)

    expect(screen.queryByText('Example breach')).not.toBeInTheDocument()
    expect(screen.queryByText('On demand · cached for 31 days')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open incident report/i })).toHaveAttribute('href', '/incidents?incident=leak-incident')
  })

  it('increments the last-check age every second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T10:00:00.000Z'))
    const monitor = {
      ...demoMonitors[0],
      lastCheckedAt: '2026-07-26T09:59:02.000Z',
      statusChangedAt: undefined,
    }

    render(<MemoryRouter><MonitorDetailPage monitor={monitor} responseTime={[]} uptimePeriods={[]} incidents={[]} /></MemoryRouter>)
    expect(screen.getByText('58s')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('61s')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Response time alert' })).not.toBeInTheDocument())
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

  it('removes every manual-test control when the plan does not include it', () => {
    render(<MemoryRouter><MonitorDetailPage monitor={demoMonitors[0]} responseTime={[]} uptimePeriods={[]} incidents={[]} manualTestEnabled={false} /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: /test monitor/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /more actions for/i }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /run test now/i })).not.toBeInTheDocument()
  })

  it('exports incident logs through the connected action', () => {
    const onExportLogs = vi.fn()
    render(<MemoryRouter><MonitorDetailPage monitor={demoMonitors[0]} responseTime={[]} uptimePeriods={[]} incidents={[]} onExportLogs={onExportLogs} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /export logs/i }))
    expect(onExportLogs).toHaveBeenCalledTimes(1)
  })
})
