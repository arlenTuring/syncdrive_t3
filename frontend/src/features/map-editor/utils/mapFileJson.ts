import {
  clampSizeMeters,
  defaultCanvasSizePxForType,
} from '../constants/facilityDimensions'
import { metersToWorldPx } from '../constants/map'
import { PALETTE_ITEMS } from '../constants/palette'
import {
  CORNER_TRACK_KEY,
  CROSS_TRACK_KEY,
  SWITCH_TRACK_KEY,
  TAPER_TRACK_KEY,
} from './trackShapes'
import {
  clampMapPixelSize,
  DEFAULT_MAP_PIXEL_SIZE,
  type MapPixelSize,
} from '../constants/mapPixel'
import {
  createBlankArea,
  type MapAreaLayout,
  type MapAreaObject,
} from '../types/area'
import type { MapBasemapObject } from '../types/basemap'
import { ensureRefFieldParametersForExport } from './facilityRefFieldBinding'
import { ensureAreaContentScale, meterToAreaLocalPx, normalizeAreaView } from './areaCoords'
import {
  clampAreaFacilitiesInLayout,
  ensureFacilityDualCoords,
  syncAreaFacilitiesFieldCoords,
} from './facilityAreaCoords'
import type {
  FacilityName,
  FacilityObject,
  FacilityType,
  NonSlotFacilityState,
  SlotEquipmentEnabledMap,
  SlotOccupancyEnabledMap,
} from '../types/facility'
import {
  MAP_FILE_SCHEMA_VERSION,
  MAP_FILE_SCHEMA_VERSION_V1,
  type MapCreationMode,
  type MapFileAreaEntry,
  type MapFileBasemapEntry,
  type MapFileFacilityEntry,
  type MapFileV1,
  type MapFileV2,
  type MapPlannedRoute,
  type MapRouteGroup,
} from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import { parseMapRoutes } from './routePlanning'
import { parseMapRouteGroups } from './routeGroupPlanning'
import { parsePointTopology } from './pointTopology'
import { resolveAreaFillStyle } from './areaLayoutStyle'
import { syncGeofenceFacility } from './geofence'
import { sanitizeFacilitiesForEditor } from './sanitizeFacility'
import {
  getDefaultStateForType,
  isSlotEquipmentState,
  isSlotOccupancy,
  migrateLegacySlotState,
  STATES_BY_TYPE,
} from '../constants/states'
function parseAreaLayoutFromFile(
  layout: MapFileAreaEntry['layout'],
): MapAreaLayout {
  const fillRaw =
    typeof layout.fillColor === 'string' ? layout.fillColor.trim() : ''
  const fillColor =
    fillRaw && fillRaw !== 'transparent' ? fillRaw : undefined
  return {
    xPx: layout.xPx,
    yPx: layout.yPx,
    wPx: Math.max(32, layout.wPx),
    hPx: Math.max(32, layout.hPx),
    borderPx: typeof layout.borderPx === 'number' ? Math.max(0, layout.borderPx) : 0,
    borderColor:
      typeof layout.borderColor === 'string' && layout.borderColor.trim()
        ? layout.borderColor.trim()
        : 'transparent',
    ...(fillColor ? { fillColor } : {}),
  }
}

function layoutToMapEntry(layout: MapAreaLayout): MapFileAreaEntry['layout'] {
  const { backgroundColor } = resolveAreaFillStyle(layout)
  const fillColor =
    backgroundColor !== 'transparent' ? backgroundColor : undefined
  return {
    xPx: layout.xPx,
    yPx: layout.yPx,
    wPx: layout.wPx,
    hPx: layout.hPx,
    borderPx: layout.borderPx,
    borderColor: layout.borderColor,
    ...(fillColor ? { fillColor } : {}),
  }
}

const FACILITY_TYPES = [
  'Slot',
  'Facility',
  'Geofence',
  'PSD',
  'Signal',
  'Track',
  'Pole',
  'DockingPoint',
  'Waypoint',
  'RoadLine',
  'Basemap',
  'Zone',
] as const

const SLOT_NAMES = ['Parking', 'Charging', 'Wash', 'Repair'] as const

/** 舊版 Zone → Facility */
export function migrateFacilityType(type: string): FacilityType {
  if (type === 'Zone') return 'Facility'
  return type as FacilityType
}

/**
 * 舊資料誤用 Facility + purpose「智慧桿」／智慧桿圖示建立者，改為真正的設備 Pole。
 */
export function migrateMisclassifiedSmartPoleEntry(entry: MapFileFacilityEntry): MapFileFacilityEntry {
  const rawType = migrateFacilityType(String(entry.type ?? ''))
  if (rawType !== 'Facility') return entry

  const parameters =
    entry.parameters && typeof entry.parameters === 'object'
      ? { ...(entry.parameters as Record<string, unknown>) }
      : {}
  const purpose = typeof parameters.purpose === 'string' ? parameters.purpose.trim() : ''
  const iconUrl =
    typeof parameters.customIconUrl === 'string' ? parameters.customIconUrl : ''
  const looksLikeSmartPole =
    purpose === '智慧桿' || /smart_pole/i.test(iconUrl)

  if (!looksLikeSmartPole) return entry

  const nextParams: Record<string, unknown> = { ...parameters }
  delete nextParams.purpose
  // Pole 使用單點場域座標，清掉設施區塊的 bounds 占位
  delete nextParams.refFieldXMinM
  delete nextParams.refFieldXMaxM
  delete nextParams.refFieldYMinM
  delete nextParams.refFieldYMaxM
  nextParams.defaultFillColor = 'transparent'

  // 預設高瘦尺寸（畫素）；圖示 object-contain 撐滿，勿沿用設施區塊舊框
  const areaSizePx = { w: 30, h: 105 }

  return {
    ...entry,
    type: 'Pole',
    name: 'SmartPole',
    areaSizePx,
    parameters: nextParams,
  }
}

/** 舊版 ZoneArea → FacilityArea */
export function migrateFacilityName(
  type: FacilityType,
  name: string,
): FacilityName {
  if (name === 'ZoneArea') return 'FacilityArea'
  if (type === 'Geofence') return 'Geofence'
  if (type === 'Slot') {
    return SLOT_NAMES.includes(name as (typeof SLOT_NAMES)[number])
      ? (name as FacilityName)
      : 'Parking'
  }
  /*
   * 必須先對 type+name 精確匹配。
   * 先前寫成 `PALETTE_ITEMS.find(p => p.type === type)?.name`，會把所有 Track
   * （RailCorner／RailTaper／RailSwitch／RailCross）一律改成第一個 Track 項
   * 「Rail」（一般軌道）——每次載入地圖特殊形狀就消失。
   */
  const exact = PALETTE_ITEMS.find((p) => p.type === type && p.name === name)
  if (exact) return exact.name
  if (name.trim()) return name as FacilityName
  const fallback = PALETTE_ITEMS.find((p) => p.type === type)
  return (fallback?.name ?? name) as FacilityName
}

/**
 * 若 name 已被誤存成一般軌道 Rail，但 parameters 仍留有特殊形狀幾何，還原正確 name。
 */
export function recoverTrackNameFromParameters(
  name: FacilityName,
  parameters: Record<string, unknown> | undefined,
): FacilityName {
  if (name !== 'Rail' || !parameters) return name
  if (parameters[CORNER_TRACK_KEY] && typeof parameters[CORNER_TRACK_KEY] === 'object') {
    return 'RailCorner'
  }
  if (parameters[TAPER_TRACK_KEY] && typeof parameters[TAPER_TRACK_KEY] === 'object') {
    return 'RailTaper'
  }
  if (parameters[SWITCH_TRACK_KEY] && typeof parameters[SWITCH_TRACK_KEY] === 'object') {
    return 'RailSwitch'
  }
  if (parameters[CROSS_TRACK_KEY] && typeof parameters[CROSS_TRACK_KEY] === 'object') {
    return 'RailCross'
  }
  return name
}

export function isMapFileV2(v: unknown): v is MapFileV2 {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.schemaVersion === MAP_FILE_SCHEMA_VERSION && typeof o.mapId === 'string'
}

export function isMapFileV1(v: unknown): v is MapFileV1 {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.schemaVersion === MAP_FILE_SCHEMA_VERSION_V1 && typeof o.mapId === 'string'
}

function parseSlotOccupancyEnabled(raw: unknown): SlotOccupancyEnabledMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: SlotOccupancyEnabledMap = {}
  for (const k of ['Vacant', 'Occupied'] as const) {
    if (k in o && typeof o[k] === 'boolean') out[k] = o[k]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseSlotEquipmentEnabled(raw: unknown): SlotEquipmentEnabledMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: SlotEquipmentEnabledMap = {}
  for (const k of ['Idle', 'Working', 'Charging', 'Repairing', 'Error'] as const) {
    if (k in o && typeof o[k] === 'boolean') out[k] = o[k]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function slotEnabledFromMapEntry(entry: MapFileFacilityEntry) {
  const occEn = parseSlotOccupancyEnabled(entry.slotOccupancyEnabled)
  const eqEn = parseSlotEquipmentEnabled(entry.slotEquipmentEnabled)
  return {
    ...(occEn ? { slotOccupancyEnabled: occEn } : {}),
    ...(eqEn ? { slotEquipmentEnabled: eqEn } : {}),
  }
}

function sizeMetersFromMapEntry(
  entry: MapFileFacilityEntry,
  domain: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
): { w: number; h: number } | undefined {
  const sm = entry.sizeMeters
  if (!sm || typeof sm !== 'object') return undefined
  const maxW = domain.xMaxM - domain.xMinM
  const maxH = domain.yMaxM - domain.yMinM
  return clampSizeMeters(
    { w: sm.w, h: sm.h },
    { w: Math.max(1, maxW), h: Math.max(1, maxH) },
  )
}

function parseFacilityEntryMeters(
  entry: MapFileFacilityEntry,
  index: number,
  domain: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
  layout: MapAreaLayout,
): FacilityObject {
  const migratedEntry = migrateMisclassifiedSmartPoleEntry(entry)
  const rawType = String(migratedEntry.type)
  const type = migrateFacilityType(rawType)
  if (rawType === 'TrackCrossover') {
    // 虛擬渡線已由交叉軌道取代並移除；明講原因，比「不支援的 type」好找
    throw new Error(
      `第 ${index + 1} 筆設施: 虛擬渡線（TrackCrossover）已移除，這張地圖要改用交叉軌道重新製作`,
    )
  }
  if (!FACILITY_TYPES.includes(rawType as (typeof FACILITY_TYPES)[number]) && type !== 'Facility') {
    throw new Error(`第 ${index + 1} 筆設施: 不支援的 type「${rawType}」`)
  }
  const pm = migratedEntry.positionMeters
  if (typeof pm?.x !== 'number' || typeof pm?.y !== 'number') {
    throw new Error(`第 ${index + 1} 筆設施: positionMeters 需為 { x, y } 數字`)
  }
  const sizeFromFile = sizeMetersFromMapEntry(migratedEntry, domain)
  const rotation = typeof migratedEntry.rotationDeg === 'number' ? migratedEntry.rotationDeg : 0
  const name = recoverTrackNameFromParameters(
    migrateFacilityName(type, String(migratedEntry.name ?? '')),
    migratedEntry.parameters && typeof migratedEntry.parameters === 'object'
      ? (migratedEntry.parameters as Record<string, unknown>)
      : undefined,
  )
  const parameters =
    migratedEntry.parameters && typeof migratedEntry.parameters === 'object'
      ? { ...migratedEntry.parameters }
      : undefined
  const position = { x: pm.x, y: pm.y }
  const areaPositionFromFile = migratedEntry.areaPosition ?? migratedEntry.areaPositionPx
  const areaPosition =
    areaPositionFromFile &&
    typeof areaPositionFromFile.x === 'number' &&
    typeof areaPositionFromFile.y === 'number'
      ? { x: areaPositionFromFile.x, y: areaPositionFromFile.y }
      : meterToAreaLocalPx(position.x, position.y, domain, layout)
  const sizeMetersProp = sizeFromFile ?? undefined
  const areaSizePx =
    migratedEntry.areaSizePx &&
    typeof migratedEntry.areaSizePx.w === 'number' &&
    typeof migratedEntry.areaSizePx.h === 'number'
      ? { w: migratedEntry.areaSizePx.w, h: migratedEntry.areaSizePx.h }
      : sizeMetersProp
        ? {
            w: metersToWorldPx(sizeMetersProp.w),
            h: metersToWorldPx(sizeMetersProp.h),
          }
        : defaultCanvasSizePxForType(type)
  const areaLayoutAnchor =
    migratedEntry.areaLayoutAnchor &&
    typeof migratedEntry.areaLayoutAnchor.wPx === 'number' &&
    typeof migratedEntry.areaLayoutAnchor.hPx === 'number'
      ? { wPx: migratedEntry.areaLayoutAnchor.wPx, hPx: migratedEntry.areaLayoutAnchor.hPx }
      : { wPx: layout.wPx, hPx: layout.hPx }
  const layoutAnchorSpread = { areaLayoutAnchor }

  if (type === 'Slot') {
    const so = migratedEntry.slotOccupancy
    const se = migratedEntry.slotEquipmentState
    if (isSlotOccupancy(so) && isSlotEquipmentState(se)) {
      return {
        id: String(migratedEntry.id),
        type: 'Slot',
        name,
        customName: String(migratedEntry.customName ?? ''),
        areaPosition,
        position,
        rotation,
        slotOccupancy: so,
        slotEquipmentState: se,
        ...layoutAnchorSpread,
        ...slotEnabledFromMapEntry(migratedEntry),
        ...(areaSizePx ? { areaSizePx } : {}),
        parameters,
      }
    }
    const migrated = migrateLegacySlotState(String(migratedEntry.currentState ?? 'Empty'))
    return {
      id: String(migratedEntry.id),
      type: 'Slot',
      name,
      customName: String(migratedEntry.customName ?? ''),
      areaPosition,
      position,
      rotation,
      slotOccupancy: migrated.slotOccupancy,
      slotEquipmentState: migrated.slotEquipmentState,
      ...layoutAnchorSpread,
      ...slotEnabledFromMapEntry(migratedEntry),
      ...(areaSizePx ? { areaSizePx } : {}),
      parameters,
    }
  }

  if (type === 'Geofence') {
    const gf = {
      id: String(migratedEntry.id),
      type: 'Geofence' as const,
      name: 'Geofence' as const,
      customName: String(migratedEntry.customName ?? ''),
      areaPosition,
      position,
      rotation,
      currentState: 'Normal' as const,
      ...layoutAnchorSpread,
      ...(areaSizePx ? { areaSizePx } : {}),
      parameters,
    }
    return syncGeofenceFacility(gf)
  }

  const nonSlotType = type as Exclude<FacilityType, 'Slot' | 'Geofence'>
  const defaultState = getDefaultStateForType(nonSlotType)
  const allowed = STATES_BY_TYPE[nonSlotType]
  const rawState = migratedEntry.currentState as NonSlotFacilityState
  const currentState = allowed.includes(rawState) ? rawState : defaultState
  return {
    id: String(migratedEntry.id),
    type: nonSlotType,
    name,
    customName: String(migratedEntry.customName ?? ''),
    areaPosition,
    position,
    rotation,
    currentState,
    ...layoutAnchorSpread,
    ...(areaSizePx ? { areaSizePx } : {}),
    parameters,
  }
}

function parseAreaEntry(entry: MapFileAreaEntry, index: number): MapAreaObject {
  const layout = entry.layout
  const domain = entry.domain
  if (
    typeof layout?.xPx !== 'number' ||
    typeof layout?.yPx !== 'number' ||
    typeof layout?.wPx !== 'number' ||
    typeof layout?.hPx !== 'number'
  ) {
    throw new Error(`第 ${index + 1} 個 Area: layout 格式錯誤`)
  }
  if (
    typeof domain?.xMinM !== 'number' ||
    typeof domain?.xMaxM !== 'number' ||
    typeof domain?.yMinM !== 'number' ||
    typeof domain?.yMaxM !== 'number'
  ) {
    throw new Error(`第 ${index + 1} 個 Area: domain 格式錯誤`)
  }
  const view = normalizeAreaView(entry.view)
  const areaLayout = parseAreaLayoutFromFile(layout)
  return ensureAreaContentScale({
    id: String(entry.id),
    customName: String(entry.customName ?? ''),
    layout: areaLayout,
    domain: {
      xMinM: domain.xMinM,
      xMaxM: domain.xMaxM,
      yMinM: domain.yMinM,
      yMaxM: domain.yMaxM,
    },
    showRuler: entry.showRuler !== false,
    mqtt: entry.mqtt,
    view,
    facilities: syncAreaFacilitiesFieldCoords(
      clampAreaFacilitiesInLayout(
        sanitizeFacilitiesForEditor(
          (entry.facilities ?? []).map((f, i) =>
            ensureFacilityDualCoords(
              parseFacilityEntryMeters(f, i, domain, areaLayout),
              domain,
              areaLayout,
            ),
          ),
        ),
        domain,
        areaLayout,
      ),
      domain,
      areaLayout,
    ),
  })
}

function migrateV1ToAreas(json: MapFileV1, pixelSize: MapPixelSize): MapAreaObject[] {
  const ext = json.coordinateSystem.extentMeters
  const domain = {
    xMinM: 0,
    xMaxM: ext.width,
    yMinM: 0,
    yMaxM: ext.height,
  }
  const blank = createBlankArea('1', pixelSize)
  const facilities = syncAreaFacilitiesFieldCoords(
    sanitizeFacilitiesForEditor(
      json.facilities.map((f, i) => {
        const migrated = { ...f, type: migrateFacilityType(String(f.type)) as FacilityType }
        if (migrated.type === 'Facility' && String(migrated.name) === 'ZoneArea') {
          migrated.name = 'FacilityArea'
        }
        return parseFacilityEntryMeters(migrated, i, domain, blank.layout)
      }),
    ),
    domain,
    blank.layout,
  )
  return [
    {
      ...blank,
      customName: '預設區域',
      domain,
      facilities,
    },
  ]
}

export type ParsedMapFile = {
  mapId: string
  displayName: string
  /** 地圖說明；匯入／匯出／儲存時需 round-trip */
  description?: string
  version: string
  pixelSize: MapPixelSize
  pixelOrigin: { x: number; y: number }
  areas: MapAreaObject[]
  basemaps: MapBasemapObject[]
  routeGroups: MapRouteGroup[]
  routes: MapPlannedRoute[]
  /** 使用者最後設定的路線可視 id；缺欄＝空（不強制全開） */
  visibleRouteIds: string[]
  pointTopology: PointTopology
  /** 建立模式；缺省 blank（舊檔） */
  creationMode: MapCreationMode
  createdAt?: string
  updatedAt?: string
}

function parseOptionalDescription(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parsePixelOrigin(
  raw: { x?: number; y?: number } | undefined,
): { x: number; y: number } {
  const x = Math.max(0, Math.round(raw?.x ?? 0))
  const y = Math.max(0, Math.round(raw?.y ?? 0))
  return { x, y }
}

/** 僅保留仍存在於 routes 的 id；缺欄或非陣列 → []（載入時不強制全開） */
export function parseVisibleRouteIds(
  raw: unknown,
  routes: MapPlannedRoute[],
): string[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(routes.map((r) => r.routeId))
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || !known.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function parseBasemapEntry(entry: MapFileBasemapEntry): MapBasemapObject {
  return {
    id: entry.id,
    customName: entry.customName?.trim() || `底圖 ${entry.id}`,
    layout: {
      xPx: entry.layout.xPx,
      yPx: entry.layout.yPx,
      wPx: entry.layout.wPx,
      hPx: entry.layout.hPx,
    },
    ...(entry.parameters ? { parameters: { ...entry.parameters } } : {}),
  }
}

export function basemapToMapEntry(b: MapBasemapObject): MapFileBasemapEntry {
  return {
    id: b.id,
    customName: b.customName,
    layout: {
      xPx: b.layout.xPx,
      yPx: b.layout.yPx,
      wPx: b.layout.wPx,
      hPx: b.layout.hPx,
      borderPx: 0,
    },
    ...(b.parameters && Object.keys(b.parameters).length > 0
      ? { parameters: { ...b.parameters } }
      : {}),
  }
}

function parseCreationMode(raw: unknown): MapCreationMode {
  return raw === 'trackGen' ? 'trackGen' : 'blank'
}

export function parseMapFileJson(json: unknown): ParsedMapFile {
  if (isMapFileV2(json)) {
    const pixelSize = clampMapPixelSize(json.pixelSize ?? DEFAULT_MAP_PIXEL_SIZE)
    const areas = (json.areas ?? []).map((a, i) => parseAreaEntry(a, i))
    const basemaps = (json.basemaps ?? []).map(parseBasemapEntry)
    const routes = parseMapRoutes(json.routes)
    const creationMode = parseCreationMode(json.creationMode)
    return {
      mapId: json.mapId,
      displayName: json.displayName,
      description: parseOptionalDescription(json.description),
      version: json.version?.trim() || 'v0.0.1',
      pixelSize,
      pixelOrigin: parsePixelOrigin(json.pixelOrigin),
      // 高精新建可無 Area（等軌道生成再建）；空白／舊檔仍補一個空 Area
      areas:
        areas.length > 0
          ? areas
          : creationMode === 'trackGen'
            ? []
            : [createBlankArea('1', pixelSize)],
      basemaps,
      routes,
      routeGroups: parseMapRouteGroups(json.routeGroups),
      visibleRouteIds: parseVisibleRouteIds(json.visibleRouteIds, routes),
      pointTopology: parsePointTopology(json.pointTopology),
      creationMode,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
    }
  }

  if (isMapFileV1(json)) {
    const pixelSize = DEFAULT_MAP_PIXEL_SIZE
    return {
      mapId: json.mapId,
      displayName: json.displayName,
      description: parseOptionalDescription(json.description),
      version: 'v0.0.1',
      pixelSize,
      pixelOrigin: { x: 0, y: 0 },
      areas: migrateV1ToAreas(json, pixelSize),
      basemaps: [],
      routes: [],
      routeGroups: [],
      visibleRouteIds: [],
      pointTopology: parsePointTopology(undefined),
      creationMode: 'blank',
    }
  }

  throw new Error('無法辨識：請使用 schemaVersion 2 地圖檔')
}

function parametersForMapExport(f: FacilityObject): Record<string, unknown> | undefined {
  const raw = f.parameters ?? {}
  const merged = ensureRefFieldParametersForExport(f.type, raw, f.name)
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function facilityToMapEntry(f: FacilityObject): MapFileFacilityEntry {
  const exportedParameters = parametersForMapExport(f)
  /*
   * areaLayoutAnchor 是可選欄位。軌道生成（TrackGen）套用時曾漏寫，
   * 這裡若強制讀 .wPx 會讓 autosave 整段炸掉，UI 卡在「正在自動儲存…」。
   */
  const rawAnchor = f.areaLayoutAnchor
  const areaLayoutAnchor =
    rawAnchor &&
    typeof rawAnchor.wPx === 'number' &&
    typeof rawAnchor.hPx === 'number' &&
    Number.isFinite(rawAnchor.wPx) &&
    Number.isFinite(rawAnchor.hPx) &&
    rawAnchor.wPx > 0 &&
    rawAnchor.hPx > 0
      ? { wPx: rawAnchor.wPx, hPx: rawAnchor.hPx }
      : undefined
  const common = {
    id: f.id,
    type: f.type,
    name: f.name,
    customName: f.customName,
    positionMeters: { x: f.position.x, y: f.position.y },
    areaPosition: { x: f.areaPosition.x, y: f.areaPosition.y },
    ...(areaLayoutAnchor ? { areaLayoutAnchor } : {}),
    ...(f.areaSizePx ? { areaSizePx: { w: f.areaSizePx.w, h: f.areaSizePx.h } } : {}),
    rotationDeg: f.rotation,
    ...(exportedParameters ? { parameters: exportedParameters } : {}),
  }
  if (f.type === 'Slot') {
    return {
      ...common,
      slotOccupancy: f.slotOccupancy,
      slotEquipmentState: f.slotEquipmentState,
      ...(f.slotOccupancyEnabled && Object.keys(f.slotOccupancyEnabled).length > 0
        ? { slotOccupancyEnabled: { ...f.slotOccupancyEnabled } }
        : {}),
      ...(f.slotEquipmentEnabled && Object.keys(f.slotEquipmentEnabled).length > 0
        ? { slotEquipmentEnabled: { ...f.slotEquipmentEnabled } }
        : {}),
    }
  }
  return { ...common, currentState: f.currentState }
}

export function areaToMapEntry(a: MapAreaObject): MapFileAreaEntry {
  return {
    id: a.id,
    customName: a.customName,
    layout: layoutToMapEntry(a.layout),
    domain: { ...a.domain },
    showRuler: a.showRuler,
    mqtt: a.mqtt,
    view: { ...a.view },
    facilities: a.facilities.map(facilityToMapEntry),
  }
}

export function buildMapFileV2(
  mapId: string,
  displayName: string,
  pixelSize: MapPixelSize,
  areas: MapAreaObject[],
  options?: {
    description?: string
    version?: string
    createdAt?: string
    updatedAt?: string
    pixelOrigin?: { x: number; y: number }
    routes?: MapPlannedRoute[]
    routeGroups?: MapRouteGroup[]
    visibleRouteIds?: string[]
    pointTopology?: PointTopology
    basemaps?: MapBasemapObject[]
    creationMode?: MapCreationMode
  },
): MapFileV2 {
  const origin = parsePixelOrigin(options?.pixelOrigin)
  const routes = options?.routes ?? []
  const routeGroups = options?.routeGroups ?? []
  const pointTopology = options?.pointTopology
  const basemaps = options?.basemaps ?? []
  const description = parseOptionalDescription(options?.description)
  const visibleRouteIds = parseVisibleRouteIds(
    options?.visibleRouteIds ?? [],
    routes,
  )
  const creationMode = parseCreationMode(options?.creationMode)
  return {
    schemaVersion: MAP_FILE_SCHEMA_VERSION,
    mapId,
    displayName,
    ...(description ? { description } : {}),
    version: options?.version?.trim() || 'v0.0.1',
    ...(options?.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options?.updatedAt ? { updatedAt: options.updatedAt } : {}),
    pixelSize: clampMapPixelSize(pixelSize),
    ...(origin.x > 0 || origin.y > 0 ? { pixelOrigin: origin } : {}),
    ...(creationMode !== 'blank' ? { creationMode } : {}),
    areas: areas.map(areaToMapEntry),
    ...(basemaps.length > 0 ? { basemaps: basemaps.map(basemapToMapEntry) } : {}),
    ...(routeGroups.length > 0 ? { routeGroups } : {}),
    ...(routes.length > 0 ? { routes } : {}),
    // 一律寫入，空陣列＝使用者關掉全部；與「缺欄」舊檔區隔
    visibleRouteIds,
    ...(pointTopology && (pointTopology.nodes.length > 0 || pointTopology.edges.length > 0)
      ? { pointTopology }
      : {}),
  }
}

export function nextNumericIdFromAreas(
  areas: MapAreaObject[],
  basemaps: MapBasemapObject[] = [],
): number {
  let max = 0
  for (const b of basemaps) {
    const n = Number.parseInt(b.id, 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  for (const a of areas) {
    const nArea = Number.parseInt(a.id, 10)
    if (!Number.isNaN(nArea) && nArea > max) max = nArea
    for (const f of a.facilities) {
      const n = Number.parseInt(f.id, 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }
  return max + 1
}

/** @deprecated 使用 nextNumericIdFromAreas */
export function nextNumericIdFromFacilities(facilities: FacilityObject[]): number {
  let max = 0
  for (const f of facilities) {
    const n = Number.parseInt(f.id, 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return max + 1
}

/** 扁平化所有設施（供儀表板預覽等） */
export function flattenAreaFacilities(areas: MapAreaObject[]): FacilityObject[] {
  return areas.flatMap((a) => a.facilities)
}

/** @deprecated v1 相容 */
export function buildMapFileV1(
  mapId: string,
  displayName: string,
  areas: MapAreaObject[],
  options?: { description?: string; pixelSize?: MapPixelSize },
): MapFileV2 {
  return buildMapFileV2(
    mapId,
    displayName,
    options?.pixelSize ?? DEFAULT_MAP_PIXEL_SIZE,
    areas,
    options,
  )
}

/** @deprecated */
export function computeMapCenterMetersFromFacilities(
  facilities: FacilityObject[],
): { x: number; y: number } | null {
  if (facilities.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of facilities) {
    minX = Math.min(minX, f.position.x)
    minY = Math.min(minY, f.position.y)
    maxX = Math.max(maxX, f.position.x)
    maxY = Math.max(maxY, f.position.y)
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}
