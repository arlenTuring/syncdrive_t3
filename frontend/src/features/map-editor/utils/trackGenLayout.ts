import { placePoint, placeSpine, type TrackGenSettings } from './trackGenFacility'
import type { LaneRole, TrackGenResult, Vec2 } from './trackGenerator'
import type { CornerTrackGeometry } from './trackShapes'

/**
 * 生成結果 → 版面形狀。
 *
 * <h3>為什麼要有這一層</h3>
 * 預覽與「套用到地圖」原本各自算一次位置，兩邊算法一有差異就對不起來——實際發生
 * 過：套用出來的軌道方向是反的、ㄩ 形也散掉了。現在兩邊都吃這一支的輸出，
 * 對不起來在結構上就不可能。
 *
 * 單位是<strong>版面公尺</strong>：沿線是真實公尺，橫向乘上放大倍率。上下行只差
 * 3.5 公尺，不放大會黏成一條線。真實座標另外由 refPoints 換算，不混在這裡。
 */

export const LANE_W_M = 3.35

export type LayoutRect = {
  kind: 'rect'
  name: string
  role: LaneRole
  /** 中心點（版面公尺） */
  centre: Vec2
  /** 未旋轉前的尺寸：長沿行進方向、寬跨軌道 */
  lengthM: number
  widthM: number
  /** 螢幕座標下的旋轉角（度，順時針為正） */
  rotationDeg: number
  sFrom: number
  sTo: number
}

/**
 * 彎道：一段等寬的弧帶，整段一個物件。
 *
 * 外緣與內緣同心，所以整段等寬、沒有接縫；四個角可以各自調整外緣半徑、
 * 內緣半徑與兩端直段。
 */
export type LayoutCorner = {
  kind: 'corner'
  name: string
  role: LaneRole
  geometry: CornerTrackGeometry
  /** 外接方框（版面公尺，左上原點、y 向下） */
  box: { xM: number; yM: number; wM: number; hM: number }
  /** 外緣半徑，畫的先後用它排序 */
  outerRadiusM: number
  sFrom: number
  sTo: number
  /** 沿弧取樣的中心線，預覽畫形狀與放標籤用 */
  samples: Vec2[]
}

export type LayoutQuad = {
  kind: 'quad'
  name: string
  role: LaneRole
  a: { at: Vec2; widthM: number }
  b: { at: Vec2; widthM: number }
  /** 沿線取樣，供預覽畫出實際形狀 */
  samples: Vec2[]
  sFrom: number
  sTo: number
}

export type LayoutShape = LayoutRect | LayoutCorner | LayoutQuad

export type TrackGenLayout = {
  shapes: LayoutShape[]
  /** 全部形狀的外框（版面公尺） */
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number }
}

const DEG = Math.PI / 180

function rotate(v: Vec2, deg: number): Vec2 {
  const a = deg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

/** 形狀四角，用來算整體外框 */
function rectCorners(r: LayoutRect): Vec2[] {
  const hw = r.lengthM / 2
  const hh = r.widthM / 2
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const q = rotate(p, r.rotationDeg)
    return { x: r.centre.x + q.x, y: r.centre.y + q.y }
  })
}

export function layoutTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
): TrackGenLayout {
  const lt = settings.lateralScale
  const placed = placeSpine(result.spine, 1, settings.cornerRadiusM)
  const bandW = LANE_W_M * lt
  const shapes: LayoutShape[] = []
  const pts: Vec2[] = []

  for (const b of result.blocks) {
    for (const [lat, name, role] of [
      [0, b.nameDown, 'down'],
      [b.lateralM, b.nameUp, 'up'],
    ] as Array<[number, string, LaneRole]>) {
      if (b.spineKind === 'straight') {
        const p0 = placePoint(b.sFrom, lat, placed, lt)
        const p1 = placePoint(b.sTo, lat, placed, lt)
        const rect: LayoutRect = {
          kind: 'rect',
          name,
          role,
          centre: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
          lengthM: Math.hypot(p1.x - p0.x, p1.y - p0.y),
          widthM: bandW,
          rotationDeg: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI,
          sFrom: b.sFrom,
          sTo: b.sTo,
        }
        shapes.push(rect)
        pts.push(...rectCorners(rect))
        continue
      }

      /*
       * 彎道：整段一段弧帶。
       *
       * 用區塊<strong>中點</strong>去找所屬脊線段：區塊里程存進結果時做過四捨五入，
       * 拿端點配 1e-6 的容差會配不到，整個彎道就不見了。
       */
      const mid = (b.sFrom + b.sTo) / 2
      const seg = placed.find((q) => q.kind === 'arc' && mid >= q.sFrom && mid <= q.sTo)
      if (!seg || seg.kind !== 'arc') continue
      const centreRadius = Math.abs(seg.radiusPx - seg.sign * lat * lt)
      const outerR = centreRadius + bandW / 2
      const innerR = Math.max(0, centreRadius - bandW / 2)
      const samples: Vec2[] = []
      for (let i = 0; i <= 16; i += 1) {
        samples.push(placePoint(b.sFrom + ((b.sTo - b.sFrom) * i) / 16, lat, placed, lt))
      }
      /*
       * 方位量化到 90 度的倍數，並由圓心推回方框左上角：未旋轉時圓心在
       * (legIn, outerR)＝(0, outerR)，也就是方框左下角。
       */
      const p0 = samples[0]!
      const p1 = samples[1]!
      const entryDeg =
        (Math.round((Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI / 90) * 90 + 360) % 360
      const geometry: CornerTrackGeometry = {
        arcXRatio: 1,
        arcYRatio: 1,
        // 帶寬佔半徑的比例＝外半徑減內半徑，除以外半徑
        depthRatio: Math.max(0.02, Math.min(1, (outerR - innerR) / Math.max(0.01, outerR))),
        entryDeg,
      }
      const S = outerR
      // 未旋轉時弧的圓心在方框右下角
      const cLocal = { x: S, y: S }
      const centreOfBox = { x: S / 2, y: S / 2 }
      const rel = rotate(
        { x: cLocal.x - centreOfBox.x, y: cLocal.y - centreOfBox.y },
        entryDeg,
      )
      const boxCentre = { x: seg.centre.x - rel.x, y: seg.centre.y - rel.y }
      const box = {
        xM: boxCentre.x - S / 2,
        yM: boxCentre.y - S / 2,
        wM: S,
        hM: S,
      }
      shapes.push({
        kind: 'corner',
        name,
        role,
        geometry,
        box,
        outerRadiusM: outerR,
        sFrom: b.sFrom,
        sTo: b.sTo,
        samples,
      })
      pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
    }
  }

  for (const lane of result.lanes) {
    if (lane.role === 'down' || lane.role === 'up') continue
    if (lane.role === 'crossover' && !settings.showCrossovers) continue
    if (lane.role === 'siding' && !settings.showSidings) continue
    const prof = lane.profile
    if (prof.length < 2) continue
    const samples = prof.map(([s, lat]) => placePoint(s, lat, placed, lt))
    const a = samples[0]!
    const b = samples[samples.length - 1]!
    shapes.push({
      kind: 'quad',
      name: `${lane.role === 'crossover' ? 'X' : 'SD'}-${lane.key.replace(':', '_')}`,
      role: lane.role,
      a: { at: a, widthM: bandW },
      b: { at: b, widthM: bandW },
      samples,
      sFrom: prof[0]![0],
      sTo: prof[prof.length - 1]![0],
    })
    pts.push(...samples)
  }

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    shapes,
    bounds: {
      xMin: Math.min(...xs),
      yMin: Math.min(...ys),
      xMax: Math.max(...xs),
      yMax: Math.max(...ys),
    },
  }
}

/** 沿取樣中心線兩側張開，得到封閉多邊形（預覽用） */
export function bandPolygon(samples: Vec2[], widthM: number): Vec2[] {
  const half = widthM / 2
  const left: Vec2[] = []
  const right: Vec2[] = []
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[Math.max(0, i - 1)]!
    const b = samples[Math.min(samples.length - 1, i + 1)]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const m = Math.hypot(dx, dy) || 1
    const nx = -dy / m
    const ny = dx / m
    left.push({ x: samples[i]!.x + nx * half, y: samples[i]!.y + ny * half })
    right.push({ x: samples[i]!.x - nx * half, y: samples[i]!.y - ny * half })
  }
  return [...left, ...right.reverse()]
}

/** 矩形的四角（預覽用） */
export function rectPolygon(r: LayoutRect): Vec2[] {
  return rectCorners(r)
}
