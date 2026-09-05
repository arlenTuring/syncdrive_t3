import {
  blocksInSpan,
  fitCornerAt,
  fitSwitchAt,
  fitTaperAt,
  LANE_W_M,
  type LayoutShape,
  type TrackGenLayout,
  type TrackSpan,
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

/**
 * 畫成簡圖時的<strong>製圖慣例</strong>。
 *
 * 這裡的每一個數字都<strong>不是</strong>從 .xodr 推得出來的——規格描述的是真實世界，
 * 沒有講「一張示意圖該長什麼樣」。它們也都不綁任何一份圖：全部相對於使用者給的軌道寬、
 * 每塊代表幾公尺，或是路網自己的統計值。
 *
 * 集中放在這裡，是為了讓「哪些是讀出來的、哪些是我訂的」一眼看得出來，要開成參數也只有
 * 這一個地方要動。
 */
const DRAWING = {
  /** 斜接的坡：換一條軌道的位置要走幾倍的距離 */
  rampRun: 3,
  /** 擠不下時最陡到哪：1 就是 45 度，再陡不像軌道 */
  rampMinRun: 1,
  /** 一段換股最少要多長：夠放一段坡再留一半餘裕 */
  runMargin: 1.5,
  /** 一條邊短過幾塊就不畫中途的橫移——那個尺度上的起伏在圖上讀不出來 */
  minTaperBlocks: 6,
  /** 切段的級距：線挪了幾分之一條軌道寬才算「看得出來不是直的」 */
  segUnit: 1 / 4,
  /** 兩段高度差幾分之一條軌道寬以內就當成同一段 */
  mergeUnit: 0.08,
  /** 短邊要為了兩端不等高而切一刀的門檻（幾分之一條軌道寬） */
  shortSplitUnit: 0.4,
  /** 一段斜接最多吃掉整條邊的幾成 */
  rampMaxSpan: 0.3,
  /** 束與束之間留幾股的空隙 */
  bundleGapSteps: 1,
} as const

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
  /*
   * 帶子畫多寬：使用者要的軌道寬，但<strong>不超過股距</strong>。
   *
   * 框壓得很扁時股距容不下要求的寬度，硬畫的話並行的兩條會沿全長重疊——那不是示意圖，
   * 是一片色塊。畫細一點是誠實的：那個框就只放得下這麼寬。
   */
  const bandW = Math.min(block.trackWidthPx, levelPx)
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
    // 走兩條邊裡較短那條的一半；沒有寫死的公尺數，換多大的路網都成立
    const probe = Math.max(1, Math.min(branch.lengthM, main.lengthM) * 0.5)
    const pb = walkFrom(branch, nodeId, probe)
    const pm = walkFrom(main, nodeId, probe)
    if (!pb || !pm) return fallback()
    // 真實 y 向上、版面 y 向下；縱向的邊改比真實 x
    const d = main.orient === 'h' ? -(pb.y - pm.y) : pb.x - pm.x
    if (Math.abs(d) < 1e-3) return fallback()
    return d > 0 ? 1 : -1
  }

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

  /** 這條邊在版面上有多長（節點到節點） */
  const spanOf = (x: GraphEdge) => {
    const a = byId.get(x.from)
    const b = byId.get(x.to)
    if (!a || !b) return Infinity
    const p = P(a)
    const q = P(b)
    return Math.hypot(q.x - p.x, q.y - p.y)
  }
  /** 轉角旁邊那種分岔：主線繼續轉彎，支線從轉彎前就岔出去 */
  const switchTrim = new Map<string, number>()
  const shift = new Map<string, number>()

  /*
   * 分岔畫在哪，<strong>檔案自己說了</strong>。
   *
   * 每個路口的連接道在 .xodr 裡寫著「我把 A 接到 B」，圖上就照這份配對走：一條 road 在
   * 同一個節點接得到兩束以上，那裡就是分岔——最長的那一束是直行，其餘往旁邊讓開。
   *
   * 先前是從幾何回推：「同一個節點上有兩束往同一個方向走」算分岔。那條規則抓不到兩腿
   * 一南一北的道岔，我就再補一條「轉角旁邊的同向邊也算」——兩條都是在重建檔案已經明說
   * 的事實，而且每遇到一種新的路口形狀就得再補一條。現在只有一條路徑：讀 movements。
   */
  type SwitchJob = {
    nodeId: string
    /** 梗：分岔開在這一束上 */
    stem: GraphEdge
    /** 直行出口 */
    through: GraphEdge
    /** 岔出出口 */
    branch: GraphEdge
    runPx: number
  }
  const switchJobs: SwitchJob[] = []
  /** 這條 road 在這個節點上的那一段 */
  const edgeOf = (nodeId: string, roadId: string) =>
    (incident.get(nodeId) ?? []).find((e) => e.roadId === roadId) ?? null
  /*
   * 誰直行、誰岔出，比的是<strong>整條 road 的長度</strong>，不是它在這個節點那一段。
   *
   * 一條路在圖上可能被切成好幾段，靠近路口的那一段常常很短；照段長比，68 公尺的主線會
   * 輸給 35 公尺的支線，直行與岔出就反了。
   */
  const roadLenM = new Map<string, number>()
  for (const e of graph.edges) {
    roadLenM.set(e.roadId, (roadLenM.get(e.roadId) ?? 0) + e.lengthM)
  }
  const wholeRoadLen = (e: GraphEdge) => roadLenM.get(e.roadId) ?? e.lengthM

  for (const node of graph.nodes) {
    // 這個節點上，每條 road 走得到哪些 road
    const partners = new Map<string, Set<string>>()
    for (const m of graph.movements) {
      if (m.nodeId !== node.id) continue
      for (const [a, b] of [
        [m.a, m.b],
        [m.b, m.a],
      ]) {
        const set = partners.get(a!) ?? new Set<string>()
        set.add(b!)
        partners.set(a!, set)
      }
    }
    if (!partners.size) continue

    // 束才是圖上的一條線：同一對節點之間的幾條 road 算同一束
    const distinct = (roadIds: Iterable<string>) => {
      const out = new Map<string, GraphEdge>()
      for (const id of roadIds) {
        const e = edgeOf(node.id, id)
        if (e) out.set(bundleKey(e), e)
      }
      return [...out.values()]
    }
    let stem: GraphEdge | null = null
    let outs: GraphEdge[] = []
    for (const [roadId, set] of partners) {
      const self = edgeOf(node.id, roadId)
      if (!self) continue
      const list = distinct(set).filter((e) => bundleKey(e) !== bundleKey(self))
      if (list.length < 2) continue
      if (!stem || list.length > outs.length || wholeRoadLen(self) > wholeRoadLen(stem)) {
        stem = self
        outs = list
      }
    }
    if (!stem || outs.length < 2) continue

    // 最長的那一束直行，其餘讓開
    const sorted = [...outs].sort((a, b) => wholeRoadLen(b) - wholeRoadLen(a))
    const through = sorted[0]!
    // 讓開的量 = 直行那一束的寬度，再加上束與束之間的空隙
    let steps = (bundleCount.get(bundleKey(through)) ?? 1) + DRAWING.bundleGapSteps
    for (let i = 1; i < sorted.length; i += 1) {
      const branch = sorted[i]!
      const key = bundleKey(branch)
      const awayPx = steps * levelPx
      const side = branchSide(branch, through, node.id)
      for (const q of bundles.get(key) ?? []) {
        if (Math.abs(shift.get(q.id) ?? 0) < awayPx) shift.set(q.id, awayPx * side)
      }
      /*
       * 分岔佔掉的長度：想要 1:3 的坡，但不能比梗那一束的一半還長——分岔是開在梗上的，
       * 它讓出去多少，梗就短多少。
       */
      const runPx = Math.max(
        1,
        Math.min(Math.max(cornerR, awayPx * DRAWING.rampRun), spanOf(stem) * 0.5 - 1),
      )
      for (const q of bundles.get(bundleKey(stem)) ?? []) {
        const tk = `${q.id}|${node.id}`
        if ((switchTrim.get(tk) ?? 0) < runPx) switchTrim.set(tk, runPx)
      }
      switchJobs.push({ nodeId: node.id, stem, through, branch, runPx })
      steps += (bundleCount.get(key) ?? 1) + DRAWING.bundleGapSteps
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
   * 而且不必量：OpenDRIVE 把兩條行車道<strong>之間</strong>那幾條非行車道的寬度寫在
   * 檔案裡（分隔島、月台、只有標線寬度的分隔）。上下行併在一起時那個寬度只有幾公分，
   * 中間夾進月台時會長到幾公尺。所以拉開的位置與長度是<strong>讀</strong>出來的。
   */
  /** 這份檔案的車道寬（公尺）：取中位數，不寫死 */
  const laneWidthM = (() => {
    const w = graph.edges.flatMap((e) => e.lanes.map((l) => l.widthM)).filter((x) => x > 0.01)
    if (!w.length) return LANE_W_M
    w.sort((a, b) => a - b)
    return w[Math.floor(w.length / 2)]!
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
   * 所以取靠這一端<strong>那半條邊的中位數</strong>。中位數不受端點附近那一小截弧影響，
   * 也不需要挑一個「從幾成到幾成」的取樣窗——那種窗口就是又一個要調的數字。
   */
  const endLat = (e: GraphEdge, atFrom: boolean): number => {
    const pts = e.points
    if (!pts.length) return 0
    const half = pts.filter((_, i) =>
      atFrom ? i <= (pts.length - 1) / 2 : i >= (pts.length - 1) / 2,
    )
    const vals = (half.length ? half : pts).map((p) => (e.orient === 'h' ? p.y : p.x))
    vals.sort((a, b) => a - b)
    return vals[Math.floor(vals.length / 2)]!
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
    // 上限半股：一條帶子最多挪到與鄰帶的正中間，再多就侵犯隔壁那一條的位置
    const cap = levelPx * 0.5
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
  /** 這一束在這個位置的內側間隔（公尺）：束裡每條邊自己那半邊加起來 */
  const innerGapAt = (e: GraphEdge, f: number): number => {
    let sum = 0
    for (const other of bundles.get(bundleKey(e)) ?? [e]) {
      const g = other.innerGapM
      if (!g.length) continue
      // 同一束裡的邊可能反向存，對齊之後才是同一個位置
      const ff = other.from === e.from ? f : 1 - f
      const u = Math.max(0, Math.min(1, ff)) * (g.length - 1)
      const i = Math.min(g.length - 2, Math.floor(u))
      const t = u - i
      sum += g.length === 1 ? g[0]! : g[i]! + (g[i + 1]! - g[i]!) * t
    }
    return sum
  }
  /*
   * 拉開的判準：<strong>兩條行車道之間夾得下半條車道</strong>。
   *
   * 這不是量兩條線離多遠再跟常態比，而是直接讀檔案寫的內側間隔——那幾條非行車道的寬度。
   * 上下行併在一起時它只有幾公分（實測 0.15），中間夾進月台時會長到幾公尺（實測 2.3 與
   * 4.5）。門檻取這份檔案自己的車道寬的一半：夾得下半條車道，才是站得了人的空地。
   */
  const spreadAt = (e: GraphEdge, f: number): number =>
    innerGapAt(e, f) >= laneWidthM * 0.5 ? 1 : 0

  /*
   * 每個節點自己的轉角半徑：<strong>兩隻腳都要放得下</strong>。
   *
   * 半徑是照股距與帶寬算的，跟邊有多長無關。碰到短邊時，邊只讓得出自己的一半，轉角卻
   * 照原半徑畫，兩者就對不上——實測 road 10 那個 20 公尺的轉折，軌道寬拉到 70 時接縫
   * 差了 59 像素。所以半徑先夾在兩隻腳各自的一半以內，讓與畫用同一個值。
   */
  const cornerRadiusAt = new Map<string, number>()
  for (const [nodeId, pair] of cornerPair) {
    const r = Math.min(cornerR, spanOf(pair.h) * 0.5 - 1, spanOf(pair.v) * 0.5 - 1)
    /*
     * 放不下就不畫圓角，讓兩條帶子直接交成直角。
     *
     * 最內圈那一條的半徑是「節點半徑減去束的半寬」。腳太短時它會小過半個帶寬——那種弧
     * 畫不出來。先前是<strong>只跳過那一條</strong>，於是同一個角有的車道有圓角、有的
     * 沒有，缺的那條就開一個口。整組不畫、兩條帶子在角上交會，才是完整的直角。
     */
    const half = Math.max(
      ...offsetsOf(pair.h).map(Math.abs),
      ...offsetsOf(pair.v).map(Math.abs),
      0,
    )
    cornerRadiusAt.set(nodeId, r - half < bandW * 0.45 ? 0 : r)
  }

  /** 一束往兩側最遠伸到哪（半個束寬，含讓開的量） */
  const halfSpanOf = (e: GraphEdge) => Math.max(0, ...offsetsOf(e).map(Math.abs))

  /**
   * 邊在節點端讓出的長度。負值代表<strong>往外多伸一截</strong>。
   *
   * 那一端真的會放轉角或分岔才讓。放不下轉角時（腳太短）反過來要<strong>補</strong>：
   * 橫的那條停在節點的 x、縱的那條停在節點的 y，各自還帶著自己的車道偏移，中間會留下一個
   * L 形的洞，洞的大小就是另一束的半寬——實測軌道寬 70 時破了 68 像素。各自往對方的位置
   * 多伸那麼一截，兩條帶子就在角上交會成一個實心的直角。
   */
  const trimAt = (e: GraphEdge, nodeId: string, fullLen: number) => {
    const pair = cornerPair.get(nodeId)
    const onPair = pair && (pair.h.id === e.id || pair.v.id === e.id)
    if (onPair && (cornerRadiusAt.get(nodeId) ?? cornerR) <= 0) {
      const other = pair!.h.id === e.id ? pair!.v : pair!.h
      return -halfSpanOf(other)
    }
    const corner = onPair ? (cornerRadiusAt.get(nodeId) ?? cornerR) : 0
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
    const t0 = trim0 > 0 ? Math.max(0, trim0 + alongU * alongShift(ends.a)) : trim0
    const t1 = trim1 > 0 ? Math.max(0, trim1 - alongU * alongShift(ends.b)) : trim1
    let len = full - t0 - t1
    if (len < 2) continue
    let S = { x: A.x + ux * t0, y: A.y + uy * t0 }

    /*
     * 支線不該被路口的元件吃掉。
     *
     * 側線 road 4 全長 59 公尺（版面 210 像素），分岔要爬過一整束的寬度、在圖上就得
     * 走一百多像素，讓出去之後剩下的直線只剩一半——原圖上那是一條長長的平行側線，
     * 圖上卻變成兩塊。可是它的另一頭是死路，沒有東西要接，位置本來就不帶資訊；所以
     * 讓出去多少，就從死路那一頭補回來，整條的長度不受影響。
     *
     * 再給一個下限：<strong>至少要跟這一束一樣寬</strong>。短過這個就不像一段軌道，
     * 只像一塊方形——縱向那條 35 公尺的短支線（版面上只有 64 像素高、卻有 120 像素寬）
     * 就是這樣。
     */
    const degOf = (id: string) => (incident.get(id) ?? []).length
    const deadFrom = degOf(e.from) <= 1
    const deadTo = degOf(e.to) <= 1
    if (deadFrom !== deadTo) {
      const back = deadFrom
      const minStub = (bundleCount.get(bundleKey(e)) ?? e.lanes.length) * levelPx
      // 讓出去多少都不算在長度裡：支線畫得跟它自己一樣長，不夠看就補到一束寬
      const grow = Math.max(full, minStub) - len
      if (grow > 0) {
        len += grow
        if (back) S = { x: S.x - ux * grow, y: S.y - uy * grow }
      }
    }

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
    /*
     * 畫面上的 f（0–1，量的是<strong>讓開之後</strong>那一段）換回這條 road 的里程。
     *
     * 車輛反投影回 OpenDRIVE 得到的是 road 的 s，所以每一塊都要記下自己涵蓋哪一段 s，
     * 定位時才查得到。讓給轉角與分岔的那兩截也要算進去，不然里程會少一段。
     */
    /*
     * 負的讓開量代表帶子<strong>往外多伸</strong>了一截（放不下圓角時補的直角）。那一截
     * 在路網上屬於隔壁那條邊，不是自己的里程，所以算 s 時當成 0。
     */
    const sTrim0 = Math.max(0, t0) / full
    const sTrim1 = Math.max(0, t1) / full
    const spanFrac = Math.max(0, 1 - sTrim0 - sTrim1)
    const sAt = (f: number) =>
      e.sFromM + (e.sToM - e.sFromM) * (sTrim0 + Math.max(0, Math.min(1, f)) * spanFrac)
    /** 這條車道在這一段的行車方向（真實座標）：中心線的走向，正號車道與 s 相反 */
    const laneHeading = (laneIdx: number, f0: number, f1: number) => {
      const pts = e.lanes[laneIdx]?.points ?? e.points
      if (pts.length < 2) return 0
      const grab = (f: number) => {
        const u = Math.max(0, Math.min(1, sTrim0 + f * spanFrac)) * (pts.length - 1)
        const i = Math.min(pts.length - 2, Math.floor(u))
        const t = u - i
        return {
          x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t,
          y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t,
        }
      }
      const a = grab(f0)
      const b = grab(f1)
      const along = Math.atan2(b.y - a.y, b.x - a.x)
      return (e.lanes[laneIdx]?.laneId ?? 0) > 0 ? along + Math.PI : along
    }
    const spanOfLane = (laneIdx: number, f0: number, f1: number): TrackSpan => ({
      roadId: e.roadId,
      laneId: e.lanes[laneIdx]?.laneId ?? 0,
      sFromM: sAt(f0),
      sToM: sAt(f1),
      headingRad: laneHeading(laneIdx, f0, f1),
      pathFrom: 0,
      pathTo: 1,
    })

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
    /** 側位差換算成版面偏移（像素），上限半股：最多挪到與鄰帶的正中間 */
    const capPx = levelPx * 0.5
    const toPx = (devM: number) =>
      Math.max(-capPx, Math.min(capPx, axisSign(e.orient) * devM * perpScale))
    /**
     * 切段時的量化單位：<strong>一股在圖上代表多少公尺</strong>。
     *
     * 用股距（軌道之間的 3.5 公尺）去切會把每一點小起伏都切成一段；圖上看得出來的
     * 差異是「挪了半條軌道寬」那個級距，換算回真實世界是幾十公尺。
     *
     * 這裡一律拿<strong>軌道寬</strong>當尺，不拿股距——判斷的是「線挪得看不看得出來」，
     * 那要跟線自己的粗細比，跟兩條線之間留多少空隙無關。
     */
    const stepM = bandW / Math.max(1e-6, perpScale)
    /*
     * 切段用的級距取<strong>四分之一股</strong>：線在圖上挪了四分之一條軌道寬就看得
     * 出來不是直的，值得切一段。整股當級距的話，road 9 那個 ±8 公尺的緩坡（圖上 15
     * 像素）會被判成沒動，原圖看得到的 S 又不見了。
     */
    const segUnitM = stepM * DRAWING.segUnit
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
    const MIN_TAPER_BLOCKS = DRAWING.minTaperBlocks
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
      const minShiftM = Math.max(minRunM * DRAWING.rampRun * (1 + DRAWING.runMargin), perBlockM)
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
    /*
     * 只有一段的邊要不要為了兩端高度不同而切一刀。
     *
     * 長邊值得——那是路真的在挪。短邊不值得：它本來就沒有空間好好走一段坡，兩端的差
     * 又常常只是路口附近幾像素的擺動。實測塊給 50 公尺時，59 公尺的側線為了六像素的
     * 落差生出一段斜接，圖上就是側線上莫名其妙多一塊。
     */
    const splitAt =
      usedM < perBlockM * MIN_TAPER_BLOCKS
        ? bandW * DRAWING.shortSplitUnit
        : bandW * DRAWING.mergeUnit
    if (levelRuns.length === 1 && Math.abs(fromPx - toPxEnd) > splitAt) {
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
     * 改完端點之後可能有相鄰兩段高度幾乎一樣；差不到一成軌道寬的落差在圖上就是一條
     * 直線，畫成斜接只會多一片碎片。
     */
    for (let i = levelRuns.length - 1; i > 0; i -= 1) {
      if (Math.abs(levelRuns[i]!.offsetPx - levelRuns[i - 1]!.offsetPx) < bandW * DRAWING.mergeUnit) {
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
    const rampPx = (dPx: number) =>
      Math.min(len * DRAWING.rampMaxSpan, Math.abs(dPx) * DRAWING.rampRun)

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
      const minSpreadF = (levelPx * DRAWING.runMargin) / Math.max(1, len)
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
      const tailF = Math.min(0.35, (levelPx * DRAWING.runMargin) / Math.max(1, len))
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
        const floor = Math.min(0.5, (Math.abs(b.extra - a.extra) * DRAWING.rampMinRun) / 2 / len)
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
              spans: [spanOfLane(k, f0, f1)],
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
          spans: [spanOfLane(k, run.f1 - half, run.f1 + half)],
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

  /*
   * 路口的元件也要說出自己代表哪一段路網。
   *
   * 圓角吃掉兩條腿在節點那頭讓出來的部分，分岔吃掉梗那一束讓出來的部分——那些里程如果
   * 沒有人認領，車輛開到路口就查不到任何一塊，只能掉回外框內插（實測跳 137 像素）。
   */
  /** 這條邊在這個節點那一端讓出去的比例 */
  const trimFracAt = (e: GraphEdge, nodeId: string) => {
    const full = spanOf(e)
    if (!Number.isFinite(full) || full <= 0) return 0
    return Math.max(0, Math.min(0.5, trimAt(e, nodeId, full) / full))
  }
  /** 這條邊在這個節點那一端、讓出去那一截所涵蓋的路網區間 */
  const spanAtNode = (e: GraphEdge, nodeId: string, laneIdx: number, reversed = false): TrackSpan => {
    const frac = trimFracAt(e, nodeId)
    const total = e.sToM - e.sFromM
    const [a, b] =
      e.from === nodeId
        ? [e.sFromM, e.sFromM + total * frac]
        : [e.sToM - total * frac, e.sToM]
    // 方向照那條腿自己的走向算，不要用整塊的頭尾連線
    const tail = laneTailAt(e, nodeId, laneIdx)
    const laneId = e.lanes[laneIdx]?.laneId ?? 0
    let along = 0
    if (tail.length >= 2) {
      const p0 = tail[0]!
      const p1 = tail[tail.length - 1]!
      // laneTailAt 是由節點往邊內走，行車方向要看這一端是 from 還是 to
      const fwd = e.from === nodeId
      along = fwd
        ? Math.atan2(p1.y - p0.y, p1.x - p0.x)
        : Math.atan2(p0.y - p1.y, p0.x - p1.x)
    }
    /*
     * 里程照<strong>路徑的走向</strong>記。被反過來接的那條腿（畫面上要從邊的內部連回
     * 節點）里程是遞減的；記成遞增的話，換算出來的里程會落在區間的另一頭——實測車輛在
     * 路口的里程差到 117 公尺。
     */
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const nodeAtStart = e.from === nodeId
    // 由節點往邊內走時里程遞增（節點在 from）或遞減（節點在 to）；反接的那條再翻一次
    const outward = nodeAtStart ? [lo, hi] : [hi, lo]
    const [sFrom, sTo] = reversed ? [outward[1]!, outward[0]!] : [outward[0]!, outward[1]!]
    return {
      roadId: e.roadId,
      laneId,
      sFromM: sFrom,
      sToM: sTo,
      headingRad: laneId > 0 ? along + Math.PI : along,
      pathFrom: 0,
      pathTo: 1,
    }
  }
  /** 折線長度，用來算路口元件兩條腿各佔整條路徑的幾成 */
  const polyLen = (pts: Vec[]) => {
    let t = 0
    for (let i = 1; i < pts.length; i += 1) t += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
    return t
  }
  /**
   * 路口元件：把兩條腿接成一條路徑，並把兩段各自的路徑範圍標好。
   */
  const joinLegs = (first: Vec[], second: Vec[], spans: TrackSpan[]) => {
    const path = [...first, ...second]
    const lenA = polyLen(first)
    const lenB = polyLen(second)
    /*
     * 兩條腿<strong>接不起來</strong>的那一段也要算長度。
     *
     * 路口裡兩條主線之間隔著連接道，兩條腿的端點在真實座標上差得很遠——實測分岔那裡差
     * 19.8 公尺、另一處差 21.8 公尺。先前算「這條腿佔整條路徑的幾成」時只加兩條腿自己
     * 的長度，那一跳完全沒算進去，於是比例算成 0.9997，實際只佔 0.875：車輛沿著這一塊
     * 換算出來的里程就一路偏，末端差到 17 公尺。
     *
     * 那一跳不屬於任何一條腿（它是連接道的里程，不畫），所以只計入總長、不分給任何一段。
     */
    const a = first[first.length - 1]
    const b = second[0]
    const jump = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
    const total = lenA + jump + lenB
    if (!(total > 1e-6)) return path
    if (spans[0]) {
      spans[0].pathFrom = 0
      spans[0].pathTo = lenA / total
    }
    for (let i = 1; i < spans.length; i += 1) {
      spans[i]!.pathFrom = (lenA + jump) / total
      spans[i]!.pathTo = 1
    }
    return path
  }
  /**
   * 這條邊某一條車道、在這個節點那一截的真實中心線。
   *
   * 取樣密度<strong>照車道中心線自己的</strong>，不要固定切幾段。分岔讓出去的那一截可以
   * 長達整條邊的一半（實測 287 公尺的路讓出 140 公尺），固定七個點等於用 23 公尺一段的
   * 折線去代表一段會彎的路，車輛投影上去的里程差到 17 公尺。中心線本來就是照檔案的取樣
   * 步長存的，直接照它取，誤差就只剩檔案本身的解析度。
   */
  const laneTailAt = (e: GraphEdge, nodeId: string, laneIdx: number): Vec[] => {
    const pts = e.lanes[laneIdx]?.points ?? []
    if (pts.length < 2) return []
    const frac = Math.max(1e-3, trimFracAt(e, nodeId))
    const at = (u: number) => {
      const t = Math.max(0, Math.min(1, u)) * (pts.length - 1)
      const i = Math.min(pts.length - 2, Math.floor(t))
      const r = t - i
      return {
        x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * r,
        y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * r,
      }
    }
    // 由節點往邊的內部走：節點在 from 就是 0→frac，在 to 就是 1→1-frac
    const n = Math.max(2, Math.round(frac * (pts.length - 1)))
    const out: Vec[] = []
    for (let i = 0; i <= n; i += 1) {
      const u = i / n
      out.push(at(e.from === nodeId ? u * frac : 1 - u * frac))
    }
    return out
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
    const r = cornerRadiusAt.get(node.id) ?? cornerR
    if (r <= 0) continue
    const C = { x: N.x - sxDir * r, y: N.y + syDir * r }
    /*
     * 兩隻腳各用<strong>自己那條邊的偏移</strong>，再照「離圓心多遠」配對。
     *
     * 先前只取橫向那條邊的偏移，縱向那頭用一條猜出來的正負號套上去。兩條邊的車道排列
     * 方向本來就可能相反（行車方向不同），束的寬度也可能不一樣，猜出來的位置常常落在
     * 另一條車道上、甚至落到帶子外面——軌道寬愈大差愈多。
     *
     * 照離圓心的距離排序再配，等於「外圈接外圈、內圈接內圈」，弧也自然同心。
     */
    const rank = (offs: number[], base: number, centre: number) =>
      offs
        .map((o, k) => ({ k, o, d: Math.abs(base + o - centre) }))
        .sort((a, b) => a.d - b.d)
    const hs = rank(offsetsOf(eh), N.y, C.y)
    const vs = rank(offsetsOf(ev), N.x, C.x)
    const count = Math.min(hs.length, vs.length)
    for (let k = 0; k < count; k += 1) {
      const h = hs[k]!
      const v = vs[k]!
      const radius = (h.d + v.d) / 2
      // 半徑到帶寬的一半就是內緣貼著圓心，再小才是真的畫不出來
      if (radius < bandW * 0.45) continue
      const p0 = { x: C.x, y: N.y + h.o }
      const p1 = { x: N.x + v.o, y: C.y }
      const fit = fitCornerAt(C, radius + bandW / 2, bandW, p0, p1)
      shapes.push({
        kind: 'corner',
        name: `${eh.lanes[h.k]!.key}~${ev.lanes[v.k]!.key}`,
        role: 'road',
        lineKey: eh.lanes[h.k]!.key,
        lineLengthM: eh.lengthM,
        realLatFromM: 0,
        realLatToM: 0,
        samples: [p0, p1],
        ...(() => {
          const spans = [spanAtNode(eh, node.id, h.k, true), spanAtNode(ev, node.id, v.k)]
          const realPath = joinLegs(
            laneTailAt(eh, node.id, h.k).reverse(),
            laneTailAt(ev, node.id, v.k),
            spans,
          )
          return { realPath, spans }
        })(),
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
   * 一進兩出：梗擺在<strong>開分岔的那一束</strong>上，兩個出口都落在節點。
   *
   * 直行出口就是那一束原本的位置，轉角或下一段直接接上去；岔出出口落在讓開之後的位置，
   * 岔線從那裡開始走。梗那一束已經讓出了同樣的長度，所以不會疊、也不會斷。
   */
  for (const job of switchJobs) {
    const node = byId.get(job.nodeId)
    const stemOther = byId.get(job.stem.from === job.nodeId ? job.stem.to : job.stem.from)
    if (!node || !stemOther) continue
    const p0 = P(node)
    const N = { x: p0.x + endExtra(node, 'v'), y: p0.y + endExtra(node, 'h') }
    const q = P(stemOther)
    const d = Math.hypot(q.x - p0.x, q.y - p0.y) || 1
    const dir = { x: (q.x - p0.x) / d, y: (q.y - p0.y) / d }
    /*
     * 車道要照<strong>版面上的排序</strong>配對，不能照 lane 序號：兩條 road 的行車方向
     * 常常相反，序號的排列方向就跟著翻面，照序號配會讓兩片分岔交叉成一個 X。
     */
    const rank = (list: number[]) => list.map((o, k) => ({ o, k })).sort((a, b) => a.o - b.o)
    /*
     * 三條邊<strong>各自</strong>排一次。
     *
     * 先前只排了直行與岔出兩條，梗那一條卻拿直行的名次去索引自己的車道陣列——那是兩條
     * 不同的 road，車道數與排列方向都不保證一樣，取到的常常是另一條車道，元件認領的
     * 里程就掛在錯的車道上。
     */
    const stemRank = rank(offsetsOf(job.stem))
    const throughRank = rank(offsetsOf(job.through))
    const branchRank = rank(offsetsOf(job.branch))
    const count = Math.min(stemRank.length, throughRank.length, branchRank.length)
    // 出口沿著梗的垂直軸排開
    const perp = (o: number): Vec =>
      job.stem.orient === 'h' ? { x: 0, y: o } : { x: o, y: 0 }
    for (let k = 0; k < count; k += 1) {
      const oMain = throughRank[k]!.o
      const oBranch = branchRank[k]!.o
      const at = (t: number, o: number): Vec => ({
        x: N.x + dir.x * t + perp(o).x,
        y: N.y + dir.y * t + perp(o).y,
      })
      const fit = fitSwitchAt(at(job.runPx, oMain), at(0, oMain), at(0, oBranch), bandW)
      if (!fit) continue
      const laneMain = job.through.lanes[throughRank[k]!.k]!
      const laneBranch = job.branch.lanes[branchRank[k]!.k]!
      shapes.push({
        kind: 'switch',
        name: `${laneBranch.key}^${laneMain.key}`,
        role: 'road',
        lineKey: laneBranch.key,
        lineLengthM: job.branch.lengthM,
        realLatFromM: 0,
        realLatToM: 0,
        samples: [at(job.runPx, oMain), at(0, oBranch)],
        /*
         * 分岔認領三段：梗讓出來的那一截，以及兩個出口各自的起頭。車輛不管走直行還是
         * 岔出，在路口那一小段都查得到這一塊。
         */
        ...(() => {
          const spans = [
            spanAtNode(job.stem, job.nodeId, stemRank[k]!.k, true),
            spanAtNode(job.through, job.nodeId, throughRank[k]!.k),
            spanAtNode(job.branch, job.nodeId, branchRank[k]!.k),
          ]
          const realPath = joinLegs(
            laneTailAt(job.stem, job.nodeId, stemRank[k]!.k).reverse(),
            laneTailAt(job.branch, job.nodeId, branchRank[k]!.k),
            spans,
          )
          return { realPath, spans }
        })(),
        geometry: fit.geometry,
        box: fit.box,
        sFrom: 0,
        sTo: 0,
      })
      note({ x: fit.box.xM, y: fit.box.yM })
      note({ x: fit.box.xM + fit.box.wM, y: fit.box.yM + fit.box.hM })
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
  _count: number,
  f0: number,
  f1: number,
  trim0: number,
  trim1: number,
): Vec[] {
  /*
   * 直接用<strong>那條車道自己的中心線</strong>，不要拿參考線加一個算出來的橫向偏移。
   *
   * 算出來的偏移假設車道等寬、對稱排在參考線兩側；月台那一段兩條軌道被拉開到 4.5 公尺，
   * 算出來的位置就差了一兩公尺——車輛定位時反而被判到對面那條車道去。車道中心線本來就
   * 在檔案裡（建圖時已經裁好帶下來），照它取就是準的。
   */
  const pts = e.lanes[k]?.points ?? []
  const src = pts.length >= 2 ? pts : e.points
  if (src.length < 2) return []
  /*
   * 讓開量是<strong>負</strong>的時候（放不下圓角，帶子往外多伸一截補成直角），那一截
   * 在路網上屬於隔壁那條邊，這條邊的中心線裡沒有它。當成 0，跟里程換算（sAt）用同一
   * 套規則。
   *
   * 先前直接拿負數去算 span，於是 span 大於 1，取樣點跑過中心線的尾端被夾住——尾巴
   * 那幾塊的真實路徑全縮成同一個點。實測 road 10 有 27 公尺（48.9 公尺裡的 34.9→
   * 48.9 與 48.9→62.2）的軌道路徑退化成一點，車輛在那一段的里程差到 47 公尺。
   */
  const span = 1 - Math.max(0, trim0) - Math.max(0, trim1)
  const at = (f: number) => {
    const u = Math.max(0, Math.min(1, Math.max(0, trim0) + f * span)) * (src.length - 1)
    const i = Math.min(src.length - 2, Math.floor(u))
    const t = u - i
    return {
      x: src[i]!.x + (src[i + 1]!.x - src[i]!.x) * t,
      y: src[i]!.y + (src[i + 1]!.y - src[i]!.y) * t,
    }
  }
  /*
   * 取幾個中間點，不要只留頭尾。彎的地方兩點連線會切過弧，車輛投影上去就會偏。
   */
  const out: Vec[] = []
  const n = 4
  for (let i = 0; i <= n; i += 1) out.push(at(f0 + ((f1 - f0) * i) / n))
  return out
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
   * 股距與軌道寬分開：框夠高時等於軌道寬（同一條路的上下行剛好相鄰，那本來就是一組），
   * 框太扁時縮小，平行的帶子略為重疊。不同束之間另外留一股的空隙，那才是「兩條兩條
   * 分開」的地方。整張圖的大小因此不受軌道寬影響。
   */
  /*
   * 股距的上限由<strong>最擠的那個節點</strong>決定，不是拍一個比例。
   *
   * 圖上縱向要塞得下的，是某個節點上所有並排的束加起來有幾條軌道——路口那裡主線、側線、
   * 支線會同時出現。算出那個最大值，框的高度除以它（再留一點邊），就是股距容得下的上限；
   * 框夠高時股距就等於使用者給的軌道寬。
   */
  const bundleOf = (e: GraphEdge) => [e.from, e.to].sort().join('|')
  const stackAt = new Map<string, Map<string, number>>()
  for (const e of graph.edges) {
    for (const nodeId of [e.from, e.to]) {
      const m = stackAt.get(nodeId) ?? new Map<string, number>()
      m.set(bundleOf(e), Math.max(m.get(bundleOf(e)) ?? 0, e.lanes.length))
      stackAt.set(nodeId, m)
    }
  }
  let maxStack = maxLanes
  for (const m of stackAt.values()) {
    let total = 0
    for (const n of m.values()) total += n
    if (total > maxStack) maxStack = total
  }
  const levelPx = Math.max(
    2,
    Math.min(block.trackWidthPx, box.hPx / (maxStack + 2)),
  )

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
