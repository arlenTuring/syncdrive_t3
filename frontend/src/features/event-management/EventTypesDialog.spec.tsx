// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventTypesDialog } from './EventTypesDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../access-control/AuthContext', () => ({ useAuth: () => ({ can: () => true, require: () => true }) }));

const types = [
  { code: 'OBSTACLE_AVOID_01', name: '障礙物避讓介入', severity: 'CRITICAL', sopText: '執行遠端人工接管繞行', sopUrl: null },
  { code: 'BATTERY_LOW_WARN', name: '低電量預警 (<15%)', severity: 'WARNING', sopText: null, sopUrl: 'https://sop.example/battery' },
];

function backend() {
  const calls: Array<{ method: string; body?: unknown }> = [];
  const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', body });
    return new Response(JSON.stringify({ items: body?.items ?? types }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetch, calls };
}

let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => new Promise((r) => setTimeout(r, 5))); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;
const type = (label: string, value: string) => act(() => {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('事件類型管理', () => {
  it('列出嚴重等級、名稱、代碼與 SOP；改動要按儲存才整份送出', async () => {
    const b = backend(); const onSaved = vi.fn(); const onClose = vi.fn();
    vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(EventTypesDialog, { onClose, onSaved }))); await settle();
    expect(document.body.textContent).toContain('OBSTACLE_AVOID_01');
    expect(document.body.textContent).toContain('執行遠端人工接管繞行');
    expect(button('儲存').disabled).toBe(true);

    act(() => button('新增事件類型').click());
    expect(button('新增').disabled).toBe(true);
    type('事件名稱', '感測器被遮蔽');
    type('事件類型代碼', 'Ss7125');
    type('建議處置SOP文字', '請擦拭鏡頭');
    expect(button('新增').disabled).toBe(true);
    // 嚴重等級是必填，沒選之前還是不能新增
    act(() => document.querySelector<HTMLElement>('[aria-label="嚴重等級"]')!.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.trim() === '嚴重')!;
    act(() => option.click());
    expect(button('新增').disabled).toBe(false);
    act(() => button('新增').click());
    expect(document.body.textContent).toContain('Ss7125');

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="刪除 低電量預警 (<15%)"]')!.click());
    expect(document.body.textContent).not.toContain('BATTERY_LOW_WARN');
    act(() => button('儲存').click()); await settle();
    const put = b.calls.find((call) => call.method === 'PUT')!;
    expect((put.body as { items: Array<{ code: string }> }).items.map((item) => item.code)).toEqual(['OBSTACLE_AVOID_01', 'Ss7125']);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('有未儲存的修改時關閉要先確認', async () => {
    const b = backend(); const onClose = vi.fn();
    vi.stubGlobal('fetch', b.fetch); box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
    act(() => root!.render(createElement(EventTypesDialog, { onClose, onSaved: vi.fn() }))); await settle();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="刪除 障礙物避讓介入"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="關閉"]')!.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('尚未儲存變更');
    act(() => button('放棄變更').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
