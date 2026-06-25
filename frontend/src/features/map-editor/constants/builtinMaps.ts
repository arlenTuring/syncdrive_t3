/** 內建標準範例（還原內建範例時重載此檔） */
export const BUILTIN_EXAMPLE_MAPS = [
  {
    id: 't3-main-version',
    displayName: '軌道合併加道路線',
    path: '/maps/t3-main-version.json',
  },
] as const

/** 內建可切換的地圖檔（置於 public/maps/） */
export const BUILTIN_MAPS = [
  { id: 'blank', displayName: '（空白）', path: null as string | null },
  ...BUILTIN_EXAMPLE_MAPS,
] as const

export type BuiltinMapId = (typeof BUILTIN_MAPS)[number]['id']

/** 舊清單顯示名稱 → 內建 mapId（同步／辨識相容） */
export const LEGACY_BUILTIN_DISPLAY_NAMES: Partial<
  Record<string, (typeof BUILTIN_EXAMPLE_MAPS)[number]['id']>
> = {
  主要版本: 't3-main-version',
  完成版本: 't3-main-version',
  軌道合併加道路線: 't3-main-version',
  解析度加大版本: 't3-main-version',
  解析度不太正確版本: 't3-main-version',
}

/** 舊版 mapId → 現行內建 mapId（儀表板／本機儲存相容） */
const MAP_ID_ALIASES: Record<string, string> = {
  'vtms-main-loop': 't3-main-version',
  'vtms-current': 't3-main-version',
  't3-rail-yard': 't3-main-version',
  't3-rail-test-version': 't3-main-version',
  't3-wrong-resolution': 't3-main-version',
  'example-parking-row': 't3-main-version',
  'example-intersection': 't3-main-version',
  'example-depot': 't3-main-version',
  'example-area': 't3-main-version',
  'antigravity-rail-yard': 't3-main-version',
}

export function resolveMapId(mapId: string): string {
  return MAP_ID_ALIASES[mapId] ?? mapId
}

export function resolveBuiltinMapIdFromLibraryEntry(entry: {
  builtinId?: string
  libraryId: string
  displayName: string
  mapDocument: { mapId: string }
}): (typeof BUILTIN_EXAMPLE_MAPS)[number]['id'] | null {
  if (entry.builtinId === 't3-main-version') {
    return entry.builtinId
  }
  const legacy = LEGACY_BUILTIN_DISPLAY_NAMES[entry.displayName]
  if (legacy) return legacy
  if (entry.mapDocument.mapId === 't3-main-version' || entry.libraryId === 't3-main-version') {
    return 't3-main-version'
  }
  const aliased = MAP_ID_ALIASES[entry.mapDocument.mapId] ?? MAP_ID_ALIASES[entry.libraryId]
  if (aliased === 't3-main-version') return 't3-main-version'
  for (const meta of BUILTIN_EXAMPLE_MAPS) {
    if (entry.displayName === meta.displayName) return meta.id
  }
  return null
}
