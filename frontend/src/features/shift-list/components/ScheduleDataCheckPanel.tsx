import { Loader2 } from 'lucide-react';
import type { ScheduleDataCheckState } from '../hooks/useScheduleDataCheck';
import { Button } from '../../../components/ui';

/**
 * 路線群組的必要資料檢查結果（白皮書 MAP-02～04）；狀態由 useScheduleDataCheck 提供。
 *
 * 分兩段顯示，同一次檢查、同一支檢查函式（scheduleInputDataCheck.ts）的結果依 scope 分開：
 * 1. 地圖本身（選圖當下就看得到）：路網拓樸、路段、路段端點。
 * 2. 本次選取（路線、整備、模板選好之後）：路線站點在路網上、整備設施在路網上、本次必要行駛時間。
 */
type Props = ScheduleDataCheckState & {
  /** 放在第 4 步「檢查報告」裡：不加外框，改用左側色條列出 */
  embedded?: boolean;
};

export function ScheduleDataCheckPanel({ running, error, record, recheck, embedded = false }: Props) {
  const mapIssues = record?.issues.filter((issue) => issue.scope === 'map') ?? [];
  const selectionIssues = record?.issues.filter((issue) => issue.scope !== 'map') ?? [];
  const tone = running || (!record && !error)
    ? 'border-border-quaternary bg-surface-primary text-text-secondary'
    : error || !record?.ok
      ? 'border-border-danger-light bg-status-error-light text-status-error-emphasis'
      : 'border-status-success-light bg-status-success-light text-status-success';
  const stage = (title: string, issues: Array<{ message: string }>, pending?: string) => (
    <div className="mt-1.5">
      <span className="font-medium">{title}：</span>
      {pending ? (
        <span className="text-text-tertiary">{pending}</span>
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
  if (embedded) {
    const ok = !running && !error && record?.ok;
    const bar = running || (!record && !error) ? 'border-border-primary' : ok ? 'border-status-success' : 'border-status-error';
    const stageLine = (title: string, issues: Array<{ message: string }>, pending?: string) => (
      <li className={`border-l-2 pl-3 ${pending ? 'border-border-primary' : issues.length === 0 ? 'border-status-success' : 'border-status-error'}`}>
        <span className="text-text-primary">{title}</span>
        <span className={`ml-2 ${pending ? 'text-text-tertiary' : issues.length === 0 ? 'text-text-secondary' : 'text-status-error-emphasis'}`}>
          {pending ?? (issues.length === 0 ? '通過' : `${issues.length} 項要補齊`)}
        </span>
        {!pending && issues.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-body-xs text-status-error-emphasis">
            {issues.map((issue, index) => <li key={index}>{issue.message}</li>)}
          </ul>
        ) : null}
      </li>
    );
    return (
      <div className="text-body-s">
        <div className={`flex flex-wrap items-center gap-2 border-l-2 pl-3 ${bar}`}>
          <span className="text-text-primary">地圖與必要資料</span>
          {running ? (
            <span className="inline-flex items-center gap-1 text-text-tertiary"><Loader2 className="size-3 animate-spin" />檢查中…</span>
          ) : error ? (
            <span className="text-status-error-emphasis">檢查沒有完成：{error}</span>
          ) : !record ? (
            <span className="text-text-tertiary">尚未檢查</span>
          ) : record.ok ? (
            <span className="text-text-secondary">通過（地圖「{record.mapId}」，{new Date(record.checkedAt).toLocaleString()} 檢查）</span>
          ) : (
            <span className="text-status-error-emphasis">未通過，補好之前不能往下一步</span>
          )}
          <Button hierarchy="subordinate" variant="outlined" className="ml-auto" disabled={running} onPress={recheck}>重新檢查</Button>
        </div>
        {!running && record ? (
          <ul className="mt-2 space-y-2 pl-4">
            {stageLine('地圖本身', mapIssues)}
            {stageLine('本次選取的路線與整備', selectionIssues, mapIssues.length > 0 ? '地圖本身通過後才檢查' : undefined)}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`rounded-md border px-3 py-2 text-body-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">地圖與必要資料檢查</span>
        {running ? (
          <span className="inline-flex items-center gap-1 text-text-tertiary">
            <Loader2 className="size-3 animate-spin" />
            檢查中…
          </span>
        ) : error ? (
          <span>檢查沒有完成：{error}</span>
        ) : !record ? (
          <span className="text-text-tertiary">尚未檢查</span>
        ) : record.ok ? (
          <span>通過（地圖「{record.mapId}」，{new Date(record.checkedAt).toLocaleString()} 檢查）</span>
        ) : (
          <span>未通過，補好之前不能往下一步</span>
        )}
        <Button hierarchy="subordinate" variant="outlined" className="ml-auto" disabled={running} onPress={recheck}>重新檢查</Button>
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
        <p className="mt-1 text-status-success">
          生成時會再確認用的仍是這一版資料；之後在地圖編輯、整備任務或時間模板改了東西，請按「重新檢查」。
        </p>
      ) : null}
    </div>
  );
}
