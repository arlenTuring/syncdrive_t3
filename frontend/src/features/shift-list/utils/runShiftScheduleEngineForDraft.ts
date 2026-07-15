import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { resolveStrictestTurnaroundLimitSeconds } from '../../time-templates/utils/turnaroundLimitSegments';
import type { ShiftScheduleCreateDraft } from '../types/create';
import {
  generateShiftSchedule,
  type GenerateShiftScheduleResult,
} from './shiftScheduleEngine';

export type RunShiftScheduleEngineOptions = {
  shiftId?: string;
  backendUrl?: string;
};

/**
 * 依班表草稿拉取時間模板／整備任務 body，執行排班引擎。
 * 不寫入 DB；呼叫端自行決定是否將結果存入班表 body。
 */
export async function runShiftScheduleEngineForDraft(
  draft: ShiftScheduleCreateDraft,
  options: RunShiftScheduleEngineOptions = {},
): Promise<GenerateShiftScheduleResult> {
  const { shiftId, backendUrl } = options;

  if (!draft.timeTemplate.templateId.trim()) {
    return {
      plan: null,
      report: {
        ok: false,
        errors: [
          {
            code: 'MISSING_TEMPLATE_TASKS',
            severity: 'error',
            message: '尚未選擇時間模板',
          },
        ],
        warnings: [],
      },
    };
  }

  const templateDetail = await fetchTimeTemplateDetail(
    draft.timeTemplate.templateId,
    backendUrl,
  );

  const templateBody = templateDetail.body ?? {};
  const parsed = parseStoredTemplateBody(templateBody);
  const turnaroundLimitSeconds = resolveStrictestTurnaroundLimitSeconds(
    parsed.tasks,
    parsed.intervals,
    parsed.attributes,
  );

  let maintenanceTaskBody: Record<string, unknown> | null = null;
  if (!draft.maintenanceTask.skipped && draft.maintenanceTask.taskId.trim()) {
    const maintenanceDetail = await fetchMaintenanceTaskDetail(
      draft.maintenanceTask.taskId,
      backendUrl,
    );
    maintenanceTaskBody = maintenanceDetail.body ?? {};
  }

  return generateShiftSchedule({
    shiftId,
    draft,
    templateBody,
    maintenanceTaskBody,
    turnaroundLimitSeconds,
    passengerTimetableMode: 'template',
  });
}
