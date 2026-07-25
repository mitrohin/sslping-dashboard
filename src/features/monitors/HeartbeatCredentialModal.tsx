import { useRef, useState } from 'react'
import { Check, Clipboard, HeartPulse, ShieldAlert } from 'lucide-react'
import { Button, Modal } from '../../components/ui'

export interface HeartbeatCredential {
  monitorName: string
  url: string
}

export function HeartbeatCredentialModal({
  credential,
  onClose,
}: {
  credential: HeartbeatCredential
  onClose: () => void
}) {
  const urlInput = useRef<HTMLInputElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  const copyUrl = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(credential.url)
      setCopyState('copied')
    } catch {
      setCopyState('error')
      urlInput.current?.focus()
      urlInput.current?.select()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={<>Heartbeat <span className="success-text">is ready</span></>}
      icon={<HeartPulse size={31} />}
      width="lg"
    >
      <div className="heartbeat-credential">
        <div className="heartbeat-credential__warning" role="note">
          <ShieldAlert size={23} aria-hidden="true" />
          <div>
            <strong>Save this secret URL now</strong>
            <p>For security, it is shown only once. Anyone with this URL can record a heartbeat for {credential.monitorName}.</p>
          </div>
        </div>

        <label className="field heartbeat-credential__field">
          <span className="field__label">Heartbeat URL</span>
          <span className="field__hint">Send a GET or POST request to this URL after every successful job run.</span>
          <span className="heartbeat-credential__control">
            <input
              ref={urlInput}
              aria-label="Heartbeat URL"
              readOnly
              spellCheck={false}
              value={credential.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" variant="secondary" onClick={() => void copyUrl()}>
              {copyState === 'copied' ? <Check size={17} /> : <Clipboard size={17} />}
              {copyState === 'copied' ? 'Copied' : 'Copy URL'}
            </Button>
          </span>
        </label>

        {copyState === 'copied' && <p className="heartbeat-credential__feedback success-text" role="status">Heartbeat URL copied.</p>}
        {copyState === 'error' && <p className="heartbeat-credential__feedback danger-text" role="alert">Automatic copy was blocked. The URL is selected so you can copy it manually.</p>}

        <div className="heartbeat-credential__actions">
          <p>Rotating the URL later immediately invalidates this one.</p>
          <Button type="button" onClick={onClose}>I’ve saved the URL</Button>
        </div>
      </div>
    </Modal>
  )
}
