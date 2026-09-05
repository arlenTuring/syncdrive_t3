import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US'
import zhTW from './locales/zh-TW'
import { resolveInitialLocale } from './localePreference'

void i18n.use(initReactI18next).init({
  resources: {
    'zh-TW': { translation: zhTW },
    'en-US': { translation: enUS },
  },
  lng: resolveInitialLocale(),
  fallbackLng: 'zh-TW',
  supportedLngs: ['zh-TW', 'en-US'],
  interpolation: { escapeValue: false },
  returnNull: false,
})

export default i18n
