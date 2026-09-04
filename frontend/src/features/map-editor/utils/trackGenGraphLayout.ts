import {
  blocksInSpan,
  fitCornerAt,
  fitSwitchAt,
  fitTaperAt,
  LANE_W_M,
  type LayoutShape,
  type TrackGenLayout,
} from './trackGenLayout'
import type { TrackGenBlockSize } from './trackGenFacility'
import type { GraphEdge, GraphNode, TrackGraph } from './trackGenGraph'

/**
 * 圖 → 版面形狀。
 *
 * <h3>與舊做法的差別</h3>
 * 舊做法沿著一條脊線走，位置是<strong>累加</strong>出來的，所以環走不回起點、岔出去
 * 的線只能表示成橫向偏移暴增。這裡位置是<strong>擺</strong>出來的：節點各有座標，邊
 * 連在節點之間。環自然閉合，岔出就是節點上多一條邊。
 *
 * <h3>怎麼擺</h3>
 * 真實座標乘上兩軸各自的比例尺，再逼近幾次讓外框剛好鋪滿元件的框（與舊版同一招）。
 * 每條邊照它的車道數畫成幾條平行帶，帶距一股；邊在節點處各讓出一個轉角半徑，轉角
 * 由圓角軌道補上，兩者的弧同心。
 */

type Vec = { x: number; y: number }

function edgeEnds(e: GraphEdge, byId: Map<string, GraphNode>) {
  const a = byId.get(e.from)
  const b = byId.get(e.to)
  return a && b ? { a, b } : null
}

function layoutOnce(
  graph: TrackGraph,
  block: TrackGenBlockSize,
  sx: number,
  sy: number,
  levelPx: number,
): TrackGenLayout {
  const bandW = block.trackWidthPx
  /*
   * 轉角就是<strong>直角</strong>，只是把尖角磨掉。
   *
   * 圓角軌道不是一段路，車子不會在那裡待多久；它存在的意義只是讓兩段直線接得順。
   * 半徑給大了，一個轉角就吃掉圖上一大截，看起來像整段路都在轉彎。
   *
   * 所以壓到極限：最<strong>內</strong>側那條帶子的內緣半徑收到零——它就是一個四分之
   * 一圓盤，外觀上等於直角。外側的帶子跟著同心外推，內弧自然配合對手那條，不然兩條
   * 弧不同心，轉彎處就會一邊寬一邊窄。
   */
  const maxLanes = Math.max(1, ...graph.edges.map((e) => e.lanes.length))
  const cornerR = (levelPx * (maxLanes - 1) + bandW) / 2

  const realX0 = Math.min(...graph.nodes.map((n) => n.x))
  const realY1 = Math.max(...graph.nodes.map((n) => n.y))
  // 真實座標 y 向上、版面 y 向下
  const P = (n: GraphNode): Vec => ({ x: (n.x - realX0) * sx, y: (realY1 - n.y) * sy })

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const incident = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    for (const id of [e.from, e.to]) {
      const arr = incident.get(id) ?? []
      arr.push(e)
      incident.set(id, arr)
    }
  }

  const shapes: LayoutShape[] = []
  const pts: Vec[] = []
  const note = (p: Vec) => pts.push(p)

  /*
   * 同一對節點之間的平行邊要<strong>疊起來排</strong>，不能各自置中。
   *
   * 上下行常常是兩條各一條車道的 road，端點完全相同。各自置中的話兩條都落在偏移
   * 0，畫出來完全重疊，看起來只有一條——實測 T3 的 road 1 與 3 就是這樣。把同一對
   * 節點之間的邊當成一束，車道依序排開，才會是兩條並排的軌道。
   */
  /*
   * 橫向偏移一律用<strong>世界座標的軸</strong>，不用邊自己的左法線。
   *
   * 沿著邊的左法線放，方向會跟著行車方向翻面：同一條路的上行往上排、下行往下排，
   * 兩條反向的平行邊疊出來順序相反；岔出去的那一束也會因為那條邊剛好朝西就跑到
   * 主線上面去——實測 4#0 的真實位置在主線下方 11.6 公尺，畫出來卻在上面。
   *
   * 改成：橫的邊一律沿版面 y、縱的邊一律沿版面 x，正負由<strong>真實座標</strong>決定。
   */
  const perpAxis = (e: GraphEdge): Vec => (e.orient === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 })
  /** 這條邊在版面上的垂直位置（越大越下／越右），用真實座標推 */
  const perpOf = (e: GraphEdge): number => {
    const pts = e.points
    if (!pts.length) return 0
    const mx = pts.reduce((t, p) => t + p.x, 0) / pts.length
    const my = pts.reduce((t, p) => t + p.y, 0) / pts.length
    // 真實 y 向上、版面 y 向下
    return e.orient === 'h' ? -my : mx
  }
  /**
   * 車道序號往哪一邊排。
   *
   * lane id 越大越靠參考線左側；左側在版面上是上還是下，看這條路往哪走。往東走時
   * 左側是上（版面 y 較小），所以序號要往負的方向排。
   */
  const laneSign = (e: GraphEdge): number => {
    const pts = e.points
    if (pts.length < 2) return 1
    const dx = pts[pts.length - 1]!.x - pts[0]!.x
    const dy = pts[pts.length - 1]!.y - pts[0]!.y
    const s = e.orient === 'h' ? -Math.sign(dx) : -Math.sign(dy)
    return s === 0 ? 1 : s
  }

  const bundleKey = (e: GraphEdge) => [e.from, e.to].sort().join('|')
  const bundles = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    const arr = bundles.get(bundleKey(e)) ?? []
    arr.push(e)
    bundles.set(bundleKey(e), arr)
  }
  /** 每條邊第一條車道在束裡的序號 */
  const baseIndex = new Map<string, number>()
  const bundleCount = new Map<string, number>()
  for (const [key, list] of bundles) {
    // 束裡的邊照真實位置排，上下行才不會左右顛倒
    const ordered = [...list].sort((a, b) => perpOf(a) - perpOf(b))
    let k = 0
    for (const e of ordered) {
      baseIndex.set(e.id, k)
      k += e.lanes.length
    }
    bundleCount.set(key, k)
  }

  /*
   * 岔出去的那一束要讓開。
   *
   * 一個節點上有兩束<strong>往同一個方向</strong>走時，它們的車道會落在同一排，畫
   * 出來互相重疊。留長的那一束在原位，短的往外挪一整束的寬度，中間用分岔軌道接起
   * 來——這正是「主線繼續、同時分出一條」。
   */
  /** 從某個節點出發，沿這條邊走 d 公尺之後的真實座標 */
  const walkFrom = (e: GraphEdge, nodeId: string, d: number): Vec | null => {
    const pts = e.from === nodeId ? e.points : [...e.points].reverse()
    if (pts.length < 2) return null
    let acc = 0
    for (let i = 1; i < pts.length; i += 1) {
      const seg = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
      if (acc + seg >= d) {
        const t = seg > 1e-6 ? (d - acc) / seg : 1
        return {
          x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t,
          y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t,
        }
      }
      acc += seg
    }
    return pts[pts.length - 1]!
  }

  /**
   * 岔出去的那一束該往哪一邊讓。
   *
   * 先前拿兩條邊<strong>整條的平均位置</strong>比大小。側線很短、主線很長時，主線的
   * 平均會落在遠處某個彎的中間，跟「在這個路口誰在上面」完全無關——實測右上那條側線
   * 真實位置在主線上方，卻被畫到下方去。
   *
   * 改成從共用的那個節點出發，兩條邊各走<strong>同樣的里程</strong>，比那一點的位置。
   * 這才是分岔實際張開的方向。
   */
  const branchSide = (branch: GraphEdge, main: GraphEdge, nodeId: string): number => {
    const fallback = () => (perpOf(branch) >= perpOf(main) ? 1 : -1)
    const probe = Math.min(150, Math.max(LANE_W_M, Math.min(branch.lengthM, main.lengthM) * 0.5))
    const pb = walkFrom(branch, nodeId, probe)
    const pm = walkFrom(main, nodeId, probe)
    if (!pb || !pm) return fallback()
    // 真實 y 向上、版面 y 向下；縱向的邊改比真實 x
    const d = main.orient === 'h' ? -(pb.y - pm.y) : pb.x - pm.x
    if (Math.abs(d) < 1e-3) return fallback()
    return d > 0 ? 1 : -1
  }

  const shift = new Map<string, number>()
  /*
   * 分岔軌道自己就是一段路，兩側的直軌要讓開它。
   *
   * 不讓的話同一段被畫兩次：分岔軌道從節點鋪出去，主線與岔線的方塊也從節點鋪出去，
   * 疊在一起（實測一組疊掉 13462、四組主線各 15332 平方像素）。鍵是「哪條邊、在哪個
   * 節點」，因為同一條邊兩端可能讓不一樣多。
   */
  const switchTrim = new Map<string, number>()
  const dirKey = (e: GraphEdge, nodeId: string) => {
    const other = byId.get(e.from === nodeId ? e.to : e.from)
    const self = byId.get(nodeId)
    if (!other || !self) return '?'
    const a = P(self)
    const b = P(other)
    return `${Math.sign(Math.round(b.x - a.x))},${Math.sign(Math.round(b.y - a.y))}`
  }
  for (const node of graph.nodes) {
    const groups = new Map<string, GraphEdge[]>()
    for (const e of incident.get(node.id) ?? []) {
      const key = dirKey(e, node.id)
      const arr = groups.get(key) ?? []
      if (!arr.some((q) => bundleKey(q) === bundleKey(e))) arr.push(e)
      groups.set(key, arr)
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const sorted = [...list].sort((a, b) => b.lengthM - a.lengthM)
      const main = sorted[0]!
      let away = 0
      for (let i = 1; i < sorted.length; i += 1) {
        const branch = sorted[i]!
        const key = bundleKey(branch)
        away += (bundleCount.get(bundleKey(sorted[i - 1]!)) ?? 1) * levelPx
        // 往真實世界上它所在的那一側讓開，不是固定往下
        const side = branchSide(branch, main, node.id)
        for (const e of bundles.get(key) ?? []) {
          if (Math.abs(shift.get(e.id) ?? 0) < away) shift.set(e.id, away * side)
        }
        /*
         * 分岔軌道佔掉的長度。
         *
         * 想要的是 1:3 的坡，但它<strong>不能比岔出去的那條路本身還長</strong>。road 4
         * 只有 59 公尺（版面上 210 像素），照 1:3 算出來是 360 像素——分岔一路畫到那條
         * 路的另一頭外面去，那條路自己的方塊反而被壓在分岔底下，看起來就是一段浮在
         * 上面、沒接到任何東西的軌道。上限取兩邊長度的一半——邊自己讓出去時也是夾在
         * 半條長度以內，兩邊用同一個上限才不會一邊讓 104、另一邊畫 126 而疊出來。
         */
        const spanOf = (x: GraphEdge) => {
          const a = byId.get(x.from)
          const b = byId.get(x.to)
          if (!a || !b) return Infinity
          const p = P(a)
          const q = P(b)
          return Math.hypot(q.x - p.x, q.y - p.y)
        }
        const runPx = Math.max(
          1,
          Math.min(
            Math.max(cornerR, away * 3),
            spanOf(branch) * 0.5 - 1,
            spanOf(main) * 0.5 - 1,
          ),
        )
        for (const e of [...(bundles.get(key) ?? []), ...(bundles.get(bundleKey(main)) ?? [])]) {
          const tk = `${e.id}|${node.id}`
          if ((switchTrim.get(tk) ?? 0) < runPx) switchTrim.set(tk, runPx)
        }
      }
    }
  }

  /** 這條邊每一條車道的橫向偏移（版面像素）：束內依序排開，再加上讓開的量 */
  const offsetsOf = (e: GraphEdge) => {
    const total = bundleCount.get(bundleKey(e)) ?? e.lanes.length
    const base = baseIndex.get(e.id) ?? 0
    const away = shift.get(e.id) ?? 0
    const sign = laneSign(e)
    return e.lanes.map((_, k) => ((base + k - (total - 1) / 2) * levelPx) * sign + away)
  }

  /*
   * 兩條軌道<strong>拉開</strong>的那一段要畫出來。
   *
   * 場域在幾個地方把上下行拉開，中間那塊空地就是月台的位置——車站之後要插在那裡。
   * road 的參考線看不出這件事（它一路都在兩線正中間），要看車道自己的中心線：實測
   * T3 只有兩處拉開，都在右端的開口，1#0+3#0 那一束從 8.0 公尺收到 5.0，7#0 從 7.9
   * 收到 3.5；其餘每一束整條都是 3.5 公尺。
   *
   * 判準因此是相對的：比這份路網<strong>自己</strong>的常態線間距寬半股以上。常態值
   * 由檔案統計出來，不寫死，換一份 .xodr 也適用。
   */
  const laneAt = (pts: Array<{ x: number; y: number }>, f: number): Vec | null => {
    if (pts.length < 2) return null
    const u = Math.max(0, Math.min(1, f)) * (pts.length - 1)
    const i = Math.min(pts.length - 2, Math.floor(u))
    const t = u - i
    return {
      x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t,
      y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t,
    }
  }
  /** 這一束在這個位置最遠的兩條車道相距多少（公尺） */
  const gapAt = (e: GraphEdge, f: number): number => {
    const list = bundles.get(bundleKey(e)) ?? [e]
    const ps: Vec[] = []
    for (const other of list) {
      // 同一束裡的邊可能反向存，對齊之後才是同一個位置
      const g = other.from === e.from ? f : 1 - f
      for (const lane of other.lanes) {
        const p = laneAt(lane.points, g)
        if (p) ps.push(p)
      }
    }
    let mx = 0
    for (let i = 0; i < ps.length; i += 1) {
      for (let j = i + 1; j < ps.length; j += 1) {
        mx = Math.max(mx, Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.y - ps[j]!.y))
      }
    }
    return mx
  }
  /** 這一束總共幾條車道 */
  const bundleLanes = (e: GraphEdge) =>
    (bundles.get(bundleKey(e)) ?? [e]).reduce((t, o) => t + o.lanes.length, 0)

  /**
   * 這份路網的<strong>股距</strong>（公尺）：相鄰兩條軌道中心線常態上相距多少。
   *
   * 這是整份排版的量化單位——「差幾股」「拉開了沒有」都拿它除。先前用寫死的 3.35，
   * 那是這份 .xodr 的車道寬，換一份檔案（不同軌距、不同的線間距，甚至不同單位）就
   * 全部量錯。改成從檔案本身統計：每一束的最外兩線距除以間隔數，取中位數。整份路網
   * 只有一條車道時退回車道寬。
   */
  const pitchM = (() => {
    const all: number[] = []
    for (const e of graph.edges) {
      const n = bundleLanes(e)
      if (n < 2) continue
      for (let i = 0; i <= 8; i += 1) {
        const g = gapAt(e, i / 8)
        if (g > 0.1) all.push(g / (n - 1))
      }
    }
    if (all.length) {
      all.sort((a, b) => a - b)
      return all[Math.floor(all.length / 2)]!
    }
    const w = graph.edges.flatMap((e) => e.lanes.map((l) => l.widthM)).filter((x) => x > 0.1)
    if (w.length) {
      w.sort((a, b) => a - b)
      return w[Math.floor(w.length / 2)]!
    }
    return LANE_W_M
  })()

  /**
   * 節點在它那一排裡的<strong>股位</strong>。
   *
   * 正交化把同一排的節點壓到同一條線上，那一排裡各節點原本的高低差就消失了——實測
   * 上排四個節點真實 y 是 +4.2 / −4.0 / −11.8 / −14.3，全被壓成 −7.5，road 8 兩端
   * 22.3 公尺的落差整個不見。
   *
   * 於是「離兩端連線多遠」量到的不是路在挪，而是那條連線在斜：road 8 的真實 y 前
   * 六成一路平（4.2→6.8），六到九成掉 22 公尺，離弦卻是一路爬到 16 再收回零。照離弦
   * 畫，平的那段被畫成往上凸，掉下去那段被畫成凸完回來——形狀正好相反。
   *
   * 改成讓一條邊的<strong>兩端各自落在自己的股位</strong>：節點的股位由它自己離那一排
   * 平均多遠決定，一個節點只有一個值，所以在那裡交會的每條邊自動對得起來，不會有接縫。
   */
  const axisScale = (orient: 'h' | 'v') => (orient === 'h' ? sy : sx)
  /**
   * 節點離它那一排多遠，換算成版面像素。
   *
   * 不量化成股。股距是「兩條並行軌道之間」的距離，拿它量<strong>路自己的高低差</strong>
   * 會放大十倍：這份場域縱向 350 公尺壓進 640 像素，一股 60 像素等於 33 公尺，而股距
   * 只有 3.5 公尺。road 1/3 兩端真實差 7 公尺，量化成股會變成兩股 120 像素，實際上照
   * 版面比例只有 13 像素。所以直接照版面比例換算，落差多少就畫多少。
   */
  /**
   * 這條邊某一端<strong>直的那一段</strong>在哪（真實側位，公尺）。
   *
   * 不能拿節點的座標當這個值。節點是好幾條路端點焊起來的位置，而那個位置正好落在
   * 彎裡面：左側那根 287 公尺的直立柱，整段 x 都在 −880.5，只有最上面 25 公尺為了轉進
   * 橫向那條而甩到 −869——節點記的就是 −869。照它畫，整根柱子會被往右推 33 像素，還在
   * 中段插一段斜接，而真的柱子是直的、只有貼著轉角那一小截在彎。
   *
   * 所以取端點<strong>稍微往裡面</strong>那一段的平均：轉角讓出去的部分不算，量到的
   * 才是這條邊直的地方。
   */
  const endLat = (e: GraphEdge, atFrom: boolean): number => {
    const pts = e.points
    if (!pts.length) return 0
    const lo = atFrom ? 0.08 : 0.75
    const hi = atFrom ? 0.25 : 0.92
    let t = 0
    const N = 6
    for (let i = 0; i <= N; i += 1) {
      const f = lo + ((hi - lo) * i) / N
      const u = Math.max(0, Math.min(1, f)) * (pts.length - 1)
      const j = Math.min(pts.length - 2, Math.floor(u))
      const k = u - j
      const px = pts[j]!.x + (pts[j + 1]!.x - pts[j]!.x) * k
      const py = pts[j]!.y + (pts[j + 1]!.y - pts[j]!.y) * k
      t += e.orient === 'h' ? py : px
    }
    return t / (N + 1)
  }
  /** 節點在某個軸上的代表側位：那個方向上每條邊直段位置的平均 */
  const nodeLatCache = new Map<string, number>()
  const nodeLat = (n: GraphNode, orient: 'h' | 'v'): number | null => {
    const key = `${n.id}|${orient}`
    const hit = nodeLatCache.get(key)
    if (hit !== undefined) return hit
    const list = (incident.get(n.id) ?? []).filter((e) => e.orient === orient)
    if (!list.length) return null
    let t = 0
    for (const e of list) t += endLat(e, e.from === n.id)
    const v = t / list.length
    nodeLatCache.set(key, v)
    return v
  }
  const nodeOffsetPx = (n: GraphNode, orient: 'h' | 'v'): number => {
    const lat = nodeLat(n, orient)
    if (lat === null) return 0
    const dev = lat - (orient === 'h' ? n.y : n.x)
    const px = axisSign(orient) * dev * axisScale(orient)
    // 上限四分之三股：框壓得很扁時股距本來就快容不下軌道寬，落差再加上去就會疊在一起
    const cap = levelPx * 0.75
    return Math.max(-cap, Math.min(cap, px))
  }
  /**
   * 一股換算成版面偏移的方向。
   *
   * 橫的邊沿版面 y 排，而真實 y 越大越靠北、在圖上越<strong>上面</strong>，所以要反號；
   * 縱的邊沿版面 x 排，真實 x 越大越靠東、在圖上越右邊，同號。
   *
   * 先前這裡用的是 laneSign（車道序號往哪邊排），它跟著行車方向翻面。當時的股數是從
   * 「離弦」來的、也跟著方向翻，兩個翻面剛好抵銷。現在股位改用真實側位算，不再跟方向
   * 有關，就得用固定的軸向。
   */
  const axisSign = (orient: 'h' | 'v') => (orient === 'h' ? -1 : 1)
  /** 這條邊在某個節點那一端要讓出的版面偏移 */
  const endExtra = (n: GraphNode, orient: 'h' | 'v') => nodeOffsetPx(n, orient)

  /*
   * 比常態寬<strong>半股</strong>以上就算拉開。常態寬度是這一束自己的股數乘上股距，
   * 所以三線並行的束不會因為本來就比較寬而被誤判成拉開。
   */
  const spreadAt = (e: GraphEdge, f: number): number =>
    gapAt(e, f) - pitchM * Math.max(1, bundleLanes(e) - 1) >= pitchM * 0.5 ? 1 : 0

  /*
   * 一個節點只畫<strong>一組</strong>轉角。
   *
   * 先前是「這個節點上每一對 h/v 都畫一個轉角」。路口常常是三岔——例如場域左下角，
   * 一條路從東邊過來、主線往北、另有一條 35 公尺的短支線往南。三條邊配出兩對 h/v，
   * 於是同一個角上疊了兩組圓角，實測互相蓋掉 14400 平方像素，看起來就是一團。
   *
   * 真正該轉的是<strong>兩邊都走得遠</strong>的那一對，那才是主線在這裡轉彎。其餘的
   * 邊照自己的方向畫成直的——短支線本來就只是從轉角旁邊伸出去一小截。
   */
  const cornerPair = new Map<string, { h: GraphEdge; v: GraphEdge }>()
  for (const node of graph.nodes) {
    const list = incident.get(node.id) ?? []
    let best: { h: GraphEdge; v: GraphEdge; score: number } | null = null
    for (const a of list) {
      if (a.orient !== 'h') continue
      for (const b of list) {
        if (b.orient !== 'v') continue
        const score = Math.min(a.lengthM, b.lengthM)
        if (!best || score > best.score) best = { h: a, v: b, score }
      }
    }
    if (best) cornerPair.set(node.id, { h: best.h, v: best.v })
  }

  /** 邊在節點端讓出的長度：那一端<strong>真的會放</strong>轉角或分岔才讓 */
  const trimAt = (e: GraphEdge, nodeId: string, fullLen: number) => {
    const pair = cornerPair.get(nodeId)
    const corner = pair && (pair.h.id === e.id || pair.v.id === e.id) ? cornerR : 0
    const sw = switchTrim.get(`${e.id}|${nodeId}`) ?? 0
    const want = Math.max(corner, sw)
    return want > 0 ? Math.min(want, fullLen / 2 - 1) : 0
  }

  for (const e of graph.edges) {
    const ends = edgeEnds(e, byId)
    if (!ends) continue
    const A = P(ends.a)
    const B = P(ends.b)
    const full = Math.hypot(B.x - A.x, B.y - A.y)
    if (full < 2) continue
    const ux = (B.x - A.x) / full
    const uy = (B.y - A.y) / full
    /*
     * 讓出去的長度還要算上節點在<strong>沿線那個軸</strong>上的偏移。
     *
     * 轉角與分岔是畫在兩條直帶延伸線的交點上，那個點在沿線方向也被挪過（橫的邊挪的是
     * x，而 x 正是它自己前進的方向）。邊只讓一個半徑的話，band 的盡頭停在原本的節點
     * 位置，跟挪過去的轉角就差了那一段——實測左端上下兩個轉角與橫向軌道之間各斷開一截。
     */
    const alongU = e.orient === 'h' ? ux : uy
    const alongShift = (n: GraphNode) => endExtra(n, e.orient === 'h' ? 'v' : 'h')
    const trim0 = trimAt(e, e.from, full)
    const trim1 = trimAt(e, e.to, full)
    const t0 = Math.max(0, trim0 > 0 ? trim0 + alongU * alongShift(ends.a) : 0)
    const t1 = Math.max(0, trim1 > 0 ? trim1 - alongU * alongShift(ends.b) : 0)
    const len = full - t0 - t1
    if (len < 2) continue
    const S = { x: A.x + ux * t0, y: A.y + uy * t0 }

    const perBlockM = Math.max(
      1,
      e.orient === 'h' ? block.metersPerBlockX : block.metersPerBlockY,
    )
    // 讓出轉角之後剩下的里程，才是要切塊的長度
    const usedM = e.lengthM * (len / full)
    const minRunM = (levelPx / Math.max(1e-6, len / Math.max(1e-6, usedM))) || LANE_W_M

    const offs = offsetsOf(e)
    const ax = perpAxis(e)
    /*
     * 一條路自己的<strong>橫移</strong>要畫出來。
     *
     * 量的是「這一點的真實側位離<strong>這一排的線</strong>多遠」——正交化把同一排的
     * 節點壓到同一條線上，那條線就是這條邊在圖上的位置，所以離它多遠才是圖上該讓開
     * 多少。
     *
     * 先前量的是「離兩端連線多遠」。兩端不等高時那條連線是斜的，路是平的，於是平的
     * 那段被算成一路偏離、畫成往上凸，真正掉下去的那段反而被畫成凸完回來，形狀相反。
     */
    const perpScale = axisScale(e.orient)
    const rowLat = e.orient === 'h' ? ends.a.y : ends.a.x
    /** 這一點的真實側位離這一排多遠（公尺） */
    const latDevAt = (f: number): number => {
      const pts = e.points
      if (pts.length < 2) return 0
      const u = Math.max(0, Math.min(1, f)) * (pts.length - 1)
      const i = Math.min(pts.length - 2, Math.floor(u))
      const t = u - i
      const px = pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t
      const py = pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t
      return (e.orient === 'h' ? py : px) - rowLat
    }
    /** 側位差換算成版面偏移（像素），上限四分之三股，免得一條偏很遠的路把整張圖撐開 */
    const capPx = levelPx * 0.75
    const toPx = (devM: number) =>
      Math.max(-capPx, Math.min(capPx, axisSign(e.orient) * devM * perpScale))
    /**
     * 切段時的量化單位：<strong>一股在圖上代表多少公尺</strong>。
     *
     * 用股距（軌道之間的 3.5 公尺）去切會把每一點小起伏都切成一段；圖上看得出來的
     * 差異是「挪了半條軌道寬」那個級距，換算回真實世界是幾十公尺。
     */
    const stepM = levelPx / Math.max(1e-6, perpScale)
    /*
     * 切段用的級距取<strong>四分之一股</strong>：線在圖上挪了四分之一條軌道寬就看得
     * 出來不是直的，值得切一段。整股當級距的話，road 9 那個 ±8 公尺的緩坡（圖上 15
     * 像素）會被判成沒動，原圖看得到的 S 又不見了。
     */
    const segUnitM = stepM / 4
    const levelAt = (f: number): number =>
      Math.max(-8, Math.min(8, Math.round(latDevAt(f) / segUnitM)))
    /** 沿線切成幾段「同一階」的區間 */
    let levelRuns: Array<{ f0: number; f1: number; level: number; offsetPx: number }> = []
    /*
     * 短邊不看中途的橫移。
     *
     * 短邊上量到的起伏幾乎都是那條路自己在轉彎——路口前後那幾十公尺本來就是弧。但兩端
     * 的高度還是要接上，所以端點不同高時仍然換一次，只是不看中間。
     */
    const MIN_TAPER_BLOCKS = 6
    if (usedM < perBlockM * MIN_TAPER_BLOCKS) {
      levelRuns.push({ f0: 0, f1: 1, level: 0, offsetPx: 0 })
    } else {
      const K = Math.max(4, Math.min(48, Math.round(usedM / 15)))
      const raw: Array<{ f0: number; f1: number; level: number; offsetPx: number }> = []
      let start = 0
      let cur = levelAt(0)
      for (let i = 1; i <= K; i += 1) {
        const lv = levelAt(i / K)
        if (lv === cur) continue
        raw.push({ f0: start / K, f1: i / K, level: cur, offsetPx: 0 })
        start = i
        cur = lv
      }
      raw.push({ f0: start / K, f1: 1, level: cur, offsetPx: 0 })
      /*
       * 太短的階段併給前一段。門檻用<strong>斜接自己的坡</strong>來定：坡是 1:3，換一階
       * 要走三個股距，留一半餘裕才不會兩段斜接頭尾相接，所以是四點五個股距；再不短於
       * 一塊，免得塊很小時門檻跟著失效。頭尾兩段不併，它們接的是節點。
       */
      const minShiftM = Math.max(minRunM * 4.5, perBlockM)
      const minRunF = Math.min(0.4, minShiftM / Math.max(1, usedM))
      raw.forEach((r, i) => {
        const prev = levelRuns[levelRuns.length - 1]
        const terminal = i === 0 || i === raw.length - 1
        if (prev && ((r.f1 - r.f0 < minRunF && !terminal) || r.level === prev.level)) {
          prev.f1 = r.f1
          return
        }
        levelRuns.push({ ...r })
      })
      if (!levelRuns.length) levelRuns.push({ f0: 0, f1: 1, level: 0, offsetPx: 0 })
    }

    /*
     * 每一段畫在<strong>那一段自己的平均高度</strong>上，兩端則直接用節點的高度。
     *
     * 節點的高度是那個節點自己的事，在它上面交會的每條邊都得用同一個值，接縫才不會
     * 錯開；中間各段照實際位置擺，簡圖才貼近真的幾何。
     */
    const meanDev = (f0: number, f1: number) => {
      let t = 0
      const N = 8
      for (let i = 0; i <= N; i += 1) t += latDevAt(f0 + ((f1 - f0) * i) / N)
      return t / (N + 1)
    }
    for (const r of levelRuns) r.offsetPx = toPx(meanDev(r.f0, r.f1))
    const fromPx = nodeOffsetPx(ends.a, e.orient)
    const toPxEnd = nodeOffsetPx(ends.b, e.orient)
    if (levelRuns.length === 1 && Math.abs(fromPx - toPxEnd) > levelPx * 0.12) {
      const only = levelRuns[0]!
      const mid = (only.f0 + only.f1) / 2
      levelRuns = [
        { f0: only.f0, f1: mid, level: only.level, offsetPx: fromPx },
        { f0: mid, f1: only.f1, level: only.level, offsetPx: toPxEnd },
      ]
    } else if (levelRuns.length === 1) {
      // 一段要同時接兩端：取平均，兩頭各差一半，都在看不出來的範圍內
      levelRuns[0]!.offsetPx = (fromPx + toPxEnd) / 2
    } else {
      levelRuns[0]!.offsetPx = fromPx
      levelRuns[levelRuns.length - 1]!.offsetPx = toPxEnd
    }
    /*
     * 併掉高度差看不出來的段界。
     *
     * 改完端點之後可能有相鄰兩段高度幾乎一樣；差不到八分之一股的落差在圖上就是一條
     * 直線，畫成斜接只會多一片碎片。
     */
    for (let i = levelRuns.length - 1; i > 0; i -= 1) {
      if (Math.abs(levelRuns[i]!.offsetPx - levelRuns[i - 1]!.offsetPx) < levelPx * 0.12) {
        levelRuns[i - 1]!.f1 = levelRuns[i]!.f1
        levelRuns.splice(i, 1)
      }
    }

    /*
     * 換股的位置移到<strong>路真的在挪</strong>的那一點。
     *
     * 段界不動段的「內容」，只往兩段的中點之間找橫移最猛的一點挪過去。方向要對上：
     * 往上挪的段界找最陡的上坡，不然會跳到旁邊那個反向的彎。
     */
    {
      const slopeAt = (f: number) => {
        const h = 0.02
        const lo = Math.max(0, f - h)
        const hi = Math.min(1, f + h)
        return (latDevAt(hi) - latDevAt(lo)) / Math.max(1e-6, hi - lo)
      }
      for (let i = 0; i + 1 < levelRuns.length; i += 1) {
        const a = levelRuns[i]!
        const b = levelRuns[i + 1]!
        const dir = Math.sign(toPx(1)) * Math.sign(b.offsetPx - a.offsetPx) || 1
        const lo = (a.f0 + a.f1) / 2
        const hi = (b.f0 + b.f1) / 2
        let best = a.f1
        let bestSlope = -Infinity
        const N = 40
        for (let k = 0; k <= N; k += 1) {
          const f = lo + ((hi - lo) * k) / N
          const sl = slopeAt(f) * dir
          if (sl > bestSlope) {
            bestSlope = sl
            best = f
          }
        }
        a.f1 = best
        b.f0 = best
      }
    }
    /** 斜接佔掉的沿線長度（版面像素），1:3 */
    const rampPx = (dPx: number) => Math.min(len * 0.3, Math.abs(dPx) * 3)

    /*
     * 拉開的區間。整束一起判，因為拉開是「這兩條之間」的事，不是某一條自己的事。
     * 短到放不下兩段斜接的區間不畫——那種寬度在圖上看不出來，只會多兩片碎斜接。
     */
    const spreadRuns: Array<{ f0: number; f1: number; spread: number }> = []
    {
      const K = 48
      const raw: Array<{ f0: number; f1: number; spread: number }> = []
      let start = 0
      let cur = spreadAt(e, 0)
      for (let i = 1; i <= K; i += 1) {
        const v = spreadAt(e, i / K)
        if (v === cur) continue
        raw.push({ f0: start / K, f1: i / K, spread: cur })
        start = i
        cur = v
      }
      raw.push({ f0: start / K, f1: 1, spread: cur })
      const minSpreadF = (levelPx * 1.5) / Math.max(1, len)
      raw.forEach((r, i) => {
        // 頭尾兩段不併：它們是這一束接回節點的地方，併掉的話整段都停在拉開的寬度上
        const terminal = i === 0 || i === raw.length - 1
        const prev = spreadRuns[spreadRuns.length - 1]
        if (prev && ((r.f1 - r.f0 < minSpreadF && !terminal) || r.spread === prev.spread)) {
          prev.f1 = r.f1
          return
        }
        spreadRuns.push({ ...r })
      })
      // 取樣點剛好落在轉折上時會生出零長度的段，先丟掉
      for (let i = spreadRuns.length - 1; i >= 0; i -= 1) {
        if (spreadRuns[i]!.f1 - spreadRuns[i]!.f0 <= 1e-9) spreadRuns.splice(i, 1)
      }
      if (!spreadRuns.length) spreadRuns.push({ f0: 0, f1: 1, spread: 0 })

      /*
       * 拉開的那一束在節點那一端<strong>還要接下去</strong>的話，得在這條邊裡面收回來，
       * 不然接到下一束時憑空差一股——實測 1#0+3#0 那一束一路寬到節點，另一頭的 road 2
       * 是標準間距。
       *
       * 開放端不收：那裡沒有別束要接，月台就在那裡，原圖上兩條線也是一路寬到底。
       */
      const continues = (nodeId: string) =>
        (incident.get(nodeId) ?? []).some((other) => bundleKey(other) !== bundleKey(e))
      const tailF = Math.min(0.35, (levelPx * 1.5) / Math.max(1, len))
      const head = spreadRuns[0]!
      if (head.spread === 1 && continues(e.from) && head.f1 > tailF * 1.5) {
        head.f0 = tailF
        spreadRuns.unshift({ f0: 0, f1: tailF, spread: 0 })
      }
      const tail = spreadRuns[spreadRuns.length - 1]!
      if (tail.spread === 1 && continues(e.to) && tail.f0 < 1 - tailF * 1.5) {
        tail.f1 = 1 - tailF
        spreadRuns.push({ f0: 1 - tailF, f1: 1, spread: 0 })
      }
    }

    /* 橫移與拉開各有各的段界，畫之前先合成同一組 */
    const cuts = [
      ...new Set([
        ...levelRuns.flatMap((r) => [r.f0, r.f1]),
        ...spreadRuns.flatMap((r) => [r.f0, r.f1]),
      ]),
    ].sort((a, b) => a - b)
    const pick = <T extends { f0: number; f1: number }>(arr: T[], f: number): T =>
      arr.find((r) => f >= r.f0 && f < r.f1) ?? arr[arr.length - 1]!

    e.lanes.forEach((lane, k) => {
      const o = offs[k]!
      /*
       * 拉開時往哪一邊讓：看這條車道在束裡本來排在中線的哪一側。讓開的量（away）
       * 是整束一起挪的，不算在內。
       */
      const side = Math.sign(o - (shift.get(e.id) ?? 0)) || 1
      const at = (f: number, extra: number): Vec => ({
        x: S.x + ux * len * f + ax.x * (o + extra),
        y: S.y + uy * len * f + ax.y * (o + extra),
      })
      const runs: Array<{ f0: number; f1: number; extra: number }> = []
      for (let i = 0; i + 1 < cuts.length; i += 1) {
        const f0 = cuts[i]!
        const f1 = cuts[i + 1]!
        if (f1 - f0 < 1e-6) continue
        const mid = (f0 + f1) / 2
        // 拉開時兩條各讓半股，中間就空出一整條軌道的寬度，剛好放得下月台
        const extra =
          pick(levelRuns, mid).offsetPx +
          pick(spreadRuns, mid).spread * (levelPx / 2) * side
        const last = runs[runs.length - 1]
        if (last && Math.abs(last.extra - extra) < 0.01) {
          last.f1 = f1
          continue
        }
        runs.push({ f0, f1, extra })
      }
      if (!runs.length) runs.push({ f0: 0, f1: 1, extra: 0 })
      /*
       * 中間夾著的短段併掉。
       *
       * 換股與拉開的段界有時只差一點點，中間夾出一段幾像素的平段；兩側各要一段斜接，
       * 擠在那幾像素裡就變成兩片近乎垂直的碎片（實測 6 像素寬、90 像素高）。併掉之後
       * 由一段斜接一次走完，坡度才正常。頭尾不動——它們接的是節點。
       */
      for (let i = runs.length - 2; i > 0; i -= 1) {
        const r = runs[i]!
        if ((r.f1 - r.f0) * len >= levelPx) continue
        runs[i - 1]!.f1 = r.f1
        runs.splice(i, 1)
      }

      /*
       * 兩段之間的斜接佔掉的半寬。
       *
       * 坡照 1:3 給，但不能吃掉比相鄰兩段本身還長的距離——收尾那一段常常很短（實測
       * 1#0+3#0 那一束只剩 4% 在收），照 1:3 算出來的斜接會伸出邊的兩端。放不下就讓
       * 它陡一點，總比畫到外面去好。
       */
      const halfAt = (i: number): number => {
        const a = runs[i]
        const b = runs[i + 1]
        if (!a || !b) return 0
        const want = rampPx(b.extra - a.extra) / 2 / len
        const room = Math.min((a.f1 - a.f0) / 2, (b.f1 - b.f0) / 2)
        // 擠不下 1:3 就用剩下的空間，但再擠也不陡過 1:1——垂直的一刀不像軌道
        const floor = Math.min(0.5, (Math.abs(b.extra - a.extra) * 0.5) / len)
        return Math.max(floor, Math.min(want, Math.max(room, floor)))
      }
      let seq = 0
      runs.forEach((run, ri) => {
        const extra = run.extra
        const next = runs[ri + 1]
        const cut0 = halfAt(ri - 1)
        const cut1 = halfAt(ri)
        const g0 = run.f0 + cut0
        const g1 = run.f1 - cut1
        if (g1 - g0 > 0.01) {
          const runM = usedM * (g1 - g0)
          const parts = Math.max(1, blocksInSpan(runM, perBlockM, minRunM))
          for (let i = 0; i < parts; i += 1) {
            const f0 = g0 + ((g1 - g0) * i) / parts
            const f1 = g0 + ((g1 - g0) * (i + 1)) / parts
            const p0 = at(f0, extra)
            const p1 = at(f1, extra)
            const centre = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
            const lengthM = Math.hypot(p1.x - p0.x, p1.y - p0.y)
            seq += 1
            shapes.push({
              kind: 'rect',
              name: `${lane.key}-${String(seq).padStart(2, '0')}`,
              role: 'road',
              lineKey: lane.key,
              lineLengthM: e.lengthM,
              realLatFromM: 0,
              realLatToM: 0,
              samples: [p0, p1],
              realPath: realSlice(e, k, e.lanes.length, f0, f1, t0 / full, t1 / full),
              centre,
              lengthM,
              widthM: bandW,
              rotationDeg: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI,
              sFrom: 0,
              sTo: 0,
            })
            note({ x: centre.x - lengthM / 2, y: centre.y - bandW / 2 })
            note({ x: centre.x + lengthM / 2, y: centre.y + bandW / 2 })
          }
        }
        // 與下一段之間的換股，用斜接軌道接
        if (!next) return
        const nextExtra = next.extra
        const half = halfAt(ri)
        const a0 = at(run.f1 - half, extra)
        const a1 = at(run.f1 + half, nextExtra)
        const alongDeg = (Math.atan2(uy, ux) * 180) / Math.PI
        const fit = fitTaperAt(a0, a1, bandW, alongDeg)
        seq += 1
        shapes.push({
          kind: 'taper',
          name: `${lane.key}X-${String(seq).padStart(2, '0')}`,
          role: 'road',
          lineKey: lane.key,
          lineLengthM: e.lengthM,
          realLatFromM: 0,
          realLatToM: 0,
          samples: [a0, a1],
          realPath: realSlice(e, k, e.lanes.length, run.f1 - half, run.f1 + half, t0 / full, t1 / full),
          geometry: fit.geometry,
          box: fit.box,
          sFrom: 0,
          sTo: 0,
        })
        note({ x: fit.box.xM, y: fit.box.yM })
        note({ x: fit.box.xM + fit.box.wM, y: fit.box.yM + fit.box.hM })
      })
    })
  }

  /* ── 轉角 ───────────────────────────────────────────────── */

  for (const node of graph.nodes) {
    const pair = cornerPair.get(node.id)
    if (!pair) continue
    const eh = pair.h
    const ev = pair.v
    /*
     * 轉角要落在<strong>那兩條邊實際到達的高度</strong>，不是節點的原點。
     *
     * 兩條邊在這個節點的股位由節點決定（橫的看真實 y、縱的看真實 x），邊已經照那個
     * 股位讓開了；轉角若還畫在原點上，兩頭就各差一格。
     */
    const N = (() => {
      const p = P(node)
      return { x: p.x + endExtra(node, 'v'), y: p.y + endExtra(node, 'h') }
    })()
    const hOther = byId.get(eh.from === node.id ? eh.to : eh.from)
    const vOther = byId.get(ev.from === node.id ? ev.to : ev.from)
    if (!hOther || !vOther) continue
    const sxDir = Math.sign(N.x - P(hOther).x) || 1
    const syDir = Math.sign(P(vOther).y - N.y) || 1
    const C = { x: N.x - sxDir * cornerR, y: N.y + syDir * cornerR }
    const count = Math.min(eh.lanes.length, ev.lanes.length)
    const offsH = offsetsOf(eh)
    for (let k = 0; k < count; k += 1) {
      const o = offsH[k]!
      const radius = cornerR - syDir * o
      // 半徑到帶寬的一半就是內緣貼著圓心，再小才是真的畫不出來
      if (radius < bandW * 0.45) continue
      const p0 = { x: N.x - sxDir * cornerR, y: N.y + o }
      const p1 = { x: N.x - sxDir * sxDir * syDir * o, y: N.y + syDir * cornerR }
      const fit = fitCornerAt(C, radius + bandW / 2, bandW, p0, p1)
      shapes.push({
        kind: 'corner',
        name: `${eh.lanes[k]!.key}~${ev.lanes[k]!.key}`,
        role: 'road',
        lineKey: eh.lanes[k]!.key,
        lineLengthM: eh.lengthM,
        realLatFromM: 0,
        realLatToM: 0,
        samples: [p0, p1],
        geometry: fit.geometry,
        box: fit.box,
        outerRadiusM: radius + bandW / 2,
        sFrom: 0,
        sTo: 0,
      })
      note({ x: fit.box.xM, y: fit.box.yM })
      note({ x: fit.box.xM + fit.box.wM, y: fit.box.yM + fit.box.hM })
    }
  }

  /* ── 分岔 ───────────────────────────────────────────────── */

  /*
   * 讓開的那一束在節點處要接回主線，接法就是分岔軌道：一進兩出，梗在節點側，
   * 直行出口留在原位、岔出出口落在讓開之後的位置。沒有這一段的話，岔出去那一束
   * 會憑空出現在旁邊。
   */
  for (const node of graph.nodes) {
    // 分岔同樣要落在那一束實際到達的股位上
    const N = (() => {
      const p = P(node)
      return { x: p.x + endExtra(node, 'v'), y: p.y + endExtra(node, 'h') }
    })()
    const groups = new Map<string, GraphEdge[]>()
    for (const e of incident.get(node.id) ?? []) {
      const key = dirKey(e, node.id)
      const arr = groups.get(key) ?? []
      if (!arr.some((q) => bundleKey(q) === bundleKey(e))) arr.push(e)
      groups.set(key, arr)
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue
      const [sxDir, syDir] = key.split(',').map(Number) as [number, number]
      const main = [...list].sort((a, b) => b.lengthM - a.lengthM)[0]!
      for (const e of list) {
        if (e === main) continue
        const away = shift.get(e.id) ?? 0
        if (Math.abs(away) < 1) continue
        /*
         * 主線與岔線的車道要照<strong>版面上的排序</strong>配對，不能照 lane 序號。
         *
         * 兩條 road 的行車方向常常相反，lane 序號的排列方向就跟著翻面；照序號配對的
         * 話第一條接到對面那條，兩片分岔軌道會交叉成一個 X——實測右上那組就是這樣。
         * 兩邊各自照偏移由小到大排，再依序配，扇形永遠不會交叉。
         */
        const rank = (list: number[]) =>
          list.map((o, k) => ({ o, k })).sort((a, b) => a.o - b.o)
        const mainRank = rank(offsetsOf(main))
        const branchRank = rank(offsetsOf(e))
        const count = Math.min(mainRank.length, branchRank.length)
        // 岔出的長度照斜率給，太短會變尖刺
        // 與上面決定 switchTrim 時同一個值，兩者不一致的話分岔與軌道就接不上
        const runPx = switchTrim.get(`${main.id}|${node.id}`) ?? Math.max(cornerR, Math.abs(away) * 3)
        for (let k = 0; k < count; k += 1) {
          const oMain = mainRank[k]!.o
          const oBranch = branchRank[k]!.o
          const laneMain = main.lanes[mainRank[k]!.k]!
          const laneBranch = e.lanes[branchRank[k]!.k]!
          const perp = (o: number): Vec =>
            sxDir !== 0 ? { x: 0, y: o } : { x: o, y: 0 }
          const along = (t: number): Vec =>
            sxDir !== 0 ? { x: sxDir * t, y: 0 } : { x: 0, y: syDir * t }
          const p = (t: number, o: number): Vec => ({
            x: N.x + along(t).x + perp(o).x,
            y: N.y + along(t).y + perp(o).y,
          })
          const fit = fitSwitchAt(p(0, oMain), p(runPx, oMain), p(runPx, oBranch), bandW)
          if (!fit) continue
          shapes.push({
            kind: 'switch',
            name: `${laneBranch.key}^${laneMain.key}`,
            role: 'road',
            lineKey: laneBranch.key,
            lineLengthM: e.lengthM,
            realLatFromM: 0,
            realLatToM: 0,
            samples: [p(0, oMain), p(runPx, oBranch)],
            geometry: fit.geometry,
            box: fit.box,
            sFrom: 0,
            sTo: 0,
          })
          note({ x: fit.box.xM, y: fit.box.yM })
          note({ x: fit.box.xM + fit.box.wM, y: fit.box.yM + fit.box.hM })
        }
      }
    }
  }

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    shapes,
    bounds: {
      xMin: xs.length ? Math.min(...xs) : 0,
      yMin: ys.length ? Math.min(...ys) : 0,
      xMax: xs.length ? Math.max(...xs) : 1,
      yMax: ys.length ? Math.max(...ys) : 1,
    },
  }
}

/** 這一小段在真實世界的中心線：沿邊的取樣點內插，再照車道序橫移 */
function realSlice(
  e: GraphEdge,
  k: number,
  count: number,
  f0: number,
  f1: number,
  trim0: number,
  trim1: number,
): Vec[] {
  const pts = e.points
  if (pts.length < 2) return []
  const span = 1 - trim0 - trim1
  const at = (f: number) => {
    const u = Math.max(0, Math.min(1, trim0 + f * span)) * (pts.length - 1)
    const i = Math.min(pts.length - 2, Math.floor(u))
    const t = u - i
    return {
      x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t,
      y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t,
    }
  }
  const a = at(f0)
  const b = at(f1)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const m = Math.hypot(dx, dy) || 1
  const lat = (k - (count - 1) / 2) * (e.lanes[k]?.widthM || LANE_W_M)
  // 真實座標 y 向上：右法線是 (dy, -dx)
  const off = { x: (dy / m) * lat, y: (-dx / m) * lat }
  return [
    { x: a.x + off.x, y: a.y + off.y },
    { x: b.x + off.x, y: b.y + off.y },
  ]
}

/**
 * 排版並鋪滿框。
 *
 * 與舊版同一招：拿真的排版結果去逼近，照外框與目標的比值調整兩軸的比例尺。
 */
export function layoutTrackGraph(
  graph: TrackGraph,
  block: TrackGenBlockSize,
  box: { wPx: number; hPx: number },
): TrackGenLayout {
  const maxLanes = Math.max(1, ...graph.edges.map((e) => e.lanes.length))
  /*
   * 股距與軌道寬分開：框夠高時等於軌道寬（帶子剛好相鄰），框太扁時縮小，平行的帶子
   * 略為重疊。整張圖的大小因此不受軌道寬影響。
   */
  const levelPx = Math.max(2, Math.min(block.trackWidthPx, (box.hPx * 0.35) / maxLanes))

  let sx = 1
  let sy = 1
  let out = layoutOnce(graph, block, sx, sy, levelPx)
  for (let i = 0; i < 6; i += 1) {
    const w = Math.max(1, out.bounds.xMax - out.bounds.xMin)
    const h = Math.max(1, out.bounds.yMax - out.bounds.yMin)
    if (Math.abs(w - box.wPx) < 1 && Math.abs(h - box.hPx) < 1) break
    sx = Math.max(1e-4, sx * (box.wPx / w))
    sy = Math.max(1e-4, sy * (box.hPx / h))
    out = layoutOnce(graph, block, sx, sy, levelPx)
  }
  return out
}
