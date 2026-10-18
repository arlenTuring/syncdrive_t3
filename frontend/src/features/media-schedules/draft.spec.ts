import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from './api';
import { dayTimeErrors, emptyDraft, formatInZone, nowLocal, sortWeekly, toInput, validateDraft, weeklySummary, type Draft } from './draft';

const item = (id: string, available = true): PlaylistItem => ({ id, name: id, media_type: 'audio', description: '', available, unavailable_label: available ? null : '缺少檔案' });
// 2026-10-18 10:00 台北（UTC 02:00）
const NOW = Date.UTC(2026, 9, 18, 2, 0);
const base = (patch: Partial<Draft>): Draft => ({ ...emptyDraft('Asia/Taipei'), name: '到站廣播', items: [item('M1')], ...patch });

describe('媒體排程草稿', () => {
  it('時間一律依排程時區解讀，跟瀏覽器時區無關', () => {
    expect(nowLocal('Asia/Taipei', NOW)).toBe('2026-10-18T10:00');
    expect(nowLocal('America/New_York', NOW)).toBe('2026-10-17T22:00');
    expect(formatInZone(NOW, 'Asia/Taipei')).toBe('2026-10-18 10:00');
  });

  it('預約：建立時不能選過去時間；編輯已過期的預約只改名稱不用改時間', () => {
    const past = base({ mode: 'reserved', runLocal: '2026-10-18T09:59' });
    expect(validateDraft(past, { now: NOW, originalRunLocal: null }).runLocal).toBe('預約時間必須晚於現在');
    expect(validateDraft({ ...past, name: '改名' }, { now: NOW, originalRunLocal: '2026-10-18T09:59' }).runLocal).toBeUndefined();
    expect(validateDraft({ ...past, runLocal: '2026-10-18T09:58' }, { now: NOW, originalRunLocal: '2026-10-18T09:59' }).runLocal).toBe('預約時間必須晚於現在');
    expect(validateDraft(base({ runLocal: '2026-10-18T10:01' }), { now: NOW, originalRunLocal: null })).toEqual({});
  });

  it('定時：開始日期必填、結束不得早於開始、至少一天、時間不可空白或重複', () => {
    const timed = base({ mode: 'timed', startDate: '2026-10-20', weekly: { '3': ['20:00'] } });
    expect(validateDraft(timed, { now: NOW, originalRunLocal: null })).toEqual({});
    expect(validateDraft({ ...timed, startDate: '' }, { now: NOW, originalRunLocal: null }).startDate).toBeTruthy();
    expect(validateDraft({ ...timed, endDate: '2026-10-19' }, { now: NOW, originalRunLocal: null }).endDate).toBe('結束日期不得早於開始日期');
    expect(validateDraft({ ...timed, endDate: '2026-10-20' }, { now: NOW, originalRunLocal: null }).endDate).toBeUndefined();
    expect(validateDraft({ ...timed, weekly: {} }, { now: NOW, originalRunLocal: null }).weekly).toBeTruthy();
    expect(validateDraft({ ...timed, weekly: { '3': ['20:00', '20:00'] } }, { now: NOW, originalRunLocal: null }).weekly).toBeTruthy();
    expect(dayTimeErrors(['20:00', '', '08:00', '20:00'])).toEqual([null, '請選擇時間', null, '與第 1 個時間重複']);
  });

  it('播放清單：空清單、無法播放的媒體擋下；指定載具至少一台', () => {
    const ok = base({ runLocal: '2026-10-19T08:00' });
    expect(validateDraft({ ...ok, items: [] }, { now: NOW, originalRunLocal: null }).items).toBe('播放清單至少要有一個媒體');
    expect(validateDraft({ ...ok, items: [item('M1', false)] }, { now: NOW, originalRunLocal: null }).items).toBeTruthy();
    expect(validateDraft({ ...ok, targetScope: 'vehicles' }, { now: NOW, originalRunLocal: null }).vehicles).toBe('請至少指定一台載具');
  });

  it('送出只帶生效模式的欄位，沒有循環播放；定時時間排序、無結束日期送 null', () => {
    const both = base({ runLocal: '2026-10-19T08:00', startDate: '2026-10-20', weekly: { '5': ['18:00', '07:30'], '1': ['08:00'] }, vehicleIds: ['V1'] });
    const reserved = toInput(both);
    expect(reserved).toMatchObject({ mode: 'reserved', run_local: '2026-10-19T08:00', vehicle_ids: [] });
    expect(reserved).not.toHaveProperty('weekly');
    expect(reserved).not.toHaveProperty('start_date');
    const timed = toInput({ ...both, mode: 'timed', targetScope: 'vehicles' }, 7);
    expect(timed).toMatchObject({ mode: 'timed', start_date: '2026-10-20', end_date: null, weekly: { '1': ['08:00'], '5': ['07:30', '18:00'] }, vehicle_ids: ['V1'], expected_version: 7 });
    expect(timed).not.toHaveProperty('run_local');
    expect(JSON.stringify([reserved, timed])).not.toMatch(/loop|循環/);
    expect(Object.keys(sortWeekly({ '7': ['09:00'], '2': ['10:00'] }))).toEqual(['2', '7']);
    expect(weeklySummary({ '1': ['08:00', '12:00'], '3': ['20:00'] })).toBe('週一 08:00、12:00；週三 20:00');
  });
});
