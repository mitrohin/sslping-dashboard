import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
})
