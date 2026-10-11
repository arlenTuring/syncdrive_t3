/**
 * 整備卡與過渡卡的顯示代號：使用者設定的代號＋時間線列號（兩位數）＋計畫開始時刻 HHMM。
 * 例：第 2 列 10:30 充電（代號 E）→ E021030；第 10 列 21:35 入場（代號 IN）→ IN102135。
 *
 * 列號是必要的：好幾台車常在同一分鐘暫停或進出場（實測一份班表只用代號＋HHMM 就有 31 組重複），
 * 帶列號後同一份班表內才唯一。
 * ================================================
 *
 * 前端 frontend/src/features/shift-list/utils/cardCode.ts 是同一份規則，兩邊必須一致：
 * 班表預覽、時刻表 API、整備／移動訂單的 trip_code 都從這裡來。
 *
 * <h3>代號從哪裡來</h3>
 * <table>
 *   <tr><td>充電、洗車、保養、行檢、待命</td><td>整備任務步驟設定的整備代號（maintenanceSectionCodeBySection）</td></tr>
 *   <tr><td>入場移動（yard_entry_move）</td><td>路線群組的過渡卡代號 entry</td></tr>
 *   <tr><td>出場移動（yard_exit_move）</td><td>過渡卡代號 exit</td></tr>
 *   <tr><td>暫停／停留（idle：hold 暫停、transition 暫停放／提早進廠等待）</td><td>過渡卡代號 hold</td></tr>
 * </table>
 * 正線載客、進場載客照原本的路線代號規則，不在這裡。時間是班表確定的計畫開始時刻，
 * 不是建立時間、實際開始或現在；執行中延誤不改代號。
 *
 * <h3>新舊班表</h3>
 * 班表 body 有 transitionCardCodes 才用這套規則（cardCodeVersion 2）。舊班表照原本的代號
 * （MT-格位-R列-秒、MVIN／MVOUT-R列-秒），已執行的訂單與歷史不改主鍵；畫面標示待補設定。
 *
 * <h3>身份</h3>
 * 顯示代號每天都會重複（E021830 天天有），只在「同一營運日、同一份計畫」內唯一：訂單編號是
 * 協議的 YYMMDD-代號（重播是執行 ID-代號），每日計畫、班次中心、站點 ETA 都先限定營運日與
 * 計畫版本再用代號查；訂單 payload 另記 plan_block_id。所以同一份班表展開後不能有重複代號——
 * 重複就擋下發布／採用，不偷偷加列號、秒數或亂數。
 */

export type TransitionCardCodeKey = 'entry' | 'exit' | 'hold';
export type TransitionCardCodes = Record<TransitionCardCodeKey, string>;

export const TRANSITION_CARD_CODE_LABEL: Record<TransitionCardCodeKey, string> = {
  entry: '入場',
  exit: '出場',
  hold: '暫停／停留',
};

type SectionKey = 'charging' | 'carWash' | 'maintenance' | 'preTrip' | 'mobile';

const SECTION_KEY_BY_TASK_TYPE: Record<string, SectionKey> = {
  charging: 'charging',
  washing: 'carWash',
  servicing: 'maintenance',
  inspection: 'preTrip',
  standby: 'mobile',
};

const SECTION_LABEL: Record<SectionKey, string> = {
  charging: '充電',
  carWash: '洗車',
  maintenance: '保養',
  preTrip: '行檢',
  mobile: '待命',
};

export type CardCodeSettings = {
  /** 2＝代號＋列號＋HHMM；1＝舊班表（沒有過渡卡代號設定） */
  version: 1 | 2;
  sectionCodes: Record<SectionKey, string>;
  transitionCodes: TransitionCardCodes | null;
};

export type CardCodeKind =
  | { group: 'maintenance'; key: SectionKey; label: string }
  | { group: 'transition'; key: TransitionCardCodeKey; label: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 前後空白去掉、轉大寫；不偷偷刪掉數字或符號（那是錯誤，要讓使用者看到） */
export function normalizeCardCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

export function isValidCardCode(code: string): boolean {
  return /^[A-Z]{1,2}$/.test(code);
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

export function readCardCodeSettings(body: Record<string, unknown>): CardCodeSettings {
  const rawSections = asRecord(body.maintenanceSectionCodeBySection) ?? {};
  const sectionCodes = {
    charging: normalizeCardCode(rawSections.charging),
    carWash: normalizeCardCode(rawSections.carWash),
    maintenance: normalizeCardCode(rawSections.maintenance),
    preTrip: normalizeCardCode(rawSections.preTrip),
    mobile: normalizeCardCode(rawSections.mobile),
  };
  const rawTransition = asRecord(body.transitionCardCodes);
  if (!rawTransition) return { version: 1, sectionCodes, transitionCodes: null };
  return {
    version: 2,
    sectionCodes,
    transitionCodes: {
      entry: normalizeCardCode(rawTransition.entry),
      exit: normalizeCardCode(rawTransition.exit),
      hold: normalizeCardCode(rawTransition.hold),
    },
  };
}

/** 這張卡是哪一種整備／過渡卡；正線、進場載客、其他卡回 null */
export function cardCodeKind(block: { taskType?: unknown; source?: unknown }): CardCodeKind | null {
  const source = typeof block.source === 'string' ? block.source : '';
  const taskType = typeof block.taskType === 'string' ? block.taskType : '';
  if (source === 'yard_entry_move') return { group: 'transition', key: 'entry', label: TRANSITION_CARD_CODE_LABEL.entry };
  if (source === 'yard_exit_move') return { group: 'transition', key: 'exit', label: TRANSITION_CARD_CODE_LABEL.exit };
  if (taskType === 'idle' && (source === 'hold' || source === 'transition')) {
    return { group: 'transition', key: 'hold', label: TRANSITION_CARD_CODE_LABEL.hold };
  }
  const section = SECTION_KEY_BY_TASK_TYPE[taskType];
  if (section && source !== 'entry_service') return { group: 'maintenance', key: section, label: SECTION_LABEL[section] };
  return null;
}

/** 這張卡用的代號；舊班表、或該種卡沒設代號時回 null */
export function cardCodePrefix(kind: CardCodeKind, settings: CardCodeSettings): string | null {
  if (settings.version !== 2) return null;
  const code = kind.group === 'maintenance'
    ? settings.sectionCodes[kind.key]
    : settings.transitionCodes?.[kind.key] ?? '';
  return isValidCardCode(code) ? code : null;
}

/** 顯示代號（代號＋列號＋HHMM）；不是整備／過渡卡、舊班表、缺代號或缺列號時回 null */
export function cardDisplayCode(
  block: { taskType?: unknown; source?: unknown; plannedStartMinute?: unknown; timelineRow?: unknown },
  settings: CardCodeSettings,
): string | null {
  const kind = cardCodeKind(block);
  if (!kind) return null;
  const prefix = cardCodePrefix(kind, settings);
  const start = Number(block.plannedStartMinute);
  const row = Number(block.timelineRow);
  if (!prefix || !Number.isFinite(start) || !Number.isInteger(row) || row < 1) return null;
  return `${prefix}${formatRow(row)}${formatHhmm(start)}`;
}

export type CardCodeIssue = { code: string; message: string };

/**
 * 設定層的檢查：代號格式、不同用途撞同一個代號、跟正線路線代號撞號。
 * usedKinds：這份班表實際展開出哪幾種卡（沒有入場卡就不要求入場代號）。
 */
export function findCardCodeConfigIssues(args: {
  settings: CardCodeSettings;
  usedKinds: ReadonlyArray<CardCodeKind>;
  routeCodes: ReadonlyArray<string>;
}): CardCodeIssue[] {
  const { settings } = args;
  if (settings.version !== 2) return [];
  const issues: CardCodeIssue[] = [];
  const owners = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const kind of args.usedKinds) {
    const id = `${kind.group}:${kind.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const code = kind.group === 'maintenance' ? settings.sectionCodes[kind.key] : settings.transitionCodes?.[kind.key] ?? '';
    if (!code) {
      issues.push({ code: '', message: `「${kind.label}」卡有排入班表，但還沒設定代號` });
      continue;
    }
    if (!isValidCardCode(code)) {
      issues.push({ code, message: `「${kind.label}」代號「${code}」須為 1～2 個大寫英文字母` });
      continue;
    }
    owners.set(code, [...(owners.get(code) ?? []), kind.label]);
  }
  for (const [code, labels] of owners) {
    if (labels.length > 1) issues.push({ code, message: `代號「${code}」同時用在 ${labels.join('、')}，不同用途不能共用` });
  }
  const routeCodes = new Set(args.routeCodes.map(normalizeCardCode).filter(Boolean));
  for (const [code, labels] of owners) {
    if (routeCodes.has(code)) issues.push({ code, message: `「${labels.join('、')}」代號「${code}」與正線路線代號相同，班次代號會混淆` });
  }
  return issues;
}

export type CardCodeConflictEntry = {
  kind: string;
  blockId: string;
  timelineRow: number;
  plannedStartMinute: number;
  time: string;
};

export type CardCodeConflict = { code: string; entries: CardCodeConflictEntry[] };

/**
 * 展開後的最終代號檢查：整備／過渡卡的代號＋列號＋HHMM，連同正線班次代號（呼叫端給），
 * 同一份班表裡出現兩次以上就是衝突。不同日期允許重複，所以只看這一份。
 */
export function findCardCodeConflicts(entries: ReadonlyArray<CardCodeConflictEntry & { code: string }>): CardCodeConflict[] {
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

function planBlocks(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const timelines = asRecord(asRecord(body.scheduleOutput)?.plan)?.timelines;
  if (!Array.isArray(timelines)) return [];
  return timelines.flatMap((timeline) => {
    const blocks = asRecord(timeline)?.blocks;
    return Array.isArray(blocks) ? blocks.map(asRecord).filter((b): b is Record<string, unknown> => b != null) : [];
  });
}

export type CardCodeReport = {
  version: 1 | 2;
  configIssues: CardCodeIssue[];
  conflicts: CardCodeConflict[];
};

/**
 * 整份班表的代號檢查（發布、部署前呼叫）。
 * passengerCodes：正線班次（含進場載客）的最終代號，由時刻表展開提供。
 */
export function checkShiftCardCodes(
  body: Record<string, unknown>,
  passengerCodes: ReadonlyArray<CardCodeConflictEntry & { code: string }> = [],
): CardCodeReport {
  const settings = readCardCodeSettings(body);
  if (settings.version !== 2) return { version: 1, configIssues: [], conflicts: [] };
  const blocks = planBlocks(body);
  const usedKinds: CardCodeKind[] = [];
  const entries: Array<CardCodeConflictEntry & { code: string }> = [...passengerCodes];
  for (const block of blocks) {
    const kind = cardCodeKind(block);
    if (!kind) continue;
    usedKinds.push(kind);
    const code = cardDisplayCode(block, settings);
    const start = Number(block.plannedStartMinute);
    if (!code) continue;
    entries.push({
      code,
      kind: kind.label,
      blockId: typeof block.id === 'string' ? block.id : '',
      timelineRow: Number(block.timelineRow) || 0,
      plannedStartMinute: start,
      time: `${formatHhmm(start).slice(0, 2)}:${formatHhmm(start).slice(2)}`,
    });
  }
  const routes = Array.isArray(body.selectedRoutes) ? body.selectedRoutes : [];
  const routeCodes = routes
    .map((route) => asRecord(route)?.routeCode)
    .filter((code): code is string => typeof code === 'string');
  return {
    version: 2,
    configIssues: findCardCodeConfigIssues({ settings, usedKinds, routeCodes }),
    conflicts: findCardCodeConflicts(entries),
  };
}

/** 給錯誤訊息：E021830 充電（第 2 列 18:30）／充電（第 2 列 18:30） */
export function describeCardCodeConflict(conflict: CardCodeConflict): string {
  return `${conflict.code}：${conflict.entries
    .map((entry) => `${entry.kind}（第 ${entry.timelineRow} 列 ${entry.time}）`)
    .join('／')}`;
}
