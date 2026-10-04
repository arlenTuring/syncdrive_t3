import {
  findYardSlotAtFieldMeters,
  isYardParkableFacilityId,
  type YardSlotFieldBox,
} from '../utils/yardFacilitySlots'
import { readVehicleSpeedMps } from './readVehicleHeading'
import { isYardVehiclePayload, parseYardSlotIdFromPayload } from './resolveVehicleTrackPlacement'

/**
 * 這台車現在算不算「停在場區格位裡」。
 *
 * <h3>為什麼不能是「座標落進格位矩形」</h3>
 * 格位矩形是場域座標裡的一塊範圍，跟軌道的中心線沒有互斥關係。實測本地圖資 M1（X −885.29～−878.83、
 * Y −291.19～−271.52）被 T3 支線（RailSwitch road 11）的兩條車道穿過：正常沿支線開的車，座標
 * 有一段時間就在 M1 的範圍裡。舊規則把「在範圍裡」直接當成「已停進格位」，於是
 * <ul>
 *   <li>有殘留的格位標記時，車被直接畫到 M1 中央；</li>
 *   <li>沒有標記時，格位代號取不到，定位回 null，車從圖上消失；</li>
 *   <li>離開範圍後又回到軌道上——看起來就是「車突然跳到 M1 又回來」。</li>
 * </ul>
 *
 * <h3>現在的規則</h3>
 * 「停進格位」必須是<strong>停</strong>：
 * <ul>
 *   <li>車速 ≥ {@link YARD_MOVING_MPS}：一律不是。開著的車照軌道／分區定位，就算座標在格位範圍裡、
 *       就算帶著格位標記（標記是殘留的）。</li>
 *   <li>還在路上：current_leg 的目標距離 > {@link YARD_ARRIVED_M}，或車端回報行駛／對位中（TRANSITING、
 *       RUNNING、DOCKING）而且還沒停下——不是。進出場、沿軌經過都屬於這一類。</li>
 *   <li><strong>有目標站不等於在跑正線</strong>：整備、待命做完之前，車端照協議回報的 current_leg
 *       就是它停著的那個設施節點，距離 0。只看「有沒有目標站」會把停妥作業的車當成載客車
 *       （2026-10-04 實測：全部停在格位的車都被判成載客、車身被推出格位半個車長）。</li>
 *   <li>帶明確標記（yard_slot_id、segment_label 是格位…）、車是停著的、而且座標確實在那一格
 *       （容許 {@link YARD_MARKER_TOLERANCE_M}）：是。標記跟位置對不上就是殘留標記，不吸附。</li>
 *   <li>只有座標落在格位裡：要<strong>停著並連續 {@link YARD_ENTER_DWELL_MS} 毫秒</strong>才算，
 *       一閃而過的低速不算。</li>
 * </ul>
 * 判定的結果只用來決定「畫在哪裡」；原始座標永遠保留，不被格位中心覆寫。
 */

export const YARD_STATIONARY_MPS = 0.5
export const YARD_MOVING_MPS = 1.0
export const YARD_ENTER_DWELL_MS = 2000
/** 離目標還遠於這個距離就是還在路上（公尺） */
export const YARD_ARRIVED_M = 2
/** 格位標記與座標對照的容許距離（公尺）：座標在格位外超過這個距離，標記視為殘留 */
export const YARD_MARKER_TOLERANCE_M = 3

/** 車端回報「行駛中／對位中」的 vehicle_phase（協議：RUNNING 與 TRANSITING 同義） */
const DRIVING_PHASES = new Set(['TRANSITING', 'RUNNING', 'DOCKING'])

export type YardClassState = {
  /** 座標在格位裡、而且低速，從什麼時候開始（遙測時間，毫秒） */
  stillSinceMs: number | null
  yard: boolean
  slotId: string | null
}

export type YardDecision = {
  yard: boolean
  /** 判成場區車時要畫進哪一格；不是場區車時為 null */
  slotId: string | null
  reason:
    | 'marker'
    | 'stationary-in-slot'
    | 'moving'
    | 'en-route'
    | 'marker-mismatch'
    | 'not-in-slot'
    | 'settling'
    | 'no-payload'
  state: YardClassState
}

export const EMPTY_YARD_STATE: YardClassState = { stillSinceMs: null, yard: false, slotId: null }

/** current_leg 的目標站（沒有就是 null） */
export function readLegTarget(payload: Record<string, unknown> | undefined): { stationId: string; distanceM: number | null } | null {
  const leg = payload?.current_leg
  if (!leg || typeof leg !== 'object') return null
  const id = (leg as { target_station_id?: unknown }).target_station_id
  if (typeof id !== 'string' || id.trim() === '') return null
  const distance = Number((leg as { distance_to_target_m?: unknown }).distance_to_target_m)
  return { stationId: id.trim(), distanceM: Number.isFinite(distance) ? distance : null }
}

/**
 * 這台車是不是還在路上（往某個目標開、進出場、沿軌經過）。
 *
 * 看三件事，任何一件成立就是：車速 ≥ {@link YARD_MOVING_MPS}；current_leg 離目標還遠於
 * {@link YARD_ARRIVED_M}；車端回報行駛／對位中而且車速不是停著。
 * 「有目標站」本身不算——停妥作業中的車，目標就是它所在的設施，距離 0。
 */
export function isEnRoute(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false
  const speed = readVehicleSpeedMps(payload)
  if (speed != null && speed >= YARD_MOVING_MPS) return true
  const leg = readLegTarget(payload)
  if (leg && leg.distanceM != null && leg.distanceM > YARD_ARRIVED_M) return true
  const phase = String(payload.vehicle_phase ?? '').toUpperCase()
  if (DRIVING_PHASES.has(phase) && !(speed != null && speed < YARD_STATIONARY_MPS)) return true
  return false
}

/**
 * payload 上的格位標記還可不可信：還在路上的車帶著標記，那是殘留的。
 * 決定「這台車屬於哪個分區」時用（見 mapMqttIngestPipeline），跟畫面上的判定同一條規則
 * （畫面上另外會對照座標與格位範圍，見 {@link classifyYardVehicle}）。
 */
export function isYardMarkerTrusted(payload: Record<string, unknown> | undefined): boolean {
  if (!payload || !isYardVehiclePayload(payload)) return false
  return !isEnRoute(payload)
}

function distanceToBoxM(box: YardSlotFieldBox, xM: number, yM: number): number {
  const dx = Math.max(box.xMinM - xM, 0, xM - box.xMaxM)
  const dy = Math.max(box.yMinM - yM, 0, yM - box.yMaxM)
  return Math.hypot(dx, dy)
}

export function classifyYardVehicle(input: {
  payload: Record<string, unknown> | undefined
  xM: number
  yM: number
  boxes: readonly YardSlotFieldBox[]
  /** 這筆資料的時間（毫秒），拿來算「停了多久」 */
  nowMs: number
  previous?: YardClassState
}): YardDecision {
  const { payload, xM, yM, boxes, nowMs } = input
  const previous = input.previous ?? EMPTY_YARD_STATE
  if (!payload) {
    return { yard: false, slotId: null, reason: 'no-payload', state: EMPTY_YARD_STATE }
  }

  const speed = readVehicleSpeedMps(payload)
  const reset: YardClassState = { stillSinceMs: null, yard: false, slotId: null }

  // 開著的車：不是。格位標記若還在就是殘留的（不論來自 telemetry 或合併進來的 operation）
  if (speed != null && speed >= YARD_MOVING_MPS) {
    return { yard: false, slotId: null, reason: 'moving', state: reset }
  }
  // 還在路上（往目標開、進出場中）：不是，就算座標剛好落在格位裡
  if (isEnRoute(payload)) {
    return { yard: false, slotId: null, reason: 'en-route', state: reset }
  }

  // 明確標記 + 車停著 + 座標確實在那一格：是
  if (isYardVehiclePayload(payload)) {
    const slotId = parseYardSlotIdFromPayload(payload) ?? findYardSlotAtFieldMeters(boxes, xM, yM)
    if (slotId && isYardParkableFacilityId(slotId)) {
      const box = boxes.find((item) => item.slotId === slotId)
      // 有這一格的範圍才能對照；座標離這一格太遠，標記是殘留的，不吸附過去
      if (box && distanceToBoxM(box, xM, yM) > YARD_MARKER_TOLERANCE_M) {
        return { yard: false, slotId: null, reason: 'marker-mismatch', state: reset }
      }
      return {
        yard: true,
        slotId,
        reason: 'marker',
        state: { stillSinceMs: previous.stillSinceMs ?? nowMs, yard: true, slotId },
      }
    }
  }

  // 只有座標：要在格位裡而且停著、連續夠久
  const boxSlot = findYardSlotAtFieldMeters(boxes, xM, yM)
  if (!boxSlot) return { yard: false, slotId: null, reason: 'not-in-slot', state: reset }
  const slow = speed != null && speed < YARD_STATIONARY_MPS
  if (!slow) return { yard: false, slotId: null, reason: 'settling', state: reset }

  const since = previous.slotId === boxSlot && previous.stillSinceMs != null ? previous.stillSinceMs : nowMs
  if (nowMs - since >= YARD_ENTER_DWELL_MS || (previous.yard && previous.slotId === boxSlot)) {
    return {
      yard: true,
      slotId: boxSlot,
      reason: 'stationary-in-slot',
      state: { stillSinceMs: since, yard: true, slotId: boxSlot },
    }
  }
  return {
    yard: false,
    slotId: null,
    reason: 'settling',
    state: { stillSinceMs: since, yard: false, slotId: boxSlot },
  }
}
