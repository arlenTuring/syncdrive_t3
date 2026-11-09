// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveEventsPage } from './LiveEventsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const permissions = new Set(['events.events.view', 'events.events.manage']);
const denied: string[] = [];
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => permissions.has(p), require: (p: string) => permissions.has(p) || (denied.push(p), false) }) }));

const item = (id: string, acknowledged = false) => ({ id, eventId: `EVT-${id}`, sourceType: 'VEHICLE', sourceId: 'PMS01', sourceName: '一號車', origin: 'REPORTED', vehicleCode: 'PMS01', eventCode: 'OBSTACLE_DETECTED', eventLabel: '偵測到障礙物', severity: 'CRITICAL', occurredAt: Date.UTC(2026, 9, 20, 1), occurredAtValid: true, receivedAt: Date.UTC(2026, 9, 20, 1, 0, 1), summary: '前方障礙', acknowledged, acknowledgedAt: acknowledged ? Date.UTC(2026, 9, 20, 2) : null, acknowledgedByName: acknowledged ? '王員' : null, acknowledgementNote: acknowledged ? '已排除障礙物' : null, recoveryStatus: 'UNKNOWN' });

function backend() {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://x');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? 'GET', body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/acknowledgement')) return json({ ...item('705', true), acknowledgementNote: body.note, alreadyAcknowledged: false, location: null, params: null, detail: null, sop: null, trail: [] });
    if (url.pathname.endsWith('/events/live')) return json({ items: [item('705'), item('704', true)], total: 2, page: 1, pageSize: 10, pendingTotal: 1, confirmedTotal: 1, serverTime: Date.now(), timeZone: 'Asia/Taipei' });
    if (url.pathname.endsWith('/events/options')) return json({ vehicles: [{ vehicleCode: 'PMS01', displayName: '一號車', active: true }], eventCodes: [{ value: 'OBSTACLE_DETECTED', label: '偵測到障礙物' }], severities: [], sourceTypes: [], timeZone: 'Asia/Taipei', pageSize: 8, exportLimit: 1000 });
    return json({});
  });
  return { fetch, calls };
}

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); permissions.add('events.events.manage'); denied.length = 0; });
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5))); };
function mount(b: ReturnType<typeof backend>) {
  vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
  act(() => root!.render(createElement(LiveEventsPage, { refreshSignal: 0, onChanged: vi.fn() })));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;
const liveCalls = (b: ReturnType<typeof backend>) => b.calls.filter((call) => call.path.includes('/events/live'));
const type = (node: HTMLTextAreaElement | HTMLInputElement, value: string) => act(() => {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('即時事件清單', () => {
  it('同一張表列出尚未回報與已回報，預設發生時間新到舊，已回報只剩查看詳情', async () => {
    const b = backend(); mount(b); await settle();
    expect(liveCalls(b)[0].path).toContain('sortBy=occurred_at');
    expect(liveCalls(b)[0].path).toContain('direction=desc');
    expect([...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual(['發生時間', '事件編號', '載具名稱', '事件類型', '嚴重度', '回報狀態', '操作']);
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('尚未回報');
    expect(rows[0].textContent).toContain('回報');
    expect(rows[1].textContent).toContain('已回報');
    expect(rows[1].textContent).not.toMatch(/\|\s*回報/);
    expect(rows[0].textContent).toContain('嚴重');
  });

  it('排序欄位第一次點用預設方向，再點反轉；搜尋帶入關鍵字與篩選並回到第一頁', async () => {
    const b = backend(); mount(b); await settle();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="依回報狀態排序"]')!.click()); await settle();
    expect(liveCalls(b).at(-1)!.path).toContain('sortBy=status&direction=asc');
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="依回報狀態排序"]')!.click()); await settle();
    expect(liveCalls(b).at(-1)!.path).toContain('sortBy=status&direction=desc');
    type(document.querySelector<HTMLInputElement>('[aria-label="關鍵字"]')!, ' 障礙 ');
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="搜尋"]')!.click()); await settle();
    expect(decodeURIComponent(liveCalls(b).at(-1)!.path)).toContain('keyword=障礙');
    act(() => button('重置').click()); await settle();
    expect(liveCalls(b).at(-1)!.path).not.toContain('keyword');
  });

  it('回報兩步驟：沒內容不能按確定，最多 50 字，返回修改保留內容，確認回報才送出', async () => {
    const b = backend(); mount(b); await settle();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="回報事件 705"]')!.click());
    expect(document.body.textContent).toContain('#事件編號 705');
    expect(button('確定').disabled).toBe(true);
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    type(textarea, '界'.repeat(60));
    expect(document.body.textContent).toContain('50/50');
    type(textarea, '  已排除障礙物  ');
    act(() => button('確定').click());
    expect(document.body.textContent).toContain('確認送出此事件回報？');
    expect(document.body.textContent).toContain('無法再進行修改或撤回');
    act(() => button('返回修改').click());
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('  已排除障礙物  ');
    expect(b.calls.some((call) => call.path.includes('/acknowledgement'))).toBe(false);
    act(() => button('確定').click());
    act(() => button('確認回報').click()); await settle();
    expect(b.calls.find((call) => call.path.includes('/acknowledgement'))?.body).toEqual({ note: '已排除障礙物' });
    expect(document.querySelectorAll('tbody tr')[0].textContent).toContain('已回報');
    expect(document.body.textContent).toContain('事件已回報');
  });

  it('缺管理權限仍顯示回報，點擊只提示權限不足且不開視窗', async () => {
    permissions.delete('events.events.manage'); const b = backend(); mount(b); await settle();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="回報事件 705"]')!.click());
    expect(denied).toEqual(['events.events.manage']);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
