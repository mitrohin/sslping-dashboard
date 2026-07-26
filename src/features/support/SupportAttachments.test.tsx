import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentPicker, MAX_SUPPORT_ATTACHMENT_BYTES } from './SupportAttachments'

describe('AttachmentPicker', () => {
  it('selects an allowed file and removes it only through its remove button', () => {
    const onChange = vi.fn()
    const { rerender } = render(<AttachmentPicker files={[]} onChange={onChange} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' })

    fireEvent.change(input, { target: { files: [file] } })
    expect(onChange).toHaveBeenLastCalledWith([file])

    rerender(<AttachmentPicker files={[file]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove report.pdf' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('rejects unsupported and oversized files before upload', () => {
    const onChange = vi.fn()
    const { rerender } = render(<AttachmentPicker files={[]} onChange={onChange} />)
    let input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [new File(['text'], 'secret.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('only JPEG, PNG, GIF, WebP and PDF')
    expect(onChange).not.toHaveBeenCalled()

    rerender(<AttachmentPicker files={[]} onChange={onChange} />)
    input = document.querySelector('input[type="file"]') as HTMLInputElement
    const large = new File([new Uint8Array(MAX_SUPPORT_ATTACHMENT_BYTES + 1)], 'large.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [large] } })
    expect(screen.getByRole('alert')).toHaveTextContent('maximum file size is 5 MB')
  })
})
