export type AppLocale = 'zh-TW' | 'en-US'

export const APP_LOCALES: AppLocale[] = ['zh-TW', 'en-US']

const USER_LOCALE_KEY = 'vtms.uiLocale.override'

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-TW' || value === 'en-US'
}

/** 個人語系覆寫（本機）；未設定時走系統預設 */
export function readUserLocaleOverride(): AppLocale | null {
  try {
    const raw = localStorage.getItem(USER_LOCALE_KEY)
    return isAppLocale(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeUserLocaleOverride(locale: AppLocale): void {
  try {
    localStorage.setItem(USER_LOCALE_KEY, locale)
  } catch {
    // ignore quota / private mode
  }
}

export function clearUserLocaleOverride(): void {
  try {
    localStorage.removeItem(USER_LOCALE_KEY)
  } catch {
    // ignore
  }
}

export function resolveInitialLocale(systemDefault?: AppLocale | null): AppLocale {
  return readUserLocaleOverride() ?? systemDefault ?? 'zh-TW'
}

export function nextAppLocale(current: AppLocale): AppLocale {
  const idx = APP_LOCALES.indexOf(current)
  return APP_LOCALES[(idx + 1) % APP_LOCALES.length] ?? 'zh-TW'
}

export function localeToolbarCode(locale: AppLocale): string {
  return locale === 'en-US' ? 'EN' : '繁'
}
