import { describe, expect, it } from 'vitest';
import { clampPage, EMPTY_SELECTION, moveItem, pageState, toggle, togglePage } from './selection';

const page1 = [
  { id: 'A', name: '甲', selectable: true },
  { id: 'B', name: '乙', selectable: false },
  { id: 'C', name: '丙', selectable: true },
];
const page2 = [{ id: 'D', name: '丁', selectable: true }];

describe('加入媒體的暫選', () => {
  it('依第一次勾選的順序，跨頁保留', () => {
    let s = toggle(EMPTY_SELECTION, page2[0]);
    s = toggle(s, page1[2]);
    s = toggle(s, page1[0]);
    expect(s.order).toEqual(['D', 'C', 'A']);
    // 取消再勾回來：排到最後
    s = toggle(toggle(s, page2[0]), page2[0]);
    expect(s.order).toEqual(['C', 'A', 'D']);
  });

  it('表頭只選取本頁可加入的項目，並顯示部分選取', () => {
    let s = toggle(EMPTY_SELECTION, page2[0]);
    expect(pageState(s, page1)).toBe('none');
    s = toggle(s, page1[0]);
    expect(pageState(s, page1)).toBe('some');
    s = togglePage(s, page1);
    expect(s.order).toEqual(['D', 'A', 'C']);
    expect(pageState(s, page1)).toBe('all');
    // 再按一次：只取消本頁，其他頁的暫選保留
    s = togglePage(s, page1);
    expect(s.order).toEqual(['D']);
    expect(pageState(s, [{ id: 'B', name: '乙', selectable: false }])).toBe('disabled');
  });

  it('同分組內移動與頁碼修正', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 1, 9)).toEqual(['a', 'b']);
    expect(clampPage(3, 20, 10)).toBe(2);
    expect(clampPage(2, 0, 10)).toBe(1);
  });
});
