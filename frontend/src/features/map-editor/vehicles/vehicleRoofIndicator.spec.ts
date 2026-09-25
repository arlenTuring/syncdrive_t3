import { describe, expect, it } from 'vitest';
import {
  formatOffsetM,
  passageProgress,
  resolveRoofIndicatorConfig,
  shouldShowOffset,
  type TrackPassageState,
} from './vehicleRoofIndicator';

function drive(trackId: string, raws: number[], defaultReversed: boolean, start?: TrackPassageState) {
  let state = start;
  const out: number[] = [];
  for (const raw of raws) {
    const r = passageProgress(state, trackId, raw, defaultReversed);
    state = r.state;
    out.push(Math.round(r.progress * 100));
  }
  return { out, state };
}

describe('passageProgress：這一次通行的入口 → 出口', () => {
  it('順著折線方向走：0% → 100%', () => {
    expect(drive('U28', [0.1, 0.4, 0.9], false).out).toEqual([10, 40, 90]);
  });

  it('同一條軌道反向通行：仍然從入口 0% 走到出口，不會倒數', () => {
    // 軌道設定方向是順折線（defaultReversed=false），車實際從折線尾端往頭走
    const { out } = drive('U28', [0.9, 0.6, 0.2], false);
    expect(out.slice(1)).toEqual([40, 80]);
  });

  it('剛進軌道還沒動：先用軌道設定的方向', () => {
    expect(drive('U28', [0.3], true).out).toEqual([70]);
  });

  it('定位抖動（移動量很小）不翻轉方向', () => {
    const { out } = drive('U28', [0.5, 0.6, 0.599, 0.601], false);
    expect(out).toEqual([50, 60, 60, 60]);
  });

  it('換到下一條軌道：名稱與進度重新計算，不沿整趟累加', () => {
    const first = drive('U28', [0.2, 0.95], false);
    const next = drive('U29', [0.05, 0.3], false, first.state);
    expect(next.out).toEqual([5, 30]);
    expect(next.state?.trackId).toBe('U29');
  });
});

describe('偏移', () => {
  it('公尺、正負號、兩位小數；未知是「—」不是 0', () => {
    expect(formatOffsetM(-0.123)).toBe('−0.12 m');
    expect(formatOffsetM(0.3)).toBe('+0.30 m');
    expect(formatOffsetM(null)).toBe('—');
    expect(formatOffsetM(Number.NaN)).toBe('—');
  });

  it('門檻模式：超過門檻才顯示；離軌一律顯示；未知在門檻模式不顯示', () => {
    expect(shouldShowOffset('threshold', 0.25, 0.1, false)).toBe(false);
    expect(shouldShowOffset('threshold', 0.25, -0.3, false)).toBe(true);
    expect(shouldShowOffset('threshold', 0.25, 0.1, true)).toBe(true);
    expect(shouldShowOffset('threshold', 0.25, null, false)).toBe(false);
    expect(shouldShowOffset('always', 0.25, null, false)).toBe(true);
    expect(shouldShowOffset('off', 0.25, 5, true)).toBe(false);
  });
});

describe('resolveRoofIndicatorConfig', () => {
  it('未設定的欄位用預設值，設定過的保留', () => {
    const c = resolveRoofIndicatorConfig({ fontSizePx: 20, showPercent: false });
    expect(c.fontSizePx).toBe(20);
    expect(c.showPercent).toBe(false);
    expect(c.enabled).toBe(true);
    expect(c.offsetMode).toBe('threshold');
  });
});
