import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProblemReportIPProfile } from '../../api/types'
import { IPProfilesSection } from './IPProfilesSection'

const profile: ProblemReportIPProfile = {
  ip_address: '203.0.113.77',
  country: 'NL',
  asn: '210976',
  provider: 'Timeweb, LLP',
  colo: 'AMS',
  as_organization: 'Timeweb, LLP',
  is_eu_country: '1',
  city: 'Amsterdam',
  continent: 'EU',
  region: 'North Holland',
  region_code: 'NH',
  timezone: 'Europe/Amsterdam',
  longitude: '4.88969',
  latitude: '52.37403',
  postal_code: '1012',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T13:30:00Z',
}

afterEach(cleanup)

describe('IPProfilesSection', () => {
  it('shows every collected field and limits the rendered journal to 25 rows', async () => {
    const items = Array.from({ length: 26 }, (_, index) => ({ ...profile, ip_address: `203.0.113.${index + 1}` }))
    const api = { adminListProblemReportIPProfiles: vi.fn().mockResolvedValue({ items }) }
    render(<IPProfilesSection api={api} />)

    expect(await screen.findByText('203.0.113.1')).toBeInTheDocument()
    expect(screen.getAllByText('Amsterdam')).toHaveLength(25)
    expect(screen.getAllByText('North Holland')).toHaveLength(25)
    expect(screen.getAllByText('Timeweb, LLP').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Europe/Amsterdam')).toHaveLength(25)
    expect(screen.getAllByText('4.88969')).toHaveLength(25)
    expect(screen.getAllByText('52.37403')).toHaveLength(25)
    expect(screen.queryByText('203.0.113.26')).not.toBeInTheDocument()
    expect(api.adminListProblemReportIPProfiles).toHaveBeenCalledWith(undefined)
  })

  it('starts a database search only after three characters', async () => {
    const api = { adminListProblemReportIPProfiles: vi.fn().mockResolvedValue({ items: [profile] }) }
    render(<IPProfilesSection api={api} />)
    await screen.findByText(profile.ip_address)
    const input = screen.getByRole('textbox', { name: 'Search IP address' })

    fireEvent.change(input, { target: { value: '20' } })
    expect(await screen.findByText('Enter at least 3 characters to search the database.')).toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    expect(api.adminListProblemReportIPProfiles).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: '203' } })
    await waitFor(() => expect(api.adminListProblemReportIPProfiles).toHaveBeenLastCalledWith('203'), { timeout: 1000 })
    expect(api.adminListProblemReportIPProfiles).toHaveBeenCalledTimes(2)
  })
})
