import React, { useMemo } from 'react';
import type { BarChartWidget } from '../types';
import { BarChart2 } from 'lucide-react';
import { useWidgetData } from './useWidgetData';
import { ChartEditSkeleton, WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

function SvgBarChart({ data, xField, yFields, colors, orientation, showValues, barPadding, width, height }: {
  data: Record<string, unknown>[];
  xField: string;
  yFields: string[];
  colors: string[];
  orientation: 'vertical' | 'horizontal';
  showValues: boolean;
  barPadding: number;
  width: number;
  height: number;
}) {
  const pad = { top: 20, right: 16, bottom: orientation === 'vertical' ? 36 : 16, left: orientation === 'vertical' ? 40 : 80 };
  const cw = width  - pad.left - pad.right;
  const ch = height - pad.top  - pad.bottom;

  const allY = useMemo(() =>
    yFields.flatMap(f => data.map(d => Number(d[f]) || 0)), [data, yFields]);
  const maxY = Math.max(...(allY.length ? allY : [1]), 0);
  const minY = Math.min(0, ...allY);
  const yRange = maxY - minY || 1;

  const groupW = orientation === 'vertical'
    ? cw / (data.length || 1)
    : ch / (data.length || 1);
  const barW = groupW * (1 - barPadding) / (yFields.length || 1);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => minY + r * yRange);

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <g transform={`translate(${pad.left},${pad.top})`}>
        {/* Grid + Y axis */}
        {orientation === 'vertical' && yTicks.map((v, i) => {
          const y = ch - ((v - minY) / yRange) * ch;
          return (
            <g key={i}>
              <line x1={0} x2={cw} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={-5} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace">
                {v % 1 === 0 ? v : v.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Axis lines */}
        <line x1={0} x2={cw} y1={ch} y2={ch} stroke="rgba(255,255,255,0.12)" />
        <line x1={0} x2={0}  y1={0}  y2={ch} stroke="rgba(255,255,255,0.12)" />

        {/* Bars */}
        {data.map((d, di) => {
          const xLabel = String(d[xField] ?? di).slice(0, 12);

          if (orientation === 'vertical') {
            const groupX = di * groupW + groupW * barPadding / 2;
            const xCenter = groupX + barW * yFields.length / 2;
            return (
              <g key={di}>
                {yFields.map((f, fi) => {
                  const val = Number(d[f]) || 0;
                  const barH = Math.abs(((val - minY) / yRange) * ch);
                  const barY = ch - ((Math.max(val, minY) - minY) / yRange) * ch;
                  const color = colors[fi] || '#06b6d4';
                  const bx = groupX + fi * barW;
                  return (
                    <g key={f}>
                      <rect x={bx} y={barY} width={Math.max(1, barW - 1)} height={barH}
                            fill={color} fillOpacity={0.85} rx={2} />
                      {showValues && (
                        <text x={bx + barW / 2} y={barY - 3} textAnchor="middle"
                              fill={color} fontSize={8} fontFamily="monospace">
                          {val}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={xCenter} y={ch + 14} textAnchor="middle"
                      fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="monospace">
                  {xLabel}
                </text>
              </g>
            );
          } else {
            // Horizontal
            const groupY = di * groupW + groupW * barPadding / 2;
            return (
              <g key={di}>
                {yFields.map((f, fi) => {
                  const val = Number(d[f]) || 0;
                  const barLen = ((val - minY) / yRange) * cw;
                  const color = colors[fi] || '#06b6d4';
                  const by = groupY + fi * barW;
                  return (
                    <g key={f}>
                      <rect x={0} y={by} width={Math.max(0, barLen)} height={Math.max(1, barW - 1)}
                            fill={color} fillOpacity={0.85} rx={2} />
                      {showValues && (
                        <text x={barLen + 4} y={by + barW / 2 + 3}
                              fill={color} fontSize={8} fontFamily="monospace">
                          {val}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={-6} y={groupY + barW * yFields.length / 2 + 4} textAnchor="end"
                      fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="monospace">
                  {xLabel}
                </text>
              </g>
            );
          }
        })}

        {/* Legend */}
        {yFields.map((f, fi) => (
          <g key={f} transform={`translate(${fi * 80}, -12)`}>
            <rect x={0} y={-6} width={10} height={10} fill={colors[fi] || '#06b6d4'} rx={2} />
            <text x={14} y={4} fill={colors[fi] || '#06b6d4'} fontSize={9} fontFamily="monospace">{f}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function BarChartWidgetView({ widget }: { widget: BarChartWidget }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const { data, loading, error } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
  });
  const hasSource = !!(widget.dataSourceId || widget.dataUrl);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, data.length > 0);
  const previewLabel = resolveWidgetPreviewLabel({ ...widget, type: 'bar-chart' });

  return (
    <WidgetEditPreviewOutline active={isEditPreview} label={previewLabel}>
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                  background: 'transparent', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <BarChart2 size={11} color="#f59e0b" />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>{widget.title}</span>
        {loading && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 'auto' }}>載入中…</span>}
        {error   && <span style={{ fontSize: 9, color: '#ef4444', marginLeft: 'auto' }}>錯誤</span>}
        {!hasSource && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>未設定資料來源</span>}
      </div>
      <div ref={ref} style={{ flex: 1, overflow: 'hidden' }}>
        {data.length > 0 && size.width > 0 ? (
          <SvgBarChart
            data={data} xField={widget.xField} yFields={widget.yFields}
            colors={widget.strokeColors} orientation={widget.orientation}
            showValues={widget.showValues} barPadding={widget.barPadding ?? 0.3}
            width={size.width} height={size.height}
          />
        ) : isEditPreview ? (
          <ChartEditSkeleton label={previewLabel} variant="bar" />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', color: 'rgba(255,255,255,0.1)', gap: 4 }}>
            <BarChart2 size={28} strokeWidth={1} />
            <span style={{ fontSize: 10, fontFamily: 'monospace' }}>無資料</span>
          </div>
        )}
      </div>
    </div>
    </WidgetEditPreviewOutline>
  );
}
