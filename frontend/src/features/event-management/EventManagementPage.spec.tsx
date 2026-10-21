// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventManagementPage } from './EventManagementPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Listener = (...args: unknown[]) => void;
type LiveProps = { bucket: string; active: boolean; onTotals: (pending: number, confirmed: number) => void };
const listeners = new Map<string, Listener>(); let acquired = 0; let released = 0;
vi.mock('../dashboard/store/useDataSourceStore', () => ({ DEFAULT_DATASOURCE: { backendUrl: 'http://test' } }));
vi.mock('../dashboard/elements/socketManager', () => ({ acquireSocket: () => { acquired += 1; return { on: (n: string, f: Listener) => listeners.set(n, f), off: (n: string) => listeners.delete(n), io: { on: (n: string, f: Listener) => listeners.set(`io:${n}`, f), off: (n: string) => listeners.delete(`io:${n}`) } }; }, releaseSocket: () => { released += 1; } }));
vi.mock('../dashboard/utils/datasourceInvalidationBus', () => ({ subscribeDatasourceInvalidation: () => () => undefined }));
vi.mock('./LiveEventsPage', async () => { const { createElement: h, useEffect } = await import('react'); return { LiveEventsPage: ({ bucket, active, onTotals }: LiveProps) => { useEffect(() => { if (active) onTotals(4, 7); }, [active, onTotals]); return h('div', { 'data-testid': bucket }, `${bucket}:${active}`); } }; });
vi.mock('./HistoryEventsPage', async () => { const { createElement: h } = await import('react'); return { HistoryEventsPage: () => h('div', { 'data-testid': 'history' }, 'history') }; });

let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; listeners.clear(); acquired = 0; released = 0; });
describe('事件管理清單容器', () => {
  it('只有一個側頁內訂閱，三標籤預設待確認且可切換，卸載清理', () => {
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); act(() => root!.render(createElement(EventManagementPage)));
    expect(acquired).toBe(1);
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((node) => node.textContent)).toEqual(['待確認4', '已確認7', '歷史事件查詢']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    act(() => tabs[2].click()); expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    act(() => root?.unmount()); root = null; expect(released).toBe(1); expect(listeners.size).toBe(0);
  });
});
