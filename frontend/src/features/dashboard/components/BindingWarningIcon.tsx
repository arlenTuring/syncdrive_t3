import { AlertTriangle } from 'lucide-react';
import type { BindingIssue } from '../template/bindingHealth';

const REASON_LABEL: Record<string, string> = {
  missing_data_source: '缺少資料來源',
  missing_mqtt_source: '缺少 MQTT 來源',
  sql_without_source: '未綁定資料來源',
  connection_failed: '無法連線',
  config_mismatch: '設定不符',
};

export function BindingWarningIcon({
  issue,
  size = 16,
  style,
}: {
  issue: BindingIssue | undefined;
  size?: number;
  style?: React.CSSProperties;
}) {
  if (!issue) return null;

  const title = [
    issue.refLabel,
    ...issue.reasons.map(r => REASON_LABEL[r] ?? r),
    issue.detail,
  ].filter(Boolean).join('\n');

  return (
    <span
      title={title}
      style={{
        position: 'absolute',
        top: 4,
        left: 4,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 6,
        height: size + 6,
        borderRadius: '50%',
        background: 'rgba(234,179,8,0.95)',
        color: '#422006',
        boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
        cursor: 'help',
        ...style,
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <AlertTriangle size={size} strokeWidth={2.5} />
    </span>
  );
}
