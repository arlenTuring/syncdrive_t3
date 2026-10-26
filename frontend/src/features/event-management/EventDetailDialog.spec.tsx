// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventDetailDialog } from './EventDetailDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const detail = { id: '9007199254740993', eventId: 'DEVICE-EVT-1', sourceType: 'VEHICLE', sourceId: 'PMS01', sourceName: 'PMS01', origin: 'REPORTED', vehicleCode: 'PMS01', eventCode: 'PATH_BLOCKED', eventLabel: '路徑受阻', severity: 'WARNING', occurredAt: 1, occurredAtValid: true, receivedAt: 2, summary: '事件', detail: '內容', acknowledged: false, acknowledgedAt: null, acknowledgedByName: null, acknowledgementNote: null, recoveryStatus: 'UNKNOWN', location: null, params: {}, trail: [] };
let root: Root | null = null;
let box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => Promise.resolve()); };

async function mount(writeText: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
  act(() => root!.render(createElement(EventDetailDialog, { id: detail.id, timeZone: 'Asia/Taipei', onClose: vi.fn(), onReplay: vi.fn() })));
  await settle();
}

describe('事件詳情的事件 ID', () => {
  it('顯示資料庫主鍵並只複製完整事件 ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); await mount(writeText);
    expect(document.body.textContent).toContain('事件 ID');
    expect(document.body.textContent).toContain('來源事件 ID');
    expect(document.body.textContent).toContain(detail.id);
    const copy = document.querySelector<HTMLButtonElement>('[aria-label="複製事件 ID"]')!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(detail.id);
    expect(document.body.textContent).toContain('已複製事件 ID');
  });

  it('剪貼簿失敗時不謊報成功', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked')); await mount(writeText);
    const copy = document.querySelector<HTMLButtonElement>('[aria-label="複製事件 ID"]')!;
    await act(async () => copy.click());
    expect(document.body.textContent).toContain('複製失敗，請手動選取事件 ID');
    expect(document.body.textContent).not.toContain('已複製事件 ID');
  });
});
