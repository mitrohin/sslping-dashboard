import { useEffect, useState, type ReactNode } from 'react'
import { PageLoadingSkeleton } from '../components/ui'
import { useI18n } from './I18nProvider'

export function AdminMessages({ children }: { children: ReactNode }) {
  const { requestAdminMessages, adminReady, t } = useI18n()
  const [hasLoaded, setHasLoaded] = useState(adminReady)
  useEffect(requestAdminMessages, [requestAdminMessages])
  useEffect(() => { if (adminReady) setHasLoaded(true) }, [adminReady])
  // Gate only the first load. Changing language must keep an open admin form
  // mounted with its previous translations until the new messages arrive.
  return adminReady || hasLoaded ? children : <PageLoadingSkeleton label={t('common.loading')} />
}
