// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteSelect } from './SiteSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as never;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll('[data-anchored-popover]').forEach((node) => node.remove());
  vi.restoreAllMocks();
});

function render(onChange = vi.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(SiteSelect, {
    value: 'a',
    onChange,
    'aria-label': '測試選單',
    children: [
      createElement('option', { key: 'a', value: 'a' }, '甲'),
      createElement('option', { key: 'b', value: 'b' }, '乙'),
      createElement('option', { key: 'c', value: 'c', disabled: true }, '停用'),
    ],
  })));
  return { trigger: container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!, onChange };
}

describe('SiteSelect', () => {
  it('renders the menu in a portal and reports native-compatible value changes', () => {
    const { trigger, onChange } = render();
    act(() => trigger.click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.textContent?.trim())).toEqual(['甲', '乙', '停用']);
    act(() => options[1].click());
    expect(onChange.mock.calls[0][0].target.value).toBe('b');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports arrows, Enter, Escape and skips disabled options', () => {
    const { trigger, onChange } = render();
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(document.activeElement).toBe(options[0]);
    act(() => options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(document.activeElement).toBe(options[1]);
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onChange.mock.calls[0][0].target.value).toBe('b');
    act(() => trigger.click());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
