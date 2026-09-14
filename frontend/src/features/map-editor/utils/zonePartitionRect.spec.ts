import { describe, expect, it } from 'vitest'

import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  PARENT_ZONE_ID_KEY,
  ZONE_ENTRANCE_LINKS_KEY,
  ZONE_LOCAL_FIELD_KEY,
  ZONE_PARTITION_LINK_ID_KEY,
  applyEntranceLinksToAreaFacilities,
  availableZonePartitionsForEntrance,
  readZoneEntranceLinks,
  resyncZoneChildBoundsInAreas,
  resyncZoneChildrenFromLocal,
  syncZoneChildFieldFromPlacement,
  zoneLocalRectToAbsolute,
} from './zonePartition'

/**
 * 分區是「圖上這一塊＝現場那一塊」的對應。
 *
 * 裡面的設施<strong>整個外框</strong>都照同一組比例換算，不只是中心點——兩個軸的
 * 比例尺可以差很多（實測充電區圖上 353×150 像素對現場 65×9 公尺，x 每公尺 5.4
 * 像素、y 每公尺 16.7 像素），只搬中心會讓場域範圍留著上一版的大小。
 */

function makeArea() {
  const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
  area.layout = { ...area.layout, xPx: 0, yPx: 0, wPx: 1000, hPx: 1000 }
  area.domain = { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 1000 }
  return area
}

function zone(): FacilityObject {
  return {
    id: 'zone-1',
    type: 'Facility',
    name: 'ZonePartition',
    customName: '充電區',
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    areaPosition: { x: 100, y: 100 },
    areaSizePx: { w: 400, h: 200 },
    // 圖上 400×200 像素 ＝ 現場 80×10 公尺（x 5 px/m、y 20 px/m）
    parameters: { refFieldXMinM: -100, refFieldXMaxM: -20, refFieldYMinM: -30, refFieldYMaxM: -20 },
  } as FacilityObject
}

/** 畫成橫的格位：圖上 80×20 像素，落在分區正中央 */
function slot(parameters: Record<string, unknown> = {}): FacilityObject {
  return {
    id: 'slot-1',
    type: 'Facility',
    name: 'FacilityArea',
    customName: 'E1',
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    areaPosition: { x: 260, y: 190 },
    areaSizePx: { w: 80, h: 20 },
    parameters: { [PARENT_ZONE_ID_KEY]: 'zone-1', ...parameters },
  } as FacilityObject
}

describe('zoneLocalRectToAbsolute', () => {
  const bounds = { xMinM: -100, xMaxM: -20, yMinM: -30, yMaxM: -20 }

  it('外框照兩個軸各自的比例換算', () => {
    const rect = zoneLocalRectToAbsolute({ u: 0.5, v: 0.5, du: 0.2, dv: 0.1 }, bounds)
    expect(rect).not.toBeNull()
    // x：80 公尺 × 0.2 ＝ 16 公尺；y：10 公尺 × 0.1 ＝ 1 公尺
    expect(rect!.xMaxM - rect!.xMinM).toBeCloseTo(16, 6)
    expect(rect!.yMaxM - rect!.yMinM).toBeCloseTo(1, 6)
    expect((rect!.xMinM + rect!.xMaxM) / 2).toBeCloseTo(-60, 6)
    expect((rect!.yMinM + rect!.yMaxM) / 2).toBeCloseTo(-25, 6)
  })

  it('舊資料只有中心、沒有尺寸時回 null，呼叫端維持舊行為', () => {
    expect(zoneLocalRectToAbsolute({ u: 0.5, v: 0.5 }, bounds)).toBeNull()
  })
})

describe('拖曳後同步', () => {
  it('場域外框跟著圖上外框走，不是沿用舊尺寸', () => {
    const area = makeArea()
    // 身上帶著一組過期的場域範圍（直的、而且比整個分區還高）
    const stale = slot({
      refFieldXMinM: -5, refFieldXMaxM: 5, refFieldYMinM: -12, refFieldYMaxM: 12,
    })
    area.facilities = [zone(), stale]
    const next = syncZoneChildFieldFromPlacement(stale, area)
    const q = next.parameters as Record<string, number>
    expect(q.refFieldXMaxM - q.refFieldXMinM).toBeCloseTo(16, 1)
    expect(q.refFieldYMaxM - q.refFieldYMinM).toBeCloseTo(1, 1)
    const local = (next.parameters as Record<string, unknown>)[ZONE_LOCAL_FIELD_KEY] as {
      du: number; dv: number
    }
    expect(local.du).toBeCloseTo(0.2, 6)
    expect(local.dv).toBeCloseTo(0.1, 6)
  })
})

describe('載入時重算', () => {
  it('畫成橫的格位，場域範圍也要是橫的', () => {
    const area = makeArea()
    area.facilities = [
      zone(),
      slot({ refFieldXMinM: -5, refFieldXMaxM: 5, refFieldYMinM: -12, refFieldYMaxM: 12 }),
    ]
    const { areas, changed } = resyncZoneChildBoundsInAreas([area])
    expect(changed).toEqual(['E1'])
    const q = areas[0].facilities[1].parameters as Record<string, number>
    const fw = q.refFieldXMaxM - q.refFieldXMinM
    const fh = q.refFieldYMaxM - q.refFieldYMinM
    expect(fw).toBeGreaterThan(fh)
    expect(fw).toBeCloseTo(16, 1)
    expect(fh).toBeCloseTo(1, 1)
  })

  it('已經對得起來就不算成有改動', () => {
    const area = makeArea()
    area.facilities = [
      zone(),
      slot({ refFieldXMinM: -68, refFieldXMaxM: -52, refFieldYMinM: -25.5, refFieldYMaxM: -24.5 }),
    ]
    expect(resyncZoneChildBoundsInAreas([area]).changed).toEqual([])
  })
})

describe('連結的圖元不見了', () => {
  /** 入口有兩條連結：一條接得好好的，一條指向已經被刪掉的圖元 */
  function entranceWithBrokenLink(): FacilityObject {
    return {
      id: 'entrance-1',
      type: 'Facility',
      name: 'ZoneEntrance',
      customName: '整備調度區',
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      areaPosition: { x: 0, y: 0 },
      areaSizePx: { w: 50, h: 50 },
      parameters: {
        [ZONE_ENTRANCE_LINKS_KEY]: [
          { id: 'link-ok', name: '調度區', xMinM: -900, xMaxM: -873, yMinM: -330, yMaxM: -262, zoneFacilityId: 'zone-ok' },
          // 指向的圖元已經不在了
          { id: 'link-broken', name: '整備區', xMinM: -900, xMaxM: -873, yMinM: -380, yMaxM: -330, zoneFacilityId: 'deleted-127' },
        ],
      },
    } as FacilityObject
  }

  function partition(id: string, name: string, parameters: Record<string, unknown> = {}): FacilityObject {
    return {
      id,
      type: 'Facility',
      name: 'ZonePartition',
      customName: name,
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      areaPosition: { x: 0, y: 0 },
      areaSizePx: { w: 100, h: 100 },
      parameters,
    } as FacilityObject
  }

  it('場上沒被任何連結指名的分區，可以拿來改接', () => {
    const facilities = [
      entranceWithBrokenLink(),
      partition('zone-ok', '調度區'),
      partition('zone-129', '整備區'),
    ]
    expect(availableZonePartitionsForEntrance(facilities).map((z) => z.id)).toEqual([
      'zone-129',
    ])
  })

  it('改接之後，分區拿到的是這一條連結的場域範圍', () => {
    const entrance = entranceWithBrokenLink()
    const facilities = [entrance, partition('zone-ok', '調度區'), partition('zone-129', '整備區')]
    const links = readZoneEntranceLinks(entrance.parameters).map((l) =>
      l.id === 'link-broken' ? { ...l, zoneFacilityId: 'zone-129' } : l,
    )
    const next = applyEntranceLinksToAreaFacilities(facilities, 'entrance-1', links)
    const zone = next.find((f) => f.id === 'zone-129')!
    const q = zone.parameters as Record<string, unknown>
    expect(q[ZONE_PARTITION_LINK_ID_KEY]).toBe('link-broken')
    // 整備區那一條的範圍，不是調度區的
    expect(q.refFieldYMinM).toBe(-380)
    expect(q.refFieldYMaxM).toBe(-330)
  })
})

describe('分區範圍換掉之後', () => {
  it('舊資料只記了中心時，尺寸回圖上量一次，不沿用舊值', () => {
    const area = makeArea()
    const z = zone()
    // 只有 u／v 的舊資料，身上還帶著上一版的大小
    const child = slot({
      [ZONE_LOCAL_FIELD_KEY]: { u: 0.5, v: 0.5 },
      refFieldXMinM: -5, refFieldXMaxM: 5, refFieldYMinM: -12, refFieldYMaxM: 12,
    })
    area.facilities = [z, child]

    // 沒給 area：只能搬中心，尺寸留著舊的
    const without = resyncZoneChildrenFromLocal(area.facilities, 'zone-1')[1]
    const a = without.parameters as Record<string, number>
    expect(a.refFieldYMaxM - a.refFieldYMinM).toBeCloseTo(24, 1)

    // 給了 area：回圖上量，外框跟著圖上的 80×20 像素走
    const withArea = resyncZoneChildrenFromLocal(area.facilities, 'zone-1', area)[1]
    const b = withArea.parameters as Record<string, number>
    expect(b.refFieldXMaxM - b.refFieldXMinM).toBeCloseTo(16, 1)
    expect(b.refFieldYMaxM - b.refFieldYMinM).toBeCloseTo(1, 1)
  })
})
