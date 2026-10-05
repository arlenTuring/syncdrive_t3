import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../types';
import * as demoSql from '../constants/demoSql';
import { SYSTEM_QUERY_FAMILIES, type SystemQueryFamily } from '../constants/systemQueryFamilies';
import { SYSTEM_QUERY_HISTORY } from '../constants/systemQueryHistory';
import { sqlFingerprint } from './sqlFingerprint';
import { collectAllChildArrays, mapAllChildArrays } from '../template/childArrayVariants';

/**
 * 版面裡被存下來的「系統內建查詢」升級。
 *
 * <h3>為什麼要有這一支</h3>
 * 內建查詢（班次名冊、車輛狀態…）在建版面時被整份複製進使用者版面——包含泛用群組的
 * genericGroup.sources[].sqlQuery。之後程式改了 demoSql.ts，版面裡那份並不會跟著變；
 * 原本的升級只認外層群組名稱（「正線班次」「整備班表」），合併成泛用群組之後就再也碰不到
 * 內部來源。結果是訂單清空了，整備卡仍由舊查詢從班表拼出來。
 *
 * <h3>只換「確定是系統原文」的</h3>
 * 判斷看完整指紋：這份 SQL 必須跟系統某一版內建查詢一字不差（忽略註解與空白）。使用者
 * 改過一個字，指紋就對不上，一律不動，只回報位置。不看群組名稱、不看元件 ID。
 */

export type SqlClassification =
  | { kind: 'current'; family: SystemQueryFamily }
  | { kind: 'outdated-system'; family: SystemQueryFamily; firstSeen: string; commit: string }
  /** 看起來像某種系統查詢，但跟任何一版原文都對不上：可能是使用者改過，不能自動覆寫 */
  | { kind: 'unconfirmed'; family: SystemQueryFamily }
  | { kind: 'custom' };

const currentByFamily = new Map<string, string>(
  SYSTEM_QUERY_FAMILIES.map((family) => [family.id, String((demoSql as Record<string, unknown>)[family.constantName] ?? '')]),
);
const currentFingerprint = new Map<string, string>(
  [...currentByFamily].map(([id, sql]) => [id, sqlFingerprint(sql)]),
);
const historyByFingerprint = new Map(SYSTEM_QUERY_HISTORY.map((row) => [row.fingerprint, row]));

export function currentSystemQuery(familyId: string): string | undefined {
  return currentByFamily.get(familyId);
}

/**
 * 舊群組升級用：這份 SQL 是系統某一版（或已是目前版）就回傳目前版本；空白也回傳目前版本
 * （群組本來就沒有自己的查詢）；其他（使用者寫的、或像系統但對不上的）原樣保留。
 */
export function systemQueryOrKeep(sql: string | undefined, familyId: string): string | undefined {
  const current = currentByFamily.get(familyId);
  if (!current) return sql;
  if (!sql?.trim()) return current;
  const verdict = classifySql(sql);
  if ((verdict.kind === 'outdated-system' || verdict.kind === 'current') && verdict.family.id === familyId) return current;
  return sql;
}

export function classifySql(sql: string | undefined): SqlClassification {
  if (!sql?.trim()) return { kind: 'custom' };
  const fingerprint = sqlFingerprint(sql);
  for (const family of SYSTEM_QUERY_FAMILIES) {
    if (currentFingerprint.get(family.id) === fingerprint) return { kind: 'current', family };
  }
  const known = historyByFingerprint.get(fingerprint);
  if (known) {
    const family = SYSTEM_QUERY_FAMILIES.find((item) => item.id === known.family);
    if (family) return { kind: 'outdated-system', family, firstSeen: known.firstSeen, commit: known.commit };
  }
  // 群組子元件的逐列取值（listSqlRowFieldsByIndex 等）把清單 SQL 包在 `) AS __rows` 裡取第幾列：
  // 這是衍生查詢，不是要被換掉的系統原文，不列進「看起來像但無法確認」
  if (/\)\s*AS\s+__rows\b/i.test(sql)) return { kind: 'custom' };
  const lookalike = SYSTEM_QUERY_FAMILIES.find((family) => family.markers.every((marker) => marker.test(sql)));
  return lookalike ? { kind: 'unconfirmed', family: lookalike } : { kind: 'custom' };
}

export interface SystemQueryChange {
  /** 給人看的位置：「版面 › 元件（id） › 來源（id）」 */
  location: string;
  family: string;
  /** 被換掉的那一版第一次出現的日期／提交 */
  fromVersion: string;
}

export interface SystemQueryUpgradeResult {
  plane: DashboardPlane;
  changes: SystemQueryChange[];
  /** 像系統查詢但無法確認、沒有動的位置 */
  unconfirmed: Array<{ location: string; family: string }>;
}

function upgradeSql(
  sql: string | undefined,
  location: string,
  result: Pick<SystemQueryUpgradeResult, 'changes' | 'unconfirmed'>,
): string | undefined {
  const verdict = classifySql(sql);
  if (verdict.kind === 'outdated-system') {
    const next = currentByFamily.get(verdict.family.id);
    if (next) {
      result.changes.push({ location, family: verdict.family.label, fromVersion: `${verdict.firstSeen}（${verdict.commit}）` });
      return next;
    }
  }
  if (verdict.kind === 'unconfirmed') result.unconfirmed.push({ location, family: verdict.family.label });
  return sql;
}

function where(plane: DashboardPlane, el: CanvasElementProps, extra?: string): string {
  return [`版面「${plane.name}」`, `元件「${el.label}」（${el.id}）`, extra].filter(Boolean).join(' › ');
}

/**
 * 走過版面裡每一個存 SQL 的地方（外層元件、泛用群組來源、所有子元件陣列），把系統舊版
 * 原文換成目前版本。可以重複執行：第二次全部都是 current，不會再變。
 */
export function upgradeSystemQueries(plane: DashboardPlane): SystemQueryUpgradeResult {
  const result: Pick<SystemQueryUpgradeResult, 'changes' | 'unconfirmed'> = { changes: [], unconfirmed: [] };
  const elements = plane.elements.map((el) => {
    let next: CanvasElementProps = el;
    const ownSql = upgradeSql(el.sqlQuery, where(plane, el), result);
    if (ownSql !== el.sqlQuery) next = { ...next, sqlQuery: ownSql };

    const sources = el.genericGroup?.sources;
    if (sources?.length) {
      let sourcesChanged = false;
      const upgraded = sources.map((source) => {
        const sql = upgradeSql(source.sqlQuery, where(plane, el, `來源「${source.label ?? source.id}」（${source.id}）`), result);
        if (sql === source.sqlQuery) return source;
        sourcesChanged = true;
        return { ...source, sqlQuery: sql };
      });
      if (sourcesChanged) next = { ...next, genericGroup: { ...next.genericGroup!, sources: upgraded } };
    }

    let childrenChanged = false;
    const mapped = mapAllChildArrays(next, (children) => children.map((child) => {
      const sql = (child as { sqlQuery?: string }).sqlQuery;
      const upgradedSql = upgradeSql(sql, where(plane, el, `子元件 ${child.type}（${child.id}）`), result);
      if (upgradedSql === sql) return child;
      childrenChanged = true;
      return { ...child, sqlQuery: upgradedSql } as ChildWidget;
    }));
    return childrenChanged ? mapped : next;
  });
  const changed = result.changes.length > 0;
  return { plane: changed ? { ...plane, elements } : plane, ...result };
}

/** 只檢查不改：版面裡所有系統查詢的狀態（盤點腳本、測試用） */
export function auditSystemQueries(plane: DashboardPlane): Array<{ location: string; verdict: SqlClassification['kind']; family?: string }> {
  const out: Array<{ location: string; verdict: SqlClassification['kind']; family?: string }> = [];
  const push = (location: string, sql: string | undefined) => {
    if (!sql?.trim()) return;
    const verdict = classifySql(sql);
    out.push({ location, verdict: verdict.kind, ...(verdict.kind !== 'custom' ? { family: verdict.family.label } : {}) });
  };
  for (const el of plane.elements) {
    push(where(plane, el), el.sqlQuery);
    for (const source of el.genericGroup?.sources ?? []) push(where(plane, el, `來源「${source.label ?? source.id}」（${source.id}）`), source.sqlQuery);
    for (const child of collectAllChildArrays(el).flat()) push(where(plane, el, `子元件 ${child.type}（${child.id}）`), (child as { sqlQuery?: string }).sqlQuery);
  }
  return out;
}
