import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { FeedbackBanner, Modal, Select } from './ui'

describe('FeedbackBanner', () => {
  it('renders a consistent success notification and can be dismissed', () => {
    let dismissed = false
    render(
      <FeedbackBanner tone="success" onDismiss={() => { dismissed = true }}>
        Annual billing discount updated.
      </FeedbackBanner>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Changes saved')
    expect(screen.getByRole('status')).toHaveTextContent('Annual billing discount updated.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(dismissed).toBe(true)
  })

  it('announces errors assertively', () => {
    render(<FeedbackBanner tone="error">Could not save the setting.</FeedbackBanner>)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
  })
})

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

describe('Modal', () => {
  it('moves focus into the dialog and restores it after closing', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open plans</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Workspace plans">
          <button type="button">Choose plan</button>
        </Modal>
      </>
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open plans' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps page scrolling locked until the last stacked modal closes', async () => {
    function Harness() {
      const [parentOpen, setParentOpen] = useState(true)
      const [childOpen, setChildOpen] = useState(true)
      return <>
        <Modal open={parentOpen} onClose={() => setParentOpen(false)} title="Parent modal">
          <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
        </Modal>
        <Modal open={childOpen} onClose={() => setChildOpen(false)} title="Child modal">
          <button type="button" onClick={() => setChildOpen(false)}>Close child modal</button>
        </Modal>
      </>
    }

    render(<Harness />)
    await waitFor(() => expect(document.body).toHaveClass('modal-open'))
    fireEvent.click(screen.getByRole('button', { name: 'Close child modal' }))
    expect(screen.queryByRole('dialog', { name: 'Child modal' })).not.toBeInTheDocument()
    expect(document.body).toHaveClass('modal-open')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Parent modal' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveClass('modal-open')
  })

  it('does not reset input focus when an inline close handler changes during typing', async () => {
    function Harness() {
      const [value, setValue] = useState('')
      return (
        <Modal open onClose={() => undefined} title="Manage tags">
          <input aria-label="Tag search" value={value} onChange={(event) => setValue(event.target.value)} />
        </Modal>
      )
    }

    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Tag search' })
    input.focus()
    fireEvent.change(input, { target: { value: 'release' } })

    expect(input).toHaveValue('release')
    expect(input).toHaveFocus()
  })
})
