import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectTemplate } from './groupCandidates';
import { ensureTransitionShiftTemplate, TRANSITION_TEMPLATE_ID } from './shiftCardTemplates';
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
    assert.equal(title.content, '{display_code}', '過渡卡標題用短名稱');
    assert.equal(title.tooltip, '{trip_code}｜{shift_key}', '完整識別碼放在提示');
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

  it('既有過渡卡標題還是 {trip_code}：改成短名稱；使用者自訂的標題不動', () => {
    const old = {
      ...mainline, id: TRANSITION_TEMPLATE_ID,
      children: [{ id: 'x', type: 'text', content: '{trip_code}' }, { id: 'y', type: 'text', content: '自訂 {trip_code}' }],
    };
    const p = { ...plane(), elements: [{ id: 'g', label: '群組', genericGroup: { enabled: true, sources: [{ id: 's' }], templates: [old, mainline, maintenance] } }] } as unknown as DashboardPlane;
    const { plane: next, added } = ensureTransitionShiftTemplate(p);
    assert.equal(added, 1);
    const children = next.elements[0].genericGroup!.templates![0].children as unknown as Array<{ content: string }>;
    assert.equal(children[0].content, '{display_code}');
    assert.equal(children[1].content, '自訂 {trip_code}');
    assert.equal(ensureTransitionShiftTemplate(next).added, 0, '第二次不再變');
  });
});
