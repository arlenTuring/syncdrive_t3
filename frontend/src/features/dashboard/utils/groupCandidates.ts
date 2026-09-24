import type {
  GroupConditionOperator,
  GroupDataSource,
  GroupFieldCondition,
  GroupPriorityRule,
  GroupSortRule,
  GroupTemplateDef,
  GroupValidityRule,
} from '../types';
import type { PriorityCandidate } from './groupPriorityPool';

/**
 * 泛用群組的候選項目管線（規格 §1）：
 *
 *   各來源更新資料 → 合併候選項目 → 判斷有效性 → 計算重要程度 → 選出可見項目
 *   → 選擇樣板 → 更新格位與動畫
 *
 * 這支只做到「計算重要程度」為止的純函式部分（不碰 React／不發請求）；
 * 「選出可見項目」交給 groupPriorityPool.ts；「選擇樣板」在本檔下半部；
 * 「更新格位與動畫」是 GroupCanvasRenderer 的事。全部拆開才有辦法各自測試。
 */

function toComparable(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

/** 條件全部走同一套運算子，有效性規則、優先程度規則、樣板條件共用。 */
export function evaluateCondition(
  row: Record<string, unknown>,
  field: string,
  operator: GroupConditionOperator,
  compareValue: string | undefined,
): boolean {
  const raw = row[field];
  switch (operator) {
    case 'empty':
      return raw == null || raw === '';
    case 'not_empty':
      return !(raw == null || raw === '');
    case 'before_now':
    case 'after_now': {
      const ts = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''));
      if (Number.isNaN(ts)) return false;
      return operator === 'before_now' ? ts < Date.now() : ts > Date.now();
    }
    case 'contains':
    case 'not_contains': {
      const hit = String(raw ?? '').toLowerCase().includes((compareValue ?? '').toLowerCase());
      return operator === 'contains' ? hit : !hit;
    }
    default: {
      const left = toComparable(raw);
      const rightNum = compareValue != null && compareValue !== '' && !Number.isNaN(Number(compareValue))
        ? Number(compareValue)
        : null;
      const right: string | number | null = typeof left === 'number' && rightNum != null ? rightNum : (compareValue ?? null);
      if (left == null || right == null) return operator === 'eq' ? left === right : false;
      // eq/neq 對字串不分大小寫：真實資料常見同一個值在不同來源/合併路徑被改了大小寫
      // （如即時疊加後 line_kind 從 'mainline' 變成 'MAINLINE'），條件比對不該因此失準。
      const leftForEq = typeof left === 'string' ? left.toLowerCase() : left;
      const rightForEq = typeof right === 'string' ? right.toLowerCase() : right;
      switch (operator) {
        case 'eq': return leftForEq === rightForEq;
        case 'neq': return leftForEq !== rightForEq;
        case 'gt': return left > right;
        case 'gte': return left >= right;
        case 'lt': return left < right;
        case 'lte': return left <= right;
        default: return false;
      }
    }
  }
}

function evaluateAll(row: Record<string, unknown>, conditions: GroupFieldCondition[] | undefined): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(row, c.field, c.operator, c.value));
}

/**
 * 有效性：規則之間 AND，命中 effect='invalid'（預設）即視為失效；
 * effect='valid' 的規則命中則直接判有效，用於「白名單」式規則。
 * 沒有任何規則時一律有效——不能因為忘記設定有效性規則就把資料全部藏起來。
 */
export function isRowValid(row: Record<string, unknown>, rules: GroupValidityRule[] | undefined): boolean {
  if (!rules || rules.length === 0) return true;
  for (const rule of rules) {
    const hit = evaluateCondition(row, rule.field, rule.operator, rule.value);
    if (hit && (rule.effect ?? 'invalid') === 'invalid') return false;
    if (hit && rule.effect === 'valid') return true;
  }
  return true;
}

/** 優先程度：由上而下第一條命中的規則決定；都沒命中就用來源/群組的預設值。 */
export function resolvePriority(
  row: Record<string, unknown>,
  sourceId: string,
  rules: GroupPriorityRule[] | undefined,
  sourceDefault: number | undefined,
  groupDefault: number | undefined,
): number {
  for (const rule of rules ?? []) {
    if (rule.sourceId && rule.sourceId !== sourceId) continue;
    if (evaluateAll(row, rule.conditions)) return rule.priority;
  }
  return sourceDefault ?? groupDefault ?? 0;
}

/** 別名映射：新增鍵，不覆蓋原始欄位（規格 §3：保留原始資料欄位供子元件綁定）。 */
export function applyFieldAliases(row: Record<string, unknown>, aliases: Record<string, string> | undefined): Record<string, unknown> {
  if (!aliases || Object.keys(aliases).length === 0) return row;
  const next = { ...row };
  for (const [from, to] of Object.entries(aliases)) {
    if (from in row && !(to in next)) next[to] = row[from];
  }
  return next;
}

/**
 * 候選項目唯一鍵。預設「來源 id + 項目 id」，避免不同來源的相同 ID 互相覆蓋；
 * 只有使用者明確設定 mergeIdField 時才跨來源合併成同一個鍵。
 */
export function buildCandidateUid(
  sourceId: string,
  row: Record<string, unknown>,
  itemIdField: string | undefined,
  mergeIdField: string | undefined,
): string {
  if (mergeIdField) {
    const merged = row[mergeIdField];
    if (merged != null && merged !== '') return String(merged);
  }
  const itemId = itemIdField ? row[itemIdField] : undefined;
  return `${sourceId}::${itemId != null && itemId !== '' ? String(itemId) : JSON.stringify(row)}`;
}

export interface BuildCandidatesInput {
  source: GroupDataSource;
  rows: Record<string, unknown>[];
  groupItemIdField?: string;
  mergeIdField?: string;
  validityRules?: GroupValidityRule[];
  priorityRules?: GroupPriorityRule[];
  groupDefaultPriority?: number;
  sortRules?: GroupSortRule[];
}

/** 單一來源的一批原始列 → 優先池要的候選項目。查詢失敗時呼叫端不該呼叫這支（見 groupCandidates.spec.ts 的說明）。 */
export function buildCandidatesFromSource(input: BuildCandidatesInput): PriorityCandidate[] {
  const { source, rows, groupItemIdField, mergeIdField, validityRules, priorityRules, groupDefaultPriority, sortRules } = input;
  const itemIdField = source.itemIdField ?? groupItemIdField;
  return rows.map((raw) => {
    const row = applyFieldAliases(raw, source.fieldAliases);
    const uid = buildCandidateUid(source.id, row, itemIdField, mergeIdField);

    // 來源層級的有效性檢查，跟 validityRules（群組層級，使用者在編輯器設定）分開判斷：
    // - validStartField：還沒到開始時間視為失效。
    //   刻意不對 validEndField 做同義的「時間到即失效」——計畫結束時間到了不代表任務
    //   真的結束（規格 §6），要不要靠時間淘汰完全交給使用者自己在 validityRules 設定。
    // - invalidStatusField/invalidStatusValues：狀態命中清單視為失效（如 CANCELLED）。
    let sourceValid = true;
    if (source.validStartField) {
      const startRaw = row[source.validStartField];
      const startTs = typeof startRaw === 'number' ? startRaw : Date.parse(String(startRaw ?? ''));
      if (!Number.isNaN(startTs) && startTs > Date.now()) sourceValid = false;
    }
    if (sourceValid && source.invalidStatusField && source.invalidStatusValues?.length) {
      const statusVal = row[source.invalidStatusField];
      if (source.invalidStatusValues.includes(String(statusVal))) sourceValid = false;
    }
    const valid = sourceValid && isRowValid(row, validityRules);
    const priority = resolvePriority(row, source.id, priorityRules, source.defaultPriority, groupDefaultPriority);
    const sortField = sortRules?.[0]?.field;
    let sortKey: string | number | undefined;
    if (sortField) {
      const v = toComparable(row[sortField]);
      if (v != null) {
        const dir = sortRules?.[0]?.direction ?? 'asc';
        // 降冪：數字取負、字串前綴反轉排序不好做，這裡只處理數字反向；
        // 字串降冪留給呼叫端在 UI 層面提醒（多數排序鍵是時間/數字）
        sortKey = dir === 'desc' && typeof v === 'number' ? -v : v;
      }
    }
    const updatedAtRaw = source.updatedAtField ? row[source.updatedAtField] : undefined;
    const updatedAt = typeof updatedAtRaw === 'number' ? updatedAtRaw : Date.parse(String(updatedAtRaw ?? '')) || undefined;
    const contentVersion = source.contentVersionField
      ? String(row[source.contentVersionField] ?? '')
      : undefined;
    return { uid, priority, sortKey, updatedAt, valid, contentVersion, row };
  });
}

/** 依序比對樣板條件，命中第一個就用；都沒命中用 isDefault 的那個；都沒有就回 null（呼叫端退回 children 備援）。 */
export function selectTemplate(row: Record<string, unknown>, templates: GroupTemplateDef[] | undefined): GroupTemplateDef | null {
  if (!templates || templates.length === 0) return null;
  for (const tpl of templates) {
    if (tpl.conditions && tpl.conditions.length > 0 && evaluateAll(row, tpl.conditions)) return tpl;
  }
  return templates.find(t => t.isDefault) ?? templates[0] ?? null;
}
