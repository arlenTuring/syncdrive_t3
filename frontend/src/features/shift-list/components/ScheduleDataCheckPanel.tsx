import { Loader2 } from 'lucide-react';
import type { ScheduleDataCheckState } from '../hooks/useScheduleDataCheck';

/**
 * 路線群組的必要資料檢查結果（白皮書 MAP-02～04）；狀態由 useScheduleDataCheck 提供。
 *
 * 分兩段顯示，同一次檢查、同一支檢查函式（scheduleInputDataCheck.ts）的結果依 scope 分開：
 * 1. 地圖本身（選圖當下就看得到）：路網拓樸、路段、路段端點。
 * 2. 本次選取（路線、整備、模板選好之後）：路線站點在路網上、整備設施在路網上、本次必要行駛時間。
 */
type Props = ScheduleDataCheckState;

export function ScheduleDataCheckPanel({ running, error, record, recheck }: Props) {
  const mapIssues = record?.issues.filter((issue) => issue.scope === 'map') ?? [];
  const selectionIssues = record?.issues.filter((issue) => issue.scope !== 'map') ?? [];
  const tone = running || (!record && !error)
    ? 'border-zinc-700/80 bg-zinc-900/40 text-zinc-300'
    : error || !record?.ok
      ? 'border-red-500/50 bg-red-500/10 text-red-200'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  const stage = (title: string, issues: Array<{ message: string }>, pending?: string) => (
    <div className="mt-1.5">
      <span className="font-medium">{title}：</span>
      {pending ? (
        <span className="text-zinc-400">{pending}</span>
      ) : issues.length === 0 ? (
        <span>通過</span>
      ) : (
        <>
          <span>{issues.length} 項要補齊</span>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
            {issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">地圖與必要資料檢查</span>
        {running ? (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Loader2 className="size-3 animate-spin" />
            檢查中…
          </span>
        ) : error ? (
          <span>檢查沒有完成：{error}</span>
        ) : !record ? (
          <span className="text-zinc-400">尚未檢查</span>
        ) : record.ok ? (
          <span>通過（地圖「{record.mapId}」，{new Date(record.checkedAt).toLocaleString()} 檢查）</span>
        ) : (
          <span>未通過，補好之前不能往下一步</span>
        )}
        <button
          type="button"
          className="ml-auto rounded border border-zinc-600/70 px-2 py-0.5 text-zinc-300 hover:border-zinc-400 disabled:opacity-50"
          disabled={running}
          onClick={recheck}
        >
          重新檢查
        </button>
      </div>
      {!running && record ? (
        <>
          {stage('1. 地圖本身', mapIssues)}
          {stage(
            '2. 本次選取的路線與整備',
            selectionIssues,
            mapIssues.length > 0 ? '地圖本身通過後才檢查' : undefined,
          )}
        </>
      ) : null}
      {!running && record?.ok ? (
        <p className="mt-1 text-emerald-300/80">
          生成時會再確認用的仍是這一版資料；之後在地圖編輯、整備任務或時間模板改了東西，請按「重新檢查」。
        </p>
      ) : null}
    </div>
  );
}
