import { AlertTriangle } from 'lucide-react';
import type { LayoutIssue } from '../utils/collision';

const REASON_LABEL: Record<string, string> = {
  out_of_bounds: '超出範本邊界',
  widget_overlap: '與其他元件重疊',
  canvas_overlap: '畫布重疊',
  canvas_out_of_bounds: '畫布超出平面',
};

export function layoutIssueTitle(issue: LayoutIssue): string {
  return [
    issue.refLabel,
    ...issue.reasons.map(r => REASON_LABEL[r] ?? r),
    issue.detail,
    issue.peerLabel ? `↔ ${issue.peerLabel}` : '',
  ].filter(Boolean).join('\n');
}

export function LayoutValidationIcon({
  issue,
  size = 16,
  style,
}: {
  issue: LayoutIssue | undefined;
  size?: number;
  style?: React.CSSProperties;
}) {
  if (!issue) return null;

  return (
    <span
      title={layoutIssueTitle(issue)}
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        zIndex: 301,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 6,
        height: size + 6,
        borderRadius: '50%',
        background: 'rgba(239,68,68,0.95)',
        color: '#fff',
        boxShadow: '0 0 0 2px rgba(0,0,0,0.5)',
        pointerEvents: 'auto',
        cursor: 'help',
        ...style,
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <AlertTriangle size={size} strokeWidth={2.5} fill="#fff" color="#dc2626" />
    </span>
  );
}
