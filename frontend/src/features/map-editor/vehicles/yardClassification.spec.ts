import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { mergeOperationFields } from '../../dashboard/elements/mapMqttIngestPipeline'
import { parseMapFileJson } from '../utils/mapFileJson'
import { backfillTrackGenSpansInAreas } from '../utils/trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from '../utils/trackRefFieldBoundsRepair'
import { collectYardSlotFieldBoxes, type YardSlotFieldBox } from '../utils/yardFacilitySlots'
import {
  buildTrackNetwork,
  resolveVehiclePlacementAcrossAreas,
} from './resolveVehicleTrackPlacement'
import {
  YARD_ENTER_DWELL_MS,
  classifyYardVehicle,
  isYardMarkerTrusted,
  type YardClassState,
} from './yardClassification'

/**
 * 「停在格位裡」的判定。
 *
 * 場景是實測的 M1：它的場域範圍被 T3 支線穿過，開著的車座標也會落在裡面。
 */

const BOXES: YardSlotFieldBox[] = [
  { slotId: 'M1', xMinM: -885.29, xMaxM: -878.83, yMinM: -291.19, yMaxM: -271.52 },
  { slotId: 'M2', xMinM: -885.29, xMaxM: -878.83, yMinM: -325, yMaxM: -305.33 },
]
const IN_M1 = { xM: -882.4, yM: -280 }
const OUTSIDE = { xM: -882.4, yM: -260 }

const payload = (extra: Record<string, unknown> = {}, speed: number | null = 0) => ({
  vehicle_code: 'PMS01',
  ...(speed == null ? {} : { kinematics: { velocity: speed } }),
  ...extra,
})

describe('開著的車：不是場區車，不論座標在不在格位裡、有沒有殘留標記', () => {
  it('在 M1 範圍裡以 5 m/s 開過去', () => {
    const d = classifyYardVehicle({ payload: payload({}, 5), ...IN_M1, boxes: BOXES, nowMs: 1000 })
    expect(d.yard).toBe(false)
    expect(d.reason).toBe('moving')
    expect(d.slotId).toBeNull()
  })

  it('殘留的 yard_slot_id 標記（車已經在開了）', () => {
    const d = classifyYardVehicle({
      payload: payload({ yard_slot_id: 'M1' }, 4),
      ...IN_M1,
      boxes: BOXES,
      nowMs: 1000,
    })
    expect(d.yard).toBe(false)
    expect(d.reason).toBe('moving')
  })

  it('往目標開（離目標還遠）：就算低速、帶著標記也不是', () => {
    const d = classifyYardVehicle({
      payload: payload({ yard_slot_id: 'M1', current_leg: { target_station_id: 't3_u', distance_to_target_m: 120 } }, 0.3),
      ...IN_M1,
      boxes: BOXES,
      nowMs: 1000,
    })
    expect(d.yard).toBe(false)
    expect(d.reason).toBe('en-route')
  })

  it('車端回報行駛中、還沒停下：不是', () => {
    const d = classifyYardVehicle({
      payload: payload({ yard_slot_id: 'M1', vehicle_phase: 'TRANSITING' }, 0.8),
      ...IN_M1,
      boxes: BOXES,
      nowMs: 1000,
    })
    expect(d.reason).toBe('en-route')
  })
})

describe('停著的車', () => {
  it('停妥作業中（車端回報目標＝所在設施、距離 0、RUNNING）：用格位定位', () => {
    // 2026-10-04 實測 PMS09 保養中的資料：有 current_leg、vehicle_phase RUNNING、車速 0
    const d = classifyYardVehicle({
      payload: payload({ yard_slot_id: 'M1', vehicle_phase: 'RUNNING', current_leg: { target_station_id: '142', distance_to_target_m: 0, eta_seconds: 0 } }, 0),
      ...IN_M1,
      boxes: BOXES,
      nowMs: 1000,
    })
    expect(d.yard).toBe(true)
    expect(d.reason).toBe('marker')
    expect(d.slotId).toBe('M1')
  })

  it('標記跟座標對不上（停在一般站點、帶著殘留標記）：不吸附', () => {
    const d = classifyYardVehicle({
      payload: payload({ yard_slot_id: 'M1' }, 0),
      ...OUTSIDE,
      boxes: BOXES,
      nowMs: 1000,
    })
    expect(d.yard).toBe(false)
    expect(d.reason).toBe('marker-mismatch')
  })

  it('帶標記而且停著：立刻是，格位取自標記', () => {
    const d = classifyYardVehicle({
      payload: payload({ yard_slot_id: 'M1' }, 0),
      ...IN_M1,
      boxes: BOXES,
      nowMs: 1000,
    })
    expect(d.yard).toBe(true)
    expect(d.slotId).toBe('M1')
    expect(d.reason).toBe('marker')
  })

  it('只有座標：停著並連續超過門檻才算，之前是「觀察中」，不是場區車', () => {
    let state: YardClassState | undefined
    const at = (t: number) => {
      const d = classifyYardVehicle({ payload: payload({}, 0.1), ...IN_M1, boxes: BOXES, nowMs: t, previous: state })
      state = d.state
      return d
    }
    expect(at(0).yard).toBe(false)
    expect(at(0).reason).toBe('settling')
    expect(at(YARD_ENTER_DWELL_MS - 100).yard).toBe(false)
    const entered = at(YARD_ENTER_DWELL_MS + 100)
    expect(entered.yard).toBe(true)
    expect(entered.slotId).toBe('M1')
    expect(entered.reason).toBe('stationary-in-slot')
  })

  it('一閃而過的低速（起步、煞車）重新計時，不會累積成「停了很久」', () => {
    let state: YardClassState | undefined
    const at = (t: number, speed: number) => {
      const d = classifyYardVehicle({ payload: payload({}, speed), ...IN_M1, boxes: BOXES, nowMs: t, previous: state })
      state = d.state
      return d
    }
    at(0, 0.1)
    at(1500, 2.0) // 開起來了：重置
    expect(at(2500, 0.1).yard).toBe(false)
    expect(at(2600 + YARD_ENTER_DWELL_MS, 0.1).yard).toBe(true)
  })

  it('速度不明時不能靠座標判定（分不出是停著還是在開）', () => {
    const d = classifyYardVehicle({ payload: payload({}, null), ...IN_M1, boxes: BOXES, nowMs: 99_999 })
    expect(d.yard).toBe(false)
  })

  it('停在格位外：不是', () => {
    const d = classifyYardVehicle({ payload: payload({}, 0), ...OUTSIDE, boxes: BOXES, nowMs: 1000 })
    expect(d.yard).toBe(false)
    expect(d.reason).toBe('not-in-slot')
  })

  it('已經算場區車的，開走（速度回到 1 m/s 以上）就立刻不是', () => {
    const first = classifyYardVehicle({ payload: payload({ yard_slot_id: 'M1' }, 0), ...IN_M1, boxes: BOXES, nowMs: 0 })
    const d = classifyYardVehicle({ payload: payload({}, 3), ...IN_M1, boxes: BOXES, nowMs: 500, previous: first.state })
    expect(d.yard).toBe(false)
  })
})

describe('標記可不可信（決定屬於哪個分區時用）', () => {
  it('停著帶標記：可信；開著或跑載客任務：不可信', () => {
    expect(isYardMarkerTrusted(payload({ yard_slot_id: 'M1' }, 0))).toBe(true)
    expect(isYardMarkerTrusted(payload({ yard_slot_id: 'M1' }, 6))).toBe(false)
    expect(isYardMarkerTrusted(payload({ yard_slot_id: 'M1', current_leg: { target_station_id: 'x', distance_to_target_m: 80 } }, 0))).toBe(false)
    // 停妥作業中：目標就是它所在的設施、距離 0——有目標站不等於在跑正線
    expect(isYardMarkerTrusted(payload({ yard_slot_id: 'M1', current_leg: { target_station_id: '142', distance_to_target_m: 0 } }, 0))).toBe(true)
    expect(isYardMarkerTrusted(payload({}, 0))).toBe(false)
  })
})

describe('營運訊息的格位標記與遙測的時間關係', () => {
  const operation = { timestamp: 10_000, yard_slot_id: 'M1', order_id: null }

  it('遙測不比營運訊息新：標記保留', () => {
    const merged = mergeOperationFields({ timestamp: 10_050 }, operation)
    expect(merged.yard_slot_id).toBe('M1')
  })

  it('遙測已經比營運訊息新超過門檻、而且不帶格位：營運訊息裡那個標記作廢', () => {
    const merged = mergeOperationFields({ timestamp: 13_000 }, operation)
    expect(merged.yard_slot_id).toBeUndefined()
  })

  it('遙測自己帶著格位：照用', () => {
    const merged = mergeOperationFields({ timestamp: 13_000, yard_slot_id: 'M2' }, operation)
    expect(merged.yard_slot_id).toBe('M2')
  })

  it('營運訊息屬於上一張單（班次不同）：它的目標與行駛狀態不合併，不蓋過新的停妥狀態', () => {
    const merged = mergeOperationFields(
      { timestamp: 10_000, trip_code: 'MT-M3-R9-0', yard_slot_id: 'M3' },
      { timestamp: 10_000, trip_code: 'TN0130', vehicle_phase: 'TRANSITING', current_leg: { target_station_id: 't3_u', distance_to_target_m: 300 } },
    )
    expect(merged.current_leg).toBeUndefined()
    expect(merged.vehicle_phase).toBeUndefined()
    expect(isYardMarkerTrusted(merged)).toBe(true)
  })

  it('沒有時間戳就照舊合併（沒有證據說它過期）', () => {
    const merged = mergeOperationFields({}, { yard_slot_id: 'M1' })
    expect(merged.yard_slot_id).toBe('M1')
  })
})

// ── 真實圖資：M1 被 T3 支線穿過 ─────────────────────────────────────

const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')
function loadMap(): unknown | null {
  try {
    const active = JSON.parse(readFileSync(join(MAPS_DIR, 'active-map.json'), 'utf-8')) as { activeMapId: string }
    const file = join(MAPS_DIR, `${active.activeMapId}.json`)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null
  } catch {
    return null
  }
}
const raw = loadMap() as { mapDocument?: unknown } | null
const inner = raw ? ((raw.mapDocument ?? raw) as { creationMode?: string }) : null

describe.skipIf(!inner || inner.creationMode !== 'trackGen')('真實圖資：開過 M1 的車不跳格、不消失', () => {
  const areas = repairTrackRefFieldBoundsInAreas(
    backfillTrackGenSpansInAreas(parseMapFileJson(inner as never).areas).areas,
  ).areas
  const network = buildTrackNetwork(areas)
  const boxes = collectYardSlotFieldBoxes(areas)
  const m1 = boxes.find((b) => b.slotId === 'M1')

  it('圖資裡 M1 的範圍確實被支線穿過（這是問題的前提）', () => {
    expect(m1).toBeTruthy()
    // 支線第二車道 x≈-882.4 落在 M1 範圍中間
    expect(-882.4).toBeGreaterThan(m1!.xMinM)
    expect(-882.4).toBeLessThan(m1!.xMaxM)
  })

  it('沿支線以 5 m/s 由北往南開過 M1，每一筆都不是場區車、都定位得到軌道', () => {
    let previous: YardClassState | undefined
    let previousTrackId: string | undefined
    let inside = 0
    for (let y = -244; y >= -294; y -= 0.5) {
      const x = -882.4 + ((-244 - y) / 50) * 0.6 // 車道 2 的中心線：(-882.4,-244.7) → (-881.8,-294.7)
      const p = payload({ yard_slot_id: 'M1' /* 殘留的標記 */ }, 5)
      const d = classifyYardVehicle({ payload: p, xM: x, yM: y, boxes, nowMs: (244 + y) * -200, previous })
      previous = d.state
      if (y <= m1!.yMaxM && y >= m1!.yMinM) inside += 1
      expect(d.yard, `y=${y}`).toBe(false)
      const placed = resolveVehiclePlacementAcrossAreas(areas, x, y, network, {
        preferYardPlacement: d.yard,
        yardSlotId: d.slotId,
        payload: p,
        speedMps: 5,
        previousTrackId,
      })
      expect(placed, `y=${y} 不能消失`).not.toBeNull()
      previousTrackId = placed?.placement.trackId
    }
    expect(inside).toBeGreaterThan(30)
  })

  it('真的停進 M1（停著、格位中心）：連續超過門檻後才畫進格位，格位取自座標', () => {
    const cx = (m1!.xMinM + m1!.xMaxM) / 2
    const cy = (m1!.yMinM + m1!.yMaxM) / 2
    let last = classifyYardVehicle({ payload: payload({}, 0), xM: cx, yM: cy, boxes, nowMs: 0 })
    expect(last.yard).toBe(false)
    last = classifyYardVehicle({ payload: payload({}, 0), xM: cx, yM: cy, boxes, nowMs: 2500, previous: last.state })
    expect(last.yard).toBe(true)
    expect(last.slotId).toBe('M1')
    // 沒有 payload 標記也畫得出來（以前這種情況取不到格位代號，定位回 null，車消失）
    const placed = resolveVehiclePlacementAcrossAreas(areas, cx, cy, network, {
      preferYardPlacement: true,
      yardSlotId: last.slotId,
      payload: payload({}, 0),
    })
    expect(placed).not.toBeNull()
  })
})
