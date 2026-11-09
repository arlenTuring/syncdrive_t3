import type { PlannedDispatch } from '../dispatch/dispatch.plan';

/**
 * 輪替調車各段的執行狀態（純函式，服務與測試共用）。
 *
 * 一段調車的生命週期：
 * - planned：在每日計畫裡，由派遣（或計畫重播）照計畫發單（第一段接替調車）。
 * - hold：先記下來，條件到了才發（回場調車要等接替車到位）。
 * - queued：已決定要發、已寫進資料庫；等 waitFor 裡的舊單由車端確認結案後才真的下單。
 *   先寫庫再送單：程序在中間重啟，下一次檢查照資料庫繼續補送，不會遺失。
 * - issued：已下單（訂單編號固定，重送不會多一張）。
 */
export type LegRole = 'in' | 'out' | 'fallback' | 'return';
export type LegPhase = 'planned' | 'hold' | 'queued' | 'issued';

export type ShuntLeg = PlannedDispatch & {
  role?: LegRole;
  attempt?: number;
  phase?: LegPhase;
  /** 這些訂單由車端確認結案（END／FAULTED）後才能下這一段，避免同一台車同時拿著互斥的兩張單 */
  waitFor?: string[];
  queuedAt?: number;
  /** 由輪替直接下單的時間（營運時間）；計畫裡的第一段接替由派遣發，沒有這個 */
  issuedAt?: number;
  issueError?: string | null;
  issueTries?: number;
  /** 車真的開動過 */
  ran?: boolean;
  /** 這張單屬於哪一個營運日的計畫；沒寫就是換手當天 */
  planDay?: string;
  /** 補救任務在原計畫裡的發車時刻（重排時間不改它），判斷前後順序用 */
  planDepartAt?: number;
  /** 被後面的重發取代，不再監看 */
  superseded?: boolean;
  /** 回場重發也失敗：已要求取消，等車端確認停下 */
  strandAt?: number;
  /** 回場放棄、車端確認停下：車留在原地當備用車 */
  gaveUp?: boolean;
  /** 上次看到的車位置（5 公尺格）；有變就代表車還在前進 */
  progressKey?: string | null;
  /** 營運時間：進度最後一次改變的時刻 */
  progressAt?: number;
  /** 補救任務的最終結果 */
  result?: 'done' | 'failed';
  failure?: string;
};

export type OrderState = {
  orderId: string;
  planOrderId: string | null;
  vehicle: string;
  status: string;
  plannedEnd: number | null;
  /** 營運時刻：車端回報開始／結案 */
  startedAt: number | null;
  endedAt: number | null;
  /** 實際時間：中心端要求取消的時刻 */
  cancelRequestedAt: number | null;
  closedReason: string | null;
  createdAt: number;
  /** 執行中時車的實際位置（5 公尺格），比對有沒有在前進 */
  progressKey: string | null;
};

export const isActive = (state: OrderState | null | undefined): boolean =>
  state != null && (state.status === 'PENDING' || state.status === 'PROCESSING');

/** 車端已經結案（不管完成或故障）；不存在的單也不擋 */
export const isClosed = (state: OrderState | null | undefined): boolean => !isActive(state);

/** 調車每一段的預設：舊資料沒有 role／phase */
export function normalizeLegs(shunts: readonly ShuntLeg[]): ShuntLeg[] {
  return shunts.map((leg, index) => {
    const role = leg.role ?? (index === 0 ? 'in' : 'out');
    const phase: LegPhase = leg.phase
      ?? (index === 0 && role === 'in' ? 'planned' : leg.issuedAt != null ? 'issued' : role === 'out' ? 'hold' : 'issued');
    return { ...leg, role, phase };
  });
}

/** 還沒開始的調車：計畫結束後這麼久還沒開始就算卡住；長的調車再多給一段計畫時間 */
export const STUCK_MS = 5 * 60_000;
/**
 * 執行中的調車：預估只是班表裡的中位數，場區要等號誌、繞路都會比預估慢，
 * 車還在前進就不算失敗。超過計畫結束、而且這麼久都沒有進度才算卡住。
 */
export const NO_PROGRESS_MS = 8 * 60_000;
/** 執行中但一直有進度：超過計畫結束這麼久（或三倍計畫時間）還沒做完，才當成失敗 */
export const HARD_OVERDUE_MS = 30 * 60_000;
/** 單已發出、過了發車時間這麼久還沒開始，就當作車端錯過了這一張 */
export const NOT_STARTED_MS = 2 * 60_000;
/** 到了發車時間這麼久還沒有訂單，就當作沒發出去 */
export const NOT_ISSUED_MS = 3 * 60_000;

/**
 * 這一段失敗了嗎：故障、超過計畫結束還沒做完、到了發車時間單還沒出現。
 * 系統自己要求取消的單結案不算失敗（那是取代或收尾）。
 */
export function legFailure(
  leg: ShuntLeg,
  state: OrderState | null,
  now: number,
  /** 這台車手上有別張單正在執行：排在後面的單本來就要等，不算錯過發車 */
  vehicleBusy = false,
): string | null {
  if (leg.phase === 'queued' || leg.phase === 'hold') return null;
  if (state?.status === 'FAULTED') return state.closedReason === 'cancelled_by_center' ? '被取消' : '故障';
  if (state?.status === 'END') return null;
  const duration = leg.arriveAt - leg.departAt;
  const plannedEnd = state?.plannedEnd ?? leg.arriveAt;
  if (state?.status === 'PROCESSING') {
    const lastMove = leg.progressAt ?? state.startedAt ?? leg.issuedAt ?? leg.departAt;
    if (now > plannedEnd + STUCK_MS && now - lastMove > NO_PROGRESS_MS) return '停滯沒有進度';
    if (now > plannedEnd + Math.max(HARD_OVERDUE_MS, 3 * duration)) return '逾時未完成';
    return null;
  }
  // 單已在車上但過了發車時間還沒開始：車端錯過發車（例如故障剛恢復、起點被佔住太久）就不會再開，
  // 不等到計畫結束才發現，趁接班期限內還來得及再發一次
  if (state?.status === 'PENDING' && !vehicleBusy && now > leg.departAt + NOT_STARTED_MS) return '過了發車時間沒有開始';
  const graceMs = Math.max(STUCK_MS, duration);
  // 車手上有別張單在跑：排在後面的單照順序等，不算逾時
  if (state && !vehicleBusy && now > plannedEnd + graceMs) return '逾時未開始';
  if (!state && now > (leg.issuedAt ?? leg.departAt) + NOT_ISSUED_MS) return '沒有發出';
  return null;
}

/** queued 的這一段還在等哪些舊單結案 */
export function pendingBlockers(leg: ShuntLeg, states: ReadonlyMap<string, OrderState>): OrderState[] {
  return (leg.waitFor ?? []).map((id) => states.get(id)).filter((state): state is OrderState => isActive(state));
}

export type HistoryEntry = { at: number; kind: string; text: string };
