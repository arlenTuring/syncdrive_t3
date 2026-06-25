export type RuleOperator = 'eq' | 'gt' | 'lt'

export function readPayloadPath(
  payload: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!payload || !path.trim()) return undefined
  const segs = path
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  let cur: unknown = payload
  for (const seg of segs) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function ruleMatched(
  operator: RuleOperator,
  live: string,
  compareValue: string,
): boolean {
  if (operator === 'eq') return live === compareValue
  const liveNum = Number(live)
  const ruleNum = Number(compareValue)
  if (!Number.isFinite(liveNum) || !Number.isFinite(ruleNum)) return false
  if (operator === 'gt') return liveNum > ruleNum
  return liveNum < ruleNum
}
