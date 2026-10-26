// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoResourcesPage } from './VideoResourcesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  sources: vi.fn(), sourceTags: vi.fn(), storageStatus: vi.fn(),
}));
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, can: () => true, require: () => true }) }));
vi.mock('./api', async () => {
  const source = { id: 'src-1', version: 1, name: '前鏡頭', tags: ['PMS01'], enabled: true, recordingEnabled: false, vehicleCode: 'PMS01', location: null, connection: { maskedUrl: 'rtsp://***' }, actualStatus: { state: 'online', stale: false, reason: null, recording: false } };
  mocks.sources.mockResolvedValue({ items: [source], total: 1, page: 1, pageSize: 20 });
  mocks.sourceTags.mockResolvedValue([{ tag: 'PMS01', count: 1 }]);
  mocks.storageStatus.mockResolvedValue(null);
  return { videoApi: { sources: mocks.sources, sourceTags: mocks.sourceTags, storageStatus: mocks.storageStatus }, type: {} };
});
vi.mock('../../components/SiteMultiSelect', () => ({ SiteMultiSelect: () => createElement('button', { type: 'button' }, '全部標籤') }));

let root: Root | null = null; let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; });
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5))); };

describe('影像資源列操作', () => {
  it('每列只顯示單一操作按鈕，選單提供四個既有動作', async () => {
    box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(VideoResourcesPage))); await settle();
    expect(document.body.textContent).not.toContain('查看影像紀錄');
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="前鏡頭 操作"]')!;
    act(() => trigger.click()); await settle();
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('編輯');
    expect(menu.textContent).toContain('複製');
    expect(menu.textContent).toContain('查看影像紀錄');
    expect(menu.textContent).toContain('刪除');
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
  });
});
