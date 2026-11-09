// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventManagementPage } from './EventManagementPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Listener>(); let acquired = 0; let released = 0;
vi.mock('../dashboard/store/useDataSourceStore', () => ({ DEFAULT_DATASOURCE: { backendUrl: 'http://test' } }));
vi.mock('../dashboard/elements/socketManager', () => ({ acquireSocket: () => { acquired += 1; return { on: (n: string, f: Listener) => listeners.set(n, f), off: (n: string) => listeners.delete(n), io: { on: (n: string, f: Listener) => listeners.set(`io:${n}`, f), off: (n: string) => listeners.delete(`io:${n}`) } }; }, releaseSocket: () => { released += 1; } }));
vi.mock('../dashboard/utils/datasourceInvalidationBus', () => ({ subscribeDatasourceInvalidation: () => () => undefined }));
vi.mock('./LiveEventsPage', async () => { const { createElement: h } = await import('react'); return { LiveEventsPage: ({ refreshSignal }: { refreshSignal: number }) => h('div', { 'data-testid': 'live' }, `refresh:${refreshSignal}`) }; });

let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; listeners.clear(); acquired = 0; released = 0; vi.useRealTimers(); });
describe('即時事件清單容器', () => {
  it('沒有分頁籤，只訂閱一次；新事件合併後重查一次，卸載清理', () => {
    vi.useFakeTimers();
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); act(() => root!.render(createElement(EventManagementPage)));
    expect(acquired).toBe(1);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    act(() => { listeners.get('security_event')!(); listeners.get('security_event')!(); vi.advanceTimersByTime(300); });
    expect(document.querySelector('[data-testid="live"]')!.textContent).toBe('refresh:1');
    act(() => root?.unmount()); root = null; expect(released).toBe(1); expect(listeners.size).toBe(0);
  });
});
