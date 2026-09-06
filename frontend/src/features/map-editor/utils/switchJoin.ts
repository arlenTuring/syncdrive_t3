import { switchTrackEndSegmentsPx, type SwitchTrackGeometry } from './trackShapes'
import type { EndSegment } from './taperJoin'

/**
 * 由三條端面線段反推分岔軌道的外框與幾何。
 *
 * <h3>為什麼需要這個</h3>
 * 分岔軌道有三個面：進口一個、直行與岔出各一個。使用者把某一個面拖到別條軌道的邊上，
 * 接合的結果就是「這一面等於那條邊」——連位置帶寬度一起吃過來。剩下的工作是把三條
 * 線段換算回元件自己的外框與六個比例。
 *
 * 這與斜接軌道是同一套做法（見 {@link ./taperJoin}），差別只在面從兩個變成三個，
 * 而且其中兩個共用同一側。
 *
 * <h3>方位不用推的，用試的</h3>
 * 四種方位 × 兩種比例方向全部算一次，再用元件自己的端面函式驗證，挑真的對得上的那一種。
 * 自己推旋轉方向很容易錯，而畫面上只看得出「怪怪的」，很難聯想到是方位反了。
 *
 * <h3>限制</h3>
 * 三個面在未旋轉時都是與軸對齊的平行線段，而且進口必須在另外兩個的對側。三條線段
 * 不同向、或進口跟出口跑到同一側時，這個元件表示不出來，回傳 null，呼叫端維持原狀。
 */

const AXIS_EPS = 1.5
const QUARTERS = [0, 90, 180, 270] as const

type Built = {
  geometry: SwitchTrackGeometry
  box: { x: number; y: number; w: number; h: number }
}

/** 兩條線段的最大端點誤差（允許端點順序相反） */
function segError(got: EndSegment, want: EndSegment): number {
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y)
  return Math.min(
    Math.max(d(got[0], want[0]), d(got[1], want[1])),
    Math.max(d(got[0], want[1]), d(got[1], want[0])),
  )
}

export function buildSwitchFromEndSegments(
  a: EndSegment,
  m: EndSegment,
  b: EndSegment,
): Built | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  const vertical = flat(a, 'x') && flat(m, 'x') && flat(b, 'x')
  const horizontal = flat(a, 'y') && flat(m, 'y') && flat(b, 'y')
  if (!vertical && !horizontal) return null

  /*
   * 進口要在出口的對側。同側的話那不是一個分岔，是三條並排的面——這個元件畫不出來。
   */
  const side = (s: EndSegment) => (vertical ? (s[0].x + s[1].x) / 2 : (s[0].y + s[1].y) / 2)
  const sideA = side(a)
  const sideM = side(m)
  const sideB = side(b)
  if (Math.abs(sideM - sideB) > AXIS_EPS) return null
  if (Math.abs(sideA - sideM) <= AXIS_EPS) return null

  const pts = [...a, ...m, ...b]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
  if (box.w < 1 || box.h < 1) return null

  // 比例量的是「沿著面的那個方向」——面是與行進方向垂直的那條短邊
  const along = (p: { x: number; y: number }) => (vertical ? p.y : p.x)
  const span = vertical ? box.h : box.w
  const base = vertical ? box.y : box.x
  const r = (p: { x: number; y: number }) => (along(p) - base) / span

  let best: { built: Built; err: number } | null = null
  for (const entryDeg of QUARTERS) {
    for (const rev of [false, true]) {
      const rr = (p: { x: number; y: number }) => (rev ? 1 - r(p) : r(p))
      const geometry: SwitchTrackGeometry = {
        aFrom: rr(a[0]),
        aTo: rr(a[1]),
        mFrom: rr(m[0]),
        mTo: rr(m[1]),
        bFrom: rr(b[0]),
        bTo: rr(b[1]),
        entryDeg,
      }
      const segs = switchTrackEndSegmentsPx(geometry, box.w, box.h)
      const shift = (p: { x: number; y: number }) => ({ x: box.x + p.x, y: box.y + p.y })
      const got = {
        a: [shift(segs.a[0]), shift(segs.a[1])] as EndSegment,
        m: [shift(segs.m[0]), shift(segs.m[1])] as EndSegment,
        b: [shift(segs.b[0]), shift(segs.b[1])] as EndSegment,
      }
      /*
       * 兩個出口誰是直行、誰是岔出，由使用者拖的是哪一個把手決定，這裡不重排；
       * 但整體方位可能把兩者對調，所以兩種配對都算，取小的。
       */
      const err = Math.min(
        Math.max(segError(got.a, a), segError(got.m, m), segError(got.b, b)),
        Math.max(segError(got.a, a), segError(got.m, b), segError(got.b, m)),
      )
      if (!best || err < best.err) best = { built: { geometry, box }, err }
    }
  }
  if (!best || best.err > 2) return null
  return best.built
}

/**
 * 把一個面換成目標邊之後，三個面該長什麼樣。
 *
 * 兩個出口<strong>共用同一側</strong>——這是形狀本來就有的限制，不是這裡多加的規則。
 * 所以把其中一個出口接到別條軌道上時，另一個出口得跟著挪到同一條線上：它在那條線上
 * 的位置不變，只是離進口的遠近跟著改。拖的是進口就沒有這個問題，它自己一側。
 *
 * 目標邊必須與現在的三個面同向（都垂直或都水平）；不同向時這個元件表示不出來，
 * 回傳 null，呼叫端就不該亮綠燈。
 */
export function alignSwitchFaces(
  cur: { a: EndSegment; m: EndSegment; b: EndSegment },
  end: 'a' | 'm' | 'b',
  target: EndSegment,
): { a: EndSegment; m: EndSegment; b: EndSegment } | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  const axis: 'x' | 'y' | null = flat(target, 'x') ? 'x' : flat(target, 'y') ? 'y' : null
  if (!axis) return null
  if (!flat(cur.a, axis) || !flat(cur.m, axis) || !flat(cur.b, axis)) return null

  const side = (target[0][axis] + target[1][axis]) / 2
  const moveTo = (s: EndSegment): EndSegment =>
    [
      { ...s[0], [axis]: side },
      { ...s[1], [axis]: side },
    ] as unknown as EndSegment

  if (end === 'a') return { ...cur, a: target }
  const sibling = end === 'm' ? 'b' : 'm'
  return { ...cur, [end]: target, [sibling]: moveTo(cur[sibling]) } as {
    a: EndSegment
    m: EndSegment
    b: EndSegment
  }
}
