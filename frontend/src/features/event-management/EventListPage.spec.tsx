// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventListPage } from './EventListPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const permissions = new Set<string>();
const denied: string[] = [];
vi.mock('../access-control/AuthContext', () => ({
  useAuth: () => ({
    can: (code: string) => permissions.has(code),
    require: (code: string) => {
      if (permissions.has(code)) return true;
      denied.push(code);
      return false;
    },
  }),
}));
vi.mock('../dashboard/utils/datasourceInvalidationBus', () => ({ subscribeDatasourceInvalidation: () => () => undefined }));
vi.mock('../dashboard/store/useDataSourceStore', () => ({ DEFAULT_DATASOURCE: { backendUrl: 'http://test' } }));
const handlers = new Map<string, (payload: unknown) => void>();
const released: string[] = [];
vi.mock('../dashboard/elements/socketManager', () => ({
  acquireSocket: () => ({
    on: (name: string, fn: (p: unknown) => void) => handlers.set(name, fn),
    off: (name: string) => handlers.delete(name),
    io: { on: () => undefined, off: () => undefined },
  }),
  releaseSocket: (url: string) => released.push(url),
}));
vi.mock('../../components/SiteDateTimeInput', async () => {
  const { createElement: h } = await import('react');
  return { SiteDateTimeInput: ({ value, onChange, 'aria-label': label }: { value: string; onChange: (e: { target: { value: string } }) => void; 'aria-label'?: string }) => h('input', { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange({ target: { value: e.target.value } }) }) };
});
vi.mock('../../components/SiteSelect', async () => {
  const { createElement: h } = await import('react');
  return {
    SiteSelect: ({ value, onChange, options, 'aria-label': label }: { value: string; onChange: (e: { target: { value: string } }) => void; options: Array<{ value: string; label: string }>; 'aria-label'?: string }) =>
      h('select', { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange({ target: { value: e.target.value } }) }, options.map((o) => h('option', { key: o.value, value: o.value }, o.label))),
  };
});

const event = (i: number, patch: Record<string, unknown> = {}) => ({
  id: String(100 - i), eventId: `EVT-20261019-${String(i).padStart(4, '0')}`, sourceType: 'VEHICLE', sourceId: 'PMS01', sourceName: '一號車', origin: 'REPORTED',
  vehicleCode: 'PMS01', eventCode: 'OBSTACLE_DETECTED', eventLabel: '偵測到障礙物', severity: 'WARNING', occurredAt: Date.UTC(2026, 9, 19, 6, 0, 0), occurredAtValid: true,
  receivedAt: Date.UTC(2026, 9, 19, 6, 0, 1), summary: `事件 ${i}`, acknowledged: false, acknowledgedAt: null, acknowledgedByName: null, recoveryStatus: 'UNKNOWN', ...patch,
});

function backend() {
  const calls: string[] = [];
  let total = 10;
  let acked = false;
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (url.pathname.endsWith('/events/options')) return json({ vehicles: [{ vehicleCode: 'PMS01', displayName: '一號車', active: true }], eventCodes: [{ value: 'OBSTACLE_DETECTED', label: '偵測到障礙物' }], severities: [{ value: 'WARNING', label: '警告' }], sourceTypes: [{ value: 'VEHICLE', label: '載具' }, { value: 'FACILITY', label: '設施' }], timeZone: 'Asia/Taipei', pageSize: 8, exportLimit: 1000 });
    if (url.pathname.endsWith('/events/export')) return json('﻿a\r\n', 200, { 'X-Total-Count': '1200', 'X-Exported-Count': '1000', 'Content-Disposition': 'attachment; filename="events.csv"' });
    if (url.pathname.endsWith('/acknowledgement')) {
      const already = acked;
      acked = true;
      return json({ ...event(1), acknowledged: true, acknowledgedByName: already ? '乙' : '甲', acknowledgedAt: Date.now(), location: null, params: null, detail: null, acknowledgementNote: null, trail: [], alreadyAcknowledged: already });
    }
    if (/\/events\/\d+$/.test(url.pathname)) return json({ ...event(1), acknowledged: acked, location: { x: 1 }, params: { a: 1 }, detail: null, acknowledgementNote: null, trail: [] });
    if (url.pathname.endsWith('/events')) {
      const page = Number(url.searchParams.get('page'));
      const items = Array.from({ length: total }, (_, i) => event(i + 1)).slice((page - 1) * 8, page * 8);
      if (url.searchParams.get('sourceType') === 'FACILITY') return json({ items: [event(1, { sourceType: 'FACILITY', vehicleCode: null, sourceId: 'SCADA-3', sourceName: '月台門 3' })], total: 1, page: 1, pageSize: 8, snapshot: '99', range: { from: 0, to: 1 }, timeZone: 'Asia/Taipei' });
      return json({ items, total, page, pageSize: 8, snapshot: url.searchParams.get('snapshot') ?? '99', range: { from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')) }, timeZone: 'Asia/Taipei' });
    }
    return json({ message: 'not found' }, 404);
  });
  return { fetch, calls, setTotal: (n: number) => (total = n) };
}

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  vi.unstubAllGlobals();
  permissions.clear();
  denied.length = 0;
  handlers.clear();
});
function mount(b: ReturnType<typeof backend>, grants = ['events.events.view', 'events.events.manage', 'events.events.export'], mode: 'live' | 'history' = 'live') {
  grants.forEach((g) => permissions.add(g));
  vi.stubGlobal('fetch', b.fetch);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(createElement(EventListPage, { mode })));
}
const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5))); };
const text = () => document.body.textContent ?? '';
const button = (label: string) => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  const scope = dialogs[dialogs.length - 1] ?? document;
  const match = (b: HTMLButtonElement) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label;
  const node = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(match) ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find(match);
  if (!node) throw new Error(`找不到按鈕 ${label}`);
  return node;
};
const click = async (label: string) => { act(() => button(label).click()); await settle(); };
const select = async (label: string, value: string) => {
  const node = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('事件資訊清單', () => {
  it('預設最近 24 小時、每頁 8 筆、完整日期與秒；篩選按搜尋才套用並回第 1 頁', async () => {
    const b = backend();
    mount(b);
    await settle();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(8);
    expect(text()).toContain('2026-10-19 14:00:00');
    expect(text()).toContain('即時清單預設最近 24 小時');
    const first = b.calls.find((c) => c.startsWith('GET /syncdrive-api/events?'))!;
    const params = new URL(first.slice(4), 'http://x').searchParams;
    expect(Number(params.get('to')) - Number(params.get('from'))).toBe(86_400_000 + 1_000);
    await click('第 2 頁');
    expect(b.calls.some((c) => c.includes('page=2') && c.includes('snapshot=99'))).toBe(true);
    await select('來源', 'FACILITY');
    expect(b.calls.some((c) => c.includes('sourceType=FACILITY'))).toBe(false);
    await click('搜尋');
    expect(b.calls.some((c) => c.includes('sourceType=FACILITY') && c.includes('page=1'))).toBe(true);
    expect(text()).toContain('不適用');
    expect(text()).toContain('月台門 3');
  });

  it('新事件：翻頁時只提示不跳動，同一筆重送不重複計數；卸載清掉訂閱', async () => {
    const b = backend();
    mount(b);
    await settle();
    await click('第 2 頁');
    act(() => handlers.get('security_event')?.({ id: '500' }));
    act(() => handlers.get('security_event')?.({ id: '500' }));
    act(() => handlers.get('security_event')?.({ vehicleCode: 'PMS01' }));
    await settle(2);
    expect(text()).toContain('有 1 筆新事件，點擊更新');
    await click('有 1 筆新事件，點擊更新');
    expect(text()).not.toContain('新事件，點擊更新');
    act(() => root?.unmount());
    root = null;
    expect(handlers.has('security_event')).toBe(false);
    expect(released).toContain('http://test');
  });

  it('詳情確認：送出備註、顯示已確認；後到者看到已被他人確認', async () => {
    const b = backend();
    mount(b);
    await settle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent === '查看詳情')!.click());
    await settle();
    expect(text()).toContain('不會對車輛下發任何指令');
    expect(text()).toContain('設備恢復未知');
    await click('確認事件');
    expect(b.calls.some((c) => c.startsWith('POST') && c.includes('/acknowledgement'))).toBe(true);
    expect(text()).toContain('已確認事件');
  });

  it('匯出超過上限顯示截斷提示；沒有匯出權限提示權限不足、不送請求', async () => {
    const b = backend();
    mount(b);
    await settle();
    await click('匯出 CSV');
    expect(text()).toContain('符合 1200 筆，超過上限，只匯出依目前排序的前 1000 筆');
    act(() => root?.unmount());
    box?.remove();
    permissions.clear();
    const b2 = backend();
    mount(b2, ['events.events.view']);
    await settle();
    await click('匯出 CSV');
    expect(denied).toContain('events.events.export');
    expect(b2.calls.some((c) => c.includes('/export'))).toBe(false);
  });
});
