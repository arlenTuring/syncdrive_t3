import type { ScheduleEngineTaskType } from '../../time-templates/types/editor';

/**
 * 班表 Step 2 各整備區塊代號（1–2 個大寫英文字母；無預設）。
 *
 * 五種整備任務各一個代號——入廠／出廠小卡的代號不是分開存，是這個代號
 * 自動加上 I（入廠）／O（出廠）尾綴組成，例：保養代號 M → 入廠 MI、出廠 MO。
 * 見 {@link resolveMoveCardPrefix}。
 */
export type MaintenanceSectionCodeBySection = {
  charging: string;
  carWash: string;
  maintenance: string;
  preTrip: string;
  mobile: string;
};

export type MaintenanceSectionCodeKey = keyof MaintenanceSectionCodeBySection;

export function emptyMaintenanceSectionCodeBySection(): MaintenanceSectionCodeBySection {
  return {
    charging: '',
    carWash: '',
    maintenance: '',
    preTrip: '',
    mobile: '',
  };
}

/** 僅保留大寫英文字母，最多 2 字元 */
export function sanitizeMaintenanceSectionCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
}

export function normalizeMaintenanceSectionCodeInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return sanitizeMaintenanceSectionCodeInput(raw);
}

export function normalizeMaintenanceSectionCodeBySection(
  raw: Partial<MaintenanceSectionCodeBySection> | null | undefined,
): MaintenanceSectionCodeBySection {
  const base = emptyMaintenanceSectionCodeBySection();
  if (!raw || typeof raw !== 'object') return base;
  return {
    charging: normalizeMaintenanceSectionCodeInput(raw.charging ?? base.charging),
    carWash: normalizeMaintenanceSectionCodeInput(raw.carWash ?? base.carWash),
    maintenance: normalizeMaintenanceSectionCodeInput(raw.maintenance ?? base.maintenance),
    preTrip: normalizeMaintenanceSectionCodeInput(raw.preTrip ?? base.preTrip),
    mobile: normalizeMaintenanceSectionCodeInput(raw.mobile ?? base.mobile),
  };
}

export function isValidMaintenanceSectionCode(code: string): boolean {
  return /^[A-Z]{1,2}$/.test(code);
}

/**
 * 檢查已啟用區塊的代號是否皆有效且互不重複。
 * 回傳空陣列表示通過。
 */
export function findMaintenanceSectionCodeIssues(
  codes: MaintenanceSectionCodeBySection,
  enabled: Partial<Record<MaintenanceSectionCodeKey, boolean>>,
): Array<{ key: MaintenanceSectionCodeKey; message: string }> {
  const issues: Array<{ key: MaintenanceSectionCodeKey; message: string }> = [];
  const seen = new Map<string, MaintenanceSectionCodeKey>();
  const keys = Object.keys(codes) as MaintenanceSectionCodeKey[];

  for (const key of keys) {
    if (enabled[key] === false) continue;
    if (enabled[key] !== true) continue;
    const code = codes[key];
    if (!isValidMaintenanceSectionCode(code)) {
      issues.push({
        key,
        message: '請填寫 1–2 個大寫英文字母的整備代號',
      });
      continue;
    }
    const prior = seen.get(code);
    if (prior) {
      issues.push({
        key,
        message: `整備代號「${code}」與其他區塊重複`,
      });
    } else {
      seen.set(code, key);
    }
  }

  return issues;
}

/** 有啟用區塊時，每個啟用區塊都必須有合法且互不重複的代號 */
export function isMaintenanceSectionCodesComplete(
  codes: MaintenanceSectionCodeBySection,
  enabled: Partial<Record<MaintenanceSectionCodeKey, boolean>>,
): boolean {
  const enabledKeys = (Object.keys(codes) as MaintenanceSectionCodeKey[]).filter(
    (key) => enabled[key] === true,
  );
  if (enabledKeys.length === 0) return true;
  return findMaintenanceSectionCodeIssues(codes, enabled).length === 0;
}

export function buildMaintenanceSectionCodeFingerprint(
  codes: MaintenanceSectionCodeBySection,
): string {
  const n = normalizeMaintenanceSectionCodeBySection(codes);
  return [
    `charging:${n.charging}`,
    `carWash:${n.carWash}`,
    `maintenance:${n.maintenance}`,
    `preTrip:${n.preTrip}`,
    `mobile:${n.mobile}`,
  ].join('|');
}

/**
 * 依時間模板 taskType 取整備區塊代號。
 * 洗車有自己的 taskType（washing），不再與保養共用一個視窗。
 */
export function resolveMaintenanceSectionCodeForTaskType(
  taskType: ScheduleEngineTaskType,
  codes: MaintenanceSectionCodeBySection | null | undefined,
): string | null {
  if (!codes) return null;
  const n = normalizeMaintenanceSectionCodeBySection(codes);
  if (taskType === 'charging') return n.charging || null;
  if (taskType === 'inspection') return n.preTrip || null;
  if (taskType === 'standby') return n.mobile || null;
  if (taskType === 'servicing') return n.maintenance || null;
  if (taskType === 'washing') return n.carWash || null;
  return null;
}

/**
 * 依時間模板 taskType 取整備類型的中文名——只給 UI 顯示用（例如轉場卡 hover
 * 標題），不是使用者可自訂的代號。跟 {@link resolveMaintenanceSectionCodeForTaskType}
 * 查同一組 taskType 分支，但回傳固定中文名而不是使用者設定的字母代號。
 */
export function resolveMaintenanceSectionLabelForTaskType(
  taskType: ScheduleEngineTaskType,
): string | null {
  if (taskType === 'charging') return '充電';
  if (taskType === 'inspection') return '行檢';
  if (taskType === 'standby') return '待命';
  if (taskType === 'servicing') return '保養';
  if (taskType === 'washing') return '洗車';
  return null;
}

/**
 * 整備轉場小卡方向 → 代號尾綴。
 * 入廠 I、出廠 O；跟來源那個區塊自己的代號組合成卡面／班次代號前綴，
 * 例：保養（M）入廠 → MI、洗車（W）出廠 → WO、行檢（P）入廠 → PI。
 */
export const MOVE_CARD_DIRECTION_BY_SOURCE: Record<string, 'I' | 'O'> = {
  yard_entry_move: 'I',
  yard_exit_move: 'O',
};

/**
 * 這個 source 是不是轉場小卡（入廠／出廠，整備或調度皆算）——
 * UI 判斷「這是不是那種只印兩個字母、完整資訊在 hover 的窄卡」用這個，
 * 不是查一個叫 moveCardTag 的固定 MO／MI／PI／PO 欄位（那個概念已經拿掉）。
 */
export function isMoveCardBlockSource(source: string | undefined): boolean {
  return !!source && source in MOVE_CARD_DIRECTION_BY_SOURCE;
}

/**
 * 移動小卡的代號前綴（不含列碼與時刻）。
 * <code>block.yardExitSectionCode</code> 是插卡當下就算好、寫進區塊的
 * 來源代號（哪個整備類型的代號，不含方向尾綴）——不是移動小卡回傳 null。
 */
export function resolveMoveCardPrefix(block: {
  source?: string;
  yardExitSectionCode?: string;
}): string | null {
  const direction = block.source ? MOVE_CARD_DIRECTION_BY_SOURCE[block.source] : undefined;
  if (!direction) return null;
  const base = block.yardExitSectionCode?.trim().toUpperCase();
  if (!base) return null;
  return `${base}${direction}`;
}

/**
 * 時間線列碼：第 1 列車 → A、第 2 → B、第 3 → C…
 * 超過 Z 後採 AA、AB…（Excel 欄位風格）。
 */
export function timelineRowToColumnCode(rowIndex: number): string {
  if (!Number.isFinite(rowIndex) || rowIndex < 1) return '?';
  let n = Math.floor(rowIndex);
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out || '?';
}

/**
 * 班次代號用的開始時刻 HHMM。
 * 以「時鐘分鐘」為準：01:09:40 → 0109（不用 round，否則會進位成 0110）。
 */
export function formatMinuteToHmCompact(minute: number): string {
  const total = Math.max(0, Math.floor(minute));
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}

/**
 * 班次代號：
 * - 整備：前綴代號 + 列碼(A/B/C…) + 開始時刻 HHMM（例 MC1330）
 * - 正線：路線代號 + 開始時刻 HHMM（不含列碼；例 D1330）
 * 前綴缺失時回傳 `----`（手動製作尚未選路線等）。
 */
export function buildScheduleBlockTripCode(args: {
  prefixCode: string | null | undefined;
  timelineRow: number;
  startMinute: number;
  /** 預設 true（整備）；正線傳 false */
  includeColumnCode?: boolean;
}): string {
  const prefix = args.prefixCode?.trim().toUpperCase() ?? '';
  if (!prefix) return '----';
  const time = formatMinuteToHmCompact(args.startMinute);
  if (args.includeColumnCode === false) {
    return `${prefix}${time}`;
  }
  return `${prefix}${timelineRowToColumnCode(args.timelineRow)}${time}`;
}

/** 與班次卡顯示相同的代號（含進場載客／調度／整備） */
export function resolveGeneratedBlockTripCode(
  block: {
    source?: string;
    taskType: ScheduleEngineTaskType | string;
    routeCode?: string;
    routeId?: string;
    entryServiceSectionCode?: string;
    yardExitSectionCode?: string;
    timelineRow: number;
    plannedStartMinute: number;
  },
  index = 0,
  sectionCodes?: MaintenanceSectionCodeBySection | null,
): string {
  // 移動小卡共用一套規則：該段整備自己的區段代號 + I/O 尾綴
  // （充電 E → EI／EO、行檢 P → PI／PO、待命 S → SI／SO）。
  // 沒有固定的 MI／MO 這種東西——代號跟著任務類型走。
  // 帶列碼，跟整備卡一致——它們屬於某一台車的場內動作，不是路線班次。
  // 必須排在 dispatch／passenger 分支之前，它們的 taskType 也是 'dispatch'。
  if (block.source && block.source in MOVE_CARD_DIRECTION_BY_SOURCE) {
    return buildScheduleBlockTripCode({
      prefixCode: resolveMoveCardPrefix(block),
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
    });
  }

  if (block.source === 'entry_service') {
    return buildScheduleBlockTripCode({
      prefixCode: `${block.entryServiceSectionCode ?? ''}${block.routeCode ?? ''}`,
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
      includeColumnCode: false,
    });
  }

  if (block.taskType === 'passenger') {
    // 調度班次：整備出場站 ≠ 首班首站時，代號前加整備代號前綴（如 ATN1706）
    if (block.yardDispatchPrefix) {
      return buildScheduleBlockTripCode({
        prefixCode: block.yardDispatchPrefix,
        timelineRow: block.timelineRow,
        startMinute: block.plannedStartMinute,
        includeColumnCode: false,
      });
    }
    return buildScheduleBlockTripCode({
      prefixCode: block.routeCode,
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
      includeColumnCode: false,
    });
  }

  if (block.taskType === 'dispatch' || block.source === 'dispatch') {
    return buildScheduleBlockTripCode({
      prefixCode: 'D',
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
    });
  }

  if (block.taskType !== 'idle' && block.source !== 'transition') {
    const sectionCode = resolveMaintenanceSectionCodeForTaskType(
      block.taskType as ScheduleEngineTaskType,
      sectionCodes,
    );
    return buildScheduleBlockTripCode({
      prefixCode: sectionCode,
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
    });
  }

  if (block.routeId) {
    const compact = block.routeId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (compact.length >= 4) return compact.slice(0, 5);
  }
  return `T${String(index + 1).padStart(4, '0')}`;
}
