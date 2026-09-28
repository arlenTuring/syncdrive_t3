/**
 * 一次生成共用的搜尋預算
 * ====================
 *
 * 先前每一段搜尋各自拿一份預算：殘留衝突修復每次呼叫重新給 3000 次評估，外層的聯動搜尋、
 * 殘留修復後重算、待命替換又各自多次重跑整段後處理——每跑一次後處理就再拿一份新的。
 * 評估計數也只算「完整評估」，被快篩擋掉的候選已經做完昂貴的重建，卻不扣任何額度。
 * 結果是高衝突的輸入（例如碰撞保護時間設得很大）一跑數小時，沒有任何東西會讓它停。
 *
 * 現在一次 generateShiftSchedule() 只建立一份：
 * - candidates：候選嘗試數。在<strong>重建候選之前</strong>扣，被快篩擋掉的也算。
 * - evaluations：完整安全評估數。
 * - 時間上限：安全網，避免資料量異常時無止盡；次數上限才是主要的、可重現的停止條件。
 * - 去重：同一個狀態下同一筆衝突已經搜完，就沿用當時的結果（找到或沒找到），不重搜
 *   （{@link SearchBudget.memo}）；整段後處理也依輸入狀態快取（generate.ts）。
 *
 * 用盡時各段搜尋停下、回傳目前最好的結果；仍有安全問題時由呼叫端標成「搜尋未完成」並
 * 禁止發布。<strong>用盡不代表無解</strong>——只代表這次沒有搜完。
 */

export type SearchBudgetLimits = {
  /** 候選嘗試次數上限（含被快篩擋掉的） */
  maxCandidates: number;
  /** 完整安全評估次數上限 */
  maxEvaluations: number;
  /** 整次生成的搜尋時間上限（毫秒） */
  timeLimitMs: number;
};

export const DEFAULT_SEARCH_BUDGET_LIMITS: SearchBudgetLimits = {
  maxCandidates: 20_000,
  maxEvaluations: 6_000,
  timeLimitMs: 240_000,
};

export type SearchBudgetReport = {
  candidates: number;
  evaluations: number;
  elapsedMs: number;
  limits: SearchBudgetLimits;
  exhaustedBy: 'candidates' | 'evaluations' | 'time' | null;
  /** 同一狀態已搜過、直接沿用結果（沒有重搜）的次數 */
  duplicatesSkipped: number;
};

export class SearchBudget {
  readonly limits: SearchBudgetLimits;
  private readonly now: () => number;
  /** 第一次有搜尋來要預算時才開始計時：前面的收斂迴圈不是搜尋，不該吃掉搜尋時間 */
  private startedAt: number | null = null;
  private candidates = 0;
  private evaluations = 0;
  private duplicates = 0;
  private exhaustedBy: SearchBudgetReport['exhaustedBy'] = null;
  /** 各段搜尋記下的「這個狀態下這個目標已確定找不到」，重跑同一個狀態時直接沿用 */
  readonly memo = new Map<string, unknown>();

  constructor(limits: Partial<SearchBudgetLimits> = {}, now: () => number = () => Date.now()) {
    this.limits = { ...DEFAULT_SEARCH_BUDGET_LIMITS, ...limits };
    this.now = now;
  }

  private elapsed(): number {
    return this.startedAt === null ? 0 : this.now() - this.startedAt;
  }

  get exhausted(): boolean {
    if (this.exhaustedBy) return true;
    if (this.elapsed() >= this.limits.timeLimitMs) this.exhaustedBy = 'time';
    return this.exhaustedBy !== null;
  }

  /** 重建一個候選之前呼叫；false＝預算用盡，不要做 */
  tryCandidate(): boolean {
    this.startedAt ??= this.now();
    if (this.exhausted) return false;
    if (this.candidates >= this.limits.maxCandidates) {
      this.exhaustedBy = 'candidates';
      return false;
    }
    this.candidates += 1;
    return true;
  }

  /** 做一次完整評估之前呼叫；false＝預算用盡 */
  tryEvaluation(): boolean {
    this.startedAt ??= this.now();
    if (this.exhausted) return false;
    if (this.evaluations >= this.limits.maxEvaluations) {
      this.exhaustedBy = 'evaluations';
      return false;
    }
    this.evaluations += 1;
    return true;
  }

  /** 不受預算限制、但要計入的評估（例如基準狀態本身） */
  countEvaluation(): void {
    this.evaluations += 1;
  }

  /** 同一個狀態已經搜過、直接沿用結果時呼叫（統計用） */
  noteReuse(): void {
    this.duplicates += 1;
  }

  report(): SearchBudgetReport {
    return {
      candidates: this.candidates,
      evaluations: this.evaluations,
      elapsedMs: this.elapsed(),
      limits: this.limits,
      exhaustedBy: this.exhaustedBy,
      duplicatesSkipped: this.duplicates,
    };
  }
}

/** 版面狀態的簡短指紋（去重用）：每張卡的身分與起訖 */
export function planStateKey(
  timelines: ReadonlyArray<{ row: number; blocks: ReadonlyArray<{ id: string; plannedStartMinute: number; plannedEndMinute: number; routeInstanceId?: string; routeId?: string; yardFacilityNodeId?: string }> }>,
): string {
  // 兩組不同起始值的 FNV-1a 合成 64 位元，去重時撞號的機率可以忽略
  let hash = 2166136261;
  let hash2 = 0x9747b28c;
  const mix = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      hash = Math.imul(hash ^ code, 16777619);
      hash2 = Math.imul(hash2 ^ code, 0x5bd1e995);
    }
  };
  for (const timeline of timelines) {
    mix(`#${timeline.row}`);
    for (const block of timeline.blocks) {
      mix(`|${block.id}@${Math.round(block.plannedStartMinute * 60)}-${Math.round(block.plannedEndMinute * 60)}`
        + `:${block.routeInstanceId ?? block.routeId ?? ''}:${block.yardFacilityNodeId ?? ''}`);
    }
  }
  return `${(hash >>> 0).toString(36)}.${(hash2 >>> 0).toString(36)}`;
}
