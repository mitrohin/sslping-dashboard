import { ArrowLeft, Settings2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { demoMonitors, type MonitorViewModel } from '../../data'
import { Button, EmptyState, PageHeader, Panel } from '../../components/ui'
import { defaultMonitorDraft, MonitorForm, type MonitorDraft } from './MonitorForm'

export interface MonitorEditPageProps {
  monitor?: MonitorViewModel
  initialValue?: MonitorDraft
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onSubmit?: (draft: MonitorDraft) => Promise<void>
}

export function MonitorEditPage({
  monitor: suppliedMonitor,
  initialValue: suppliedInitialValue,
  loading = false,
  error = null,
  onRetry,
  onSubmit,
}: MonitorEditPageProps = {}) {
  const { monitorId } = useParams()
  const navigate = useNavigate()
  const monitor = suppliedMonitor ?? demoMonitors.find((item) => item.id === monitorId) ?? demoMonitors[0]
  const initialValue: MonitorDraft = suppliedInitialValue ?? {
    ...defaultMonitorDraft,
    name: monitor.name,
    type: monitor.type,
    target: monitor.target,
    intervalSeconds: monitor.intervalSeconds,
    timeoutSeconds: monitor.timeoutSeconds,
    regions: [...monitor.regions],
    tags: [...monitor.tags],
    group: monitor.group,
    keyword: monitor.type === 'keyword' ? 'status: ok' : '',
  }

  if (loading) {
    return <div className="page monitor-edit-page"><Link to={`/monitors/${monitorId ?? ''}`} className="back-link"><ArrowLeft size={17} /> Monitor detail</Link><Panel><EmptyState icon={<Settings2 size={34} />} title="Loading monitor settings" description="Reading the current monitor configuration…" /></Panel></div>
  }

  if (error && !suppliedMonitor) {
    return <div className="page monitor-edit-page"><Link to="/monitors" className="back-link"><ArrowLeft size={17} /> Monitoring</Link><Panel><EmptyState icon={<Settings2 size={34} />} title="Could not load monitor" description={error} action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined} /></Panel></div>
  }

  const save = async (draft: MonitorDraft) => {
    if (onSubmit) await onSubmit(draft)
    navigate(`/monitors/${monitor.id}`)
  }

  return (
    <div className="page monitor-edit-page">
      <Link to={`/monitors/${monitor.id}`} className="back-link"><ArrowLeft size={17} /> Monitor detail</Link>
      <PageHeader title={<>Edit <span className="success-text">{monitor.name}</span></>} description="Monitor type cannot be changed after creation. Update the target, timing and alert behavior below." />
      <Panel className="monitor-edit-panel">
        <MonitorForm initialValue={initialValue} lockType submitLabel="Save changes" onSubmit={save} onCancel={() => navigate(`/monitors/${monitor.id}`)} />
      </Panel>
    </div>
  )
}
