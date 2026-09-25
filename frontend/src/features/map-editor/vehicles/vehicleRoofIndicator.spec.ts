import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  passageProgress,
  resolveRoofIndicatorConfig,
  type TrackPassageState,
} from './vehicleRoofIndicator';
import { VehicleTrackProgressBadge } from './VehicleTrackProgressBadge';

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

describe('只畫名稱、進度線、百分比', () => {
  it('舊樣板存了 offsetMode／offsetThresholdM：讀得進來，但不控制畫面', () => {
    const c = resolveRoofIndicatorConfig({ offsetMode: 'always', offsetThresholdM: 0, fontSizePx: 20 });
    expect(c.fontSizePx).toBe(20);
    expect('offsetMode' in c).toBe(false);
    expect('offsetThresholdM' in c).toBe(false);
  });

  it('舊樣板設定顯示偏移：徽章仍只有名稱、進度線、百分比', () => {
    const config = resolveRoofIndicatorConfig({ offsetMode: 'always' });
    const html = renderToStaticMarkup(createElement(VehicleTrackProgressBadge, { config, trackName: 'U19', progress: 0.47 }));
    expect(html).toContain('U19');
    expect(html).toContain('47%');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/偏移|未確認|方向異常|過期|title=/);
  });

  it('關掉名稱與百分比時只剩進度線', () => {
    const config = resolveRoofIndicatorConfig({ showTrackName: false, showPercent: false });
    const html = renderToStaticMarkup(createElement(VehicleTrackProgressBadge, { config, trackName: 'U19', progress: 0.5 }));
    expect(html).not.toContain('U19');
    expect(html).not.toContain('%');
    expect(html).toContain('<svg');
  });
});
