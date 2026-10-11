import { useId } from 'react';
import type { LineChartEventLabelStyle, LineChartSeriesConfig, LineChartWidget } from '../types';
import { TrendingUp } from 'lucide-react';
import { useWidgetData } from './useWidgetData';
import { ChartEditSkeleton, WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';
import { ChartSvg } from './ChartSvg';
import {
  buildAxisBandRects,
  buildChartScales,
  chartPlotSize,
  formatAxisValue,
  formatTimeMinutes,
  hourTickOffsets,
  makeScale,
  parseYDataValue,
  parseTimeValue,
  plotSizeFromWidget,
  resolveChartPadding,
  tickValues,
} from './chartAxis';
import {
  isLiveTimeAxis,
  resolveHighlightTime,
  resolveLineChartSeries,
} from './lineChartSeries';
import { clockMinutes, useChartNow } from './useChartNow';
import { chartNowToleranceMs, resolveChartNowAnchor } from './chartNowAnchor';

const HEADER_H = 28;
const FONT = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

function isTruthy(v: unknown): boolean {
  if (v === true || v === 1 || v === '1') return true;
  if (typeof v === 'string') return v === 'true' || v === 'yes';
  return false;
}

function shouldShowEventLabel(row: Record<string, unknown>, series: LineChartSeriesConfig): boolean {
  if (!series.eventLabelsEnabled) return false;
  if (series.eventFlagField) {
    if (!isTruthy(row[series.eventFlagField])) return false;
  }
  if (!series.eventLabelField) return false;
  const raw = row[series.eventLabelField];
  if (raw === null || raw === undefined) return false;
  return String(raw).trim() !== '';
}

function eventLabelText(row: Record<string, unknown>, series: LineChartSeriesConfig): string {
  if (!series.eventLabelField) return '';
  return String(row[series.eventLabelField] ?? '').trim();
}

function eventLabelSvgStyle(
  style: LineChartEventLabelStyle | undefined,
  defaultFs: number,
) {
  const fs = style?.fontSize ?? defaultFs;
  const fw = style?.fontWeight ?? 'normal';
  const fill = style?.fill ?? '#fca5a5';
  const stroke = style?.stroke;
  const sw = style?.strokeWidth ?? (stroke ? 1 : 0);
  return {
    fill,
    stroke,
    strokeWidth: sw,
    paintOrder: stroke ? 'stroke fill' : undefined,
    fontSize: fs,
    fontWeight: fw,
    fontFamily: FONT,
  };
}

function UnifiedLineChart({
  data,
  widget,
  width,
  height,
}: {
  data: Record<string, unknown>[];
  widget: LineChartWidget;
  width: number;
  height: number;
}) {
  const seriesList = resolveLineChartSeries(widget);
  const yFields = seriesList.map(s => s.yField);
  const pad = resolveChartPadding(widget);
  const { cw, ch } = chartPlotSize(width, height, pad);
  const liveTime = isLiveTimeAxis(widget);
  const { nowMs: clockNowMs, nowMin: clockNowMin, rate } = useChartNow(liveTime, 2_000);
  const clipId = `chart-clip-${useId().replace(/:/g, '')}`;
  /*
   * 一次渲染只用一個「現在」：資料帶採樣時刻（is_now／now_ms）而且跟營運時鐘對得上時就用它，
   * 虛線、端點、刻度、色帶都照它算；對不上就用營運時鐘並標示資料時間（見 chartNowAnchor.ts）。
   */
  const nowAnchor = liveTime
    ? resolveChartNowAnchor(data, clockNowMs, chartNowToleranceMs(rate, widget.refreshInterval))
    : null;
  const nowMs = nowAnchor ? nowAnchor.anchorMs : clockNowMs;
  const nowMin = nowAnchor && nowAnchor.status === 'fresh' ? clockMinutes(nowMs) : clockNowMin;
  const scales = buildChartScales(data, widget, yFields, nowMin, nowMs);
  const xScale = makeScale(scales.xView.min, scales.xView.max, cw);
  const yScale = makeScale(scales.yView.min, scales.yView.max, ch);
  const yPix = (v: number) => ch - yScale(v);
  const xPix = (i: number) => xScale(scales.xs[i] ?? i);

  const primary = seriesList[0];
  const primaryColor = primary?.color ?? '#38bdf8';
  const anchorNow = scales.clockNow ?? nowMin;
  const nowMinute = liveTime ? 0 : (scales.xView.now ?? nowMin);
  const nowX = xScale(nowMinute);
  /**
   * 「現在」端點：主線最後一個有值、而且不在未來的點（後端那份資料的現在，跟即時數值同一個算法）。
   * 值是 0 也照畫；不在資料之間插值、不拿未來的點。
   */
  let nowPoint: { x: number; y: number } | null = null;
  const nowSeries = seriesList.find(series => series.nowEndpoint) ?? primary;
  const nowColor = nowSeries?.color ?? primaryColor;
  if (liveTime && nowSeries && nowAnchor && nowAnchor.status !== 'none') {
    // 後端標了「現在」那一列：端點就是它（值是 null 就不畫，不補 0）；比時鐘還新的不畫
    const row = data[nowAnchor.nowRowIndex];
    const yv = nowAnchor.status === 'ahead' || !row ? null : parseYDataValue(row[nowSeries.yField], scales.yUnit);
    if (yv !== null) nowPoint = { x: scales.xs[nowAnchor.nowRowIndex] ?? 0, y: yv };
  } else if (liveTime && nowSeries) {
    data.forEach((row, i) => {
      const yv = parseYDataValue(row[nowSeries.yField], scales.yUnit);
      const xv = scales.xs[i] ?? i;
      if (yv === null || xv > nowMinute + 0.01) return;
      if (!nowPoint || xv >= nowPoint.x) nowPoint = { x: xv, y: yv };
    });
  }
  const nowEndpoint = nowPoint as { x: number; y: number } | null;
  const dataIssue = widget.dataIssueField ? String(data[0]?.[widget.dataIssueField] ?? '').trim() : '';

  const highlightTime = resolveHighlightTime(widget);
  let highlightIdx =
    !liveTime && highlightTime
      ? data.findIndex(d => {
          const raw = String(d[widget.xField]);
          if (raw === highlightTime) return true;
          const t = parseTimeValue(raw);
          const ht = parseTimeValue(highlightTime);
          return t !== null && ht !== null && t === ht;
        })
      : -1;

  if (highlightIdx < 0 && widget.xAxis?.highlightPivot && !liveTime) {
    const forecast = seriesList[1];
    if (primary && forecast) {
      highlightIdx = data.findIndex(
        d =>
          parseYDataValue(d[primary.yField], scales.yUnit) !== null
          && parseYDataValue(d[forecast.yField], scales.yUnit) !== null,
      );
    }
  }

  const yTicks = tickValues(scales.yView.min, scales.yView.max, 5);
  const xTicks =
    scales.xUnit === 'time' && liveTime
      ? hourTickOffsets(scales.xView.min, scales.xView.max, anchorNow, 60)
      : tickValues(scales.xView.min, scales.xView.max, 6);

  const xBand = widget.axisBands?.find(b => b.axis === 'x');
  const yBand = widget.axisBands?.find(b => b.axis === 'y');
  const bandParams = {
    data,
    widget,
    xScale,
    yScale,
    xViewMin: scales.xView.min,
    xViewMax: scales.xView.max,
    yViewMin: scales.yView.min,
    yViewMax: scales.yView.max,
    cw,
    ch,
    liveClockNow: liveTime ? anchorNow : undefined,
    liveNowMs: liveTime ? nowMs : undefined,
  };
  const xBandRects = xBand ? buildAxisBandRects({ ...bandParams, band: xBand }) : [];
  const yBandRects = yBand ? buildAxisBandRects({ ...bandParams, band: yBand }) : [];

  const inView = (i: number) => {
    const xv = scales.xs[i] ?? i;
    return xv >= scales.xView.min && xv <= scales.xView.max;
  };

  const axisFs = widget.chartAxisFontSize ?? 9;
  const calloutFs = widget.chartCalloutFontSize ?? 11;
  const gridStroke = widget.chartGridColor ?? 'rgba(255,255,255,0.06)';
  const axisLabelFill = widget.chartAxisLabelColor ?? 'rgba(255,255,255,0.32)';
  const axisStroke = widget.chartAxisLineColor ?? 'rgba(255,255,255,0.12)';
  const calloutFill = widget.chartCalloutFill ?? '#0ea5e9';
  const calloutText = widget.chartCalloutTextColor ?? '#fff';
  const gridProps = { stroke: gridStroke, strokeWidth: 1 };
  const axisLabelProps = {
    fill: axisLabelFill,
    fontSize: axisFs,
    fontFamily: FONT,
  };
  const axisLineProps = { stroke: axisStroke, strokeWidth: 1 };

  return (
    <ChartSvg width={width} height={height}>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={-6} width={cw} height={ch + 6} />
        </clipPath>
        <linearGradient id="capacity-area-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="28.36%" stopColor="rgba(43, 127, 255, 0)" />
          <stop offset="78.36%" stopColor="rgba(43, 127, 255, 0.127404)" />
          <stop offset="100%" stopColor="rgba(81, 162, 255, 0.25)" />
        </linearGradient>
      </defs>
      <g transform={`translate(${pad.left},${pad.top})`}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={0} x2={cw} y1={yPix(v)} y2={yPix(v)} {...gridProps} />
            {!widget.hideYAxisLabels && (
              <text x={-6} y={yPix(v) + 4} textAnchor="end" {...axisLabelProps}>
                {formatAxisValue(v, scales.yAxis)}
              </text>
            )}
          </g>
        ))}

        {xTicks.map((v, i) => {
          const x = xScale(v);
          if (x < -2 || x > cw + 2) return null;
          return (
            <g key={`xt-${i}`}>
              {liveTime && <line x1={x} x2={x} y1={0} y2={ch} {...gridProps} />}
              <text x={x} y={ch + 14} textAnchor="middle" {...axisLabelProps}>
                {formatAxisValue(liveTime ? anchorNow + v : v, scales.xAxis)}
              </text>
            </g>
          );
        })}

        {yBandRects.map((r, i) => (
          <rect
            key={`y-band-${i}`}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill={r.color}
            opacity={r.opacity}
            rx={2}
          />
        ))}

        {xBandRects.map((r, i) => (
          <rect
            key={`x-band-${i}`}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill={r.color}
            opacity={r.opacity}
            rx={i === 0 ? 2 : 0}
          />
        ))}

        <line x1={0} x2={cw} y1={ch} y2={ch} {...axisLineProps} />
        <line x1={0} x2={0} y1={0} y2={ch} {...axisLineProps} />

        {widget.yAxis?.label && (
          <text
            x={-36}
            y={ch / 2}
            textAnchor="middle"
            transform={`rotate(-90,-36,${ch / 2})`}
            fill="rgba(255,255,255,0.4)"
            fontSize={9}
          >
            {widget.yAxis.label}
          </text>
        )}
        {widget.xAxis?.label && (
          <text x={cw / 2} y={ch + 28} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={9}>
            {widget.xAxis.label}
          </text>
        )}

        {/* 線畫在可視區裁切範圍內：視窗邊界外的點保留（線段跟邊界相交處照樣畫到邊緣），不丟端點 */}
        <g clipPath={`url(#${clipId})`}>
        {seriesList.map(series => {
          const color = series.color ?? '#06b6d4';
          const sw = series.strokeWidth ?? 2;
          // 缺值（null）把線斷開：不跨缺段連成完整線，也不補 0
          const runs: Array<Array<{ x: number; y: number }>> = [];
          let run: Array<{ x: number; y: number }> = [];
          data.forEach((d, i) => {
            const yv = parseYDataValue(d[series.yField], scales.yUnit);
            if (yv === null) {
              if (run.length) runs.push(run);
              run = [];
              return;
            }
            run.push({ x: xScale(scales.xs[i] ?? i), y: yPix(yv) });
          });
          if (run.length) runs.push(run);

          return (
            <g key={series.id}>
              {series.areaFill && runs.map((points, ri) => points.length >= 2 && (
                <path
                  key={`area-${ri}`}
                  d={`M ${points[0].x},${points[0].y} ${points.slice(1).map(p => `L ${p.x},${p.y}`).join(' ')} L ${points[points.length - 1].x},${ch} L ${points[0].x},${ch} Z`}
                  fill="url(#capacity-area-fill)"
                  stroke="none"
                />
              ))}
              {runs.map((points, ri) => (
                <polyline
                  key={`line-${ri}`}
                  points={points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={sw}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {series.showPoints !== false && runs.flat().map((p, pi) => (
                <circle key={`pt-${series.id}-${pi}`} cx={p.x} cy={p.y} r={2.5} fill={color} />
              ))}
            </g>
          );
        })}
        </g>

        {/* 現在：垂直虛線（營運時間）＋主線端點與數值 */}
        {liveTime && nowX >= 0 && nowX <= cw && (
          <line
            x1={nowX}
            x2={nowX}
            y1={0}
            y2={ch}
            stroke="rgba(148,163,184,0.45)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
        {nowAnchor && (nowAnchor.status === 'stale' || nowAnchor.status === 'ahead') && nowX >= 0 && nowX <= cw && (
          <text
            x={nowX + 4}
            y={ch - 6}
            fill="#FDC700"
            fontSize={axisFs}
            fontFamily={FONT}
            data-chart-now-status={nowAnchor.status}
          >
            {nowAnchor.status === 'stale'
              ? `資料時間 ${formatTimeMinutes(clockMinutes(nowAnchor.dataNowMs ?? nowMs), '24h', 'hm')}・落後 ${Math.round(nowAnchor.lagMs / 60_000)} 分`
              : '資料時間與營運時鐘不一致'}
          </text>
        )}
        {nowEndpoint && xScale(nowEndpoint.x) >= 0 && xScale(nowEndpoint.x) <= cw && (
          <g data-chart-now-endpoint={nowEndpoint.y} data-chart-now-status={nowAnchor?.status ?? 'none'}>
            <circle cx={xScale(nowEndpoint.x)} cy={yPix(nowEndpoint.y)} r={5} fill={nowColor} />
            <rect x={xScale(nowEndpoint.x) - 28} y={yPix(nowEndpoint.y) - 32} width={56} height={22} rx={8} fill={calloutFill} />
            <text
              x={xScale(nowEndpoint.x)}
              y={yPix(nowEndpoint.y) - 17}
              textAnchor="middle"
              fill={calloutText}
              fontSize={calloutFs}
              fontWeight="500"
              fontFamily={FONT}
            >
              {formatAxisValue(nowEndpoint.y, scales.yAxis)}
            </text>
          </g>
        )}

        {dataIssue && (
          <text x={6} y={14} fill="#FDC700" fontSize={calloutFs} fontFamily={FONT} data-chart-data-issue>
            ⚠ {dataIssue}
          </text>
        )}

        {highlightIdx >= 0 && inView(highlightIdx) && primary && (
          <>
            <line
              x1={xPix(highlightIdx)}
              x2={xPix(highlightIdx)}
              y1={0}
              y2={ch}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <circle
              cx={xPix(highlightIdx)}
              cy={yPix(parseYDataValue(data[highlightIdx][primary.yField], scales.yUnit) ?? 0)}
              r={5}
              fill={primaryColor}
            />
            <rect
              x={xPix(highlightIdx) - 28}
              y={yPix(parseYDataValue(data[highlightIdx][primary.yField], scales.yUnit) ?? 0) - 32}
              width={56}
              height={22}
              rx={4}
              fill="#0ea5e9"
            />
            <text
              x={xPix(highlightIdx)}
              y={yPix(parseYDataValue(data[highlightIdx][primary.yField], scales.yUnit) ?? 0) - 17}
              textAnchor="middle"
              fill="#fff"
              fontSize={calloutFs}
              fontWeight="700"
              fontFamily={FONT}
            >
              {formatAxisValue(
                parseYDataValue(data[highlightIdx][primary.yField], scales.yUnit) ?? 0,
                scales.yAxis,
              )}
            </text>
          </>
        )}

        {seriesList.map(series =>
          data.map((d, i) => {
            if (!shouldShowEventLabel(d, series) || !inView(i)) return null;
            const label = eventLabelText(d, series);
            const cx = xPix(i);
            const yv = parseYDataValue(d[series.yField], scales.yUnit);
            if (yv === null) return null;
            const cy = yPix(yv);
            const boxW = Math.max(88, label.length * 11 + 16);
            const ls = series.eventLabelStyle;
            const textStyle = eventLabelSvgStyle(ls, calloutFs);
            const boxStroke = ls?.stroke ?? '#ef4444';
            const boxSw = ls?.strokeWidth ?? 1.5;
            const boxFill = ls?.backgroundFill ?? 'none';
            return (
              <g key={`evt-${series.id}-${i}`}>
                <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1} />
                <rect
                  x={cx - boxW / 2}
                  y={cy - 36}
                  width={boxW}
                  height={22}
                  rx={8}
                  fill={boxFill}
                  stroke={boxStroke}
                  strokeWidth={boxSw}
                />
                <text x={cx} y={cy - 21} textAnchor="middle" {...textStyle}>
                  {label}
                </text>
                <line x1={cx} y1={cy - 14} x2={cx} y2={cy - 5} stroke={boxStroke} strokeWidth={1} />
              </g>
            );
          }),
        )}

        {!widget.chartHideLegend && seriesList.map((series, fi) => (
          <g key={`leg-${series.id}`} transform={`translate(${fi * 88}, -8)`}>
            <line
              x1={0}
              x2={12}
              y1={0}
              y2={0}
              stroke={series.color ?? '#06b6d4'}
              strokeWidth={series.strokeWidth ?? 2}
            />
            <text
              x={16}
              y={4}
              fill={series.color ?? '#06b6d4'}
              fontSize={9}
              fontFamily="monospace"
            >
              {series.label ?? series.yField}
            </text>
          </g>
        ))}
      </g>
    </ChartSvg>
  );
}

export function LineChartWidgetView({ widget }: { widget: LineChartWidget }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const { data, loading, error } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
    refreshInterval: widget.refreshInterval,
    refreshMode: widget.refreshMode,
    invalidateTags: widget.invalidateTags,
  });
  const hasSource = !!(widget.dataSourceId || widget.dataUrl);
  const modeLabel = widget.viewportMode === 'data-centered' ? '資料為中心' : '定軸';
  // 已經有資料時，背景補查的「載入中」不佔標題列（不然每次輪詢圖都縮一下）
  const showHeader = !!(widget.title?.trim() || (loading && data.length === 0) || error || !hasSource);
  const plot = plotSizeFromWidget(widget, showHeader ? HEADER_H : 0);
  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, data.length > 0);
  const previewLabel = resolveWidgetPreviewLabel({ ...widget, type: 'line-chart' });

  return (
    <WidgetEditPreviewOutline active={isEditPreview} label={previewLabel}>
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        borderRadius: 4,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {showHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: HEADER_H,
            flexShrink: 0,
            padding: '0 8px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            boxSizing: 'border-box',
          }}
        >
          <TrendingUp size={11} color="#06b6d4" />
          {widget.title?.trim() && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>{widget.title}</span>
          )}
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginLeft: widget.title?.trim() ? 4 : 0 }}>{modeLabel}</span>
          {loading && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 'auto' }}>載入中…</span>}
          {error && <span style={{ fontSize: 9, color: '#ef4444', marginLeft: 'auto' }} title={error}>錯誤</span>}
          {!hasSource && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>未設定資料來源</span>
          )}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {data.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
          >
            <UnifiedLineChart data={data} widget={widget} width={plot.width} height={plot.height} />
          </div>
        ) : isEditPreview ? (
          <ChartEditSkeleton label={previewLabel} variant="line" />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.1)',
              gap: 4,
            }}
          >
            <TrendingUp size={28} strokeWidth={1} />
            <span style={{ fontSize: 10 }}>無資料</span>
          </div>
        )}
      </div>
    </div>
    </WidgetEditPreviewOutline>
  );
}
