const MAP_EDITOR_ICONS_BASE = '/map-editor-icons'

/** 將地圖檔中的相對圖示路徑轉為可載入 URL */
export function resolveMapEditorAssetUrl(path: string | undefined): string {
  const raw = path?.trim() ?? ''
  if (!raw) return ''
  if (raw.startsWith('/') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw
  }
  return `${MAP_EDITOR_ICONS_BASE}/${raw.replace(/^\/+/, '')}`
}

export const SMART_POLE_ENABLE_ICON = `${MAP_EDITOR_ICONS_BASE}/facility/smart_pole_enable.png`
