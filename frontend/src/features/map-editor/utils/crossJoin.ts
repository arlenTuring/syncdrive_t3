import {
  crossTrackEndSegmentsPx,
  type CrossHandleKey,
  type CrossTrackGeometry,
} from './trackShapes'
import type { EndSegment } from './taperJoin'

/**
 * 由四條端面線段反推交叉軌道的外框與幾何。
 *
 * <h3>為什麼需要這個</h3>
 * 交叉軌道有四個面。使用者把其中一個面拖到別條軌道的邊上，接合的結果就是「這一面
 * 等於那條邊」——連位置帶寬度一起吃過來。剩下的工作是把四條線段換算回元件自己的
 * 外框與四組比例。
 *
 * 與分岔軌道同一套做法（見 {@link ./switchJoin}），差別只在面從三個變成四個，
 * 而且是兩兩對接：左上接右下、左下接右上。
 *
 * <h3>方位不用推的，用試的</h3>
 * 四種方位 × 兩種比例方向全部算一次，再用元件自己的端面函式驗證，挑真的對得上的
 * 那一種。自己推旋轉方向很容易錯，畫面上卻只看得出「怪怪的」。
 *
 * <h3>限制</h3>
 * 四個面必須同向（都垂直或都水平），而且左邊那兩個要在右邊那兩個的同一側——不然
 * 兩條帶子會翻過來自交，這個元件表示不出來，回傳 null，呼叫端維持原狀。
 */

const AXIS_EPS = 1.5
const QUARTERS = [0, 90, 180, 270] as const
const KEYS: CrossHandleKey[] = ['lt', 'lb', 'rt', 'rb']

type Faces = Record<CrossHandleKey, EndSegment>

type Built = {
  geometry: CrossTrackGeometry
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

export function buildCrossFromEndSegments(faces: Faces): Built | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  const vertical = KEYS.every((k) => flat(faces[k], 'x'))
  const horizontal = KEYS.every((k) => flat(faces[k], 'y'))
  if (!vertical && !horizontal) return null

  const pts = KEYS.flatMap((k) => faces[k])
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
  if (box.w < 1 || box.h < 1) return null

  // 跨過面的那個方向：面是與行進方向垂直的短邊
  const across = (p: { x: number; y: number }) => (vertical ? p.y : p.x)
  const acrossSpan = Math.max(1e-6, vertical ? box.h : box.w)
  const acrossBase = vertical ? box.y : box.x
  const r = (p: { x: number; y: number }) => (across(p) - acrossBase) / acrossSpan
  // 沿著行進方向的位置：四個面各伸各的，所以每一面都有自己的 at
  const alongSpan = Math.max(1e-6, vertical ? box.w : box.h)
  const alongBase = vertical ? box.x : box.y
  const at = (s: EndSegment) =>
    ((vertical ? (s[0].x + s[1].x) / 2 : (s[0].y + s[1].y) / 2) - alongBase) / alongSpan

  /*
   * 左邊那兩個面要在右邊那兩個的<strong>同一側</strong>。跨過去的話帶子會翻面自交，
   * 畫出來是兩個三角形，不是交叉。
   */
  const leftAt = Math.max(at(faces.lt), at(faces.lb))
  const rightAt = Math.min(at(faces.rt), at(faces.rb))
  if (leftAt >= rightAt) return null

  /*
   * 兩條<strong>直行</strong>的帶子不能互相穿過：上面那條在左邊排在上面，到了右邊
   * 也要排在上面。反過來的話本體會自己打結，四條路徑就不成立了。
   */
  const acrossMid = (s: EndSegment) => (across(s[0]) + across(s[1])) / 2
  const dLeft = acrossMid(faces.lt) - acrossMid(faces.lb)
  const dRight = acrossMid(faces.rt) - acrossMid(faces.rb)
  if (Math.abs(dLeft) < AXIS_EPS || Math.abs(dRight) < AXIS_EPS) return null
  if (Math.sign(dLeft) !== Math.sign(dRight)) return null

  let best: { built: Built; err: number } | null = null
  for (const entryDeg of QUARTERS) {
    for (const rev of [false, true]) {
      const rr = (p: { x: number; y: number }) => (rev ? 1 - r(p) : r(p))
      const face = (s: EndSegment) => ({ at: at(s), from: rr(s[0]), to: rr(s[1]) })
      const geometry: CrossTrackGeometry = {
        lt: face(faces.lt),
        lb: face(faces.lb),
        rt: face(faces.rt),
        rb: face(faces.rb),
        entryDeg,
      }
      const segs = crossTrackEndSegmentsPx(geometry, box.w, box.h)
      const shift = (p: { x: number; y: number }) => ({ x: box.x + p.x, y: box.y + p.y })
      const err = Math.max(
        ...KEYS.map((k) =>
          segError([shift(segs[k][0]), shift(segs[k][1])] as EndSegment, faces[k]),
        ),
      )
      if (!best || err < best.err) best = { built: { geometry, box }, err }
    }
  }
  if (!best || best.err > 2) return null
  return best.built
}

/**
 * 把一個面換成目標邊之後，四個面該長什麼樣。
 *
 * 四個面各自獨立，所以拖哪一面就只動哪一面，另外三個<strong>原地不動</strong>——
 * 它們接著的軌道不會因此斷掉。
 *
 * 目標邊必須與現在的四個面同向；不同向時這個元件表示不出來，回傳 null。
 */
export function alignCrossFaces(
  cur: Faces,
  end: CrossHandleKey,
  target: EndSegment,
): Faces | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  const axis: 'x' | 'y' | null = flat(target, 'x') ? 'x' : flat(target, 'y') ? 'y' : null
  if (!axis) return null
  if (!KEYS.every((k) => flat(cur[k], axis))) return null
  return { ...cur, [end]: target }
}
