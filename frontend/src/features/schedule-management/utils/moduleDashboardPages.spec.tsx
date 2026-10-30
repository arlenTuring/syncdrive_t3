// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModuleDashboardPages, type ModuleDashboardPage } from './moduleDashboardPages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGES_STORAGE_KEY = 'syncdrive_vtms_module_dashboard_pages';

const backendRow = {
  id: 'mdp-a',
  moduleId: 'dashboard',
  label: '即時圖台',
  planeId: 'plane-1',
  sortOrder: 0,
  createdAt: 1000,
};

/** null 代表後端連不上 */
let backendRows: unknown[] | null = [];
let fetchMock: ReturnType<typeof vi.fn>;
let latest: ReturnType<typeof useModuleDashboardPages> | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe() {
  const value = useModuleDashboardPages();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

function putCalls() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
}

async function mount() {
  await act(async () => root!.render(createElement(Probe)));
  // 讓 refresh 的 promise 鏈與其後的回寫 effect 都跑完
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  backendRows = [];
  latest = null;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return new Response('{}', { status: 200 });
    if (backendRows === null) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(backendRows), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.unstubAllGlobals();
});

describe('useModuleDashboardPages', () => {
  it('載入並同步後端清單時不送 PUT', async () => {
    backendRows = [backendRow];
    await mount();
    expect(latest?.[0].map((page) => page.id)).toEqual(['mdp-a']);
    expect(putCalls()).toHaveLength(0);
  });

  it('本機快取與後端不同時，以後端為準且不回寫', async () => {
    const stale: ModuleDashboardPage = { ...backendRow, label: '舊名稱' };
    window.localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify([stale]));
    backendRows = [backendRow];
    await mount();
    expect(latest?.[0][0].label).toBe('即時圖台');
    expect(putCalls()).toHaveLength(0);
  });

  it('後端連不上時不回寫', async () => {
    window.localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify([backendRow]));
    backendRows = null;
    await mount();
    expect(latest?.[0].map((page) => page.id)).toEqual(['mdp-a']);
    expect(putCalls()).toHaveLength(0);
  });

  it('使用者真的改了清單才送 PUT', async () => {
    backendRows = [backendRow];
    await mount();
    await act(async () => {
      latest![1]((prev) => prev.map((page) => ({ ...page, label: '新名稱' })));
    });
    const puts = putCalls();
    expect(puts).toHaveLength(1);
    const body = JSON.parse((puts[0][1] as RequestInit).body as string);
    expect(body.items[0]).toMatchObject({ id: 'mdp-a', label: '新名稱', sortOrder: 0 });
  });

  it('後端是空的而本機有對應：整批遷移上去一次', async () => {
    window.localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify([backendRow]));
    backendRows = [];
    await mount();
    const puts = putCalls();
    expect(puts).toHaveLength(1);
    const body = JSON.parse((puts[0][1] as RequestInit).body as string);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['mdp-a']);
  });

  it('後端與本機都是空的：不送 PUT', async () => {
    await mount();
    expect(putCalls()).toHaveLength(0);
  });
});
