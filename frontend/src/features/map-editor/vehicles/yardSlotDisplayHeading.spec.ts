import { describe, expect, it } from 'vitest'
import { mapYardSlotHeading } from './yardSlotDisplayHeading'

const slot = (fieldW: number, fieldH: number, w: number, h: number, rotation?: number) => ({
  parameters: { refFieldXMinM: 0, refFieldXMaxM: fieldW, refFieldYMinM: 0, refFieldYMaxM: fieldH },
  areaSizePx: { w, h },
  rotation: rotation as never,
})
const deg = (rad: number | null) => (rad == null ? null : Math.round(((rad * 180) / Math.PI) * 1e6) / 1e6)
const R = Math.PI / 180

describe('格位車頭：現場長軸 → 圖面長軸', () => {
  it('直的場域、橫的圖面：轉 90°，正反兩個車頭仍然相反', () => {
    const s = slot(7.4, 14.35, 91, 47.09)
    expect(deg(mapYardSlotHeading(s, 90 * R).headingRad)).toBe(180)
    expect(deg(mapYardSlotHeading(s, -90 * R).headingRad)).toBe(0)
    expect(mapYardSlotHeading(s, 90 * R).reason).toBe('mapped')
  })

  it('方向一致的格位不轉（E1 橫對橫、舊版直對直）', () => {
    expect(mapYardSlotHeading(slot(18.17, 2.54, 91, 47.09), 0).deltaRad).toBe(0)
    expect(mapYardSlotHeading(slot(7.4, 14.35, 47.98, 69.73), 90 * R).deltaRad).toBe(0)
  })

  it('格位內的小偏角照樣保留', () => {
    expect(deg(mapYardSlotHeading(slot(7.4, 14.35, 91, 47.09), 95 * R).headingRad)).toBe(185)
  })

  it('格位自己的旋轉算進圖面長軸（CSS 順時針，區域座標逆時針）', () => {
    // 橫格順時針轉 90° 畫出來是直的：跟直的場域一致，不轉
    expect(mapYardSlotHeading(slot(7.4, 14.35, 91, 47.09, 90), 90 * R).deltaRad).toBeCloseTo(0, 9)
    // 橫格轉 30°：長軸在區域座標 −30°；直場域轉到那裡要 −120°，取軸差 (−90°, 90°] → 60°
    expect(deg(mapYardSlotHeading(slot(7.4, 14.35, 91, 47.09, 30), 0).deltaRad)).toBe(60)
  })

  it('分不出長軸、沒有資料時不猜，回原本的 heading 與原因', () => {
    expect(mapYardSlotHeading(slot(10, 10, 91, 47), 1).reason).toBe('square-field')
    expect(mapYardSlotHeading(slot(7, 14, 50, 50), 1).reason).toBe('square-drawn')
    expect(mapYardSlotHeading(slot(7, 14, 50, 50), 1).headingRad).toBe(1)
    expect(mapYardSlotHeading({ parameters: {}, areaSizePx: { w: 91, h: 47 } }, 1).reason).toBe('no-field-bounds')
    expect(mapYardSlotHeading({ ...slot(7, 14, 1, 1), areaSizePx: undefined }, 1).reason).toBe('no-drawn-size')
    expect(mapYardSlotHeading(slot(7, 14, 91, 47), null)).toEqual({ headingRad: null, deltaRad: 0, reason: 'no-heading' })
  })

  it('兩軸剛好差 90° 時固定取 +90°（同一張圖每次結果一樣）', () => {
    expect(deg(mapYardSlotHeading(slot(7.4, 14.35, 91, 47.09), 0).deltaRad)).toBe(90)
    expect(deg(mapYardSlotHeading(slot(14.35, 7.4, 47.09, 91), 0).deltaRad)).toBe(90)
  })
})
