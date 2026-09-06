/**
 * 生成前先分組、先命名。
 *
 * <h3>為什麼要有這個</h3>
 * 生成出來的軌道名字是機器取的（車道鍵加流水號，像 <code>8:-2-07</code>），現場的人
 * 不是這樣叫它們的——他們講的是「下行 D04」「上行 U03」。以前只能生成完再一塊一塊改名，
 * 幾十塊改到手軟。
 *
 * 所以在預覽上直接框：按 + 進入選取，照順序點過去，那個順序就是編號的順序，再給這一組
 * 一個<strong>頭字</strong>與底色。生成時名字就是「頭字 + 兩位順序」。
 *
 * <h3>頭字為什麼限制兩個大寫字母</h3>
 * 它要接在兩位數字前面，變成 D04、UA12 這種現場叫得出口的代號。太長就不是代號了。
 */

export type TrackGenGroup = {
  id: string
  /** 軌道頭字：一到兩個大寫英文字母 */
  code: string
  /** 這一組的底色 */
  color: string
  /**
   * 這一組的成員，<strong>依選取順序</strong>。
   *
   * 存的是形狀的名字（生成時的 customName），不是索引——參數一改就重排一次，索引會
   * 整個對不上，名字則是照車道與流水號取的，同一份路網重排仍然對得回去。
   */
  members: string[]
}

/** 一組最多幾塊：超過的話編號就不是人記得住的東西了 */
export const MAX_GROUP_MEMBERS = 99

/** 頭字：只留英文字母、轉大寫、最多兩個 */
export function normalizeGroupCode(raw: string): string {
  return raw.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}

/** 這一組第幾塊該叫什麼：頭字 + 兩位順序 */
export function trackGenGroupLabel(code: string, order: number): string {
  return `${code}${String(order + 1).padStart(2, '0')}`
}

/** 預設給的幾個底色，按下 + 就輪著配，不必每次都去挑 */
export const TRACK_GEN_GROUP_COLORS = [
  '#3f6212',
  '#7c2d12',
  '#1e3a5f',
  '#4c1d95',
  '#134e4a',
  '#831843',
] as const

/** 名字 → 它在哪一組、第幾塊 */
export function trackGenGroupIndex(
  groups: TrackGenGroup[],
): Map<string, { code: string; color: string; order: number; groupId: string }> {
  const out = new Map<string, { code: string; color: string; order: number; groupId: string }>()
  for (const g of groups) {
    if (!g.code) continue
    g.members.forEach((name, i) => {
      out.set(name, { code: g.code, color: g.color, order: i, groupId: g.id })
    })
  }
  return out
}
