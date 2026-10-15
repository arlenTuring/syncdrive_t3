// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunCodeRow } from './RunCodeRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_CODE = '261015-E021830-VERY-LONG-ORDER-IDENTIFIER-FOR-TRUNCATION@1791000900000';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(RunCodeRow, { code: LONG_CODE })));
  return container;
}

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('shift run code row', () => {
  it('shows the full code and copies exactly the full value, confirming only on success', async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard(writeText);
    const box = render();
    const shown = box.querySelector('[title]')!;
    expect(shown.textContent).toBe(LONG_CODE);
    expect(shown.getAttribute('title')).toBe(LONG_CODE);
    const button = box.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe(`複製班次唯一碼 ${LONG_CODE}`);
    expect(box.textContent).not.toContain('已複製');
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith(LONG_CODE);
    expect(box.textContent).toContain('班次唯一碼已複製');
  });

  it('says the copy failed instead of claiming success', async () => {
    setClipboard(async () => {
      throw new Error('denied');
    });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    const box = render();
    await act(async () => box.querySelector('button')!.click());
    expect(box.textContent).toContain('複製失敗');
    expect(box.textContent).not.toContain('班次唯一碼已複製');
  });
});
