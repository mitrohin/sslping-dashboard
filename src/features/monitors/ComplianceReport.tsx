import { CircleAlert, CircleCheck, ClipboardCheck, Scale, TriangleAlert } from 'lucide-react'
import type { ComplianceCheckFinding, ComplianceReport as ComplianceReportData } from '../../api/types'
import { Badge } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { useI18n } from '../../app/I18nProvider'
import './compliance-report.css'

const toneByStatus = {
  pass: 'success',
  fail: 'danger',
  warning: 'warning',
  manual: 'neutral',
} as const

function FindingIcon({ status }: Pick<ComplianceCheckFinding, 'status'>) {
  if (status === 'pass') return <CircleCheck size={20} />
  if (status === 'fail') return <CircleAlert size={20} />
  if (status === 'warning') return <TriangleAlert size={20} />
  return <ClipboardCheck size={20} />
}

export function ComplianceReport({ report }: { report: ComplianceReportData }) {
  const { locale, t } = useI18n()

  const findingSummary = (finding: ComplianceCheckFinding) => {
    if (finding.id === 'policy_contents') {
      const detected = finding.summary.match(/^\s*(\d+)\s+of\s+5/i)?.[1] ?? '0'
      return t('complianceFindingSummary.policyContents', { detected })
    }
    return locale === 'en' ? finding.summary : t(`complianceFindingSummary.${finding.status}`)
  }

  return (
    <section className="compliance-report">
      <header className="compliance-report__header">
        <span className="compliance-report__icon"><Scale size={25} /></span>
        <div>
          <span className="compliance-report__eyebrow">{t('monitorDetail.preliminaryAudit')}</span>
          <h2>{t('monitorDetail.complianceReport')}</h2>
          <p>{t('monitorDetail.ru152fz')} · {formatDate(report.checked_at, { includeSeconds: true })}</p>
        </div>
        <div className="compliance-report__score">
          <strong>{report.summary.score}%</strong>
          <span>{t('monitorDetail.automatedScore')}</span>
        </div>
      </header>

      <div className="compliance-report__summary">
        <div><strong>{report.pages_scanned}</strong><span>{t('monitorDetail.pagesScanned')}</span></div>
        <div className="is-failed"><strong>{report.summary.failed}</strong><span>{t('monitorDetail.failedChecks')}</span></div>
        <div className="is-warning"><strong>{report.summary.warnings}</strong><span>{t('monitorDetail.warnings')}</span></div>
        <div><strong>{report.summary.manual}</strong><span>{t('monitorDetail.manualChecks')}</span></div>
      </div>

      <div className="compliance-report__checks">
        {report.checks.map((finding) => (
          <article className={`compliance-finding compliance-finding--${finding.status}`} key={finding.id}>
            <span className="compliance-finding__icon"><FindingIcon status={finding.status} /></span>
            <div className="compliance-finding__body">
              <header>
                <strong>{t(`complianceCheck.${finding.id}`)}</strong>
                <Badge tone={toneByStatus[finding.status]}>{t(`complianceStatus.${finding.status}`)}</Badge>
              </header>
              <p>{findingSummary(finding)}</p>
              {finding.legal_basis && <small><b>{t('monitorDetail.legalBasis')}:</b> {finding.legal_basis}</small>}
              {finding.evidence && finding.evidence.length > 0 && (
                <div className="compliance-finding__evidence">
                  <b>{t('monitorDetail.evidence')}:</b>
                  {finding.evidence.map((item) => <code key={item}>{item}</code>)}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <footer className="compliance-report__disclaimer"><CircleAlert size={18} /><span>{t('monitorDetail.complianceDisclaimer')}</span></footer>
    </section>
  )
}

export function ComplianceManualChecklist({ report }: { report: ComplianceReportData }) {
  const { t } = useI18n()
  const checks = report.checks.filter((finding) => finding.status === 'manual')
  if (!checks.length) return null

  return (
    <section className="compliance-manual-checklist">
      <header><ClipboardCheck size={21} /><div><h2>{t('monitorDetail.manualReviewTitle')}</h2><p>{t('monitorDetail.manualReviewHint')}</p></div></header>
      <div>
        {checks.map((finding) => <article key={finding.id}>
          <CircleCheck size={17} />
          <div><strong>{t(`complianceCheck.${finding.id}`)}</strong></div>
        </article>)}
      </div>
    </section>
  )
}
