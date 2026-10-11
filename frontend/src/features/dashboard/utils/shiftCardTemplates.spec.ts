import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectTemplate } from './groupCandidates';
import { alignShiftCardLayout, alignShiftCardLayouts, ensureTransitionShiftTemplate, TRANSITION_TEMPLATE_ID } from './shiftCardTemplates';
import type { GroupTemplateDef } from '../types';
import type { DashboardPlane } from '../types';

const mainline = {
  id: 'tpl-mainline',
  name: '正線班次卡（使用者改過名稱）',
  conditions: [{ field: 'line_kind', operator: 'eq', value: 'mainline' }],
  isDefault: false,
  templateWidth: 293,
  children: [
    { id: 'a', type: 'status-badge', valueField: '{direction_label}', variableBgKey: 'direction_pill_bg', defaultBgColor: '#8E51FF', defaultTextColor: '#FFF', defaultLabel: '—' },
    { id: 'b', type: 'text', content: '{trip_code}', x: 63 },
  ],
};
const maintenance = { id: 'tpl-maintenance', name: '整備班表卡', conditions: [{ field: 'line_kind', operator: 'eq', value: 'maintenance' }], isDefault: true, children: [] };

function plane(): DashboardPlane {
  return {
    id: 'p', name: 'p', width: 1, height: 1,
    elements: [{ id: 'g', label: '群組', genericGroup: { enabled: true, sources: [{ id: 's' }], templates: [mainline, maintenance] } }],
  } as unknown as DashboardPlane;
}

describe('ensureTransitionShiftTemplate', () => {
  it('從正線卡複製出過渡卡：紫色標籤存在樣板裡、不綁資料色，排在正線卡前面', () => {
    const { plane: next, added } = ensureTransitionShiftTemplate(plane());
    assert.equal(added, 1);
    const templates = next.elements[0].genericGroup!.templates!;
    assert.deepEqual(templates.map((t) => t.id), [TRANSITION_TEMPLATE_ID, 'tpl-mainline', 'tpl-maintenance']);
    const badge = templates[0].children[0] as unknown as Record<string, unknown>;
    assert.equal(badge.defaultBgColor, '#6D28D9');
    assert.equal(badge.defaultLabel, '過渡');
    assert.equal(badge.variableBgKey, undefined);
    assert.equal(templates[0].children[1].id, 'b-tr', '子元件換新 ID，不跟正線卡共用');
    const title = templates[0].children[1] as unknown as { content: string; tooltip: string };
    assert.equal(title.content, '{trip_code}', '過渡卡標題跟正線卡一樣是班次代號');
    assert.equal(title.tooltip, '{display_code}｜{shift_key}', '短名稱與訂單放在提示');
    assert.equal((templates[1].children[1] as unknown as { content: string }).content, '{trip_code}', '正線卡標題不變');
    // 正線、整備樣板原封不動
    assert.deepEqual(templates[1], mainline);
    assert.deepEqual(templates[2], maintenance);
  });

  it('重複執行不重複新增；使用者改過的過渡卡顏色保留', () => {
    const once = ensureTransitionShiftTemplate(plane()).plane;
    const edited = structuredClone(once);
    (edited.elements[0].genericGroup!.templates![0].children[0] as unknown as Record<string, unknown>).defaultBgColor = '#123456';
    const twice = ensureTransitionShiftTemplate(edited);
    assert.equal(twice.added, 0);
    assert.equal(twice.plane, edited);
  });

  it('依業務分類選到對應樣板：TRANSITION → 過渡、MAINLINE → 正線、整備 → 整備', () => {
    const templates = ensureTransitionShiftTemplate(plane()).plane.elements[0].genericGroup!.templates!;
    assert.equal(selectTemplate({ line_kind: 'mainline', business_kind: 'TRANSITION' }, templates)?.id, TRANSITION_TEMPLATE_ID);
    assert.equal(selectTemplate({ line_kind: 'mainline', business_kind: 'MAINLINE' }, templates)?.id, 'tpl-mainline');
    // 即時合併後 line_kind 會被改成大寫 MAINLINE，business_kind 仍保留
    assert.equal(selectTemplate({ line_kind: 'MAINLINE', business_kind: 'TRANSITION' }, templates)?.id, TRANSITION_TEMPLATE_ID);
    assert.equal(selectTemplate({ line_kind: 'maintenance' }, templates)?.id, 'tpl-maintenance');
  });

  it('沒有系統正線卡的群組不動', () => {
    const p = plane();
    p.elements[0].genericGroup!.templates = [maintenance] as never;
    assert.equal(ensureTransitionShiftTemplate(p).added, 0);
  });

  it('既有過渡卡標題還是舊版系統綁定（短名稱）：改回班次代號；使用者自訂的標題不動', () => {
    const old = {
      ...mainline, id: TRANSITION_TEMPLATE_ID,
      children: [
        { id: 'x', type: 'text', content: '{display_code}', tooltip: '{trip_code}｜{shift_key}' },
        { id: 'y', type: 'text', content: '自訂 {display_code}' },
      ],
    };
    const p = { ...plane(), elements: [{ id: 'g', label: '群組', genericGroup: { enabled: true, sources: [{ id: 's' }], templates: [old, mainline, maintenance] } }] } as unknown as DashboardPlane;
    const { plane: next, added } = ensureTransitionShiftTemplate(p);
    assert.equal(added, 1);
    const children = next.elements[0].genericGroup!.templates![0].children as unknown as Array<{ content: string; tooltip?: string }>;
    assert.equal(children[0].content, '{trip_code}');
    assert.equal(children[0].tooltip, '{display_code}｜{shift_key}');
    assert.equal(children[1].content, '自訂 {display_code}');
    assert.equal(ensureTransitionShiftTemplate(next).added, 0, '第二次不再變');
  });
});

/* 已存儀表板（第 2560 版）的實際座標 */
const text = (id: string, content: string, x: number, y: number, width: number, height: number, extra = {}) =>
  ({ id, type: 'text', content, x, y, width, height, fontSize: 16, color: '#99A1AF', textAlign: 'left', ...extra });
const badge = (id: string, valueField: string, x: number, width: number) => ({ id, type: 'status-badge', valueField, x, y: 12, width, height: 24 });
const savedMaintenance = {
  id: 'tpl-maintenance', name: '整備班表卡', conditions: [], isDefault: true,
  children: [
    { id: 'bg', type: 'color-block', x: 0, y: 0, width: 269, height: 196 },
    badge('kind', '{maint_type_label}', 4, 61),
    text('veh', '{vehicle_code}', 65, 12, 62, 24),
    text('code', '{trip_code}', 127, 12, 77, 24, { fontSize: 14, textAlign: 'center' }),
    badge('status', '{status_label}', 190, 79),
    { id: 'bar', type: 'route-progress', x: 0, y: 94, width: 276, height: 72 },
    text('dep', '發車 {depart_time}', 6, 172, 146, 18, { fontSize: 12 }),
    text('end', '結束 {end_time}', 158, 172, 98, 18, { fontSize: 12, textAlign: 'right' }),
  ],
} as unknown as GroupTemplateDef;
const savedMainline = {
  id: 'tpl-mainline', name: '正線班次卡', conditions: [], isDefault: false,
  children: [
    { id: 'bg', type: 'color-block', x: 0, y: 0, width: 293, height: 196 },
    badge('kind', '{direction_label}', 4, 59),
    text('code', '{trip_code}', 63, 12, 67, 24),
    text('veh', '{vehicle_code}', 136, 12, 71, 24),
    badge('status', '{status_label}', 207, 75),
    text('dep', '發車 {depart_time}', 6, 172, 146, 18, { fontSize: 12 }),
    text('end', '結束 {end_time}', 184, 172, 98, 18, { fontSize: 12, textAlign: 'right' }),
  ],
} as unknown as GroupTemplateDef;
const byId = (tpl: GroupTemplateDef) => Object.fromEntries(tpl.children.map((c) => [c.id, c as unknown as Record<string, number | string>]));

describe('alignShiftCardLayout', () => {
  it('整備卡：標籤後面緊接班次代號，車號移到底列正中間，發車／結束讓出位置', () => {
    const c = byId(alignShiftCardLayout(savedMaintenance));
    assert.deepEqual([c.code.x, c.code.y, c.code.width, c.code.fontSize, c.code.textAlign], [69, 12, 117, 16, 'left']);
    assert.deepEqual([c.veh.x, c.veh.y, c.veh.width, c.veh.height, c.veh.textAlign], [103, 170, 64, 22, 'center']);
    assert.ok((c.dep.x as number) + (c.dep.width as number) <= (c.veh.x as number), '發車不壓到車號');
    assert.ok((c.end.x as number) >= (c.veh.x as number) + 64, '結束不壓到車號');
    assert.equal((c.end.x as number) + (c.end.width as number), 263, '結束靠右，右緣拉到卡片內緣');
    assert.ok((c.end.width as number) >= 90, '「結束 HH:MM」放得下');
    assert.equal(c.bar.width, 276, '其他元件不動');
  });

  it('正線卡也統一：車號在 293 寬卡片底列正中間', () => {
    const c = byId(alignShiftCardLayout(savedMainline));
    assert.equal(c.code.x, 67);
    assert.equal((c.veh.x as number) + 32, 147);
    assert.equal(c.veh.y, 170);
  });

  it('車號已經不在標題那一排（已改過或使用者自己排的）：不動，第二次執行不變', () => {
    const once = alignShiftCardLayout(savedMaintenance);
    assert.equal(alignShiftCardLayout(once), once);
    const custom = { ...savedMainline, children: savedMainline.children.map((c) => (c.id === 'veh' ? { ...c, y: 120 } : c)) } as GroupTemplateDef;
    assert.equal(alignShiftCardLayout(custom), custom);
  });

  it('只動三種系統班次卡樣板', () => {
    const other = { ...savedMainline, id: 'tpl-user' } as GroupTemplateDef;
    assert.equal(alignShiftCardLayout(other), other);
    const p = { ...plane(), elements: [{ id: 'g', label: '群組', genericGroup: { enabled: true, sources: [{ id: 's' }], templates: [savedMainline, savedMaintenance, other] } }] } as unknown as DashboardPlane;
    const { plane: next, changed } = alignShiftCardLayouts(p);
    assert.equal(changed, 2);
    assert.equal(alignShiftCardLayouts(next).changed, 0);
  });
});
