import type { FacilityObject } from '../types/facility'
import { getValidRefFieldBounds } from '../utils/facilityRefFieldBounds'
import { normalizeDegrees } from '../utils/rotation'

/**
 * 停妥在格位裡的車：把<strong>現場的車頭方向</strong>換成<strong>圖面格子的方向</strong>。
 *
 * <h3>為什麼要換</h3>
 * 圖面是示意圖，格子的形狀可以跟現場不一樣：H1 現場是直的（7.4 × 14.35 公尺），版面改版後
 * 圖上畫成橫的（91 × 47 px）。車照現場 heading 轉，就會直立地橫跨在橫格上。道路早就照
 * 「那一塊畫出來的方向」轉（drawnRotateWithSwingDeg），格位一直沒有，退回直接照 heading。
 *
 * <h3>怎麼換</h3>
 * 1. 現場長軸 fieldAxis：格位場域範圍（無旋轉的 AABB）寬 &gt; 高為 0、高 &gt; 寬為 π/2。
 * 2. 圖面長軸 drawAxis：格子的 areaSizePx 加上它自己的旋轉（CSS 順時針；區域座標 y 向上，
 *    所以換成逆時針要取負號）。
 * 3. 兩軸差 delta 取在 (−π/2, π/2]，現場 heading 整個轉 delta：車頭對著長軸正向的、反向的，
 *    換過去後仍然一正一反（差 180°），不會全部朝同一邊；在格子裡歪一點的角度也照樣保留。
 *    兩軸剛好差 90° 時固定取 +π/2（逆時針轉），同一張圖每次結果一樣。
 *
 * 只改畫面角度：真實座標、heading、格位公尺範圍一律不動。每次 render 都從當前圖資算，
 * 格子改橫改直、縮放、旋轉之後，畫面載入新版圖資就跟著換，不需要車再動一次。
 *
 * 資料不足（沒有場域範圍、沒有圖面尺寸、正方形分不出長軸、沒有 heading）時不猜，
 * 回傳原本的 heading 與原因，呼叫端照舊畫。
 */
export type YardSlotHeadingMapping = {
  /** 畫面要用的車頭方向（弧度，區域座標：東為 0、逆時針為正） */
  headingRad: number | null
  /** 現場長軸 → 圖面長軸轉了多少（弧度）；沒有換時是 0 */
  deltaRad: number
  /** mapped：已換；其餘是沒換的原因 */
  reason: 'mapped' | 'no-heading' | 'no-field-bounds' | 'no-drawn-size' | 'square-field' | 'square-drawn'
}

/** 長寬差不到這個比例視為正方形：分不出長軸就不換 */
const SQUARE_RATIO = 0.02

function axisOf(w: number, h: number): number | null {
  if (!(w > 0) || !(h > 0)) return null
  if (Math.abs(w - h) <= SQUARE_RATIO * Math.max(w, h)) return null
  return w > h ? 0 : Math.PI / 2
}

/** 角度差換成 (−π/2, π/2]：軸沒有正反，轉最少的那一邊 */
function axisDelta(rad: number): number {
  let d = rad % Math.PI
  if (d <= -Math.PI / 2) d += Math.PI
  if (d > Math.PI / 2) d -= Math.PI
  // 浮點誤差把 +π/2 推成 −π/2 時拉回來，維持固定取 +π/2
  if (Math.abs(d + Math.PI / 2) < 1e-9) d = Math.PI / 2
  return d
}

export function mapYardSlotHeading(
  slot: Pick<FacilityObject, 'parameters' | 'areaSizePx' | 'rotation'>,
  headingRad: number | null | undefined,
): YardSlotHeadingMapping {
  if (headingRad == null || !Number.isFinite(headingRad)) {
    return { headingRad: null, deltaRad: 0, reason: 'no-heading' }
  }
  const unchanged = (reason: YardSlotHeadingMapping['reason']): YardSlotHeadingMapping => ({
    headingRad,
    deltaRad: 0,
    reason,
  })
  const bounds = getValidRefFieldBounds(slot.parameters)
  if (!bounds) return unchanged('no-field-bounds')
  const fieldAxis = axisOf(bounds.xMaxM - bounds.xMinM, bounds.yMaxM - bounds.yMinM)
  if (fieldAxis == null) return unchanged('square-field')
  const size = slot.areaSizePx
  if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h)) return unchanged('no-drawn-size')
  const drawnLocalAxis = axisOf(size.w, size.h)
  if (drawnLocalAxis == null) return unchanged('square-drawn')
  const rotRad = (normalizeDegrees(slot.rotation ?? 0) * Math.PI) / 180
  const drawAxis = drawnLocalAxis - rotRad
  const deltaRad = axisDelta(drawAxis - fieldAxis)
  return { headingRad: headingRad + deltaRad, deltaRad, reason: 'mapped' }
}
