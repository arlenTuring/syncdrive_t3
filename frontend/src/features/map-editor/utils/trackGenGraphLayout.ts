import {
  blocksInSpan,
  fitCornerAt,
  fitSwitchAt,
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

/** 這個節點上，與這條邊<strong>方向不同</strong>的鄰邊 */
function perpendicularAt(
  nodeId: string,
  edge: GraphEdge,
  incident: Map<string, GraphEdge[]>,
): GraphEdge | null {
  for (const other of incident.get(nodeId) ?? []) {
    if (other.id === edge.id) continue
    if (other.orient !== edge.orient) return other
  }
  return null
}

function layoutOnce(
  graph: TrackGraph,
  block: TrackGenBlockSize,
  sx: number,
  sy: number,
  levelPx: number,
): TrackGenLayout {
  const bandW = block.trackWidthPx
  const cornerR = Math.max(bandW, levelPx * 3)

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
    let k = 0
    for (const e of list) {
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
  const shift = new Map<string, number>()
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
      let away = 0
      for (let i = 1; i < sorted.length; i += 1) {
        const key = bundleKey(sorted[i]!)
        away += (bundleCount.get(bundleKey(sorted[i - 1]!)) ?? 1) * levelPx
        for (const e of bundles.get(key) ?? []) {
          if (Math.abs(shift.get(e.id) ?? 0) < away) shift.set(e.id, away)
        }
      }
    }
  }

  /** 這條邊每一條車道的橫向偏移（版面像素）：束內依序排開，再加上讓開的量 */
  const offsetsOf = (e: GraphEdge) => {
    const total = bundleCount.get(bundleKey(e)) ?? e.lanes.length
    const base = baseIndex.get(e.id) ?? 0
    const away = shift.get(e.id) ?? 0
    return e.lanes.map((_, k) => (base + k - (total - 1) / 2) * levelPx + away)
  }

  /** 邊在節點端讓出的長度：那一端要放轉角就讓一個半徑 */
  const trimAt = (e: GraphEdge, nodeId: string, fullLen: number) =>
    perpendicularAt(nodeId, e, incident) ? Math.min(cornerR, fullLen / 2 - 1) : 0

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
    const n = Math.max(1, blocksInSpan(usedM, perBlockM, minRunM))

    const offs = offsetsOf(e)
    e.lanes.forEach((lane, k) => {
      const o = offs[k]!
      // 垂直於邊的方向
      const nx = -uy
      const ny = ux
      for (let i = 0; i < n; i += 1) {
        const f0 = i / n
        const f1 = (i + 1) / n
        const p0 = { x: S.x + ux * len * f0 + nx * o, y: S.y + uy * len * f0 + ny * o }
        const p1 = { x: S.x + ux * len * f1 + nx * o, y: S.y + uy * len * f1 + ny * o }
        const centre = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
        const lengthM = Math.hypot(p1.x - p0.x, p1.y - p0.y)
        shapes.push({
          kind: 'rect',
          name: `${lane.key}-${String(i + 1).padStart(2, '0')}`,
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
    })
  }

  /* ── 轉角 ───────────────────────────────────────────────── */

  for (const node of graph.nodes) {
    const list = incident.get(node.id) ?? []
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const eh = list[i]!.orient === 'h' ? list[i]! : list[j]!
        const ev = list[i]!.orient === 'h' ? list[j]! : list[i]!
        if (eh.orient !== 'h' || ev.orient !== 'v') continue
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
          if (radius <= bandW * 0.6) continue
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
        const mainOffs = offsetsOf(main)
        const offs = offsetsOf(e)
        const count = Math.min(mainOffs.length, offs.length)
        // 岔出的長度照斜率給，太短會變尖刺
        const runPx = Math.max(cornerR, Math.abs(away) * 3)
        for (let k = 0; k < count; k += 1) {
          const oMain = mainOffs[k]!
          const oBranch = offs[k]!
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
            name: `${e.lanes[k]!.key}^${main.lanes[k]!.key}`,
            role: 'road',
            lineKey: e.lanes[k]!.key,
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
