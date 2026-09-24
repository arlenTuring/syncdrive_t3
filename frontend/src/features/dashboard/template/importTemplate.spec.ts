import { describe, expect, it } from 'vitest';
import { clonePlaneWithNewIds } from './importTemplate';
import { buildDashboardTemplate } from './exportTemplate';
import type { DashboardPlane, CanvasElementProps } from '../types';

function genericGroupElement(): CanvasElementProps {
  return {
    id: 'canvas-1', type: 'canvas', x: 0, y: 0, width: 100, height: 100,
    label: '泛用群組', backgroundColor: '', backgroundImage: '', opacity: 100,
    isGroup: true, children: [],
    genericGroup: {
      enabled: true,
      itemIdField: 'shift_key',
      sources: [
        { id: 'mainline', label: '正線班次', dataSourceId: 'default-internal', sqlQuery: 'SELECT 1', defaultPriority: 100 },
        { id: 'maintenance', label: '整備班表', dataSourceId: 'default-internal', sqlQuery: 'SELECT 2', defaultPriority: 50 },
      ],
      templates: [
        { id: 'tpl-a', name: '正線班次卡', isDefault: false, children: [
          { id: 'w1', type: 'text', x: 0, y: 0, width: 10, height: 10, content: 'x', fontSize: 12, lineHeight: 1, fontFamily: 'system-ui', fontWeight: 'normal', color: '#fff', textAlign: 'left', borderRadius: 0, borderWidth: 0, borderColor: 'transparent', backgroundColor: 'transparent', colorRulesEnabled: false } as never,
        ], conditions: [{ field: 'line_kind', operator: 'eq', value: 'mainline' }] },
        { id: 'tpl-b', name: '整備班表卡', isDefault: true, children: [] },
      ],
      capacityConfig: { capacity: 11, overflowFill: 'blank', showPendingCount: true },
      transitionConfig: { type: 'flip-up' },
      validityRules: [{ id: 'r1', field: 'status', operator: 'eq', value: 'CANCELLED', effect: 'invalid' }],
      preemptEqualPriority: false,
    },
  } as CanvasElementProps;
}

function basePlane(): DashboardPlane {
  return {
    id: 'plane-1', name: '測試平面', width: 1920, height: 1080,
    elements: [genericGroupElement()],
    createdAt: 1, updatedAt: 1,
  };
}

describe('匯出匯入 genericGroup 設定完整性（規格案例 11）', () => {
  it('匯出再匯入後，genericGroup 的來源／樣板條件／容量／轉場／有效性規則逐一保留', () => {
    const original = basePlane();
    const template = buildDashboardTemplate(original);
    const imported = clonePlaneWithNewIds(template.plane);

    const importedGroup = imported.elements[0].genericGroup!;
    const originalGroup = original.elements[0].genericGroup!;

    expect(importedGroup.enabled).toBe(true);
    expect(importedGroup.itemIdField).toBe('shift_key');
    expect(importedGroup.sources).toEqual(originalGroup.sources);
    expect(importedGroup.capacityConfig).toEqual(originalGroup.capacityConfig);
    expect(importedGroup.transitionConfig).toEqual(originalGroup.transitionConfig);
    expect(importedGroup.validityRules).toEqual(originalGroup.validityRules);
    expect(importedGroup.preemptEqualPriority).toBe(false);

    // 樣板結構（名稱、條件、isDefault）保留，只有子元件 ID 被重建
    expect(importedGroup.templates?.map(t => ({ id: t.id, name: t.name, isDefault: t.isDefault, conditions: t.conditions })))
      .toEqual(originalGroup.templates?.map(t => ({ id: t.id, name: t.name, isDefault: t.isDefault, conditions: t.conditions })));
    expect(importedGroup.templates?.[0].children[0].id).not.toBe('w1');
    expect(importedGroup.templates?.[0].children[0].id).toMatch(/^text-/);
  });

  it('匯入不修改原始平面物件（舊群組不受影響）', () => {
    const original = basePlane();
    const snapshotJson = JSON.stringify(original);
    const template = buildDashboardTemplate(original);
    clonePlaneWithNewIds(template.plane);
    expect(JSON.stringify(original)).toBe(snapshotJson);
  });

  it('匯入後平面與元件 ID 全部重新產生，不與來源平面衝突', () => {
    const original = basePlane();
    const template = buildDashboardTemplate(original);
    const imported = clonePlaneWithNewIds(template.plane);
    expect(imported.id).not.toBe(original.id);
    expect(imported.elements[0].id).not.toBe(original.elements[0].id);
  });
});
