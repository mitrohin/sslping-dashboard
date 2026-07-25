import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonitorForm, defaultMonitorDraft, type MonitorDraft } from './MonitorForm'

afterEach(() => {
  cleanup()
})

describe('MonitorForm legacy monitor compatibility', () => {
  it.each([
    ['tls', 'SSL / TLS', 'example.com:443'],
    ['domain', 'Domain expiry', 'example.com'],
  ] as const)('keeps an existing %s monitor editable without offering it during creation', async (type, label, target) => {
    const onSubmit = vi.fn()
    const initialValue: MonitorDraft = {
      ...defaultMonitorDraft,
      name: `Legacy ${label}`,
      type,
      target,
    }

    render(<MonitorForm initialValue={initialValue} lockType onSubmit={onSubmit} />)

    expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type, target })))
  })
})
