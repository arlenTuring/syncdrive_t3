import { describe, expect, it } from 'vitest';
import {
  applyFieldAliases,
  buildCandidateUid,
  buildCandidatesFromSource,
  evaluateCondition,
  isRowValid,
  resolvePriority,
  selectTemplate,
} from './groupCandidates';
import type { GroupDataSource, GroupTemplateDef, GroupValidityRule } from '../types';

describe('evaluateCondition', () => {
  it('比較運算子涵蓋數字與字串', () => {
    expect(evaluateCondition({ v: 5 }, 'v', 'gt', '3')).toBe(true);
    expect(evaluateCondition({ v: 5 }, 'v', 'lte', '5')).toBe(true);
    expect(evaluateCondition({ v: 'abc' }, 'v', 'eq', 'abc')).toBe(true);
    expect(evaluateCondition({ v: 'abc' }, 'v', 'contains', 'b')).toBe(true);
  });
  it('eq/neq/contains 對字串不分大小寫——真實資料常見同一個值在合併路徑被改了大小寫', () => {
    // 實測踩過的坑：SQL 給 line_kind='mainline'（小寫），MQTT 即時疊加後被域邏輯
    // 改成 'MAINLINE'（大寫），樣板條件若做大小寫敏感比對就會選錯樣板。
    expect(evaluateCondition({ line_kind: 'MAINLINE' }, 'line_kind', 'eq', 'mainline')).toBe(true);
    expect(evaluateCondition({ line_kind: 'mainline' }, 'line_kind', 'eq', 'MAINLINE')).toBe(true);
    expect(evaluateCondition({ line_kind: 'maintenance' }, 'line_kind', 'neq', 'MAINLINE')).toBe(true);
    expect(evaluateCondition({ v: 'ABC' }, 'v', 'contains', 'b')).toBe(true);
  });
  it('empty/not_empty', () => {
    expect(evaluateCondition({}, 'v', 'empty', undefined)).toBe(true);
    expect(evaluateCondition({ v: '' }, 'v', 'empty', undefined)).toBe(true);
    expect(evaluateCondition({ v: 'x' }, 'v', 'not_empty', undefined)).toBe(true);
  });
  it('before_now/after_now', () => {
    const past = Date.now() - 60_000;
    const future = Date.now() + 60_000;
    expect(evaluateCondition({ t: past }, 't', 'before_now', undefined)).toBe(true);
    expect(evaluateCondition({ t: future }, 't', 'after_now', undefined)).toBe(true);
    expect(evaluateCondition({ t: future }, 't', 'before_now', undefined)).toBe(false);
  });
});

describe('isRowValid', () => {
  it('沒有規則一律有效', () => {
    expect(isRowValid({}, undefined)).toBe(true);
    expect(isRowValid({}, [])).toBe(true);
  });
  it('命中 invalid 規則即失效', () => {
    const rules: GroupValidityRule[] = [
      { id: 'r1', field: 'status', operator: 'eq', value: 'CANCELLED', effect: 'invalid' },
    ];
    expect(isRowValid({ status: 'CANCELLED' }, rules)).toBe(false);
    expect(isRowValid({ status: 'ACTIVE' }, rules)).toBe(true);
  });
});

describe('resolvePriority', () => {
  it('由上而下第一條命中的規則決定', () => {
    const rules = [
      { id: 'p1', sourceId: 'emergency', priority: 100 },
      { id: 'p2', conditions: [{ field: 'delay_min', operator: 'gte' as const, value: '10' }], priority: 50 },
    ];
    expect(resolvePriority({ delay_min: 15 }, 'emergency', rules, undefined, 0)).toBe(100); // 來源命中優先
    expect(resolvePriority({ delay_min: 15 }, 'mainline', rules, undefined, 0)).toBe(50);
    expect(resolvePriority({ delay_min: 1 }, 'mainline', rules, 20, 0)).toBe(20); // 都沒命中，用來源預設
  });
});

describe('shift business priority rules', () => {
  const rules = [
    { id: 'emergency', priority: 1000, conditions: [{ field: 'order_status', operator: 'eq' as const, value: 'FAULTED' }] },
    { id: 'mainline', priority: 300, conditions: [{ field: 'business_kind', operator: 'eq' as const, value: 'MAINLINE' }] },
    { id: 'transition', priority: 200, conditions: [{ field: 'business_kind', operator: 'eq' as const, value: 'TRANSITION' }] },
    { id: 'maintenance', priority: 100, conditions: [{ field: 'business_kind', operator: 'eq' as const, value: 'MAINTENANCE' }] },
  ];

  it('keeps emergency first, then mainline, transition and maintenance', () => {
    expect(resolvePriority({ order_status: 'FAULTED', business_kind: 'TRANSITION' }, 'shifts', rules, 0, 0)).toBe(1000);
    expect(resolvePriority({ business_kind: 'MAINLINE' }, 'shifts', rules, 0, 0)).toBe(300);
    expect(resolvePriority({ business_kind: 'TRANSITION' }, 'shifts', rules, 0, 0)).toBe(200);
    expect(resolvePriority({ business_kind: 'MAINTENANCE' }, 'shifts', rules, 0, 0)).toBe(100);
  });
});

describe('applyFieldAliases', () => {
  it('新增別名鍵，不覆蓋原始欄位', () => {
    const row = { order_id: 'X1', item_id: 'existing' };
    const aliased = applyFieldAliases(row, { order_id: 'item_id' });
    expect(aliased.order_id).toBe('X1'); // 原始欄位保留
    expect(aliased.item_id).toBe('existing'); // 已存在的別名鍵不被覆蓋
  });
});

describe('buildCandidateUid', () => {
  it('預設「來源+項目 ID」，不同來源同 ID 不互相覆蓋', () => {
    const a = buildCandidateUid('sourceA', { id: '1' }, 'id', undefined);
    const b = buildCandidateUid('sourceB', { id: '1' }, 'id', undefined);
    expect(a).not.toBe(b);
  });
  it('明確設定 mergeIdField 時跨來源合併', () => {
    const a = buildCandidateUid('sourceA', { vehicle_code: 'PMS01' }, 'id', 'vehicle_code');
    const b = buildCandidateUid('sourceB', { vehicle_code: 'PMS01' }, 'id', 'vehicle_code');
    expect(a).toBe(b);
  });
});

describe('buildCandidatesFromSource', () => {
  const source: GroupDataSource = { id: 'mainline', itemIdField: 'order_id', defaultPriority: 10 };

  it('查詢失敗不等同成功回傳空集合：本函式只處理已取得的列，呼叫端應在失敗時整批跳過此來源', () => {
    // 這裡驗證的是空陣列輸入的行為（成功但 0 筆），失敗情形由呼叫端的載入狀態判斷，不進這支函式
    const result = buildCandidatesFromSource({ source, rows: [] });
    expect(result).toEqual([]);
  });

  it('validStartField 還沒到即視為失效', () => {
    const future = Date.now() + 60_000;
    const result = buildCandidatesFromSource({
      source: { ...source, validStartField: 'start_at' },
      rows: [{ order_id: '1', start_at: future }],
    });
    expect(result[0].valid).toBe(false);
  });

  it('invalidStatusValues 命中即視為失效', () => {
    const result = buildCandidatesFromSource({
      source: { ...source, invalidStatusField: 'status', invalidStatusValues: ['CANCELLED'] },
      rows: [{ order_id: '1', status: 'CANCELLED' }, { order_id: '2', status: 'ACTIVE' }],
    });
    expect(result[0].valid).toBe(false);
    expect(result[1].valid).toBe(true);
  });

  it('計畫結束時間到了不預設失效（規格 §6）', () => {
    const past = Date.now() - 60_000;
    const result = buildCandidatesFromSource({
      source: { ...source, validEndField: 'end_at' },
      rows: [{ order_id: '1', end_at: past, status: 'PROCESSING' }],
    });
    expect(result[0].valid).toBe(true); // 沒設 validityRules 淘汰它，就不該自動失效
  });
});

describe('selectTemplate', () => {
  const templates: GroupTemplateDef[] = [
    { id: 't-default', name: '預設', children: [], isDefault: true },
    { id: 't-mainline', name: '正線', children: [], conditions: [{ field: 'kind', operator: 'eq', value: 'mainline' }] },
  ];
  it('依序命中條件的樣板', () => {
    expect(selectTemplate({ kind: 'mainline' }, templates)?.id).toBe('t-mainline');
  });
  it('都沒命中回退預設樣板', () => {
    expect(selectTemplate({ kind: 'other' }, templates)?.id).toBe('t-default');
  });
  it('沒有樣板清單回傳 null', () => {
    expect(selectTemplate({}, undefined)).toBeNull();
  });
});
