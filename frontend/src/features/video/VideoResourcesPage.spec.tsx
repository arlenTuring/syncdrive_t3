// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoResourcesPage } from './VideoResourcesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  sources: vi.fn(), sourceTags: vi.fn(), storageStatus: vi.fn(), sourceOptions: vi.fn(),
}));
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, can: () => true, require: () => true }) }));
vi.mock('./api', async () => {
  const source = { id: 'src-1', version: 1, name: '前鏡頭', tags: ['PMS01'], enabled: true, recordingEnabled: false, vehicleCode: 'PMS01', location: null, connection: { maskedUrl: 'rtsp://***' }, actualStatus: { state: 'online', stale: false, reason: null, recording: false } };
  mocks.sources.mockResolvedValue({ items: [source], total: 1, page: 1, pageSize: 20 });
  mocks.sourceTags.mockResolvedValue([{ tag: 'PMS01', count: 1 }]);
  mocks.storageStatus.mockResolvedValue(null);
  mocks.sourceOptions.mockResolvedValue({ items: [{ id: 'src-1', name: '前鏡頭', tags: ['PMS01'], vehicleCode: 'PMS01', location: null, enabled: true, deleted: false, state: 'online' }], total: 1, timeZone: 'Asia/Taipei' });
  return { videoApi: { sources: mocks.sources, sourceTags: mocks.sourceTags, storageStatus: mocks.storageStatus, sourceOptions: mocks.sourceOptions }, type: {} };
});
vi.mock('../../components/SiteMultiSelect', () => ({ SiteMultiSelect: ({ onChange }: { onChange: (ids: string[]) => void }) => createElement('button', { type: 'button', 'aria-label': '選擇影像來源', onClick: () => onChange(['src-1']) }, '選擇影像來源') }));

let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; });
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5))); };

describe('影像來源管理', () => {
  it('每列只有編輯、刪除兩個圖示；啟用與連線狀態用標籤顯示', async () => {
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoResourcesPage))); await settle();
    expect(document.querySelector('[aria-label="編輯 前鏡頭"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="刪除 前鏡頭"]')).not.toBeNull();
    expect(document.querySelector('[role="switch"]')).toBeNull();
    const row = document.querySelector('tbody tr')!;
    expect(row.textContent).toContain('啟用');
    expect(row.textContent).toContain('上線');
  });

  it('選來源後按搜尋才查詢；排序與篩選交給伺服器', async () => {
    mocks.sources.mockClear();
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoResourcesPage))); await settle();
    const search = document.querySelector<HTMLButtonElement>('button[aria-label="搜尋"]')!;
    expect(search.disabled).toBe(true);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="選擇影像來源"]')!.click());
    expect(search.disabled).toBe(false);
    const before = mocks.sources.mock.calls.length;
    act(() => search.click()); await settle();
    expect(mocks.sources.mock.calls.length).toBeGreaterThan(before);
    expect(mocks.sources.mock.calls.at(-1)![0]).toMatchObject({ ids: ['src-1'], sort: 'name', page: 1 });
    act(() => [...document.querySelectorAll<HTMLButtonElement>('th button')].find((b) => b.textContent?.includes('連線狀態'))!.click()); await settle();
    expect(mocks.sources.mock.calls.at(-1)![0]).toMatchObject({ sort: 'status' });
  });
});
