// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Slider, type SliderProps } from './Slider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

function Controlled(props: Omit<Extract<SliderProps, { range?: false }>, 'value' | 'onChange'> & { initial: number; spy: (v: number) => void }) {
  const { initial, spy, ...rest } = props;
  const [value, setValue] = useState(initial);
  return createElement(Slider, { ...rest, value, onChange: (v: number) => { setValue(v); spy(v); } });
}

function ControlledRange(props: { initial: [number, number]; spy: (v: [number, number]) => void }) {
  const [value, setValue] = useState(props.initial);
  return createElement(Slider, { range: true, 'aria-label': '範圍', value, onChange: (v: [number, number]) => { setValue(v); props.spy(v); } });
}

const key = (el: Element, k: string) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
});

describe('Slider（T3 UI Kit）', () => {
  it('arrow keys step the value, Home/End jump to the ends, and the label shows the value', () => {
    const spy = vi.fn();
    const root = mount(createElement(Controlled, { initial: 50, spy, step: 10, 'aria-label': '透明度' }));
    const handle = root.querySelector('[role="slider"]')!;
    expect(handle.getAttribute('aria-label')).toBe('透明度');
    key(handle, 'ArrowRight');
    expect(spy).toHaveBeenLastCalledWith(60);
    key(handle, 'End');
    expect(spy).toHaveBeenLastCalledWith(100);
    key(handle, 'ArrowRight');
    expect(spy).toHaveBeenCalledTimes(2);
    key(handle, 'Home');
    expect(spy).toHaveBeenLastCalledWith(0);
    expect(root.querySelector('.t3-slider__label')!.textContent).toBe('0');
  });

  it('pressed look only while a key is held; releasing ends the operation once', () => {
    const end = vi.fn();
    const root = mount(createElement(Slider, { value: 5, onChange: () => {}, onChangeEnd: end, max: 10, 'aria-label': 'x' }));
    const handle = root.querySelector('[role="slider"]')!;
    key(handle, 'ArrowRight');
    expect(root.querySelector('.t3-slider')!.classList.contains('is-pressed')).toBe(true);
    expect(root.querySelector('.t3-slider__label')!.getAttribute('data-bubble')).toBe('true');
    act(() => { handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); });
    expect(root.querySelector('.t3-slider')!.classList.contains('is-pressed')).toBe(false);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('range keeps lower ≤ upper', () => {
    const spy = vi.fn();
    const root = mount(createElement(ControlledRange, { initial: [40, 50], spy }));
    const [lower, upper] = [...root.querySelectorAll('[role="slider"]')];
    for (let i = 0; i < 3; i += 1) key(lower!, 'ArrowRight');
    expect(spy).toHaveBeenLastCalledWith([43, 50]);
    key(lower!, 'End');
    expect(spy).toHaveBeenLastCalledWith([50, 50]);
    key(upper!, 'Home');
    expect(spy).toHaveBeenCalledTimes(4);
    expect(lower!.getAttribute('aria-label')).toBe('範圍（下限）');
  });

  it('disabled does not change, cannot be focused, and shows no bubble', () => {
    const spy = vi.fn();
    const root = mount(createElement(Slider, { value: 3, onChange: spy, disabled: true, 'aria-label': 'x' }));
    const handle = root.querySelector('[role="slider"]')!;
    expect(handle.getAttribute('tabindex')).toBe('-1');
    key(handle, 'ArrowRight');
    expect(spy).not.toHaveBeenCalled();
    expect(root.querySelector('.t3-slider')!.classList.contains('is-disabled')).toBe(true);
  });

  it('discrete draws one tick per step; continuous draws none; values snap to step without float noise', () => {
    const spy = vi.fn();
    const discrete = mount(createElement(Controlled, { initial: 0.2, spy, min: 0.2, max: 1, step: 0.1, variant: 'discrete', 'aria-label': 'x' }));
    expect(discrete.querySelectorAll('.t3-slider__dot')).toHaveLength(9);
    key(discrete.querySelector('[role="slider"]')!, 'ArrowRight');
    expect(spy).toHaveBeenLastCalledWith(0.3);
    act(() => root?.unmount());
    const continuous = mount(createElement(Slider, { value: 1, onChange: () => {}, 'aria-label': 'x' }));
    expect(continuous.querySelectorAll('.t3-slider__dot')).toHaveLength(0);
  });
});
