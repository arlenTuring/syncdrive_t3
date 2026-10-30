// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftRecordListQuery, ShiftRecordListResponse } from '../api/shiftRecordsApi';

/**
 * 班次運行紀錄清單：分頁／篩選／失效通知共用同一套查詢生命週期。
 * 網路與失效通知換成可控替身，頁面元件本身照真的跑。
 */
type Pending = {
  query: ShiftRecordListQuery;
  signal?: AbortSignal;
  resolve: (res: ShiftRecordListResponse) => void;
  reject: (error: Error) => void;
};
const h = vi.hoisted(() => ({
  pending: [] as Pending[],
  listeners: [] as Array<(payload: { tags: string[]; at: number; reason?: string }) => void>,
}));

vi.mock('../api/shiftRecordsApi', () => ({
  resolveShiftRecordsBackendUrl: () => 'http://backend.test',
  exportShiftRecordsCsv: () => undefined,
  fetchShiftRecordList: (query: ShiftRecordListQuery, _url: string, signal?: AbortSignal) =>
    new Promise((resolve, reject) => h.pending.push({ query, signal, resolve, reject })),
}));
vi.mock('../../vehicle-registry/api', () => ({
  fetchRegistry: () => Promise.resolve({ items: [] }),
}));
vi.mock('../../dashboard/utils/datasourceInvalidationBus', () => ({
  subscribeDatasourceInvalidation: (fn: (typeof h.listeners)[number]) => {
    h.listeners.push(fn);
    return () => {
      h.listeners = h.listeners.filter((x) => x !== fn);
    };
  },
}));

const { ShiftRecordsListPage } = await import('./ShiftRecordsListPage');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function response(tripCodes: string[], total = tripCodes.length): ShiftRecordListResponse {
  return {
    items: tripCodes.map((code) => ({
      order_id: `ORD-${code}`,
      trip_code: code,
      route_label: 'T3→S2W',
      vehicle_code: 'PMS01',
      depart_time: null,
      end_time: null,
      execution_status: 'pending',
      execution_status_label: '',
    })) as unknown as ShiftRecordListResponse['items'],
    total,
    page: 1,
    page_size: 20,
    time_zone: 'Asia/Taipei',
  };
}

const rowsText = () => [...host!.querySelectorAll('tbody tr td:nth-child(2)')].map((td) => td.textContent);
const bodyText = () => host!.querySelector('tbody')!.textContent ?? '';
const notify = (tags = ['table:operation_orders']) => {
  for (const fn of h.listeners) fn({ tags, at: Date.now(), reason: 'order_lifecycle' });
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const clickTab = async (index: number) => {
  const tabs = host!.querySelectorAll('div.flex.gap-8 > button');
  await act(async () => (tabs[index] as HTMLButtonElement).click());
};

beforeEach(async () => {
  vi.useFakeTimers();
  h.pending.length = 0;
  h.listeners = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(ShiftRecordsListPage, { onOpenDetail: () => undefined, embedded: true })));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

describe('ShiftRecordsListPage 清單查詢', () => {
  it('A→B 快速切換：A 晚回來的成功或失敗都不覆蓋 B，且 A 被中止', async () => {
    expect(h.pending).toHaveLength(1);
    const a = h.pending[0];
    expect(a.query.tab).toBe('mainline');
    await clickTab(1);
    expect(h.pending).toHaveLength(2);
    const b = h.pending[1];
    expect(b.query.tab).toBe('maintenance');
    expect(a.signal?.aborted).toBe(true);

    await act(async () => b.resolve(response(['M-B'])));
    await act(async () => a.resolve(response(['A-late'])));
    expect(rowsText()).toEqual(['M-B']);
    await act(async () => a.reject(new Error('A 失敗')));
    expect(host!.textContent).not.toContain('A 失敗');
    expect(rowsText()).toEqual(['M-B']);
  });

  it('背景更新不清空、不閃 Loading；密集通知合併成有界的補查', async () => {
    await act(async () => h.pending[0].resolve(response(['T1', 'T2'])));
    expect(rowsText()).toEqual(['T1', 'T2']);

    // 2 秒內 20 則通知，每支請求 300ms 才回來
    for (let i = 0; i < 20; i += 1) {
      notify();
      await advance(100);
      expect(bodyText()).not.toContain('common.loading');
      expect(rowsText().length).toBeGreaterThan(0);
      const open = h.pending.filter((p, index) => index > 0 && !(p as { done?: boolean }).done);
      if (i % 3 === 2 && open.length) {
        const last = open[open.length - 1];
        (last as { done?: boolean }).done = true;
        await act(async () => last.resolve(response([`T${i}`])));
      }
    }
    // 不是每則通知一支（20 支），而是每 ≥500ms 最多一支
    expect(h.pending.length).toBeLessThanOrEqual(6);
    expect(h.pending.length).toBeGreaterThanOrEqual(3);
  });

  it('不相干的失效標籤不觸發重查', async () => {
    await act(async () => h.pending[0].resolve(response(['T1'])));
    notify(['table:operator_action_logs']);
    notify(['domain:operating_clock']);
    await advance(2000);
    expect(h.pending).toHaveLength(1);
  });

  it('背景失敗保留目前的列並顯示錯誤，下一次成功清掉錯誤', async () => {
    await act(async () => h.pending[0].resolve(response(['T1'])));
    notify();
    await advance(600);
    await act(async () => h.pending[1].reject(new Error('連線中斷')));
    expect(rowsText()).toEqual(['T1']);
    expect(host!.textContent).toContain('連線中斷');
    notify();
    await advance(1100);
    await act(async () => h.pending[2].resolve(response(['T1', 'T9'])));
    expect(rowsText()).toEqual(['T1', 'T9']);
    expect(host!.textContent).not.toContain('連線中斷');
  });

  it('卸載後中止在途請求並退訂', async () => {
    const first = h.pending[0];
    await act(async () => root!.unmount());
    root = null;
    expect(first.signal?.aborted).toBe(true);
    expect(h.listeners).toHaveLength(0);
  });
});
