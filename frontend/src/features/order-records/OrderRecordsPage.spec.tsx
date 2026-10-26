// @vitest-environment jsdom
import { act, createElement, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderRecordsPage from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type InputProps = { value: string; onChange: (event: { target: { value: string } }) => void; 'aria-label'?: string };
type SelectProps = InputProps & { options: Array<{ value: string; label: string }> };
vi.mock('../../components/SiteDateTimeInput', async () => { const { createElement: h } = await import('react'); return { SiteDateTimeInput: ({ value, onChange, 'aria-label': label }: InputProps) => h('input', { type: 'datetime-local', 'aria-label': label, value, onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ target: { value: event.target.value } }) }) }; });
vi.mock('../../components/SiteSelect', async () => { const { createElement: h } = await import('react'); return { SiteSelect: ({ value, onChange, options, 'aria-label': label }: SelectProps) => h('select', { 'aria-label': label, value, onChange: (event: ChangeEvent<HTMLSelectElement>) => onChange({ target: { value: event.target.value } }) }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))) }; });

const options = { time_zone: 'Asia/Taipei', page_size: 20, vehicles: [], categories: [{ value: 'pending', label: '待執行' }] };
const page = { items: [{ source: 'order', source_id: 'ORDER-1', order_id: 'ORDER-1', display_name: '真實訂單', vehicle_code: 'PMS01', route_name: '上行', category: 'pending', status: 'PENDING', status_hint: null, planned_start: Date.UTC(2026, 9, 20), planned_end: null, actual_start: null, actual_end: null, reason: null, stations: [] }], total: 1, page: 1, page_size: 20, sort_by: 'planned_start', direction: 'desc', time_zone: 'Asia/Taipei', snapshot: Date.now() };
function backend() {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://x'); calls.push(`${url.pathname}${url.search}`);
    const body = url.pathname.endsWith('/records/options') ? options : page;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, fetch };
}
let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5))); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;

describe('訂單管理記錄', () => {
  it('首次只取選項，按搜尋才取 operation_orders 記錄，重置不重查', async () => {
    const api = backend(); vi.stubGlobal('fetch', api.fetch);
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(OrderRecordsPage))); await settle();
    expect(api.calls.filter((call) => /\/records\?/.test(call))).toHaveLength(0);
    expect(document.body.textContent).toContain('請設定條件後按搜尋');
    act(() => button('搜尋').click()); await settle();
    expect(api.calls.filter((call) => /\/records\?/.test(call))).toHaveLength(1);
    expect(document.body.textContent).toContain('真實訂單');
    const count = api.calls.length;
    act(() => button('重置').click()); await settle();
    expect(api.calls).toHaveLength(count);
    expect(document.body.textContent).toContain('請設定條件後按搜尋');
  });
});
