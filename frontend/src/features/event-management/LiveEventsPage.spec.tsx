// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveEventsPage } from './LiveEventsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const permissions = new Set(['events.events.view', 'events.events.manage']);
const denied: string[] = [];
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => permissions.has(p), require: (p: string) => permissions.has(p) || (denied.push(p), false) }) }));

const item = (id: string, acknowledged = false) => ({ id, eventId: `EVT-${id}`, sourceType: 'VEHICLE', sourceId: 'PMS01', sourceName: '一號車', origin: 'REPORTED', vehicleCode: 'PMS01', eventCode: 'OBSTACLE_DETECTED', eventLabel: '偵測到障礙物', severity: 'WARNING', occurredAt: Date.UTC(2026, 9, 20, 1), occurredAtValid: true, receivedAt: Date.UTC(2026, 9, 20, 1, 0, 1), summary: '前方障礙', acknowledged, acknowledgedAt: acknowledged ? Date.UTC(2026, 9, 20, 2) : null, acknowledgedByName: acknowledged ? '王員' : null, acknowledgementNote: acknowledged ? '已通知現場排除' : null, recoveryStatus: 'UNKNOWN' });

function backend() {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://x');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/acknowledgement')) return json({ ...item('1', true), acknowledgementNote: body.note, alreadyAcknowledged: false, location: null, params: null, detail: null, trail: [] });
    if (url.pathname.endsWith('/events/live')) {
      const confirmed = url.searchParams.get('bucket') === 'confirmed';
      return json({ items: [item('1', confirmed)], total: 1, pendingTotal: 1, confirmedTotal: 1, hasMore: false, nextCursor: null, version: '1', serverTime: Date.now(), timeZone: 'Asia/Taipei' });
    }
    if (/\/events\/\d+$/.test(url.pathname)) return json({ ...item('1', true), location: { x: 1, y: 2 }, params: { safe: true }, detail: '事件完整內容', trail: [{ id: '9', action: 'EVENT_ACKNOWLEDGE', operatorName: '王員', sourceIp: null, result: 'SUCCESS', failureReason: null, note: '已通知現場排除', at: Date.UTC(2026, 9, 20, 2) }] });
    return json({});
  });
  return { fetch, calls };
}

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); permissions.add('events.events.manage'); denied.length = 0; });
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5))); };
function mount(bucket: 'pending' | 'confirmed', b: ReturnType<typeof backend>) {
  vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
  act(() => root!.render(createElement(LiveEventsPage, { bucket, active: true, refreshSignal: 0, onTotals: vi.fn(), onChanged: vi.fn() })));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;

describe('事件集合', () => {
  it('待確認只查 pending，確認緣由空白不送出，合法緣由成功後移除該列', async () => {
    const b = backend(); mount('pending', b); await settle();
    expect(b.calls[0].path).toContain('bucket=pending');
    expect(document.querySelector('th')?.parentElement?.textContent).not.toContain('處理狀態');
    act(() => button('填寫確認緣由').click());
    act(() => button('確認事件').click()); await settle();
    expect(document.body.textContent).toContain('請填寫確認緣由');
    expect(b.calls.some((call) => call.path.includes('/acknowledgement'))).toBe(false);
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '  已通知現場排除  '); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => button('確認事件').click()); await settle();
    expect(b.calls.find((call) => call.path.includes('/acknowledgement'))?.body).toEqual({ note: '已通知現場排除' });
    expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('已確認只查 confirmed，顯示緣由、確認人、確認時間且沒有再次確認', async () => {
    const b = backend(); mount('confirmed', b); await settle();
    expect(b.calls[0].path).toContain('bucket=confirmed');
    expect(document.body.textContent).toContain('已通知現場排除');
    expect(document.body.textContent).toContain('王員');
    expect(document.body.textContent).toContain('2026-10-20 10:00:00');
    expect(document.body.textContent).not.toContain('填寫確認緣由');
    act(() => button('查看詳情').click()); await settle();
    expect(document.body.textContent).toContain('事件完整內容');
    expect(document.body.textContent).toContain('確認緣由：已通知現場排除');
    expect(document.body.textContent).toContain('人工確認・SUCCESS');
    expect(document.body.textContent).not.toContain('送出確認');
  });

  it('缺管理權限仍顯示操作，點擊只提示權限不足且不送請求', async () => {
    permissions.delete('events.events.manage'); const b = backend(); mount('pending', b); await settle();
    expect(button('填寫確認緣由')).toBeTruthy(); act(() => button('填寫確認緣由').click());
    expect(denied).toEqual(['events.events.manage']);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
