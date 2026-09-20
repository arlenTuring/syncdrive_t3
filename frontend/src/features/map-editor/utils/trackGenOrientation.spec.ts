import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { locateByField } from './trackGenLocate'
import {
  findReversedTrackGenFacilities,
  isTrackGenLocalReversed,
  normalizeTrackGenOrientation,
} from './trackGenOrientation'
import { parseMapFileJson } from './mapFileJson'
import { backfillTrackGenSpansInAreas } from './trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from './trackRefFieldBoundsRepair'
import { buildTrackNetwork, trackAreaLocalAt } from '../vehicles/resolveVehicleTrackPlacement'

/**
 * 圖面中心線與真實中心線的順序。
 *
 * 一塊水平的方塊：場域範圍 x −100～−50。真實路徑從東（−50）走到西（−100）；圖面路徑
 * 若是從外框左走到右，車就會被畫在鏡像的位置。
 */

function facility(local: number[][], rotation = 0): FacilityObject {
  return {
    id: 'f1',
    type: 'Track',
    name: 'Rail',
    customName: 'F1',
    rotation,
    parameters: {
      refFieldXMinM: -100,
      refFieldXMaxM: -50,
      refFieldYMinM: -12,
      refFieldYMaxM: -10,
      trackGenRealPath: [[-50, -11], [-75, -11], [-100, -11]],
      trackGenLocalPath: local,
    },
  } as unknown as FacilityObject
}

describe('順序判斷', () => {
  it('真實路徑東→西、圖面路徑左→右：反了', () => {
    expect(isTrackGenLocalReversed(facility([[0, 0.5], [1, 0.5]]))).toBe(true)
  })

  it('圖面路徑右→左：對', () => {
    expect(isTrackGenLocalReversed(facility([[1, 0.5], [0, 0.5]]))).toBe(false)
  })

  it('旋轉 90° 的方塊判不準：不動', () => {
    expect(isTrackGenLocalReversed(facility([[0, 0.5], [1, 0.5]], 90))).toBeNull()
  })

  it('旋轉 180°：外框軸與場域軸整個反過來', () => {
    expect(isTrackGenLocalReversed(facility([[0, 0.5], [1, 0.5]], 180))).toBe(false)
    expect(isTrackGenLocalReversed(facility([[1, 0.5], [0, 0.5]], 180))).toBe(true)
  })

  it('沒有把握（頭尾在外框上差太少）：不動', () => {
    expect(isTrackGenLocalReversed(facility([[0.5, 0.5], [0.55, 0.5]]))).toBeNull()
  })

  it('倒過來，而且冪等', () => {
    const area = { id: 'a', facilities: [facility([[0, 0.5], [1, 0.5]])] } as unknown as MapAreaObject
    const once = normalizeTrackGenOrientation([area])
    expect(once[0]!.facilities[0]!.parameters!.trackGenLocalPath).toEqual([[1, 0.5], [0, 0.5]])
    expect(findReversedTrackGenFacilities(once)).toEqual([])
    expect(normalizeTrackGenOrientation(once)).toBe(once)
  })

  it('沒有要改的就原樣回傳同一個陣列', () => {
    const areas = [{ id: 'a', facilities: [facility([[1, 0.5], [0, 0.5]])] }] as unknown as MapAreaObject[]
    expect(normalizeTrackGenOrientation(areas)).toBe(areas)
  })
})

// ── 真實圖資 ───────────────────────────────────────────────────────

const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')
function loadMap(): { doc: any } | null {
  try {
    const active = JSON.parse(readFileSync(join(MAPS_DIR, 'active-map.json'), 'utf-8')) as { activeMapId: string }
    const file = join(MAPS_DIR, `${active.activeMapId}.json`)
    if (!existsSync(file)) return null
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    return { doc: raw.mapDocument ?? raw }
  } catch {
    return null
  }
}
const loaded = loadMap()

describe.skipIf(!loaded || loaded.doc.creationMode !== 'trackGen')('真實圖資：D03/U03 的畫面位置要連續', () => {
  const doc = loaded!.doc
  const rawLocal = new Map<string, unknown>()
  for (const a of doc.areas) {
    for (const f of a.facilities) if (f.parameters?.trackGenLocalPath) rawLocal.set(f.id, f.parameters.trackGenLocalPath)
  }
  /*
   * 圖資可能已經是倒正後存回來的（編輯器載入時會倒正，自動儲存就把倒正的順序寫進檔案）。
   * 這一組測試要比的是「倒正前」與「倒正後」，倒正前的樣子由已知的兩塊（D03/U03＝072、121）
   * 反推：載入後沒變＝檔案裡已經是倒正的，倒過來就是原始樣子。
   */
  {
    const parsed = parseMapFileJson(doc).areas
    for (const id of ['072', '121']) {
      const now = parsed.flatMap((a) => a.facilities).find((f) => f.id === id)?.parameters?.trackGenLocalPath
      const stored = rawLocal.get(id) as number[][] | undefined
      if (stored && JSON.stringify(now) === JSON.stringify(stored)) rawLocal.set(id, [...stored].reverse())
    }
  }
  const build = (restoreRaw: boolean): MapAreaObject[] => {
    let areas = repairTrackRefFieldBoundsInAreas(backfillTrackGenSpansInAreas(parseMapFileJson(doc).areas).areas).areas
    if (restoreRaw) {
      areas = areas.map((a) => ({
        ...a,
        facilities: a.facilities.map((f) =>
          rawLocal.has(f.id) ? { ...f, parameters: { ...f.parameters, trackGenLocalPath: rawLocal.get(f.id) } } : f,
        ),
      })) as MapAreaObject[]
    }
    return areas
  }

  /** 依序沿幾塊軌道的真實中心線取樣，看畫面座標最大的單步位移（區域像素） */
  function maxDrawnJump(areas: MapAreaObject[], names: string[]): number {
    const index = buildTrackNetwork(areas).genIndex!
    let prev: { x: number; y: number } | null = null
    let max = 0
    for (const name of names) {
      const target = areas[0]!.facilities.find((f) => f.customName === name)!
      let real = (target.parameters as { trackGenRealPath: number[][] }).trackGenRealPath
      // 由東往西開：路徑若是由西往東記的就倒過來
      if (real[0]![0]! < real[real.length - 1]![0]!) real = [...real].reverse()
      for (let i = 0; i < real.length - 1; i += 1) {
        for (let k = 0; k < 5; k += 1) {
          const x = real[i]![0]! + ((real[i + 1]![0]! - real[i]![0]!) * k) / 5
          const y = real[i]![1]! + ((real[i + 1]![1]! - real[i]![1]!) * k) / 5
          const hit = locateByField(index, x, y, { headingRad: Math.PI })
          if (!hit) continue
          const f = areas[0]!.facilities.find((g) => g.id === hit.facilityId)!
          const p = trackAreaLocalAt(f, areas[0]!, hit.along, hit.offsetM)!
          if (prev) max = Math.max(max, Math.hypot(p.x - prev.x, p.y - prev.y))
          prev = p
        }
      }
    }
    return max
  }

  it('倒正的是 D03/U03 與 121（RailSwitch），其餘不動', () => {
    const before = build(true)
    const after = build(false)
    const changed: string[] = []
    for (const a of after[0]!.facilities) {
      const b = before[0]!.facilities.find((f) => f.id === a.id)!
      if (JSON.stringify(a.parameters?.trackGenLocalPath) !== JSON.stringify(b.parameters?.trackGenLocalPath)) {
        changed.push(String(a.customName || a.id))
      }
    }
    // 121、D03/U03 是倒正；120 是載入時把分岔的圖面路徑改畫在自己的形狀上（見 bridgeSwitchCentrelinesInAreas）
    // 圖資存檔時編輯器會把倒正／對齊的結果寫回檔案，所以已存過的圖裡這幾塊不再變動：只要不多動別的就對
    expect(changed.filter((c) => !['120', '121', 'D03/U03'].includes(c))).toEqual([])
  })

  it('由 D02 開進 D03/U03，畫面位置一步一步連續，接點處不會整個外框寬地跳過去', () => {
    const jumpBefore = maxDrawnJump(build(true), ['D02', 'D03/U03'])
    const jumpAfter = maxDrawnJump(build(false), ['D02', 'D03/U03'])
    // 倒正前，進到 D03/U03 的那一步被畫在方塊另一頭，落差是整個外框寬
    expect(jumpBefore).toBeGreaterThan(80)
    expect(jumpAfter).toBeLessThan(35)
  })
})
