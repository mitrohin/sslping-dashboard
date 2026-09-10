import { Component, useSyncExternalStore, type ReactNode } from 'react'
import { getUpdateRequired, subscribeToUpdateRequired } from '../lib/recoverableImport'
import './app-recovery.css'

function russian() { return document.documentElement.lang.startsWith('ru') }

export function ApplicationErrorPanel({ fullPageRecovery = false }: { fullPageRecovery?: boolean }) {
  const ru = russian()
  return <section className="app-recovery" role="alert">
    <h1>{ru ? 'Не удалось открыть этот экран' : 'Unable to open this screen'}</h1>
    <p>{fullPageRecovery
      ? (ru ? 'Откройте главную страницу или обновите эту страницу.' : 'Open the home page or reload this page.')
      : (ru ? 'Попробуйте вернуться назад или обновить страницу.' : 'Try going back or reloading the page.')}</p>
    <div>{fullPageRecovery
      ? <a href="/">{ru ? 'На главную' : 'Home'}</a>
      : <button type="button" onClick={() => window.history.back()}>{ru ? 'Назад' : 'Go back'}</button>}
      <button type="button" onClick={() => window.location.reload()}>{ru ? 'Обновить страницу' : 'Reload page'}</button></div>
  </section>
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() {
    // No exception text, URL, stack, user identity, or form data leaves here.
    window.dispatchEvent(new CustomEvent('sslping:client-event', { detail: { name: 'render_error', value: 1 } }))
  }
  render() { return this.state.failed ? <ApplicationErrorPanel fullPageRecovery /> : this.props.children }
}

export function ApplicationUpdateNotice() {
  const updateAvailable = useSyncExternalStore(subscribeToUpdateRequired, getUpdateRequired, () => false)
  if (!updateAvailable) return null
  const ru = russian()
  return <aside className="app-update-notice" role="alert">
    <div><strong>{ru ? 'Доступна новая версия' : 'An update is available'}</strong>
      <p>{ru ? 'Текущий экран сохранён. Перед обновлением завершите работу с открытой формой или скопируйте несохранённый текст.' : 'Your current screen is preserved. Finish the open form or copy unsaved text before reloading.'}</p></div>
    <button type="button" onClick={() => window.location.reload()}>{ru ? 'Обновить страницу' : 'Reload page'}</button>
  </aside>
}
