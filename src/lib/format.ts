import type {
  IncidentStatus,
  MonitorStatus,
  StatusTone,
  UptimeBarStatus,
} from '../data/models'

export interface DateFormatOptions {
  locale?: string
  timeZone?: string
  includeYear?: boolean
  includeSeconds?: boolean
}

export interface RelativeTimeOptions {
  locale?: string
  numeric?: Intl.RelativeTimeFormatNumeric
}

const statusLabels: Readonly<Record<string, string>> = {
  pending: 'Pending',
  up: 'Up',
  down: 'Down',
  degraded: 'Degraded',
  paused: 'Paused',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  maintenance: 'Maintenance',
  'no-data': 'No data',
  ok: 'Operational',
  failed: 'Failed',
  skipped: 'Skipped',
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
  published: 'Published',
  draft: 'Draft',
  expired: 'Expired',
  revoked: 'Revoked',
  'never-used': 'Never used',
  expiring: 'Expiring soon',
}

const localizedStatusLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  es: { pending:'Pendiente', up:'Disponible', down:'Caído', degraded:'Degradado', paused:'Pausado', investigating:'Investigando', identified:'Identificado', monitoring:'En observación', resolved:'Resuelto', maintenance:'Mantenimiento', 'no-data':'Sin datos', ok:'Operativo', failed:'Fallido', skipped:'Omitido', active:'Activo', invited:'Invitado', suspended:'Suspendido', published:'Publicado', draft:'Borrador', expired:'Vencido', revoked:'Revocado', 'never-used':'Nunca usado', expiring:'Vence pronto' },
  zh: { pending:'等待中', up:'正常', down:'故障', degraded:'性能下降', paused:'已暂停', investigating:'调查中', identified:'已定位', monitoring:'观察中', resolved:'已解决', maintenance:'维护中', 'no-data':'无数据', ok:'运行正常', failed:'失败', skipped:'已跳过', active:'活跃', invited:'已邀请', suspended:'已停用', published:'已发布', draft:'草稿', expired:'已过期', revoked:'已撤销', 'never-used':'从未使用', expiring:'即将到期' },
  'zh-hant': { pending:'等待中', up:'正常', down:'故障', degraded:'效能下降', paused:'已暫停', investigating:'調查中', identified:'已定位', monitoring:'觀察中', resolved:'已解決', maintenance:'維護中', 'no-data':'無資料', ok:'運作正常', failed:'失敗', skipped:'已略過', active:'啟用中', invited:'已邀請', suspended:'已停用', published:'已發布', draft:'草稿', expired:'已過期', revoked:'已撤銷', 'never-used':'從未使用', expiring:'即將到期' },
  ka: { pending:'მოლოდინშია', up:'მუშაობს', down:'გათიშულია', degraded:'შეფერხებულია', paused:'შეჩერებულია', investigating:'მიმდინარეობს მოკვლევა', identified:'მიზეზი დადგენილია', monitoring:'დაკვირვება', resolved:'გადაწყვეტილია', maintenance:'ტექნიკური სამუშაოები', 'no-data':'მონაცემები არ არის', ok:'გამართულია', failed:'შეცდომა', skipped:'გამოტოვებულია', active:'აქტიურია', invited:'მოწვეულია', suspended:'შეჩერებულია', published:'გამოქვეყნებულია', draft:'მონახაზი', expired:'ვადაგასულია', revoked:'გაუქმებულია', 'never-used':'არ გამოყენებულა', expiring:'ვადა მალე იწურება' },
  tr: { pending:'Bekliyor', up:'Çalışıyor', down:'Kapalı', degraded:'Yavaşlamış', paused:'Duraklatıldı', investigating:'Araştırılıyor', identified:'Belirlendi', monitoring:'İzleniyor', resolved:'Çözüldü', maintenance:'Bakım', 'no-data':'Veri yok', ok:'Çalışıyor', failed:'Başarısız', skipped:'Atlandı', active:'Aktif', invited:'Davet edildi', suspended:'Askıya alındı', published:'Yayınlandı', draft:'Taslak', expired:'Süresi doldu', revoked:'İptal edildi', 'never-used':'Hiç kullanılmadı', expiring:'Yakında doluyor' },
  ru: { pending:'Ожидание', up:'Работает', down:'Недоступен', degraded:'Есть проблемы', paused:'На паузе', investigating:'Расследуется', identified:'Причина найдена', monitoring:'Наблюдение', resolved:'Решён', maintenance:'Обслуживание', 'no-data':'Нет данных', ok:'Работает', failed:'Ошибка', skipped:'Пропущено', active:'Активен', invited:'Приглашён', suspended:'Заблокирован', published:'Опубликован', draft:'Черновик', expired:'Истёк', revoked:'Отозван', 'never-used':'Не использовался', expiring:'Скоро истекает' },
  fr: { pending:'En attente', up:'Opérationnel', down:'Indisponible', degraded:'Dégradé', paused:'En pause', investigating:'En cours d’investigation', identified:'Identifié', monitoring:'Surveillance', resolved:'Résolu', maintenance:'Maintenance' },
  pt: { pending:'Pendente', up:'Operacional', down:'Indisponível', degraded:'Degradado', paused:'Pausado', investigating:'Investigando', identified:'Identificado', monitoring:'Monitorando', resolved:'Resolvido', maintenance:'Manutenção' },
  id: { pending:'Menunggu', up:'Beroperasi', down:'Tidak tersedia', degraded:'Terganggu', paused:'Dijeda', investigating:'Sedang diselidiki', identified:'Teridentifikasi', monitoring:'Dipantau', resolved:'Selesai', maintenance:'Pemeliharaan' },
  hi: { pending:'लंबित', up:'संचालित', down:'अनुपलब्ध', degraded:'प्रभावित', paused:'रोका गया', investigating:'जाँच जारी', identified:'पहचान हुई', monitoring:'निगरानी', resolved:'समाधान हुआ', maintenance:'रखरखाव' },
  bn: { pending:'অপেক্ষমাণ', up:'সচল', down:'অনুপলব্ধ', degraded:'ব্যাহত', paused:'বিরত', investigating:'তদন্ত চলছে', identified:'শনাক্ত হয়েছে', monitoring:'পর্যবেক্ষণে', resolved:'সমাধান হয়েছে', maintenance:'রক্ষণাবেক্ষণ' },
  ar: { pending:'قيد الانتظار', up:'يعمل', down:'غير متاح', degraded:'أداء متراجع', paused:'متوقف مؤقتًا', investigating:'قيد التحقيق', identified:'تم التحديد', monitoring:'قيد المراقبة', resolved:'تم الحل', maintenance:'صيانة' },
  de: { pending:'Wird geprüft', up:'Betriebsbereit', down:'Nicht erreichbar', degraded:'Beeinträchtigt', paused:'Pausiert', investigating:'Wird untersucht', identified:'Ursache ermittelt', monitoring:'Unter Beobachtung', resolved:'Behoben', maintenance:'Wartung' },
  nl: { pending:'Wordt gecontroleerd', up:'Operationeel', down:'Niet beschikbaar', degraded:'Vertraagd', paused:'Gepauzeerd', investigating:'In onderzoek', identified:'Geïdentificeerd', monitoring:'Onder observatie', resolved:'Opgelost', maintenance:'Onderhoud' },
  cs: { pending:'Čeká na kontrolu', up:'V provozu', down:'Nedostupné', degraded:'Omezený provoz', paused:'Pozastaveno', investigating:'Probíhá šetření', identified:'Příčina zjištěna', monitoring:'Sledování', resolved:'Vyřešeno', maintenance:'Údržba' },
  da: { pending:'Kontrolleres', up:'I drift', down:'Nede', degraded:'Ustabil', paused:'Pauset', investigating:'Undersøges', identified:'Identificeret', monitoring:'Overvåges', resolved:'Løst', maintenance:'Vedligeholdelse' },
  fi: { pending:'Tarkistetaan', up:'Toiminnassa', down:'Ei käytettävissä', degraded:'Heikentynyt', paused:'Keskeytetty', investigating:'Tutkitaan', identified:'Tunnistettu', monitoring:'Seurannassa', resolved:'Ratkaistu', maintenance:'Huolto' },
  el: { pending:'Σε έλεγχο', up:'Λειτουργεί', down:'Μη διαθέσιμο', degraded:'Υποβαθμισμένο', paused:'Σε παύση', investigating:'Υπό διερεύνηση', identified:'Εντοπίστηκε', monitoring:'Παρακολούθηση', resolved:'Επιλύθηκε', maintenance:'Συντήρηση' },
  hr: { pending:'Provjerava se', up:'Radi', down:'Nedostupno', degraded:'Otežan rad', paused:'Pauzirano', investigating:'Istražuje se', identified:'Utvrđeno', monitoring:'Nadzire se', resolved:'Riješeno', maintenance:'Održavanje' },
  hu: { pending:'Ellenőrzés alatt', up:'Működik', down:'Nem elérhető', degraded:'Korlátozott', paused:'Szünetel', investigating:'Vizsgálat alatt', identified:'Azonosítva', monitoring:'Megfigyelés', resolved:'Megoldva', maintenance:'Karbantartás' },
  he: { pending:'בבדיקה', up:'פעיל', down:'לא זמין', degraded:'ביצועים ירודים', paused:'מושהה', investigating:'בחקירה', identified:'זוהה', monitoring:'במעקב', resolved:'נפתר', maintenance:'תחזוקה' },
  it: { pending:'In verifica', up:'Operativo', down:'Non disponibile', degraded:'Degradato', paused:'In pausa', investigating:'In analisi', identified:'Identificato', monitoring:'Monitoraggio', resolved:'Risolto', maintenance:'Manutenzione' },
  ja: { pending:'確認中', up:'正常稼働', down:'障害中', degraded:'パフォーマンス低下', paused:'一時停止', investigating:'調査中', identified:'原因特定済み', monitoring:'監視中', resolved:'解決済み', maintenance:'メンテナンス' },
  ms: { pending:'Sedang diperiksa', up:'Beroperasi', down:'Tidak tersedia', degraded:'Terjejas', paused:'Dijeda', investigating:'Sedang disiasat', identified:'Dikenal pasti', monitoring:'Dipantau', resolved:'Selesai', maintenance:'Penyelenggaraan' },
  no: { pending:'Kontrolleres', up:'I drift', down:'Nede', degraded:'Ustabil', paused:'Pauset', investigating:'Undersøkes', identified:'Identifisert', monitoring:'Overvåkes', resolved:'Løst', maintenance:'Vedlikehold' },
  fil: { pending:'Sinusuri', up:'Gumagana', down:'Hindi available', degraded:'May problema', paused:'Naka-pause', investigating:'Iniimbestigahan', identified:'Natukoy', monitoring:'Minomonitor', resolved:'Nalutas', maintenance:'Maintenance' },
  ur: { pending:'جانچ جاری ہے', up:'فعال', down:'دستیاب نہیں', degraded:'متاثرہ', paused:'روکا گیا', investigating:'تحقیقات جاری ہیں', identified:'شناخت ہو گئی', monitoring:'نگرانی جاری ہے', resolved:'حل شدہ', maintenance:'دیکھ بھال' },
  pl: { pending:'Sprawdzanie', up:'Działa', down:'Niedostępne', degraded:'Ograniczone działanie', paused:'Wstrzymano', investigating:'Badanie awarii', identified:'Zidentyfikowano', monitoring:'Obserwacja', resolved:'Rozwiązano', maintenance:'Konserwacja' },
  ro: { pending:'Se verifică', up:'Operațional', down:'Indisponibil', degraded:'Degradat', paused:'Suspendat', investigating:'În investigare', identified:'Identificat', monitoring:'Monitorizare', resolved:'Rezolvat', maintenance:'Mentenanță' },
  sr: { pending:'Проверава се', up:'Ради', down:'Недоступно', degraded:'Отежан рад', paused:'Паузирано', investigating:'Истражује се', identified:'Утврђено', monitoring:'Надзор', resolved:'Решено', maintenance:'Одржавање' },
  sv: { pending:'Kontrolleras', up:'I drift', down:'Nere', degraded:'Nedsatt', paused:'Pausad', investigating:'Undersöks', identified:'Identifierad', monitoring:'Övervakas', resolved:'Löst', maintenance:'Underhåll' },
  sl: { pending:'Preverjanje', up:'Deluje', down:'Ni na voljo', degraded:'Okrnjeno', paused:'Začasno ustavljeno', investigating:'V preiskavi', identified:'Ugotovljeno', monitoring:'Spremljanje', resolved:'Rešeno', maintenance:'Vzdrževanje' },
  sk: { pending:'Kontroluje sa', up:'V prevádzke', down:'Nedostupné', degraded:'Obmedzená prevádzka', paused:'Pozastavené', investigating:'Prešetruje sa', identified:'Identifikované', monitoring:'Sledovanie', resolved:'Vyriešené', maintenance:'Údržba' },
  uk: { pending:'Перевіряється', up:'Працює', down:'Недоступний', degraded:'Нестабільний', paused:'Призупинено', investigating:'Розслідується', identified:'Причину знайдено', monitoring:'Спостереження', resolved:'Вирішено', maintenance:'Обслуговування' },
}

const statusTones: Readonly<Record<string, StatusTone>> = {
  up: 'positive',
  ok: 'positive',
  resolved: 'positive',
  active: 'positive',
  published: 'positive',
  down: 'negative',
  failed: 'negative',
  expired: 'negative',
  revoked: 'negative',
  suspended: 'negative',
  degraded: 'warning',
  investigating: 'warning',
  identified: 'warning',
  expiring: 'warning',
  invited: 'warning',
  monitoring: 'info',
  maintenance: 'info',
  pending: 'neutral',
  paused: 'neutral',
  skipped: 'neutral',
  draft: 'neutral',
  'no-data': 'neutral',
  'never-used': 'neutral',
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function activeLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    const language = document.documentElement.lang.toLowerCase()
    return ({ en:'en-US', es:'es-ES', zh:'zh-CN', ka:'ka-GE', tr:'tr-TR', ru:'ru-RU' } as Record<string, string>)[language] ?? language
  }
  return 'en-US'
}

export function formatDuration(totalSeconds: number, maxParts = 3): string {
  if (!Number.isFinite(totalSeconds)) return '—'

  let seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds === 0) return '0s'

  const units = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ] as const
  const parts: string[] = []

  for (const [label, size] of units) {
    if (seconds < size && parts.length === 0) continue
    const value = Math.floor(seconds / size)
    seconds %= size
    if (value > 0) parts.push(`${value}${label}`)
    if (parts.length >= Math.max(1, maxParts)) break
  }

  return parts.join(' ') || '0s'
}

export function formatDate(
  value: string | number | Date,
  options: DateFormatOptions = {},
): string {
  const date = toDate(value)
  if (!date) return '—'

  const {
    locale = activeLocale(),
    timeZone,
    includeYear = true,
    includeSeconds = false,
  } = options

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' as const } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
}

export const formatDateTime = formatDate

export function formatRelativeTime(
  value: string | number | Date,
  now: string | number | Date = new Date(),
  options: RelativeTimeOptions = {},
): string {
  const date = toDate(value)
  const reference = toDate(now)
  if (!date || !reference) return '—'

  const differenceSeconds = (date.getTime() - reference.getTime()) / 1_000
  const absoluteSeconds = Math.abs(differenceSeconds)
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ] as const
  const [unit, size] = units.find(([, unitSize]) => absoluteSeconds >= unitSize) ?? [
    'second',
    1,
  ]
  const amount = Math.round(differenceSeconds / size)

  return new Intl.RelativeTimeFormat(options.locale ?? activeLocale(), {
    numeric: options.numeric ?? 'always',
  }).format(amount, unit)
}

export function formatUptime(value: number | null | undefined, maximumFractionDigits = 3, locale = activeLocale()): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'

  const normalized = Math.min(100, Math.max(0, value))
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.max(0, maximumFractionDigits),
  }).format(normalized)}%`
}

export function formatStatus(
  status: MonitorStatus | IncidentStatus | UptimeBarStatus | string | null | undefined,
  locale = activeLocale(),
): string {
  if (!status) return 'Unknown'
  const normalizedLocale = locale.toLowerCase()
  const language = normalizedLocale.startsWith('zh-hant') || /^zh-(?:hk|mo|tw)(?:-|$)/.test(normalizedLocale)
    ? 'zh-hant'
    : normalizedLocale.split('-')[0]
  const localized = localizedStatusLabels[language === 'nb' ? 'no' : language]
  if (localized?.[status]) return localized[status]
  if (statusLabels[status]) return statusLabels[status]

  return status
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return 'neutral'
  return statusTones[status] ?? 'neutral'
}
