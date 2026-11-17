// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Checkbox, type CheckboxChecked } from './checkbox/Checkbox';
import { headerCheckState } from './checkbox/selection';
import { RadioGroup } from './radio/Radio';
import { Switch } from './switch/Switch';

/** 驗收項目取自 design-specs 的 Checkbox／Radio／Switch 工程文件 §6 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (node: React.ReactNode) => act(() => root.render(node));
const click = (element: Element) => act(() => (element as HTMLElement).click());

describe('Checkbox', () => {
  function Harness({ initial, onEvent }: { initial: CheckboxChecked; onEvent: (value: boolean) => void }) {
    const [checked, setChecked] = useState<CheckboxChecked>(initial);
    return <Checkbox label="發布班表" checked={checked} onCheckedChange={(value) => { onEvent(value); setChecked(value); }} />;
  }

  it('部分勾選：input.indeterminate 同步；第一次啟用送 true、再按送 false', () => {
    const events: boolean[] = [];
    render(<Harness initial="mixed" onEvent={(value) => events.push(value)} />);
    const input = host.querySelector('input')!;
    const wrapper = host.querySelector('.t3-checkbox')!;
    expect(input.indeterminate).toBe(true);
    expect(wrapper.getAttribute('data-select')).toBe('mixed');
    click(input);
    expect(events).toEqual([true]);
    expect(wrapper.getAttribute('data-select')).toBe('checked');
    expect(input.indeterminate).toBe(false);
    click(input);
    expect(events).toEqual([true, false]);
    expect(wrapper.getAttribute('data-select')).toBe('unchecked');
  });

  it('點可見標籤也會切換一次', () => {
    const events: boolean[] = [];
    render(<Harness initial={false} onEvent={(value) => events.push(value)} />);
    click(host.querySelector('label')!);
    expect(events).toEqual([true]);
  });

  it('error 輸出 aria-invalid；停用時一律用 basic 外觀、點了沒有回呼', () => {
    const events: boolean[] = [];
    render(<Checkbox checked={false} variant="error" aria-label="同意" onCheckedChange={(value) => events.push(value)} />);
    expect(host.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('.t3-checkbox')!.getAttribute('data-style')).toBe('error');
    render(<Checkbox checked={false} variant="error" disabled aria-label="同意" onCheckedChange={(value) => events.push(value)} />);
    expect(host.querySelector('.t3-checkbox')!.getAttribute('data-style')).toBe('basic');
    click(host.querySelector('input')!);
    expect(events).toEqual([]);
  });

  it('size 輸出 data-size；預設 medium', () => {
    render(<Checkbox checked aria-label="x" />);
    expect(host.querySelector('.t3-checkbox')!.getAttribute('data-size')).toBe('medium');
    render(<Checkbox checked size="small" aria-label="x" />);
    expect(host.querySelector('.t3-checkbox')!.getAttribute('data-size')).toBe('small');
  });

  it('表頭全選：全部勾＝true、部分＝mixed、零筆可選或零筆已選＝false', () => {
    expect(headerCheckState(3, 3)).toBe(true);
    expect(headerCheckState(1, 3)).toBe('mixed');
    expect(headerCheckState(0, 3)).toBe(false);
    expect(headerCheckState(0, 0)).toBe(false);
  });
});

describe('RadioGroup', () => {
  function Harness({ onEvent }: { onEvent: (value: string) => void }) {
    const [value, setValue] = useState<string>('regular');
    return (
      <RadioGroup
        legend="班次類型"
        value={value}
        onValueChange={(next) => { onEvent(next); setValue(next); }}
        options={[{ value: 'regular', label: '正線班次' }, { value: 'preparation', label: '整備班次' }, { value: 'off', label: '停用項', disabled: true }]}
      />
    );
  }

  it('fieldset＋legend 命名群組；同組只有一項 On；點已選項目不送事件；停用項不送事件', () => {
    const events: string[] = [];
    render(<Harness onEvent={(value) => events.push(value)} />);
    expect(host.querySelector('fieldset legend')!.textContent).toBe('班次類型');
    const inputs = [...host.querySelectorAll('input')];
    expect(new Set(inputs.map((input) => input.name)).size).toBe(1);
    click(inputs[0]!);
    expect(events).toEqual([]);
    click(host.querySelectorAll('label')[1]!);
    expect(events).toEqual(['preparation']);
    expect(inputs.filter((input) => input.checked).map((input) => input.value)).toEqual(['preparation']);
    click(inputs[2]!);
    expect(events).toEqual(['preparation']);
  });
});

describe('Switch', () => {
  it('role=switch、可及名稱＝文字；切換送一次布林值；停用無事件', () => {
    const events: boolean[] = [];
    function Harness({ disabled = false }: { disabled?: boolean }) {
      const [on, setOn] = useState(true);
      return <Switch text="通知" checked={on} disabled={disabled} onCheckedChange={(value) => { events.push(value); setOn(value); }} />;
    }
    render(<Harness />);
    const input = host.querySelector('input')!;
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.getAttribute('aria-label')).toBe('通知');
    expect(host.querySelector('.t3-switch')!.getAttribute('data-configuration')).toBe('with-text');
    click(input);
    expect(events).toEqual([false]);
    expect(input.checked).toBe(false);
    render(<Harness disabled />);
    click(host.querySelector('input')!);
    expect(events).toEqual([false]);
  });

  it('沒有文字＝basic，不輸出文字節點', () => {
    render(<Switch checked={false} aria-label="自動備份" />);
    expect(host.querySelector('.t3-switch')!.getAttribute('data-configuration')).toBe('basic');
    expect(host.querySelector('.t3-switch__label')).toBeNull();
  });
});
