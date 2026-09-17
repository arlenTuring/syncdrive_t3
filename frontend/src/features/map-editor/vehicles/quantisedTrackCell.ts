import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  getTrackGenLatMode,
  getTrackGenLatPerBox,
  getTrackGenPaths,
  projectAlongPath,
} from '../utils/trackGenPaths'
import {
  offsetLocalPoint,
  trackLocalPathPointToAreaLocal,
} from './resolveVehicleTrackPlacement'

/**
 * 車輛在軌道上的位置改成<strong>格</strong>，不再是連續座標。
 *
 * <h3>為什麼要格化</h3>
 * 示意圖每一塊的比例尺差很多：沿線方向同樣一公尺，在 D01 佔 0.52 像素、在分岔處佔
 * 6.8 像素，差十三倍。車要照真實長度畫，在每一塊上就得換一個大小——同一台車走過
 * 一圈，一路又脹又縮。
 *
 * 但那個比例尺是<strong>示意圖的產物，不是現場的事實</strong>。既然圖上的距離本來
 * 就不成比例，那用它來決定車的大小也沒有意義。改成「這一塊分成四格，車在第幾格」，
 * 位置照樣看得出來，車就可以固定大小。
 *
 * <h3>橫向</h3>
 * 偏移量也一樣分級：在中間、貼著某一邊、或者整台已經在軌道外面。看的是偏移量佔
 * 半個軌道寬的幾成，不是連續飄移。
 */

/** 沿線分幾格 */
export const ALONG_CELLS = 4

/** 軌道半寬（公尺）。偏移量除以它就是「佔半邊的幾成」。 */
export const TRACK_HALF_WIDTH_M = 1.675

/**
 * 偏移在半寬的這個比例以內算「還在中間」。
 *
 * 再往外就貼邊：15%～100% 貼那一側的邊界，超過 100% 整台離開帶子。三段的分界都
 * 以半寬為尺，所以中間帶收窄之後，貼邊那一段自然跟著變寬，不必另外分配。
 */
export const LATERAL_CENTRE_RATIO = 0.15

/**
 * 換格要越過邊界這麼多才算數。
 *
 * 沒有這一段，車停在 49.9% 附近時座標一抖就會在兩格之間來回跳。
 */
export const CELL_HYSTERESIS = 0.02

/** −2 整台在左外、−1 貼左緣、0 在中間、1 貼右緣、2 整台在右外 */
export type LateralCell = -2 | -1 | 0 | 1 | 2

/**
 * 偏移超過半寬的這個倍數，就<strong>不要再格化</strong>。
 *
 * 格化的前提是「車在這條軌道上」——把它歸到四格之一才有意義。車要是離軌道好幾
 * 公尺（進出場區那一段就是這樣，場區不在路網裡，路徑是直線接過去的），硬吸到某
 * 一格等於把它畫到一個它根本不在的地方。實測一台離最近中心線 4.85 公尺的車被
 * 吸到格子上，畫出來差了十幾公尺。
 *
 * 超過就改用連續座標：畫在它真正的位置，偏多少就偏多少。位置可以不精確，但不能
 * 說謊。
 */
export const OFF_TRACK_RATIO = 1

export type TrackCell = {
  /** 0–3；車放在 cell × 25% 的位置 */
  cell: number
  lateral: LateralCell
  /**
   * 未格化的原始值。
   *
   * 位置是格化的，<strong>數值不是</strong>：畫在哪一格是為了讓車固定大小、看得出
   * 在這一塊的哪一段，但「實際偏離中心線多少」是現場的事實，要照原樣顯示。
   */
  alongRaw: number
  lateralRatio: number
  /** 離中心線多遠（公尺，左正右負） */
  offsetM: number
  /** 已經離開這條軌道，格化沒有意義——畫在真正的位置上 */
  offTrack: boolean
}

/**
 * 沿線落在第幾格。
 *
 * 給了上一次的格號就套用遲滯：要越過邊界 {@link CELL_HYSTERESIS} 才換。
 */
export function quantiseAlong(along: number, previous?: number): number {
  const clamped = Math.min(1, Math.max(0, along))
  const raw = Math.min(ALONG_CELLS - 1, Math.floor(clamped * ALONG_CELLS))
  if (previous === undefined || previous === raw) return raw
  // 還沒離開上一格夠遠就先不換
  const lo = previous / ALONG_CELLS - CELL_HYSTERESIS
  const hi = (previous + 1) / ALONG_CELLS + CELL_HYSTERESIS
  if (clamped >= lo && clamped <= hi) return previous
  return raw
}

/** 偏移量（公尺，左正右負）落在哪一級 */
export function quantiseLateral(sideM: number): LateralCell {
  const ratio = sideM / TRACK_HALF_WIDTH_M
  const sign = ratio >= 0 ? 1 : -1
  const mag = Math.abs(ratio)
  if (mag <= LATERAL_CENTRE_RATIO) return 0
  if (mag <= 1) return (sign * 1) as LateralCell
  return (sign * 2) as LateralCell
}

/** 這一級橫向要移出去多少公尺 */
function lateralMeters(cell: LateralCell): number {
  // 貼邊＝車身中心壓在軌道邊界上（一半探出去）；再外一級＝整台離開帶子
  return cell * TRACK_HALF_WIDTH_M
}

/**
 * 這台車在這一塊上的格位，以及格化之後要畫在哪個區域座標。
 *
 * 沒有生成路徑的方塊回 null——那種塊沒有中心線可以分格。
 */
export function quantisedTrackCellPlacement(
  track: FacilityObject,
  area: MapAreaObject,
  xM: number,
  yM: number,
  previousCell?: number,
  /**
   * 挑塊時已經投影算好的值。
   *
   * 有就直接用：那正是「決定這台車屬於這一塊」所依據的同一組數字。再投影一次會在
   * 邊界附近得到不一樣的答案——實測同一個點，挑塊算 0.75、這裡重算 0.7499，差一格。
   */
  projected?: { along: number; side: number },
): (TrackCell & { x: number; y: number }) | null {
  const paths = getTrackGenPaths(track.parameters)
  if (!paths) return null

  const { along, side } = projected ?? projectAlongPath(paths.real, xM, yM)
  const cell = quantiseAlong(along, previousCell)
  const lateral = quantiseLateral(side)

  const point = offsetLocalPoint(
    paths.local,
    cell / ALONG_CELLS,
    lateralMeters(lateral),
    getTrackGenLatPerBox(track.parameters),
    getTrackGenLatMode(track.parameters),
  )
  const local = trackLocalPathPointToAreaLocal(track, area, point)
  return {
    cell,
    lateral,
    alongRaw: along,
    lateralRatio: side / TRACK_HALF_WIDTH_M,
    offsetM: side,
    offTrack: Math.abs(side / TRACK_HALF_WIDTH_M) > OFF_TRACK_RATIO,
    x: local.x,
    y: local.y,
  }
}
