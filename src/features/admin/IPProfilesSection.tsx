import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Database, Search } from 'lucide-react'
import type { ApiClient } from '../../api/client'
import type { ProblemReportIPProfile } from '../../api/types'
import { useI18n } from '../../app/I18nProvider'
import { FeedbackBanner, Panel } from '../../components/ui'
import { formatDate } from '../../lib/format'

type IPProfilesApi = Pick<ApiClient, 'adminListProblemReportIPProfiles'>

function asMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

function valueOrDash(value: string) {
  return value || '—'
}

export function IPProfilesSection({ api }: { api: IPProfilesApi }) {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<ProblemReportIPProfile[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestID = useRef(0)
  const term = search.trim()
  const effectiveSearch = term.length >= 3 ? term : ''

  const load = useCallback(async (query: string) => {
    const currentRequest = ++requestID.current
    setLoading(true)
    try {
      const response = await api.adminListProblemReportIPProfiles(query || undefined)
      if (currentRequest !== requestID.current) return
      setProfiles((response.items ?? []).slice(0, 25))
      setError('')
    } catch (reason) {
      if (currentRequest === requestID.current) setError(asMessage(reason, t('admin.ipCache.error')))
    } finally {
      if (currentRequest === requestID.current) setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(effectiveSearch), effectiveSearch ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [effectiveSearch, load])

  return <section className="admin-ip-cache-section">
    <div className="admin-section-heading">
      <div><h2>{t('admin.ipCache.title')}</h2><p>{t('admin.ipCache.description')}</p></div>
      <span className="admin-ip-cache-count">{t('admin.ipCache.shown', { count: profiles.length })}</span>
    </div>
    {error && <FeedbackBanner tone="error" onDismiss={() => setError('')}>{error}</FeedbackBanner>}
    <label className="admin-search admin-ip-cache-search">
      <Search size={18} />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('admin.ipCache.search')} aria-label={t('admin.ipCache.search')} inputMode="text" autoComplete="off" />
    </label>
    {term.length > 0 && term.length < 3 && <p className="admin-ip-cache-hint">{t('admin.ipCache.searchHint')}</p>}
    <Panel className="admin-ip-cache-panel">
      {loading ? <div className="admin-ip-cache-state"><Activity size={27} /><strong>{t('admin.ipCache.loading')}</strong></div> : profiles.length === 0 ? <div className="admin-ip-cache-state"><Database size={30} /><strong>{t('admin.ipCache.empty')}</strong><span>{t(effectiveSearch ? 'admin.ipCache.emptySearch' : 'admin.ipCache.emptyHint')}</span></div> :
        <div className="admin-ip-cache-scroll">
          <table>
            <thead><tr>
              <th>{t('admin.ipCache.ip')}</th><th>{t('admin.ipCache.updated')}</th><th>{t('admin.ipCache.created')}</th>
              <th>{t('admin.ipCache.country')}</th><th>{t('admin.ipCache.city')}</th><th>{t('admin.ipCache.region')}</th><th>{t('admin.ipCache.regionCode')}</th><th>{t('admin.ipCache.continent')}</th><th>{t('admin.ipCache.eu')}</th>
              <th>{t('admin.ipCache.asn')}</th><th>{t('admin.ipCache.provider')}</th><th>{t('admin.ipCache.asOrganization')}</th><th>{t('admin.ipCache.colo')}</th>
              <th>{t('admin.ipCache.timezone')}</th><th>{t('admin.ipCache.postalCode')}</th><th>{t('admin.ipCache.latitude')}</th><th>{t('admin.ipCache.longitude')}</th>
            </tr></thead>
            <tbody>{profiles.map((profile) => <tr key={profile.ip_address}>
              <td><code>{profile.ip_address}</code></td>
              <td><time dateTime={profile.updated_at}>{formatDate(profile.updated_at, { includeYear: true, includeSeconds: true })}</time></td>
              <td><time dateTime={profile.created_at}>{formatDate(profile.created_at, { includeYear: true, includeSeconds: true })}</time></td>
              <td>{valueOrDash(profile.country)}</td><td>{valueOrDash(profile.city)}</td><td>{valueOrDash(profile.region)}</td><td>{valueOrDash(profile.region_code)}</td><td>{valueOrDash(profile.continent)}</td><td>{profile.is_eu_country === '1' ? t('admin.ipCache.yes') : profile.is_eu_country ? t('admin.ipCache.no') : '—'}</td>
              <td>{valueOrDash(profile.asn)}</td><td>{valueOrDash(profile.provider)}</td><td>{valueOrDash(profile.as_organization)}</td><td>{valueOrDash(profile.colo)}</td>
              <td>{valueOrDash(profile.timezone)}</td><td>{valueOrDash(profile.postal_code)}</td><td>{valueOrDash(profile.latitude)}</td><td>{valueOrDash(profile.longitude)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </Panel>
  </section>
}
