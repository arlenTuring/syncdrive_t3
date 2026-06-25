export type SlotCell = { key: string; row: Record<string, unknown> } | null;

/**
 * 固定格位池：班次結束釋放格位，候補班次依序填入（與 SQL 列順序無關）。
 * 回傳 changedIndices：該格 key 變更時需播放替換動畫。
 */
export function assignStickyPoolSlots(
  prev: SlotCell[],
  incomingRows: Record<string, unknown>[],
  keyField: string,
  slotCount: number,
): { slots: SlotCell[]; changedIndices: number[] } {
  const n = Math.max(1, slotCount);
  const next: SlotCell[] = Array.from({ length: n }, (_, i) => prev[i] ?? null);
  const changedIndices: number[] = [];

  const incomingByKey = new Map<string, Record<string, unknown>>();
  for (const row of incomingRows) {
    const k = String(row[keyField] ?? '').trim();
    if (k) incomingByKey.set(k, row);
  }

  const displayedKeys = new Set<string>();

  for (let i = 0; i < n; i++) {
    const cell = next[i];
    if (!cell) continue;
    if (incomingByKey.has(cell.key)) {
      const updated = { key: cell.key, row: incomingByKey.get(cell.key)! };
      if (JSON.stringify(cell.row) !== JSON.stringify(updated.row)) {
        next[i] = updated;
      }
      displayedKeys.add(cell.key);
    } else {
      next[i] = null;
      changedIndices.push(i);
    }
  }

  const queue = incomingRows.filter(r => {
    const k = String(r[keyField] ?? '').trim();
    return k && !displayedKeys.has(k);
  });
  let q = 0;

  for (let i = 0; i < n; i++) {
    if (next[i] !== null) continue;
    const row = queue[q++];
    if (!row) continue;
    const key = String(row[keyField] ?? '').trim();
    const prevKey = prev[i]?.key;
    next[i] = { key, row };
    displayedKeys.add(key);
    if (prevKey !== key) changedIndices.push(i);
  }

  return { slots: next, changedIndices };
}
