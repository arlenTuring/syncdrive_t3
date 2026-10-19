import { useEffect, useState } from 'react';
import { Dialog, ErrorLine, GhostButton } from '../media-groups/dialogs';
import { DetailRow, JsonBlock } from '../event-log-shared/ui';
import { formatDateTime } from '../event-log-shared/time';
import { fetchLog, type LogCategory, type LogDetail } from './api';

const NAME_SOURCE: Record<string, string> = { snapshot: '操作當時名稱', current: '目前名稱（沒有當時快照）', unknown: '未知', system: '系統身分' };

/** 日誌詳情（已脫敏；唯讀） */
export function LogDetailDialog({ category, id, timeZone, onClose }: { category: LogCategory; id: string; timeZone: string; onClose: () => void }) {
  const [log, setLog] = useState<LogDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchLog(category, id, controller.signal).then(setLog, (reason: Error) => !controller.signal.aborted && setError(reason.message));
    return () => controller.abort();
  }, [category, id]);

  return (
    <Dialog title="日誌詳情" width="max-w-3xl" onClose={onClose} footer={<GhostButton onClick={onClose}>關閉</GhostButton>}>
      {error ? (
        <ErrorLine text={`載入失敗：${error}`} />
      ) : !log ? (
        <p className="py-10 text-center text-zinc-500">載入中…</p>
      ) : (
        <div className="space-y-5">
          <dl>
            <DetailRow label="日誌編號">{log.id}</DetailRow>
            <DetailRow label="時間">{formatDateTime(log.occurredAt, timeZone)}</DetailRow>
            <DetailRow label="來源 IP">{log.sourceIp ?? '—'}</DetailRow>
            <DetailRow label="日誌類型">{log.typeLabel}（{log.type}）</DetailRow>
            <DetailRow label={category === 'authentication' ? '帳號' : '操作者'}>
              {log.operator.name ?? '未知'}
              <span className="ml-2 text-xs text-zinc-500">{log.operator.id}・{NAME_SOURCE[log.operator.nameSource]}</span>
            </DetailRow>
            {log.target ? (
              <DetailRow label={category === 'permissions' ? '被異動對象' : '目標'}>
                {log.target.typeLabel}「{log.target.name ?? log.target.id ?? '—'}」
                <span className="ml-2 text-xs text-zinc-500">{log.target.id}・{NAME_SOURCE[log.target.nameSource]}</span>
              </DetailRow>
            ) : null}
            <DetailRow label="內容">{log.content}</DetailRow>
            <DetailRow label="結果">{log.resultLabel}</DetailRow>
            {log.failureReason ? <DetailRow label="失敗原因">{log.failureReason}</DetailRow> : null}
            {log.correlationId ? <DetailRow label="追蹤 ID">{log.correlationId}</DetailRow> : null}
            {log.targetVehicle ? <DetailRow label="載具">{log.targetVehicle}</DetailRow> : null}
            {log.userAgent ? <DetailRow label="裝置資訊">{log.userAgent}</DetailRow> : null}
          </dl>

          {category === 'permissions' && log.changes ? (
            <section>
              <h3 className="mb-2 text-sm font-medium">異動前後差異</h3>
              {log.changes.length ? (
                <ul className="space-y-2 text-sm">
                  {log.changes.map((change) => (
                    <li key={change.field} className="rounded-lg bg-[#232730] p-3">
                      <div className="text-xs text-zinc-400">{change.field}</div>
                      {change.added || change.removed ? (
                        <>
                          {change.added?.map((item) => <div key={`a${item.id}`} className="text-emerald-300">＋ {item.label} <span className="text-xs text-zinc-500">{item.id}</span></div>)}
                          {change.removed?.map((item) => <div key={`r${item.id}`} className="text-red-300">－ {item.label} <span className="text-xs text-zinc-500">{item.id}</span></div>)}
                          {!change.added?.length && !change.removed?.length ? <div className="text-zinc-500">沒有變化</div> : null}
                        </>
                      ) : (
                        <div className="text-zinc-200">
                          {change.before === null || change.before === undefined ? '（無）' : JSON.stringify(change.before)} → {change.after === null || change.after === undefined ? '（無）' : JSON.stringify(change.after)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-500">沒有記錄差異內容</p>
              )}
            </section>
          ) : null}
          {(category === 'system' || category === 'operations') && log.detail !== undefined ? (
            <section>
              <h3 className="mb-2 text-sm font-medium">異動摘要（已遮蔽敏感欄位）</h3>
              <JsonBlock value={log.detail} />
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
