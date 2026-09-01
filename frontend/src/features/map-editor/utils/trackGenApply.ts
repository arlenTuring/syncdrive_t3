import type { FacilityObject } from '../types/facility'
import type { TrackGenSettings } from './trackGenFacility'
import type { LaneRole, TrackGenResult, Vec2 } from './trackGenerator'
import { layoutTrackGen, type LayoutShape } from './trackGenLayout'
import { CORNER_TRACK_KEY, TAPER_TRACK_KEY } from './trackShapes'
import {
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'
import {
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'

/**
 * 把生成結果轉成真正的設施。
 *
 * 位置與形狀直接取自 {@link layoutTrackGen}——那也是預覽在用的同一支，所以套用
 * 出來的東西與畫面上看到的一致。先前兩邊各自算，套用出來方向是反的、ㄩ 形也散掉。
 *
 * <h3>三種軌道各對應哪一部分</h3>
 * <ul>
 *   <li>直線段的每一塊 → 一般軌道（矩形），逐塊獨立才能個別拉伸與設屬性</li>
 *   <li>每一段彎道 → <strong>一個</strong>圓角軌道，不切碎</li>
 *   <li>渡線與側線 → 斜接軌道，兩端各自帶寬度</li>
 * </ul>
 *
 * <h3>兩套座標</h3>
 * 圖面位置用版面座標（沿線真實公尺、橫向放大），真實座標另外寫進 refField。
 * 兩者分開存，與地圖其他設施的做法一致。
 */

export type BuiltFacility = {
  id: string
  type: FacilityObject['type']
  name: FacilityObject['name']
  customName: string
  rotation: number
  parameters: Record<string, unknown>
  /** 未旋轉前的外框（版面公尺，左上原點、y 向下） */
  box: { xM: number; yM: number; wM: number; hM: number }
}

export type ApplyResult = {
  facilities: BuiltFacility[]
  extentM: { wM: number; hM: number }
}

/** 參照場域範圍要往兩側撐半個車道，範圍才蓋得住整條軌道帶 */
const LANE_HALF_W_M = 1.675

/**
 * 參考線上某里程的真實座標與左法線。
 *
 * refPoints 是抽稀過的下行主線；相鄰兩點的方向就是切線，左法線由它旋轉九十度
 * 得到——與 projectOnto 算橫向偏移時用的是同一個正負號慣例，兩邊才對得起來。
 */
function realFrameAt(result: TrackGenResult, s: number): { at: Vec2; nx: number; ny: number } {
  const xs = result.refStations
  const ps = result.refPoints
  if (xs.length < 2 || ps.length < 2) return { at: { x: 0, y: 0 }, nx: 0, ny: 0 }
  let lo = 0
  let hi = xs.length - 1
  if (s <= xs[0]!) {
    lo = 0
    hi = 1
  } else if (s >= xs[hi]!) {
    lo = hi - 1
    hi = xs.length - 1
  } else {
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid]! <= s) lo = mid
      else hi = mid
    }
    hi = lo + 1
  }
  const a = ps[lo]!
  const b = ps[hi]!
  const span = Math.max(1e-6, xs[hi]! - xs[lo]!)
  const u = Math.max(0, Math.min(1, (s - xs[lo]!) / span))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const m = Math.hypot(dx, dy) || 1
  return {
    at: { x: a.x + dx * u, y: a.y + dy * u },
    nx: -dy / m,
    ny: dx / m,
  }
}

/** 里程＋真實橫向偏移 → 真實座標 */
function realAtLateral(result: TrackGenResult, s: number, lateralM: number): Vec2 {
  const f = realFrameAt(result, s)
  return { x: f.at.x + f.nx * lateralM, y: f.at.y + f.ny * lateralM }
}

/**
 * 這一段軌道在真實場域裡蓋到的範圍，直接寫進「參照場域範圍」。
 *
 * <h3>這就是自動生成的目的</h3>
 * 車端回報的是真實場域座標；圖台要把車畫在簡易地圖上，靠的就是每一段軌道的
 * 參照場域範圍。以前這四個數字得一段一段手填，四十幾段就是一百多個數字。
 *
 * 範圍取這一段沿線取樣點的外接方框，再往兩側各撐半個車道寬——只取頭尾兩點的話，
 * 彎道那一段的方框會沿著弦切過去，中間整段落在範圍外。
 *
 * 寫進 refField 不會改變圖面大小：Area 內的顯示尺寸看的是 areaSizePx，
 * refField 只在沒有 areaSizePx 時才參與尺寸推導（見 getFacilitySizeMeters）。
 */
function realBounds(
  result: TrackGenResult,
  sFrom: number,
  sTo: number,
  latAt: (s: number) => number,
) {
  const N = 16
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (let i = 0; i <= N; i += 1) {
    const s = sFrom + (sTo - sFrom) * (i / N)
    const lat = latAt(s)
    /*
     * .xodr 就是場域的實際地圖，座標直接當場域座標用——不做偏移也不翻轉。
     * 車端回報的位置與這裡寫進去的是同一個座標系，投影才會落在對的地方。
     */
    const p = realAtLateral(result, s, lat)
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  const r = (v: number) => Number(v.toFixed(2))
  return {
    [REF_FIELD_X_MIN_M]: r(xMin - LANE_HALF_W_M),
    [REF_FIELD_X_MAX_M]: r(xMax + LANE_HALF_W_M),
    [REF_FIELD_Y_MIN_M]: r(yMin - LANE_HALF_W_M),
    [REF_FIELD_Y_MAX_M]: r(yMax + LANE_HALF_W_M),
    trackGenSFromM: r(sFrom),
    trackGenSToM: r(sTo),
  }
}


/* ── 車輛投影用的兩條路徑 ─────────────────────────────────────
   通用投影只會沿 refField 的長邊做線性內插：直線段沒問題，圓角是弧就對不上，
   實測車子在轉角處會跳 137 像素。所以每一段都存下「真實路徑」與「圖面路徑」，
   投影時先在真實路徑上求出走了幾成，再照同樣的比例落在圖面路徑上。       */

/**
 * 某個角色（上行／下行）在各里程的<strong>實際</strong>橫向偏移。
 *
 * 主線區塊的偏移原本取整條的中位數，那是為了讓圖面上兩條線平行；但參照場域範圍
 * 要的是真實位置。實測上行線在 junction 會外擺到 8 公尺，名目間距只有 3.5——
 * 用名目值算出來的範圍蓋不到車子實際走的地方，那幾段就定位不到。
 */
function lateralLookup(result: TrackGenResult, role: LaneRole): (s: number) => number {
  const pts = result.lanes
    .filter((l) => l.role === role)
    .flatMap((l) => l.profile)
    .sort((a, b) => a[0] - b[0])
  if (!pts.length) return () => 0
  return (s: number) => {
    if (s <= pts[0]![0]) return pts[0]![1]
    if (s >= pts[pts.length - 1]![0]) return pts[pts.length - 1]![1]
    let lo = 0
    let hi = pts.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid]![0] <= s) lo = mid
      else hi = mid
    }
    const span = Math.max(1e-6, pts[hi]![0] - pts[lo]![0])
    const u = (s - pts[lo]![0]) / span
    return pts[lo]![1] + (pts[hi]![1] - pts[lo]![1]) * u
  }
}

/** 這一段的真實中心線（依里程由小到大） */
function realPathOf(
  result: TrackGenResult,
  sFrom: number,
  sTo: number,
  latAt: (s: number) => number,
  n: number,
): number[][] {
  const out: number[][] = []
  for (let i = 0; i <= n; i += 1) {
    const s = sFrom + (sTo - sFrom) * (i / n)
    const p = realAtLateral(result, s, latAt(s))
    out.push([Number(p.x.toFixed(2)), Number(p.y.toFixed(2))])
  }
  return out
}

/**
 * 圖面中心線，換成「未旋轉外框」的 0–1 座標。
 *
 * 存成比例而不是像素：元件之後被拉伸、Area 被縮放都不影響，投影仍然落在軌道上。
 */
function localPathOf(
  samples: Vec2[],
  box: { xM: number; yM: number; wM: number; hM: number },
  rotationDeg: number,
): number[][] {
  const w = Math.max(1e-6, box.wM)
  const h = Math.max(1e-6, box.hM)
  if (Math.abs(rotationDeg) < 1e-6) {
    return samples.map((p) => [
      Number(((p.x - box.xM) / w).toFixed(4)),
      Number(((p.y - box.yM) / h).toFixed(4)),
    ])
  }
  /*
   * 有旋轉的段：外框是「長沿行進方向、寬跨軌道」，所以把取樣點轉回未旋轉的
   * 座標系再正規化，否則比例會沿著螢幕的軸算，斜段整條歪掉。
   */
  const rad = (-rotationDeg * Math.PI) / 180
  const cx = box.xM + w / 2
  const cy = box.yM + h / 2
  return samples.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad)
    return [Number((0.5 + rx / w).toFixed(4)), Number((0.5 + ry / h).toFixed(4))]
  })
}

function facilityFor(
  shape: LayoutShape,
  result: TrackGenResult,
  mainLateral: Record<'down' | 'up', (s: number) => number>,
  id: string,
): BuiltFacility {
  /*
   * 主線照該條線自己的剖面取真實偏移；渡線與側線的兩端偏移已經是各自剖面上的
   * 實際值，中間線性內插即可。
   */
  const latAt =
    shape.role === 'down' || shape.role === 'up'
      ? mainLateral[shape.role]
      : (s: number) => {
          const span = Math.max(1e-6, shape.sTo - shape.sFrom)
          const u = Math.max(0, Math.min(1, (s - shape.sFrom) / span))
          return shape.realLatFromM + (shape.realLatToM - shape.realLatFromM) * u
        }
  const meta = realBounds(result, shape.sFrom, shape.sTo, latAt)
  const realPath = realPathOf(
    result,
    shape.sFrom,
    shape.sTo,
    latAt,
    shape.kind === 'corner' ? 12 : 4,
  )
  if (shape.kind === 'rect') {
    /*
     * 軸對齊的段<strong>不要旋轉</strong>。
     *
     * 把長寬照行進方向寫進去、再轉一個 180 度，畫出來會上下顛倒——連標籤都是反的。
     * 軸對齊時直接用外接方框就對了，旋轉只留給 45 度那種斜段。
     */
    const near = (deg: number, target: number) =>
      Math.abs(((deg - target + 540) % 360) - 180) < 1
    const horizontal = near(shape.rotationDeg, 0) || near(shape.rotationDeg, 180)
    const vertical = near(shape.rotationDeg, 90) || near(shape.rotationDeg, -90)
    const axisAligned = horizontal || vertical
    const wM = horizontal ? shape.lengthM : shape.widthM
    const hM = horizontal ? shape.widthM : shape.lengthM
    return {
      id,
      type: 'Track',
      name: 'Rail',
      customName: shape.name,
      rotation: axisAligned ? 0 : shape.rotationDeg,
      parameters: {
        segmentId: shape.name,
        trackGenRole: shape.role,
        [TRACKGEN_REAL_PATH_KEY]: realPath,
        [TRACKGEN_LOCAL_PATH_KEY]: localPathOf(
          shape.samples,
          axisAligned
            ? { xM: shape.centre.x - wM / 2, yM: shape.centre.y - hM / 2, wM, hM }
            : {
                xM: shape.centre.x - shape.lengthM / 2,
                yM: shape.centre.y - shape.widthM / 2,
                wM: shape.lengthM,
                hM: shape.widthM,
              },
          axisAligned ? 0 : shape.rotationDeg,
        ),
        ...meta,
      },
      box: axisAligned
        ? {
            xM: shape.centre.x - wM / 2,
            yM: shape.centre.y - hM / 2,
            wM,
            hM,
          }
        : {
            xM: shape.centre.x - shape.lengthM / 2,
            yM: shape.centre.y - shape.widthM / 2,
            wM: shape.lengthM,
            hM: shape.widthM,
          },
    }
  }
  if (shape.kind === 'corner') {
    return {
      id,
      type: 'Track',
      name: 'RailCorner',
      customName: shape.name,
      rotation: 0,
      parameters: {
        segmentId: shape.name,
        trackGenRole: shape.role,
        [CORNER_TRACK_KEY]: shape.geometry,
        [TRACKGEN_REAL_PATH_KEY]: realPath,
        [TRACKGEN_LOCAL_PATH_KEY]: localPathOf(shape.samples, shape.box, 0),
        ...meta,
      },
      box: { ...shape.box },
    }
  }
  /*
   * 換股道 → 斜接軌道。
   *
   * 外框與切角比例都由排版算好（見 fitTaper），這裡照抄就好——套用與預覽共用
   * 同一份幾何，畫面上看到什麼就是套用出來的東西。
   */
  return {
    id,
    type: 'Track',
    name: 'RailTaper',
    customName: shape.name,
    rotation: 0,
    parameters: {
      segmentId: shape.name,
      trackGenRole: shape.role,
      [TAPER_TRACK_KEY]: shape.geometry,
      [TRACKGEN_REAL_PATH_KEY]: realPath,
      [TRACKGEN_LOCAL_PATH_KEY]: localPathOf(shape.samples, shape.box, 0),
      ...meta,
    },
    box: { ...shape.box },
  }
}

export function buildFacilitiesFromTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
  nextId: () => string,
): ApplyResult {
  const layout = layoutTrackGen(result, settings)
  /*
   * 彎道的方塊要「大的先、小的後」：外側那塊比較大，內側疊在它上面，
   * 露出來的那一圈就是轉彎的軌道帶。順序反了會被外側整個蓋住。
   */
  const ordered = [...layout.shapes].sort((a, b) => {
    const ra = a.kind === 'corner' ? a.outerRadiusM : 0
    const rb = b.kind === 'corner' ? b.outerRadiusM : 0
    return rb - ra
  })
  const mainLateral = {
    down: lateralLookup(result, 'down'),
    up: lateralLookup(result, 'up'),
  }
  const facilities = ordered.map((s) => facilityFor(s, result, mainLateral, nextId()))

  // 平移到原點，Area 才不用容納負座標
  const { xMin, yMin, xMax, yMax } = layout.bounds
  for (const f of facilities) {
    f.box.xM -= xMin
    f.box.yM -= yMin
  }

  return {
    facilities,
    extentM: { wM: Math.max(1, xMax - xMin), hM: Math.max(1, yMax - yMin) },
  }
}
