import type { EmptyStateWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useIsEditMode, shouldShowEditPreview } from '../utils/widgetEditPreview';

const FONT_UI = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

export function EmptyStateWidgetView({ widget }: { widget: EmptyStateWidget }) {
  const isEditMode = useIsEditMode();
  const { data, loading } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
  });

  const hasBinding = !!(widget.dataSourceId && widget.sqlQuery?.trim()) || !!widget.dataUrl?.trim();
  const mode = widget.visibilityMode ?? 'when-empty';
  const hasRows = data.length > 0;
  const showWhenEmpty =
    mode === 'when-empty' && hasBinding && !loading && !hasRows;
  const showWhenHasData = mode === 'when-has-data' && hasBinding && !loading && hasRows;
  const forceEditVisible = isEditMode && (
    !hasBinding
    || shouldShowEditPreview(isEditMode, hasBinding, hasRows)
    || (hasBinding && !showWhenEmpty && !showWhenHasData)
  );
  const visible = forceEditVisible || !hasBinding || showWhenEmpty || showWhenHasData;

  if (!visible) return null;

  const editGhost = isEditMode && hasBinding && hasRows && mode === 'when-empty';

  const isMinimalCenter = widget.emptyStateVariant === 'minimal-center';
  const radius = widget.borderRadius ?? (isMinimalCenter ? 0 : 8);
  const labelFs = widget.labelFontSize ?? (isMinimalCenter ? 14 : 14);
  const markFs = widget.markFontSize ?? (isMinimalCenter ? 24 : 22);
  const subFs = widget.subLabelFontSize ?? 10;

  const ghostStyle = editGhost ? { opacity: 0.45, outline: '1px dashed rgba(168,85,247,0.4)' } : {};

  if (isMinimalCenter) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          boxSizing: 'border-box',
          background: 'transparent',
          fontFamily: FONT_UI,
          pointerEvents: 'none',
          ...ghostStyle,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '2px solid rgba(148,163,184,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: markFs,
            color: '#94a3b8',
            lineHeight: 1,
          }}
          aria-hidden
        >
          ◡
        </div>
        <div style={{ fontSize: labelFs, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em' }}>
          {widget.label}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        margin: '0 auto',
        borderRadius: radius,
        border: '1px dashed rgba(100,116,139,0.45)',
        background: 'rgba(15,23,42,0.55)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        boxSizing: 'border-box',
        fontFamily: FONT_UI,
        ...ghostStyle,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '2px solid rgba(148,163,184,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: markFs,
          color: '#94a3b8',
          lineHeight: 1,
        }}
        aria-hidden
      >
        ◡
      </div>
      <div style={{ fontSize: labelFs, fontWeight: 600, color: '#94a3b8' }}>{widget.label}</div>
      {widget.subLabel && (
        <div style={{ fontSize: subFs, color: '#64748b', textAlign: 'center', padding: '0 12px' }}>
          {widget.subLabel}
        </div>
      )}
    </div>
  );
}
