import type { FacilityObject } from '../types/facility'
import {
  TRACK_GEN_KIND_COLOR,
  type LayoutShape,
  type TrackGenLayout,
  type Vec2,
} from './trackGenLayout'
import {
  DEFAULT_TRACK_FRAME_STROKE_COLOR,
  DEFAULT_TRACK_FRAME_STROKE_WIDTH_PX,
} from './trackFacility'
import {
  memberKey,
  partsOfKind,
  trackGenGroupIndex,
  trackGenGroupLabel,
  type TrackGenGroup,
} from './trackGenGroups'
import {
  TRACKGEN_PART_COLORS_KEY,
  TRACKGEN_PART_FONT_KEY,
  TRACKGEN_PART_NAMES_KEY,
  DEFAULT_PART_FONT_PX,
} from './trackGenParts'
import { LABEL_STYLE_PARAM_KEY, TRACK_DEFAULT_LABEL_FONT_PX } from './facilityLabelStyle'
import {
  CORNER_TRACK_KEY,
  CROSS_TRACK_KEY,
  SWITCH_TRACK_KEY,
  TAPER_TRACK_KEY,
} from './trackShapes'
import {
  TRACKGEN_LAT_MODE_KEY,
  TRACKGEN_LAT_PER_BOX_KEY,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_SPANS_KEY,
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

/** 場域範圍要往兩側撐半個車道，範圍才蓋得住整條軌道帶 */
const LANE_HALF_W_M = 1.675

/**
 * 這一段軌道在真實場域裡蓋到的範圍，直接寫進「場域範圍」。
 */
function realBounds(path: Vec2[]) {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const p of path) {
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  if (!Number.isFinite(xMin)) return {}
  const r = (v: number) => Number(v.toFixed(2))
  return {
    [REF_FIELD_X_MIN_M]: r(xMin - LANE_HALF_W_M),
    [REF_FIELD_X_MAX_M]: r(xMax + LANE_HALF_W_M),
    [REF_FIELD_Y_MIN_M]: r(yMin - LANE_HALF_W_M),
    [REF_FIELD_Y_MAX_M]: r(yMax + LANE_HALF_W_M),
  }
}

/* ── 車輛投影用的兩條路徑 ─────────────────────────────────────
   通用投影只會沿 refField 的長邊做線性內插：直線段沒問題，圓角是弧就對不上，
   實測車子在轉角處會跳 137 像素。所以每一段都存下「真實路徑」與「圖面路徑」，
   投影時先在真實路徑上求出走了幾成，再照同樣的比例落在圖面路徑上。       */

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

function facilityFor(shape: LayoutShape, id: string): BuiltFacility {
  const path = shape.realPath ?? []
  const meta = realBounds(path)
  const realPath = path.map((p) => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))])
  /*
   * 這一塊代表路網的哪一段：road、lane、里程起訖。
   */
  /*
   * 里程是<strong>照路徑的走向</strong>記的，s0 可以大於 s1（反接的那條腿里程遞減）。
   * 先前這裡寫 `sToM - sFromM > 1e-6`，等於把所有遞減的段當成空的丟掉——分岔元件三段
   * 全被丟光，整塊沒有 trackGenSpans，於是進不了定位索引：實測左側那條長路有 116 公尺
   * 完全查不到任何一塊。要看的是<strong>長度</strong>，不是正負號。
   */
  const spans = (shape.spans ?? [])
    .filter((sp) => Math.abs(sp.sToM - sp.sFromM) > 1e-6)
    .map((sp) => ({
      road: sp.roadId,
      lane: sp.laneId,
      s0: Number(sp.sFromM.toFixed(2)),
      s1: Number(sp.sToM.toFixed(2)),
      h: Number(sp.headingRad.toFixed(4)),
      f0: Number(sp.pathFrom.toFixed(4)),
      f1: Number(sp.pathTo.toFixed(4)),
    }))
  const spanMeta = spans.length ? { [TRACKGEN_SPANS_KEY]: spans } : {}
  /*
   * 底色照<strong>種類</strong>分：一般、圓角、斜接、分岔各一個色。
   * 框線一律深色，相鄰同色塊才分得出界線（深底＋深填時淺色框反而搶戲）。
   */
  const fillMeta = {
    defaultFillColor: TRACK_GEN_KIND_COLOR[shape.kind].fill,
    strokeColor: DEFAULT_TRACK_FRAME_STROKE_COLOR,
    strokeWidthPx: DEFAULT_TRACK_FRAME_STROKE_WIDTH_PX,
    strokeStyle: 'solid' as const,
  }
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
        ...spanMeta,
        ...fillMeta,
        trackGenRole: shape.role,
        trackGenLine: shape.lineKey,
        trackGenLineLengthM: Number(shape.lineLengthM.toFixed(1)),
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
        ...spanMeta,
        ...fillMeta,
        trackGenRole: shape.role,
        trackGenLine: shape.lineKey,
        trackGenLineLengthM: Number(shape.lineLengthM.toFixed(1)),
        [CORNER_TRACK_KEY]: shape.geometry,
        [TRACKGEN_REAL_PATH_KEY]: realPath,
        [TRACKGEN_LOCAL_PATH_KEY]: localPathOf(shape.samples, shape.box, 0),
        ...meta,
      },
      box: { ...shape.box },
    }
  }
  if (shape.kind === 'cross') {
    /*
     * 交叉路口 → 交叉軌道。
     *
     * 外框與四個端面的比例都由排版算好（見 fitCrossAt），這裡照抄。
     */
    return {
      id,
      type: 'Track',
      name: 'RailCross',
      customName: shape.name,
      rotation: 0,
      parameters: {
        segmentId: shape.name,
        ...spanMeta,
        ...fillMeta,
        trackGenRole: shape.role,
        trackGenLine: shape.lineKey,
        trackGenLineLengthM: Number(shape.lineLengthM.toFixed(1)),
        [CROSS_TRACK_KEY]: shape.geometry,
        [TRACKGEN_REAL_PATH_KEY]: realPath,
        [TRACKGEN_LOCAL_PATH_KEY]: localPathOf(shape.samples, shape.box, 0),
        ...meta,
      },
      box: { ...shape.box },
    }
  }
  if (shape.kind === 'switch') {
    /*
     * 路口 → 分岔軌道。
     *
     * 外框與三個端面的比例都由排版算好（見 fitSwitch），這裡照抄。
     */
    return {
      id,
      type: 'Track',
      name: 'RailSwitch',
      customName: shape.name,
      rotation: 0,
      parameters: {
        segmentId: shape.name,
        ...spanMeta,
        ...fillMeta,
        trackGenRole: shape.role,
        trackGenLine: shape.lineKey,
        trackGenLineLengthM: Number(shape.lineLengthM.toFixed(1)),
        [SWITCH_TRACK_KEY]: shape.geometry,
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
      ...spanMeta,
      ...fillMeta,
      trackGenRole: shape.role,
      trackGenLine: shape.lineKey,
      trackGenLineLengthM: Number(shape.lineLengthM.toFixed(1)),
      [TAPER_TRACK_KEY]: shape.geometry,
      [TRACKGEN_REAL_PATH_KEY]: realPath,
      [TRACKGEN_LOCAL_PATH_KEY]: localPathOf(shape.samples, shape.box, 0),
      ...meta,
    },
    box: { ...shape.box },
  }
}

export function buildFacilitiesFromLayout(
  layout: TrackGenLayout,
  nextId: () => string,
  /** 生成前在預覽上分好的組：這一組的軌道照頭字加順序命名，底色也照組設定 */
  groups: TrackGenGroup[] = [],
): ApplyResult {
  /*
   * 彎道的方塊要「大的先、小的後」：外側那塊比較大，內側疊在它上面，
   * 露出來的那一圈就是轉彎的軌道帶。順序反了會被外側整個蓋住。
   */
  const ordered = [...layout.shapes].sort((a, b) => {
    const ra = a.kind === 'corner' ? a.outerRadiusM : 0
    const rb = b.kind === 'corner' ? b.outerRadiusM : 0
    return rb - ra
  })
  const facilities = ordered.map((s) => facilityFor(s, nextId()))

  /*
   * 分好組的軌道<strong>改名改色</strong>。
   */
  const groupOf = trackGenGroupIndex(groups)
  facilities.forEach((f, i) => {
    const shape = ordered[i]
    const parts = shape ? partsOfKind(shape.kind) : null
    /*
     * 交叉與分岔一個元件、兩條軌道，所以名字也是兩個。
     */
    if (parts) {
      const names: Record<string, string> = {}
      const colors: Record<string, string> = {}
      const fonts: Record<string, number> = {}
      for (const part of parts) {
        const hit = groupOf.get(memberKey(f.customName, part))
        if (!hit?.code) continue
        names[part] = trackGenGroupLabel(hit.code, hit.order)
        colors[part] = hit.color
        fonts[part] = DEFAULT_PART_FONT_PX
      }
      const picked = parts.map((p) => names[p]).filter(Boolean)
      if (!picked.length) return
      f.parameters[TRACKGEN_PART_NAMES_KEY] = names
      f.parameters[TRACKGEN_PART_COLORS_KEY] = colors
      f.parameters[TRACKGEN_PART_FONT_KEY] = fonts
      const label = picked.join('/')
      f.customName = label
      f.parameters.segmentId = label
      // 元件只有一個底色：兩半不同色時用先命名的那一半，另一半靠自己的疊色畫
      f.parameters.defaultFillColor = colors[parts.find((p) => names[p])!]
      return
    }
    const hit = groupOf.get(f.customName)
    // 沒填頭字的組只是「選起來了」，還不知道要叫什麼——不改名
    if (!hit?.code) return
    const label = trackGenGroupLabel(hit.code, hit.order)
    f.customName = label
    f.parameters.segmentId = label
    f.parameters.defaultFillColor = hit.color
    // 與分岔／交叉路段字級一致（一般軌道走 labelStyle）
    const prevStyle =
      f.parameters[LABEL_STYLE_PARAM_KEY] &&
      typeof f.parameters[LABEL_STYLE_PARAM_KEY] === 'object'
        ? (f.parameters[LABEL_STYLE_PARAM_KEY] as Record<string, unknown>)
        : {}
    f.parameters[LABEL_STYLE_PARAM_KEY] = {
      ...prevStyle,
      fontSizePx: TRACK_DEFAULT_LABEL_FONT_PX,
    }
  })

  /*
   * 每一塊都記下橫向比例尺：<strong>車子不一定走在軌道上</strong>。
   */
  facilities.forEach((f, i) => {
    if (!f.parameters?.[TRACKGEN_LOCAL_PATH_KEY]) return
    // 逐段量出來的比例優先；沒有的（圓角、分岔）退回全圖的定值
    const scale = ordered[i]?.latScalePerM ?? layout.latScalePerM
    // 圓角的並排軌道是同心弧，偏移量要沿法線；其餘都是照外框的橫軸疊起來的
    if (ordered[i]?.kind === 'corner') f.parameters[TRACKGEN_LAT_MODE_KEY] = 'arc'
    f.parameters[TRACKGEN_LAT_PER_BOX_KEY] = [
      Number((scale / Math.max(1e-6, f.box.wM)).toFixed(6)),
      Number((scale / Math.max(1e-6, f.box.hM)).toFixed(6)),
    ]
  })

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
