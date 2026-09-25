/**
 * 車頂軌道進度指標：`U19 ──●──▷ 47%`
 *
 * 只畫三件事：
 *   - 名稱：車目前判給的那一條軌道（跟進度同一條，不另外依座標查附近的名稱）。
 *   - 進度線：左端是這一次通行的入口、箭頭端是出口、移動點是車在這條軌道上的位置。
 *   - 百分比：這條軌道走了幾成，不是整張訂單的進度；換軌道就重新算。
 * 偏移、定位狀態等診斷不放在這裡（見開發紀錄與錄製工具）；電量在車輛狀態卡片。
 */

export type VehicleRoofIndicatorConfig = {
  enabled?: boolean;
  showTrackName?: boolean;
  showPercent?: boolean;
  fontSizePx?: number;
  /** 線段長度（px） */
  barWidthPx?: number;
  /** 已走過的線段與移動點 */
  progressColor?: string;
  /** 未走的線段、入口圈、出口箭頭 */
  railColor?: string;
  backgroundColor?: string;
  textColor?: string;
  /**
   * @deprecated 舊版的偏移顯示設定。已存的儀表板可能還帶著，讀得進來但不再影響畫面。
   */
  offsetMode?: 'off' | 'threshold' | 'always';
  /** @deprecated 同上 */
  offsetThresholdM?: number;
};

/** 真正會控制畫面的欄位（舊的偏移欄位不在裡面） */
export type ResolvedRoofIndicatorConfig = Required<Omit<VehicleRoofIndicatorConfig, 'offsetMode' | 'offsetThresholdM'>>;

export const DEFAULT_ROOF_INDICATOR: ResolvedRoofIndicatorConfig = {
  enabled: true,
  showTrackName: true,
  showPercent: true,
  fontSizePx: 16,
  barWidthPx: 72,
  progressColor: '#67e8f9',
  railColor: 'rgba(148, 163, 184, 0.55)',
  backgroundColor: 'rgba(15, 23, 42, 0.85)',
  textColor: '#e4e4e7',
};

/** 只取會控制畫面的欄位；舊的 offsetMode／offsetThresholdM 讀到也直接忽略 */
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
