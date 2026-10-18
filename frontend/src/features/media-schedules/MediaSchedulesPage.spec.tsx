// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaSchedulesPage } from './MediaSchedulesPage';

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
// 網站日期時間面板改成一般輸入框，測試直接填值（值格式與原元件相同）
vi.mock('../../components/SiteDateTimeInput', async () => {
  const { createElement: h } = await import('react');
  return {
    SiteDateTimeInput: ({ value, onChange, type, 'aria-label': label }: { value: string; onChange: (event: { target: { value: string } }) => void; type: string; 'aria-label'?: string }) =>
      h('input', { 'aria-label': label, 'data-kind': type, value, onChange: (event: { target: { value: string } }) => onChange({ target: { value: event.target.value } }) }),
  };
});

type Media = { id: string; name: string; media_type: 'audio' | 'text' | 'image' | 'video'; description: string; available: boolean };
const MEDIA: Media[] = [
  { id: 'MED-1', name: '到站語音', media_type: 'audio', description: '國語', available: true },
  { id: 'MED-2', name: '跑馬燈', media_type: 'text', description: '文字', available: true },
  { id: 'MED-3', name: '站名圖片', media_type: 'image', description: '圖片', available: true },
  { id: 'MED-4', name: '宣導影片', media_type: 'video', description: '影片', available: true },
  { id: 'MED-5', name: '缺檔音檔', media_type: 'audio', description: '缺檔', available: false },
  { id: 'MED-6', name: '月台廣播', media_type: 'audio', description: '第二頁', available: true },
  { id: 'MED-7', name: '提示音', media_type: 'audio', description: '第二頁', available: true },
];
const VEHICLES = [
  { id: 'VEH-1', vehicle_code: 'BUS-01', display_name: '一號車' },
  { id: 'VEH-2', vehicle_code: 'BUS-02', display_name: '二號車' },
];

function summary(id: string) {
  const m = MEDIA.find((item) => item.id === id);
  return m
    ? { ...m, text_excerpt: null, original_name: `${id}.bin`, unavailable_reason: m.available ? null : 'missing_file', unavailable_label: m.available ? null : '缺少檔案', missing: false }
    : { id, name: null, media_type: null, description: '', available: false, unavailable_label: '媒體已不存在', missing: true };
}

type Stored = Record<string, unknown> & { id: string; name: string; version: number; media_ids: string[] };

/** 記憶體內的媒體排程後端（只在測試用）：照 API 規則回應，記錄每次呼叫 */
function createBackend(init: { schedules?: Stored[]; groups?: Array<{ id: string; name: string; version: number; mediaIds: string[] }> } = {}) {
  const schedules = new Map((init.schedules ?? []).map((s) => [s.id, { ...s }]));
  const groups = init.groups ?? [];
  const calls: string[] = [];
  const present = (s: Stored) => ({
    time_zone: 'Asia/Taipei',
    run_local: null,
    run_at: null,
    start_date: null,
    end_date: null,
    weekly: null,
    target_scope: 'all',
    source_group: null,
    next_run_at: null,
    status: 'active',
    summary: '',
    created_at: 1,
    updated_at: 1,
    ...s,
    vehicles: ((s.vehicle_ids as string[]) ?? []).map((id) => VEHICLES.find((v) => v.id === id) ?? { id, vehicle_code: id, display_name: '已移除的載具', active: false }),
    item_count: s.media_ids.length,
    items: s.media_ids.map(summary),
  });
  const presentGroup = (g: (typeof groups)[number]) => ({
    ...g,
    member_count: g.mediaIds.length,
    members: g.mediaIds.map(summary),
    playable: g.mediaIds.length > 0 && g.mediaIds.every((id) => summary(id).available),
    unavailable_label: !g.mediaIds.length ? '空分組' : g.mediaIds.every((id) => summary(id).available) ? null : '成員無法播放',
    unavailable_reason: null,
    updated_at: '1',
  });
  const page = <T,>(items: T[], url: URL, size: number) => {
    const p = Number(url.searchParams.get('page') || 1);
    return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, page_size: size };
  };
  const handle = (method: string, url: URL, body: Record<string, unknown>) => {
    const parts = url.pathname.replace('/syncdrive-api/media-play-schedules', '').split('/').filter(Boolean);
    const keyword = url.searchParams.get('keyword') ?? '';
    if (method === 'GET' && !parts.length) return { status: 200, body: page([...schedules.values()].filter((s) => s.name.includes(keyword)).map(present), url, 10) };
    if (method === 'GET' && parts[0] === 'settings') return { status: 200, body: { time_zone: 'Asia/Taipei' } };
    if (method === 'GET' && parts[0] === 'options' && parts[1] === 'vehicles') return { status: 200, body: { items: VEHICLES } };
    if (method === 'GET' && parts[0] === 'options' && parts[1] === 'groups') return { status: 200, body: page(groups.filter((g) => g.name.includes(keyword)).map(presentGroup), url, 5) };
    if (method === 'GET' && parts[0] === 'options' && parts[1] === 'media') return { status: 200, body: { ...page(MEDIA.filter((m) => m.name.includes(keyword)).map((m) => summary(m.id)), url, 6), limits: { playlist_max: 100 } } };
    if (method === 'POST' && !parts.length) {
      const created = { ...body, id: `SCH-${schedules.size + 1}`, version: 1 } as Stored;
      schedules.set(created.id, created);
      return { status: 201, body: present(created) };
    }
    const found = schedules.get(parts[0]);
    if (!found) return { status: 404, body: { message: '找不到媒體排程' } };
    if (method === 'GET' && parts[1] === 'results') return { status: 200, body: { items: [] } };
    if (method === 'GET') return { status: 200, body: present(found) };
    if (method === 'PUT') {
      if (body.expected_version !== found.version) return { status: 409, body: { message: '排程已被其他使用者修改，請重新整理' } };
      const next = { ...found, ...body, version: found.version + 1 } as Stored;
      schedules.set(found.id, next);
      return { status: 200, body: present(next) };
    }
    if (method === 'DELETE') {
      schedules.delete(found.id);
      return { status: 200, body: { deleted: true } };
    }
    return { status: 400, body: { message: 'unsupported' } };
  };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${method} ${url.pathname}${url.search}${init?.body ? ` ${init.body}` : ''}`);
    const result = handle(method, url, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetch, calls, schedules };
}

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  permissions.clear();
  denied.length = 0;
});

const ALL = ['media.schedule.view', 'media.schedule.create', 'media.schedule.edit', 'media.schedule.delete'];
function mount(backend: ReturnType<typeof createBackend>, grants = ALL) {
  grants.forEach((code) => permissions.add(code));
  vi.stubGlobal('fetch', backend.fetch);
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(createElement(MediaSchedulesPage)));
}
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
}
const text = () => document.body.textContent ?? '';
/** 先找最上層對話框（巢狀的子對話框在 DOM 裡排在後面），找不到再找整頁 */
const button = (label: string) => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  const scope = dialogs[dialogs.length - 1] ?? document;
  const match = (item: HTMLButtonElement) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label;
  const node = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(match) ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find(match);
  if (!node) throw new Error(`找不到按鈕 ${label}`);
  return node;
};
const click = async (label: string) => {
  act(() => button(label).click());
  await settle();
};
const input = (label: string) => {
  const node = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!node) throw new Error(`找不到欄位 ${label}`);
  return node;
};
const type = async (node: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const nameInput = () => document.querySelector<HTMLInputElement>('input[placeholder="請輸入排程名稱"]')!;
const radio = (label: string) => [...document.querySelectorAll<HTMLLabelElement>('label')].find((node) => node.textContent?.trim() === label)!.querySelector('input')!;
const playlist = () => [...document.querySelectorAll('ol[aria-label="播放清單"] li')].map((li) => li.querySelectorAll('span')[1]?.textContent?.trim());
const lastCall = (prefix: string) => [...getCalls()].reverse().find((call) => call.startsWith(prefix))!;
let getCalls: () => string[] = () => [];

describe('媒體排程設定', () => {
  it('沒有循環播放；空表單送出顯示必填錯誤，不呼叫 API', async () => {
    const backend = createBackend();
    getCalls = () => backend.calls;
    mount(backend);
    await settle();
    expect(text()).toContain('尚無媒體排程');
    await click('建立媒體排程');
    const modes = [...document.querySelectorAll('[role="radiogroup"][aria-label="播放模式"] label')].map((node) => node.textContent?.trim());
    expect(modes).toEqual(['預約播放', '定時播放']);
    expect(text()).not.toMatch(/循環/);
    expect(text()).toContain('Asia/Taipei');
    await click('建立');
    expect(text()).toContain('請輸入排程名稱');
    expect(text()).toContain('請選擇開始時間');
    expect(text()).toContain('播放清單至少要有一個媒體');
    expect(backend.calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('建立預約：加入媒體跨頁依勾選順序、不重複、缺檔不能選，拖曳把手鍵盤排序、× 移除；只送預約欄位', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T02:00:00Z') });
    const backend = createBackend();
    getCalls = () => backend.calls;
    mount(backend);
    await settle();
    await click('建立媒體排程');
    await type(nameInput(), '  早班到站  ');
    // 先填定時欄位，再切回預約：定時欄位不應送出
    act(() => radio('定時播放').click());
    await type(input('定時播放開始日期'), '2026-10-20');
    act(() => radio('預約播放').click());
    await type(input('預約播放開始時間'), '2026-10-18T09:00:00');
    await click('建立');
    expect(text()).toContain('預約時間必須晚於現在');
    await type(input('預約播放開始時間'), '2026-10-19T08:30:00');

    await click('加入媒體');
    expect(input('選取 缺檔音檔').disabled).toBe(true);
    await click('第 2 頁');
    act(() => input('選取 提示音').click());
    await click('第 1 頁');
    act(() => input('選取 站名圖片').click());
    act(() => input('選取 到站語音').click());
    await click('確定');
    expect(playlist()).toEqual(['提示音', '站名圖片', '到站語音']);
    // 再開一次：已在清單內的標「已加入」不能再選
    await click('加入媒體');
    expect(input('選取 站名圖片').disabled).toBe(true);
    await click('取消');

    const handle = () => button('調整 到站語音 的順序');
    const key = async (k: string) => {
      act(() => handle().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
      await settle(2);
    };
    act(() => handle().focus());
    await key(' ');
    await key('ArrowUp');
    await key('ArrowUp');
    await key(' ');
    expect(playlist()).toEqual(['到站語音', '提示音', '站名圖片']);
    await click('從播放清單移除 提示音');
    expect(playlist()).toEqual(['到站語音', '站名圖片']);

    await click('建立');
    const post = lastCall('POST');
    const payload = JSON.parse(post.slice(post.indexOf('{')));
    expect(payload).toEqual({
      name: '早班到站',
      mode: 'reserved',
      time_zone: 'Asia/Taipei',
      target_scope: 'all',
      vehicle_ids: [],
      media_ids: ['MED-1', 'MED-3'],
      source_group: null,
      run_local: '2026-10-19T08:30',
    });
    expect(text()).toContain('媒體排程建立成功');
  });

  it('定時：設定時間子對話框標出重複、取消不影響主表單、確定後排序；指定多台載具；無結束日期', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T02:00:00Z') });
    const backend = createBackend();
    getCalls = () => backend.calls;
    mount(backend);
    await settle();
    await click('建立媒體排程');
    await type(nameInput(), '週間宣導');
    act(() => radio('定時播放').click());
    await settle(1);
    await type(input('定時播放開始日期'), '2026-10-20');

    await click('設定時間');
    act(() => input('週一播放').click());
    await settle(1);
    await type(input('週一第 1 個時間'), '08:00');
    await click('週一新增時間');
    await type(input('週一第 2 個時間'), '08:00');
    expect(text()).toContain('與第 1 個時間重複');
    await click('取消');
    expect(text()).toContain('尚未設定星期與時間');

    await click('設定時間');
    act(() => input('週三播放').click());
    await settle(1);
    await type(input('週三第 1 個時間'), '20:00');
    await click('週三新增時間');
    await type(input('週三第 2 個時間'), '07:30');
    act(() => input('週日播放').click());
    await settle(1);
    await type(input('週日第 1 個時間'), '12:00');
    await click('確定');
    const tags = [...document.querySelectorAll('ul[aria-label="已設定的播放時間"] li')].map((li) => li.textContent);
    expect(tags).toEqual(['週三07:3020:00', '週日12:00']);

    act(() => radio('指定載具').click());
    await settle(1);
    act(() => input('指定載具 二號車').click());
    act(() => input('指定載具 一號車').click());
    await click('加入媒體');
    act(() => input('選取 跑馬燈').click());
    await click('確定');
    await click('建立');
    const post = lastCall('POST');
    const payload = JSON.parse(post.slice(post.indexOf('{')));
    expect(payload).toMatchObject({ mode: 'timed', start_date: '2026-10-20', end_date: null, weekly: { '3': ['07:30', '20:00'], '7': ['12:00'] }, target_scope: 'vehicles', vehicle_ids: ['VEH-2', 'VEH-1'], media_ids: ['MED-2'] });
    expect(payload).not.toHaveProperty('run_local');
  });

  it('套用媒體分組：單選、展開查看不影響選取、空分組不能選；已有清單先確認取代，取消保留原清單；儲存帶來源分組版本', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T02:00:00Z') });
    const backend = createBackend({
      schedules: [{ id: 'SCH-A', name: '舊排程', mode: 'reserved', run_local: '2026-10-19T08:00', version: 4, media_ids: ['MED-4'], summary: '2026-10-19 08:00' }],
      groups: [
        { id: 'GRP-1', name: '到站組合', version: 2, mediaIds: ['MED-2', 'MED-1'] },
        { id: 'GRP-2', name: '空的分組', version: 1, mediaIds: [] },
      ],
    });
    getCalls = () => backend.calls;
    mount(backend);
    await settle();
    await click('編輯排程 舊排程');
    expect(nameInput().value).toBe('舊排程');
    expect(input('預約播放開始時間').value).toBe('2026-10-19T08:00');
    expect(playlist()).toEqual(['宣導影片']);

    await click('套用媒體分組');
    expect(input('選擇分組 空的分組').disabled).toBe(true);
    expect(text()).toContain('空分組（不可套用）');
    await click('展開分組 空的分組 的成員');
    expect(text()).toContain('此分組沒有媒體');
    act(() => input('選擇分組 到站組合').click());
    await click('套用');
    expect(text()).toContain('取代目前播放清單');
    await click('取消');
    await click('取消');
    expect(playlist()).toEqual(['宣導影片']);

    await click('套用媒體分組');
    act(() => input('選擇分組 到站組合').click());
    await click('套用');
    await click('取代');
    expect(playlist()).toEqual(['跑馬燈', '到站語音']);
    expect(text()).toContain('曾套用分組「到站組合」');
    await click('儲存');
    const put = lastCall('PUT');
    expect(put).toContain('"media_ids":["MED-2","MED-1"]');
    expect(put).toContain('"source_group":{"id":"GRP-1","version":2}');
    expect(put).toContain('"expected_version":4');
  });

  it('已過期的預約：只改名稱可以儲存，不用改時間；版本衝突時提示重新整理', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T02:00:00Z') });
    const backend = createBackend({ schedules: [{ id: 'SCH-A', name: '昨天的預約', mode: 'reserved', run_local: '2026-10-17T08:00', status: 'completed', version: 2, media_ids: ['MED-1'] }] });
    getCalls = () => backend.calls;
    mount(backend);
    await settle();
    expect(text()).toContain('已完成，不會再播放');
    await click('編輯排程 昨天的預約');
    await type(nameInput(), '昨天的預約（改名）');
    await click('儲存');
    expect(lastCall('PUT')).toContain('"run_local":"2026-10-17T08:00"');
    expect(text()).toContain('媒體排程已儲存');

    await click('編輯排程 昨天的預約（改名）');
    backend.schedules.get('SCH-A')!.version = 9;
    await type(nameInput(), '再改一次');
    await click('儲存');
    expect(text()).toContain('排程已被其他使用者修改');
    expect(button('儲存').disabled).toBe(true);
  });

  it('刪除：紅色警告說明不刪媒體與紀錄、不送停止指令；只有檢視權限時操作提示權限不足', async () => {
    const backend = createBackend({ schedules: [{ id: 'SCH-A', name: '要刪的排程', mode: 'reserved', run_local: '2026-10-19T08:00', version: 3, media_ids: ['MED-1'] }] });
    getCalls = () => backend.calls;
    mount(backend);
    await settle();
    await click('刪除排程 要刪的排程');
    expect(text()).toContain('確定要刪除「要刪的排程」？');
    expect(text()).toContain('不會刪除媒體、媒體分組或檔案');
    expect(text()).toContain('不會對載具送出停止播放指令');
    await click('刪除');
    expect(lastCall('DELETE')).toBe('DELETE /syncdrive-api/media-play-schedules/SCH-A?expected_version=3');
    expect(text()).toContain('媒體排程已刪除');

    act(() => root?.unmount());
    box?.remove();
    permissions.clear();
    const readOnly = createBackend({ schedules: [{ id: 'SCH-B', name: '唯讀排程', mode: 'reserved', run_local: '2026-10-19T08:00', version: 1, media_ids: ['MED-1'] }] });
    getCalls = () => readOnly.calls;
    mount(readOnly, ['media.schedule.view']);
    await settle();
    await click('建立媒體排程');
    await click('編輯排程 唯讀排程');
    await click('刪除排程 唯讀排程');
    expect(denied).toEqual(['media.schedule.create', 'media.schedule.edit', 'media.schedule.delete']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(readOnly.calls.every((call) => call.startsWith('GET'))).toBe(true);
  });
});
