// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogPage } from './LogPage';

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
vi.mock('../../components/SiteDateTimeInput', async () => {
  const { createElement: h } = await import('react');
  return { SiteDateTimeInput: ({ value, onChange, 'aria-label': label }: { value: string; onChange: (e: { target: { value: string } }) => void; 'aria-label'?: string }) => h('input', { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange({ target: { value: e.target.value } }) }) };
});
vi.mock('../../components/SiteSelect', async () => {
  const { createElement: h } = await import('react');
  return {
    SiteSelect: ({ value, onChange, options, 'aria-label': label }: { value: string; onChange: (e: { target: { value: string } }) => void; options: Array<{ value: string; label: string }>; 'aria-label'?: string }) =>
      h('select', { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange({ target: { value: e.target.value } }) }, options.map((o) => h('option', { key: o.value, value: o.value }, o.label))),
  };
});


const OPTIONS = {
  accounts: [{ id: '11111111-1111-1111-1111-111111111111', accountName: 'amy', displayName: '艾米', deleted: true }],
  roles: [{ id: '22222222-2222-2222-2222-222222222222', name: '調度員' }],
  systemActions: [{ value: 'SYSTEM_SETTINGS_UPDATE', label: '修改系統基礎設定' }],
  operationActions: [{ value: 'SHIFT_DEPLOY', label: '部署班表' }],
  changeTypes: [{ value: 'GRANT', label: '授予' }], permissionTargets: [{ value: 'ROLE_PERMISSION', label: '角色權限' }],
  loginTypes: [{ value: 'LOGIN_FAILED', label: '登入失敗' }], results: [{ value: 'SUCCESS', label: '成功' }],
  timeZone: 'Asia/Taipei', pageSize: 20, exportLimit: 1000,
};
const item = { id: '33333333-3333-3333-3333-333333333333', occurredAt: Date.UTC(2026, 9, 19, 1, 2, 3), sourceIp: '10.0.0.8', category: 'permissions', type: 'GRANT', typeLabel: '授予',
  operator: { id: 'op', name: '管理員', nameSource: 'snapshot' }, target: { type: 'ROLE_PERMISSION', typeLabel: '角色權限', id: '2222', name: '調度員', nameSource: 'snapshot' },
  content: '管理員 對 角色權限「調度員」 進行了 授予', result: 'SUCCESS', resultLabel: '成功' };

function backend() {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    calls.push(`${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/logs/options')) return json(OPTIONS);
    if (/\/logs\/permissions\/[0-9a-f-]{36}$/.test(url.pathname)) return json({ ...item, changes: [{ field: 'permission_ids', added: [{ id: 'p1', label: '事件管理模組／檢視（events.events.view）' }], removed: [] }], before: null, after: {} });
    if (url.pathname.endsWith('/logs/permissions')) return json({ items: [item], total: 1, page: 1, pageSize: 20, range: { from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')) }, timeZone: 'Asia/Taipei' });
    return json({ message: 'x' }, 404);
  });
  return { fetch, calls };
}

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  vi.unstubAllGlobals();
  permissions.clear();
  denied.length = 0;
});
const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5))); };
const text = () => document.body.textContent ?? '';

describe('權限異動查詢', () => {
  it('預設最近 7 天；只送這一類適用的條件；角色篩選；詳情列出可讀的新增權限', async () => {
    permissions.add('logs.permissions.view');
    const b = backend();
    vi.stubGlobal('fetch', b.fetch);
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    act(() => root!.render(createElement(LogPage, { category: 'permissions' })));
    await settle();
    const first = new URL(b.calls.find((c) => c.startsWith('/syncdrive-api/logs/permissions?'))!, 'http://x').searchParams;
    expect(Number(first.get('to')) - Number(first.get('from'))).toBe(7 * 86_400_000 + 1_000);
    expect(text()).toContain('2026-10-19 09:02:03');
    expect(text()).toContain('艾米（amy）［已刪除］');
    const role = document.querySelector<HTMLSelectElement>('select[aria-label="角色"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(role, OPTIONS.roles[0].id);
      role.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim() === '搜尋')!.click());
    await settle();
    const last = b.calls.filter((c) => c.startsWith('/syncdrive-api/logs/permissions?')).pop()!;
    expect(last).toContain(`role=${OPTIONS.roles[0].id}`);
    expect(last).not.toMatch(/vehicleCode|operator=|keyword=/);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent === '查看詳情')!.click());
    await settle();
    expect(text()).toContain('＋ 事件管理模組／檢視（events.events.view）');
    expect(text()).toContain('操作當時名稱');
  });

  it('沒有匯出權限：提示權限不足，不送匯出請求', async () => {
    permissions.add('logs.permissions.view');
    const b = backend();
    vi.stubGlobal('fetch', b.fetch);
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    act(() => root!.render(createElement(LogPage, { category: 'permissions' })));
    await settle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes('匯出'))!.click());
    await settle(2);
    expect(denied).toEqual(['logs.permissions.export']);
    expect(b.calls.some((c) => c.includes('/export'))).toBe(false);
  });
});
