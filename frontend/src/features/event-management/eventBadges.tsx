import { SEVERITY_LABEL } from './eventSeverity';

/** 即時事件清單與事件類型管理共用的標籤（依設計稿：深色底、淺色字） */

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: 'bg-[#4a1f25] text-[#f6d9dc]',
  WARNING: 'bg-[#4a3f14] text-[#f6e7b4]',
  INFO: 'bg-[#383b42] text-zinc-100',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex min-w-[3.5rem] justify-center rounded-md px-2.5 py-0.5 text-xs font-medium ${SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.INFO}`}>
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

export function ReportStatusBadge({ reported }: { reported: boolean }) {
  return reported
    ? <span className="inline-flex rounded-md bg-[#2e3138] px-2.5 py-0.5 text-xs font-medium text-zinc-100">已回報</span>
    : <span className="inline-flex rounded-md bg-[#173a52] px-2.5 py-0.5 text-xs font-medium text-[#e3f1fb]">尚未回報</span>;
}
