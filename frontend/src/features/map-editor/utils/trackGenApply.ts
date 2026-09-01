import type { FacilityObject } from '../types/facility'
import {
  placePoint,
  placeSpine,
  type TrackGenSettings,
} from './trackGenFacility'
import type { SpineSegment, TrackGenResult, Vec2 } from './trackGenerator'
import { CORNER_TRACK_KEY, TAPER_TRACK_KEY } from './trackShapes'

/**
 * 把生成結果轉成真正的設施。
 *
 * <h3>三種軌道各對應生成結果的哪一部分</h3>
 * <ul>
 *   <li>直線段的每一塊 → 一般軌道（矩形）。逐塊獨立，才能個別拉伸與設定屬性。</li>
 *   <li>每一段彎道 → <strong>一個</strong>圓角軌道。彎道是一個物件，不是十幾塊碎片；
 *       切成碎片正是先前看起來破碎的原因。</li>
 *   <li>渡線與側線 → 斜接軌道。兩端各自帶寬度，端點可再吸附到別的軌道。</li>
 * </ul>
 *
 * <h3>兩套座標</h3>
 * 圖面位置用<strong>示意座標</strong>：沿線是真實公尺，橫向乘上放大倍率——上下行只差
 * 3.5 公尺，不放大就會黏成一條線。真實座標另外寫進 refField，兩者分開存，和地圖
 * 其他設施的做法一致。
 */

export type ApplyResult = {
  facilities: Array<Omit<FacilityObject, 'areaPosition' | 'position'> & {
    /** 示意座標（公尺，左上原點、y 向下） */
    layout: { xM: number; yM: number; wM: number; hM: number }
  }>
  /** 全部設施的示意座標外框，用來決定 Area 大小 */
  extentM: { wM: number; hM: number }
}

const LANE_W_M = 3.35

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

function refFieldPatch(result: TrackGenResult, sFrom: number, sTo: number) {
  const a = realAt(result, sFrom)
  const b = realAt(result, sTo)
  return {
    refFieldXMinM: Number(Math.min(a.x, b.x).toFixed(2)),
    refFieldXMaxM: Number(Math.max(a.x, b.x).toFixed(2)),
    refFieldYMinM: Number(Math.min(a.y, b.y).toFixed(2)),
    refFieldYMaxM: Number(Math.max(a.y, b.y).toFixed(2)),
  }
}

/** 走向（度）→ 設施旋轉角。示意圖只有 45 度的倍數。 */
function rotationForHeading(hdgDeg: number): number {
  // 真實航向以東為 0、逆時針為正；圖面 y 向下，所以旋轉取負值
  return -(((hdgDeg % 360) + 360) % 360)
}

export function buildFacilitiesFromTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
  nextId: () => string,
): ApplyResult {
  const lt = settings.lateralScale
  const placed = placeSpine(result.spine, 1, settings.cornerRadiusM)
  const out: ApplyResult['facilities'] = []
  const pts: Vec2[] = []

  const push = (
    type: FacilityObject['type'],
    name: FacilityObject['name'],
    customName: string,
    layout: { xM: number; yM: number; wM: number; hM: number },
    rotation: number,
    parameters: Record<string, unknown>,
  ) => {
    pts.push({ x: layout.xM, y: layout.yM })
    pts.push({ x: layout.xM + layout.wM, y: layout.yM + layout.hM })
    out.push({
      id: nextId(),
      type,
      name,
      customName,
      rotation,
      currentState: null,
      layout,
      parameters,
    } as ApplyResult['facilities'][number])
  }

  const arcSegments = result.spine.filter((s): s is Extract<SpineSegment, { kind: 'arc' }> => s.kind === 'arc')

  // ── 直線段：逐塊一個一般軌道 ──────────────────────────────
  for (const b of result.blocks) {
    if (b.spineKind === 'arc') continue
    const seg = result.spine.find((s) => b.sFrom >= s.sFrom && b.sTo <= s.sTo + 1e-6)
    const hdg = seg && seg.kind === 'straight' ? seg.hdgDeg : 0
    for (const [lat, name] of [
      [0, b.nameDown],
      [b.lateralM, b.nameUp],
    ] as Array<[number, string]>) {
      const p0 = placePoint(b.sFrom, lat, placed, lt)
      const p1 = placePoint(b.sTo, lat, placed, lt)
      const cx = (p0.x + p1.x) / 2
      const cy = (p0.y + p1.y) / 2
      const wM = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      const hM = LANE_W_M * lt
      push(
        'Track',
        'Rail',
        name,
        { xM: cx - wM / 2, yM: cy - hM / 2, wM, hM },
        rotationForHeading(hdg),
        {
          segmentId: name,
          trackGenSFromM: b.sFrom,
          trackGenSToM: b.sTo,
          ...refFieldPatch(result, b.sFrom, b.sTo),
        },
      )
    }
  }

  // ── 彎道：每一段一個圓角軌道（不切碎） ────────────────────
  arcSegments.forEach((arc, i) => {
    for (const [lat, prefix] of [
      [0, 'D'],
      [result.blocks.find((b) => b.spineKind === 'arc')?.lateralM ?? 3.5, 'U'],
    ] as Array<[number, string]>) {
      const radiusM = Math.max(0.5, settings.cornerRadiusM - (lat * lt) * Math.sign(arc.turnDeg || -1))
      const legM = 0
      const widthM = LANE_W_M * lt
      const half = widthM / 2
      const sizeW = legM + radiusM + half
      const sizeH = legM + radiusM + half
      const start = placePoint(arc.sFrom, lat, placed, lt)
      push(
        'Track',
        'RailCorner',
        `${prefix}C${i + 1}`,
        { xM: start.x, yM: start.y - half, wM: sizeW, hM: sizeH },
        0,
        {
          [CORNER_TRACK_KEY]: {
            widthM,
            radiusM,
            legInM: legM,
            legOutM: legM,
            turnDeg: arc.turnDeg,
          },
          ...refFieldPatch(result, arc.sFrom, arc.sTo),
        },
      )
    }
  })

  // ── 渡線與側線：斜接軌道 ──────────────────────────────────
  for (const lane of result.lanes) {
    if (lane.role === 'down' || lane.role === 'up') continue
    if (lane.role === 'crossover' && !settings.showCrossovers) continue
    if (lane.role === 'siding' && !settings.showSidings) continue
    const prof = lane.profile
    if (prof.length < 2) continue
    const a = placePoint(prof[0]![0], prof[0]![1], placed, lt)
    const b = placePoint(prof[prof.length - 1]![0], prof[prof.length - 1]![1], placed, lt)
    const widthM = LANE_W_M * lt
    push(
      'TrackCrossover',
      'RailTaper',
      `${lane.role === 'crossover' ? 'X' : 'SD'}-${lane.key.replace(':', '_')}`,
      {
        xM: Math.min(a.x, b.x),
        yM: Math.min(a.y, b.y),
        wM: Math.max(1, Math.abs(b.x - a.x)),
        hM: Math.max(1, Math.abs(b.y - a.y)),
      },
      0,
      {
        [TAPER_TRACK_KEY]: {
          a: { xM: a.x, yM: a.y, widthM, attachedTrackId: null },
          b: { xM: b.x, yM: b.y, widthM, attachedTrackId: null },
        },
        trackGenRole: lane.role,
        sourceLane: lane.key,
        ...refFieldPatch(result, prof[0]![0], prof[prof.length - 1]![0]),
      },
    )
  }

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  // 平移到原點，Area 才不用容納負座標
  for (const f of out) {
    f.layout.xM -= minX
    f.layout.yM -= minY
  }
  for (const f of out) {
    const taper = f.parameters?.[TAPER_TRACK_KEY] as
      | { a: { xM: number; yM: number }; b: { xM: number; yM: number } }
      | undefined
    if (taper) {
      taper.a.xM -= minX
      taper.a.yM -= minY
      taper.b.xM -= minX
      taper.b.yM -= minY
    }
  }

  return {
    facilities: out,
    extentM: {
      wM: Math.max(1, Math.max(...xs) - minX),
      hM: Math.max(1, Math.max(...ys) - minY),
    },
  }
}
