import type { CSSProperties } from 'react'

/** 單一 CSS 圖層（div 疊加） */
export interface MapVehicleCssLayer {
  kind: 'css'
  id: string
  zIndex?: number
  style: CSSProperties
}

/** 設計稿巴士剪影（vehicle.svg） */
export interface MapVehicleSvgBodyLayer {
  kind: 'svg-body'
  id: string
  zIndex?: number
}

/** 車輛代碼標籤 */
export interface MapVehicleLabelLayer {
  kind: 'label'
  id: string
  zIndex?: number
  style?: CSSProperties
}

export type MapVehicleLayer =
  | MapVehicleCssLayer
  | MapVehicleSvgBodyLayer
  | MapVehicleLabelLayer

/** 由多個 CSS layer 組成的車輛圖示規格 */
export interface MapVehicleIconSpec {
  id: string
  name: string
  /** 圖示外框寬高（px，scale 1） */
  width: number
  height: number
  /** 錨點：車輛座標對齊點（0–1，相對於外框） */
  anchorX: number
  anchorY: number
  layers: MapVehicleLayer[]
}

/** Area 內即時車輛（MQTT 或示範） */
export interface AreaVehicleLive {
  areaId: string
  vehicleId: string
  /** MQTT 原始場域座標（公尺） */
  xM: number
  yM: number
  /** @deprecated 圖示改由 domain 線性映射；保留欄位相容舊資料 */
  areaLocalX?: number
  areaLocalY?: number
  /** @deprecated */
  trackId?: string | null
  payload: Record<string, unknown>
  topic: string
  updatedAt: number
  isDemo?: boolean
}
