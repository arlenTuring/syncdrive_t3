// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteMultiSelect } from './SiteMultiSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as never;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll('[data-anchored-popover]').forEach((node) => node.remove());
});

describe('SiteMultiSelect', () => {
  it('keeps the panel open while toggling and clears through the all option', () => {
    const onChange = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(SiteMultiSelect, {
      values: ['a'],
      options: [{ value: 'a', label: '甲', badge: 2 }, { value: 'b', label: '乙', badge: 1 }],
      onChange,
      ariaLabel: '來源標籤',
      allLabel: '全部標籤',
    })));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    act(() => trigger.click());
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    act(() => options[2].click());
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    act(() => options[0].click());
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('supports keyboard navigation, Escape focus return and Tab leaving the control', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement('div', null,
      createElement(SiteMultiSelect, {
        values: [],
        options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
        onChange: vi.fn(),
        ariaLabel: '來源標籤',
      }),
      createElement('button', { type: 'button', id: 'next-control' }, '下一個控制項'),
    )));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    const first = document.querySelector<HTMLElement>('[role="option"]')!;
    act(() => first.focus());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    const reopenedFirst = document.querySelector<HTMLElement>('[role="option"]')!;
    act(() => reopenedFirst.focus());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('#next-control'));
  });
});
