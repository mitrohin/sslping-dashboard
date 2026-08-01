import type { IncidentStatus } from '../../data'

export type StatusPageLanguageCode = 'en' | 'zh' | 'hi' | 'es' | 'fr' | 'ar' | 'bn' | 'pt' | 'ru' | 'id'
export type RobotsPolicy = 'index,follow' | 'noindex,nofollow' | 'noindex,follow'

export interface StatusPageCreateInput {
  name: string
  slug: string
  homepageUrl: string
  accessLevel: 'public' | 'password' | 'private'
  password: string
  language: StatusPageLanguageCode
  published: boolean
	  monitorIds: readonly string[]
}

export interface StatusPageAnnouncementInput {
  title: string
  body: string
  status: IncidentStatus
  incidentId?: string
}

export interface StatusPageAnnouncementViewModel extends StatusPageAnnouncementInput {
  id: string
  publishedAt: string
}

export interface StatusPageFeatureSettings {
  showBarCharts: boolean
  showResponseTime: boolean
  showUptimePercentage: boolean
  showOverallPercentage: boolean
  showOutageDetails: boolean
  enableDetailsPage: boolean
  enableFloatingStatusBar: boolean
  showMonitorUrl: boolean
  hidePausedMonitors: boolean
  enableSubscribe: boolean
  showLatestDowntime: boolean
  smallCookieDialog: boolean
  shareAnalytics: boolean
}

export interface StatusPageBrandingSettings {
  logoUrl: string
  accentColor: string
  backgroundColor: string
  colorScheme: 'system' | 'light' | 'dark'
  removeProductLogo: boolean
}

export interface StatusPageEditorValue {
  name: string
  slug: string
  homepageUrl: string
  customDomain: string
  googleAnalyticsId: string
  language: StatusPageLanguageCode
  robots: RobotsPolicy
  published: boolean
  passwordEnabled: boolean
  password: string
  removeCookieConsent: boolean
	  monitorIds: readonly string[]
	  reportReasons: Readonly<Record<string, readonly string[]>>
	  reportThresholds: Readonly<Record<string, number>>
  branding: StatusPageBrandingSettings
  features: StatusPageFeatureSettings
}
