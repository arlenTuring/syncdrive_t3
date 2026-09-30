import { useEffect, useMemo, useState } from 'react';
import { fetchMaintenanceTaskDetail } from '../../maintenance-tasks/api/maintenanceTasksApi';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import type { ShiftScheduleMaintenanceTaskDraft } from '../types/create';
import {
  normalizeMaintenanceEntrySlackBySectionInput,
  parseMaintenanceEntrySlackSeconds,
  type MaintenanceEntrySlackSectionKey,
} from '../utils/resolveMaintenanceEntrySlackSeconds';
import { checkYardEntryAllowance, type YardAllowanceRow } from '../utils/yardEntryAllowanceCheck';

type Props = {
  templateId: string;
  maintenance: ShiftScheduleMaintenanceTaskDraft;
  /** 路線組合的一輪時間（秒）；第 3 步還沒選路線組合時是 null，只能初估 */
  lockedRotationSeconds: number | null;
  /** 有幾段「手填額度 ≥ 整備長度」（不合法、要擋下一步） */
  onBlockingCountChange?: (count: number) => void;
};

/**
 * 「正線可壓縮整備開頭」對照時間模板的即時檢查（白皮書 YARD-02、YARD-04、YARD-06）。
 *
 * 第 3 步：手填額度一改就對照模板上的每一段整備，≥ 整備長度就列為不合法並擋下一步。
 * 第 4 步：路線組合選好後，超過 1 小時的整備改用一輪額度重算，並更新模板建議長度。
 * 只顯示、不改模板。
 */
export function YardEntryAllowancePanel({ templateId, maintenance, lockedRotationSeconds, onBlockingCountChange }: Props) {
  // 載入結果連同它對應的 id 一起存：id 換了舊結果自動作廢，不必在 effect 裡同步清空
  const [templateLoad, setTemplateLoad] = useState<{ id: string; tasks: ReturnType<typeof parseStoredTemplateBody>['tasks'] } | null>(null);
  const [maintenanceLoad, setMaintenanceLoad] = useState<{ id: string; body: Record<string, unknown> } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const maintenanceId = maintenance.skipped ? '' : maintenance.taskId.trim();
  const templateTasks = useMemo(
    () => (templateLoad && templateLoad.id === templateId ? templateLoad.tasks : []),
    [templateLoad, templateId],
  );
  const maintenanceBody = maintenanceLoad && maintenanceLoad.id === maintenanceId ? maintenanceLoad.body : null;

  useEffect(() => {
    if (!templateId.trim()) return undefined;
    let cancelled = false;
    void fetchTimeTemplateDetail(templateId)
      .then((detail) => {
        if (!cancelled) setTemplateLoad({ id: templateId, tasks: parseStoredTemplateBody(detail.body ?? {}).tasks ?? [] });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [templateId]);

  useEffect(() => {
    if (!maintenanceId) return undefined;
    let cancelled = false;
    void fetchMaintenanceTaskDetail(maintenanceId)
      .then((detail) => {
        if (!cancelled) setMaintenanceLoad({ id: maintenanceId, body: detail.body ?? {} });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [maintenanceId]);

  const rows: YardAllowanceRow[] = useMemo(() => {
    if (maintenance.skipped || !maintenance.taskId) return [];
    const input = normalizeMaintenanceEntrySlackBySectionInput(maintenance.entrySlackBySection);
    const slackSecondsBySection = Object.fromEntries(
      (Object.keys(input) as MaintenanceEntrySlackSectionKey[]).map((key) => [key, parseMaintenanceEntrySlackSeconds(input[key])]),
    ) as Record<MaintenanceEntrySlackSectionKey, number>;
    return checkYardEntryAllowance({
      templateTasks,
      slackSecondsBySection,
      sectionEnabled: maintenance.sectionEnabled,
      maintenanceBody,
      lockedRotationSeconds,
    });
  }, [templateTasks, maintenance, maintenanceBody, lockedRotationSeconds]);

  const invalid = rows.filter((row) => row.status === 'invalid');
  const notes = rows.filter((row) => row.status === 'clamped' || row.status === 'short');

  useEffect(() => {
    onBlockingCountChange?.(invalid.length);
  }, [invalid.length, onBlockingCountChange]);

  if (!templateId.trim()) {
    return (
      <p className="text-xs text-zinc-500">還沒選時間模板，無法對照整備長度（請先完成第 2 步）。</p>
    );
  }
  if (loadError) {
    return <p className="text-xs text-amber-300">無法載入時間模板或整備任務來對照：{loadError}</p>;
  }
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed">
      <p className="text-zinc-400">
        對照時間模板上的整備長度
        {lockedRotationSeconds == null
          ? '（初估：路線組合還沒選，超過 1 小時的整備選好路線組合後會改用一輪額度重算）'
          : `（已依路線組合一輪 ${Math.round(lockedRotationSeconds / 6) / 10} 分重算超過 1 小時的整備）`}
      </p>
      {invalid.length > 0 ? (
        <ul className="space-y-1 text-red-300">
          {invalid.map((row) => <li key={`${row.section}-${row.taskId}`}>• {row.message}</li>)}
        </ul>
      ) : (
        <p className="text-emerald-300/90">沒有整備會被正線開頭額度吃光。</p>
      )}
      {notes.length > 0 ? (
        <ul className="space-y-1 text-amber-200/90">
          {notes.map((row) => <li key={`${row.section}-${row.taskId}-note`}>• {row.message}</li>)}
        </ul>
      ) : null}
      <p className="text-zinc-500">建議只供參考，不會自動修改時間模板。整備之間的移動會佔用多少，生成後在報告逐筆列出。</p>
    </div>
  );
}
