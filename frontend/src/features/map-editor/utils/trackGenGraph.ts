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

/**
 * 端點沒有 link 時，退回用座標判斷「多近算同一個點」。
 *
 * 不寫死公尺數：取整個路網對角線的千分之二。合規的 .xodr 每條 road 都有
 * <code>&lt;link&gt;</code>，這條路根本不會走到；它只是給缺欄位的檔案留的後路。
 */
const WELD_FRACTION = 0.002

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
  /**
   * 這一段在<strong>那條 road 上</strong>的里程起訖（公尺，沿參考線）。
   *
   * OpenDRIVE 的 s 定義在 road 的參考線上，車輛回報的位置反投影回來也是得到 road 的 s。
   * 每一段記下自己涵蓋哪一段 s，之後才能用「road + lane + s」直接查到圖上的哪一塊，
   * 不必拿座標去跟每一塊軌道比距離。
   */
  sFromM: number
  sToM: number
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
  /**
   * 這一段沿線的<strong>內側間隔</strong>（公尺），與 points 等長。
   *
   * 兩條行車道之間夾了多寬的非行車道——月台、安全島、只有標線寬度的分隔。檔案自己寫著，
   * 排版拿它決定哪一段要把兩條軌道拉開。
   */
  innerGapM: number[]
}

/**
 * 路口的通行配對：在這個節點上，哪一條 road 走得到哪一條 road。
 *
 * 直接來自 .xodr —— junction 裡的每一條連接道，它的 <code>&lt;link&gt;</code> 就寫著
 * 「我把 A 的某一端接到 B 的某一端」。分岔要畫在哪、誰是主線誰是岔線，看這份配對就夠，
 * 不必再從幾何回推「同一個節點上有沒有兩束往同一個方向走」。
 */
export type NodeMovement = {
  nodeId: string
  /** road id */
  a: string
  b: string
}

/**
 * 一個<strong>交叉</strong>路口：兩條軌道在這裡交會，四個口互相都通。
 *
 * 判斷的依據是<strong>連接道自己交叉</strong>——同一個路口裡有兩條連接道在中途相交，
 * 那就不是分岔（分岔的幾條腿只在端點碰頭），是交叉。這是檔案裡量得出來的事實，
 * 不必從「有幾條腿」之類的形狀去猜。
 */
export type NodeCrossing = {
  nodeId: string
  /** 交會點的真實座標（公尺） */
  atX: number
  atY: number
  /** 這個路口的連接道整體佔了多長（公尺）——畫出來的交叉軌道就這麼長 */
  spanM: number
}

export type TrackGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 路口允許的通行配對，照 .xodr 的連接道列出來 */
  movements: NodeMovement[]
  /** 連接道互相交叉的路口，畫成交叉軌道 */
  crossings: NodeCrossing[]
  /** 診斷用：圖上有幾個環（邊數 − 節點數 + 連通塊數） */
  cycles: number
  components: number
}

type Pt = { x: number; y: number }

/** 兩條線段相交的位置；不相交或只在端點碰頭時回 null */
function segmentCross(
  p1: Pt,
  p2: Pt,
  p3: Pt,
  p4: Pt,
): { x: number; y: number; t: number; u: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return null
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, t, u }
}

/**
 * 這個路口裡有沒有兩條連接道<strong>在中途</strong>相交。
 *
 * 只在端點碰頭的不算——那是分岔，幾條腿共用一個起點。要離兩端都有一段距離，才是
 * 一條路疊過另一條。門檻取整條的一成：短的連接道十幾公尺，一成就是一公尺多，足以
 * 排掉端點的浮點誤差，又不會把真的交叉排掉（實測 T3 的交叉落在 0.31 與 0.68）。
 */
const CROSSING_END_MARGIN = 0.1

function crossingInJunction(
  lanes: LaneCenterline[],
): { atX: number; atY: number; spanM: number } | null {
  for (let a = 0; a < lanes.length; a += 1) {
    for (let b = a + 1; b < lanes.length; b += 1) {
      const A = lanes[a]!.points
      const B = lanes[b]!.points
      for (let i = 1; i < A.length; i += 1) {
        for (let j = 1; j < B.length; j += 1) {
          const hit = segmentCross(A[i - 1]!, A[i]!, B[j - 1]!, B[j]!)
          if (!hit) continue
          const fa = (i - 1 + hit.t) / (A.length - 1)
          const fb = (j - 1 + hit.u) / (B.length - 1)
          if (fa < CROSSING_END_MARGIN || fa > 1 - CROSSING_END_MARGIN) continue
          if (fb < CROSSING_END_MARGIN || fb > 1 - CROSSING_END_MARGIN) continue
          let xMin = Infinity
          let xMax = -Infinity
          let yMin = Infinity
          let yMax = -Infinity
          for (const lane of lanes) {
            for (const p of lane.points) {
              if (p.x < xMin) xMin = p.x
              if (p.x > xMax) xMax = p.x
              if (p.y < yMin) yMin = p.y
              if (p.y > yMax) yMax = p.y
            }
          }
          return {
            atX: hit.x,
            atY: hit.y,
            spanM: Math.max(xMax - xMin, yMax - yMin),
          }
        }
      }
    }
  }
  return null
}

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
  const driving = (l: LaneCenterline) => l.laneType === 'driving'
  const lanesByRoad = new Map<string, LaneCenterline[]>()
  for (const lane of plan.lanes) {
    if (!driving(lane)) continue
    const arr = lanesByRoad.get(lane.roadId) ?? []
    arr.push(lane)
    lanesByRoad.set(lane.roadId, arr)
  }

  /*
   * 誰要畫、誰只是路口內部的連接道，<strong>檔案自己說了</strong>：road 的
   * <code>junction</code> 屬性不是 -1 就在某個路口裡。不必用長度去猜。
   */
  const mainRoads: RoadInfo[] = []
  const connectors: RoadInfo[] = []
  for (const road of plan.roads) {
    if (!lanesByRoad.has(road.id)) continue
    if (road.junctionId !== '-1') connectors.push(road)
    else mainRoads.push(road)
  }

  const extentM = (() => {
    let xmin = Infinity
    let ymin = Infinity
    let xmax = -Infinity
    let ymax = -Infinity
    for (const road of plan.roads) {
      for (const p of road.refPoints) {
        if (p.x < xmin) xmin = p.x
        if (p.y < ymin) ymin = p.y
        if (p.x > xmax) xmax = p.x
        if (p.y > ymax) ymax = p.y
      }
    }
    return Number.isFinite(xmin) ? Math.hypot(xmax - xmin, ymax - ymin) : 1
  })()
  /*
   * 一段直線至少要多長才值得成為圖上的一段。
   *
   * 這是<strong>簡圖的解析度</strong>，不是場域的性質，所以跟著路網的大小走：取對角線的
   * 百分之二。寫死公尺數的話，換一個大十倍的路網就會切出一堆碎段。
   */
  const minRunM = options.minRunM ?? extentM * 0.02

  /* ── 節點：切段 + 照 link 接起來 ─────────────────────────── */

  type Endpoint = { key: string; at: Pt }
  const endpoints: Endpoint[] = []
  const weld = new Weld()
  const runsByRoad = new Map<string, Array<{ from: number; to: number; dirDeg: number }>>()
  /** road 的兩個實體端點對應到哪一個段端點 */
  const roadEndKey = new Map<string, string>()
  const endAt = (roadId: string, contact: 'start' | 'end') => roadEndKey.get(`${roadId}|${contact}`)

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
    roadEndKey.set(`${road.id}|start`, `${road.id}#0a`)
    roadEndKey.set(`${road.id}|end`, `${road.id}#${runs.length - 1}b`)
  }

  /*
   * 拓樸照 <code>&lt;link&gt;</code> 接，不用座標猜。
   *
   * OpenDRIVE 每條 road 都寫著前後接誰、接在對方的哪一端；路口裡的連接道也一樣，它的
   * link 就是「我把 A 的某一端接到 B 的某一端」。所以節點是<strong>讀</strong>出來的：
   * 兩個端點被 link 指到一起就是同一個節點，跟它們在座標上差幾公尺無關。
   *
   * 先前是「相距八公尺內就焊在一起」。那在路口密集或比例尺不同的檔案上會焊錯，而且
   * 每換一份圖就要重調那個數字。
   */
  const movements: NodeMovement[] = []
  const crossings: NodeCrossing[] = []
  const seenCrossingJunctions = new Set<string>()
  /*
   * 連接道<strong>在中途</strong>互相交叉的路口。
   *
   * 分岔的幾條腿只在端點碰頭；交叉是兩條路真的疊過去。所以「有沒有一對連接道在
   * 兩端以外的地方相交」就是這兩者的分界，量得出來，不必猜形狀。
   */
  const junctionLanes = new Map<string, LaneCenterline[]>()
  for (const lane of plan.lanes) {
    if (!driving(lane)) continue
    const road = plan.roads.find((r) => r.id === lane.roadId)
    if (!road || road.junctionId === '-1') continue
    const arr = junctionLanes.get(road.junctionId) ?? []
    arr.push(lane)
    junctionLanes.set(road.junctionId, arr)
  }
  /** 連接道兩端接到的 road 端點；沒有 link 的話回傳 null */
  const linkTarget = (link: RoadInfo['predecessor']): string | null => {
    if (!link || link.type !== 'road' || !link.contact) return null
    return endAt(link.id, link.contact) ?? null
  }
  for (const road of plan.roads) {
    if (!lanesByRoad.has(road.id)) continue
    const isConnector = road.junctionId !== '-1'
    const own = {
      start: isConnector ? null : endAt(road.id, 'start'),
      end: isConnector ? null : endAt(road.id, 'end'),
    }
    const pre = linkTarget(road.predecessor)
    const suc = linkTarget(road.successor)
    if (isConnector) {
      // 連接道自己不畫，只把它接的兩端縫成同一個節點——那就是這個路口
      if (pre && suc) {
        weld.union(pre, suc)
        const a = road.predecessor?.id
        const b = road.successor?.id
        if (a && b && a !== b) movements.push({ nodeId: pre, a, b })
        // 同一個路口的每一條連接道都會走到這裡，記一次就好
        if (!seenCrossingJunctions.has(road.junctionId)) {
          seenCrossingJunctions.add(road.junctionId)
          const hit = crossingInJunction(junctionLanes.get(road.junctionId) ?? [])
          if (hit) crossings.push({ nodeId: pre, ...hit })
        }
      }
      continue
    }
    if (own.start && pre) weld.union(own.start, pre)
    if (own.end && suc) weld.union(own.end, suc)
  }

  /*
   * 連接道沒把某個路口縫起來時，退回<strong>路口 id</strong>。
   *
   * road 的 link 可以直接指到一個 junction（「我這一端接的是三號路口」）。連接道齊全時
   * 上面那一輪已經把兩側縫好了；缺了幾條連接道的檔案就靠這一輪：指到同一個路口的端點
   * 本來就在同一個地方，併成一個節點。這仍然是讀規格，不是看座標。
   */
  const byJunction = new Map<string, string[]>()
  for (const road of plan.roads) {
    if (!lanesByRoad.has(road.id) || road.junctionId !== '-1') continue
    for (const [link, contact] of [
      [road.predecessor, 'start'],
      [road.successor, 'end'],
    ] as const) {
      if (link?.type !== 'junction') continue
      const k = endAt(road.id, contact)
      if (!k) continue
      const arr = byJunction.get(link.id) ?? []
      arr.push(k)
      byJunction.set(link.id, arr)
    }
  }
  for (const list of byJunction.values()) {
    for (let i = 1; i < list.length; i += 1) weld.union(list[0]!, list[i]!)
  }

  /*
   * 沒有 link 的端點才退回座標。
   *
   * 容差取路網對角線的千分之二，不是寫死的公尺數；合規的檔案根本不會走到這裡。
   */
  const weldM = extentM * WELD_FRACTION
  const linked = new Set<string>()
  for (const road of plan.roads) {
    if (!lanesByRoad.has(road.id) || road.junctionId !== '-1') continue
    if (road.predecessor) {
      const k = endAt(road.id, 'start')
      if (k) linked.add(k)
    }
    if (road.successor) {
      const k = endAt(road.id, 'end')
      if (k) linked.add(k)
    }
  }
  const loose = endpoints.filter((e) => !linked.has(e.key))
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) {
      const a = loose[i]!
      const b = loose[j]!
      if (Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) <= weldM) weld.union(a.key, b.key)
    }
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
        sFromM: polyLength(pts, 0, run.from),
        sToM: polyLength(pts, 0, run.to),
        orient: horiz ? 'h' : 'v',
        sign: run.dirDeg === 0 || run.dirDeg === 90 ? 1 : -1,
        lanes,
        points: pts.slice(run.from, run.to + 1).map((p) => ({ x: p.x, y: p.y })),
        innerGapM: (road.innerGapM ?? []).slice(run.from, run.to + 1),
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
    movements: movements.map((m) => ({ ...m, nodeId: weld.find(m.nodeId) })),
    crossings: crossings.map((c) => ({ ...c, nodeId: weld.find(c.nodeId) })),
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
