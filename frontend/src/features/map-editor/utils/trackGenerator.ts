import { parseLaneCenterlines, type LaneCenterline, type LaneCenterlinePlan } from '../opendrive/laneCenterlines'

/**
 * 從 OpenDRIVE 生成簡易軌道。
 *
 * <h3>為什麼不是座標轉換</h3>
 * 簡易地圖是刻意變形的——長直線被壓短、轉角被拉成規則角度，兩者之間沒有任何一個
 * 仿射變換成立。唯一在真實地圖與簡易地圖上都成立的量是<strong>沿線走了多遠</strong>，
 * 所以整支的核心資料結構是「里程 ＋ 橫向偏移」，位置一律由這兩個數字算出來。
 *
 * <h3>四個步驟</h3>
 * <ol>
 *   <li>把車道中心線依端點與方向連續性串成路徑，取最長的兩條當上下行主線</li>
 *   <li>以曲率把主線切成直線段與彎道，方向量化到 45° 的倍數，得到「脊線」</li>
 *   <li>沿脊線切出軌道區塊，每塊帶著里程區間</li>
 *   <li>其餘車道（渡線、側線）投影到脊線上，得到各自的里程與橫向偏移</li>
 * </ol>
 * 渡線的橫向偏移沿里程改變，所以畫出來自然是斜的，不需要另外處理。
 */

export type Vec2 = { x: number; y: number }
export type LaneRole = 'down' | 'up' | 'crossover' | 'siding'

/** 脊線的一段：直線或彎道 */
export type SpineSegment =
  | { kind: 'straight'; sFrom: number; sTo: number; hdgDeg: number }
  | { kind: 'arc'; sFrom: number; sTo: number; turnDeg: number; realTurnDeg: number }

export type TrackBlock = {
  index: number
  nameDown: string
  nameUp: string
  sFrom: number
  sTo: number
  lengthM: number
  /** 上行線相對下行線的橫向偏移（公尺） */
  lateralM: number
  /** 該塊範圍內實際橫向偏移與 lateralM 的最大差，用來看生成貼不貼合 */
  residualM: number
  spineKind: 'straight' | 'arc'
}

export type ProjectedLane = {
  key: string
  role: LaneRole
  mmslLaneId: string | null
  lengthM: number
  /** [里程, 橫向偏移] 取樣序列 */
  profile: Array<[number, number]>
}

export type TrackGenResult = {
  spine: SpineSegment[]
  totalM: number
  blocks: TrackBlock[]
  lanes: ProjectedLane[]
  /** 下行主線的真實座標，供顯示每塊對應到哪裡 */
  refPoints: Vec2[]
  refStations: number[]
  warnings: string[]
}

export type TrackGenOptions = {
  /** 每塊目標長度（公尺） */
  blockLengthM?: number
  /** 串接時可容忍的端點距離（公尺） */
  joinToleranceM?: number
  /** 串接時可容忍的方向差（度） */
  joinAngleDeg?: number
  /** 判定為彎道的曲率門檻（度／公尺） */
  curvatureDegPerM?: number
}

const DEG = Math.PI / 180

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function headingAt(pts: Vec2[], i: number, j: number): number {
  return Math.atan2(pts[j]!.y - pts[i]!.y, pts[j]!.x - pts[i]!.x)
}

function angleDelta(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI) % (2 * Math.PI)) - Math.PI)
}

function resample(points: Vec2[], stepM: number): Vec2[] {
  if (points.length < 2) return [...points]
  const out: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = dist(a, b)
    const n = Math.max(1, Math.floor(len / stepM))
    for (let k = 1; k <= n; k += 1) {
      const t = k / n
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

function stationsOf(points: Vec2[]): number[] {
  const s = [0]
  for (let i = 1; i < points.length; i += 1) s.push(s[i - 1]! + dist(points[i - 1]!, points[i]!))
  return s
}

/**
 * 把車道串成連續路徑，回傳最長的一條。
 *
 * 用完整搜尋而不是貪婪地「選最直的那條」：實測在其中一個 junction 上，正確的
 * 續接與錯誤的岔路只差 1 度，貪婪法會拐進側線，整條主線就短了七百公尺。
 */
function longestPaths(lanes: LaneCenterline[], tolM: number, angleDeg: number) {
  const byKey = new Map(lanes.map((l) => [l.key, l] as const))
  const ends = new Map<string, { a: Vec2; b: Vec2; ha: number; hb: number }>()
  for (const l of lanes) {
    const p = l.points
    ends.set(l.key, {
      a: p[0]!,
      b: p[p.length - 1]!,
      ha: headingAt(p, 0, 1),
      hb: headingAt(p, p.length - 2, p.length - 1),
    })
  }

  const succ = new Map<string, string[]>()
  for (const A of lanes) {
    const ea = ends.get(A.key)!
    const list: string[] = []
    for (const B of lanes) {
      if (B.key === A.key) continue
      const eb = ends.get(B.key)!
      if (dist(ea.b, eb.a) <= tolM && angleDelta(ea.hb, eb.ha) < angleDeg * DEG) list.push(B.key)
    }
    succ.set(A.key, list)
  }

  const best = new Map<string, { len: number; path: string[] }>()
  const walk = (start: string) => {
    const seen = new Set<string>([start])
    const path = [start]
    const step = (cur: string, acc: number) => {
      const rec = best.get(start)
      if (!rec || acc > rec.len) best.set(start, { len: acc, path: [...path] })
      for (const n of succ.get(cur) ?? []) {
        if (seen.has(n)) continue
        seen.add(n)
        path.push(n)
        step(n, acc + byKey.get(n)!.lengthM)
        path.pop()
        seen.delete(n)
      }
    }
    step(start, byKey.get(start)!.lengthM)
  }
  for (const l of lanes) walk(l.key)

  return [...best.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.len - a.len)
}

function joinPath(path: string[], byKey: Map<string, LaneCenterline>): Vec2[] {
  const out: Vec2[] = []
  for (const k of path) {
    for (const p of byKey.get(k)!.points) {
      if (!out.length || dist(out[out.length - 1]!, p) > 0.2) out.push({ x: p.x, y: p.y })
    }
  }
  return out
}

/** 投影到參考折線，回傳里程與橫向偏移（行進方向左側為正） */
export function projectOnto(
  point: Vec2,
  ref: Vec2[],
  refS: number[],
): { s: number; lateral: number; distance: number } {
  let bs = 0
  let bt = 0
  let bd = Infinity
  for (let i = 1; i < ref.length; i += 1) {
    const a = ref[i - 1]!
    const b = ref[i]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const u = l2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2)) : 0
    const qx = a.x + dx * u
    const qy = a.y + dy * u
    const dd = (point.x - qx) ** 2 + (point.y - qy) ** 2
    if (dd < bd) {
      bd = dd
      const n = Math.hypot(-dy, dx) || 1
      bs = refS[i - 1]! + u * Math.hypot(dx, dy)
      bt = ((point.x - qx) * -dy + (point.y - qy) * dx) / n
    }
  }
  return { s: bs, lateral: bt, distance: Math.sqrt(bd) }
}

function buildSpine(
  ref: Vec2[],
  refS: number[],
  curvatureDegPerM: number,
): SpineSegment[] {
  const W = 8
  const raw: number[] = []
  for (let i = 0; i < ref.length; i += 1) {
    const a = Math.max(0, i - W)
    const b = Math.min(ref.length - 1, i + W)
    raw.push(Math.atan2(ref[b]!.y - ref[a]!.y, ref[b]!.x - ref[a]!.x) / DEG)
  }
  const unwrapped = [raw[0]!]
  for (let i = 1; i < raw.length; i += 1) {
    const d = ((raw[i]! - unwrapped[i - 1]! + 180) % 360) - 180
    unwrapped.push(unwrapped[i - 1]! + d)
  }

  type Run = { kind: 'straight' | 'arc'; sFrom: number; sTo: number }
  const runs: Run[] = []
  for (let i = 1; i < unwrapped.length; i += 1) {
    const ds = refS[i]! - refS[i - 1]!
    const kind: Run['kind'] =
      ds > 0 && Math.abs(unwrapped[i]! - unwrapped[i - 1]!) / ds > curvatureDegPerM ? 'arc' : 'straight'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.sTo = refS[i]!
    else runs.push({ kind, sFrom: refS[i - 1]!, sTo: refS[i]! })
  }
  // 併掉太短的段：25 公尺以下的抖動不該變成一段脊線
  const merged: Run[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && (r.sTo - r.sFrom < 25 || last.kind === r.kind)) last.sTo = r.sTo
    else merged.push({ ...r })
  }

  const hdgAt = (s: number) => {
    let lo = 0
    let hi = refS.length - 1
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1
      if (refS[m]! <= s) lo = m
      else hi = m
    }
    return unwrapped[lo]!
  }
  const q45 = (deg: number) => Math.round(deg / 45) * 45

  const spine: SpineSegment[] = []
  for (const r of merged) {
    const turn = hdgAt(r.sTo) - hdgAt(r.sFrom)
    if (r.kind === 'arc' && Math.abs(q45(turn)) >= 45) {
      spine.push({
        kind: 'arc',
        sFrom: r.sFrom,
        sTo: r.sTo,
        turnDeg: q45(turn),
        realTurnDeg: Number(turn.toFixed(1)),
      })
    } else {
      spine.push({
        kind: 'straight',
        sFrom: r.sFrom,
        sTo: r.sTo,
        hdgDeg: q45(hdgAt((r.sFrom + r.sTo) / 2)),
      })
    }
  }
  // 相鄰同向直線合併
  const out: SpineSegment[] = []
  for (const sp of spine) {
    const last = out[out.length - 1]
    if (last && last.kind === 'straight' && sp.kind === 'straight' && last.hdgDeg === sp.hdgDeg) {
      last.sTo = sp.sTo
    } else out.push(sp)
  }
  return out
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]!
}

export function generateTracks(
  plan: LaneCenterlinePlan,
  options: TrackGenOptions = {},
): TrackGenResult {
  const blockLengthM = options.blockLengthM ?? 50
  const tolM = options.joinToleranceM ?? 2.5
  const angleDeg = options.joinAngleDeg ?? 30
  const curvature = options.curvatureDegPerM ?? 0.35
  const warnings: string[] = []

  const lanes = plan.lanes.filter((l) => l.points.length >= 2)
  if (lanes.length < 2) {
    return { spine: [], totalM: 0, blocks: [], lanes: [], refPoints: [], refStations: [], warnings: ['車道不足，無法生成'] }
  }
  const byKey = new Map(lanes.map((l) => [l.key, l] as const))
  const ranked = longestPaths(lanes, tolM, angleDeg)
  if (!ranked.length) {
    return { spine: [], totalM: 0, blocks: [], lanes: [], refPoints: [], refStations: [], warnings: ['車道無法串接'] }
  }

  const pathA = ranked[0]!.path
  const setA = new Set(pathA)
  const pathB = ranked.find((r) => !r.path.some((k) => setA.has(k)))?.path ?? []
  if (!pathB.length) warnings.push('只找到一條主線，上下行無法區分')

  // 走向較長的當下行（參考線），另一條當上行
  const lenA = ranked[0]!.len
  const lenB = pathB.reduce((a, k) => a + byKey.get(k)!.lengthM, 0)
  const downPath = lenA >= lenB ? pathA : pathB
  const upPath = lenA >= lenB ? pathB : pathA

  const ref = resample(joinPath(downPath, byKey), 1)
  const refS = stationsOf(ref)
  const totalM = refS[refS.length - 1] ?? 0
  const spine = buildSpine(ref, refS, curvature)

  const roleOf = (key: string): LaneRole => {
    if (downPath.includes(key)) return 'down'
    if (upPath.includes(key)) return 'up'
    return byKey.get(key)!.inJunction ? 'crossover' : 'siding'
  }

  const projected: ProjectedLane[] = []
  for (const lane of lanes) {
    const pts = resample(lane.points.map((p) => ({ x: p.x, y: p.y })), 2)
    const profile: Array<[number, number]> = []
    for (const p of pts) {
      const { s, lateral } = projectOnto(p, ref, refS)
      if (!profile.length || Math.abs(s - profile[profile.length - 1]![0]) >= 1.5) {
        profile.push([Number(s.toFixed(1)), Number(lateral.toFixed(2))])
      }
    }
    if (profile.length >= 2) {
      projected.push({
        key: lane.key,
        role: roleOf(lane.key),
        mmslLaneId: lane.mmslLaneId,
        lengthM: Number(lane.lengthM.toFixed(1)),
        profile,
      })
    }
  }

  // 上行線的橫向剖面：用來給每塊決定兩線間距
  const upProfile = projected
    .filter((l) => l.role === 'up')
    .flatMap((l) => l.profile)
    .sort((a, b) => a[0] - b[0])

  const blocks: TrackBlock[] = []
  for (const seg of spine) {
    const span = seg.sTo - seg.sFrom
    /*
     * 彎道<strong>不切</strong>：整段就是一個圓角軌道。
     *
     * 照直線的長度去切彎道，會把一個轉角變成好幾塊小碎片——畫面上看起來破碎，
     * 而且轉角本來就是一個物件，切開之後每一塊都要各自對齊，接縫只會更多。
     */
    const n = seg.kind === 'arc' ? 1 : Math.max(1, Math.round(span / blockLengthM))
    const step = span / n
    for (let k = 0; k < n; k += 1) {
      const sFrom = seg.sFrom + k * step
      const sTo = sFrom + step
      const inRange = upProfile.filter((p) => p[0] >= sFrom && p[0] <= sTo).map((p) => p[1])
      const lateral = median(inRange) ?? 3.5
      const residual = inRange.length ? Math.max(...inRange.map((v) => Math.abs(v - lateral))) : 0
      const index = blocks.length
      blocks.push({
        index,
        nameDown: `D${String(index + 1).padStart(2, '0')}`,
        nameUp: `U${String(index + 1).padStart(2, '0')}`,
        sFrom: Number(sFrom.toFixed(2)),
        sTo: Number(sTo.toFixed(2)),
        lengthM: Number(step.toFixed(2)),
        lateralM: Number(lateral.toFixed(3)),
        residualM: Number(residual.toFixed(3)),
        spineKind: seg.kind,
      })
    }
  }
  if (blocks.length) blocks[blocks.length - 1]!.sTo = Number(totalM.toFixed(2))

  return {
    spine,
    totalM: Number(totalM.toFixed(2)),
    blocks,
    lanes: projected,
    refPoints: ref.filter((_, i) => i % 5 === 0).map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
    refStations: refS.filter((_, i) => i % 5 === 0).map((s) => Number(s.toFixed(1))),
    warnings,
  }
}

export function generateTracksFromXodr(xml: string, options?: TrackGenOptions): TrackGenResult {
  return generateTracks(parseLaneCenterlines(xml), options)
}

export type { LaneCenterline, LaneCenterlinePlan }
