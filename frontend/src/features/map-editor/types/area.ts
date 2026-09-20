import type { FacilityObject } from './facility'
import { ensureAreaContentScale } from '../utils/areaCoords'

/** Area 在 Map 畫布上的外框（像素）— 僅為編輯用框線，不參與 MQTT 座標 */
export interface MapAreaLayout {
  xPx: number
  yPx: number
  wPx: number
  hPx: number
  /** 外框線粗細（px）；0 表示不顯示 */
  borderPx: number
  /** 外框線顏色；預設 transparent */
  borderColor?: string
  /** 區域底色；未指定或 transparent 時不繪製 */
  fillColor?: string
}

/** Area 物理範圍（公尺）：四邊對齊 Area 內框，定義像素↔公尺換算，非設施移動邊界 */
export interface MapAreaDomain {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
}

/** Area 內 MQTT 車輛定位與訂閱設定 */
export interface MapAreaMqttFields {
  /** 訂閱主題（支援 + 萬用字元，如 v1/vtms/+/telemetry/update） */
  topic?: string
  /** payload 內車輛識別欄位，如 vehicle_code */
  vehicleIdField?: string
  /** 場域 X 公尺欄位路徑，如 x 或 position.x */
  xField?: string
  /** 場域 Y 公尺欄位路徑，如 y 或 position.y */
  yField?: string
  /** 若未提供 x/y，可改讀經緯度欄位（需後端或前端轉換） */
  latField?: string
  lonField?: string
  /** 訂閱含 + 時，展開為各 ID 的完整 topic；未提供則訂閱 pattern 本身 */
  vehicleIdAllowList?: string[]
}

/** 保留欄位相容舊地圖檔；座標換算僅用 layout + domain */
export interface MapAreaView {
  panXM: number
  panYM: number
  zoom: number
  /** 凍結的內容 px/m；拉伸外框時不變，避免元件視覺位移 */
  pxPerMeterX?: number
  /** 凍結的內容 px/m；拉伸外框時不變，避免元件視覺位移 */
  pxPerMeterY?: number
  /** 內容原點偏移（px）；一般為 0 */
  contentOffsetPxX?: number
  /** 內容原點偏移（px）；一般為 0 */
  contentOffsetPxY?: number
}

export interface MapAreaObject {
  id: string
  customName: string
  layout: MapAreaLayout
  domain: MapAreaDomain
  showRuler: boolean
  mqtt?: MapAreaMqttFields
  view: MapAreaView
  /** 設施 areaPosition 為區域座標；position 為場域公尺（隨 layout/domain 同步） */
  facilities: FacilityObject[]
  /**
   * 軌道接點：兩塊以上的軌道在同一點相接時，<strong>現場座標只存這一份</strong>。
   * 軌道端點引用接點（parameters.trackGenEnds），現場中心線的頭尾由接點決定——
   * 「兩端各說各的」在結構上不會發生。見 utils/trackJoints。
   */
  trackJoints?: TrackJoint[]
}

/** 軌道接點：圖上位置（區域像素）與現場座標（公尺）各一份 */
export interface TrackJoint {
  id: string
  /** 圖上位置（區域座標，左下原點） */
  px: number
  py: number
  /** 現場座標（公尺） */
  xM: number
  yM: number
}

export interface MapPixelSize {
  width: number
  height: number
}

/** 畫布可視區左上角對應的內容座標（裁切自上方／左側時 > 0） */
export interface MapPixelOrigin {
  x: number
  y: number
}

export const DEFAULT_MAP_PIXEL_SIZE: MapPixelSize = { width: 1920, height: 1080 }
export const DEFAULT_MAP_PIXEL_ORIGIN: MapPixelOrigin = { x: 0, y: 0 }

export function defaultMapAreaView(): MapAreaView {
  return { panXM: 0, panYM: 0, zoom: 1 }
}

export function defaultMapAreaDomain(): MapAreaDomain {
  return { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 }
}

export function createBlankArea(id: string, mapPixelSize: MapPixelSize): MapAreaObject {
  const margin = 40
  return ensureAreaContentScale({
    id,
    customName: 'Area 1',
    layout: {
      xPx: margin,
      yPx: margin,
      wPx: Math.max(200, mapPixelSize.width - margin * 2),
      hPx: Math.max(160, mapPixelSize.height - margin * 2),
      borderPx: 0,
      borderColor: 'transparent',
    },
    domain: defaultMapAreaDomain(),
    showRuler: true,
    mqtt: {
      topic: 'v1/vtms/+/telemetry/update',
      vehicleIdField: 'vehicle_code',
      xField: 'x',
      yField: 'y',
    },
    view: defaultMapAreaView(),
    facilities: [],
  })
}
