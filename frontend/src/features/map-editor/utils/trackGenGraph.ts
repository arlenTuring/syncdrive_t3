import type { LaneCenterline, LaneCenterlinePlan, RoadInfo } from '../opendrive/laneCenterlines'

/**
 * 路網 → 圖（節點與邊）。
 *
 * <h3>為什麼不再用「脊線 + 橫向偏移」</h3>
 * 先前的做法是把車道串成一條最長的鏈當脊線，其他東西一律表示成「相對脊線的橫向
 * 偏移」。那是<strong>走廊</strong>模型，不是路網模型，而場域是路網：
 *
 * <ul>
 *   <li>環會被切開——鏈是開放路徑，路口把環斷成好幾條，只有最長的那條被畫出來。
 *       實測 T3 的參考鏈頭尾在真實世界相距 338 公尺，脊線只有三段直線，右側整段
 *       不在圖上。</li>
 *   <li>岔出去的線只能表示成「橫向偏移暴增」，於是在幾十像素內爬好幾股，畫出來是
 *       一根尖刺（實測斜率 1:0.19）。</li>
 *   <li>路口的兩條線在模型裡毫無關係，各畫各的，兩片就互相穿透。</li>
 * </ul>
 *
 * 改成圖之後這些都不必補：環是圖上的<strong>環</strong>，佈局擺的是節點而不是走過的
 * 路徑；岔出是節點上的一條邊，不需要橫向偏移；路口是一個節點，邊在那裡相接。
 *
 * <h3>節點從哪來</h3>
 * 兩種：<strong>路口</strong>（junction 裡的連接道把兩側縫成同一個節點）與
 * <strong>轉折</strong>（一條 road 自己轉了 90 度，那個彎就是一個節點）。road 的端點
 * 靠真實座標聚類，不靠 link 標籤——link 缺漏或 contactPoint 寫反時，幾何不會騙人。
 */

/** 真實座標上多近算同一個點（公尺） */
const WELD_M = 8
/** 路口連接道最長多長（公尺）——比這長的不當連接道，它自己就是一段路 */
const CONNECTOR_MAX_M = 120

export type GraphNode = {
  id: string
  /** 真實座標（公尺） */
  realX: number
  realY: number
  /** 正交化之後的座標（公尺，兩軸各自對齊） */
  x: number
  y: number
}

export type GraphEdge = {
  id: string
  roadId: string
  from: string
  to: string
  /** 這一段的里程長度（公尺） */
  lengthM: number
  /** 橫的還是縱的 */
  orient: 'h' | 'v'
  /** 走向：+1 表示往 x（或 y）增加的方向 */
  sign: 1 | -1
  /**
   * 這一段涵蓋的車道，依 lane id 排序。
   *
   * `points` 是那條車道自己的中心線（真實座標），已經裁到這一段、方向對齊參考線。
   * 排版要靠它看出<strong>兩條軌道在哪裡拉開</strong>——月台就在拉開的那一段中間，
   * road 的參考線看不出這件事，車道線才看得出來。
   */
  lanes: Array<{ key: string; laneId: number; widthM: number; points: Array<{ x: number; y: number }> }>
  /** 真實座標的取樣點，車輛投影要用 */
  points: Array<{ x: number; y: number }>
}

export type TrackGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 診斷用：圖上有幾個環（邊數 − 節點數 + 連通塊數） */
  cycles: number
  components: number
}

type Pt = { x: number; y: number }

/** 併查集：端點靠真實座標焊在一起 */
class Weld {
  private parent = new Map<string, string>()

  find(a: string): string {
    const p = this.parent.get(a)
    if (p === undefined || p === a) {
      this.parent.set(a, a)
      return a
    }
    const r = this.find(p)
    this.parent.set(a, r)
    return r
  }

  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

function headingDeg(a: Pt, b: Pt): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

/** 吸到 90 度的倍數，回傳 0/90/180/270 */
function q90(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360
}

/**
 * 一條 road 依<strong>吸到 90 度的走向</strong>切成幾段直線。
 *
 * 緩彎在簡圖上就是一個直角轉折，所以走向一變就切一刀，切點是轉折節點。太短的段
 * 併進隔壁——路口附近常有幾公尺的擺動，切出來只會多出一堆碎節點。
 */
function splitRuns(points: Pt[], minRunM: number): Array<{ from: number; to: number; dirDeg: number }> {
  if (points.length < 2) return []
  const runs: Array<{ from: number; to: number; dirDeg: number }> = []
  let start = 0
  let dir = q90(headingDeg(points[0]!, points[1]!))
  for (let i = 1; i + 1 < points.length; i += 1) {
    const d = q90(headingDeg(points[i]!, points[i + 1]!))
    if (d === dir) continue
    runs.push({ from: start, to: i, dirDeg: dir })
    start = i
    dir = d
  }
  runs.push({ from: start, to: points.length - 1, dirDeg: dir })

  // 太短的段併進前一段，長度不夠的轉折不值得變成節點
  const out: typeof runs = []
  for (const r of runs) {
    const len = polyLength(points, r.from, r.to)
    const prev = out[out.length - 1]
    if (len < minRunM && prev) {
      prev.to = r.to
      continue
    }
    out.push({ ...r })
  }
  return out
}

/**
 * 一條車道在 [f0, f1] 這一段的取樣點，方向對齊 road 的參考線。
 *
 * 車道中心線是<strong>依行車方向</strong>存的，左側（lane id 為正）那條因此與參考線
 * 反向，要先翻回來再裁，不然量出來的位置會落到路的另一頭。
 */
function sampleLane(
  lane: LaneCenterline,
  f0: number,
  f1: number,
  n = 24,
): Array<{ x: number; y: number }> {
  const src = lane.laneId > 0 ? [...lane.points].reverse() : lane.points
  if (src.length < 2) return []
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i += 1) {
    const f = f0 + ((f1 - f0) * i) / (n - 1)
    const u = Math.max(0, Math.min(1, f)) * (src.length - 1)
    const j = Math.min(src.length - 2, Math.floor(u))
    const t = u - j
    out.push({
      x: src[j]!.x + (src[j + 1]!.x - src[j]!.x) * t,
      y: src[j]!.y + (src[j + 1]!.y - src[j]!.y) * t,
    })
  }
  return out
}

function polyLength(points: Pt[], from: number, to: number): number {
  let t = 0
  for (let i = from + 1; i <= to; i += 1) {
    t += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  }
  return t
}

export type BuildGraphOptions = {
  /** 切出來的直線段至少多長（公尺） */
  minRunM?: number
}

export function buildTrackGraph(
  plan: LaneCenterlinePlan,
  options: BuildGraphOptions = {},
): TrackGraph {
  const minRunM = options.minRunM ?? 25

  const driving = (l: LaneCenterline) => l.laneType === 'driving'
  const lanesByRoad = new Map<string, LaneCenterline[]>()
  for (const lane of plan.lanes) {
    if (!driving(lane)) continue
    const arr = lanesByRoad.get(lane.roadId) ?? []
    arr.push(lane)
    lanesByRoad.set(lane.roadId, arr)
  }

  const mainRoads: RoadInfo[] = []
  const connectors: RoadInfo[] = []
  for (const road of plan.roads) {
    if (!lanesByRoad.has(road.id)) continue
    if (road.junctionId !== '-1' && road.lengthM <= CONNECTOR_MAX_M) connectors.push(road)
    else mainRoads.push(road)
  }

  /* ── 節點：切段 + 端點焊接 ──────────────────────────────── */

  type Endpoint = { key: string; at: Pt }
  const endpoints: Endpoint[] = []
  const weld = new Weld()
  const runsByRoad = new Map<string, Array<{ from: number; to: number; dirDeg: number }>>()

  for (const road of mainRoads) {
    const pts = road.refPoints
    if (pts.length < 2) continue
    const runs = splitRuns(pts, minRunM)
    runsByRoad.set(road.id, runs)
    for (let i = 0; i < runs.length; i += 1) {
      const a = { key: `${road.id}#${i}a`, at: pts[runs[i]!.from]! }
      const b = { key: `${road.id}#${i}b`, at: pts[runs[i]!.to]! }
      endpoints.push(a, b)
      weld.find(a.key)
      weld.find(b.key)
      // 同一條 road 上相鄰兩段共用轉折點
      if (i > 0) weld.union(`${road.id}#${i - 1}b`, a.key)
    }
  }

  // 真實座標夠近的端點焊成同一個節點
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const a = endpoints[i]!
      const b = endpoints[j]!
      if (Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) <= WELD_M) weld.union(a.key, b.key)
    }
  }

  /*
   * 路口的連接道不畫，但要把兩側縫起來。
   *
   * 它們就是使用者說的「不用畫的渡線」：幾十公尺的短車道，畫出來只會在路口糊成一團。
   * 可是拓樸上少了它們，環就斷了——所以只拿它們把兩端的節點併成同一個。
   */
  for (const road of connectors) {
    const pts = road.refPoints
    if (pts.length < 2) continue
    const ends: Pt[] = [pts[0]!, pts[pts.length - 1]!]
    const hit = ends.map((p) => {
      let best: Endpoint | null = null
      let bestD = CONNECTOR_MAX_M
      for (const e of endpoints) {
        const d = Math.hypot(e.at.x - p.x, e.at.y - p.y)
        if (d < bestD) {
          bestD = d
          best = e
        }
      }
      return best
    })
    if (hit[0] && hit[1]) weld.union(hit[0].key, hit[1].key)
  }

  /* ── 節點座標 ───────────────────────────────────────────── */

  const members = new Map<string, Endpoint[]>()
  for (const e of endpoints) {
    const r = weld.find(e.key)
    const arr = members.get(r) ?? []
    arr.push(e)
    members.set(r, arr)
  }
  const nodes = new Map<string, GraphNode>()
  for (const [root, group] of members) {
    const realX = group.reduce((t, g) => t + g.at.x, 0) / group.length
    const realY = group.reduce((t, g) => t + g.at.y, 0) / group.length
    nodes.set(root, { id: root, realX, realY, x: realX, y: realY })
  }

  /* ── 邊 ─────────────────────────────────────────────────── */

  const edges: GraphEdge[] = []
  for (const road of mainRoads) {
    const pts = road.refPoints
    const runs = runsByRoad.get(road.id)
    if (!runs) continue
    const laneList = (lanesByRoad.get(road.id) ?? []).slice().sort((a, b) => a.laneId - b.laneId)
    const lastIdx = Math.max(1, pts.length - 1)
    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[i]!
      const lanes = laneList.map((l) => ({
        key: l.key,
        laneId: l.laneId,
        widthM: l.widthM,
        points: sampleLane(l, run.from / lastIdx, run.to / lastIdx),
      }))
      const from = weld.find(`${road.id}#${i}a`)
      const to = weld.find(`${road.id}#${i}b`)
      if (from === to) continue
      const horiz = run.dirDeg === 0 || run.dirDeg === 180
      edges.push({
        id: `${road.id}#${i}`,
        roadId: road.id,
        from,
        to,
        lengthM: polyLength(pts, run.from, run.to),
        orient: horiz ? 'h' : 'v',
        sign: run.dirDeg === 0 || run.dirDeg === 90 ? 1 : -1,
        lanes,
        points: pts.slice(run.from, run.to + 1).map((p) => ({ x: p.x, y: p.y })),
      })
    }
  }

  orthogonalise(nodes, edges)

  /* ── 診斷：環有幾個 ─────────────────────────────────────── */

  const comp = new Weld()
  for (const n of nodes.keys()) comp.find(n)
  for (const e of edges) comp.union(e.from, e.to)
  const roots = new Set<string>()
  for (const n of nodes.keys()) roots.add(comp.find(n))

  return {
    nodes: [...nodes.values()],
    edges,
    components: roots.size,
    cycles: edges.length - nodes.size + roots.size,
  }
}

/**
 * 把節點的座標對齊，讓每一條邊真的是水平或垂直的。
 *
 * 水平邊要求兩端<strong>同一個 y</strong>，垂直邊要求同一個 x。把有這種要求的節點併成
 * 一組，整組取真實座標的平均——這樣圖還是照著真實位置擺，只是被拉直了。環不會因此
 * 散掉：座標是給節點的，不是沿著某條路徑累加出來的。
 */
function orthogonalise(nodes: Map<string, GraphNode>, edges: GraphEdge[]) {
  const yGroup = new Weld()
  const xGroup = new Weld()
  for (const n of nodes.keys()) {
    yGroup.find(n)
    xGroup.find(n)
  }
  for (const e of edges) {
    if (e.orient === 'h') yGroup.union(e.from, e.to)
    else xGroup.union(e.from, e.to)
  }
  const avg = (g: Weld, pick: (n: GraphNode) => number) => {
    const sum = new Map<string, { t: number; n: number }>()
    for (const n of nodes.values()) {
      const r = g.find(n.id)
      const cur = sum.get(r) ?? { t: 0, n: 0 }
      cur.t += pick(n)
      cur.n += 1
      sum.set(r, cur)
    }
    return sum
  }
  const ys = avg(yGroup, (n) => n.realY)
  const xs = avg(xGroup, (n) => n.realX)
  for (const n of nodes.values()) {
    const gy = ys.get(yGroup.find(n.id))
    const gx = xs.get(xGroup.find(n.id))
    n.y = gy ? gy.t / gy.n : n.realY
    n.x = gx ? gx.t / gx.n : n.realX
  }
}
