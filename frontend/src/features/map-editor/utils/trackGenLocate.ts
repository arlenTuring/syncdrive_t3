import {
  getTrackGenPaths,
  getTrackGenSpans,
  pointAlongPath,
  projectAlongPath,
  tangentAlongPath,
  type PathXY,
} from './trackGenPaths'

/**
 * 車輛定位：場域座標 → 圖面位置。
 *
 * 座標算出格號拿到候選，投影到每一塊的真實中心線，取最近的一塊；road / lane / 里程
 * 是順帶回報的，不參與決定位置。偏移量帶正負號，畫的時候照它往旁邊移出去。
 */

export type LocateFacility = {
  id: string
  parameters?: Record<string, unknown>
}

type Piece = {
  facilityId: string
  road: string
  lane: number
  s0: number
  s1: number
  /** 這一段對應到 real/local 路徑的哪一截 */
  f0: number
  f1: number
  real: PathXY
  local: PathXY
  /**
   * 這條車道的<strong>行車方向</strong>（弳度），用來跟車頭朝向比對。
   */
  travelRad: number
  /**
   * 這條車道行車方向與折線記錄順序相反。
   *
   * 折線的方向是圖資生成時決定的，跟車往哪邊開沒有關係；反向車道的局部切線要轉
   * 半圈才是「車該朝的那一邊」。
   */
  againstPath: boolean
  /**
   * 同一塊元件上有兩條車道走在<strong>同一條折線</strong>上（例如 D35/U35 這種合併的站體）：
   * 它兩個方向都能開，車頭朝哪邊都不該扣分。
   */
  bidirectional: boolean
}

/** 這一塊的哪一端接到另一塊的哪一端：0 是折線起點、1 是終點 */
export type TrackJoin = { to: string; end: 0 | 1; toEnd: 0 | 1 }

export type TrackGenIndex = {
  cellM: number
  /** 格號 → 這一格裡有哪幾塊（pieces 的索引） */
  grid: Map<string, number[]>
  pieces: Piece[]
  /**
   * 哪一塊接著哪一塊（端點對端點）。
   *
   * 換塊判定與沿路徑動畫都靠它：車在路網上只能從一塊走到<strong>相連的</strong>下一塊，
   * 平行的另一條車道雖然離得近，卻不是「下一塊」。
   */
  joins: Map<string, TrackJoin[]>
  /** 每一塊折線的實長（公尺），沿路徑動畫依長度分配時間 */
  lengthM: Map<string, number>
}

/**
 * 兩塊的端點靠多近才算「接在一起」（公尺）。
 *
 * 同一條車道上前後兩塊的端點幾乎重合；上下行兩條車道的端點相差約 3.5 公尺。門檻
 * 取在兩者之間偏前，才不會把對向車道的端點也連進來。
 */
export const JOIN_TOLERANCE_M = 1.5

const cellKey = (cx: number, cy: number) => `${cx}|${cy}`

/**
 * 格子多大。
 *
 * 太大則每格候選變多、白算；太小則同一塊要登記進很多格。取分段長度的中位數，
 * 那是這份圖自己的尺度——換一份路網或換一個「一塊代表幾公尺」都會跟著調整。
 */
function cellSizeFor(pieces: Piece[]): number {
  const lens = pieces
    .map((p) => Math.abs(p.s1 - p.s0))
    .filter((v) => v > 0.1)
    .sort((a, b) => a - b)
  if (!lens.length) return 20
  return Math.max(5, Math.min(100, lens[Math.floor(lens.length / 2)]!))
}

/** 同一塊元件上，同一段折線同時掛了正負兩條車道：兩個方向都能開 */
function markBidirectional(pieces: Piece[]): void {
  const seen = new Map<string, { pos: Piece[]; neg: Piece[] }>()
  for (const p of pieces) {
    const key = `${p.facilityId}|${p.f0}|${p.f1}`
    const entry = seen.get(key) ?? { pos: [], neg: [] }
    ;(p.lane > 0 ? entry.pos : entry.neg).push(p)
    seen.set(key, entry)
  }
  for (const { pos, neg } of seen.values()) {
    if (pos.length && neg.length) for (const p of [...pos, ...neg]) p.bidirectional = true
  }
}

/**
 * 沒有記行車方向時，由車道推：負車道往里程增加的方向開、正車道往里程減少的方向開。
 * 中心線的記錄順序不一定是里程增加的方向（重拉的 T03、D20 就是里程往路徑遞減），所以要看
 * 這一段的里程沿路徑是增是減，不能一律當成「負車道順著路徑、正車道逆著路徑」——
 * 那樣 D 車道的 D20 會被判成往北、隔壁 U 車道的 T03 反而判成往南，往南開的車就被吸過去。
 */
function laneTravelRad(sp: { lane: number; s0: number; s1: number }, alongS: number): number {
  const sIncreasesAlongPath = sp.s1 >= sp.s0
  const alongPath = (sp.lane < 0) === sIncreasesAlongPath
  return alongPath ? alongS : alongS + Math.PI
}

export function buildTrackGenIndex(facilities: LocateFacility[]): TrackGenIndex {
  const pieces: Piece[] = []
  for (const f of facilities) {
    const paths = getTrackGenPaths(f.parameters)
    if (!paths) continue
    const spans = getTrackGenSpans(f.parameters)
    if (!spans.length) continue
    const a = paths.real[0]!
    const b = paths.real[paths.real.length - 1]!
    const alongS = Math.atan2(b[1] - a[1], b[0] - a[0])
    for (const sp of spans) {
      pieces.push({
        facilityId: f.id,
        road: sp.road,
        lane: sp.lane,
        s0: sp.s0,
        s1: sp.s1,
        f0: sp.f0,
        f1: sp.f1,
        real: paths.real,
        local: paths.local,
        // 逐段記的方向優先；舊資料沒有時退回整塊的頭尾連線
        travelRad: sp.h ?? laneTravelRad(sp, alongS),
        againstPath: angleGap(sp.h ?? laneTravelRad(sp, alongS), alongS) > Math.PI / 2,
        bidirectional: false,
      })
    }
  }

  markBidirectional(pieces)

  const cellM = cellSizeFor(pieces)
  const grid = new Map<string, number[]>()
  pieces.forEach((p, i) => {
    let xMin = Infinity
    let yMin = Infinity
    let xMax = -Infinity
    let yMax = -Infinity
    for (const [x, y] of p.real) {
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
    if (!Number.isFinite(xMin)) return
    // 帶子有寬度，格子往外放一格才不會在邊界上漏掉
    for (let cx = Math.floor(xMin / cellM) - 1; cx <= Math.floor(xMax / cellM) + 1; cx += 1) {
      for (let cy = Math.floor(yMin / cellM) - 1; cy <= Math.floor(yMax / cellM) + 1; cy += 1) {
        const k = cellKey(cx, cy)
        const arr = grid.get(k)
        if (arr) arr.push(i)
        else grid.set(k, [i])
      }
    }
  })

  const { joins, lengthM } = buildJoins(facilities)
  return { cellM, grid, pieces, joins, lengthM }
}

function pathLength(path: PathXY): number {
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
  }
  return total
}

/** 端點對端點找相連的塊；用格子雜湊，不必兩兩比對 */
function buildJoins(facilities: LocateFacility[]): {
  joins: Map<string, TrackJoin[]>
  lengthM: Map<string, number>
} {
  const joins = new Map<string, TrackJoin[]>()
  const lengthM = new Map<string, number>()
  type End = { id: string; end: 0 | 1; x: number; y: number }
  const ends: End[] = []
  for (const f of facilities) {
    const paths = getTrackGenPaths(f.parameters)
    if (!paths) continue
    lengthM.set(f.id, pathLength(paths.real))
    const a = paths.real[0]!
    const b = paths.real[paths.real.length - 1]!
    ends.push({ id: f.id, end: 0, x: a[0], y: a[1] })
    ends.push({ id: f.id, end: 1, x: b[0], y: b[1] })
  }
  const cell = Math.max(JOIN_TOLERANCE_M * 2, 3)
  const bucket = new Map<string, End[]>()
  const key = (cx: number, cy: number) => `${cx}|${cy}`
  for (const e of ends) {
    const k = key(Math.floor(e.x / cell), Math.floor(e.y / cell))
    const arr = bucket.get(k)
    if (arr) arr.push(e)
    else bucket.set(k, [e])
  }
  for (const e of ends) {
    const cx = Math.floor(e.x / cell)
    const cy = Math.floor(e.y / cell)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const o of bucket.get(key(cx + dx, cy + dy)) ?? []) {
          if (o.id === e.id) continue
          if (Math.hypot(o.x - e.x, o.y - e.y) > JOIN_TOLERANCE_M) continue
          const list = joins.get(e.id) ?? []
          list.push({ to: o.id, end: e.end, toEnd: o.end })
          joins.set(e.id, list)
        }
      }
    }
  }
  return { joins, lengthM }
}

/** 兩塊是不是同一塊或端點相連 */
export function tracksAreConnected(index: TrackGenIndex, a: string, b: string): boolean {
  if (a === b) return true
  return (index.joins.get(a) ?? []).some((j) => j.to === b)
}

export type Located = {
  facilityId: string
  road: string
  lane: number
  /** 沿該 road 參考線的里程（公尺） */
  sM: number
  /** 在這一塊上走了幾成，圖面位置照這個比例取 */
  along: number
  /** 圖面中心線上的位置（未旋轉外框的 0–1 比例） */
  local: { x: number; y: number }
  /**
   * 離該段真實中心線多遠（公尺），<strong>帶正負號</strong>：正號在行進方向的左手邊。
   */
  offsetM: number
  /** 離這一段中心線的距離（公尺，無正負號） */
  distanceM: number
  /**
   * 這一筆判給這一塊有多少把握（0–1）。
   *
   * 由兩件事組成：離中心線夠不夠近、以及第二名比第一名差多少。第二名幾乎一樣好的
   * 時候（分岔口、上下行只差三公尺）答案不可靠，畫面上要能看出「這是猜的」。
   */
  confidence: number
  /** 第二名（別的塊）比第一名的分數多多少；只有一塊候選時是 Infinity */
  margin: number
  /**
   * 車頭跟所選那一塊的行車方向幾乎相反（超過 120 度），而且車速夠、heading 可信。
   *
   * 位置壓在中心線上就不會因此換塊，所以這是<strong>診斷</strong>：資料的方向定義、
   * 車端的 heading、或車真的逆向，三者之一有問題，把握度會跟著降低。
   */
  headingConflict: boolean
  /**
   * 這個位置<strong>局部</strong>的行車方向（弧度，場域座標）。
   *
   * 不是整段固定的 h：彎道上切線一直在轉，拿固定值去比車頭，轉彎中的車會被說成
   * 「走錯方向」。
   */
  travelRad: number
}

/** 這一段自己那一截裡走了幾成——路口的元件橫跨兩條腿，里程要照各自那一截換算 */
/**
 * 兩個角度差多少（0–π）。
 *
 * JavaScript 的 % 會保留被除數的正負號，所以先取模再位移那種寫法在負角度上會算出負值，
 * 判斷「差超過 90 度」就整個失效——實測反方向那條車道的角差被算成 −3.1，比門檻小，
 * 於是完全沒被篩掉。先歸一到 0–2π 再折回來才對。
 */
function spanFrac(p: { f0: number; f1: number }, along: number): number {
  const w = p.f1 - p.f0
  if (!(w > 1e-6)) return 0
  return Math.max(0, Math.min(1, (along - p.f0) / w))
}

function angleGap(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d < 0) d += 2 * Math.PI
  return d > Math.PI ? 2 * Math.PI - d : d
}

/**
 * 定位時可以帶的線索。
 *
 * 位置分不出上下行的時候（兩條車道只差三公尺多），靠的是這些旁證。每一項都只是
 * <strong>加減分</strong>，沒有一項可以把候選直接淘汰——真正該由位置決定的事，不能
 * 被旁證推翻。
 */
export type LocateOptions = {
  /** 車頭朝向（弧度，東為 0、逆時針為正） */
  headingRad?: number
  /** 車速（公尺／秒）。停著時 heading 不可信，方向的權重跟著降低 */
  speedMps?: number
  /** 上一筆判給這台車的那一塊；有的話偏向留在原地或走到相連的下一塊 */
  previousFacilityId?: string
  /**
   * 訂單路線的走廊：這台車該在的那幾塊軌道（見 routeCorridor）。
   * 有的話，走廊外的候選多扣 OFF_ROUTE_PENALTY_M；只在位置分不出來的候選之間決定。
   */
  corridorFacilityIds?: ReadonlySet<string>
}

/**
 * 完全反向時加的分數（公尺當量）。
 *
 * 原本是 1,000,000——只要方向差超過 90 度就等於淘汰。問題有兩個：彎道上固定的
 * 行車方向本來就會跟車頭差很多，正確的那塊被排到最後，選中一塊更遠的；而且一旦
 * 淘汰，剩下的錯誤候選連「離中心線好幾公尺」都不會被質疑。
 *
 * 改成漸進：差 90 度扣一半、差 180 度扣滿，而且這個滿分只有 6 公尺——比上下行的
 * 間距（3.5 公尺）大，所以反向車道贏不了同距離的順向車道；但順向車道若已經遠到
 * 6 公尺外，就該讓反向那條贏，那代表車根本不在順向車道上。
 */
export const HEADING_PENALTY_M = 6

/** 已經有走廊時，車頭朝向的權重只剩這麼多 */
const CORRIDOR_HEADING_FACTOR = 0.25

/** 車速低於這個值，heading 只是上一次的殘留，不是現在的行進方向 */
export const HEADING_RELIABLE_MPS = 0.5
/**
 * 停著時完全不用 heading：那是上一趟殘留的方向，不是現在的行進方向。
 * （原本留 25% 權重，殘留的 heading 在兩條車道中間還是能把車推到反向那條。）
 */
const SLOW_HEADING_WEIGHT = 0

/**
 * 方向與上一筆只能在「位置分不出來」的候選之間做決定。
 *
 * 比最近的那一塊遠超過這個距離的候選，不參與方向／連續性的比較。位置說車就壓在
 * 某條中心線上（差 0 公尺），方向再矛盾也不能把它判給旁邊 3.5 公尺外的另一條——
 * 那是資料的方向定義不一致或車頭讀值的問題，該由診斷（headingConflict）指出來，
 * 而不是用猜的換一條軌道。
 */
export const CANDIDATE_GATE_M = 1.2

/** 車頭跟行車方向差超過這個角度就算「幾乎相反」 */
const HEADING_CONFLICT_RAD = (120 * Math.PI) / 180
const CONFLICT_CONFIDENCE_FACTOR = 0.6

/**
 * 不在訂單路線的走廊上：多算這麼多。
 *
 * 位置由場域座標決定；只有座標分不出來（兩塊同樣近，例如 D20 與 T03 的中心線交叉處）時，
 * 才看這條訂單大致會經過哪些軌道。走廊只是「差不多該經過的軌道」，所以不會把明顯貼著另一塊的
 * 車拉走（仍受 CANDIDATE_GATE_M 限制），但在分不出來時它比車頭朝向可靠——朝向資料一旦不對，
 * 車就被吸到反向車道。
 */
export const OFF_ROUTE_PENALTY_M = 6

/** 還在上一塊：少算這麼多，換塊要有足夠的證據 */
export const STICKY_BONUS_M = 0.8

/** 跳到跟上一塊不相連的另一塊：多算這麼多。相連的下一塊不罰。 */
export const NON_ADJACENT_PENALTY_M = 1.5

/**
 * 這個位置局部的行車方向（弧度）。
 *
 * 取折線在投影點的切線，車道跟折線順序相反就轉半圈。
 */
function localTravelRad(piece: Piece, along: number): number {
  const t = tangentAlongPath(piece.real, along)
  const rad = Math.atan2(t.y, t.x)
  return piece.againstPath ? rad + Math.PI : rad
}

function headingPenalty(gap: number, weight: number): number {
  // sin²(gap/2)：0 度 → 0、90 度 → 0.5、180 度 → 1
  const s = Math.sin(gap / 2)
  return HEADING_PENALTY_M * weight * s * s
}

/**
 * 距離與領先幅度合成 0–1 的把握。
 *
 * 相乘不相加：離中心線很遠的時候，就算旁邊沒有對手，「判給這一塊」也只是因為它是
 * 唯一的選項，不是因為它對；相加會讓這種情況還有一半的把握。壓在中心線上但第二名一樣
 * 近（上下行中間、分岔口），也只剩兩成。
 */
function confidenceOf(distanceM: number, margin: number): number {
  const near = 1 - Math.min(1, distanceM / 3.35)
  const clear = Number.isFinite(margin) ? Math.min(1, margin / 2) : 1
  return Math.max(0, Math.min(1, near * (0.2 + 0.8 * clear)))
}

/**
 * 場域座標 → 圖面位置。
 *
 * 位置是主證據；車頭朝向、車速、上一筆的位置都只是<strong>加減分</strong>。
 * 沒有任何旁證時退回純距離。
 */
export function locateByField(
  index: TrackGenIndex,
  xM: number,
  yM: number,
  optionsOrHeading?: LocateOptions | number,
): Located | null {
  const options: LocateOptions =
    typeof optionsOrHeading === 'number' ? { headingRad: optionsOrHeading } : (optionsOrHeading ?? {})
  const cx = Math.floor(xM / index.cellM)
  const cy = Math.floor(yM / index.cellM)
  const candidates = index.grid.get(cellKey(cx, cy))
  if (!candidates?.length) return null

  // 有走廊時，車頭朝向退成最後的旁證（只用來分開走廊內同樣近的兩塊）
  const headingWeight =
    (options.speedMps !== undefined && options.speedMps < HEADING_RELIABLE_MPS
      ? SLOW_HEADING_WEIGHT
      : 1) * (options.corridorFacilityIds ? CORRIDOR_HEADING_FACTOR : 1)

  // 第一輪：每一段各自投影，不含任何旁證
  type Cand = {
    piece: Piece
    along: number
    distance: number
    side: number
    travelRad: number
  }
  const cands: Cand[] = []
  let minDistance = Infinity
  for (const i of candidates) {
    const p = index.pieces[i]!
    // 只在這一段自己那一截上比：一塊路口元件橫跨好幾段，整條一起量會每一段都同分
    const { along, distance, side } = projectAlongPath(p.real, xM, yM, { from: p.f0, to: p.f1 })
    cands.push({ piece: p, along, distance, side, travelRad: localTravelRad(p, along) })
    if (distance < minDistance) minDistance = distance
  }

  // 第二輪：方向與連續性只在「位置分不出來」的候選之間決定
  let best: (Located & { score: number }) | null = null
  // 每一塊自己最好的分數：領先幅度要跟「別的塊」比，同一塊的另一段不算對手
  const bestByFacility = new Map<string, number>()
  for (const c of cands) {
    const p = c.piece
    const eligible = c.distance <= minDistance + CANDIDATE_GATE_M
    let score = c.distance
    if (eligible) {
      if (options.headingRad !== undefined && !p.bidirectional) {
        score += headingPenalty(angleGap(options.headingRad, c.travelRad), headingWeight)
      }
      const prev = options.previousFacilityId
      if (prev) {
        if (p.facilityId === prev) score -= STICKY_BONUS_M
        else if (!tracksAreConnected(index, prev, p.facilityId)) score += NON_ADJACENT_PENALTY_M
      }
      if (options.corridorFacilityIds && !options.corridorFacilityIds.has(p.facilityId)) {
        score += OFF_ROUTE_PENALTY_M
      }
    } else {
      // 遠離最近的那一塊：不靠旁證翻盤，照純距離排在後面
      score += CANDIDATE_GATE_M * 10
    }

    const seen = bestByFacility.get(p.facilityId)
    if (seen === undefined || score < seen) bestByFacility.set(p.facilityId, score)

    if (!best || score < best.score) {
      best = {
        facilityId: p.facilityId,
        road: p.road,
        lane: p.lane,
        // 里程照這一段自己佔的那一截換算：路口的元件橫跨兩條腿，用整塊的比例會差很遠
        sM: p.s0 + (p.s1 - p.s0) * spanFrac(p, c.along),
        along: c.along,
        local: pointAlongPath(p.local, c.along),
        offsetM: c.side,
        distanceM: c.distance,
        confidence: 0,
        margin: Infinity,
        headingConflict:
          options.headingRad !== undefined &&
          headingWeight > 0 &&
          !p.bidirectional &&
          angleGap(options.headingRad, c.travelRad) > HEADING_CONFLICT_RAD,
        travelRad: c.travelRad,
        score,
      }
    }
  }
  if (!best) return null
  let runnerUp = Infinity
  for (const [id, sc] of bestByFacility) {
    if (id !== best.facilityId) runnerUp = Math.min(runnerUp, sc)
  }
  const margin = Number.isFinite(runnerUp) ? runnerUp - best.score : Infinity
  const { score: _score, ...located } = best
  const confidence = confidenceOf(best.distanceM, margin) * (best.headingConflict ? CONFLICT_CONFIDENCE_FACTOR : 1)
  return { ...located, margin, confidence }
}
