import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('suggests existing workspace tags and keeps manually entered tags', async () => {
    const onSubmit = vi.fn()
    render(<MonitorForm initialValue={{ ...defaultMonitorDraft, name: 'API', target: 'https://example.com' }} availableTags={['production', 'critical', 'payments']} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('tag-picker-control'))
    const tags = screen.getByRole('textbox', { name: 'Filter or create tags' })
    const tagList = screen.getByRole('listbox', { name: 'Workspace tags' })
    fireEvent.change(tags, { target: { value: 'prod' } })
    expect(within(tagList).getByRole('option', { name: /production/i })).toBeInTheDocument()
    expect(within(tagList).queryByRole('option', { name: /critical/i })).not.toBeInTheDocument()

    fireEvent.click(within(tagList).getByRole('option', { name: /production/i }))
    fireEvent.change(tags, { target: { value: 'custom' } })
    fireEvent.click(within(tagList).getByRole('option', { name: /create “custom”/i }))
    expect(screen.getByRole('button', { name: 'Remove tag production' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove tag custom' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tag-picker-control'))
    expect(screen.getByRole('button', { name: 'Remove tag custom' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag custom' }))
    expect(screen.queryByRole('button', { name: 'Remove tag custom' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('tag-picker-control'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter or create tags' }), { target: { value: 'custom' } })
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Workspace tags' })).getByRole('option', { name: /create “custom”/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tags: ['production', 'custom'] })))
  })

  it('only offers known HTTP statuses and submits selected rules', async () => {
    const onSubmit = vi.fn()
    render(<MonitorForm initialValue={{ ...defaultMonitorDraft, name: 'API', target: 'https://example.com' }} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced settings/i }))
    expect(screen.getByText('2xx')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('http-status-control'))
    expect(screen.getByRole('listbox', { name: 'Known HTTP statuses' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /999/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /404 Not Found/ }))
    expect(screen.getByRole('button', { name: 'Remove 404' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('http-status-control'))
    expect(screen.getByRole('button', { name: 'Remove 404' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove 404' }))
    expect(screen.queryByRole('button', { name: 'Remove 404' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('http-status-control'))
    fireEvent.click(screen.getByRole('option', { name: /404 Not Found/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      allowedStatusClasses: [2],
      allowedStatusCodes: [404],
    })))
  })
})
