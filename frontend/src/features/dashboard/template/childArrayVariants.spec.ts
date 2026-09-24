import { describe, expect, it } from 'vitest';
import { collectAllChildArrays, mapAllChildArrays } from './childArrayVariants';
import type { CanvasElementProps, ChildWidget } from '../types';

function textWidget(id: string): ChildWidget {
  return {
    id, type: 'text', x: 0, y: 0, width: 10, height: 10, content: id,
    fontSize: 12, lineHeight: 1, fontFamily: 'system-ui', fontWeight: 'normal',
    color: '#fff', textAlign: 'left', borderRadius: 0, borderWidth: 0,
    borderColor: 'transparent', backgroundColor: 'transparent', colorRulesEnabled: false,
  };
}

function baseElement(overrides: Partial<CanvasElementProps> = {}): CanvasElementProps {
  return {
    id: 'canvas-1', type: 'canvas', x: 0, y: 0, width: 100, height: 100,
    label: '', backgroundColor: '', backgroundImage: '', opacity: 100, children: [],
    ...overrides,
  };
}

describe('collectAllChildArrays / mapAllChildArrays 涵蓋全部樣板變體', () => {
  it('collect：children／childrenDefault／childrenNormal／childrenTabN／tabs[].children／genericGroup.templates[].children 全部收到', () => {
    const el = baseElement({
      children: [textWidget('a')],
      childrenDefault: [textWidget('b')],
      childrenNormal: [textWidget('c')],
      childrenTab1: [textWidget('d')],
      childrenTab9: [textWidget('e')],
      tabs: [{ id: 't1', label: 'Tab1', children: [textWidget('f')] }],
      genericGroup: {
        enabled: true,
        templates: [{ id: 'tpl1', name: '樣板1', children: [textWidget('g')] }],
      },
    });
    const all = collectAllChildArrays(el).flat();
    const ids = all.map(c => c.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('map：每個陣列的元件都被轉換過（ID 重建），且原陣列不被就地修改', () => {
    const el = baseElement({
      children: [textWidget('a')],
      childrenTab1: [textWidget('d')],
      tabs: [{ id: 't1', label: 'Tab1', children: [textWidget('f')] }],
      genericGroup: { enabled: true, templates: [{ id: 'tpl1', name: '樣板1', children: [textWidget('g')] }] },
    });
    const originalChildrenRef = el.children;
    const next = mapAllChildArrays(el, (children) => children.map(c => ({ ...c, id: `new-${c.id}` })));

    expect(next.children.map(c => c.id)).toEqual(['new-a']);
    expect(next.childrenTab1?.map(c => c.id)).toEqual(['new-d']);
    expect(next.tabs?.[0].children.map(c => c.id)).toEqual(['new-f']);
    expect(next.genericGroup?.templates?.[0].children.map(c => c.id)).toEqual(['new-g']);
    // 原始物件沒有被就地修改
    expect(el.children).toBe(originalChildrenRef);
    expect(el.children[0].id).toBe('a');
  });

  it('空陣列／未設定的變體不出現在 collect 結果，也不會讓 map 產生空的殘留鍵', () => {
    const el = baseElement({ children: [] });
    expect(collectAllChildArrays(el)).toEqual([]);
    const next = mapAllChildArrays(el, (c) => c);
    expect(next.childrenDefault).toBeUndefined();
    expect(next.tabs).toBeUndefined();
  });
});
