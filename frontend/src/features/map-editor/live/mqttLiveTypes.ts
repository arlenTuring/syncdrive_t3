/** 由 MQTT（或 mock）即時套用在設施上的顯示狀態，不寫入地圖檔 */
export type MqttLiveEntry = {
  /** 即時位置（公尺），有則覆蓋設施座標顯示 */
  positionMeters?: { x: number; y: number }
  /** 即時旋轉（度） */
  rotationDeg?: number
  /** 整備格：即時空間佔用（有則覆蓋地圖檔欄位顯示） */
  slotOccupancy?: 'Vacant' | 'Occupied'
  /** 整備格：即時設備狀態 */
  slotEquipmentState?: string
  /** 月台門：開度 0–100（線性動畫） */
  psdOpenPercent?: number
  /** 月台門：告警（紅色門片） */
  psdAlarm?: boolean
  /** 軌道／場域元件：MQTT 直接覆寫填色（不寫入地圖檔） */
  fillColor?: string
  /** 號誌：MQTT 直接覆寫燈色 */
  signalLamp?: 'green' | 'red' | 'offline'
  /** 閃爍動畫觸發序號（每次 +1 重播一次） */
  blinkSeq?: number
  /** 強調邊框動畫序號 */
  highlightSeq?: number
  /** 強調邊框到期時間 */
  highlightUntil?: number
  /** 最後收到的訊息（給 UI 顯示） */
  lastReceived?: { topic: string; at: number; preview: string }
  /** 最後一次可解析的 JSON payload（供元件欄位映射） */
  payloadObject?: Record<string, unknown>
}

export type MqttLogLine = {
  ts: number
  topic: string
  payload: string
}
