// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Tile } from './api';
import { VideoMonitorPage } from './VideoMonitorPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const permissions = new Set<string>();
vi.mock('../access-control/AuthContext', () => ({
  useAuth: () => ({ can: (code: string) => permissions.has(code), require: (code: string) => permissions.has(code) }),
}));
vi.mock('../dashboard/utils/datasourceInvalidationBus', () => ({ subscribeDatasourceInvalidation: () => () => undefined }));

/** 播放器掛載次數：進出全螢幕不能重建播放器 */
const players = { mounted: 0, unmounted: 0 };
vi.mock('./LivePlayer', () => ({
  LivePlayer: ({ hlsUrl }: { hlsUrl: string }) => {
    useEffect(() => {
      players.mounted += 1;
      return () => {
        players.unmounted += 1;
      };
    }, []);
    return createElement('video', { 'data-src': hlsUrl });
  },
}));

const tile = (i: number, rect: Partial<Tile>): Tile => ({ id: `t${i}`, position: i, sourceId: `s${i}`, displayName: null, x: 0, y: 0, w: 5000, h: 5000, version: 1, ...rect });
const boot: Bootstrap = {
  tabs: [
    {
      id: 'tab1', name: '月台', position: 0, tileCount: 3, canvasAspectRatio: 16 / 9, canvas: 10000, version: 1,
      // 不等大三格：左大格＋右上、右下
      tiles: [tile(0, { w: 6000, h: 10000 }), tile(1, { x: 6000, w: 4000 }), tile(2, { x: 6000, y: 5000, w: 4000 })],
    },
  ],
  sources: [0, 1, 2].map((i) => ({ id: `s${i}`, name: `鏡頭${i}`, tags: [], vehicleCode: null, location: null, enabled: true, deleted: false, state: 'online' as const })),
  storage: null,
};
const sessions: string[] = [];
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  videoApi: {
    bootstrap: async () => boot,
    liveSession: async (sourceId: string) => {
      sessions.push(sourceId);
      return { sourceId, expiresAt: Date.now() + 600_000, hlsUrl: `/hls/${sourceId}`, whepUrl: `/whep/${sourceId}`, status: {} };
    },
  },
}));

let root: Root | null = null;
let box: HTMLDivElement | null = null;
let fsElement: Element | null = null;
let requests: Element[] = [];
let reject = false;
const enter = (el: Element) => {
  fsElement = el;
  document.dispatchEvent(new Event('fullscreenchange'));
};

beforeEach(() => {
  players.mounted = 0;
  players.unmounted = 0;
  sessions.length = 0;
  requests = [];
  reject = false;
  fsElement = null;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsElement });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  document.exitFullscreen = vi.fn(async () => {
    fsElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  HTMLElement.prototype.requestFullscreen = vi.fn(async function (this: HTMLElement) {
    requests.push(this);
    if (reject) throw new TypeError('Permissions check failed');
    enter(this);
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  box?.remove();
  permissions.clear();
  vi.unstubAllGlobals();
});

async function mount(grants = ['events.video.view']) {
  grants.forEach((g) => permissions.add(g));
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(createElement(VideoMonitorPage)));
  for (let i = 0; i < 6; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5)));
}
const button = (label: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
  if (!node) throw new Error(`找不到按鈕 ${label}`);
  return node;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
  await act(async () => new Promise((r) => setTimeout(r, 5)));
};

describe('監控標籤頁整體全螢幕', () => {
  it('只有檢視權限也能進入；全螢幕對象是包住標籤名稱與全部格子的容器；離開回原樣', async () => {
    await mount();
    expect(players.mounted).toBe(3);
    await click('標籤頁全螢幕');
    expect(requests).toHaveLength(1);
    const target = requests[0];
    expect(target.querySelectorAll('video')).toHaveLength(3);
    expect(target.querySelector('[role="tablist"]')).toBeNull();
    expect(target.textContent).toContain('月台');
    expect(target.textContent).toContain('離開全螢幕');
    await click('離開全螢幕');
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('離開全螢幕');
  });

  it('進出全螢幕與單格放大都不重建播放器、不重取播放授權', async () => {
    await mount();
    const sessionsBefore = sessions.length;
    await click('標籤頁全螢幕');
    await click('鏡頭0 放大');
    expect(requests).toHaveLength(1); // 單格放大在容器內處理，不再要求第二層原生全螢幕
    expect(document.body.textContent).toContain('單格放大中');
    await click('鏡頭0 返回整頁');
    expect(document.body.textContent).not.toContain('單格放大中');
    // 瀏覽器 Esc／外部退出：以 fullscreenchange 為準
    await act(async () => {
      fsElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(document.body.textContent).not.toContain('離開全螢幕');
    expect(players.mounted).toBe(3);
    expect(players.unmounted).toBe(0);
    expect(sessions.length).toBe(sessionsBefore);
  });

  it('瀏覽器拒絕時顯示錯誤，不假裝已全螢幕', async () => {
    await mount();
    reject = true;
    await click('標籤頁全螢幕');
    expect(document.body.textContent).toContain('無法進入全螢幕');
    expect(document.body.textContent).not.toContain('離開全螢幕');
  });

  it('不支援原生全螢幕：同一容器網頁滿版並標明；Esc 退出', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    await mount();
    await click('標籤頁全螢幕');
    expect(requests).toHaveLength(0);
    expect(document.body.textContent).toContain('網頁滿版');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.body.textContent).not.toContain('網頁滿版');
    expect(players.unmounted).toBe(0);
  });

  it('離開頁面時退出自己的全螢幕；別人的全螢幕不動', async () => {
    await mount();
    await click('標籤頁全螢幕');
    act(() => root?.unmount());
    root = null;
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    fsElement = document.createElement('div');
    await mount();
    act(() => root?.unmount());
    root = null;
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
