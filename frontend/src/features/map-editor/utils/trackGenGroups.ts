/**
 * 生成前先分組、先命名。
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

/**
 * 交叉與分岔在圖上是一個元件，在現場卻是<strong>兩條軌道</strong>。
 */
export const CROSS_PARTS = ['up', 'down'] as const
/**
 * 交叉軌道另有兩條斜行：左下→右上（diagUp）與右下→左上（diagDown）。
 *
 * 生成時只分上、下兩條直行（CROSS_PARTS）；斜行是事後在屬性框命名的，所以不進生成流程。
 * 名字只是標籤：「上／下」指圖面上的位置，不代表現場有上行、下行之分。
 */
export const CROSS_DIAG_PARTS = ['diagUp', 'diagDown'] as const
export const SWITCH_PARTS = ['straight', 'branch'] as const
export type TrackGenPart =
  | (typeof CROSS_PARTS)[number]
  | (typeof CROSS_DIAG_PARTS)[number]
  | (typeof SWITCH_PARTS)[number]

/** 這一種形狀分不分成兩半，分的話有哪兩半 */
export function partsOfKind(kind: string): readonly TrackGenPart[] | null {
  if (kind === 'cross') return CROSS_PARTS
  if (kind === 'switch') return SWITCH_PARTS
  return null
}

/** 成員鍵：整塊是形狀名，分半的是「形狀名#哪一半」 */
export function memberKey(shapeName: string, part?: TrackGenPart | null): string {
  return part ? `${shapeName}#${part}` : shapeName
}

/** 把成員鍵拆回形狀名與哪一半 */
export function splitMemberKey(key: string): { name: string; part: TrackGenPart | null } {
  const i = key.lastIndexOf('#')
  if (i < 0) return { name: key, part: null }
  return { name: key.slice(0, i), part: key.slice(i + 1) as TrackGenPart }
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

/**
 * 名字 → 它在哪一組、第幾塊。
 */
export function trackGenGroupIndex(
  groups: TrackGenGroup[],
): Map<string, { code: string; color: string; order: number; groupId: string }> {
  const out = new Map<string, { code: string; color: string; order: number; groupId: string }>()
  for (const g of groups) {
    g.members.forEach((name, i) => {
      out.set(name, { code: g.code, color: g.color, order: i, groupId: g.id })
    })
  }
  return out
}
