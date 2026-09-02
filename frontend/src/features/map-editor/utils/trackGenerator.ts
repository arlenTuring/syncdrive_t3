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

/**
 * 車道的角色<strong>只從檔案讀</strong>，不從長度猜。
 *
 * 先前把最長的兩條叫「下行／上行」、其餘叫側線——那是把某一個場域的樣子寫死進
 * 演算法裡。換一份路網（三線、單線、環狀）那個假設就不成立，而且畫出來的東西
 * 會莫名其妙。OpenDRIVE 唯一告訴我們的分類是「這條車道在不在 junction 裡」。
 */
export type LaneRole = 'road' | 'junction'

/** 脊線的一段：直線或彎道 */
export type SpineSegment =
  | { kind: 'straight'; sFrom: number; sTo: number; hdgDeg: number }
  | { kind: 'arc'; sFrom: number; sTo: number; turnDeg: number; realTurnDeg: number }

/**
 * 一條連續的線：由數條首尾相接的 OpenDRIVE 車道串成。
 *
 * 每條線一視同仁，沒有「主線」這種身分。線的位置一律以「里程 ＋ 橫向偏移」表示，
 * 里程量在參考線上——參考線就是最長的那一條，這是資料決定的，不是誰比較重要。
 */
export type ProjectedLine = {
  key: string
  role: LaneRole
  lengthM: number
  /** 車道寬（公尺）。軌道畫多寬直接用它，不要另外訂一個「帶寬」 */
  widthM: number
  /** 組成這條線的 OpenDRIVE 車道 */
  laneKeys: string[]
  /** [里程, 橫向偏移] 取樣序列 */
  profile: Array<[number, number]>
}

export type TrackGenResult = {
  spine: SpineSegment[]
  totalM: number
  lines: ProjectedLine[]
  /**
   * 參考線相對<strong>脊線</strong>的橫向偏離，[里程, 偏離] 取樣。
   *
   * 脊線的直線段方位量化到 90 度，真實的參考線在那一段裡會慢慢偏開——實測 834 公尺
   * 那段偏了 −8.7 ～ +16.5 公尺。那正是原圖上「兩條線一起緩緩爬升」的那件事，
   * 是應該用斜接軌道畫出來的幾何，不是應該抹掉的誤差。
   *
   * 每段直線各自以自己的起點為錨，所以偏離從 0 開始累積；彎道段線性收回 0，
   * 交界處才不會跳。真實座標的還原不吃這個值，只有版面吃。
   */
  refDeviation: Array<[number, number]>
  /** 參考線的真實座標，供回填參照場域範圍與車輛投影 */
  refPoints: Vec2[]
  refStations: number[]
  warnings: string[]
}

export type TrackGenOptions = {
  /** 每塊目標長度（公尺）。切塊改由版面負責，這裡留著相容呼叫端 */
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
  /*
   * 方位與轉角都量化到 <strong>90 度</strong>的倍數。
   *
   * 圓角軌道是一段四分之一弧——它畫不出 45 度的彎。留著 45 度的話，那一段轉角
   * 的兩端永遠對不上相鄰的直線段（實測差 43 公尺），畫面上就是一個接不起來的
   * 缺口。簡圖本來就是刻意變形的，全部拉成直角反而更整齊。
   *
   * 量化後轉角變成 0 度的那一段不是彎道，當直線處理。
   */
  const q90 = (deg: number) => Math.round(deg / 90) * 90

  const spine: SpineSegment[] = []
  for (const r of merged) {
    const turn = hdgAt(r.sTo) - hdgAt(r.sFrom)
    if (r.kind === 'arc' && Math.abs(q90(turn)) >= 90) {
      spine.push({
        kind: 'arc',
        sFrom: r.sFrom,
        sTo: r.sTo,
        turnDeg: q90(turn),
        realTurnDeg: Number(turn.toFixed(1)),
      })
    } else {
      spine.push({
        kind: 'straight',
        sFrom: r.sFrom,
        sTo: r.sTo,
        hdgDeg: q90(hdgAt((r.sFrom + r.sTo) / 2)),
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

/**
 * 把所有車道串成互不重疊的連續線。
 *
 * 先算出「從每一條車道出發能走到的最長路徑」，照長度由大到小依序取用，取過的車道
 * 不再參與；剩下接不上任何人的就自己成一條。這樣每一條車道都會屬於某一條線，
 * 不需要「哪兩條是主線」這種外部知識。
 */
function buildChains(
  lanes: LaneCenterline[],
  tolM: number,
  angleDeg: number,
): string[][] {
  const ranked = longestPaths(lanes, tolM, angleDeg)
  const used = new Set<string>()
  const chains: string[][] = []
  for (const r of ranked) {
    if (r.path.some((k) => used.has(k))) continue
    r.path.forEach((k) => used.add(k))
    chains.push(r.path)
  }
  for (const l of lanes) {
    if (!used.has(l.key)) {
      used.add(l.key)
      chains.push([l.key])
    }
  }
  return chains
}

export function generateTracks(
  plan: LaneCenterlinePlan,
  options: TrackGenOptions = {},
): TrackGenResult {
  const tolM = options.joinToleranceM ?? 2.5
  const angleDeg = options.joinAngleDeg ?? 30
  const curvature = options.curvatureDegPerM ?? 0.35
  const warnings: string[] = []

  const lanes = plan.lanes.filter((l) => l.points.length >= 2)
  const empty = (msg: string): TrackGenResult => ({
    spine: [],
    totalM: 0,
    lines: [],
    refDeviation: [],
    refPoints: [],
    refStations: [],
    warnings: [msg],
  })
  if (lanes.length < 1) return empty('車道不足，無法生成')

  const byKey = new Map(lanes.map((l) => [l.key, l] as const))
  const chains = buildChains(lanes, tolM, angleDeg)
  if (!chains.length) return empty('車道無法串接')

  const lengthOf = (chain: string[]) =>
    chain.reduce((a, k) => a + byKey.get(k)!.lengthM, 0)
  const ordered = [...chains].sort((a, b) => lengthOf(b) - lengthOf(a))

  /*
   * 參考線＝最長的那一條。
   *
   * 里程必須量在某一條線上，這是線性參照的前提；挑最長的純粹是為了讓其他線都投影
   * 得到，不代表它有什麼特殊身分。
   */
  const ref = resample(joinPath(ordered[0]!, byKey), 1)
  const refS = stationsOf(ref)
  const totalM = refS[refS.length - 1] ?? 0
  const spine = buildSpine(ref, refS, curvature)

  /*
   * 參考線相對脊線的橫向偏離。
   *
   * 每段直線以自己的起點為錨、用量化後的方位拉一條直線，量參考線離它多遠；彎道段
   * 從前一段的末值線性收回 0。全域理想化行不通——第二個彎實際只轉 56.5 度卻被拉成
   * 90 度，整條理想路徑會偏掉 342 公尺。分段量就只有十幾公尺。
   */
  const refAt = (sq: number): Vec2 => {
    let i = 1
    while (i < refS.length - 1 && refS[i]! < sq) i += 1
    const a = refS[i - 1]!
    const b = refS[i]!
    const u = (sq - a) / Math.max(1e-6, b - a)
    return {
      x: ref[i - 1]!.x + (ref[i]!.x - ref[i - 1]!.x) * u,
      y: ref[i - 1]!.y + (ref[i]!.y - ref[i - 1]!.y) * u,
    }
  }
  const refDeviation: Array<[number, number]> = []
  let carry = 0
  for (const seg of spine) {
    if (seg.kind === 'straight') {
      const p0 = refAt(seg.sFrom)
      const dir = { x: Math.cos(seg.hdgDeg * DEG), y: -Math.sin(seg.hdgDeg * DEG) }
      const nrm = { x: -dir.y, y: dir.x }
      const n = Math.max(1, Math.round((seg.sTo - seg.sFrom) / 5))
      for (let k = 0; k <= n; k += 1) {
        const sq = seg.sFrom + ((seg.sTo - seg.sFrom) * k) / n
        const p = refAt(sq)
        const d = (p.x - p0.x) * nrm.x + (p.y - p0.y) * nrm.y
        refDeviation.push([Number(sq.toFixed(1)), Number(d.toFixed(2))])
        carry = d
      }
    } else {
      // 彎道：把前一段累積的偏離線性收回 0
      const n = 6
      for (let k = 0; k <= n; k += 1) {
        const sq = seg.sFrom + ((seg.sTo - seg.sFrom) * k) / n
        refDeviation.push([Number(sq.toFixed(1)), Number((carry * (1 - k / n)).toFixed(2))])
      }
      carry = 0
    }
  }

  const lines: ProjectedLine[] = []
  ordered.forEach((chain, index) => {
    const pts = resample(joinPath(chain, byKey), 2)
    const profile: Array<[number, number]> = []
    for (const p of pts) {
      const { s, lateral } = projectOnto(p, ref, refS)
      if (!profile.length || Math.abs(s - profile[profile.length - 1]![0]) >= 1.5) {
        profile.push([Number(s.toFixed(1)), Number(lateral.toFixed(2))])
      }
    }
    if (profile.length < 2) return
    lines.push({
      key: `L${index + 1}`,
      role: chain.some((k) => byKey.get(k)!.inJunction) ? 'junction' : 'road',
      lengthM: Number(lengthOf(chain).toFixed(1)),
      widthM: Number(
        (
          chain.reduce((a, k) => a + (byKey.get(k)!.widthM || 0), 0) /
          Math.max(1, chain.length)
        ).toFixed(3),
      ),
      laneKeys: chain,
      profile,
    })
  })
  if (lines.length < 2) warnings.push('只串出一條線，無法表達股道關係')

  return {
    spine,
    totalM: Number(totalM.toFixed(2)),
    lines,
    refDeviation,
    refPoints: ref
      .filter((_, i) => i % 5 === 0)
      .map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) })),
    refStations: refS.filter((_, i) => i % 5 === 0).map((s2) => Number(s2.toFixed(1))),
    warnings,
  }
}

export function generateTracksFromXodr(xml: string, options?: TrackGenOptions): TrackGenResult {
  return generateTracks(parseLaneCenterlines(xml), options)
}

export type { LaneCenterline, LaneCenterlinePlan }
