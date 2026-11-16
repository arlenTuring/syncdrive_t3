import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import type {
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
} from './schedule-engine/types';

export const MANUAL_BLOCK_DEFAULT_DURATION_MINUTES = 10;
/** 手動拖曳／縮放對齊格（秒） */
export const MANUAL_BLOCK_SNAP_SECONDS = 10;
/** 手動班次最短長度（秒） */
export const MANUAL_BLOCK_MIN_DURATION_SECONDS = 10;

export function createEmptyManualSchedulePlan(args: {
  scheduleRowCount: number;
  shiftId?: string;
}): GeneratedSchedulePlan {
  const rowCount = Math.max(1, Math.floor(args.scheduleRowCount) || 1);
  return {
    shiftId: args.shiftId,
    generatedAt: new Date().toISOString(),
    scheduleRowCount: rowCount,
    timelines: Array.from({ length: rowCount }, (_, index) => ({
      row: index + 1,
      blocks: [],
    })),
    // 手動製作沒有時刻表班距脈衝：應開服務就是使用者自己畫的班次
    servicePulses: [],
  };
}

export function emptyManualFeasibilityReport(): ShiftScheduleFeasibilityReport {
  return { ok: true, errors: [], warnings: [] };
}

export async function resolveManualScheduleRowCount(
  templateId: string,
  backendUrl?: string,
): Promise<number> {
  const templateDetail = await fetchTimeTemplateDetail(templateId, backendUrl);
  const template = parseStoredTemplateBody(templateDetail.body ?? {});
  return Math.max(1, template.scheduleRowCount || 1);
}
