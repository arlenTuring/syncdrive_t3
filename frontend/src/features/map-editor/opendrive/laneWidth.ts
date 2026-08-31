import type { WidthPoly } from './types'

export function evalWidthPoly(widths: WidthPoly[], sectionS: number, roadS: number): number {
  if (widths.length === 0) return 0
  const ds = roadS - sectionS

  let active = widths[0]!
  for (const w of widths) {
    if (w.sOffset <= ds + 1e-9) active = w
    else break
  }

  const localDs = ds - active.sOffset
  return (
    active.a +
    active.b * localDs +
    active.c * localDs * localDs +
    active.d * localDs * localDs * localDs
  )
}
