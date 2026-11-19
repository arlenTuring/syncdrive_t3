// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleModuleSidebar } from './ScheduleModuleSidebar';
import { writeModuleAddModePreference } from '../utils/moduleAddModePreference';

// 時鐘會去後端抓營運時間，與子頁編輯無關
vi.mock('./ShellClock', () => ({ ShellClock: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = { id: 'mdp-1', moduleId: 'operations', label: '即時數據資料', planeId: 'plane-1', createdAt: 0 };

let root: Root | null = null;
let box: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  box?.remove();
  root = null;
  box = null;
  localStorage.clear();
});

function render(adminMode: boolean) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(createElement(ScheduleModuleSidebar, {
      activeView: 'shift-list',
      onViewChange: () => {},
      adminMode,
      moduleDashboardPages: [page],
      onRenameModuleDashboard: () => {},
      onRemoveModuleDashboard: () => {},
      permissions: ['dashboard.dashboard.view'],
    }));
  });
}

const pageButton = () => [...box!.querySelectorAll('nav button')].find((b) => b.textContent?.includes(page.label)) as HTMLButtonElement | undefined;
const editButtons = () => box!.querySelectorAll('svg.lucide-pencil, svg.lucide-trash-2, svg.lucide-trash2').length;

describe('ScheduleModuleSidebar 子頁編輯', () => {
  it('非編輯模式：子頁看得到，但沒有改名與移除，雙擊也不會進入改名', () => {
    writeModuleAddModePreference(false);
    render(true);
    expect(pageButton()).toBeTruthy();
    expect(editButtons()).toBe(0);
    act(() => { pageButton()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(box!.querySelector('nav input')).toBeNull();
  });

  it('編輯模式（管理員）：出現改名與移除；關掉編輯模式後立刻消失並結束改名', () => {
    writeModuleAddModePreference(true);
    render(true);
    expect(editButtons()).toBe(2);
    act(() => { pageButton()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(box!.querySelector('nav input')).not.toBeNull();
    act(() => writeModuleAddModePreference(false));
    expect(box!.querySelector('nav input')).toBeNull();
    expect(editButtons()).toBe(0);
  });

  it('非管理員即使開著編輯模式也不能改名或移除', () => {
    writeModuleAddModePreference(true);
    render(false);
    expect(editButtons()).toBe(0);
  });
});
