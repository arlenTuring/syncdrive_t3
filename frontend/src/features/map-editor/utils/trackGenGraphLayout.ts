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
import { buildCrossFromEndSegments } from './crossJoin'
import type { GraphEdge, GraphNode, TrackGraph } from './trackGenGraph'

/**
 * 圖 → 版面形狀。
 *
 * 節點各有座標，邊連在節點之間，所以環會閉合、岔出就是節點多一條邊。座標由真實座標
 * 乘兩軸比例尺得到，再逼近幾次鋪滿元件外框。每條邊照車道數畫成幾條平行帶，帶距一股；
 * 兩端各讓出一個轉角半徑，由圓角軌道補上，弧同心。
 */

/**
 * 製圖慣例。
 *
 * 這些數字推不出來——.xodr 描述的是真實世界，不含「示意圖該長什麼樣」。全部相對於軌道寬、
 * 每塊幾公尺或路網自己的統計值，不綁任何一份圖。集中在這裡便於分辨讀出來的與訂出來的。
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
  /**
   * 切段的級距：路真實橫移幾條軌道的寬度才算換一階。
   *
   * 量真實公尺，不量像素。像素會跟著軌道寬變，同一份路網換個寬度就生出不同形狀
   * （寬 26 有斜接、寬 50 整段判成直的）。
   */
  latStepLanes: 2,
  /** 一階在圖上挪幾分之一股：夠看得出來，兩階就頂到與鄰帶的正中間 */
  latStepPitch: 1 / 4,
  /** 兩段的高度差不到一階的幾成就當成同一段 */
  mergeUnit: 0.5,
  /** 切塊剩下的尾巴短過一塊的幾成就併進前一塊——比例是塊自己的事，與軌道寬無關 */
  minTailBlock: 1 / 4,
  /**
   * 一塊至少要有幾條軌道寬那麼長。
   *
   * 比這還短的方塊在圖上不像一段軌道，像兩塊之間裂了一條縫。切剩的殘塊寧可整截
   * 讓給旁邊的斜接，也不要單獨畫出來。
   */
  minBlockBands: 1,
  /** 交叉畫多長：兩條軌道疊起來是高，長取它的幾倍的一半 */
  crossAspect: 3,
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
   * 轉角壓到極限：最內側帶子的內緣半徑收到零，外觀等於直角。
   * 半徑給大了會像整段路都在轉彎。外側帶子同心外推，不然轉彎處會一邊寬一邊窄。
   */
  const maxLanes = Math.max(1, ...graph.edges.map((e) => e.lanes.length))
  const cornerR = (levelPx * (maxLanes - 1) + bandW) / 2

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const incident = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    for (const id of [e.from, e.to]) {
      const arr = incident.get(id) ?? []
      arr.push(e)
      incident.set(id, arr)
    }
  }

  /*
   * 要轉彎的那一段先撐開到放得下轉角。
   *
   * 正交化之後短邊可能只剩幾像素（road 10 縱向只差 7 像素，直角卻要 18.8），轉角接不
   * 起來，車輛開過去位置跳 53 公尺。撐開量取束的半寬；外層仍會照外框重算比例尺。
   */
  const spacedOn = (axis: 'x' | 'y'): ((n: GraphNode) => number) => {
    const key = (n: GraphNode) => (axis === 'x' ? n.x : n.y)
    const scale = axis === 'x' ? sx : sy
    const wantOrient: 'h' | 'v' = axis === 'x' ? 'h' : 'v'
    // 版面上的欄與列：同一欄的節點座標已經被正交化壓成同一個值
    const vals = [...new Set(graph.nodes.map(key))].sort((a, b) => a - b)
    const at = new Map(vals.map((v, i) => [v, i]))
    const need = new Array(Math.max(0, vals.length - 1)).fill(0) as number[]
    /** 這個節點上有沒有要轉彎（同時接著橫的與縱的） */
    const bends = (id: string) => {
      const list = incident.get(id) ?? []
      return list.some((x) => x.orient === 'h') && list.some((x) => x.orient === 'v')
    }
    /*
     * 兩隻腳各讓出一個半徑，所以長度要兩倍半徑再多一點。
     * 短過這個，圓角被夾到畫不出來，退回直角就開縫（cornerRadiusAt 用同一個夾法）。
     */
    const want = (cornerR * 2 + 2) / Math.max(1e-6, scale)
    for (const e of graph.edges) {
      if (e.orient !== wantOrient) continue
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      if (!a || !b) continue
      if (!bends(a.id) && !bends(b.id)) continue
      const ia = at.get(key(a))
      const ib = at.get(key(b))
      if (ia === undefined || ib === undefined) continue
      // 只撐相鄰的那一格：中間隔著別的欄時，該撐的是那一格，不是這一段
      if (Math.abs(ia - ib) !== 1) continue
      const lo = Math.min(ia, ib)
      const room = vals[lo + 1]! - vals[lo]!
      if (room >= want) continue
      need[lo] = Math.max(need[lo]!, want - room)
    }
    const shiftOf = new Map<number, number>()
    let acc = 0
    vals.forEach((v, i) => {
      if (i > 0) acc += need[i - 1]!
      shiftOf.set(v, acc)
    })
    return (n: GraphNode) => key(n) + (shiftOf.get(key(n)) ?? 0)
  }
  const laidX = spacedOn('x')
  const laidY = spacedOn('y')

  const realX0 = Math.min(...graph.nodes.map(laidX))
  const realY1 = Math.max(...graph.nodes.map(laidY))
  // 真實座標 y 向上、版面 y 向下
  const P = (n: GraphNode): Vec => ({
    x: (laidX(n) - realX0) * sx,
    y: (realY1 - laidY(n)) * sy,
  })

  const shapes: LayoutShape[] = []
  const pts: Vec[] = []
  const note = (p: Vec) => pts.push(p)

  /*
   * 同一對節點之間的平行邊要疊起來排，不能各自置中。
   * 各自置中會兩條都落在偏移 0、完全重疊（T3 的 road 1 與 3）。同一對節點之間算一束。
   */
  /*
   * 橫向偏移用世界座標的軸：橫邊沿版面 y、縱邊沿版面 x，正負由真實座標決定。
   *
   * 用邊自己的左法線會跟著行車方向翻面，反向的平行邊順序相反（4#0 真實在主線下方
   * 11.6 公尺，畫出來卻在上面）。
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
   * 岔出去的那一束要讓開：同一節點兩束同向會落在同一排、互相重疊。
   * 長的留原位，短的外挪一整束寬，中間用分岔軌道接起來。
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
   * 岔出去的那一束往哪一邊讓：從共用節點出發，兩條邊各走同樣里程，比那一點的位置。
   *
   * 比整條的平均位置會被遠處的彎帶偏，側線真實在主線上方卻被畫到下方。
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
   * 一個節點只畫一組轉角，取兩邊都走得遠的那一對——那才是主線在這裡轉彎。
   *
   * 每一對 h/v 都畫的話，三岔路口會疊出兩組圓角、互相蓋掉 14400 平方像素。
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
   * 分岔的位置讀 .xodr 的連接道配對（movements）：一條 road 在同一節點接得到兩束以上
   * 就是分岔，最長的那束直行，其餘讓開。
   *
   * 從幾何回推會漏掉兩腿一南一北的道岔，而且每種新形狀都要再補一條規則。
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


  /*
   * 交叉也要讓位：兩側各讓出交叉的一半長度，讓出去的里程由交叉認領。
   *
   * 兩側各算各的——短的那側讓得出多少算多少（扣掉另一頭讓給分岔的），長的照想要的長度。
   * 不讓位的話交叉會壓在斜接上，另一側則切剩一條 23 像素的縫。
   */
  type CrossPlan = {
    nodeId: string
    groups: [GraphEdge[], GraphEdge[]]
    halves: [number, number]
  }
  const crossPlans: CrossPlan[] = []
  for (const cross of graph.crossings ?? []) {
    const around = incident.get(cross.nodeId) ?? []
    const sides = new Map<string, GraphEdge[]>()
    for (const e of around) {
      const arr = sides.get(bundleKey(e)) ?? []
      arr.push(e)
      sides.set(bundleKey(e), arr)
    }
    if (sides.size !== 2) continue
    const [gA, gB] = [...sides.values()] as [GraphEdge[], GraphEdge[]]
    if (gA.flatMap((e) => e.lanes).length !== 2) continue
    if (gB.flatMap((e) => e.lanes).length !== 2) continue
    const want = bandW * DRAWING.crossAspect
    const halfOf = (group: GraphEdge[]) => {
      const e = group[0]!
      const full = spanOf(e)
      if (!Number.isFinite(full)) return want
      const far = e.from === cross.nodeId ? e.to : e.from
      const taken = Math.max(0, switchTrim.get(`${e.id}|${far}`) ?? 0)
      return Math.max(bandW * 0.5, Math.min(want, Math.max(1, full - taken - 1)))
    }
    const halves: [number, number] = [halfOf(gA), halfOf(gB)]
    for (const e of gA) {
      const key = `${e.id}|${cross.nodeId}`
      if ((switchTrim.get(key) ?? 0) < halves[0]) switchTrim.set(key, halves[0])
    }
    for (const e of gB) {
      const key = `${e.id}|${cross.nodeId}`
      if ((switchTrim.get(key) ?? 0) < halves[1]) switchTrim.set(key, halves[1])
    }
    crossPlans.push({ nodeId: cross.nodeId, groups: [gA, gB], halves })
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
   * 兩條軌道拉開的那一段要畫出來，中間那塊空地就是月台。
   *
   * 位置與長度是讀出來的：OpenDRIVE 寫著兩條行車道之間那幾條非行車道的寬度（分隔島、
   * 月台、標線）。併在一起時只有幾公分，夾進月台時長到幾公尺。road 的參考線看不出來。
   */
  /** 這份檔案的車道寬（公尺）：取中位數，不寫死 */
  const laneWidthM = (() => {
    const w = graph.edges.flatMap((e) => e.lanes.map((l) => l.widthM)).filter((x) => x > 0.01)
    if (!w.length) return LANE_W_M
    w.sort((a, b) => a - b)
    return w[Math.floor(w.length / 2)]!
  })()
  /**
   * 兩條並排軌道的中心線實際隔多遠（公尺），取中位數。
   *
   * 不能用車道寬代替：中心距還要加上中間的分隔。這份檔案車道寬 3.35、中心距 3.5，
   * 差的 0.15 公尺在圖上是 1.2 像素的系統性偏差。
   */
  const laneGapM = (() => {
    const gaps: number[] = []
    for (const e of graph.edges) {
      for (let k = 0; k + 1 < e.lanes.length; k += 1) {
        const a = e.lanes[k]?.points ?? []
        const b = e.lanes[k + 1]?.points ?? []
        if (a.length < 2 || b.length < 2) continue
        for (const f of [0.25, 0.5, 0.75]) {
          const pa = a[Math.round(f * (a.length - 1))]!
          const pb = b[Math.round(f * (b.length - 1))]!
          const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
          if (d > 0.01) gaps.push(d)
        }
      }
    }
    if (!gaps.length) return laneWidthM
    gaps.sort((a, b) => a - b)
    return gaps[Math.floor(gaps.length / 2)]!
  })()
  /**
   * 節點在它那一排裡的股位。
   *
   * 正交化把同一排的節點壓成同一個值（上排四個節點真實 y 是 +4.2/−4.0/−11.8/−14.3，
   * 全壓成 −7.5）。若改量「離兩端連線多遠」，量到的是那條連線在斜，畫出來形狀相反。
   * 一個節點只有一個股位，交會的邊自動對得起來。
   */
  const axisScale = (orient: 'h' | 'v') => (orient === 'h' ? sy : sx)
  /**
   * 節點離它那一排多遠，換算成版面像素。照版面比例直接換算，不量化成股。
   *
   * 股距量的是兩條並行軌道之間，拿它量路自己的高低差會放大十倍：road 1/3 兩端真實差
   * 7 公尺，量化成股是 120 像素，照版面比例只有 13。
   */
  /*
   * 節點不帶股位，每條帶子畫在自己那一排／欄上。
   *
   * 帶過股位的話，同一段兩端常算出不同高度，就得切一刀補斜接——寬 34 時 16 段斜接有
   * 8 段是這樣來的，而且會被「上限半股」夾住，寬度動一格就換元件。半條軌道以內的落差
   * 讀不出來，不值得用一段斜接表達。路自己沿線的橫移仍由 levelRuns 畫出來。
   */
  /**
   * 一股換算成版面偏移的方向：橫邊沿版面 y（真實 y 越大越上面，反號）、縱邊沿版面 x（同號）。
   * 不能用 laneSign，那會跟著行車方向翻面。
   */
  const axisSign = (orient: 'h' | 'v') => (orient === 'h' ? -1 : 1)

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
   * 拉開的判準：兩條行車道之間夾得下半條車道。
   * 讀檔案寫的內側間隔（併在一起 0.15 公尺，夾進月台 2.3 與 4.5），不量兩條線的距離。
   */
  const spreadAt = (e: GraphEdge, f: number): number =>
    innerGapAt(e, f) >= laneWidthM * 0.5 ? 1 : 0

  /*
   * 每個節點自己的轉角半徑：夾在兩隻腳各自的一半以內，讓與畫用同一個值。
   * 不夾的話短邊讓不出那麼多（road 10 那個 20 公尺的轉折，寬 70 時接縫差 59 像素）。
   */
  const cornerRadiusAt = new Map<string, number>()
  for (const [nodeId, pair] of cornerPair) {
    const r = Math.min(cornerR, spanOf(pair.h) * 0.5 - 1, spanOf(pair.v) * 0.5 - 1)
    /*
     * 放不下就整組不畫圓角，讓兩條帶子交成直角。
     * 只跳過畫不出來的那一條，會變成同一個角有的車道有圓角、有的沒有，缺的那條開口。
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
   * 邊在節點端讓出的長度；負值代表往外多伸一截。
   *
   * 放不下轉角時兩條帶子之間會留一個 L 形的洞，大小是另一束的半寬（寬 70 時破 68 像素）。
   * 各自往對方多伸那一截就補實了。
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
  /**
   * 真正讓出去的長度（版面像素），切塊與認領里程共用這一個。
   * 兩邊各算各的話，轉角認領的里程與直段讓出來的會差一截（road 10 差 2.2 公尺 = 一個洞）。
   */
  const trimPxAt = (e: GraphEdge, nodeId: string, fullLen: number) => {
    const ends = edgeEnds(e, byId)
    if (!ends) return 0
    const raw = trimAt(e, nodeId, fullLen)
    // 負的（補直角多伸的那一截）不必再挪，它本來就不是里程
    if (raw <= 0) return raw
    return Math.max(0, raw)
  }

  /**
   * 流水號跨邊連號。名字是這些塊唯一的身分。
   * 每條邊各自從 1 開始的話，被轉角切成兩段的同一條軌道會生出兩塊 11:-2-01。
   */
  const seqOf = new Map<string, number>()
  const nextSeq = (key: string) => {
    const n = (seqOf.get(key) ?? 0) + 1
    seqOf.set(key, n)
    return n
  }

  /** 每條邊、每個節點、每條車道：帶子在那一端實際畫到的位置 */
  const bandEnd = new Map<string, Vec>()

  for (const e of graph.edges) {
    const ends = edgeEnds(e, byId)
    if (!ends) continue
    const A = P(ends.a)
    const B = P(ends.b)
    const full = Math.hypot(B.x - A.x, B.y - A.y)
    if (full < 2) continue
    const ux = (B.x - A.x) / full
    const uy = (B.y - A.y) / full
    // 讓出去多少見 trimPxAt：轉角／分岔認領里程時用的是同一個值
    const t0 = trimPxAt(e, e.from, full)
    const t1 = trimPxAt(e, e.to, full)
    let len = full - t0 - t1
    if (len < 2) continue
    let S = { x: A.x + ux * t0, y: A.y + uy * t0 }

    /*
     * 支線讓給分岔多少，就從死路那一頭補回來，整條長度不變。
     *
     * 死路端沒有東西要接，位置不帶資訊。不補的話 59 公尺的側線讓完只剩一半。
     * 下限是一束寬，短過這個就不像軌道、像一塊方形。
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

    const offs = offsetsOf(e)
    const ax = perpAxis(e)
    /*
     * 一條路自己的橫移：量這一點的真實側位離「這一排的線」多遠。
     * 量「離兩端連線多遠」的話，兩端不等高時那條線是斜的，畫出來形狀相反。
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
     * 切段的級距：真實世界的公尺。橫移超過兩條軌道寬就算換一階。
     * 不看軌道寬——拿它當尺的話寬 26 生得出 S、寬 50 判成直的。
     */
    const segUnitM = LANE_W_M * DRAWING.latStepLanes
    /** 一階在圖上挪多少（版面像素），最多挪到與鄰帶的正中間 */
    const latStepPx = levelPx * DRAWING.latStepPitch
    const levelAt = (f: number): number =>
      Math.max(-8, Math.min(8, Math.round(latDevAt(f) / segUnitM)))
    /**
     * 一段換階至少一整塊。用「一段坡要走多長」當門檻的話，門檻會跟著軌道寬走，
     * 寬 60 併掉的段寬 50 又留著。坡放不放得下由 rampMaxSpan 與 rampMinRun 管。
     */
    const minShiftM = perBlockM
    /** 沿線切成幾段「同一階」的區間；<code>pinned</code> 是為了接上節點才補的端頭 */
    const levelRuns: Array<{
      f0: number
      f1: number
      level: number
      offsetPx: number
      pinned?: boolean
    }> = []
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
     * 每一段畫在它那一階上：階數乘一階的高度，不照那一段的平均側位。
     * 平均會跟著版面比例尺走，比例尺又跟著軌道寬走，同一段路換個寬度就畫在不同高度。
     */
    for (const r of levelRuns) {
      r.offsetPx = Math.max(
        -capPx,
        Math.min(capPx, axisSign(e.orient) * r.level * latStepPx),
      )
    }
    /*
     * 兩端要停在節點的股位上，作法是在端點補一小截，不是把整條壓下去。
     *
     * 壓整條的話，段數少時「頭尾兩段」就是整條路——road 8 中段偏出 14 公尺會被壓成直線。
     * 端頭那一截只要放得下一段坡；它的界線貼著節點，不往路中間找最陡點（那裡的落差是
     * 正交化造成的）。
     */
    const endStubF = Math.min(0.25, minShiftM / Math.max(1, usedM))
    const pinEnd = (head: boolean) => {
      const r = levelRuns[head ? 0 : levelRuns.length - 1]!
      if (r.level === 0) return
      const cut = Math.min((r.f1 - r.f0) * 0.5, endStubF)
      if (cut <= 1e-6) return
      if (head) {
        r.f0 += cut
        levelRuns.unshift({ f0: r.f0 - cut, f1: r.f0, level: 0, offsetPx: 0, pinned: true })
      } else {
        r.f1 -= cut
        levelRuns.push({ f0: r.f1, f1: r.f1 + cut, level: 0, offsetPx: 0, pinned: true })
      }
    }
    pinEnd(false)
    pinEnd(true)
    /*
     * 併掉高度差看不出來的段界——但<strong>最後一段不能併</strong>：它帶著尾端節點的
     * 股位，併掉就等於把那個股位丟了。頭那一段併進來時保留的是它自己的股位，沒問題。
     */
    for (let i = levelRuns.length - 1; i > 0; i -= 1) {
      if (i === levelRuns.length - 1) continue
      if (Math.abs(levelRuns[i]!.offsetPx - levelRuns[i - 1]!.offsetPx) < latStepPx * DRAWING.mergeUnit) {
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
        // 端頭那一截是為了接節點才補的，界線要貼著節點，不往路中間找
        if (a.pinned || b.pinned) continue
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
      // 門檻用塊，不用股距：股距跟著軌道寬走，形狀就會跟著粗細變（同 minShiftM）
      const minSpreadF = Math.min(0.4, minShiftM / Math.max(1, usedM))
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
       * 拉開的那一束若在節點還要接下去，得先收回來，不然接到下一束會憑空差一股。
       * 開放端不收——那裡沒有別束要接，月台就在那裡。
       */
      const continues = (nodeId: string) =>
        (incident.get(nodeId) ?? []).some((other) => bundleKey(other) !== bundleKey(e))
      const tailF = Math.min(0.35, minShiftM / Math.max(1, usedM))
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

    /**
     * 這一段的橫向比例尺：圖上與隔壁那條軌道差多遠，除以真實世界差多遠。
     *
     * 全圖一個定值不夠：月台那段真實拉開到 8 公尺，圖上只讓開固定的半條軌道，用定值
     * 換算車子會偏掉三分之一條軌道寬。只有一條車道的邊沒有隔壁可比，退回定值。
     */
    const latScaleAt = (k: number, f: number): number => {
      const kk = k === 0 ? 1 : k - 1
      const near = e.lanes[kk]
      if (!near) return levelPx / laneGapM
      const extraOf = (i: number) => {
        const oi = offs[i]!
        const sideI = Math.sign(oi - (shift.get(e.id) ?? 0)) || 1
        return oi + pick(levelRuns, f).offsetPx + pick(spreadRuns, f).spread * (levelPx / 2) * sideI
      }
      const drawn = Math.abs(extraOf(k) - extraOf(kk))
      const ptOf = (i: number) => {
        const pts = e.lanes[i]?.points ?? []
        if (pts.length < 2) return null
        const u = Math.max(0, Math.min(1, f)) * (pts.length - 1)
        const j = Math.min(pts.length - 2, Math.floor(u))
        const t = u - j
        return {
          x: pts[j]!.x + (pts[j + 1]!.x - pts[j]!.x) * t,
          y: pts[j]!.y + (pts[j + 1]!.y - pts[j]!.y) * t,
        }
      }
      const a = ptOf(k)
      const b = ptOf(kk)
      if (!a || !b) return levelPx / laneGapM
      const real = Math.hypot(a.x - b.x, a.y - b.y)
      if (!(real > 0.05) || !(drawn > 0.05)) return levelPx / laneGapM
      return drawn / real
    }

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
       * 中間夾著的短段併掉：兩側各要一段斜接，擠在幾像素裡會變成近乎垂直的碎片
       * （6 像素寬、90 像素高）。頭尾不動，它們接的是節點。
       */
      for (let i = runs.length - 2; i > 0; i -= 1) {
        const r = runs[i]!
        // 門檻拿塊來量，不拿股距：股距跟著軌道寬走，併不併得掉就會跟著粗細變
        if ((r.f1 - r.f0) * usedM >= perBlockM * DRAWING.minTailBlock) continue
        runs[i - 1]!.f1 = r.f1
        runs.splice(i, 1)
      }

      /*
       * 兩段之間的斜接佔掉的半寬。坡照 1:3，但不能吃掉比相鄰兩段還長的距離
       * （收尾那段可能只剩 4%）。放不下就讓它陡一點，總比畫到邊外去好。
       */
      /*
       * 斜接要多寬，以及兩邊各讓出多少。
       *
       * 寬度：坡照 1:3，但至少一整塊——只挪幾像素的地方照 1:3 算出來像一條縫，不像換股。
       * 讓法：一邊出不起、對面就補上。各讓一半的話，頭尾那兩段常常很短，整片斜接會被
       * 壓成 18.8 × 18.8 的 45 度小方塊。接節點那一端沒有別片要讓，可以整段讓出去。
       */
      const oneBlockW = perBlockM / Math.max(1e-6, usedM)
      const shareOf = (i: number): number => {
        const r = runs[i]
        if (!r) return 0
        const span = r.f1 - r.f0
        const terminal = i === 0 || i === runs.length - 1
        return terminal ? span : span / 2
      }
      const cutsAt = (i: number): { left: number; right: number } => {
        const a = runs[i]
        const b = runs[i + 1]
        if (!a || !b) return { left: 0, right: 0 }
        const step = Math.abs(b.extra - a.extra)
        const wantW = Math.max(rampPx(b.extra - a.extra) / len, oneBlockW)
        const la = shareOf(i)
        const rb = shareOf(i + 1)
        let left = Math.min(la, wantW / 2)
        let right = Math.min(rb, wantW - left)
        left = Math.min(la, wantW - right)
        // 兩邊加起來還是擠不出 1:1 就讓它陡一點——垂直的一刀不像軌道，但畫到邊外更糟
        const floorW = Math.min(1, (step * DRAWING.rampMinRun) / len)
        const short = floorW - (left + right)
        if (short > 0) {
          left += short / 2
          right += short / 2
        }
        return { left, right }
      }
      /*
       * 記下帶子實際畫到哪，轉角照這個位置接。
       * 照節點的名目股位畫會錯開（road 10 的兩個圓角與縱向帶子各差 3.7 像素）。
       */
      bandEnd.set(`${e.id}|${e.from}|${k}`, at(0, runs[0]!.extra))
      bandEnd.set(`${e.id}|${e.to}|${k}`, at(1, runs[runs.length - 1]!.extra))

      /*
       * 斜接切完剩不到一條軌道寬的殘塊，整截讓給旁邊的斜接。
       *
       * 不讓的話圖上是幾條縫（1200 像素寬的容器裡有八塊比自己還窄，最短 9.7 像素）。
       * 斜接本來就認領那一截的里程，讓過去覆蓋照樣連續。兩側都沒有斜接的不動。
       */
      const cuts2 = runs.map((_, i) => cutsAt(i))
      const minPieceF = (bandW * DRAWING.minBlockBands) / Math.max(1, len)
      runs.forEach((run, i) => {
        const left = i > 0 ? cuts2[i - 1]!.right : 0
        const right = cuts2[i]?.left ?? 0
        const piece = run.f1 - right - (run.f0 + left)
        if (piece <= 0 || piece >= minPieceF) return
        // 有右邊的斜接就讓給它，否則讓給左邊那一片
        if (cuts2[i] && i + 1 < runs.length) cuts2[i]!.left = right + piece
        else if (i > 0) cuts2[i - 1]!.right = left + piece
      })


      runs.forEach((run, ri) => {
        const extra = run.extra
        const next = runs[ri + 1]
        const cut0 = ri > 0 ? cuts2[ri - 1]!.right : 0
        const cut1 = cuts2[ri]?.left ?? 0
        const g0 = run.f0 + cut0
        const g1 = run.f1 - cut1
        if (g1 - g0 > 0.01) {
          const runM = usedM * (g1 - g0)
          const parts = Math.max(1, blocksInSpan(runM, perBlockM, perBlockM * DRAWING.minTailBlock))
          for (let i = 0; i < parts; i += 1) {
            const f0 = g0 + ((g1 - g0) * i) / parts
            const f1 = g0 + ((g1 - g0) * (i + 1)) / parts
            const p0 = at(f0, extra)
            const p1 = at(f1, extra)
            const centre = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
            const lengthM = Math.hypot(p1.x - p0.x, p1.y - p0.y)
            shapes.push({
              kind: 'rect',
              name: `${lane.key}-${String(nextSeq(lane.key)).padStart(2, '0')}`,
              role: 'road',
              lineKey: lane.key,
              lineLengthM: e.lengthM,
              latScalePerM: latScaleAt(k, (f0 + f1) / 2),
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
        const cut = cuts2[ri]!
        const a0 = at(run.f1 - cut.left, extra)
        const a1 = at(run.f1 + cut.right, nextExtra)
        const alongDeg = (Math.atan2(uy, ux) * 180) / Math.PI
        const fit = fitTaperAt(a0, a1, bandW, alongDeg)
        shapes.push({
          kind: 'taper',
          name: `${lane.key}X-${String(nextSeq(`${lane.key}X`)).padStart(2, '0')}`,
          role: 'road',
          lineKey: lane.key,
          lineLengthM: e.lengthM,
          latScalePerM: latScaleAt(k, run.f1),
          realLatFromM: 0,
          realLatToM: 0,
          samples: [a0, a1],
          realPath: realSlice(
            e,
            k,
            e.lanes.length,
            run.f1 - cut.left,
            run.f1 + cut.right,
            t0 / full,
            t1 / full,
          ),
          spans: [spanOfLane(k, run.f1 - cut.left, run.f1 + cut.right)],
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
  /**
   * 這條邊在這個節點那一端讓出去的比例。
   *
   * 直接由 trimPxAt 換算，跟切塊時用的是<strong>同一個 t</strong>。兩端加起來超過整段
   * 時按比例收回去——不然轉角認領的里程會跟直段重疊。
   */
  const trimFracAt = (e: GraphEdge, nodeId: string) => {
    const full = spanOf(e)
    if (!Number.isFinite(full) || full <= 0) return 0
    const a = Math.max(0, trimPxAt(e, e.from, full)) / full
    const b = Math.max(0, trimPxAt(e, e.to, full)) / full
    const sum = a + b
    const k = sum > 1 ? 1 / sum : 1
    return (e.from === nodeId ? a : b) * k
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
     * 兩條腿之間跳空的那一段也要算進總長，但不分給任何一段（那是連接道的里程，不畫）。
     * 不算的話比例會算成 0.9997、實際只佔 0.875，末端里程差到 17 公尺。
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
   * 這條邊某一條車道、在這個節點那一截的真實中心線。取樣密度照中心線自己的。
   *
   * 固定切幾段不行：分岔讓出去的可以長達整條邊的一半（287 公尺的路讓出 140），
   * 七個點等於用 23 公尺一段的折線代表會彎的路，里程差到 17 公尺。
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
      return { x: p.x, y: p.y }
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
     * 兩隻腳各用自己那條邊的偏移，再照離圓心的距離配對——外圈接外圈、內圈接內圈，弧同心。
     * 用一邊的偏移套到另一邊會落到別條車道甚至帶子外，軌道寬愈大差愈多。
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
      /*
       * 兩隻腳接在帶子實際畫到的地方，接縫必然為零。沒有回報的才退回名目股位。
       */
      const hEnd = bandEnd.get(`${eh.id}|${node.id}|${h.k}`)
      const vEnd = bandEnd.get(`${ev.id}|${node.id}|${v.k}`)
      // 橫的那條給的是「這一排的高度」，縱的那條給的是「這一欄的位置」；圓心由兩者交會
      const rowY = hEnd ? hEnd.y : N.y + h.o
      const colX = vEnd ? vEnd.x : N.x + v.o
      const armX = hEnd ? hEnd.x : C.x
      const armY = vEnd ? vEnd.y : C.y
      const CC = { x: armX, y: armY }
      /*
       * 兩隻腳各自的半徑：縱的那隻量到橫向帶子的那一排，橫的那隻量到縱向帶子的那一欄。
       * 兩者不一定相等——節點在沿線方向上有自己的偏移——所以轉角畫成橢圓，端面才落在
       * 帶子上（見 fitCornerAt）。
       */
      const rA = Math.abs(rowY - CC.y)
      const rB = Math.abs(colX - CC.x)
      const radius = Math.min(rA, rB)
      // 半徑到帶寬的一半就是內緣貼著圓心，再小才是真的畫不出來
      if (radius < bandW * 0.45) continue
      const p0 = { x: CC.x, y: rowY }
      const p1 = { x: colX, y: CC.y }
      const fit = fitCornerAt(CC, rB + bandW / 2, rA + bandW / 2, bandW, p0, p1)
      /*
       * 圖面中心線要照<strong>弧</strong>取，不能只留兩個端點。
       *
       * 車輛的位置是「在真實路徑上走了幾成，就在圖面路徑上走幾成」。圖面只留兩個端點
       * 的話那是一條弦，車子會從弧的一端直接切到另一端——實測在轉角裡一步跳 7.9 公尺。
       */
      const arc = (() => {
        const a0 = Math.atan2(p0.y - CC.y, p0.x - CC.x)
        const a1raw = Math.atan2(p1.y - CC.y, p1.x - CC.x)
        let da = a1raw - a0
        while (da > Math.PI) da -= 2 * Math.PI
        while (da < -Math.PI) da += 2 * Math.PI
        const n = 8
        const out: Vec[] = []
        for (let i = 0; i <= n; i += 1) {
          const t = i / n
          const ang = a0 + da * t
          // 兩端的半徑不一定完全相同，照比例補間，端點才會落在原本的位置
          const rr = rA + (rB - rA) * t
          out.push({ x: CC.x + Math.cos(ang) * rr, y: CC.y + Math.sin(ang) * rr })
        }
        return out
      })()
      shapes.push({
        kind: 'corner',
        name: `${eh.lanes[h.k]!.key}~${ev.lanes[v.k]!.key}`,
        role: 'road',
        lineKey: eh.lanes[h.k]!.key,
        lineLengthM: eh.lengthM,
        realLatFromM: 0,
        realLatToM: 0,
        samples: arc,
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
  /*
   * 交叉路口 → 交叉軌道。
   *
   * 兩個條件都要：連接道在中途互相交叉（見 NodeCrossing），且節點上剛好兩束、每束兩條
   * ——交叉軌道只有四個口。三束以上那裡還有分岔，照原本的分岔畫。
   */
  for (const plan of crossPlans) {
    const node = byId.get(plan.nodeId)
    if (!node) continue
    const [groupA, groupB] = plan.groups
    const sideA = groupA[0]!
    const sideB = groupB[0]!
    /*
     * 四個口的側位：一側的兩條軌道可能分屬兩條 road（T3 那個路口右邊就是 road 1 與
     * road 3 兩條單線併成一束），所以要把整束的車道攤平再照側位排序。
     */
    const lanesOf = (group: GraphEdge[]) =>
      group
        .flatMap((e) => offsetsOf(e).map((o, k) => ({ o, e, k })))
        .sort((x, y) => x.o - y.o)
    const lanesA = lanesOf(groupA)
    const lanesB = lanesOf(groupB)
    if (lanesA.length !== 2 || lanesB.length !== 2) continue

    const N = P(node)
    const dirTo = (e: GraphEdge) => {
      const other = byId.get(e.from === plan.nodeId ? e.to : e.from)
      if (!other) return null
      const q = P(other)
      const d = Math.hypot(q.x - N.x, q.y - N.y) || 1
      return { x: (q.x - N.x) / d, y: (q.y - N.y) / d }
    }
    const dA = dirTo(sideA)
    const dB = dirTo(sideB)
    if (!dA || !dB) continue

    const perp = (e: GraphEdge, o: number): Vec =>
      e.orient === 'h' ? { x: 0, y: o } : { x: o, y: 0 }
    const face = (e: GraphEdge, d: Vec, o: number, half: number): [Vec, Vec] => {
      const c = {
        x: N.x + d.x * half + perp(e, o).x,
        y: N.y + d.y * half + perp(e, o).y,
      }
      // 端面跨過軌道，所以沿著垂直於行進方向的那一軸展開
      const w = e.orient === 'h' ? { x: 0, y: bandW / 2 } : { x: bandW / 2, y: 0 }
      return [
        { x: c.x - w.x, y: c.y - w.y },
        { x: c.x + w.x, y: c.y + w.y },
      ]
    }
    /*
     * 「左」「右」只是四個角的名字，但<strong>順序不能反</strong>：交叉軌道要求左邊
     * 那兩個口在右邊兩個的同一側，反了就變成自交，接合器會直接回絕。所以照兩側在
     * 行進軸上的位置決定誰是左。
     */
    const alongOf = (v: Vec) => (sideA.orient === 'h' ? v.x : v.y)
    const fA = lanesA.map((l) => face(l.e, dA, l.o, plan.halves[0]))
    const fB = lanesB.map((l) => face(l.e, dB, l.o, plan.halves[1]))
    const aFirst = alongOf(fA[0]![0]) <= alongOf(fB[0]![0])
    const left = aFirst ? fA : fB
    const right = aFirst ? fB : fA
    const built = buildCrossFromEndSegments({
      lt: left[0]!,
      lb: left[1]!,
      rt: right[0]!,
      rb: right[1]!,
    })
    if (!built) continue
    const centre = {
      x: built.box.x + built.box.w / 2,
      y: built.box.y + built.box.h / 2,
    }
    /*
     * 認領四個口讓出來的里程。圖面路徑取其中一條直行，另一條的里程對到同一段比例上
     * ——兩條平行，離中心線多遠由偏移量另外帶（trackGenLatPerBox），畫出來仍在自己那條上。
     */
    const a0 = lanesA[0]!
    const a1 = lanesA[1]!
    const b0 = lanesB[0]!
    const b1 = lanesB[1]!
    const spans = [
      spanAtNode(a0.e, plan.nodeId, a0.k, true),
      spanAtNode(a1.e, plan.nodeId, a1.k, true),
      spanAtNode(b0.e, plan.nodeId, b0.k),
      spanAtNode(b1.e, plan.nodeId, b1.k),
    ]
    const realPath = joinLegs(
      laneTailAt(a0.e, plan.nodeId, a0.k).reverse(),
      laneTailAt(b0.e, plan.nodeId, b0.k),
      spans,
    )
    // joinLegs 只認得「第一段在第一條腿、其餘在第二條腿」，這裡是兩條腿各兩段
    if (spans[0] && spans[1]) {
      spans[1].pathFrom = spans[0].pathFrom
      spans[1].pathTo = spans[0].pathTo
    }
    if (spans[2] && spans[3]) {
      spans[3].pathFrom = spans[2].pathFrom
      spans[3].pathTo = spans[2].pathTo
    }
    shapes.push({
      kind: 'cross',
      name: `${a0.e.lanes[a0.k]?.key ?? sideA.roadId}x${b0.e.lanes[b0.k]?.key ?? sideB.roadId}`,
      role: 'road',
      lineKey: a0.e.lanes[a0.k]?.key ?? sideA.roadId,
      lineLengthM: a0.e.lengthM,
      realLatFromM: 0,
      realLatToM: 0,
      samples: [
        { x: built.box.x, y: centre.y },
        { x: built.box.x + built.box.w, y: centre.y },
      ],
      realPath,
      spans,
      geometry: built.geometry,
      box: { xM: built.box.x, yM: built.box.y, wM: built.box.w, hM: built.box.h },
      sFrom: 0,
      sTo: 0,
    })
    note({ x: built.box.x, y: built.box.y })
    note({ x: built.box.x + built.box.w, y: built.box.y + built.box.h })
  }

  for (const job of switchJobs) {
    const node = byId.get(job.nodeId)
    const stemOther = byId.get(job.stem.from === job.nodeId ? job.stem.to : job.stem.from)
    if (!node || !stemOther) continue
    const p0 = P(node)
    const N = { x: p0.x, y: p0.y }
    const q = P(stemOther)
    const d = Math.hypot(q.x - p0.x, q.y - p0.y) || 1
    const dir = { x: (q.x - p0.x) / d, y: (q.y - p0.y) / d }
    /*
     * 車道要照<strong>版面上的排序</strong>配對，不能照 lane 序號：兩條 road 的行車方向
     * 常常相反，序號的排列方向就跟著翻面，照序號配會讓兩片分岔交叉成一個 X。
     */
    const rank = (list: number[]) => list.map((o, k) => ({ o, k })).sort((a, b) => a.o - b.o)
    /*
     * 三條邊各自排一次。共用名次的話會索引到另一條 road 的車道，里程掛在錯的車道上。
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
    /*
     * 橫向比例尺：圖上兩條並排軌道的距離（levelPx）除以真實中心距。是個定值。
     *
     * 車子離中心線多遠就照這個倍率畫多遠，不壓回線上。也因此「挑哪一條當參考」不要緊：
     * 隔壁那條的中心線與偏移量各差一個中心距，乘同一個倍率之後畫出來是同一個點。
     */
    latScalePerM: levelPx / laneGapM,
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
   * 用那條車道自己的中心線，不拿參考線加算出來的橫向偏移。
   * 算出來的偏移假設車道等寬對稱；月台那段拉開到 4.5 公尺，會差一兩公尺、判到對面車道。
   */
  const pts = e.lanes[k]?.points ?? []
  const src = pts.length >= 2 ? pts : e.points
  if (src.length < 2) return []
  /*
   * 讓開量是負的時候（帶子往外多伸一截補直角），那一截屬於隔壁那條邊，當成 0，
   * 與里程換算（sAt）同一套規則。拿負數去算會讓尾巴那幾塊的真實路徑縮成一點
   * （road 10 有 27 公尺退化，里程差 47 公尺）。
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
   * 股距的上限由最擠的那個節點決定：那裡並排的束加起來有幾條軌道，框高除以它再留一點邊。
   * 框夠高時股距等於使用者給的軌道寬。
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
