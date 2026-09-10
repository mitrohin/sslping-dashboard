import type { MonitorViewModel } from '../data/models'

export function observationIsStale(monitor: Pick<MonitorViewModel, 'lastCheckedAt' | 'intervalSeconds' | 'timeoutSeconds' | 'observationStale' | 'status'>, now: number): boolean {
  if (monitor.status === 'paused') return false
  if (monitor.observationStale !== undefined) return monitor.observationStale
  if (!monitor.lastCheckedAt) return false
  const checked = Date.parse(monitor.lastCheckedAt)
  return Number.isFinite(checked) && now - checked > Math.max(120, monitor.intervalSeconds * 2 + monitor.timeoutSeconds) * 1000
}

export function statusReason(reason: string | undefined, locale: string): string | undefined {
  if (!reason || reason === 'none') return undefined
  const descriptions: Record<string, readonly [string, string]> = {
    timeout: ['The check timed out', 'Истекло время ожидания ответа'],
    request_timeout: ['The request timed out', 'Истекло время ожидания ответа'],
    dns_error: ['The hostname could not be resolved', 'Не удалось определить адрес сервера'],
    connection_refused: ['The server refused the connection', 'Сервер отклонил соединение'],
    connection_error: ['The connection failed', 'Не удалось подключиться к серверу'],
    keyword_missing: ['The expected text was not found', 'Ожидаемый текст не найден'],
    tls_expired: ['The certificate has expired', 'Срок действия сертификата истёк'],
    tls_invalid: ['Certificate validation failed', 'Сертификат не прошёл проверку'],
    tls_expiring: ['The certificate expires soon', 'Срок действия сертификата скоро истечёт'],
    domain_expired: ['The domain has expired', 'Срок регистрации домена истёк'],
    domain_expiring: ['The domain expires soon', 'Срок регистрации домена скоро истечёт'],
    slow_response: ['The response exceeded the configured threshold', 'Время ответа превысило заданный порог'],
    unexpected_status: ['The server returned an unexpected status', 'Сервер вернул неожиданный статус'],
  }
  return descriptions[reason]?.[locale === 'ru' ? 1 : 0] ?? reason.replaceAll('_', ' ')
}
