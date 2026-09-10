import { lazy, Suspense, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, ApplicationUpdateNotice } from './AppErrorBoundary'
import { recoverableImport } from '../lib/recoverableImport'

afterEach(() => {
  document.documentElement.lang = 'en'
  vi.restoreAllMocks()
})

describe('application recovery', () => {
  it('offers reload when the initial chunk rejected before the update notice mounted', async () => {
    let settled = false
    void recoverableImport(async () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/old.js') })
      .then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    render(<ApplicationUpdateNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent('An update is available')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(settled).toBe(false)
  })

  it('keeps an existing unsaved form mounted when an additional chunk fails', async () => {
    const MissingDialog = lazy(() => recoverableImport<{ default: () => null }>(async () => {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/dialog.js')
    }))
    function Screen() {
      const [open, setOpen] = useState(false)
      const [draft, setDraft] = useState('')
      return <><ApplicationUpdateNotice /><input aria-label="Unsaved draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button onClick={() => setOpen(true)}>Open billing</button>
        {open && <Suspense fallback={<p>Loading billing</p>}><MissingDialog /></Suspense>}
      </>
    }
    render(<Screen />)
    const input = screen.getByRole('textbox', { name: 'Unsaved draft' })
    fireEvent.change(input, { target: { value: 'Keep my changes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open billing' }))
    expect(await screen.findByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toBe(input)
    expect(input).toHaveValue('Keep my changes')
  })

  it('offers full navigation after a render error unmounts the router', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function BrokenScreen(): never { throw new Error('Render failed') }
    render(<AppErrorBoundary><BrokenScreen /></AppErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to open this screen')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument()
  })
})
