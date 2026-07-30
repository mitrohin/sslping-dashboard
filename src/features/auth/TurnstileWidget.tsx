import { useEffect, useRef, useState } from 'react'

type TurnstileAPI = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI
  }
}

let scriptPromise: Promise<TurnstileAPI> | undefined

function loadTurnstile(): Promise<TurnstileAPI> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<TurnstileAPI>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sslping-turnstile]')
    const script = existing ?? document.createElement('script')
    const onLoad = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile API did not initialize'))
    const onError = () => reject(new Error('Turnstile script failed to load'))

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.sslpingTurnstile = 'true'
      document.head.appendChild(script)
    }
  }).catch((error) => {
    scriptPromise = undefined
    throw error
  })

  return scriptPromise
}

export function TurnstileWidget({
  siteKey,
  resetSignal,
  onToken,
  action = 'register',
}: {
  siteKey: string
  resetSignal: number
  onToken: (token: string) => void
  action?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<TurnstileAPI | null>(null)
  const widgetIDRef = useRef<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return
        apiRef.current = api
        widgetIDRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          action,
          appearance: 'always',
          theme: 'auto',
          callback: (token: string) => {
            setFailed(false)
            onToken(token)
          },
          'expired-callback': () => onToken(''),
          'timeout-callback': () => onToken(''),
          'error-callback': () => {
            onToken('')
            setFailed(true)
          },
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (apiRef.current && widgetIDRef.current) apiRef.current.remove(widgetIDRef.current)
      widgetIDRef.current = null
      onToken('')
    }
  }, [action, onToken, siteKey])

  useEffect(() => {
    if (resetSignal === 0 || !apiRef.current || !widgetIDRef.current) return
    onToken('')
    setFailed(false)
    apiRef.current.reset(widgetIDRef.current)
  }, [onToken, resetSignal])

  return (
    <div className="auth-turnstile">
      <div ref={containerRef} />
      {failed && <div className="auth-message auth-message--error" role="alert">Security verification is temporarily unavailable. Please retry.</div>}
    </div>
  )
}
