import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { VehicleAlertBannerWidget } from '../types';
import { useVariables } from '../VariableContext';

export function VehicleAlertBannerWidgetView({ widget }: { widget: VehicleAlertBannerWidget }) {
  const variables = useVariables();
  const msg = String(variables[widget.messageVarKey ?? 'alert_message'] ?? '').trim();
  if (!msg) {
    return <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />;
  }

  const overall = String(variables[widget.severityVarKey ?? 'overall_health'] ?? 'WARNING').toUpperCase();
  const isError = overall === 'ERROR';
  const bg = isError ? 'rgba(185,28,28,0.55)' : 'rgba(194,65,12,0.55)';
  const border = isError ? 'rgba(248,113,113,0.5)' : 'rgba(251,146,60,0.45)';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '0 8px',
        boxSizing: 'border-box',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        backdropFilter: 'blur(2px)',
        pointerEvents: 'none',
        zIndex: widget.zIndex ?? 15,
      }}
    >
      {isError ? (
        <AlertTriangle size={14} color="#fef2f2" strokeWidth={2.5} style={{ flexShrink: 0 }} />
      ) : (
        <AlertCircle size={14} color="#fff7ed" strokeWidth={2.5} style={{ flexShrink: 0 }} />
      )}
      <span
        style={{
          fontSize: widget.fontSize ?? 10,
          fontWeight: 700,
          color: '#fafafa',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          letterSpacing: 0.02,
        }}
      >
        {msg}
      </span>
    </div>
  );
}
