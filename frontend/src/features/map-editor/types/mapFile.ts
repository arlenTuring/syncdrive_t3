import type { FacilityName, FacilityType } from './facility'

/** 地圖檔 JSON 版本（匯入時向下相容 v1） */
export const MAP_FILE_SCHEMA_VERSION = 2
export const MAP_FILE_SCHEMA_VERSION_V1 = 1

export interface MapPixelSize {
  width: number
  height: number
}

export interface MapAreaLayoutEntry {
  xPx: number
  yPx: number
  wPx: number
  hPx: number
  borderPx: number
  borderColor?: string
  fillColor?: string
}

export interface MapAreaDomainEntry {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
}

export interface MapAreaMqttFieldsEntry {
  topic?: string
  vehicleIdField?: string
  xField?: string
  yField?: string
  latField?: string
  lonField?: string
}

export interface MapAreaViewEntry {
  panXM: number
  panYM: number
  zoom: number
  pxPerMeterX?: number
  pxPerMeterY?: number
  contentOffsetPxX?: number
  contentOffsetPxY?: number
}

/** Track 四角圓角（公尺）：左上、右上、右下、左下 */
export interface MapTrackCornerRadiusMeters {
  tl?: number
  tr?: number
  br?: number
  bl?: number
}

/** Geofence 文字子元件（標籤錨點為場域絕對公尺） */
export interface MapGeofenceLabel {
  id: string
  text: string
  x: number
  y: number
  rotationDeg?: number
  fontSizePx?: number
  fontWeight?: 'normal' | 'bold'
}

/** Geofence 多邊形與樣式參數（皆放在 parameters 內） */
export interface MapGeofenceParameters {
  verticesMeters?: Array<{ x: number; y: number }>
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  strokeWidthPx?: number
  strokeColor?: string
  fillEnabled?: boolean
  fillColor?: string
  labels?: MapGeofenceLabel[]
  /** 參照場域範圍（公尺，min/max；未設定可為 null） */
  refFieldXMinM?: number | null
  refFieldXMaxM?: number | null
  refFieldYMinM?: number | null
  refFieldYMaxM?: number | null
}

/** 參照場域單點（號誌／智慧桿／月台門） */
export interface MapRefFieldPositionParameters {
  refFieldXM?: number | null
  refFieldYM?: number | null
}

/** 參照場域範圍（軌道／設施／圍籬） */
export interface MapRefFieldBoundsParameters {
  refFieldXMinM?: number | null
  refFieldXMaxM?: number | null
  refFieldYMinM?: number | null
  refFieldYMaxM?: number | null
}

export interface MapFileFacilityEntry {
  id: string
  type: FacilityType
  name: FacilityName
  customName: string
  /** 場域絕對公尺座標：原點左下 (xMinM, yMinM)，x 向右、y 向上 */
  positionMeters: { x: number; y: number }
  /** 區域座標：Area 內左下原點（非地圖像素）；拉伸外框時不變 */
  areaPosition?: { x: number; y: number }
  /** @deprecated 舊欄位名；匯入時仍相容 */
  areaPositionPx?: { x: number; y: number }
  /** 區域尺寸：Area 座標系單位；拉伸外框時不變 */
  areaSizePx?: { w: number; h: number }
  /** 定位時 Area layout 寬/長（渲染錨點；拉伸外框時不變） */
  areaLayoutAnchor?: { wPx: number; hPx: number }
  rotationDeg: number
  currentState?: string
  slotOccupancy?: string
  slotEquipmentState?: string
  slotOccupancyEnabled?: Record<string, boolean>
  slotEquipmentEnabled?: Record<string, boolean>
  /** @deprecated 僅舊版匯入；會轉成 areaSizePx，不再寫回 */
  sizeMeters?: { w: number; h: number }
  parameters?: Record<string, unknown>
}

export interface MapFileAreaEntry {
  id: string
  customName: string
  layout: MapAreaLayoutEntry
  domain: MapAreaDomainEntry
  showRuler?: boolean
  mqtt?: MapAreaMqttFieldsEntry
  view?: MapAreaViewEntry
  facilities: MapFileFacilityEntry[]
}

/** 路線群組：第一層目錄，內含多條營運路線 */
export interface MapRouteGroup {
  groupId: string
  displayName: string
  routeIds: string[]
  createdAt?: string
  updatedAt?: string
}

/** 地圖內營運路線：名稱由使用者定義，站序為 DockingPoint stationId */
export interface MapPlannedRoute {
  routeId: string
  displayName: string
  stationIds: string[]
  /** 走完路線平均時間（秒）；不含月台門停靠 */
  avgTravelTimeSeconds?: number | null
  /** 走完路線最快時間（秒）；不含月台門停靠 */
  minTravelTimeSeconds?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface MapFileV2 {
  schemaVersion: typeof MAP_FILE_SCHEMA_VERSION
  mapId: string
  displayName: string
  description?: string
  /** 地圖版本號，預設 v0.0.1 */
  version?: string
  createdAt?: string
  updatedAt?: string
  /** 監控畫布像素尺寸 */
  pixelSize: MapPixelSize
  /** 畫布可視原點對應的內容座標（自上方／左側裁切後 > 0） */
  pixelOrigin?: { x: number; y: number }
  areas: MapFileAreaEntry[]
  routeGroups?: MapRouteGroup[]
  routes?: MapPlannedRoute[]
}

/** @deprecated v1 格式；匯入時自動升級為 v2 */
export interface MapFileCoordinateSystem {
  extentMeters: { width: number; height: number }
  description?: string
}

export interface MapFileV1 {
  schemaVersion: typeof MAP_FILE_SCHEMA_VERSION_V1
  mapId: string
  displayName: string
  description?: string
  coordinateSystem: MapFileCoordinateSystem
  mapCenterMeters?: { x: number; y: number }
  facilities: MapFileFacilityEntry[]
}

export type MapFileV1OrV2 = MapFileV1 | MapFileV2
