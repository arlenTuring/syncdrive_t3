import { cn } from '../../components/ui';
import type { Badge } from './status';

/** 名稱膠囊前的狀態點：綠＝播放中或有錄影、紅＝離線或錯誤、藍＝連線中、灰＝停用或此時段沒有錄影 */
const DOT_TONE: Record<Badge['tone'], string> = {
  green: 'bg-status-success',
  red: 'bg-status-error',
  amber: 'bg-status-warning',
  sky: 'bg-status-info',
  zinc: 'bg-status-inactive',
};

/**
 * 浮在影像左上角的「● 代號｜名稱」膠囊（設計稿 2026-11-20；即時影像與歷史影像共用）。
 * 狀態文字只給滑鼠提示與螢幕閱讀器，不另外顯示。
 */
export function SourcePill({ code, label, tone, statusText }: { code: string | null; label: string; tone: Badge['tone']; statusText: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-full bg-black-50 px-3 py-1 text-body-m text-text-primary" title={statusText}>
      <span className={cn('size-2 shrink-0 rounded-full', DOT_TONE[tone])} aria-hidden />
      <span className="sr-only">{statusText}</span>
      {code ? (
        <>
          <span className="shrink-0">{code}</span>
          <span className="h-3.5 w-px shrink-0 bg-border-secondary" aria-hidden />
        </>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
