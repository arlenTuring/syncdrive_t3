import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  /** report：第 3 步底部的「檢查報告」（設計稿外觀）；sections 為各整備任務是否填好 */
  appearance?: 'default' | 'report';
  sections?: Array<{ label: string; filled: boolean }>;
  /** report：報告開頭另外列出的檢查（第 4 步的地圖與必要資料檢查）；extraOk=false 時橫幅不顯示通過 */
  extra?: ReactNode;
  extraOk?: boolean;
  /** report：沒有選整備任務時只列 extra */
  skipAllowance?: boolean;
};

function clockText(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function minutesText(seconds: number): string {
  return `${Math.round((seconds / 60) * 10) / 10} 分`;
}

const STATUS_NOTE: Record<YardAllowanceRow['status'], string> = {
  invalid: '正線可壓縮開頭不小於整備長度，整備可能被吃光',
  clamped: '超過 1 小時改用一輪額度，實際讓出的時間會被限制',
  short: '時間模板設定與整備任務不合，導致作業時間不足',
  ok: '',
};

/** 第 3 步底部的檢查報告（依設計稿）：通過與否、各任務是否填好、需要注意的整備段 */
function AllowanceReport({
  rows,
  sections,
  lockedRotationSeconds,
  message,
  extra,
  extraOk = true,
}: {
  rows: YardAllowanceRow[];
  sections: Array<{ label: string; filled: boolean }>;
  lockedRotationSeconds: number | null;
  message?: string;
  extra?: ReactNode;
  extraOk?: boolean;
}) {
  const invalid = rows.filter((row) => row.status === 'invalid');
  const flagged = rows.filter((row) => row.status !== 'ok');
  const passed = invalid.length === 0 && !message && extraOk;
  return (
    <section className="rounded-xl border-t-2 border-emerald-500 bg-[#232329] px-5 py-5" aria-label="檢查報告">
      <h3 className="flex items-center gap-2 text-base font-medium text-zinc-100">
        <ClipboardCheck className="size-5 text-zinc-300" aria-hidden />
        檢查報告
      </h3>
      {message ? (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">{message}</p>
      ) : passed ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/15 px-4 py-2.5 text-sm text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          檢查通過！沒有整備會被正線開頭額度吃光
        </p>
      ) : invalid.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/15 px-4 py-2.5 text-sm text-red-300">
          <XCircle className="size-4 shrink-0" aria-hidden />
          還有項目沒通過，請依下方說明補齊
        </p>
      ) : (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/15 px-4 py-2.5 text-sm text-red-300">
          <XCircle className="size-4 shrink-0" aria-hidden />
          有 {invalid.length} 段整備會被正線開頭額度吃光，請調小可壓縮時間或回時間模板加長整備
        </p>
      )}
      {extra ? <div className="mt-4">{extra}</div> : null}
      {sections.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {sections.map((section) => (
            <li key={section.label} className={`border-l-2 pl-3 text-sm ${section.filled ? 'border-emerald-500' : 'border-amber-400'}`}>
              <span className="text-zinc-100">{section.label}</span>
              <span className={`ml-2 ${section.filled ? 'text-zinc-300' : 'text-amber-300'}`}>{section.filled ? '已填入' : '未填入'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {flagged.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="text-zinc-400">
              <tr className="border-b border-zinc-700/70">
                <th className="px-3 py-2.5 font-normal">時間線</th>
                <th className="px-3 py-2.5 font-normal">項目</th>
                <th className="px-3 py-2.5 font-normal">起算時間</th>
                <th className="px-3 py-2.5 font-normal">目前作業時長</th>
                <th className="px-3 py-2.5 font-normal">建議作業時長</th>
                <th className="px-3 py-2.5 font-normal">說明</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((row) => (
                <tr key={`${row.section}-${row.taskId}`} className="border-b border-zinc-800/80" title={row.message}>
                  <td className="whitespace-nowrap px-3 py-3 text-zinc-200">時間線 {row.rowIndex}</td>
                  <td className="px-3 py-3"><span className="rounded-md bg-zinc-700/70 px-2 py-0.5 text-zinc-100">{row.label || row.sectionLabel}</span></td>
                  <td className="px-3 py-3 tabular-nums text-zinc-200">{clockText(row.startMinute)}</td>
                  <td className="px-3 py-3 tabular-nums text-zinc-200">{minutesText(row.durationSeconds)}</td>
                  <td className="px-3 py-3 tabular-nums text-amber-400">{row.suggestedSeconds != null ? minutesText(row.suggestedSeconds) : '—'}</td>
                  <td className={`px-3 py-3 ${row.status === 'invalid' ? 'text-red-300' : 'text-zinc-200'}`}>{STATUS_NOTE[row.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-zinc-500">
        ※ 僅供參考，系統不自動修改模板。整備移動所佔用的時間，會在生成報告中逐筆列出
        {lockedRotationSeconds == null ? '。超過 1 小時的整備，選好路線組合後會改用一輪額度重算' : ''}
      </p>
    </section>
  );
}

/**
 * 「正線可壓縮整備開頭」對照時間模板的即時檢查（白皮書 YARD-02、YARD-04、YARD-06）。
 *
 * 第 3 步：手填額度一改就對照模板上的每一段整備，≥ 整備長度就列為不合法並擋下一步。
 * 第 4 步：路線組合選好後，超過 1 小時的整備改用一輪額度重算，並更新模板建議長度。
 * 只顯示、不改模板。
 */
export function YardEntryAllowancePanel({ templateId, maintenance, lockedRotationSeconds, onBlockingCountChange, appearance = 'default', sections = [], extra, extraOk, skipAllowance = false }: Props) {
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

  if (appearance === 'report') {
    if (skipAllowance) {
      return <AllowanceReport rows={[]} sections={sections} lockedRotationSeconds={lockedRotationSeconds} extra={extra} extraOk={extraOk} />;
    }
    const message = !templateId.trim()
      ? '還沒選時間模板，無法對照整備長度（請先完成第 2 步）。'
      : loadError
        ? `無法載入時間模板或整備任務來對照：${loadError}`
        : undefined;
    return <AllowanceReport rows={rows} sections={sections} lockedRotationSeconds={lockedRotationSeconds} message={message} extra={extra} extraOk={extraOk} />;
  }

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
