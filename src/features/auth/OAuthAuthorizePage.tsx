import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Check, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useLocation } from 'react-router'
import { ApiError } from '../../api/client'
import type { OAuthAuthorizationRequest, OAuthAuthorizationPreview } from '../../api/types'
import { useAuth } from '../../app/AuthProvider'
import { Brand } from '../../components/AppShell'
import { Button, FeedbackBanner } from '../../components/ui'
import './oauth.css'

const scopeCopy: Record<string, { title: string; description: string }> = {
  'monitors:read': { title: 'View monitors', description: 'Read monitor configuration, status, checks, and metrics.' },
  'monitors:write': { title: 'Manage monitors', description: 'Create monitors and change their configuration or paused state.' },
  'incidents:read': { title: 'View incidents', description: 'Read incidents and their timelines.' },
  'incidents:write': { title: 'Operate incidents', description: 'Acknowledge, assign, resolve, and comment on incidents.' },
  'maintenance:read': { title: 'View maintenance', description: 'Read planned maintenance windows.' },
  'maintenance:write': { title: 'Manage maintenance', description: 'Create, change, and delete maintenance windows.' },
}

function authorizationRequest(search: string): OAuthAuthorizationRequest {
  const query = new URLSearchParams(search)
  return {
    response_type: query.get('response_type') ?? '',
    client_id: query.get('client_id') ?? '',
    redirect_uri: query.get('redirect_uri') ?? '',
    scope: query.get('scope') ?? '',
    state: query.get('state') ?? '',
    code_challenge: query.get('code_challenge') ?? '',
    code_challenge_method: query.get('code_challenge_method') ?? '',
    resource: query.get('resource') ?? '',
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail || 'The authorization request is not valid.'
  if (error instanceof Error) return error.message
  return 'SSLPing could not process this authorization request.'
}

function redirectDestination(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export default function OAuthAuthorizePage() {
  const { api } = useAuth()
  const location = useLocation()
  const request = useMemo(() => authorizationRequest(location.search), [location.search])
  const [preview, setPreview] = useState<OAuthAuthorizationPreview>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<'approve' | 'deny'>()

  useEffect(() => {
    let cancelled = false
    setError(undefined)
    api.previewOAuthAuthorization(request)
      .then((result) => { if (!cancelled) setPreview(result) })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause)) })
    return () => { cancelled = true }
  }, [api, request])

  const decide = async (approved: boolean) => {
    setBusy(approved ? 'approve' : 'deny')
    setError(undefined)
    try {
      const result = await api.decideOAuthAuthorization({ ...request, approved })
      window.location.assign(result.redirect_to)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(undefined)
    }
  }

  return (
    <main className="oauth-consent">
      <div className="oauth-consent__brand"><Brand /></div>
      <section className="oauth-consent__card" aria-labelledby="oauth-title">
        <div className="oauth-consent__icon" aria-hidden="true"><Bot size={30} /></div>
        <div className="oauth-consent__intro">
          <span className="oauth-consent__eyebrow"><ShieldCheck size={15} /> Secure connection</span>
          <h1 id="oauth-title">Connect {preview?.client_name || 'this AI client'} to SSLPing?</h1>
          <p>
            The client will act as your SSLPing account in the selected workspace. You can stop access by
            changing your password or disabling the workspace membership.
          </p>
          {preview && <small>After approval, you will return to {redirectDestination(preview.redirect_uri)}.</small>}
        </div>

        {error && <FeedbackBanner tone="error" title="Unable to authorize">{error}</FeedbackBanner>}

        {preview && (
          <>
            <div className="oauth-consent__workspace">
              <span>Workspace</span>
              <strong>{preview.workspace.name}</strong>
              <small>Your current workspace and role ({preview.role}) will be used.</small>
            </div>

            <div className="oauth-consent__permissions">
              <h2>Requested access</h2>
              <ul>
                {preview.granted_scopes.map((scope) => {
                  const copy = scopeCopy[scope] ?? { title: scope, description: 'Use this SSLPing permission.' }
                  return (
                    <li key={scope}>
                      <span><Check size={16} /></span>
                      <div><strong>{copy.title}</strong><small>{copy.description}</small></div>
                    </li>
                  )
                })}
              </ul>
              {preview.excluded_scopes.length > 0 && (
                <p className="oauth-consent__limited">
                  Your workspace role does not allow: {preview.excluded_scopes.join(', ')}.
                </p>
              )}
              {preview.granted_scopes.length === 0 && (
                <FeedbackBanner tone="error" title="No permissions can be granted">
                  Your current workspace role cannot approve any of the requested permissions.
                </FeedbackBanner>
              )}
            </div>

            <div className="oauth-consent__notice">
              <LockKeyhole size={17} />
              <span>SSLPing never sends monitor secrets, heartbeat credentials, or reporter network metadata through MCP.</span>
            </div>

            <div className="oauth-consent__actions">
              <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void decide(false)}>
                <ArrowLeft size={17} /> {busy === 'deny' ? 'Cancelling…' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                disabled={Boolean(busy) || preview.granted_scopes.length === 0}
                onClick={() => void decide(true)}
              >
                <ShieldCheck size={17} /> {busy === 'approve' ? 'Connecting…' : 'Allow access'}
              </Button>
            </div>
          </>
        )}

        {!preview && !error && <p className="oauth-consent__loading">Checking the authorization request…</p>}
      </section>
      <p className="oauth-consent__footer">Only approve clients you recognize. SSLPing records MCP changes in the workspace audit log.</p>
    </main>
  )
}
