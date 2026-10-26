// @vitest-environment jsdom
import { act, createElement, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryEventsPage } from './HistoryEventsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ can: () => true, require: () => true }) }));
type ChangeHandler = (event: { target: { value: string } }) => void;
type InputProps = { value: string; onChange: ChangeHandler; 'aria-label'?: string };
type SelectProps = InputProps & { options: Array<{ value: string; label: string }> };
vi.mock('../../components/SiteDateTimeInput', async () => { const { createElement: h } = await import('react'); return { SiteDateTimeInput: ({ value, onChange, 'aria-label': label }: InputProps) => h('input', { 'aria-label': label, value, onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ target: { value: event.target.value } }) }) }; });
vi.mock('../../components/SiteSelect', async () => { const { createElement: h } = await import('react'); return { SiteSelect: ({ value, onChange, options, 'aria-label': label }: SelectProps) => h('select', { 'aria-label': label, value, onChange: (event: ChangeEvent<HTMLSelectElement>) => onChange({ target: { value: event.target.value } }) }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))) }; });

const row = { id: '1', eventId: 'EVT-1', sourceType: 'VEHICLE', sourceId: 'PMS01', sourceName: '一號車', origin: 'REPORTED', vehicleCode: 'PMS01', eventCode: 'OBSTACLE_DETECTED', eventLabel: '偵測到障礙物', severity: 'WARNING', occurredAt: Date.UTC(2026, 9, 20, 1), occurredAtValid: true, receivedAt: Date.UTC(2026, 9, 20, 1, 0, 1), summary: '事件', acknowledged: false, acknowledgedAt: null, acknowledgedByName: null, acknowledgementNote: null, recoveryStatus: 'UNKNOWN' };
function backend() {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://x'); calls.push(`${url.pathname}${url.search}`);
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/events/options')) return json({ vehicles: [], eventCodes: [], severities: [], sourceTypes: [], timeZone: 'Asia/Taipei', pageSize: 8, exportLimit: 1000 });
    if (url.pathname.endsWith('/events')) return json({ items: [row], total: 1, page: 1, pageSize: 8, snapshot: '1', range: url.searchParams.has('eventRecordId') ? null : { from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')) }, timeZone: 'Asia/Taipei' });
    return json({});
  });
  return { fetch, calls };
}
let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5))); };
function mount(b: ReturnType<typeof backend>) { vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); act(() => root!.render(createElement(HistoryEventsPage))); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;

describe('歷史事件查詢', () => {
  it('載入選項後仍保持 idle，只有按查詢才載入事件；重置回 idle 且不重查', async () => {
    const b = backend(); mount(b); await settle();
    expect(document.body.textContent).toContain('請設定條件後按查詢');
    expect(b.calls.filter((call) => /\/events\?/.test(call))).toHaveLength(0);
    act(() => button('查詢').click()); await settle();
    expect(b.calls.filter((call) => /\/events\?/.test(call))).toHaveLength(1);
    expect(document.body.textContent).toContain('2026-10-20 09:00:00');
    const before = b.calls.length; act(() => button('重置').click()); await settle();
    expect(document.body.textContent).toContain('請設定條件後按查詢');
    expect(b.calls.length).toBe(before);
  });

  it('重新渲染仍不會在未查詢時觸發事件清單查詢', async () => {
    const b = backend(); vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(HistoryEventsPage))); await settle();
    act(() => root!.render(createElement(HistoryEventsPage))); await settle();
    expect(b.calls.filter((call) => /\/events\?/.test(call))).toHaveLength(0);
  });

  it('以超過 JS 安全整數的事件 ID 精確查詢，不夾帶日期、嚴重度或來源條件', async () => {
    const b = backend(); mount(b); await settle();
    expect(document.querySelector('[aria-label="嚴重度"]')).toBeNull();
    expect(document.querySelector('[aria-label="來源"]')).toBeNull();
    const id = document.querySelector<HTMLInputElement>('[aria-label="事件 ID"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(id, '9007199254740993');
      id.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => button('查詢').click()); await settle();
    const call = b.calls.find((value) => /\/events\?/.test(value))!;
    const url = new URL(call, 'http://x');
    expect(url.searchParams.get('eventRecordId')).toBe('9007199254740993');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.has('severity')).toBe(false);
    expect(url.searchParams.has('sourceType')).toBe(false);
    expect(document.body.textContent).toContain('精確事件 ID');
    expect(document.body.textContent).toContain('事件 ID');
  });
});
