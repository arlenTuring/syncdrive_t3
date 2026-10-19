import { describe, expect, it } from 'vitest';
import { formatDateTime, localInputToEpoch, rangeToQuery, toLocalInput } from './time';

describe('事件／日誌時間換算', () => {
  it('依網站時區顯示完整日期與秒，跟瀏覽器時區無關', () => {
    const t = Date.UTC(2026, 9, 19, 15, 59, 59); // 台北 23:59:59
    expect(formatDateTime(t, 'Asia/Taipei')).toBe('2026-10-19 23:59:59');
    expect(formatDateTime(t, 'UTC')).toBe('2026-10-19 15:59:59');
    expect(toLocalInput(t, 'Asia/Taipei')).toBe('2026-10-19T23:59:59');
  });

  it('區間起點含、終點不含：選到 23:59:59 會包含最後一秒，跨午夜不漏', () => {
    const r = rangeToQuery({ from: '2026-10-19T00:00:00', to: '2026-10-19T23:59:59' }, 'Asia/Taipei');
    expect(r).toEqual({ from: Date.UTC(2026, 9, 18, 16), to: Date.UTC(2026, 9, 19, 16) });
  });

  it('起訖驗證', () => {
    expect(rangeToQuery({ from: '', to: '2026-10-19T00:00:00' }, 'Asia/Taipei')).toEqual({ error: '請選擇開始時間' });
    expect(rangeToQuery({ from: '2026-10-20T00:00:00', to: '2026-10-19T00:00:00' }, 'Asia/Taipei')).toEqual({ error: '結束時間不能早於開始時間' });
  });

  it('夏令時間：重複時點取較早者、不存在時點順延', () => {
    // 紐約 2026-11-01 01:30 出現兩次（EDT、EST）→ 取 EDT（較早）
    expect(localInputToEpoch('2026-11-01T01:30:00', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
    // 紐約 2026-03-08 02:30 不存在 → 順延到 03:30 EDT
    expect(localInputToEpoch('2026-03-08T02:30:00', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });
});
