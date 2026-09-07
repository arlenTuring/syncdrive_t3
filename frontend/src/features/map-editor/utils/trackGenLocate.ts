import {
  getTrackGenPaths,
  getTrackGenSpans,
  pointAlongPath,
  projectAlongPath,
  type PathXY,
} from './trackGenPaths'

/**
 * 車輛定位：場域座標 →（road / lane / 里程）→ 圖面位置。
 *
 * <h3>為什麼要有這一層</h3>
 * 廠商送來的只有場域座標與車頭朝向，沒有車道編號。先前的做法是拿那個座標去跟
 * <strong>每一塊</strong>軌道的中心線比距離，取最近的一塊；分岔口兩塊等距分不出來，就再
 * 加一個「偏向比較長的那條線」的補償（上限 0.75 公尺）。那是 O(設施數) 的搜尋加一個經驗值。
 *
 * <h3>改成怎麼做</h3>
 * 生成時每一塊軌道已經記下自己代表哪一段路網（road、lane、里程起訖），這裡再建兩張表：
 *
 * <ul>
 *   <li><strong>格網</strong>：場域切成方格，每格記下有哪幾塊軌道經過。座標進來先算格號，
 *       候選就從幾十塊縮到兩三塊——純算術，不是搜尋。</li>
 *   <li><strong>車道表</strong>：`road:lane` → 依里程排好的分段。哪天協議帶了車道與里程，
 *       就完全不必碰座標，直接查表加一次內插。</li>
 * </ul>
 *
 * 上下行分不出來時<strong>用車頭朝向</strong>：兩條線的走向差 180 度，朝向一比就定了。
 * 那是廠商本來就在送、而我們一直沒用的欄位——比「哪條線比較長」可靠得多。
 *
 * <h3>目前的準確度（T3、軌道寬 10 到 150 各 2218 個取樣點）</h3>
 * <ul>
 *   <li>road 與 lane 判對 <strong>99.8%</strong>；離中心線的中位數 0.005 公尺、最大 0.51。
 *       判錯的四點都是某條車道的<strong>第一個取樣點</strong>，它就落在與隔壁那條 road
 *       共用的那個點上（距離 0.0），本來就分不出屬於誰。</li>
 *   <li>里程誤差中位數 0.022 公尺、95 百分位 1.23、最大 1.96。</li>
 *   <li>十八條車道的里程覆蓋<strong>沒有洞也沒有重疊</strong>（0 → 該 road 全長）。</li>
 *   <li>沿車道每兩公尺查一次圖面位置，位移中位數 1.3–1.7、95 百分位 2.4、最大 7.9 公尺
 *       ——沒有瞬移。最大的那幾步出現在路口的分岔上，那裡本來就是把幾公尺的實際路段
 *       畫成一段長斜線，是<strong>示意圖的比例</strong>，不是跳位。</li>
 * </ul>
 *
 * <h3>接在哪</h3>
 * {@link ../vehicles/trackNetwork/scanMap} 掃圖時順手建好索引掛在 TrackNetwork 上，
 * {@link ../vehicles/trackNetwork/locate} 的 locateOnTrackNetwork 先走這裡；沒有生成資料的
 * 手工軌道才退回原本的 refField 掃描。車頭朝向由 MQTT 的 `local_pose.heading` 一路傳下來
 * （見 mapMqttIngestPipeline 與 MapAreaVehicleOverlay）。
 *
 * 朝向幫不幫得上，看車回報的位置有多準：正好落在中心線上時，最近的本來就是對的那一條，
 * 有沒有朝向都一樣（99.6%）。把取樣點往<strong>對向那條</strong>橫移，兩條就開始分不出來——
 * 橫移 1.4 公尺時有朝向 99.6%、沒有 98.7%；橫移 1.7 公尺（3.5 公尺股距的正中間）有朝向
 * 仍是 99.8%、沒有掉到 81%。
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
   *
   * 真實中心線一律照 OpenDRIVE 的 s 由小到大存；而 lane id 為正的車道在參考線左側、
   * 行車方向與 s 相反。少了這一次翻轉，上下行的走向會被當成同一個，朝向就篩不掉任何
   * 一條——實測車道判對率只有兩成。
   */
  travelRad: number
}

export type TrackGenIndex = {
  cellM: number
  /** 格號 → 這一格裡有哪幾塊（pieces 的索引） */
  grid: Map<string, number[]>
  pieces: Piece[]
}

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
        travelRad: sp.h ?? (sp.lane > 0 ? alongS + Math.PI : alongS),
      })
    }
  }

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

  return { cellM, grid, pieces }
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
   *
   * 這個數字不是拿來丟掉的。車子不一定走在軌道上——它可能偏出去、跑到對向、撞上牆，
   * 而那正是要在圖上看見的事。畫的時候照這個值往旁邊移出去（見 trackGenLatPerBox），
   * 車就落在它真正的位置，不會被壓回軌道中央。
   *
   * 順帶的好處：隔壁那條軌道的中心線差一個中心距，量到的偏移量跟著差一個中心距，
   * 乘上同一個橫向比例尺之後畫出來是同一個點——所以「挑到哪一條軌道」不再改變位置。
   */
  offsetM: number
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
 * 場域座標 → 圖面位置。
 *
 * 有車頭朝向就拿來排除走向相反的那一條——上下行在圖上只差 3.5 公尺，位置分不出來，
 * 走向差 180 度卻一目了然。沒有朝向時退回純距離。
 */
export function locateByField(
  index: TrackGenIndex,
  xM: number,
  yM: number,
  headingRad?: number,
): Located | null {
  const cx = Math.floor(xM / index.cellM)
  const cy = Math.floor(yM / index.cellM)
  const candidates = index.grid.get(cellKey(cx, cy))
  if (!candidates?.length) return null

  let best: Located | null = null
  let bestScore = Infinity
  for (const i of candidates) {
    const p = index.pieces[i]!
    // 只在這一段自己那一截上比：一塊路口元件橫跨好幾段，整條一起量會每一段都同分
    const { along, distance, side } = projectAlongPath(p.real, xM, yM, { from: p.f0, to: p.f1 })
    /*
     * 走向不合的直接放到最後。差超過 90 度就是反方向那一條，不是「比較差的候選」。
     */
    const wrongWay =
      headingRad !== undefined && angleGap(headingRad, p.travelRad) > Math.PI / 2
    const score = distance + (wrongWay ? 1e6 : 0)
    if (score < bestScore) {
      bestScore = score
      best = {
        facilityId: p.facilityId,
        road: p.road,
        lane: p.lane,
        // 里程照這一段自己佔的那一截換算：路口的元件橫跨兩條腿，用整塊的比例會差很遠
        sM: p.s0 + (p.s1 - p.s0) * spanFrac(p, along),
        along,
        local: pointAlongPath(p.local, along),
        offsetM: side,
      }
    }
  }
  return best
}
