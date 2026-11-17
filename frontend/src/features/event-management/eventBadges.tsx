import { Badge, type BadgeTone } from '../../components/ui';
import { SEVERITY_LABEL } from './eventSeverity';

/** 即時事件清單與事件類型管理共用的標籤：系統 Badge，等級對照到狀態語意 */

const SEVERITY_TONE: Record<string, BadgeTone> = {
  CRITICAL: 'error',
  WARNING: 'warning',
  INFO: 'neutral',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity] ?? 'neutral'} className="min-w-[3.5rem] justify-center">
      {SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  );
}

export function ReportStatusBadge({ reported }: { reported: boolean }) {
  return reported ? <Badge tone="neutral">已回報</Badge> : <Badge tone="theme">尚未回報</Badge>;
}
