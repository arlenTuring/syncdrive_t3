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

/**
 * 軌道身分（判給哪一條通行分支）的判定。
 *
 * <ul>
 *   <li>confirmed／geometry：只有這一條分支貼近座標，其他分支都遠在門檻外。</li>
 *   <li>confirmed／continuity：座標附近有兩條以上分不開，上一筆確認的分支（或它唯一的
 *       相連後續）在其中。</li>
 *   <li>confirmed／route：分不開的分支裡，只有一條在這張任務的有序路徑上。</li>
 *   <li>confirmed／heading：分不開、也沒有路徑與上一筆可用，車速可信時只有一條順著車頭。</li>
 *   <li>ambiguous／geometric_tie：座標真的分不出來，其他證據也分不出來。畫面不能編造進度。</li>
 * </ul>
 * 方向矛盾<strong>不</strong>影響這個判定（另見 headingConflict）。
 */
export type BranchIdentity =
  | { status: 'confirmed'; reason: 'geometry' | 'continuity' | 'route' | 'heading'; rivals: string[] }
  | { status: 'ambiguous'; reason: 'geometric_tie'; rivals: string[] }

export type Located = {
  facilityId: string
  /**
   * 通行分支的穩定識別。一般軌道就是設施 id；交叉／分岔軌道已經拆成各分支設施
   * （母體 id + ~ + 分支代號，見 crossBranches），所以同一個交叉的斜行與直行各自獨立。
   */
  branchId: string
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
   * 候選<strong>綜合評分</strong>差（別的分支最佳評分 − 所選分支評分；診斷用，單位不是公尺）。
   * 評分含距離、方向、連續性與路線的加減分；選分支已不靠它，留著給錄製與比較。
   * 只有一條候選時是 Infinity。
   */
  scoreMargin: number
  /**
   * 幾何距離差（公尺）：最近的「對手分支」離座標的距離 − 所選分支的距離。
   * 相連的前後段在接縫處不算對手。沒有對手時是 Infinity；所選分支因為連續性或路線
   * 而不是最近的那一條時可能是負數。
   */
  distanceMarginM: number
  identity: BranchIdentity
  /** 有任務路徑時：所選分支不在路徑（目前這一段與合法後續）上。沒有路徑資訊時是 null。 */
  offRoute: boolean | null
  /** 只有 options.collectCandidates 時才有 */
  candidates?: LocateCandidateDiag[]
  /**
   * 車頭跟所選分支的行車方向幾乎相反（超過 120 度），而且車速夠、heading 可信。
   *
   * 這是<strong>方向異常</strong>的診斷，不影響軌道身分：座標已經確認在這條分支上時，
   * 判位照樣成立，畫面另外提示方向異常（資料的方向定義、車端 heading、或車真的逆向）。
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
  /**
   * 這張任務的有序路徑上，目前這一段與合法後續的分支（見 routeCorridor.buildRoutePath）。
   * 優先於 corridorFacilityIds；只在座標分不開的分支之間決定，不會把車吸回路線。
   */
  routeBranchIds?: ReadonlySet<string>
  /**
   * 每條分支<strong>接受為軌道定位</strong>的最大距離（公尺，對該段中心線的完整距離）。
   *
   * 給了之後，超過的候選在挑選前就排除——路線、上一筆與車頭只能在合理的候選之間選，不能
   * 讓超出範圍的軌道變成有效定位；全部超過就回 null。不給時照舊（只比相對遠近），呼叫端
   * 不能把 confirmed 當成「距離合理」。
   */
  maxDistanceM?: (branchId: string) => number
  /** 診斷用：回傳每個候選的距離與各項加減分（只在錄製異常時開，平常不算） */
  collectCandidates?: boolean
}

/** 單一候選的評分拆解（診斷用） */
export type LocateCandidateDiag = {
  facilityId: string
  road: string
  lane: number
  along: number
  distanceM: number
  offsetM: number
  eligible: boolean
  headingGapDeg: number | null
  headingPenalty: number
  stickyBonus: number
  nonAdjacentPenalty: number
  offRoutePenalty: number
  gatePenalty: number
  score: number
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
 * 接縫遲滯（公尺）：上一筆確認的分支只要不比最近那條遠超過這麼多，就留在原分支。
 *
 * 前後相連的兩段在接縫處都貼著座標；沒有遲滯的話，車在接縫附近每一筆都可能換一次。
 */
export const SEAM_HYSTERESIS_M = 0.3

/**
 * 分不開的分支之間，最近的一條要比其他條近這麼多（公尺）才算幾何上已經分開。
 * 分岔口剛分開的兩條分支彼此貼著，差距小於這個值時不能只憑幾何宣稱判定。
 */
export const GEOMETRY_SEPARATION_M = 0.3

/** 投影落在折線端點上（車已經走出這一段、或還沒進來） */
const END_EPS = 1e-4

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
    if (options.maxDistanceM && distance > options.maxDistanceM(p.facilityId)) continue
    cands.push({ piece: p, along, distance, side, travelRad: localTravelRad(p, along) })
    if (distance < minDistance) minDistance = distance
  }
  if (!cands.length) return null

  // 第二輪：綜合評分（診斷用）——距離加上方向、連續性、路線的加減分
  // 評分最好的一筆（只給診斷的評分差用；選分支看下面的幾何判定）
  let best: { score: number } | null = null
  const diags: LocateCandidateDiag[] | null = options.collectCandidates ? [] : null
  // 每一塊自己最好的分數：領先幅度要跟「別的塊」比，同一塊的另一段不算對手
  const bestByFacility = new Map<string, number>()
  for (const c of cands) {
    const p = c.piece
    const eligible = c.distance <= minDistance + CANDIDATE_GATE_M
    let score = c.distance
    let hp = 0
    let sticky = 0
    let nonAdj = 0
    let offRoute = 0
    let gate = 0
    if (eligible) {
      if (options.headingRad !== undefined && !p.bidirectional) {
        hp = headingPenalty(angleGap(options.headingRad, c.travelRad), headingWeight)
        score += hp
      }
      const prev = options.previousFacilityId
      if (prev) {
        if (p.facilityId === prev) {
          sticky = STICKY_BONUS_M
          score -= STICKY_BONUS_M
        } else if (!tracksAreConnected(index, prev, p.facilityId)) {
          nonAdj = NON_ADJACENT_PENALTY_M
          score += NON_ADJACENT_PENALTY_M
        }
      }
      if (options.corridorFacilityIds && !options.corridorFacilityIds.has(p.facilityId)) {
        offRoute = OFF_ROUTE_PENALTY_M
        score += OFF_ROUTE_PENALTY_M
      }
    } else {
      // 遠離最近的那一塊：不靠旁證翻盤，照純距離排在後面
      gate = CANDIDATE_GATE_M * 10
      score += gate
    }
    diags?.push({
      facilityId: p.facilityId,
      road: p.road,
      lane: p.lane,
      along: c.along,
      distanceM: c.distance,
      offsetM: c.side,
      eligible,
      headingGapDeg:
        options.headingRad !== undefined ? (angleGap(options.headingRad, c.travelRad) * 180) / Math.PI : null,
      headingPenalty: hp,
      stickyBonus: sticky,
      nonAdjacentPenalty: nonAdj,
      offRoutePenalty: offRoute,
      gatePenalty: gate,
      score,
    })

    const seen = bestByFacility.get(p.facilityId)
    if (seen === undefined || score < seen) bestByFacility.set(p.facilityId, score)

    if (!best || score < best.score) best = { score }
  }
  if (!best) return null

  // ── 軌道身分：只看幾何分不分得開，旁證只在分不開的分支之間決定 ──
  type BranchGeo = { cand: (typeof cands)[number]; clampedEnd: 0 | 1 | null }
  const geoByBranch = new Map<string, BranchGeo>()
  for (const c of cands) {
    const id = c.piece.facilityId
    const seen = geoByBranch.get(id)
    if (!seen || c.distance < seen.cand.distance) {
      const clampedEnd: 0 | 1 | null = c.along <= END_EPS ? 0 : c.along >= 1 - END_EPS ? 1 : null
      geoByBranch.set(id, { cand: c, clampedEnd })
    }
  }
  const nearest = [...geoByBranch.entries()].sort((x, y) => x[1].cand.distance - y[1].cand.distance)[0]!
  const nearestD = nearest[1].cand.distance
  const tied = [...geoByBranch.entries()].filter(([, g]) => g.cand.distance <= nearestD + CANDIDATE_GATE_M)

  /** b 是 a 在接縫上的前後段：兩者端點相接，而且其中一方的投影就停在相接的那一端 */
  const isSeamContinuation = (a: string, b: string): boolean => {
    const ga = geoByBranch.get(a)
    const gb = geoByBranch.get(b)
    if (!ga || !gb) return false
    return (index.joins.get(a) ?? []).some(
      (j) => j.to === b && (ga.clampedEnd === j.end || gb.clampedEnd === j.toEnd),
    )
  }

  const prev = options.previousFacilityId
  const prevGeo = prev ? geoByBranch.get(prev) : undefined
  let chosen = nearest[0]
  let reason: 'geometry' | 'continuity' | 'route' | 'heading' = 'geometry'
  // 接縫遲滯：上一筆的分支還貼著座標（不比最近那條遠超過遲滯量）就留著
  if (prev && prevGeo && prev !== chosen && prevGeo.cand.distance <= nearestD + SEAM_HYSTERESIS_M) {
    chosen = prev
    reason = 'continuity'
  }
  const rivalsOf = (id: string) =>
    tied.map(([bid]) => bid).filter((bid) => bid !== id && !isSeamContinuation(id, bid))

  let rivals = rivalsOf(chosen)
  let status: 'confirmed' | 'ambiguous' = 'confirmed'
  if (rivals.length > 0) {
    // 分不開：路線與連續性只負責縮小「合理的分支」，合理的分支之間仍然由幾何決定
    let supported = [chosen, ...rivals]
    let why: 'route' | 'continuity' | null = null
    const allowed = options.routeBranchIds ?? options.corridorFacilityIds
    if (allowed) {
      const onRoute = supported.filter((id) => allowed.has(id))
      if (onRoute.length > 0) {
        supported = onRoute
        why = 'route'
      }
    }
    if (prev) {
      const linked = supported.filter((id) => id === prev || tracksAreConnected(index, prev, id))
      if (linked.length > 0) {
        supported = linked
        why = why ?? 'continuity'
      }
    }
    const dist = (id: string) => geoByBranch.get(id)!.cand.distance
    supported.sort((a, b) => dist(a) - dist(b))
    let pick = supported[0]!
    if (prev && supported.includes(prev) && dist(prev) <= dist(pick) + SEAM_HYSTERESIS_M) pick = prev
    const others = supported.filter((id) => id !== pick && !isSeamContinuation(pick, id))
    const separation = others.length ? Math.min(...others.map(dist)) - dist(pick) : Infinity
    const reliableHeading =
      options.headingRad !== undefined &&
      !(options.speedMps !== undefined && options.speedMps < HEADING_RELIABLE_MPS)
    const alongHeading = reliableHeading
      ? supported.filter((id) => {
          const gg = geoByBranch.get(id)!
          return gg.cand.piece.bidirectional || angleGap(options.headingRad!, gg.cand.travelRad) < Math.PI / 2
        })
      : []
    /** 在一組候選裡挑最近的（上一筆有遲滯），看它跟其他條是否已經拉開 */
    const nearestOf = (ids: string[]) => {
      const sorted = [...ids].sort((a, b) => dist(a) - dist(b))
      let best = sorted[0]!
      if (prev && sorted.includes(prev) && dist(prev) <= dist(best) + SEAM_HYSTERESIS_M) best = prev
      const rest = sorted.filter((id) => id !== best && !isSeamContinuation(best, id))
      const sep = rest.length ? Math.min(...rest.map(dist)) - dist(best) : Infinity
      return { best, separated: rest.length === 0 || sep >= GEOMETRY_SEPARATION_M }
    }
    chosen = pick
    let decided = false
    if (others.length === 0) {
      reason = why ?? 'geometry'
      decided = true
    } else if (why && separation >= GEOMETRY_SEPARATION_M) {
      // 路線或連續性已經縮小到合理的分支，其中最近的一條已經幾何上拉開：不讓車頭翻盤
      // （同一條分支可能被逆著圖資方向走，例如進出分區的接駁）
      reason = why
      decided = true
    }
    if (!decided && alongHeading.length > 0 && alongHeading.length < supported.length) {
      // 可信的車頭排除了逆向的分支；剩下順著車頭的分支之間仍由幾何決定
      const h = nearestOf(alongHeading)
      if (h.separated) {
        chosen = h.best
        reason = 'heading'
        decided = true
      }
    }
    if (!decided && separation >= GEOMETRY_SEPARATION_M) {
      reason = why ?? 'geometry'
      decided = true
    }
    if (!decided && prev && pick === prev) {
      reason = 'continuity'
      decided = true
    }
    if (!decided) status = 'ambiguous'
    rivals = rivalsOf(chosen)
  }

  const g = geoByBranch.get(chosen)!
  const c = g.cand
  const p = c.piece
  const reliable =
    options.headingRad !== undefined &&
    !(options.speedMps !== undefined && options.speedMps < HEADING_RELIABLE_MPS)
  const headingConflict =
    reliable && !p.bidirectional && angleGap(options.headingRad!, c.travelRad) > HEADING_CONFLICT_RAD

  // 幾何距離差：最近的對手（接縫上的前後段不算）
  let rivalD = Infinity
  for (const [bid, bg] of geoByBranch) {
    if (bid === chosen || isSeamContinuation(chosen, bid)) continue
    rivalD = Math.min(rivalD, bg.cand.distance)
  }
  // 評分差：診斷用
  let runnerUp = Infinity
  for (const [id, sc] of bestByFacility) {
    if (id !== chosen) runnerUp = Math.min(runnerUp, sc)
  }
  const chosenScore = bestByFacility.get(chosen) ?? best.score
  const allowed = options.routeBranchIds ?? options.corridorFacilityIds

  return {
    facilityId: p.facilityId,
    branchId: p.facilityId,
    road: p.road,
    lane: p.lane,
    sM: p.s0 + (p.s1 - p.s0) * spanFrac(p, c.along),
    along: c.along,
    local: pointAlongPath(p.local, c.along),
    offsetM: c.side,
    distanceM: c.distance,
    scoreMargin: Number.isFinite(runnerUp) ? runnerUp - chosenScore : Infinity,
    distanceMarginM: Number.isFinite(rivalD) ? rivalD - c.distance : Infinity,
    identity:
      status === 'confirmed'
        ? { status, reason, rivals }
        : { status, reason: 'geometric_tie', rivals },
    offRoute: allowed ? !allowed.has(chosen) : null,
    headingConflict,
    travelRad: c.travelRad,
    ...(diags ? { candidates: diags } : {}),
  }
}
