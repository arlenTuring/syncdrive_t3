/**
 * 班表部署管理的初始值：讀到真資料前顯示空白，不放示範數字（2026-11-22：畫面曾一直顯示寫死的 92.3%、313 班、2027.05.01 降級事件）。
 */
import type {
  CurrentModeData,
  DataStatsData,
  ExecutingScheduleData,
  MajorEventData,
  ShiftRow,
} from './types';

export const FALLBACK_MODE: CurrentModeData = {
  modeLabel: '—',
  modeLevel: '',
};

export const FALLBACK_STATS: DataStatsData = {
  ontimePct: 0,
  achievementPct: 0,
  totalCount: 0,
  completedCount: 0,
  delayedCount: 0,
  abnormalCount: 0,
  cancelledCount: 0,
};

export const FALLBACK_SCHEDULE: ExecutingScheduleData = {
  scheduleMeta: '目前沒有使用中的班表',
  statusLabel: '',
  scheduleName: '—',
  reviewerName: '—',
  periods: [],
  pending: false,
};

/** 沒有重大事件時是 null（畫面只顯示「無重大事件」） */
export const FALLBACK_EVENT: MajorEventData | null = null;

export const FALLBACK_VEHICLES: string[] = [];

export const FALLBACK_MAINLINE: ShiftRow[] = [];

export const FALLBACK_MAINTENANCE: ShiftRow[] = [];
