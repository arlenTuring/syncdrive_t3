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
        // 分岔軌道佔掉的長度：與下面畫分岔時用的同一條式子
        const runPx = Math.max(cornerR, away * 3)
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
    const t0 = trimAt(e, e.from, full)
    const t1 = trimAt(e, e.to, full)
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
     * 一條路自己的<strong>緩慢橫移</strong>要畫出來。
     *
     * 節點只管兩端，中間那段路實際上會慢慢挪開又挪回來——原始中心線看得到那個緩坡，
     * 而先前整條邊被畫成一條直的，那個起伏整個消失。
     *
     * 做法是量每一點離「兩端連線」多遠，除以一個車道寬就是差幾股；股數變了就在那裡
     * 插一段斜接軌道，斜度照 1:3 給。不夠一股的擺動不畫——那種程度在簡圖上看不出來，
     * 畫了只會多出一堆幾像素的碎片。
     */
    /** 這一點離「兩端連線」多遠（公尺，真實左法線為正） */
    const devAt = (f: number): number => {
      const pts = e.points
      if (pts.length < 3) return 0
      const u = Math.max(0, Math.min(1, f)) * (pts.length - 1)
      const i = Math.min(pts.length - 2, Math.floor(u))
      const t = u - i
      const p = {
        x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t,
        y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t,
      }
      const a = pts[0]!
      const b = pts[pts.length - 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const m = Math.hypot(dx, dy) || 1
      // 真實左法線；與車道序號同一個方向慣例
      return ((p.x - a.x) * -dy + (p.y - a.y) * dx) / m
    }
    /*
     * 最多差一股。
     *
     * 量到的偏離同時混著兩件事：兩條線彼此挪開（要畫），以及整條路自己在彎（已經由
     * 把邊拉直表達過了）。不夾的話後者會被逐股還原成一座階梯——實測長邊上一口氣生出
     * 64 段斜接、整份版面高度多了 236 像素。簡圖只需要看得出「這裡挪了一下」，一股就夠。
     *
     * 兩端的偏離依定義是零，所以頭尾兩段一定落在第 0 股，接得回節點。
     */
    const levelAt = (f: number): number =>
      Math.max(-1, Math.min(1, Math.round(devAt(f) / pitchM)))
    /** 沿線切成幾段「差同樣股數」的區間 */
    const levelRuns: Array<{ f0: number; f1: number; level: number }> = []
    /*
     * 短邊不畫橫移。
     *
     * 「離兩端連線多遠」在短邊上量出來的幾乎都是那條路自己在轉彎——路口前後那幾十
     * 公尺本來就是弧。實測 93 公尺的 road 1/3、68 公尺的 road 10、54 公尺的 11#1 各被
     * 判出一次換股，畫成四組沒有意義的斜接；真正該有的那一次在 683 公尺的 road 8 上。
     * 圖上看得懂的橫移至少要拉開幾塊，所以不到六塊長的邊一律畫直的。
     */
    const MIN_TAPER_BLOCKS = 6
    if (usedM < perBlockM * MIN_TAPER_BLOCKS) {
      levelRuns.push({ f0: 0, f1: 1, level: 0 })
    } else {
      const K = Math.max(4, Math.min(48, Math.round(usedM / 15)))
      const raw: Array<{ f0: number; f1: number; level: number }> = []
      let start = 0
      let cur = levelAt(0)
      for (let i = 1; i <= K; i += 1) {
        const lv = levelAt(i / K)
        if (lv === cur) continue
        raw.push({ f0: start / K, f1: i / K, level: cur })
        start = i
        cur = lv
      }
      raw.push({ f0: start / K, f1: 1, level: cur })
      /*
       * 太短的階段併給前一段。
       *
       * 逐點量出來的股數會在邊界上來回跳，每跳一次就是一段斜接；只有夠長的那一段才
       * 值得畫成「挪了一股」。
       *
       * 門檻本來寫死三塊。塊給得大的時候（橫向一塊 80 公尺）三塊就是 240 公尺，佔掉
       * 732 公尺長的 road 9 三分之一——它那個 S 的兩半各只有 183 與 213 公尺，於是整條
       * 被抹平成直線，原圖看得到的緩坡在圖上消失。
       *
       * 改成用<strong>斜接自己的坡</strong>來定：坡是 1:3，換一股要走三個股距，留一半
       * 的餘裕才不會兩段斜接頭尾相接，所以是四點五個股距；再不短於一塊，免得塊很小時
       * 門檻跟著失效。
       */
      const minShiftM = Math.max(minRunM * 4.5, perBlockM)
      const minRunF = Math.min(0.4, minShiftM / Math.max(1, usedM))
      /*
       * 最後一段不併。
       *
       * 它是這條邊<strong>回到節點</strong>的那一段，依定義在第 0 股。併掉的話整條邊
       * 的尾端就停在 ±1 股上，接到節點時憑空歪一格——road 8 原本尾端那段只佔 7%，
       * 被併進前一段，右端就與路口對不上。
       */
      raw.forEach((r, i) => {
        const prev = levelRuns[levelRuns.length - 1]
        const tooShort = r.f1 - r.f0 < minRunF && i < raw.length - 1
        if (prev && (tooShort || r.level === prev.level)) {
          prev.f1 = r.f1
          return
        }
        levelRuns.push({ ...r })
      })
      if (!levelRuns.length) levelRuns.push({ f0: 0, f1: 1, level: 0 })

      /*
       * 換股的位置移到<strong>路真的在挪</strong>的那一點。
       *
       * 分段是照「偏離跨過半股」切的，那個門檻很早就跨過去了：road 8 一路緩緩偏開，
       * 走到 9% 就已經差半股，於是斜接被畫在最左邊；但眼睛看到的那個彎在 70–80%——
       * 那裡的橫移速率是前段的五倍（每單位 −115 對 21）。原圖上的彎也在那裡。
       *
       * 所以段界不動段的「內容」，只往兩段的中點之間找橫移最猛的一點挪過去。方向要
       * 對上：往上挪的段界找最陡的上坡，不然會跳到旁邊那個反向的彎。
       */
      const slopeAt = (f: number) => {
        const h = 0.02
        const lo = Math.max(0, f - h)
        const hi = Math.min(1, f + h)
        return (devAt(hi) - devAt(lo)) / Math.max(1e-6, hi - lo)
      }
      for (let i = 0; i + 1 < levelRuns.length; i += 1) {
        const a = levelRuns[i]!
        const b = levelRuns[i + 1]!
        const dir = Math.sign(b.level - a.level) || 1
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
    const sign = laneSign(e)
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
          pick(levelRuns, mid).level * levelPx * sign +
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
        return Math.min(
          rampPx(b.extra - a.extra) / 2 / len,
          (a.f1 - a.f0) / 2,
          (b.f1 - b.f0) / 2,
        )
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
    const N = P(node)
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
    const N = P(node)
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
        const runPx = Math.max(cornerR, Math.abs(away) * 3)
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
