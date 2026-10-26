// @vitest-environment jsdom
import { act, createElement, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toLocalInput } from '../event-log-shared/time';
import { VideoHistoryPage } from './VideoHistoryPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => permission !== 'events.video.view', require: () => true }) }));
type InputProps = { value: string; onChange: (event: { target: { value: string } }) => void; 'aria-label'?: string };
type SelectProps = InputProps & { options: Array<{ value: string; label: string }> };
vi.mock('../../components/SiteDateTimeInput', async () => { const { createElement: h } = await import('react'); return { SiteDateTimeInput: ({ value, onChange, 'aria-label': label }: InputProps) => h('input', { type: 'datetime-local', 'aria-label': label, value, onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ target: { value: event.target.value } }) }) }; });
vi.mock('../../components/SiteSelect', async () => { const { createElement: h } = await import('react'); return { SiteSelect: ({ value, onChange, options, 'aria-label': label }: SelectProps) => h('select', { 'aria-label': label, value, onChange: (event: ChangeEvent<HTMLSelectElement>) => onChange({ target: { value: event.target.value } }) }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))) }; });

function backend() {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://x'); calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    let body: unknown = {};
    if (url.pathname.endsWith('/source-options')) body = { items: [{ id: 'src-1', name: '前鏡頭', tags: [], vehicleCode: 'PMS01', location: null, enabled: true, deleted: false, state: 'online' }], total: 1, timeZone: 'Asia/Taipei' };
    else if (url.pathname.endsWith('/recordings/availability')) body = { from: 1, to: 2, sources: [{ sourceId: 'src-1', name: '前鏡頭', removed: false, timeline: [{ kind: 'available', from: 1, to: 2 }], revisions: [] }] };
    else if (url.pathname.endsWith('/playback-sessions')) body = { from: 1, to: 2, sessions: [] };
    else if (url.pathname.endsWith('/recordings/calendar')) body = { days: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, fetch };
}
let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5))); };

describe('影像管理紀錄', () => {
  it('外部帶入來源與時間只預填，搜尋前不查片段、不建播放 session', async () => {
    const api = backend(); vi.stubGlobal('fetch', api.fetch);
    const from = Date.now() - 60_000;
    const to = Date.now();
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoHistoryPage, { request: { from, to, sourceIds: ['src-1'], at: from + 30_000 } }))); await settle();
    expect(api.calls.some((call) => /availability|calendar|playback-sessions|manifest/.test(call))).toBe(false);
    expect(api.calls.some((call) => call.includes('/tabs'))).toBe(false);
    expect(document.body.textContent).toContain('進入本頁不會自動查詢或播放');
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')].map((node) => node.value.replace('.000', ''))).toEqual([
      toLocalInput(from, 'Asia/Taipei'),
      toLocalInput(to, 'Asia/Taipei'),
    ]);
    const search = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '搜尋')!;
    act(() => search.click()); await settle();
    expect(api.calls.some((call) => call.includes('/recordings/availability'))).toBe(true);
    expect(api.calls.some((call) => call.includes('/playback-sessions'))).toBe(true);
  });

  it('送出全部 12 個已選來源，不再因單一路模式截斷', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `src-${index + 1}`);
    const calls: string[] = [];
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://x'); calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
      const body = url.pathname.endsWith('/source-options')
        ? { items: ids.map((id) => ({ id, name: id, tags: ['A'], vehicleCode: null, location: null, enabled: true, deleted: false, state: 'online' })), total: 12, timeZone: 'Asia/Taipei' }
        : url.pathname.endsWith('/recordings/availability')
          ? { from: 1, to: 2, sources: ids.map((id) => ({ sourceId: id, name: id, removed: false, timeline: [], revisions: [] })) }
          : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoHistoryPage, { request: { from: Date.now() - 60_000, to: Date.now(), sourceIds: ids } }))); await settle();
    act(() => buttonByText('搜尋').click()); await settle();
    const availability = calls.find((call) => call.includes('/recordings/availability'))!;
    const url = new URL(availability.replace(/^GET /, ''), 'http://x');
    expect(url.searchParams.get('sourceIds')?.split(',')).toEqual(ids);
    expect(calls.some((call) => call.includes('/tabs'))).toBe(false);
  });

  it('來源對話框取消不套用，確定只套用選擇且不自動查詢', async () => {
    const api = backend(); vi.stubGlobal('fetch', api.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoHistoryPage))); await settle();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="選擇影像來源"]')!.click());
    const source = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.includes('前鏡頭'))!;
    act(() => source.click());
    act(() => buttonByText('取消').click());
    expect(document.body.textContent).toContain('0/12');
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="選擇影像來源"]')!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.includes('前鏡頭'))!.click());
    act(() => buttonByText('確定（1/12）').click());
    expect(document.body.textContent).toContain('1/12');
    expect(api.calls.some((call) => /availability|playback-sessions/.test(call))).toBe(false);
  });

  it('搜尋中重置會取消請求，遲到結果不建立播放 session', async () => {
    let availabilitySignal: AbortSignal | undefined;
    const calls: string[] = [];
    const fetch = vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://x');
      calls.push(url.pathname);
      if (url.pathname.endsWith('/source-options')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'src-1', name: '前鏡頭', tags: [], vehicleCode: 'PMS01', location: null, enabled: true, deleted: false, state: 'online' }], total: 1, timeZone: 'Asia/Taipei' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.pathname.endsWith('/recordings/availability')) {
        availabilitySignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          window.setTimeout(() => resolve(new Response(JSON.stringify({ from: 1, to: 2, sources: [{ sourceId: 'src-1', name: '前鏡頭', removed: false, timeline: [{ kind: 'available', from: 1, to: 2 }], revisions: [] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })), 50);
        });
      }
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetch);
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoHistoryPage, { request: { from: Date.now() - 60_000, to: Date.now(), sourceIds: ['src-1'] } }))); await settle();
    act(() => buttonByText('搜尋').click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1)));
    act(() => buttonByText('重置').click());
    await settle();
    expect(availabilitySignal?.aborted).toBe(true);
    expect(calls.some((call) => call.endsWith('/playback-sessions'))).toBe(false);
    expect(document.body.textContent).toContain('進入本頁不會自動查詢或播放');
  });
});

function buttonByText(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;
}
