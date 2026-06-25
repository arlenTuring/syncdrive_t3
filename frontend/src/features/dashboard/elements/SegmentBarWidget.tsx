import { useMemo } from 'react';
import { BarChart2 } from 'lucide-react';
import type { SegmentBarColorRule, SegmentBarWidget as SegmentBarType } from '../types';
import { useWidgetData } from './useWidgetData';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  MOCK_SEGMENT_PREVIEW,
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

/** @deprecated 請在元件 colorRules 或範例平面設定 */
export const DEFAULT_VEHICLE_SEGMENT_RULES: SegmentBarColorRule[] = [];

const FONT_UI = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

export function resolveSegmentRule(
  status: string,
  rules: SegmentBarColorRule[],
): SegmentBarColorRule {
  return rules.find(r => r.status === status)
    ?? { status, label: status, color: '#64748b' };
}

export function SegmentBarWidgetView({ widget }: { widget: SegmentBarType }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const { data, loading } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    refreshInterval: widget.refreshInterval,
  });

  const rules = widget.colorRules ?? [];
  const countUnit = widget.countUnit ?? '輛';

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, data.length > 0);

  const segments = useMemo(() => {
    const rows = isEditPreview
      ? MOCK_SEGMENT_PREVIEW.map(m => ({
          [widget.statusField]: m.status,
          [widget.pctField]: m.pct,
          [widget.countField]: m.count,
        }))
      : data;
    return rows.map(row => {
      const status = String(row[widget.statusField] ?? '');
      const rule = resolveSegmentRule(status, rules);
      const pct = Math.max(0, Number(row[widget.pctField]) || 0);
      const count = Math.max(0, Number(row[widget.countField]) || 0);
      return { status, rule, pct, count };
    });
  }, [data, isEditPreview, widget.statusField, widget.pctField, widget.countField, rules]);

  const showLegend = widget.showLegend !== false;
  const title = widget.title ?? '';
  const titleFs = widget.titleFontSize ?? 16;
  const legendFs = widget.legendFontSize ?? 14;
  const barFs = widget.barTextFontSize ?? 14;
  const tagFs = widget.tagFontSize ?? 14;
  const emptyFs = widget.emptyHintFontSize ?? 14;

  return (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'segment-bar', title })}
    >
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
        boxSizing: 'border-box',
        fontFamily: FONT_UI,
        ...(isEditPreview ? { opacity: 0.88 } : {}),
      }}
    >
      {/* 標題 + 圖例 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 24,
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            minWidth: 0,
            color: '#F3F4F6',
            fontSize: titleFs,
            fontWeight: 500,
            lineHeight: '20px',
          }}
        >
          {widget.titleIconImage ? (
            <img
              src={widget.titleIconImage}
              alt=""
              style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }}
            />
          ) : (
            <BarChart2 size={24} strokeWidth={2} color="#D1D5DC" />
          )}
          {title}
        </div>
        {showLegend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {rules.map(rule => (
              <div
                key={rule.status}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: legendFs,
                  fontWeight: 400,
                  lineHeight: '18px',
                  letterSpacing: '0.5px',
                  color: '#D1D5DC',
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 12,
                    borderRadius: 4,
                    background: rule.color,
                    flexShrink: 0,
                  }}
                />
                {rule.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分段色條 + 標籤 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 4,
          height: 45,
          flexShrink: 0,
        }}
      >
        {segments.length === 0 && !loading && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: emptyFs,
              color: '#64748b',
            }}
          >
            尚無資料
          </div>
        )}
        {segments.map((seg, idx) => {
          const flexGrow = Math.max(seg.pct, 0.1);
          const isMiddle = segments.length === 3 && idx === 1;
          return (
            <div
              key={seg.status}
              style={{
                flex: isMiddle ? `${flexGrow} 1 0` : `${flexGrow} 0 0`,
                minWidth: seg.pct < 10 ? 52 : 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: 20,
                  borderRadius: 4,
                  background: seg.rule.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 8px',
                  boxSizing: 'border-box',
                  color: '#030712',
                  fontSize: barFs,
                  lineHeight: '18px',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontWeight: 500 }}>{seg.pct.toFixed(1)}%</span>
                <span style={{ fontWeight: 400 }}>{' | '}{seg.count}{countUnit}</span>
              </div>
              <span
                style={{
                  fontSize: tagFs,
                  fontWeight: 500,
                  lineHeight: '18px',
                  letterSpacing: '0.5px',
                  color: seg.rule.color,
                  border: `1px solid ${seg.rule.color}`,
                  borderRadius: 6,
                  padding: '0 4px 1px',
                  backdropFilter: 'blur(2px)',
                  background: 'transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                {seg.rule.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
    </WidgetEditPreviewOutline>
  );
}
