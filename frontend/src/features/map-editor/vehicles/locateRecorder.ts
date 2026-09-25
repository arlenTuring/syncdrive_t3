/**
 * 車輛判位的離線錄製（診斷用，預設關閉）。
 *
 * 在瀏覽器 console 設 `window.__LOCATE_RECORDER__ = []` 開始錄；圖台每次<strong>真的重算</strong>
 * 一台車的判位時（輸入變了、不是每個動畫影格）推一筆進去，上限 MAX_FRAMES 筆，滿了就丟最舊的。
 * 錄完把陣列與 `window.__LOCATE_RECORDER_MAP__`（當時的地圖與路線）存成檔，就能在離線測試裡
 * 用同一批資料重播判位、比較修改前後。
 */

import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import type { BranchIdentity, LocateCandidateDiag } from '../utils/trackGenLocate'

const MAX_FRAMES = 20_000

export type LocateRecordFrame = {
  /** 收到這筆遙測的時刻（毫秒） */
  t: number
  vehicleId: string
  xM: number
  yM: number
  headingRad: number | null
  speedMps: number | null
  targetStationId: string | null
  legKey: string
  /** 原始遙測中跟判位有關的欄位（位置、姿態、速度、任務段） */
  raw: Record<string, unknown>
  preferYard: boolean
  yardSlotId: string | null
  previousTrackId: string | null
  corridor: string[] | null
  /** 任務的有序路徑、目前索引與這一筆使用的合法分支窗口（新版錄製才有） */
  route?: { key: string; branchIds: string[]; index: number | null; window: string[] } | null
  /** 跨時間分支狀態為什麼沒有沿用（新版錄製才有） */
  trackerReset?: string | null
  /** 最後用哪一種映射畫出來、畫在區域的哪裡（新版錄製才有） */
  placement?: {
    source: string | null
    trackId: string
    areaId: string
    areaLocalX: number
    areaLocalY: number
  } | null
  result: {
    trackId: string | null
    alongFrac: number | null
    offsetM: number | null
    distanceM: number | null
    /** 新版：軌道身分判定 */
    identity?: BranchIdentity | null
    /** 新版：幾何距離差（公尺） */
    distanceMarginM?: number | null
    /** 新版：綜合評分差（不是公尺） */
    scoreMargin?: number | null
    offRoute?: boolean | null
    /** 舊版錄製：啟發式分數與評分差（修改前的判位） */
    confidence?: number | null
    margin?: number | null
    headingConflict: boolean | null
  }
  candidates: LocateCandidateDiag[] | null
}

export type LocateRecordMap = {
  capturedAt: number
  areas: MapAreaObject[]
  routes: readonly MapPlannedRoute[]
}

type RecorderWindow = Window & {
  __LOCATE_RECORDER__?: LocateRecordFrame[]
  __LOCATE_RECORDER_MAP__?: LocateRecordMap
}

function recorderWindow(): RecorderWindow | null {
  return typeof window === 'undefined' ? null : (window as RecorderWindow)
}

export function isLocateRecording(): boolean {
  return Array.isArray(recorderWindow()?.__LOCATE_RECORDER__)
}

export function recordLocateFrame(frame: LocateRecordFrame): void {
  const buf = recorderWindow()?.__LOCATE_RECORDER__
  if (!Array.isArray(buf)) return
  buf.push(frame)
  if (buf.length > MAX_FRAMES) buf.splice(0, buf.length - MAX_FRAMES)
}

export function publishLocateMap(areas: MapAreaObject[], routes: readonly MapPlannedRoute[]): void {
  const w = recorderWindow()
  if (!w || !Array.isArray(w.__LOCATE_RECORDER__)) return
  w.__LOCATE_RECORDER_MAP__ = { capturedAt: Date.now(), areas, routes }
}

/** 原始遙測裡跟判位有關的欄位；整包太大，只留會影響判位與診斷的部分 */
export function pickLocateRaw(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {}
  const keys = [
    'timestamp',
    'local_pose',
    'kinematics',
    'current_leg',
    'order_id',
    'trip_code',
    'status',
    'yard_slot_id',
    'x',
    'y',
    'heading',
  ]
  const out: Record<string, unknown> = {}
  for (const k of keys) if (payload[k] !== undefined) out[k] = payload[k]
  return out
}
