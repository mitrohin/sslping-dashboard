import { useRef, useState } from 'react'
import { FileImage, FileText, Paperclip, X } from 'lucide-react'
import type { SupportAttachment } from '../../api/types'
import { IconButton } from '../../components/ui'
import './support-attachments.css'

export const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_SUPPORT_ATTACHMENTS = 5
export const SUPPORT_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,application/pdf'

const allowedTypes = new Set(SUPPORT_ATTACHMENT_ACCEPT.split(','))

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentPicker({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const select = (incoming: FileList | null) => {
    if (!incoming) return
    const next = [...files]
    for (const file of Array.from(incoming)) {
      if (!allowedTypes.has(file.type)) {
        setError(`${file.name}: only JPEG, PNG, GIF, WebP and PDF are supported.`)
        continue
      }
      if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) {
        setError(`${file.name}: the maximum file size is 5 MB.`)
        continue
      }
      if (next.length >= MAX_SUPPORT_ATTACHMENTS) {
        setError('You can attach up to 5 files to one message.')
        break
      }
      if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file)
    }
    if (next.length !== files.length) onChange(next)
    if (next.length > files.length) setError('')
    if (input.current) input.current.value = ''
  }

  return (
    <div className="support-attachment-picker">
      <input ref={input} type="file" multiple accept={SUPPORT_ATTACHMENT_ACCEPT} disabled={disabled || files.length >= MAX_SUPPORT_ATTACHMENTS} onChange={(event) => select(event.target.files)} />
      <button type="button" className="support-attachment-add" onClick={() => input.current?.click()} disabled={disabled || files.length >= MAX_SUPPORT_ATTACHMENTS}>
        <Paperclip size={16} /> Attach files <span>images or PDF · 5 MB each</span>
      </button>
      {files.length > 0 && <div className="support-pending-files">{files.map((file) => <span key={`${file.name}-${file.size}-${file.lastModified}`}><FileText size={15} /><span>{file.name}<small>{formatAttachmentSize(file.size)}</small></span><IconButton type="button" label={`Remove ${file.name}`} onClick={() => onChange(files.filter((item) => item !== file))}><X size={14} /></IconButton></span>)}</div>}
      {error && <p className="support-attachment-error" role="alert">{error}</p>}
    </div>
  )
}

export function AttachmentList({ attachments, onOpen, busy = false }: { attachments?: SupportAttachment[]; onOpen: (attachment: SupportAttachment) => void; busy?: boolean }) {
  if (!attachments?.length) return null
  return <div className="support-attachments" aria-label="Attachments">{attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => onOpen(attachment)} disabled={busy}>{attachment.content_type === 'application/pdf' ? <FileText size={17} /> : <FileImage size={17} />}<span>{attachment.file_name}<small>{formatAttachmentSize(attachment.size_bytes)}</small></span></button>)}</div>
}

export function openAttachmentBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
