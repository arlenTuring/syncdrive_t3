import type { MaintenanceSectionCodeBySection, MaintenanceSectionCodeKey } from './maintenanceSectionCode';

/**
 * 整備卡與過渡卡的顯示代號：使用者設定的代號＋時間線列號（兩位數）＋計畫開始時刻 HHMM。
 * 例：第 2 列 10:30 充電（代號 E）→ E021030；第 10 列 21:35 入場（代號 IN）→ IN102135。
 * 列號是必要的：好幾台車常在同一分鐘暫停或進出場，只用代號＋HHMM 一份班表就有 31 組重複。
 * ================================================
 *
 * 後端 backend/src/operation-shift/card-code.ts 是同一份規則：班表預覽、時刻表 API、整備／移動
 * 訂單的 trip_code 都是同一個代號。
 *
 * <table>
 *   <tr><td>充電、洗車、保養、行檢、待命</td><td>整備任務步驟的整備代號（sectionCodeBySection）</td></tr>
 *   <tr><td>入場移動 yard_entry_move</td><td>路線群組的過渡卡代號「入場」</td></tr>
 *   <tr><td>出場移動 yard_exit_move</td><td>過渡卡代號「出場」</td></tr>
 *   <tr><td>暫停／停留：idle 的 hold（暫停）與 transition（暫停放、提早進廠等待）</td><td>過渡卡代號「暫停／停留」</td></tr>
 * </table>
 *
 * 不含 MT-、格位、英文列碼（A/B/C）或秒數。時間取班表確定的計畫開始時刻；改計畫時間就重新產生，
 * 執行中的延誤不改代號（訂單建立時就定了）。
 *
 * 待命已由整備代號處理，不另設；入場／出場路徑上的內部節點不是卡片，不各自有代號。
 * 「暫停執行控制」（模擬器的暫停播放）不是班表卡，跟這裡的暫停／停留無關。
 *
 * 班表 body 有 transitionCardCodes 才用這套規則；舊班表照原本的代號，畫面標示待補設定。
 */

export type TransitionCardCodeKey = 'entry' | 'exit' | 'hold';
export type TransitionCardCodes = Record<TransitionCardCodeKey, string>;

export const TRANSITION_CARD_CODE_KEYS: TransitionCardCodeKey[] = ['entry', 'exit', 'hold'];

export const TRANSITION_CARD_CODE_META: Record<TransitionCardCodeKey, { label: string; description: string }> = {
  entry: { label: '入場', description: '整備前從轉乘站開進整備設施的空車移動' },
  exit: { label: '出場', description: '整備完成後從整備設施開到轉乘站的空車移動' },
  hold: { label: '暫停／停留', description: '卡片之間車停在原地（月台或格位）、暫停放與提早進廠等待' },
};

const SECTION_LABEL: Record<MaintenanceSectionCodeKey, string> = {
  charging: '充電',
  carWash: '洗車',
  maintenance: '保養',
  preTrip: '行檢',
  mobile: '待命',
};

const SECTION_KEY_BY_TASK_TYPE: Record<string, MaintenanceSectionCodeKey> = {
  charging: 'charging',
  washing: 'carWash',
  servicing: 'maintenance',
  inspection: 'preTrip',
  standby: 'mobile',
};

export function emptyTransitionCardCodes(): TransitionCardCodes {
  return { entry: '', exit: '', hold: '' };
}

/** 前後空白去掉、轉大寫；數字、空格、符號不偷偷刪，留給驗證報錯 */
export function normalizeCardCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

export function isValidCardCode(code: string): boolean {
  return /^[A-Z]{1,2}$/.test(code);
}

export function cardCodeFormatError(code: string): string | null {
  if (!code) return null;
  if (/\s/.test(code)) return '不能有空格';
  if (/[0-9]/.test(code)) return '不能有數字';
  if (!/^[A-Z]+$/.test(code)) return '只能用英文字母';
  if (code.length > 2) return '最多 2 個字母';
  return null;
}

/** body.transitionCardCodes → 設定；沒有這一欄（舊班表）回 null */
export function parseTransitionCardCodes(raw: unknown): TransitionCardCodes | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    entry: normalizeCardCode(value.entry),
    exit: normalizeCardCode(value.exit),
    hold: normalizeCardCode(value.hold),
  };
}

/** 時間線列號，至少兩位數（2 → 02、10 → 10） */
export function formatRow(row: number): string {
  return String(Math.max(0, Math.floor(row))).padStart(2, '0');
}

export function formatHhmm(minute: number): string {
  const total = Math.max(0, Math.floor(minute));
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}

export type CardCodeKind =
  | { group: 'maintenance'; key: MaintenanceSectionCodeKey; label: string }
  | { group: 'transition'; key: TransitionCardCodeKey; label: string };

/** 這張卡是哪一種整備／過渡卡；正線、進場載客、其他卡回 null */
export function cardCodeKind(block: { taskType?: string; source?: string }): CardCodeKind | null {
  const source = block.source ?? '';
  const taskType = block.taskType ?? '';
  if (source === 'yard_entry_move') return { group: 'transition', key: 'entry', label: TRANSITION_CARD_CODE_META.entry.label };
  if (source === 'yard_exit_move') return { group: 'transition', key: 'exit', label: TRANSITION_CARD_CODE_META.exit.label };
  if (taskType === 'idle' && (source === 'hold' || source === 'transition')) {
    return { group: 'transition', key: 'hold', label: TRANSITION_CARD_CODE_META.hold.label };
  }
  const section = SECTION_KEY_BY_TASK_TYPE[taskType];
  if (section && source !== 'entry_service') return { group: 'maintenance', key: section, label: SECTION_LABEL[section] };
  return null;
}

export type CardCodeSettings = {
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  transitionCodes: TransitionCardCodes;
};

function codeFor(kind: CardCodeKind, settings: CardCodeSettings): string {
  return kind.group === 'maintenance'
    ? normalizeCardCode(settings.sectionCodes?.[kind.key])
    : normalizeCardCode(settings.transitionCodes[kind.key]);
}

/** 顯示代號（代號＋列號＋HHMM）；這張卡不是整備／過渡卡回 null，缺代號或列號回 '----'（跟後端一樣不發單） */
export function cardDisplayCode(
  block: { taskType?: string; source?: string; plannedStartMinute: number; timelineRow?: number },
  settings: CardCodeSettings,
): string | null {
  const kind = cardCodeKind(block);
  if (!kind) return null;
  const code = codeFor(kind, settings);
  const row = Number(block.timelineRow);
  if (!isValidCardCode(code) || !Number.isInteger(row) || row < 1) return '----';
  return `${code}${formatRow(row)}${formatHhmm(block.plannedStartMinute)}`;
}

/** 這種卡的代號是否必填：入場／出場只在有整備任務時才會產生，暫停／停留一定會有 */
export function isTransitionCardCodeRequired(key: TransitionCardCodeKey, maintenanceSkipped: boolean): boolean {
  return key === 'hold' ? true : !maintenanceSkipped;
}

export type CardCodeIssue = { key?: TransitionCardCodeKey; code: string; message: string };

/**
 * 設定層的檢查（路線群組步驟即時顯示；發布前也跑一次）：
 * 格式、必填、不同用途共用同一個代號、跟正線路線代號相同。
 */
export function findCardCodeConfigIssues(args: {
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  sectionEnabled: Partial<Record<MaintenanceSectionCodeKey, boolean>>;
  transitionCodes: TransitionCardCodes;
  maintenanceSkipped: boolean;
  routeCodes: ReadonlyArray<string | null | undefined>;
}): CardCodeIssue[] {
  const issues: CardCodeIssue[] = [];
  const owners = new Map<string, string[]>();
  for (const key of TRANSITION_CARD_CODE_KEYS) {
    const code = normalizeCardCode(args.transitionCodes[key]);
    const label = TRANSITION_CARD_CODE_META[key].label;
    if (!code) {
      if (isTransitionCardCodeRequired(key, args.maintenanceSkipped)) {
        issues.push({ key, code, message: `請填寫「${label}」代號` });
      }
      continue;
    }
    const formatError = cardCodeFormatError(code);
    if (formatError) {
      issues.push({ key, code, message: `「${label}」代號${formatError}（1～2 個大寫英文字母）` });
      continue;
    }
    owners.set(code, [...(owners.get(code) ?? []), label]);
  }
  if (!args.maintenanceSkipped) {
    for (const key of Object.keys(SECTION_LABEL) as MaintenanceSectionCodeKey[]) {
      if (args.sectionEnabled[key] !== true) continue;
      const code = normalizeCardCode(args.sectionCodes?.[key]);
      if (isValidCardCode(code)) owners.set(code, [...(owners.get(code) ?? []), SECTION_LABEL[key]]);
    }
  }
  const transitionKeyByLabel = new Map(TRANSITION_CARD_CODE_KEYS.map((key) => [TRANSITION_CARD_CODE_META[key].label, key] as const));
  for (const [code, labels] of owners) {
    if (labels.length > 1) {
      const key = labels.map((label) => transitionKeyByLabel.get(label)).find(Boolean);
      issues.push({ key, code, message: `代號「${code}」同時用在 ${labels.join('、')}，不同用途不能共用` });
    }
  }
  const routeCodes = new Set(args.routeCodes.map(normalizeCardCode).filter(Boolean));
  for (const [code, labels] of owners) {
    if (!routeCodes.has(code)) continue;
    const key = labels.map((label) => transitionKeyByLabel.get(label)).find(Boolean);
    issues.push({ key, code, message: `「${labels.join('、')}」代號「${code}」與正線路線代號相同，班次代號會混淆` });
  }
  return issues;
}

export type CardCodeConflictEntry = {
  kind: string;
  blockId: string;
  timelineRow: number;
  plannedStartMinute: number;
};

export type CardCodeConflict = { code: string; entries: CardCodeConflictEntry[] };

/** 展開後的最終代號：同一份班表裡出現兩次以上就是衝突（不同日期允許重複，所以只看這一份） */
export function findCardCodeConflicts(
  entries: ReadonlyArray<CardCodeConflictEntry & { code: string }>,
): CardCodeConflict[] {
  const byCode = new Map<string, CardCodeConflictEntry[]>();
  for (const { code, ...entry } of entries) {
    if (!code || code === '----') continue;
    byCode.set(code, [...(byCode.get(code) ?? []), entry]);
  }
  return [...byCode.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([code, list]) => ({ code, entries: list }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function describeCardCodeConflict(conflict: CardCodeConflict): string {
  return `${conflict.code}：${conflict.entries
    .map((entry) => {
      const hhmm = formatHhmm(entry.plannedStartMinute);
      return `${entry.kind}（第 ${entry.timelineRow} 列 ${hhmm.slice(0, 2)}:${hhmm.slice(2)}）`;
    })
    .join('／')}`;
}
