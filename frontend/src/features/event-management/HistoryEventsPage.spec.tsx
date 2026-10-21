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
    if (url.pathname.endsWith('/events')) return json({ items: [row], total: 1, page: 1, pageSize: 8, snapshot: '1', range: { from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')) }, timeZone: 'Asia/Taipei' });
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

  it('未查詢時背景 refreshSignal 不會觸發事件清單查詢', async () => {
    const b = backend(); vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(HistoryEventsPage, { refreshSignal: 1 }))); await settle();
    act(() => root!.render(createElement(HistoryEventsPage, { refreshSignal: 2 }))); await settle();
    expect(b.calls.filter((call) => /\/events\?/.test(call))).toHaveLength(0);
  });
});
