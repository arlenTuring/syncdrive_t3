import type { FacilityObject } from '../types/facility'
import type { TrackGenSettings } from './trackGenFacility'
import type { TrackGenResult, Vec2 } from './trackGenerator'
import { layoutTrackGen, type LayoutShape } from './trackGenLayout'
import { CORNER_TRACK_KEY, TAPER_TRACK_KEY } from './trackShapes'

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

function realAt(result: TrackGenResult, s: number): Vec2 {
  const xs = result.refStations
  const ps = result.refPoints
  if (!xs.length || !ps.length) return { x: 0, y: 0 }
  if (s <= xs[0]!) return ps[0]!
  if (s >= xs[xs.length - 1]!) return ps[ps.length - 1]!
  let lo = 0
  let hi = xs.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! <= s) lo = mid
    else hi = mid
  }
  const u = (s - xs[lo]!) / Math.max(1e-6, xs[hi]! - xs[lo]!)
  return {
    x: ps[lo]!.x + (ps[hi]!.x - ps[lo]!.x) * u,
    y: ps[lo]!.y + (ps[hi]!.y - ps[lo]!.y) * u,
  }
}

/**
 * 真實座標範圍。
 *
 * 刻意不寫成 refFieldXMinM 那組鍵：那組鍵會參與設施尺寸的推導
 * （見 getFacilitySizeMeters），寫進真實座標會把版面上的方框拉成另一個大小。
 * 真實座標在這裡只是給人對照與日後投影用，不該影響畫面。
 */
function realBounds(result: TrackGenResult, sFrom: number, sTo: number) {
  const a = realAt(result, sFrom)
  const b = realAt(result, sTo)
  return {
    trackGenRealFrom: [Number(a.x.toFixed(2)), Number(a.y.toFixed(2))],
    trackGenRealTo: [Number(b.x.toFixed(2)), Number(b.y.toFixed(2))],
    trackGenSFromM: Number(sFrom.toFixed(2)),
    trackGenSToM: Number(sTo.toFixed(2)),
  }
}

function facilityFor(
  shape: LayoutShape,
  result: TrackGenResult,
  id: string,
): BuiltFacility {
  const meta = realBounds(result, shape.sFrom, shape.sTo)
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
      parameters: { segmentId: shape.name, trackGenRole: shape.role, ...meta },
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
  const facilities = ordered.map((s) => facilityFor(s, result, nextId()))

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
