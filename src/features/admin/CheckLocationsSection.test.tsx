import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckLocation } from '../../api/types'
import { CheckLocationsSection, checkLocationStatus, formatCheckLocationEndpoint } from './CheckLocationsSection'

const location: CheckLocation = {
  id: 'location-1',
  code: 'ams-1',
  name: 'Amsterdam',
  ip_address: '203.0.113.10',
  port: 8443,
  key_fingerprint: 'sha256:4f8c9b1a',
  state: 'active',
  active: true,
  enforce_ip: true,
  concurrency: 16,
  last_seen_at: '2026-07-29T09:00:00Z',
  last_observed_ip: '203.0.113.10',
  agent_version: '1.0.0',
  created_at: '2026-07-29T08:00:00Z',
  updated_at: '2026-07-29T09:00:00Z',
}

function makeApi(items: CheckLocation[] = [location]) {
  return {
    adminListCheckLocations: vi.fn().mockResolvedValue({ items }),
    adminCreateCheckLocation: vi.fn(),
    adminUpdateCheckLocation: vi.fn(),
  }
}

afterEach(cleanup)

describe('check location helpers', () => {
  it('formats IPv6 endpoints and derives connection state from heartbeats', () => {
    const now = Date.parse('2026-07-29T09:01:00Z')

    expect(formatCheckLocationEndpoint({ ip_address: '2001:db8::10', port: 8443 })).toBe('[2001:db8::10]:8443')
    expect(checkLocationStatus(location, now)).toBe('online')
    expect(checkLocationStatus({ active: false, state: 'provisioning' }, now)).toBe('provisioning')
    expect(checkLocationStatus({ active: false, state: 'draining' }, now)).toBe('draining')
    expect(checkLocationStatus({ active: true, last_seen_at: '2026-07-29T08:58:00Z' }, now)).toBe('offline')
    expect(checkLocationStatus({ active: true }, now)).toBe('connecting')
    expect(checkLocationStatus({ active: false, last_seen_at: location.last_seen_at }, now)).toBe('inactive')
  })

  it('keeps a provisioning location enabled while editing metadata', async () => {
    const provisioning = { ...location, state: 'provisioning' as const, active: false, name: 'Amsterdam rollout' }
    const api = makeApi([provisioning])
    api.adminUpdateCheckLocation.mockResolvedValue(provisioning)
    render(<CheckLocationsSection api={api} />)

    expect(await screen.findByText('Applying to monitors')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Amsterdam rollout' }))
    expect(screen.getByRole('switch', { name: 'Enable this check location' })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the deadline while a location drains leased checks', async () => {
    const draining = { ...location, state: 'draining' as const, active: false, drain_until: '2026-07-29T09:15:00Z' }
    render(<CheckLocationsSection api={makeApi([draining])} />)

    expect(await screen.findByText('Draining current checks')).toBeInTheDocument()
    expect(screen.getByText(/Leased results accepted until/)).toBeInTheDocument()
  })
})

describe('check location administration', () => {
  it('shows operational metadata and only the stored key fingerprint', async () => {
    const api = makeApi()
    render(<CheckLocationsSection api={api} />)

    expect(await screen.findByText('Amsterdam')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10:8443')).toBeInTheDocument()
    expect(screen.getByText('sha256:4f8c9b1a')).toBeInTheDocument()
    expect(screen.getByText('Agent 1.0.0')).toBeInTheDocument()
    expect(screen.queryByLabelText('Probe key')).not.toBeInTheDocument()
  })

  it('creates a location from the bootstrap values', async () => {
    const api = makeApi([])
    const created = { ...location, id: 'location-2', code: 'fra-1', name: 'Frankfurt', ip_address: '198.51.100.20', concurrency: 24 }
    api.adminCreateCheckLocation.mockResolvedValue(created)
    render(<CheckLocationsSection api={api} />)

    await screen.findByText('No check locations configured')
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Add location' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Frankfurt' } })
    fireEvent.change(screen.getByLabelText(/^Location code/), { target: { value: 'fra-1' } })
    fireEvent.change(screen.getByLabelText(/^Public IP address/), { target: { value: '198.51.100.20' } })
    fireEvent.change(screen.getByLabelText(/^Probe key/), { target: { value: '0123456789abcdef0123456789abcdef' } })
    fireEvent.change(screen.getByLabelText(/^Concurrency/), { target: { value: '24' } })
    fireEvent.click(submit)

    await waitFor(() => expect(api.adminCreateCheckLocation).toHaveBeenCalledWith({
      code: 'fra-1',
      name: 'Frankfurt',
      ip_address: '198.51.100.20',
      port: 8443,
      key: '0123456789abcdef0123456789abcdef',
      active: true,
      enforce_ip: true,
      concurrency: 24,
    }))
    expect(await screen.findByText('Frankfurt')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('0123456789abcdef0123456789abcdef')).not.toBeInTheDocument()
  })

  it('keeps the immutable code and current credential when editing without a key', async () => {
    const api = makeApi()
    api.adminUpdateCheckLocation.mockResolvedValue({ ...location, name: 'Amsterdam West' })
    render(<CheckLocationsSection api={api} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Amsterdam' }))
    const code = screen.getByLabelText(/^Location code/)
    const key = screen.getByLabelText(/^Probe key/)
    expect(code).toBeDisabled()
    expect(key).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Amsterdam West' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))

    await waitFor(() => expect(api.adminUpdateCheckLocation).toHaveBeenCalledOnce())
    const [locationId, input] = api.adminUpdateCheckLocation.mock.calls[0]
    expect(locationId).toBe('location-1')
    expect(input).toEqual({
      code: 'ams-1',
      name: 'Amsterdam West',
      ip_address: '203.0.113.10',
      port: 8443,
      active: true,
      enforce_ip: true,
      concurrency: 16,
    })
    expect(input).not.toHaveProperty('key')
  })
})
