import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Check, Copy, MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Region } from '../../api'
import { useAuth } from '../../app/AuthProvider'
import { isDemoSession } from '../../app/DashboardGate'
import { useI18n } from '../../app/I18nProvider'
import { Badge, Button, EmptyState, FeedbackBanner, IconButton, PageHeader, PageLoadingSkeleton, Panel } from '../../components/ui'
import './checker-ips.css'

const demoRegions: Region[] = [
  { id: 'ams-1', name: 'Amsterdam', color: '#34d77b', ip_address: '192.0.2.42', capabilities: ['http', 'keyword', 'tcp', 'udp', 'tls', 'dns', 'domain', 'reachability'], status: 'available' },
  { id: 'nyc-1', name: 'New York', color: '#58a6ff', ip_address: '198.51.100.24', capabilities: ['http', 'keyword', 'tcp', 'udp', 'tls', 'dns', 'domain', 'reachability'], status: 'available' },
  { id: 'sin-1', name: 'Singapore', color: '#a78bfa', ip_address: '203.0.113.10', capabilities: ['http', 'keyword', 'tcp', 'udp', 'tls', 'dns', 'domain', 'reachability'], status: 'connecting' },
]

function checkerColor(region: Region): CSSProperties {
  return { backgroundColor: region.color || '#34d77b' }
}

export default function CheckerIPsPage() {
  const { api } = useAuth()
  const { locale, t } = useI18n()
  const demo = isDemoSession()
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    setCopied('')
    setCopyError(false)
    try {
      const items = demo ? demoRegions : (await api.listRegions()).items
      setRegions(items)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [api, demo])

  useEffect(() => {
    void load()
  }, [load])

  const publishedRegions = useMemo(() => {
    const seenAddresses = new Set<string>()
    return regions
      .filter((region): region is Region & { ip_address: string } => Boolean(region.ip_address?.trim()))
      .map((region) => ({ ...region, ip_address: region.ip_address.trim() }))
      .sort((left, right) => left.name.localeCompare(right.name, locale))
      .filter((region) => {
        if (seenAddresses.has(region.ip_address)) return false
        seenAddresses.add(region.ip_address)
        return true
      })
  }, [locale, regions])

  const addresses = useMemo(
    () => Array.from(new Set(publishedRegions.map((region) => region.ip_address))),
    [publishedRegions],
  )

  const copy = async (value: string, marker: string) => {
    setCopyError(false)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable')
      await navigator.clipboard.writeText(value)
      setCopied(marker)
    } catch {
      setCopied('')
      setCopyError(true)
    }
  }

  return (
    <div className="page page--wide checker-ips-page">
      <PageHeader
        title={t('checkerIPs.title')}
        description={t('checkerIPs.description')}
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} aria-hidden="true" /> {t('checkerIPs.refresh')}
          </Button>
        }
      />

      <section className="checker-ips-hero" aria-labelledby="checker-ips-hero-title">
        <span className="checker-ips-hero__icon"><ShieldCheck size={28} aria-hidden="true" /></span>
        <div>
          <h2 id="checker-ips-hero-title">{t('checkerIPs.heroTitle')}</h2>
          <p>{t('checkerIPs.heroDescription')}</p>
          <span className="checker-ips-hero__source">{demo ? t('checkerIPs.demoNotice') : t('checkerIPs.liveSource')}</span>
        </div>
      </section>

      {copyError && <FeedbackBanner tone="error">{t('checkerIPs.copyFailed')}</FeedbackBanner>}

      <div className="checker-ips-layout">
        <Panel className="checker-ips-list-panel">
          <header className="checker-ips-list-panel__header">
            <div>
              <h2>{t('checkerIPs.allowlistTitle')}</h2>
              <p>{t('checkerIPs.allowlistDescription')}</p>
            </div>
            {!loading && !loadFailed && addresses.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copy(addresses.join('\n'), 'all')}
              >
                {copied === 'all' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied === 'all' ? t('checkerIPs.copiedAll') : t('checkerIPs.copyAll')}
              </Button>
            )}
          </header>

          {loading ? (
            <div className="checker-ips-loading"><PageLoadingSkeleton label={t('checkerIPs.loading')} rows={3} /></div>
          ) : loadFailed ? (
            <EmptyState
              icon={<ShieldCheck size={34} />}
              title={t('checkerIPs.loadFailed')}
              description={t('checkerIPs.loadFailedHint')}
              action={<Button onClick={() => void load()}>{t('common.tryAgain')}</Button>}
            />
          ) : publishedRegions.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={34} />}
              title={t('checkerIPs.emptyTitle')}
              description={t('checkerIPs.emptyDescription')}
            />
          ) : (
            <>
              <div className="checker-ips-list-panel__count">{t('checkerIPs.addressCount', { count: addresses.length })}</div>
              <ul className="checker-ips-list">
                {publishedRegions.map((region) => {
                  const address = region.ip_address
                  const copiedAddress = copied === address
                  return (
                    <li key={region.id}>
                      <div className="checker-ips-location">
                        <span className="checker-ips-location__marker" style={checkerColor(region)} aria-hidden="true"><MapPin size={16} /></span>
                        <div>
                          <strong>{region.name}</strong>
                          <span>{region.display_code || region.id}</span>
                        </div>
                        <Badge tone={region.status === 'available' ? 'success' : 'warning'}>{t(`checkerIPs.status.${region.status}`)}</Badge>
                      </div>
                      <div className="checker-ips-address">
                        <div>
                          <code>{address}</code>
                          <span>{t(address.includes(':') ? 'checkerIPs.ipv6' : 'checkerIPs.ipv4')}</span>
                        </div>
                        <IconButton
                          className={copiedAddress ? 'checker-ips-address__copy is-copied' : 'checker-ips-address__copy'}
                          label={copiedAddress ? t('checkerIPs.copied') : t('checkerIPs.copyAddress', { ip: address })}
                          onClick={() => void copy(address, address)}
                        >
                          {copiedAddress ? <Check size={18} /> : <Copy size={18} />}
                        </IconButton>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Panel>

        <Panel className="checker-ips-guide">
          <h2>{t('checkerIPs.guideTitle')}</h2>
          <ol>
            <li>
              <span>1</span>
              <div><strong>{t('checkerIPs.guideStep1')}</strong><p>{t('checkerIPs.guideStep1Hint')}</p></div>
            </li>
            <li>
              <span>2</span>
              <div><strong>{t('checkerIPs.guideStep2')}</strong><p>{t('checkerIPs.guideStep2Hint')}</p></div>
            </li>
            <li>
              <span>3</span>
              <div><strong>{t('checkerIPs.guideStep3')}</strong><p>{t('checkerIPs.guideStep3Hint')}</p></div>
            </li>
          </ol>
        </Panel>
      </div>
    </div>
  )
}
