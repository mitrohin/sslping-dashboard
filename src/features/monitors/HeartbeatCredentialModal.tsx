import { useRef, useState } from 'react'
import { Check, Clipboard, HeartPulse, ShieldAlert } from 'lucide-react'
import { Button, Modal } from '../../components/ui'
import { useI18n } from '../../app/I18nProvider'

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
  const { t } = useI18n()
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
      title={<>Heartbeat <span className="success-text">{t('heartbeat.ready')}</span></>}
      icon={<HeartPulse size={31} />}
      width="lg"
    >
      <div className="heartbeat-credential">
        <div className="heartbeat-credential__warning" role="note">
          <ShieldAlert size={23} aria-hidden="true" />
          <div>
            <strong>{t('heartbeat.saveNow')}</strong>
            <p>{t('heartbeat.once', { name: credential.monitorName })}</p>
          </div>
        </div>

        <label className="field heartbeat-credential__field">
          <span className="field__label">Heartbeat URL</span>
          <span className="field__hint">{t('heartbeat.hint')}</span>
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
              {copyState === 'copied' ? t('heartbeat.copied') : t('heartbeat.copy')}
            </Button>
          </span>
        </label>

        {copyState === 'copied' && <p className="heartbeat-credential__feedback success-text" role="status">{t('heartbeat.copiedFeedback')}</p>}
        {copyState === 'error' && <p className="heartbeat-credential__feedback danger-text" role="alert">{t('heartbeat.copyBlocked')}</p>}

        <div className="heartbeat-credential__actions">
          <p>{t('heartbeat.rotateWarning')}</p>
          <Button type="button" onClick={onClose}>{t('heartbeat.saved')}</Button>
        </div>
      </div>
    </Modal>
  )
}
