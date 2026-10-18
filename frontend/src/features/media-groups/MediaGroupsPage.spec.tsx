// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeGroupsBackend } from './__tests__/fakeGroupsBackend';
import { MediaGroupsPage } from './MediaGroupsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const permissions = new Set<string>();
const denied: string[] = [];
vi.mock('../access-control/AuthContext', () => ({
  useAuth: () => ({
    can: (code: string) => permissions.has(code),
    require: (code: string) => {
      if (permissions.has(code)) return true;
      denied.push(code);
      return false;
    },
  }),
}));
vi.mock('../dashboard/utils/datasourceInvalidationBus', () => ({ subscribeDatasourceInvalidation: () => () => undefined }));

const MEDIA = [
  { id: 'MED-1', name: '到站語音（國語）', media_type: 'audio' as const, description: '國語', available: true },
  { id: 'MED-2', name: '到站文字跑馬燈', media_type: 'text' as const, description: '跑馬燈', available: true },
  { id: 'MED-3', name: '到站語音（英語）', media_type: 'audio' as const, description: '英語', available: true },
  { id: 'MED-4', name: '站名圖片', media_type: 'image' as const, description: '圖片', available: true },
  { id: 'MED-5', name: '宣導影片', media_type: 'video' as const, description: '影片', available: true },
  { id: 'MED-6', name: '缺檔音檔', media_type: 'audio' as const, description: '缺檔', available: false },
  { id: 'MED-7', name: '到站提示音', media_type: 'audio' as const, description: '提示', available: true },
  { id: 'MED-8', name: '月台廣播', media_type: 'audio' as const, description: '第二頁', available: true },
];

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  vi.unstubAllGlobals();
  permissions.clear();
  denied.length = 0;
});

function mount(backend: ReturnType<typeof createFakeGroupsBackend>, grants = ['media.groups.view', 'media.groups.create', 'media.groups.edit', 'media.groups.delete']) {
  grants.forEach((code) => permissions.add(code));
  vi.stubGlobal('fetch', backend.fetch);
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(createElement(MediaGroupsPage)));
}
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
}
const text = () => document.body.textContent ?? '';
const button = (label: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  if (!node) throw new Error(`找不到按鈕 ${label}`);
  return node;
};
const click = async (label: string) => {
  act(() => button(label).click());
  await settle();
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const memberNames = () => [...document.querySelectorAll('ul[aria-label="分組成員（依播放順序）"] li')].map((li) => li.querySelectorAll('span')[0]?.textContent);

describe('媒體分組清單', () => {
  it('建立空分組：名稱必填、去除空白，建立後展開並顯示空分組', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA });
    mount(backend);
    await settle();
    expect(text()).toContain('尚無媒體分組');
    await click('建立分組');
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    expect(button('建立').disabled).toBe(true);
    await type(input, '   ');
    expect(button('建立').disabled).toBe(true);
    await type(input, '  站點到站  ');
    await click('建立');
    expect(backend.calls.some((call) => call.includes('POST /syncdrive-api/media-groups {"name":"站點到站"}'))).toBe(true);
    expect(text()).toContain('分組建立成功');
    expect(text()).toContain('尚未加入媒體');
  });

  it('加入媒體：跨頁保留、依勾選順序、已加入與缺檔不能選，成功後顯示成員', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA, groups: [{ id: 'MGR-A', name: '站點到站', version: 3, mediaIds: ['MED-7'] }] });
    mount(backend);
    await settle();
    await click('展開 站點到站');
    await click('加入媒體');
    const checkbox = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(checkbox('選取 缺檔音檔').disabled).toBe(true);
    // 第二頁先勾，再回第一頁勾
    await click('第 2 頁');
    expect(checkbox('選取 到站提示音').disabled).toBe(true);
    expect(text()).toContain('已加入');
    act(() => checkbox('選取 月台廣播').click());
    await click('第 1 頁');
    act(() => checkbox('選取 宣導影片').click());
    act(() => checkbox('選取 到站文字跑馬燈').click());
    expect(text()).toContain('已選 3 個：月台廣播、宣導影片、到站文字跑馬燈');
    // 搜尋後暫選仍在
    await type(document.querySelector<HTMLInputElement>('input[aria-label="搜尋媒體名稱或內容描述"]')!, '國語');
    act(() => document.querySelector<HTMLInputElement>('input[aria-label="搜尋媒體名稱或內容描述"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
    act(() => checkbox('選取 到站語音（國語）').click());
    expect(text()).toContain('已選 4 個');
    await click('確定');
    const add = backend.calls.find((call) => call.startsWith('POST /syncdrive-api/media-groups/MGR-A/members'))!;
    expect(add).toContain('"media_ids":["MED-8","MED-5","MED-2","MED-1"]');
    expect(add).toContain('"expected_version":3');
    expect(memberNames()).toEqual(['到站提示音', '月台廣播', '宣導影片', '到站文字跑馬燈', '到站語音（國語）']);
    expect(text()).toContain('已加入 4 個媒體');
  });

  it('鍵盤排序：放下後只存一次；失敗時還原到確認過的順序', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA, groups: [{ id: 'MGR-A', name: '站點到站', version: 1, mediaIds: ['MED-1', 'MED-2', 'MED-3'] }] });
    mount(backend);
    await settle();
    await click('展開 站點到站');
    const handle = () => document.querySelector<HTMLButtonElement>('button[aria-label^="調整「到站語音（英語）」"]')!;
    const key = async (k: string) => {
      act(() => handle().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
      await settle(2);
    };
    act(() => handle().focus());
    await key(' ');
    await key('ArrowUp');
    await key('ArrowUp');
    expect(backend.calls.filter((call) => call.startsWith('PUT')).length).toBe(0);
    await key(' ');
    await settle();
    const put = backend.calls.filter((call) => call.startsWith('PUT'));
    expect(put).toHaveLength(1);
    expect(put[0]).toContain('"media_ids":["MED-3","MED-1","MED-2"]');
    expect(memberNames()).toEqual(['到站語音（英語）', '到站語音（國語）', '到站文字跑馬燈']);

    backend.failNextReorder();
    act(() => handle().focus());
    await key(' ');
    await key('ArrowDown');
    await key(' ');
    await settle();
    expect(text()).toContain('順序儲存失敗，已還原');
    expect(memberNames()).toEqual(['到站語音（英語）', '到站語音（國語）', '到站文字跑馬燈']);
  });

  it('移除只呼叫本分組的移除 API，顯示「已從分組移除」，最後一項移除後仍是空分組', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA, groups: [{ id: 'MGR-A', name: '站點到站', version: 1, mediaIds: ['MED-1'] }, { id: 'MGR-B', name: '降級運轉1級', version: 1, mediaIds: ['MED-1'] }] });
    mount(backend);
    await settle();
    await click('展開 站點到站');
    await click('從此分組移除「到站語音（國語）」（不會刪除媒體）');
    expect(backend.calls.filter((call) => call.startsWith('DELETE'))).toEqual(['DELETE /syncdrive-api/media-groups/MGR-A/members/MED-1?expected_version=1']);
    expect(text()).toContain('已從分組移除');
    expect(text()).toContain('尚未加入媒體');
    expect(backend.groups.get('MGR-B')!.mediaIds).toEqual(['MED-1']);
  });

  it('刪除：有引用時列出位置並阻擋；無引用時可刪除', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA, groups: [{ id: 'MGR-A', name: '站點到站', version: 1, mediaIds: ['MED-1'] }, { id: 'MGR-B', name: '降級運轉2級', version: 1, mediaIds: [] }], references: { 'MGR-A': ['到站排程'] } });
    mount(backend);
    await settle();
    await click('刪除分組 站點到站');
    expect(text()).toContain('確定刪除此分組？');
    expect(text()).toContain('刪除後無法復原，但不會影響原始媒體檔案。');
    expect(text()).toContain('媒體排程：到站排程');
    expect(button('刪除').disabled).toBe(true);
    await click('取消');
    await click('刪除分組 降級運轉2級');
    await click('刪除');
    expect(text()).toContain('分組已刪除');
    expect(backend.groups.has('MGR-B')).toBe(false);
    expect(backend.media.size).toBe(MEDIA.length);
  });

  it('編輯只送名稱與版本；名稱未變更不能儲存', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA, groups: [{ id: 'MGR-A', name: '降級運轉2級', version: 4, mediaIds: ['MED-1'] }] });
    mount(backend);
    await settle();
    await click('編輯分組 降級運轉2級');
    expect(button('儲存').disabled).toBe(true);
    await type(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, '降級運轉3級');
    await click('儲存');
    const patch = backend.calls.find((call) => call.startsWith('PATCH'))!;
    expect(patch).toContain('{"name":"降級運轉3級","expected_version":4}');
    expect(patch).not.toContain('media_ids');
    expect(backend.groups.get('MGR-A')!.mediaIds).toEqual(['MED-1']);
  });

  it('只有檢視權限：操作時提示權限不足，不送出修改', async () => {
    const backend = createFakeGroupsBackend({ media: MEDIA, groups: [{ id: 'MGR-A', name: '站點到站', version: 1, mediaIds: ['MED-1', 'MED-2'] }] });
    mount(backend, ['media.groups.view']);
    await settle();
    await click('建立分組');
    await click('展開 站點到站');
    await click('加入媒體');
    await click('從此分組移除「到站語音（國語）」（不會刪除媒體）');
    expect(denied).toEqual(['media.groups.create', 'media.groups.edit', 'media.groups.edit']);
    expect(backend.calls.every((call) => call.startsWith('GET'))).toBe(true);
    expect(memberNames()).toEqual(['到站語音（國語）', '到站文字跑馬燈']);
  });
});
