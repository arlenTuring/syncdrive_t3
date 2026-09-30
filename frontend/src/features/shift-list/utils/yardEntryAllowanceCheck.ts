import type { MaintenanceEntrySlackSectionKey } from './resolveMaintenanceEntrySlackSeconds';
import { configuredYardWorkSeconds, minimumYardWorkSeconds } from './yardWorkMinimum';

/**
 * 「正線可壓縮整備開頭」（H）的即時檢查與模板建議（白皮書 YARD-02、YARD-04、YARD-06）
 * ======================================================================
 *
 * - 輸入 H 時（第 3 步），對照模板上這一類的每一段整備：H ≥ 整備長度 D 就是不合法——正線可以把整段
 *   整備吃光，違反「禁止零整備」。列出哪一段、多長、為什麼。
 * - 路線組合選好之後（第 4 步），超過 1 小時的整備改用「一輪時間」當開頭額度（長整備讓一輪），重算
 *   實際適用的額度；額度會吃掉作業時長的一併列出（引擎實際只會用到「整備長度 − 最低工作時間」）。
 * - 模板建議長度＝希望保留的工作時間 W（整備設定的作業時長）＋本段實際適用的開頭額度 E。
 *   整備間移動會佔用多少，要等路線與設施定案後由生成報告逐筆揭露，這裡不重複估算。
 * - 只顯示建議，不改模板。
 */

/** 整備設定區段 → 時間模板任務類型 */
export const TASK_TYPE_BY_SECTION: Record<MaintenanceEntrySlackSectionKey, string> = {
  charging: 'charging',
  carWash: 'washing',
  maintenance: 'servicing',
  preTrip: 'inspection',
  mobile: 'standby',
};

const SECTION_LABEL: Record<MaintenanceEntrySlackSectionKey, string> = {
  charging: '充電',
  carWash: '洗車',
  maintenance: '保養',
  preTrip: '行檢',
  mobile: '待命',
};

/** 與引擎 normalizeInput.ts 的長整備門檻同一個值（使用者 2026-08-18：「超過一小時可以讓渡一輪」） */
export const LONG_YARD_ROTATION_THRESHOLD_SECONDS = 3600;

export type YardAllowanceRow = {
  section: MaintenanceEntrySlackSectionKey;
  sectionLabel: string;
  taskId: string;
  rowIndex: number;
  label: string;
  startMinute: number;
  /** 模板上這一段的長度 D（秒） */
  durationSeconds: number;
  /** 手填 H（秒） */
  manualSeconds: number;
  /** 本段實際適用的額度 E（秒）：一般是 H；長整備且算得出一輪時改用一輪 */
  allowanceSeconds: number;
  allowanceKind: 'manual' | 'rotation';
  /** 整備設定的作業時長 W（秒）；沒有設定是 0 */
  configuredWorkSeconds: number;
  /** 模板建議長度 W＋E（秒）；沒有設定作業時長時為 null */
  suggestedSeconds: number | null;
  /**
   * invalid：手填 H ≥ D，輸入不合法（YARD-02）。
   * clamped：一輪額度會吃到最低工作時間以下，引擎實際只用到 D − 最低工作時間（YARD-04）。
   * short：模板比建議長度短，開頭被佔滿時會低於設定的作業時長（YARD-06，提醒）。
   * ok：沒問題。
   */
  status: 'invalid' | 'clamped' | 'short' | 'ok';
  message: string;
};

type TemplateTask = { id: string; rowIndex: number; taskType: string; label?: string; startMinute: number; durationMinutes: number };

function clock(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function minutesText(seconds: number): string {
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes} 分`;
}

export function checkYardEntryAllowance(args: {
  templateTasks: ReadonlyArray<TemplateTask>;
  /** 各區段手填 H（秒） */
  slackSecondsBySection: Record<MaintenanceEntrySlackSectionKey, number>;
  /** 啟用中的區段（沒啟用的不檢查） */
  sectionEnabled?: Partial<Record<MaintenanceEntrySlackSectionKey, boolean>>;
  maintenanceBody: Record<string, unknown> | null | undefined;
  /** 第 4 步鎖定路線組合的一輪時間（秒）；還沒選路線組合時為 null（只能初估） */
  lockedRotationSeconds: number | null;
}): YardAllowanceRow[] {
  const rows: YardAllowanceRow[] = [];
  for (const section of Object.keys(TASK_TYPE_BY_SECTION) as MaintenanceEntrySlackSectionKey[]) {
    if (args.sectionEnabled && args.sectionEnabled[section] === false) continue;
    const taskType = TASK_TYPE_BY_SECTION[section];
    const manual = Math.max(0, args.slackSecondsBySection[section] ?? 0);
    const configured = configuredYardWorkSeconds(taskType, args.maintenanceBody);
    const keep = minimumYardWorkSeconds(taskType, args.maintenanceBody);
    for (const task of args.templateTasks) {
      if (task.taskType !== taskType) continue;
      const duration = Math.round(task.durationMinutes * 60);
      if (duration <= 0) continue;
      const useRotation = args.lockedRotationSeconds != null
        && args.lockedRotationSeconds > 0
        && duration > LONG_YARD_ROTATION_THRESHOLD_SECONDS;
      const allowance = useRotation ? args.lockedRotationSeconds! : manual;
      const suggested = configured > 0 ? configured + allowance : null;
      const where = `時間線 ${task.rowIndex}「${task.label || SECTION_LABEL[section]}」${clock(task.startMinute)} 起 ${minutesText(duration)}`;
      let status: YardAllowanceRow['status'] = 'ok';
      let message = '';
      if (!useRotation && manual >= duration) {
        status = 'invalid';
        message = `${where}：正線可壓縮開頭 ${minutesText(manual)} 不小於整備長度，正線可能把整段整備吃光（整備不能歸零）。`
          + '請調小可壓縮時間，或回時間模板加長這段整備。';
      } else if (useRotation && allowance > duration - keep) {
        status = 'clamped';
        message = `${where}：超過 1 小時，開頭額度改用路線組合一輪 ${minutesText(allowance)}；`
          + `但整備要留下 ${minutesText(keep)} 工作時間，實際最多只會讓出 ${minutesText(Math.max(0, duration - keep))}。`;
      } else if (suggested != null && duration < suggested) {
        status = 'short';
        message = `${where}：開頭被佔滿時，工作時間會低於整備設定的作業時長 ${minutesText(configured)}。`
          + `建議模板至少 ${minutesText(suggested)}（作業時長 ${minutesText(configured)} ＋ `
          + `${useRotation ? '一輪額度' : '手填額度'} ${minutesText(allowance)}）。`;
      }
      rows.push({
        section,
        sectionLabel: SECTION_LABEL[section],
        taskId: task.id,
        rowIndex: task.rowIndex,
        label: task.label || SECTION_LABEL[section],
        startMinute: task.startMinute,
        durationSeconds: duration,
        manualSeconds: manual,
        allowanceSeconds: allowance,
        allowanceKind: useRotation ? 'rotation' : 'manual',
        configuredWorkSeconds: configured,
        suggestedSeconds: suggested,
        status,
        message,
      });
    }
  }
  return rows;
}
