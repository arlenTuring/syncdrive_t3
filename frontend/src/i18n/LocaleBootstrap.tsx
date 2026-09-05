import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSystemFoundationSettings } from '../features/system-foundation/api/systemFoundationSettingsApi'
import {
  isAppLocale,
  readUserLocaleOverride,
  type AppLocale,
} from './localePreference'

/**
 * 載入系統預設語系；若使用者有本機覆寫則不覆蓋。
 * 使用者自訂別名／名稱不經由此層翻譯。
 */
export function LocaleBootstrap({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()

  useEffect(() => {
    let cancelled = false
    void fetchSystemFoundationSettings()
      .then((settings) => {
        if (cancelled) return
        if (readUserLocaleOverride()) return
        const system = settings.locale.uiLocale
        if (isAppLocale(system) && i18n.language !== system) {
          void i18n.changeLanguage(system)
        }
      })
      .catch(() => {
        // 後端未就緒時沿用本機／預設語系
      })
    return () => {
      cancelled = true
    }
  }, [i18n])

  return children
}

export async function applyUiLocale(locale: AppLocale): Promise<void> {
  const { default: i18n } = await import('./index')
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale)
  }
}
