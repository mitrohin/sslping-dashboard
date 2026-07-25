import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeartbeatCredentialModal } from './HeartbeatCredentialModal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('HeartbeatCredentialModal', () => {
  it('warns about the one-time secret and copies the full heartbeat URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const previousClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onClose = vi.fn()
    const url = 'https://api.sslping.test/v1/heartbeat/one-time-secret'

    try {
      render(<HeartbeatCredentialModal credential={{ monitorName: 'Nightly backup', url }} onClose={onClose} />)

      expect(screen.getByRole('dialog', { name: /heartbeat is ready/i })).toBeInTheDocument()
      expect(screen.getByText('Save this secret URL now')).toBeInTheDocument()
      expect(screen.getByText(/shown only once/i)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Heartbeat URL' })).toHaveValue(url)

      fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
      expect(screen.getByRole('status')).toHaveTextContent('Heartbeat URL copied.')

      fireEvent.click(screen.getByRole('button', { name: /i’ve saved the url/i }))
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: previousClipboard })
    }
  })

  it('selects the URL and reports a recoverable error when clipboard access is blocked', async () => {
    const previousClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Not allowed')) },
    })

    try {
      render(<HeartbeatCredentialModal credential={{ monitorName: 'Backup', url: 'https://api.test/v1/heartbeat/secret' }} onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('copy it manually')
      expect(screen.getByRole('textbox', { name: 'Heartbeat URL' })).toHaveFocus()
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: previousClipboard })
    }
  })
})
