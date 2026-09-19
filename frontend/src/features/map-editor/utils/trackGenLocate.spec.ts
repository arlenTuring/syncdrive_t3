import { describe, expect, it } from 'vitest'
import {
  buildTrackGenIndex,
  CANDIDATE_GATE_M,
  HEADING_PENALTY_M,
  locateByField,
  NON_ADJACENT_PENALTY_M,
  STICKY_BONUS_M,
  tracksAreConnected,
  type LocateFacility,
} from './trackGenLocate'

/**
 * 車輛定位的挑塊規則。
 *
 * 用手算得出答案的小幾何驗：兩條相距 3.5 公尺的反向車道、一段彎道、幾塊前後相接的
 * 軌道。真實圖資上的效果另外用離線重播看（scripts/replay-vehicle-locate.mts）。
 */

type Pt = [number, number]

/** 一塊生成軌道：真實路徑＋圖面路徑（這裡圖面路徑直接用單位框裡的同形狀，位置不重要） */
function piece(
  id: string,
  real: Pt[],
  h: number,
  extra: Record<string, unknown> = {},
): LocateFacility {
  return {
    id,
    parameters: {
      trackGenRealPath: real,
      trackGenLocalPath: real.map(([x, y]) => [x / 1000, y / 1000]),
      trackGenSpans: [{ road: id, lane: h > 0 ? 1 : -1, s0: 0, s1: 100, h, f0: 0, f1: 1 }],
      ...extra,
    },
  }
}

const EAST = 0
const WEST = Math.PI
const NORTH = Math.PI / 2

describe('方向：漸進扣分，不是直接淘汰', () => {
  // 下行往東（y=0）、上行往西（y=3.5），各 100 公尺
  const index = buildTrackGenIndex([
    piece('down', [[0, 0], [100, 0]], EAST),
    piece('up', [[100, 3.5], [0, 3.5]], WEST),
  ])

  it('沒有朝向時退回純距離', () => {
    expect(locateByField(index, 50, 0.4)?.facilityId).toBe('down')
    expect(locateByField(index, 50, 3.1)?.facilityId).toBe('up')
  })

  it('位置分不出時，車頭順著哪條就判給哪條', () => {
    // 正中間 y=1.75，離兩條一樣遠
    expect(locateByField(index, 50, 1.75, { headingRad: EAST })?.facilityId).toBe('down')
    expect(locateByField(index, 50, 1.75, { headingRad: WEST })?.facilityId).toBe('up')
  })

  it('反向車道贏不了同距離的順向車道', () => {
    // 離 down 0.5、離 up 3.0；車頭朝東（順著 down）
    expect(locateByField(index, 50, 0.5, { headingRad: EAST })?.facilityId).toBe('down')
    // 車頭朝東、卻壓在 up 的中心線上（y=3.5）：down 離 3.5，up 離 0。
    // 位置說得很清楚，方向不能翻盤——判給 up，並標出 headingConflict 讓人查資料。
    const hit = locateByField(index, 50, 3.5, { headingRad: EAST, speedMps: 8 })
    expect(hit?.facilityId).toBe('up')
    expect(hit?.headingConflict).toBe(true)
    expect(hit?.confidence).toBeLessThan(0.7)
  })

  it('候選離最近那一塊超過門檻，方向就不能讓它翻盤', () => {
    // 離 up 0.5、離 down 3.0：差 2.5 > CANDIDATE_GATE_M
    expect(locateByField(index, 50, 3.0, { headingRad: EAST })?.facilityId).toBe('up')
    // 差 0.4（y=1.95，down 1.95、up 1.55）在門檻內，方向照樣能決定
    expect(locateByField(index, 50, 1.95, { headingRad: EAST })?.facilityId).toBe('down')
    expect(CANDIDATE_GATE_M).toBeGreaterThan(0.4)
  })

  it('同一塊元件兩條車道共用一條折線（合併站體）：兩個方向都不扣分', () => {
    const merged = buildTrackGenIndex([
      {
        id: 'merged',
        parameters: {
          trackGenRealPath: [[100, 0], [0, 0]],
          trackGenLocalPath: [[0.1, 0], [0, 0]],
          trackGenSpans: [
            { road: 'm', lane: -1, s0: 0, s1: 100, h: WEST, f0: 0, f1: 1 },
            { road: 'm', lane: 1, s0: 0, s1: 100, h: WEST, f0: 0, f1: 1 },
          ],
        },
      },
      piece('other', [[0, 3.5], [100, 3.5]], EAST),
    ])
    // 車在 merged 的中心線上朝東；圖資把兩條車道都記成往西也不該被推去 other
    const hit = locateByField(merged, 50, 0, { headingRad: EAST, speedMps: 8 })
    expect(hit?.facilityId).toBe('merged')
    expect(hit?.headingConflict).toBe(false)
  })

  it('順向車道遠到超過扣分上限，反向那條就該贏', () => {
    // 車在 up 的中心線上、朝東，而 down 遠在 y=0。把 down 換成 20 公尺外：
    const far = buildTrackGenIndex([
      piece('down', [[0, -20], [100, -20]], EAST),
      piece('up', [[100, 3.5], [0, 3.5]], WEST),
    ])
    // 20 公尺外的順向車道不在同一格的候選裡，只剩 up——照樣判給 up，
    // 而不是回傳 null 或硬塞一條很遠的順向車道。
    const hit = locateByField(far, 50, 3.5, { headingRad: EAST })
    expect(hit?.facilityId).toBe('up')
    expect(hit?.distanceM).toBeCloseTo(0, 5)
  })

  it('扣分上限比上下行間距大，比「離開軌道」小', () => {
    expect(HEADING_PENALTY_M).toBeGreaterThan(3.5)
    expect(HEADING_PENALTY_M).toBeLessThan(10)
  })
})

describe('彎道：用局部切線比方向，不用整段固定的 h', () => {
  /*
   * 彎道轉一百二十度：從 (0,0) 朝東出發，整段記的行車方向 h 是起點的東（0 度）。走到
   * 尾端時車頭已經朝北偏西（約 110 度）——跟固定的 h 差超過 90 度。
   *
   * 舊規則「跟 h 差超過 90 度就淘汰」在這裡會把彎道本身排到最後，選中旁邊一條離
   * 2.5 公尺的直線。
   */
  const R = 30
  const at = (deg: number): { x: number; y: number; tan: number } => {
    const a = (deg * Math.PI) / 180
    return { x: R * Math.sin(a), y: R - R * Math.cos(a), tan: a }
  }
  const arc: Pt[] = []
  for (let deg = 0; deg <= 120; deg += 5) {
    const p = at(deg)
    arc.push([p.x, p.y])
  }

  // 彎道末端附近取一個點，旁邊 2.5 公尺放一段順著同方向的直線
  const here = at(110)
  const tan = here.tan
  const nx = Math.sin(tan)
  const ny = -Math.cos(tan)
  const side: Pt[] = [
    [here.x + 2.5 * nx - 50 * Math.cos(tan), here.y + 2.5 * ny - 50 * Math.sin(tan)],
    [here.x + 2.5 * nx + 50 * Math.cos(tan), here.y + 2.5 * ny + 50 * Math.sin(tan)],
  ]
  const index = buildTrackGenIndex([piece('arc', arc, EAST), piece('side', side, tan)])

  it('彎道末端、車頭順著切線：判給彎道本身', () => {
    const hit = locateByField(index, here.x, here.y, { headingRad: tan })
    expect(hit?.facilityId).toBe('arc')
    expect(hit?.distanceM).toBeLessThan(0.1)
  })

  it('局部行車方向跟著切線轉，不是固定的東', () => {
    const hit = locateByField(index, here.x, here.y, { headingRad: tan })!
    // 110 度上下，不是 0 度
    expect(Math.abs(hit.travelRad - tan)).toBeLessThan(0.15)
  })

  it('確認這個點確實會踩到舊規則：車頭跟固定 h 差超過 90 度', () => {
    const gap = Math.abs(tan - EAST)
    expect(gap).toBeGreaterThan(Math.PI / 2)
  })
})

describe('連續性：留在原地，或走到相連的下一塊', () => {
  // 三塊接成一條線：a → b → c；另一條平行、不相連的 d（2 公尺外，超過接點容許的 1.5）
  const index = buildTrackGenIndex([
    piece('a', [[0, 0], [50, 0]], EAST),
    piece('b', [[50, 0], [100, 0]], EAST),
    piece('c', [[100, 0], [150, 0]], EAST),
    piece('d', [[0, 2], [150, 2]], EAST),
  ])

  it('相連關係：端點對端點', () => {
    expect(tracksAreConnected(index, 'a', 'b')).toBe(true)
    expect(tracksAreConnected(index, 'b', 'c')).toBe(true)
    expect(tracksAreConnected(index, 'a', 'c')).toBe(false)
    expect(tracksAreConnected(index, 'a', 'a')).toBe(true)
  })

  it('接點資訊帶著哪一端接哪一端', () => {
    const join = index.joins.get('a')?.find((j) => j.to === 'b')
    expect(join).toEqual({ to: 'b', end: 1, toEnd: 0 })
  })

  it('實長', () => {
    expect(index.lengthM.get('a')).toBeCloseTo(50, 5)
  })

  it('沒有上一筆：離哪條近判哪條', () => {
    expect(locateByField(index, 25, 0.2)?.facilityId).toBe('a')
    expect(locateByField(index, 25, 1.8)?.facilityId).toBe('d')
  })

  it('有上一筆：還在原來那一塊就偏向它', () => {
    // 離 d 比離 a 近一點（0.9 vs 1.1），但上一筆在 a：黏著加分蓋過差距
    const hit = locateByField(index, 25, 1.1, { previousFacilityId: 'a' })
    expect(hit?.facilityId).toBe('a')
    expect(STICKY_BONUS_M).toBeGreaterThan(0.1)
  })

  it('有上一筆：跳到不相連的塊要多付代價', () => {
    // 從 a 走到 (50, 1.2)：a、b 與上一筆相連，d 不相連。d 離 0.8、a／b 離 1.2，
    // 沒有旁證時 d 贏；上一筆在 a 時，d 多付 1.5，相連的塊勝出
    expect(locateByField(index, 50, 1.2)?.facilityId).toBe('d')
    expect(locateByField(index, 50, 1.2, { previousFacilityId: 'a' })?.facilityId).not.toBe('d')
    expect(NON_ADJACENT_PENALTY_M).toBeGreaterThan(STICKY_BONUS_M)
  })

  it('證據夠強時照樣換：位置明顯在別處，上一筆不能困住它', () => {
    const hit = locateByField(index, 120, 0, { previousFacilityId: 'a' })
    expect(hit?.facilityId).toBe('c')
  })
})

describe('把握（confidence）', () => {
  it('兩條一樣近：把握低', () => {
    const index = buildTrackGenIndex([
      piece('down', [[0, 0], [100, 0]], EAST),
      piece('up', [[100, 3.5], [0, 3.5]], WEST),
    ])
    const mid = locateByField(index, 50, 1.75)!
    expect(mid.margin).toBeLessThan(0.1)
    expect(mid.confidence).toBeLessThan(0.5)
  })

  it('壓在中心線上、旁邊沒有對手：把握高', () => {
    const index = buildTrackGenIndex([piece('only', [[0, 0], [100, 0]], EAST)])
    const hit = locateByField(index, 50, 0)!
    expect(hit.margin).toBe(Infinity)
    expect(hit.confidence).toBeGreaterThan(0.9)
  })

  it('離中心線很遠：把握低，即使旁邊沒有對手', () => {
    const index = buildTrackGenIndex([piece('only', [[0, 0], [100, 0]], EAST)])
    const hit = locateByField(index, 50, 6)!
    expect(hit.confidence).toBeLessThan(0.6)
  })
})

describe('停著的車：heading 不可信', () => {
  const index = buildTrackGenIndex([
    piece('down', [[0, 0], [100, 0]], EAST),
    piece('up', [[100, 3.5], [0, 3.5]], WEST),
  ])

  it('停著時完全不用 heading：殘留的方向不該把車推到反向那條', () => {
    // y=1.95：離 down 1.95、離 up 1.55，兩條都在門檻內。heading 是上一趟殘留的朝東。
    // 開著的時候方向決定（down）；停著就只看位置（up）。
    expect(locateByField(index, 50, 1.95, { headingRad: EAST, speedMps: 8 })?.facilityId).toBe('down')
    expect(locateByField(index, 50, 1.95, { headingRad: EAST, speedMps: 0 })?.facilityId).toBe('up')
  })
})
