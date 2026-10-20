import { BadRequestException } from '@nestjs/common';
import { TILE_MAX } from './video.config';

/** 版面座標是 0–CANVAS 的正規化整數（與螢幕像素無關）；監看時依每頁的 canvasAspectRatio 等比例 fit */
export const CANVAS = 10_000;
/** 最小格子寬高（正規化單位） */
export const MIN_TILE = 500;

export type LayoutRect = { x: number; y: number; w: number; h: number };
export type LayoutTileInput = LayoutRect & { tileId: string | null; position: number };

const int = (raw: unknown, label: string) => {
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isInteger(n)) throw new BadRequestException(`格子${label}必須是整數`);
  return n;
};

export const overlaps = (a: LayoutRect, b: LayoutRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * 檢查整份版面：1–12 格、整數、不越界、最小尺寸、tileId 不重複、彼此不重疊（相接的邊合法）。
 * 前端同樣檢查，但這裡是最終把關：越界、NaN、負尺寸、重複 ID、重疊與第 13 格一律拒絕。
 */
export function parseLayout(raw: unknown): LayoutTileInput[] {
  if (!Array.isArray(raw)) throw new BadRequestException('版面格子必須是陣列');
  if (raw.length < 1) throw new BadRequestException('版面至少要有 1 格');
  if (raw.length > TILE_MAX) throw new BadRequestException(`每個監控標籤頁最多 ${TILE_MAX} 格`);
  const seen = new Set<string>();
  const tiles = raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new BadRequestException('格子設定不正確');
    const r = item as Record<string, unknown>;
    const tileId = r.tileId === undefined || r.tileId === null || r.tileId === '' ? null : String(r.tileId);
    if (tileId !== null) {
      if (!/^[0-9a-f-]{36}$/i.test(tileId)) throw new BadRequestException('格子識別碼不正確');
      if (seen.has(tileId)) throw new BadRequestException('格子識別碼重複');
      seen.add(tileId);
    }
    const rect = { x: int(r.x, '位置'), y: int(r.y, '位置'), w: int(r.w, '寬度'), h: int(r.h, '高度') };
    if (rect.w < MIN_TILE || rect.h < MIN_TILE) throw new BadRequestException('格子太小（至少畫布的 5%）');
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > CANVAS || rect.y + rect.h > CANVAS) throw new BadRequestException('格子超出畫布範圍');
    return { tileId, position: index, ...rect };
  });
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      if (overlaps(tiles[i], tiles[j])) throw new BadRequestException(`第 ${i + 1} 格與第 ${j + 1} 格重疊`);
    }
  }
  return tiles;
}

export function parseAspect(raw: unknown, fallback = 16 / 9) {
  if (raw === undefined || raw === null) return Math.round(fallback * 10_000) / 10_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0.25 || n > 4) throw new BadRequestException('畫布長寬比必須在 0.25–4 之間');
  return Math.round(n * 10_000) / 10_000;
}

export const fullCanvas = (): LayoutRect => ({ x: 0, y: 0, w: CANVAS, h: CANVAS });

// ── 來源分類標籤 ─────────────────────────────────────────
export const TAGS_MAX = 10;
export const TAG_LENGTH_MAX = 30;

/** 比較用的鍵：全半形、大小寫、連續空白視為相同 */
export const tagKey = (tag: string) => tag.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** 規範化來源標籤：trim、去空、去重（保留第一次出現的顯示字）、最多 10 個、每個 30 字 */
export function normalizeTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('來源標籤必須是文字陣列');
  const out: string[] = [];
  const keys = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') throw new BadRequestException('來源標籤必須是文字');
    const display = item.replace(/\s+/g, ' ').trim();
    if (!display) continue;
    if ([...display].length > TAG_LENGTH_MAX) throw new BadRequestException(`來源標籤每個最多 ${TAG_LENGTH_MAX} 字`);
    const key = tagKey(display);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(display);
  }
  if (out.length > TAGS_MAX) throw new BadRequestException(`每個來源最多 ${TAGS_MAX} 個標籤`);
  return out;
}

/** 複製來源的名稱：保留完整後綴，必要時截短原名（名稱上限 120 字） */
export function duplicateName(name: string, max = 120) {
  const suffix = '的複製';
  const chars = [...name];
  const room = max - [...suffix].length;
  return (chars.length > room ? chars.slice(0, room).join('') : name) + suffix;
}
