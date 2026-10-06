import type { FacilityObject } from '../types/facility'
import {
  isZoneEntrance,
  isZonePartition,
  readParentZoneId,
  readZoneEntranceWaypointId,
  readZonePartitionBinding,
} from '../utils/zonePartition'
import { getRefFieldPosition, hasValidRefFieldPosition } from '../utils/facilityRefFieldPosition'
import { readVehicleSpeedMps } from './readVehicleHeading'

/**
 * 出廠車的呈現：任務開始後、還沒接上道路之前，畫在所屬分區出入口裡。
 *
 * <h3>為什麼要這一條</h3>
 * 出廠任務一開始，車的座標還在場內（或剛到出入口的途經點）。照座標硬判軌道，會被吸到出入口
 * 旁邊的車道（PMS02 從 D1 出廠時出現在 U21／U22）；判不到時車就從畫面消失。場內沒有軌道，
 * 這一段該畫在「它要從哪個出入口出去」。
 *
 * <h3>規則（對所有車端一樣，只看任務與位置，不看資料來源）</h3>
 * <ul>
 *   <li>任務類型看訂單的結構化欄位 transition_purpose＝yard_exit，不看任務代號或卡片文字。</li>
 *   <li>任務還沒開始（車端還沒回報 PROCESSING）：不處理——原本的整備或待命還沒結束，車留在格位。</li>
 *   <li>已開始、還沒接上道路：畫在出入口裡，標示「準備出廠」（停著）或「出廠中」（在動）。</li>
 *   <li>接上道路＝離出入口途經點至少 {@link ROAD_JOIN_M} 公尺，而且定位在有效軌道上。接上之後這張單
 *       就不再回到出入口（不來回跳）。</li>
 *   <li>出入口照圖資明寫的鏈找：格位 → 分區（parentZoneId）→ 分區出入口（zonePartitionEntranceId）→
 *       途經點（zoneEntranceWaypointId）。不依格位代號前綴或座標猜。</li>
 * </ul>
 * 原始遙測座標不改，只決定畫在哪裡。
 */

export const ROAD_JOIN_M = 10
const STATIONARY_MPS = 0.5

export type OrderTaskMeta = {
  transitionPurpose: string | null
  /** 過渡任務的設施（出廠的起點格位代號） */
  transitionFacility: string | null
  yardSlotId: string | null
}

export type ZoneEntranceInfo = {
  entrance: FacilityObject
  waypoint: { xM: number; yM: number } | null
}

/** 格位（id 或代號）→ 它所屬分區的出入口與途經點；任何一段沒接上回 null */
export function zoneEntranceForSlot(
  facilities: readonly FacilityObject[],
  slot: string | null | undefined,
): ZoneEntranceInfo | null {
  const key = String(slot ?? '').trim()
  if (!key) return null
  const facility =
    facilities.find((f) => f.id === key) ??
    facilities.find((f) => typeof f.customName === 'string' && f.customName.trim() === key)
  if (!facility) return null
  const zoneId = readParentZoneId(facility.parameters)
  if (!zoneId) return null
  const zone = facilities.find((f) => f.id === zoneId)
  if (!zone || !isZonePartition(zone)) return null
  const binding = readZonePartitionBinding(zone.parameters)
  if (!binding?.entranceId) return null
  const entrance = facilities.find((f) => f.id === binding.entranceId)
  if (!entrance || !isZoneEntrance(entrance)) return null
  const waypointId = readZoneEntranceWaypointId(entrance.parameters)
  const waypoint = waypointId ? facilities.find((f) => f.id === waypointId) : undefined
  const at =
    waypoint && hasValidRefFieldPosition(waypoint.parameters)
      ? getRefFieldPosition(waypoint.parameters)
      : null
  return { entrance, waypoint: at && at.xM != null && at.yM != null ? { xM: at.xM, yM: at.yM } : null }
}

export type YardExitLatch = { orderId: string; joinedRoad: boolean }

export type YardExitStage = {
  stage: 'preparing' | 'exiting'
  label: string
  entrance: FacilityObject
}

function readString(payload: Record<string, unknown> | undefined, key: string): string {
  const v = payload?.[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** 車端回報這張單已開始 */
export function orderStarted(payload: Record<string, unknown> | undefined): boolean {
  const status = readString(payload, 'order_status').toUpperCase()
  if (status === 'PROCESSING' || status === 'RUNNING') return true
  const phase = readString(payload, 'vehicle_phase').toUpperCase()
  return phase === 'TRANSITING' || phase === 'RUNNING' || phase === 'DOCKING' || phase === 'DWELLING'
}

export function decideYardExitStage(args: {
  orderId: string | null
  meta: OrderTaskMeta | undefined
  payload: Record<string, unknown> | undefined
  xM: number
  yM: number
  /** 這一筆的定位是有效軌道（generated） */
  onRoadTrack: boolean
  facilities: readonly FacilityObject[]
  previous: YardExitLatch | undefined
}): { stage: YardExitStage | null; latch: YardExitLatch | undefined } {
  const { orderId, meta, payload } = args
  if (!orderId || meta?.transitionPurpose !== 'yard_exit') return { stage: null, latch: undefined }
  const latch: YardExitLatch =
    args.previous?.orderId === orderId ? args.previous : { orderId, joinedRoad: false }
  if (latch.joinedRoad) return { stage: null, latch }
  if (!orderStarted(payload)) return { stage: null, latch }
  const info = zoneEntranceForSlot(args.facilities, meta.transitionFacility ?? meta.yardSlotId)
  if (!info) return { stage: null, latch }
  const awayFromEntrance = info.waypoint
    ? Math.hypot(args.xM - info.waypoint.xM, args.yM - info.waypoint.yM) >= ROAD_JOIN_M
    : true
  if (args.onRoadTrack && awayFromEntrance) {
    return { stage: null, latch: { orderId, joinedRoad: true } }
  }
  const speed = readVehicleSpeedMps(payload) ?? 0
  const stage: YardExitStage['stage'] = speed < STATIONARY_MPS ? 'preparing' : 'exiting'
  return {
    stage: { stage, label: stage === 'preparing' ? '準備出廠' : '出廠中', entrance: info.entrance },
    latch,
  }
}
