import type { SlotGridWidget as SlotGridType, SlotStatusColorRule } from '../types';
import { useWidgetData } from './useWidgetData';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  MOCK_SLOT_PREVIEW,
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

interface Props {
  widget: SlotGridType;
}

function resolveSlotColors(
  status: string,
  widget: SlotGridType,
): { bg: string; text: string } {
  const rules = widget.statusColorRules;
  if (rules?.length) {
    const hit = rules.find(r => r.status === status);
    if (hit) {
      return {
        bg: hit.bgColor,
        text: hit.textColor ?? widget.defaultSlotTextColor ?? '#0f172a',
      };
    }
    return {
      bg: widget.inactiveColor,
      text: widget.defaultSlotTextColor ?? '#64748b',
    };
  }
  const isActive = widget.activeValues.includes(status);
  return {
    bg: isActive ? widget.activeColor : widget.inactiveColor,
    text: isActive ? '#0f172a' : 'rgba(255,255,255,0.3)',
  };
}

export const MAINTENANCE_SLOT_STATUS_RULES: SlotStatusColorRule[] = [
  { status: 'AVAILABLE', bgColor: '#334155', textColor: '#64748b' },
  { status: 'OCCUPIED', bgColor: '#94a3b8', textColor: '#0f172a' },
  { status: 'CHARGING', bgColor: '#94a3b8', textColor: '#0f172a' },
  { status: 'ERROR', bgColor: '#ef4444', textColor: '#ffffff' },
  { status: 'OFFLINE', bgColor: '#334155', textColor: '#64748b' },
];

export function SlotGridWidget({ widget }: Props) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const sqlData = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    refreshInterval: widget.refreshInterval,
  });

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, sqlData.data.length > 0);
  const items = isEditPreview
    ? MOCK_SLOT_PREVIEW.map((m, idx) => ({
        [widget.nameField]: m.label,
        [widget.statusField]: m.status,
        __idx: idx,
      }))
    : sqlData.data;
  const isCompactRow = widget.variant === 'compact-row';
  const hideTitle = widget.hideTitle ?? isCompactRow;
  const gap = widget.slotGap ?? (isCompactRow ? 4 : 6);
  const titleFs = widget.titleFontSize ?? 11;
  const slotFs = widget.slotFontSize ?? (isCompactRow ? 10 : 13);
  const emptyFs = widget.emptyHintFontSize ?? 10;

  return (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'slot-grid', title: widget.title })}
    >
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        borderRadius: isCompactRow ? 0 : 4,
        padding: isCompactRow ? 0 : 8,
        boxSizing: 'border-box',
        ...(isEditPreview ? { opacity: 0.88 } : {}),
      }}
    >
      {!hideTitle && (
        <div
          style={{
            fontSize: titleFs,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.4)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#06b6d4' }} />
          {widget.title}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexWrap: widget.layout === 'grid' ? 'wrap' : 'nowrap',
          alignItems: 'stretch',
          overflowX: widget.layout === 'horizontal' && !isCompactRow ? 'auto' : 'hidden',
          gap,
        }}
      >
        {items.map((item, idx) => {
          const label = String(item[widget.nameField] ?? (isCompactRow ? '0' : `格位 ${idx + 1}`));
          const status = String(item[widget.statusField] ?? 'AVAILABLE');
          const { bg, text } = resolveSlotColors(status, widget);

          return (
            <div
              key={`${status}-${idx}-${label}`}
              style={{
                flex: isCompactRow ? '1 1 0' : undefined,
                minWidth: isCompactRow ? 12 : widget.slotWidth,
                width: isCompactRow ? undefined : widget.slotWidth,
                height: isCompactRow ? '100%' : widget.slotHeight,
                flexShrink: isCompactRow ? 1 : 0,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: slotFs,
                fontWeight: isCompactRow ? 500 : 700,
                fontFamily: isCompactRow
                  ? 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif'
                  : 'monospace',
                background: bg,
                color: text,
                border: status === 'AVAILABLE' && !widget.statusColorRules?.length
                  ? '1px solid rgba(255,255,255,0.05)'
                  : 'none',
                transition: 'background 0.25s ease, color 0.25s ease',
                userSelect: 'none',
              }}
            >
              {label}
            </div>
          );
        })}

        {items.length === 0 && !sqlData.loading && !isEditPreview && (
          <div style={{ fontSize: emptyFs, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic', alignSelf: 'center' }}>
            {sqlData.error ? '資料載入失敗' : '等待格位資料…'}
          </div>
        )}
      </div>
    </div>
    </WidgetEditPreviewOutline>
  );
}
