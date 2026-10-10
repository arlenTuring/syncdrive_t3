import type { ObstacleDirection, ObstacleDirectionBinding } from '../types';

/**
 * 一個方向現在的狀態。
 * - detected：資料明確表示偵測到障礙（才畫紅）
 * - clear：資料明確表示沒有偵測到（畫灰）
 * - unknown：沒設定路徑、沒資料、斷線、過期、值看不懂——不畫紅，也不當成確認安全
 */
export type ObstacleState =
  | { state: 'detected' }
  | { state: 'clear' }
  | { state: 'unknown'; reason: 'unconfigured' | 'no-data' | 'missing' | 'unrecognized' | 'no-threshold' };

export function readJsonPath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const key of path.split('.')) {
    if (!key) continue;
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** 明確的布林：true/"true"/1/"1" 或 false/"false"/0/"0"；其他（含 "yes"、空字串）一律看不懂 */
function explicitBoolean(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
  }
  return null;
}

function explicitNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/**
 * 判定一個方向。payload 為 null 代表目前沒有這台車的有效資料（沒收過、斷線，或車隊資料流
 * 判定過期已清掉），一律未知。
 */
export function evaluateObstacleDirection(
  payload: Record<string, unknown> | null,
  binding: ObstacleDirectionBinding | undefined,
): ObstacleState {
  const path = binding?.path?.trim();
  if (!path) return { state: 'unknown', reason: 'unconfigured' };
  if (!payload) return { state: 'unknown', reason: 'no-data' };
  const value = readJsonPath(payload, path);
  if (value === undefined || value === null) return { state: 'unknown', reason: 'missing' };
  if (binding?.mode === 'distance') {
    const threshold = binding.threshold;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold))
      return { state: 'unknown', reason: 'no-threshold' };
    const distance = explicitNumber(value);
    if (distance === null) return { state: 'unknown', reason: 'unrecognized' };
    return distance <= threshold ? { state: 'detected' } : { state: 'clear' };
  }
  const flag = explicitBoolean(value);
  if (flag === null) return { state: 'unknown', reason: 'unrecognized' };
  return flag ? { state: 'detected' } : { state: 'clear' };
}

export const OBSTACLE_DIRECTION_LABELS: Record<ObstacleDirection, string> = {
  front_left: '前左',
  front: '前',
  front_right: '前右',
  left: '左',
  right: '右',
  rear_left: '後左',
  rear: '後',
  rear_right: '後右',
};

/** 3×3 格位置（車頭朝上；中央空著給車輛圖片） */
export const OBSTACLE_DIRECTION_CELL: Record<ObstacleDirection, { col: 0 | 1 | 2; row: 0 | 1 | 2 }> = {
  front_left: { col: 0, row: 0 },
  front: { col: 1, row: 0 },
  front_right: { col: 2, row: 0 },
  left: { col: 0, row: 1 },
  right: { col: 2, row: 1 },
  rear_left: { col: 0, row: 2 },
  rear: { col: 1, row: 2 },
  rear_right: { col: 2, row: 2 },
};

export const OBSTACLE_UNKNOWN_REASON: Record<
  Extract<ObstacleState, { state: 'unknown' }>['reason'],
  string
> = {
  unconfigured: '未設定資料欄位',
  'no-data': '沒有即時資料（未連線或已過期）',
  missing: '資料中沒有這個欄位',
  unrecognized: '值無法判讀',
  'no-threshold': '未設定距離門檻',
};
