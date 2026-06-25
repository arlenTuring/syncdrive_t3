/** 編輯中自動儲存的草稿（localStorage） */
export const MAP_DRAFT_PREFIX = 'syncdrive-map-draft:'

/** 使用者確認儲存的正式版本（本機） */
export const MAP_OFFICIAL_PREFIX = 'syncdrive-map-official:'

export function saveMapDraft(mapId: string, jsonString: string): void {
  try {
    localStorage.setItem(`${MAP_DRAFT_PREFIX}${mapId}`, jsonString)
  } catch {
    /* quota / private mode */
  }
}

export function clearMapDraft(mapId: string): void {
  try {
    localStorage.removeItem(`${MAP_DRAFT_PREFIX}${mapId}`)
  } catch {
    /* ignore */
  }
}

export function saveMapOfficialVersion(mapId: string, jsonString: string): void {
  try {
    localStorage.setItem(`${MAP_OFFICIAL_PREFIX}${mapId}`, jsonString)
  } catch {
    /* ignore */
  }
}

export function clearMapOfficialVersion(mapId: string): void {
  try {
    localStorage.removeItem(`${MAP_OFFICIAL_PREFIX}${mapId}`)
  } catch {
    /* ignore */
  }
}

/** 讀取先前「是，儲存此版本」寫入的正式版 JSON 字串（無則 null） */
export function getMapOfficialVersion(mapId: string): string | null {
  try {
    return localStorage.getItem(`${MAP_OFFICIAL_PREFIX}${mapId}`)
  } catch {
    return null
  }
}
