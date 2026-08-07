import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from '../api/types'
import { useAuth } from './AuthProvider'
import { Select } from '../components/ui'
import { Languages } from 'lucide-react'
import { featureTranslations } from './featureTranslations'
import { billingTranslations } from './billingTranslations'
import { accountTranslations } from './accountTranslations'
import { secondaryTranslations } from './secondaryTranslations'
import { adminTranslations } from './adminTranslations'
import { subscriptionTranslations } from './subscriptionTranslations'

export const localeOptions: Array<{ code: Locale; label: string; native: string }> = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'ka', label: 'Georgian', native: 'ქართული' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
]

type Messages = Record<string, string>

const en: Messages = {
  'nav.monitoring': 'Monitoring', 'nav.incidents': 'Incidents', 'nav.statusPages': 'Status pages',
  'nav.maintenance': 'Maintenance', 'nav.team': 'Team members', 'nav.integrations': 'Integrations & API',
  'nav.support': 'Support tickets', 'nav.admin': 'System administration', 'nav.billingAdmin': 'Billing administration',
  'shell.openNavigation': 'Open navigation', 'shell.closeNavigation': 'Close navigation', 'shell.primary': 'Primary',
  'shell.demoWorkspace': 'Demo workspace', 'shell.owner': 'Owner', 'shell.signOut': 'Sign out',
  'shell.plansBilling': 'Plans & billing', 'shell.collapse': 'Collapse sidebar', 'shell.expand': 'Expand sidebar',
  'shell.supportSession': 'Support session: acting as {name}', 'shell.returnAdmin': 'Return to administration',
  'shell.help': 'Help & diagnostics', 'shell.helpIntro': 'Use these shortcuts to investigate a problem without sending any account data.',
  'shell.reviewIncidents': 'Review recent incidents', 'shell.reviewIncidentsHint': 'Inspect failures, causes, and resolution times.',
  'shell.checkIntegrations': 'Check integrations & API', 'shell.checkIntegrationsHint': 'Review alert delivery and API access.',
  'shell.reviewMaintenance': 'Review maintenance', 'shell.reviewMaintenanceHint': 'Confirm that planned work is configured correctly.',
  'shell.contactSupport': 'Contact SSLPing support', 'shell.contactSupportHint': 'Create a ticket or continue an existing conversation.',
  'shell.diagnosticSummary': 'Local diagnostic summary', 'shell.localOnly': 'Local only', 'shell.workspace': 'Workspace',
  'shell.plan': 'Plan', 'shell.session': 'Session', 'shell.currentPage': 'Current page', 'shell.authenticated': 'Authenticated',
  'shell.guest': 'Guest', 'shell.close': 'Close', 'shell.privacyNotice': 'Account data is shared with support only when you explicitly create a ticket.',
  'shell.switchWorkspace': 'Switch workspace', 'shell.switchWorkspaceHint': 'Choose another workspace and confirm your account password to open it securely.',
  'shell.passwordToSwitch': 'Enter your current account password.', 'shell.switchingWorkspace': 'Switching…',
  'language.label': 'Language', 'region.label': 'Region',
  'auth.welcome': 'Welcome back', 'auth.createWorkspace': 'Create your workspace', 'auth.resetPassword': 'Reset your password',
  'auth.signInSubtitle': 'Sign in to monitor your entire stack.', 'auth.registerSubtitle': 'Start monitoring in less than two minutes.',
  'auth.resetSubtitle': 'We will send a secure reset link to your email.', 'auth.incidentIntelligence': 'Incident intelligence',
  'auth.heroTitle': 'Know first. Respond faster.', 'auth.heroText': 'Monitor websites, APIs, SSL, DNS, ports and scheduled jobs from one calm control room.',
  'auth.allOperational': 'All systems operational', 'auth.avgResponse': 'Avg. response', 'auth.activeMonitors': 'Active monitors',
  'auth.openIncidents': 'Open incidents', 'auth.multiRegion': 'Multi-region verification', 'auth.actionableAlerts': 'Actionable alerts, not noise',
  'auth.gdpr': 'GDPR-ready status pages', 'auth.name': 'Your name', 'auth.workspace': 'Workspace', 'auth.email': 'E-mail',
  'auth.password': 'Password', 'auth.passwordHint': '12+ characters with upper, lower case and a number.',
  'auth.regionHint': 'Sets your default language, currency, plans and available payment methods.',
  'auth.billingCurrency': 'Billing currency', 'auth.regionManaged': 'Only an administrator can change the region after registration.',
  'auth.forgot': 'Forgot password?', 'auth.wait': 'Please wait…', 'auth.signIn': 'Sign in', 'auth.createAccount': 'Create account',
  'auth.sendReset': 'Send reset link', 'auth.new': 'New to SSLPing?', 'auth.createLink': 'Create an account',
  'auth.existing': 'Already have an account?', 'auth.backSignIn': 'Back to sign in', 'auth.demo': 'Preview the complete demo dashboard',
  'auth.legal': 'By continuing, you agree to the Terms and Privacy Policy.', 'auth.showPassword': 'Show password', 'auth.hidePassword': 'Hide password',
  'common.loading': 'Loading…', 'common.save': 'Save', 'common.cancel': 'Cancel', 'common.edit': 'Edit',
}

const translations: Record<Locale, Messages> = {
  en,
  es: {
    'nav.monitoring':'Monitoreo','nav.incidents':'Incidentes','nav.statusPages':'Páginas de estado','nav.maintenance':'Mantenimiento','nav.team':'Miembros del equipo','nav.integrations':'Integraciones y API','nav.support':'Tickets de soporte','nav.admin':'Administración del sistema','nav.billingAdmin':'Administración de facturación','shell.openNavigation':'Abrir navegación','shell.closeNavigation':'Cerrar navegación','shell.primary':'Principal','shell.demoWorkspace':'Espacio de demostración','shell.owner':'Propietario','shell.signOut':'Cerrar sesión','shell.plansBilling':'Planes y facturación','shell.collapse':'Contraer barra lateral','shell.expand':'Expandir barra lateral','shell.help':'Ayuda y diagnóstico','shell.close':'Cerrar','shell.switchWorkspace':'Cambiar espacio de trabajo','shell.switchWorkspaceHint':'Elige otro espacio y confirma la contraseña de tu cuenta para abrirlo de forma segura.','shell.passwordToSwitch':'Introduce la contraseña actual de tu cuenta.','shell.switchingWorkspace':'Cambiando…','language.label':'Idioma','region.label':'Región','auth.welcome':'Bienvenido de nuevo','auth.createWorkspace':'Crea tu espacio de trabajo','auth.resetPassword':'Restablece tu contraseña','auth.signInSubtitle':'Inicia sesión para monitorizar toda tu infraestructura.','auth.registerSubtitle':'Empieza a monitorizar en menos de dos minutos.','auth.resetSubtitle':'Enviaremos un enlace seguro a tu correo.','auth.incidentIntelligence':'Inteligencia de incidentes','auth.heroTitle':'Entérate primero. Responde más rápido.','auth.heroText':'Monitoriza sitios, API, SSL, DNS, puertos y tareas programadas desde un solo lugar.','auth.allOperational':'Todos los sistemas operativos','auth.avgResponse':'Respuesta media','auth.activeMonitors':'Monitores activos','auth.openIncidents':'Incidentes abiertos','auth.multiRegion':'Verificación multirregión','auth.actionableAlerts':'Alertas útiles, sin ruido','auth.gdpr':'Páginas de estado preparadas para RGPD','auth.name':'Tu nombre','auth.workspace':'Espacio de trabajo','auth.email':'Correo electrónico','auth.password':'Contraseña','auth.passwordHint':'12+ caracteres con mayúsculas, minúsculas y un número.','auth.forgot':'¿Olvidaste tu contraseña?','auth.wait':'Espera…','auth.signIn':'Iniciar sesión','auth.createAccount':'Crear cuenta','auth.sendReset':'Enviar enlace','auth.new':'¿Nuevo en SSLPing?','auth.createLink':'Crear una cuenta','auth.existing':'¿Ya tienes cuenta?','auth.backSignIn':'Volver al inicio','auth.demo':'Ver el dashboard de demostración','auth.legal':'Al continuar, aceptas los Términos y la Política de privacidad.','auth.showPassword':'Mostrar contraseña','auth.hidePassword':'Ocultar contraseña','common.loading':'Cargando…','common.save':'Guardar','common.cancel':'Cancelar','common.edit':'Editar',
  },
  zh: {
    'nav.monitoring':'监控','nav.incidents':'事件','nav.statusPages':'状态页面','nav.maintenance':'维护','nav.team':'团队成员','nav.integrations':'集成与 API','nav.support':'支持工单','nav.admin':'系统管理','nav.billingAdmin':'账单管理','shell.openNavigation':'打开导航','shell.closeNavigation':'关闭导航','shell.primary':'主导航','shell.demoWorkspace':'演示工作区','shell.owner':'所有者','shell.signOut':'退出登录','shell.plansBilling':'套餐与账单','shell.collapse':'收起侧栏','shell.expand':'展开侧栏','shell.help':'帮助与诊断','shell.close':'关闭','shell.switchWorkspace':'切换工作区','shell.switchWorkspaceHint':'选择另一个工作区，并确认账户密码以安全打开。','shell.passwordToSwitch':'请输入当前账户密码。','shell.switchingWorkspace':'正在切换…','language.label':'语言','region.label':'地区','auth.welcome':'欢迎回来','auth.createWorkspace':'创建工作区','auth.resetPassword':'重置密码','auth.signInSubtitle':'登录以监控您的整个技术栈。','auth.registerSubtitle':'不到两分钟即可开始监控。','auth.resetSubtitle':'我们会向您的邮箱发送安全重置链接。','auth.incidentIntelligence':'事件智能','auth.heroTitle':'更早发现，更快响应。','auth.heroText':'在一个清晰的控制中心监控网站、API、SSL、DNS、端口和计划任务。','auth.allOperational':'所有系统运行正常','auth.avgResponse':'平均响应','auth.activeMonitors':'活跃监控','auth.openIncidents':'未关闭事件','auth.multiRegion':'多区域验证','auth.actionableAlerts':'有效告警，减少噪音','auth.gdpr':'符合 GDPR 的状态页面','auth.name':'您的姓名','auth.workspace':'工作区','auth.email':'电子邮箱','auth.password':'密码','auth.passwordHint':'至少 12 个字符，包含大小写字母和数字。','auth.forgot':'忘记密码？','auth.wait':'请稍候…','auth.signIn':'登录','auth.createAccount':'创建账户','auth.sendReset':'发送重置链接','auth.new':'初次使用 SSLPing？','auth.createLink':'创建账户','auth.existing':'已有账户？','auth.backSignIn':'返回登录','auth.demo':'预览完整演示面板','auth.legal':'继续即表示您同意条款和隐私政策。','auth.showPassword':'显示密码','auth.hidePassword':'隐藏密码','common.loading':'加载中…','common.save':'保存','common.cancel':'取消','common.edit':'编辑',
  },
  ka: {
    'nav.monitoring':'მონიტორინგი','nav.incidents':'ინციდენტები','nav.statusPages':'სტატუსის გვერდები','nav.maintenance':'ტექნიკური სამუშაოები','nav.team':'გუნდის წევრები','nav.integrations':'ინტეგრაციები და API','nav.support':'მხარდაჭერის ტიკეტები','nav.admin':'სისტემის ადმინისტრირება','nav.billingAdmin':'ბილინგის ადმინისტრირება','shell.openNavigation':'ნავიგაციის გახსნა','shell.closeNavigation':'ნავიგაციის დახურვა','shell.primary':'მთავარი','shell.demoWorkspace':'დემო სამუშაო სივრცე','shell.owner':'მფლობელი','shell.signOut':'გასვლა','shell.plansBilling':'ტარიფები და ბილინგი','shell.collapse':'გვერდითი ზოლის შეკუმშვა','shell.expand':'გვერდითი ზოლის გაშლა','shell.help':'დახმარება და დიაგნოსტიკა','shell.close':'დახურვა','shell.switchWorkspace':'სამუშაო სივრცის შეცვლა','shell.switchWorkspaceHint':'აირჩიეთ სხვა სივრცე და უსაფრთხოდ გასახსნელად დაადასტურეთ ანგარიშის პაროლი.','shell.passwordToSwitch':'შეიყვანეთ ანგარიშის მიმდინარე პაროლი.','shell.switchingWorkspace':'იცვლება…','language.label':'ენა','region.label':'რეგიონი','auth.welcome':'კეთილი იყოს თქვენი დაბრუნება','auth.createWorkspace':'შექმენით სამუშაო სივრცე','auth.resetPassword':'პაროლის აღდგენა','auth.signInSubtitle':'შედით მთელი ინფრასტრუქტურის მონიტორინგისთვის.','auth.registerSubtitle':'დაიწყეთ მონიტორინგი ორ წუთზე ნაკლებ დროში.','auth.resetSubtitle':'უსაფრთხო ბმულს ელფოსტაზე გამოგიგზავნით.','auth.incidentIntelligence':'ინციდენტების ანალიტიკა','auth.heroTitle':'გაიგეთ პირველმა. უპასუხეთ სწრაფად.','auth.heroText':'აკონტროლეთ საიტები, API, SSL, DNS, პორტები და დაგეგმილი ამოცანები ერთ სივრცეში.','auth.allOperational':'ყველა სისტემა მუშაობს','auth.avgResponse':'საშ. პასუხი','auth.activeMonitors':'აქტიური მონიტორები','auth.openIncidents':'ღია ინციდენტები','auth.multiRegion':'მრავალრეგიონული შემოწმება','auth.actionableAlerts':'სასარგებლო შეტყობინებები ხმაურის გარეშე','auth.gdpr':'GDPR-ისთვის მზად სტატუსის გვერდები','auth.name':'თქვენი სახელი','auth.workspace':'სამუშაო სივრცე','auth.email':'ელფოსტა','auth.password':'პაროლი','auth.passwordHint':'12+ სიმბოლო, დიდი და პატარა ასოებითა და ციფრით.','auth.forgot':'დაგავიწყდათ პაროლი?','auth.wait':'გთხოვთ მოიცადოთ…','auth.signIn':'შესვლა','auth.createAccount':'ანგარიშის შექმნა','auth.sendReset':'ბმულის გაგზავნა','auth.new':'ახალი ხართ SSLPing-ში?','auth.createLink':'ანგარიშის შექმნა','auth.existing':'უკვე გაქვთ ანგარიში?','auth.backSignIn':'შესვლაზე დაბრუნება','auth.demo':'დემო პანელის ნახვა','auth.legal':'გაგრძელებით ეთანხმებით პირობებს და კონფიდენციალურობის პოლიტიკას.','auth.showPassword':'პაროლის ჩვენება','auth.hidePassword':'პაროლის დამალვა','common.loading':'იტვირთება…','common.save':'შენახვა','common.cancel':'გაუქმება','common.edit':'რედაქტირება',
  },
  tr: {
    'nav.monitoring':'İzleme','nav.incidents':'Olaylar','nav.statusPages':'Durum sayfaları','nav.maintenance':'Bakım','nav.team':'Ekip üyeleri','nav.integrations':'Entegrasyonlar ve API','nav.support':'Destek talepleri','nav.admin':'Sistem yönetimi','nav.billingAdmin':'Faturalandırma yönetimi','shell.openNavigation':'Navigasyonu aç','shell.closeNavigation':'Navigasyonu kapat','shell.primary':'Ana','shell.demoWorkspace':'Demo çalışma alanı','shell.owner':'Sahip','shell.signOut':'Çıkış yap','shell.plansBilling':'Planlar ve faturalandırma','shell.collapse':'Kenar çubuğunu daralt','shell.expand':'Kenar çubuğunu genişlet','shell.help':'Yardım ve tanılama','shell.close':'Kapat','shell.switchWorkspace':'Çalışma alanını değiştir','shell.switchWorkspaceHint':'Başka bir çalışma alanı seçin ve güvenle açmak için hesap parolanızı doğrulayın.','shell.passwordToSwitch':'Mevcut hesap parolanızı girin.','shell.switchingWorkspace':'Değiştiriliyor…','language.label':'Dil','region.label':'Bölge','auth.welcome':'Tekrar hoş geldiniz','auth.createWorkspace':'Çalışma alanınızı oluşturun','auth.resetPassword':'Parolanızı sıfırlayın','auth.signInSubtitle':'Tüm sisteminizi izlemek için giriş yapın.','auth.registerSubtitle':'İki dakikadan kısa sürede izlemeye başlayın.','auth.resetSubtitle':'E-postanıza güvenli bir sıfırlama bağlantısı göndereceğiz.','auth.incidentIntelligence':'Olay zekâsı','auth.heroTitle':'Önce öğrenin. Daha hızlı yanıt verin.','auth.heroText':'Web sitelerini, API, SSL, DNS, portları ve zamanlanmış işleri tek merkezden izleyin.','auth.allOperational':'Tüm sistemler çalışıyor','auth.avgResponse':'Ort. yanıt','auth.activeMonitors':'Aktif monitörler','auth.openIncidents':'Açık olaylar','auth.multiRegion':'Çok bölgeli doğrulama','auth.actionableAlerts':'Gürültüsüz, anlamlı uyarılar','auth.gdpr':'GDPR uyumlu durum sayfaları','auth.name':'Adınız','auth.workspace':'Çalışma alanı','auth.email':'E-posta','auth.password':'Parola','auth.passwordHint':'Büyük/küçük harf ve sayı içeren 12+ karakter.','auth.forgot':'Parolanızı mı unuttunuz?','auth.wait':'Lütfen bekleyin…','auth.signIn':'Giriş yap','auth.createAccount':'Hesap oluştur','auth.sendReset':'Sıfırlama bağlantısı gönder','auth.new':'SSLPing’de yeni misiniz?','auth.createLink':'Hesap oluştur','auth.existing':'Zaten hesabınız var mı?','auth.backSignIn':'Girişe dön','auth.demo':'Tam demo panelini önizle','auth.legal':'Devam ederek Şartlar ve Gizlilik Politikasını kabul edersiniz.','auth.showPassword':'Parolayı göster','auth.hidePassword':'Parolayı gizle','common.loading':'Yükleniyor…','common.save':'Kaydet','common.cancel':'İptal','common.edit':'Düzenle',
  },
  ru: {
    'nav.monitoring':'Мониторинг','nav.incidents':'Инциденты','nav.statusPages':'Статус-страницы','nav.maintenance':'Обслуживание','nav.team':'Участники команды','nav.integrations':'Интеграции и API','nav.support':'Тикеты поддержки','nav.admin':'Администрирование','nav.billingAdmin':'Управление оплатой','shell.openNavigation':'Открыть навигацию','shell.closeNavigation':'Закрыть навигацию','shell.primary':'Основная навигация','shell.demoWorkspace':'Демо-пространство','shell.owner':'Владелец','shell.signOut':'Выйти','shell.plansBilling':'Тарифы и оплата','shell.collapse':'Свернуть панель','shell.expand':'Развернуть панель','shell.help':'Помощь и диагностика','shell.close':'Закрыть','shell.switchWorkspace':'Сменить пространство','shell.switchWorkspaceHint':'Выберите другое пространство и подтвердите пароль аккаунта, чтобы безопасно его открыть.','shell.passwordToSwitch':'Введите текущий пароль аккаунта.','shell.switchingWorkspace':'Переключаем…','language.label':'Язык','region.label':'Регион','auth.welcome':'С возвращением','auth.createWorkspace':'Создайте рабочее пространство','auth.resetPassword':'Восстановление пароля','auth.signInSubtitle':'Войдите, чтобы контролировать всю инфраструктуру.','auth.registerSubtitle':'Начните мониторинг меньше чем за две минуты.','auth.resetSubtitle':'Мы отправим безопасную ссылку для сброса на вашу почту.','auth.incidentIntelligence':'Управление инцидентами','auth.heroTitle':'Узнавайте первыми. Реагируйте быстрее.','auth.heroText':'Мониторьте сайты, API, SSL, DNS, порты и задания из единого центра управления.','auth.allOperational':'Все системы работают','auth.avgResponse':'Средний ответ','auth.activeMonitors':'Активные мониторы','auth.openIncidents':'Открытые инциденты','auth.multiRegion':'Проверки из разных регионов','auth.actionableAlerts':'Полезные уведомления без шума','auth.gdpr':'Статус-страницы с поддержкой GDPR','auth.name':'Ваше имя','auth.workspace':'Рабочее пространство','auth.email':'Электронная почта','auth.password':'Пароль','auth.passwordHint':'Не менее 12 символов: заглавная, строчная буквы и цифра.','auth.forgot':'Забыли пароль?','auth.wait':'Подождите…','auth.signIn':'Войти','auth.createAccount':'Создать аккаунт','auth.sendReset':'Отправить ссылку','auth.new':'Впервые в SSLPing?','auth.createLink':'Создать аккаунт','auth.existing':'Уже есть аккаунт?','auth.backSignIn':'Вернуться ко входу','auth.demo':'Открыть демо dashboard','auth.legal':'Продолжая, вы соглашаетесь с Условиями и Политикой конфиденциальности.','auth.showPassword':'Показать пароль','auth.hidePassword':'Скрыть пароль','common.loading':'Загрузка…','common.save':'Сохранить','common.cancel':'Отмена','common.edit':'Изменить',
  },
}

for (const option of localeOptions) Object.assign(translations[option.code], featureTranslations[option.code], billingTranslations[option.code], accountTranslations[option.code], secondaryTranslations[option.code], adminTranslations[option.code], subscriptionTranslations[option.code])

function storedLocale(): Locale {
  const stored = window.localStorage.getItem('sslping.locale') as Locale | null
  return localeOptions.some((item) => item.code === stored) ? stored! : 'en'
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale, persist?: boolean) => Promise<void>
  t: (key: string, variables?: Record<string, string | number>) => string
}

const fallbackI18n: I18nContextValue = {
  locale: 'en',
  setLocale: async () => undefined,
  t: (key, variables) => {
    let value = en[key] ?? key
    for (const [name, replacement] of Object.entries(variables ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  },
}

// A real provider wraps the application. The English fallback keeps isolated
// components, Storybook-style renders and unit tests usable without duplicating
// provider setup in every harness.
const I18nContext = createContext<I18nContextValue>(fallbackI18n)

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, authenticated, updateLocale } = useAuth()
  const [locale, setLocaleState] = useState<Locale>(() => user?.locale ?? storedLocale())

  useEffect(() => {
    if (user?.locale && user.locale !== locale) setLocaleState(user.locale)
  }, [user?.locale])

  useEffect(() => {
    document.documentElement.lang = locale
    window.localStorage.setItem('sslping.locale', locale)
  }, [locale])

  const setLocale = useCallback(async (next: Locale, persist = true) => {
    setLocaleState(next)
    if (persist && authenticated && user?.locale !== next) await updateLocale(next)
  }, [authenticated, updateLocale, user?.locale])

  const t = useCallback((key: string, variables?: Record<string, string | number>) => {
    let value = translations[locale][key] ?? en[key] ?? key
    for (const [name, replacement] of Object.entries(variables ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export function LanguageSelect({ className = '', compact = false, showIcon = false }: { className?: string; compact?: boolean; showIcon?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  return <label
    className={`language-select ${compact ? 'language-select--compact' : ''} ${className}`.trim()}
    title={compact ? `${t('language.label')}: ${localeOptions.find((item) => item.code === locale)?.native ?? locale}` : undefined}
  >
    {(compact || showIcon) && <Languages size={21} aria-hidden="true" />}
    {!compact && <span>{t('language.label')}</span>}
    <Select aria-label={t('language.label')} value={locale} onChange={(event) => void setLocale(event.target.value as Locale)}>
      {localeOptions.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}
    </Select>
  </label>
}
