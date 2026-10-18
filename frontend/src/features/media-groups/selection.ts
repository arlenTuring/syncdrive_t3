/**
 * 加入媒體的暫選：以媒體 ID 為準，跨搜尋／翻頁保留；送出順序＝使用者第一次勾選的順序。
 * 取消勾選再勾回來，排到最後（那是新的一次勾選）。
 */
export type Selection = { order: string[]; names: Record<string, string> };

export const EMPTY_SELECTION: Selection = { order: [], names: {} };

export function toggle(selection: Selection, item: { id: string; name: string }): Selection {
  if (selection.order.includes(item.id)) {
    const names = { ...selection.names };
    delete names[item.id];
    return { order: selection.order.filter((id) => id !== item.id), names };
  }
  return { order: [...selection.order, item.id], names: { ...selection.names, [item.id]: item.name } };
}

export type PageItem = { id: string; name: string; selectable: boolean };

/** 表頭勾選狀態：只看目前頁面可加入的項目 */
export function pageState(selection: Selection, items: readonly PageItem[]): 'none' | 'some' | 'all' | 'disabled' {
  const selectable = items.filter((item) => item.selectable);
  if (!selectable.length) return 'disabled';
  const chosen = selectable.filter((item) => selection.order.includes(item.id)).length;
  return chosen === 0 ? 'none' : chosen === selectable.length ? 'all' : 'some';
}

/** 表頭全選：只選取／取消目前頁面可加入的項目；新選的依畫面順序附加 */
export function togglePage(selection: Selection, items: readonly PageItem[]): Selection {
  const selectable = items.filter((item) => item.selectable);
  if (pageState(selection, items) === 'all') {
    const drop = new Set(selectable.map((item) => item.id));
    const names = { ...selection.names };
    drop.forEach((id) => delete names[id]);
    return { order: selection.order.filter((id) => !drop.has(id)), names };
  }
  let next = selection;
  for (const item of selectable) if (!next.order.includes(item.id)) next = toggle(next, item);
  return next;
}

/** 同一分組內移動一個成員（拖曳或鍵盤） */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** 刪除最後一筆後頁碼可能超出：退回最後一頁 */
export function clampPage(page: number, total: number, pageSize: number) {
  return Math.max(1, Math.min(page, Math.ceil(total / pageSize) || 1));
}
