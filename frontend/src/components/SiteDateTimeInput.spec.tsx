// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SiteDateTimeInput } from './SiteDateTimeInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as never;
Element.prototype.scrollIntoView = () => undefined;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll('[data-anchored-popover]').forEach((node) => node.remove());
});

describe('SiteDateTimeInput', () => {
  it('separates the visible datetime from the submitted native value', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(SiteDateTimeInput, { type: 'datetime-local', value: '2026-10-22T02:14:03', name: 'from' })));
    const trigger = container.querySelector<HTMLButtonElement>('button')!;
    expect(trigger.textContent).toContain('2026-10-22 02:14:03');
    expect(trigger.dataset.siteDatetimeValue).toBe('2026-10-22T02:14:03');
    expect(container.querySelector<HTMLInputElement>('input[name="from"]')?.value).toBe('2026-10-22T02:14:03');
    expect(trigger.querySelector('span')?.className).toContain('whitespace-nowrap');
  });

  it('shows only hours and minutes for a time field', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(SiteDateTimeInput, { type: 'time', value: '23:00', 'aria-label': '開始' })));
    act(() => container!.querySelector('button')!.click());
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain('23');
    expect(panel.textContent).not.toContain('2026');
    expect(panel.querySelector('.grid-cols-7')).toBeNull();
  });
});
