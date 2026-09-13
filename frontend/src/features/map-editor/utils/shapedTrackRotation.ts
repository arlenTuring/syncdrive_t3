import type { FacilityObject } from '../types/facility'
import { normalizeDegrees } from './rotation'
import {
  CORNER_TRACK_KEY,
  CROSS_TRACK_KEY,
  readCornerTrack,
  readCrossTrack,
  readSwitchTrack,
  readTaperTrack,
  SWITCH_TRACK_KEY,
  TAPER_TRACK_KEY,
} from './trackShapes'

/** 方位寫在 entryDeg 裡的異形軌道；不應再疊 CSS rotation */
export function isShapedTrackFacility(f: FacilityObject): boolean {
  return (
    f.type === 'Track' &&
    (f.name === 'RailSwitch' ||
      f.name === 'RailCorner' ||
      f.name === 'RailTaper' ||
      f.name === 'RailCross')
  )
}

function shapedEntryDeg(f: FacilityObject): number {
  if (f.name === 'RailSwitch') return readSwitchTrack(f.parameters).entryDeg
  if (f.name === 'RailCorner') return readCornerTrack(f.parameters).entryDeg
  if (f.name === 'RailTaper') return readTaperTrack(f.parameters).entryDeg
  if (f.name === 'RailCross') return readCrossTrack(f.parameters).entryDeg
  return 0
}

function patchShapedEntryDeg(
  f: FacilityObject,
  entryDeg: number,
): Record<string, unknown> {
  if (f.name === 'RailSwitch') {
    return {
      [SWITCH_TRACK_KEY]: { ...readSwitchTrack(f.parameters), entryDeg },
    }
  }
  if (f.name === 'RailCorner') {
    return {
      [CORNER_TRACK_KEY]: { ...readCornerTrack(f.parameters), entryDeg },
    }
  }
  if (f.name === 'RailTaper') {
    return {
      [TAPER_TRACK_KEY]: { ...readTaperTrack(f.parameters), entryDeg },
    }
  }
  if (f.name === 'RailCross') {
    return {
      [CROSS_TRACK_KEY]: { ...readCrossTrack(f.parameters), entryDeg },
    }
  }
  return {}
}

/**
 * 把 CSS rotation（含這次 delta）折進 entryDeg，外框寬高在轉奇數個 90° 時對調，
 * 中心不動，facility.rotation 歸零。
 *
 * 異形軌道的方位本來就在幾何裡；再疊 CSS 旋轉會讓接合端面與畫面錯位、重建後變蝴蝶。
 * 角度吸到最近的 90°（接合只需正交）。
 */
export function bakeShapedTrackRotation(
  f: FacilityObject,
  deltaDeg: number,
): FacilityObject {
  if (!isShapedTrackFacility(f)) {
    return {
      ...f,
      rotation: normalizeDegrees((f.rotation ?? 0) + deltaDeg),
    }
  }

  const prevCss = f.rotation ?? 0
  const total = prevCss + deltaDeg
  const bakeDeg = Math.round(total / 90) * 90
  const qAdd = (((Math.round(bakeDeg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3
  const newEntryDeg = normalizeDegrees(shapedEntryDeg(f) + bakeDeg)

  const w0 = Math.max(1, f.areaSizePx?.w ?? 1)
  const h0 = Math.max(1, f.areaSizePx?.h ?? 1)
  const x0 = f.areaPosition?.x ?? 0
  const y0 = f.areaPosition?.y ?? 0
  const cx = x0 + w0 / 2
  const cy = y0 + h0 / 2
  const needSwap = qAdd % 2 === 1
  const w = needSwap ? h0 : w0
  const h = needSwap ? w0 : h0
  const x = cx - w / 2
  const y = cy - h / 2

  return {
    ...f,
    rotation: 0,
    areaSizePx: { w, h },
    areaPosition: { x, y },
    parameters: {
      ...(f.parameters ?? {}),
      ...patchShapedEntryDeg(f, newEntryDeg),
    },
  }
}
