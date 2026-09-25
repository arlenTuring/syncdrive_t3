/**
 * 車頂軌道進度指標：`U28  ○━━━━●────▷  42%   偏移 −0.12 m`
 *
 * 語意：
 *   - 名稱：車目前判給的那一條軌道（跟進度同一條，不另外依座標查附近的名稱）。
 *   - 左端：這一次通行的入口；箭頭端：出口；移動點：車在這條軌道上的位置。
 *   - 百分比：這條軌道走了幾成，不是整張訂單的進度；換軌道就重新算。
 *   - 偏移：離中心線幾公尺，另外一項，不跟進度混在一起。未知顯示「—」，不顯示 0。
 * 電量不放這裡（車輛狀態卡片才有電量）。
 */

export type RoofIndicatorOffsetMode = 'off' | 'threshold' | 'always';

export type VehicleRoofIndicatorConfig = {
  enabled?: boolean;
  showTrackName?: boolean;
  showPercent?: boolean;
  offsetMode?: RoofIndicatorOffsetMode;
  /** offsetMode='threshold' 時，偏移超過幾公尺才顯示 */
  offsetThresholdM?: number;
  fontSizePx?: number;
  /** 線段長度（px） */
  barWidthPx?: number;
  /** 已走過的線段與移動點 */
  progressColor?: string;
  /** 未走的線段、入口圈、出口箭頭 */
  railColor?: string;
  backgroundColor?: string;
  textColor?: string;
};

export type ResolvedRoofIndicatorConfig = Required<VehicleRoofIndicatorConfig>;

export const DEFAULT_ROOF_INDICATOR: ResolvedRoofIndicatorConfig = {
  enabled: true,
  showTrackName: true,
  showPercent: true,
  offsetMode: 'threshold',
  offsetThresholdM: 0.25,
  fontSizePx: 16,
  barWidthPx: 72,
  progressColor: '#67e8f9',
  railColor: 'rgba(148, 163, 184, 0.55)',
  backgroundColor: 'rgba(15, 23, 42, 0.85)',
  textColor: '#e4e4e7',
};

export function resolveRoofIndicatorConfig(
  config: VehicleRoofIndicatorConfig | null | undefined,
): ResolvedRoofIndicatorConfig {
  const merged = { ...DEFAULT_ROOF_INDICATOR };
  if (!config) return merged;
  for (const key of Object.keys(DEFAULT_ROOF_INDICATOR) as (keyof ResolvedRoofIndicatorConfig)[]) {
    const value = config[key];
    if (value !== undefined && value !== null && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** 偏移文字：有正負號、公尺、兩位小數；不知道就是「—」，不是 0 */
export function formatOffsetM(offsetM: number | null | undefined): string {
  if (offsetM == null || !Number.isFinite(offsetM)) return '—';
  const sign = offsetM > 0 ? '+' : offsetM < 0 ? '−' : '±';
  return `${sign}${Math.abs(offsetM).toFixed(2)} m`;
}

/** 要不要顯示偏移：離軌一律顯示；未知在「一律顯示」模式才顯示「—」 */
export function shouldShowOffset(
  mode: RoofIndicatorOffsetMode,
  thresholdM: number,
  offsetM: number | null | undefined,
  offTrack: boolean,
): boolean {
  if (mode === 'off') return false;
  if (offTrack) return true;
  if (offsetM == null || !Number.isFinite(offsetM)) return mode === 'always';
  if (mode === 'always') return true;
  return Math.abs(offsetM) >= thresholdM;
}

/** 單車在單一軌道上的通行狀態（只在記憶體） */
export type TrackPassageState = {
  trackId: string;
  /** 上一次的折線順序位置（0–1，沿折線記錄方向） */
  lastRaw: number;
  /** 這次通行跟折線記錄方向相反 */
  reversed: boolean;
};

/** 移動量小於這個比例不拿來判斷方向，避免定位抖動把方向翻來翻去 */
const DIRECTION_EPS = 0.004;

/**
 * 這一次通行走了幾成（入口 0 → 出口 1）。
 *
 * 方向看車自己在這條軌道上怎麼動：同一條軌道可能正反向都有人走，照軌道設定的行車
 * 方向算的話，反向通行會從 100% 倒數回 0%。剛進這條軌道、還沒動到能判斷的時候，
 * 先用軌道設定的方向（defaultReversed）。
 *
 * @param rawAlong 沿折線記錄方向的位置（0–1）
 */
export function passageProgress(
  prev: TrackPassageState | undefined,
  trackId: string,
  rawAlong: number,
  defaultReversed: boolean,
): { progress: number; state: TrackPassageState } {
  const raw = Math.min(1, Math.max(0, rawAlong));
  let reversed = defaultReversed;
  let lastRaw = raw;
  if (prev && prev.trackId === trackId) {
    reversed = prev.reversed;
    lastRaw = prev.lastRaw;
    const delta = raw - prev.lastRaw;
    if (Math.abs(delta) >= DIRECTION_EPS) {
      reversed = delta < 0;
      lastRaw = raw;
    }
  }
  return {
    progress: reversed ? 1 - raw : raw,
    state: { trackId, lastRaw, reversed },
  };
}
