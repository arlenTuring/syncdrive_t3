import type { SourceOption } from './api';

/**
 * 監控版面的純函式（編輯對話框與測試共用）。
 *
 * 座標是 0–CANVAS 的正規化整數，與螢幕像素無關；每頁另存畫布長寬比，監看時整體等比例 fit。
 * 後端用同一套規則再檢查一次（邊界、最小尺寸、重疊、最多 12 格）。
 */
export const CANVAS = 10_000;
export const MIN_TILE = 500;
export const TILE_MAX = 12;
/** 拖拉與縮放對齊的格線（畫布的 1%） */
export const GRID = 100;
/** 靠近其他格子的邊時吸附的距離 */
export const SNAP = 200;

export type Rect = { x: number; y: number; w: number; h: number };
export type DraftTile = Rect & { key: string; tileId: string | null; sourceId: string | null };

export const ASPECT_PRESETS: Array<{ value: number; label: string }> = [
  { value: 16 / 9, label: '16:9（寬螢幕）' },
  { value: 21 / 9, label: '21:9（超寬）' },
  { value: 4 / 3, label: '4:3' },
  { value: 1, label: '1:1' },
  { value: 9 / 16, label: '9:16（直式）' },
];

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const area = (r: Rect) => r.w * r.h;

/**
 * 加一格：只分割選取的格子（沒選就挑面積最大的），較寬就左右切、較高就上下切；
 * 平手依位置（上、左）穩定決定。其他格子不動，不重排使用者的自訂位置。
 * 空版面就是滿版一格。回傳 null 表示已達 12 格或被選格子太小不能再切。
 */
export function addTile(tiles: DraftTile[], selectedKey: string | null, key: string): DraftTile[] | null {
  if (tiles.length >= TILE_MAX) return null;
  if (!tiles.length) return [{ key, tileId: null, sourceId: null, x: 0, y: 0, w: CANVAS, h: CANVAS }];
  const target = tiles.find((t) => t.key === selectedKey)
    ?? [...tiles].sort((a, b) => area(b) - area(a) || a.y - b.y || a.x - b.x)[0];
  const horizontal = target.w >= target.h;
  const size = horizontal ? target.w : target.h;
  if (Math.floor(size / 2) < MIN_TILE) return null;
  const first = Math.round(size / 2 / GRID) * GRID || Math.floor(size / 2);
  const a: DraftTile = horizontal ? { ...target, w: first } : { ...target, h: first };
  const b: DraftTile = horizontal
    ? { key, tileId: null, sourceId: null, x: target.x + first, y: target.y, w: target.w - first, h: target.h }
    : { key, tileId: null, sourceId: null, x: target.x, y: target.y + first, w: target.w, h: target.h - first };
  if (b.w < MIN_TILE || b.h < MIN_TILE || a.w < MIN_TILE || a.h < MIN_TILE) return null;
  return tiles.flatMap((t) => (t.key === target.key ? [a, b] : [t]));
}

/** 平均重排（使用者明確按下才做）：依目前順序排成接近畫布比例的格狀 */
export function evenLayout(tiles: DraftTile[], aspect: number): DraftTile[] {
  const n = tiles.length;
  if (!n) return tiles;
  // 欄數取讓每格最接近畫布比例的值
  let cols = 1;
  let best = Infinity;
  for (let c = 1; c <= n; c += 1) {
    const rows = Math.ceil(n / c);
    const cellAspect = (aspect * rows) / c;
    const score = Math.abs(Math.log(cellAspect / (16 / 9))) + (rows * c - n) * 0.15;
    if (score < best) {
      best = score;
      cols = c;
    }
  }
  const rows = Math.ceil(n / cols);
  return tiles.map((t, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const c = i - r * cols;
    const x0 = Math.floor((c * CANVAS) / inRow);
    const x1 = Math.floor(((c + 1) * CANVAS) / inRow);
    const y0 = Math.floor((r * CANVAS) / rows);
    const y1 = Math.floor(((r + 1) * CANVAS) / rows);
    return { ...t, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}

/** 檢查一格放在這裡是否合法（不越界、夠大、不和其他格重疊；相接的邊合法） */
export function validRect(rect: Rect, others: Rect[]) {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger)) return false;
  if (rect.w < MIN_TILE || rect.h < MIN_TILE || rect.x < 0 || rect.y < 0 || rect.x + rect.w > CANVAS || rect.y + rect.h > CANVAS) return false;
  return !others.some((o) => overlaps(rect, o));
}

export function validLayout(tiles: Rect[]) {
  if (tiles.length < 1 || tiles.length > TILE_MAX) return false;
  return tiles.every((t, i) => validRect(t, tiles.filter((_, j) => j !== i)));
}

/** 對齊格線，並吸附到畫布邊界與其他格子的邊（拖拉／縮放結束時使用） */
export function snapRect(rect: Rect, others: Rect[]): Rect {
  const xs = [0, CANVAS, ...others.flatMap((o) => [o.x, o.x + o.w])];
  const ys = [0, CANVAS, ...others.flatMap((o) => [o.y, o.y + o.h])];
  const near = (v: number, list: number[]) => {
    let hit = v;
    let d = SNAP + 1;
    for (const p of list) if (Math.abs(p - v) < d) [hit, d] = [p, Math.abs(p - v)];
    return d <= SNAP ? hit : Math.round(v / GRID) * GRID;
  };
  const left = near(rect.x, xs);
  const right = near(rect.x + rect.w, xs);
  const top = near(rect.y, ys);
  const bottom = near(rect.y + rect.h, ys);
  const clamp = (v: number) => Math.max(0, Math.min(CANVAS, v));
  const x = clamp(left);
  const y = clamp(top);
  return { x, y, w: Math.max(MIN_TILE, clamp(right) - x), h: Math.max(MIN_TILE, clamp(bottom) - y) };
}

/** 只是移動（大小不變）時：吸附位置但保留原寬高 */
export function snapMove(rect: Rect, others: Rect[]): Rect {
  const snapped = snapRect(rect, others);
  const x = Math.min(Math.max(0, snapped.x), CANVAS - rect.w);
  const y = Math.min(Math.max(0, snapped.y), CANVAS - rect.h);
  return { x, y, w: rect.w, h: rect.h };
}

// ── 來源選單分組 ─────────────────────────────────────────
export const tagKey = (tag: string) => tag.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * 依來源標籤分組：多標籤來源只出現一次（以規範化後排序第一個標籤分組，其他標籤仍顯示）；
 * 組內依名稱、ID 穩定排序；沒有標籤的歸「未分類」放最後。搜尋比對名稱、全部標籤、載具、位置。
 */
export function groupSources(options: SourceOption[], query: string) {
  const q = query.trim().toLowerCase();
  const hit = (o: SourceOption) => !q || [o.name, o.vehicleCode, o.location, ...o.tags].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
  const groups = new Map<string, { label: string; items: SourceOption[] }>();
  for (const o of options.filter(hit)) {
    const sorted = [...o.tags].sort((a, b) => tagKey(a).localeCompare(tagKey(b), 'zh-Hant'));
    const label = sorted[0] ?? '';
    const key = label ? tagKey(label) : '￿';
    const group = groups.get(key) ?? { label: label || '未分類', items: [] };
    group.items.push(o);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh-Hant'))
    .map(([, g]) => ({ label: g.label, items: g.items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id)) }));
}
