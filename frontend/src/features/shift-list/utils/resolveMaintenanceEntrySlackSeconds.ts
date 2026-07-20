import type { TaskTypeKey } from '../../time-templates/types/editor';

/** 正線優先整備讓渡餘裕／空時段正線讓渡餘裕預設（秒） */
export const DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS = 600;
export const DEFAULT_EMPTY_INTERVAL_MAINLINE_SLACK_SECONDS =
  DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS;

/** 班表 Step 2 各整備區塊的正線優先讓渡餘裕（字串秒數，表單用） */
export type MaintenanceEntrySlackBySectionInput = {
  charging: string;
  carWash: string;
  maintenance: string;
  preTrip: string;
  mobile: string;
};

/** 引擎用：各整備區塊讓渡餘裕（秒） */
export type MaintenanceEntrySlackBySection = {
  charging: number;
  carWash: number;
  maintenance: number;
  preTrip: number;
  mobile: number;
};

export type MaintenanceEntrySlackSectionKey = keyof MaintenanceEntrySlackBySection;

export function normalizeMaintenanceEntrySlackSecondsInput(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return String(Math.round(raw));
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return String(Math.round(parsed));
  }
  return String(DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS);
}

export function parseMaintenanceEntrySlackSeconds(raw: unknown): number {
  return Number(normalizeMaintenanceEntrySlackSecondsInput(raw));
}

export function emptyMaintenanceEntrySlackBySectionInput(): MaintenanceEntrySlackBySectionInput {
  const value = String(DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS);
  return {
    charging: value,
    carWash: value,
    maintenance: value,
    preTrip: value,
    mobile: value,
  };
}

export function normalizeMaintenanceEntrySlackBySectionInput(
  raw: Partial<MaintenanceEntrySlackBySectionInput> | null | undefined,
): MaintenanceEntrySlackBySectionInput {
  const base = emptyMaintenanceEntrySlackBySectionInput();
  if (!raw || typeof raw !== 'object') return base;
  return {
    charging: normalizeMaintenanceEntrySlackSecondsInput(raw.charging ?? base.charging),
    carWash: normalizeMaintenanceEntrySlackSecondsInput(raw.carWash ?? base.carWash),
    maintenance: normalizeMaintenanceEntrySlackSecondsInput(
      raw.maintenance ?? base.maintenance,
    ),
    preTrip: normalizeMaintenanceEntrySlackSecondsInput(raw.preTrip ?? base.preTrip),
    mobile: normalizeMaintenanceEntrySlackSecondsInput(raw.mobile ?? base.mobile),
  };
}

export function parseMaintenanceEntrySlackBySection(
  raw: Partial<MaintenanceEntrySlackBySectionInput> | null | undefined,
): MaintenanceEntrySlackBySection {
  const normalized = normalizeMaintenanceEntrySlackBySectionInput(raw);
  return {
    charging: Number(normalized.charging),
    carWash: Number(normalized.carWash),
    maintenance: Number(normalized.maintenance),
    preTrip: Number(normalized.preTrip),
    mobile: Number(normalized.mobile),
  };
}

export function buildMaintenanceEntrySlackFingerprint(
  input: MaintenanceEntrySlackBySectionInput,
): string {
  const n = normalizeMaintenanceEntrySlackBySectionInput(input);
  return [
    `charging:${n.charging}`,
    `carWash:${n.carWash}`,
    `maintenance:${n.maintenance}`,
    `preTrip:${n.preTrip}`,
    `mobile:${n.mobile}`,
  ].join('|');
}

/**
 * 依時間模板非正線 taskType，讀取班表草稿各整備區塊的正線優先讓渡餘裕（秒）。
 * 同一數值同時約束「正線壓縮整備開頭」與「為下個正線視窗壓縮整備尾端」。
 * 缺省 → 600。
 */
export function resolveMaintenanceEntrySlackSeconds(
  taskType: TaskTypeKey,
  slackBySection: MaintenanceEntrySlackBySection | null | undefined,
): number {
  const slack =
    slackBySection
    ?? parseMaintenanceEntrySlackBySection(emptyMaintenanceEntrySlackBySectionInput());

  if (taskType === 'charging') return slack.charging;
  if (taskType === 'inspection') return slack.preTrip;
  if (taskType === 'standby') return slack.mobile;
  if (taskType === 'servicing') {
    return Math.max(slack.carWash, slack.maintenance);
  }

  return DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS;
}

export function normalizeEmptyIntervalMainlineSlackSecondsInput(raw: unknown): string {
  return normalizeMaintenanceEntrySlackSecondsInput(raw);
}

export function parseEmptyIntervalMainlineSlackSeconds(raw: unknown): number {
  return parseMaintenanceEntrySlackSeconds(raw);
}
