/** 以點號路徑讀取巢狀物件（如 current_leg.eta_seconds） */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
