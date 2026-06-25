/**
 * 與 MQTT／即時訊號對接時建議的 payload 形狀（JSON 字串傳輸）。
 * 實際 topic／欄位可依後端約定調整。
 */

/** 更新單一「可動元件」的顯示（位置、圖示狀態） */
export type LiveVehiclePayload = {
  /** 與地圖上設施 id 或邏輯代號對應 */
  entityId: string
  /** 場域公尺（與地圖檔一致） */
  positionMeters?: { x: number; y: number }
  /** 旋轉（度） */
  rotationDeg?: number
  /** 換圖：對應前端映射表 key，例如 'driving' | 'stopped' | 'error' */
  visualState?: string
}

/** 僅換圖、不動位置時可用 */
export type LiveIconSwapPayload = {
  entityId: string
  visualState: string
}
