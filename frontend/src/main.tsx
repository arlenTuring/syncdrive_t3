import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'
import { LocaleBootstrap } from './i18n/LocaleBootstrap'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleBootstrap>
      <App />
    </LocaleBootstrap>
  </StrictMode>,
)
