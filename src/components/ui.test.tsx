import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Select } from './ui'

describe('Select', () => {
  it('renders a dedicated, non-interactive chevron slot', () => {
    const { container } = render(
      <Select aria-label="Plan">
        <option value="free">Free</option>
      </Select>,
    )

    expect(screen.getByRole('combobox', { name: 'Plan' })).toHaveClass('select')
    expect(container.querySelector('.select-control')).toContainElement(screen.getByRole('combobox', { name: 'Plan' }))
    expect(container.querySelector('.select-control__chevron')).toHaveAttribute('aria-hidden', 'true')
  })
})
