import type { ChartAxisTimeWindowConfig, LineChartSeriesConfig, LineChartWidget } from '../types';

const DEFAULT_COLORS = ['#38bdf8', '#22c55e', '#f97316', '#a78bfa', '#f472b6'];

export function newSeriesId(): string {
  return `series-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function resolveTimeWindow(widget: LineChartWidget): ChartAxisTimeWindowConfig {
  const tw = widget.xAxis?.timeWindow;
  if (tw) return tw;
  if (widget.chartVariant === 'live-time-sync' || widget.syncCurrentTime !== undefined) {
    return {
      enabled: widget.syncCurrentTime !== false,
      pastRatio: widget.timePastRatio ?? 2,
      futureRatio: widget.timeFutureRatio ?? 4,
      totalMinutes: widget.timeWindowMinutes ?? 360,
      snapToHour: true,
    };
  }
  return { enabled: false };
}

export function isLiveTimeAxis(widget: LineChartWidget): boolean {
  if (widget.xAxis?.unit !== 'time') return false;
  const tw = resolveTimeWindow(widget);
  if (tw.enabled === true) return true;
  if (tw.enabled === false) return false;
  return widget.syncCurrentTime !== false && widget.chartVariant === 'live-time-sync';
}

export function resolveHighlightTime(widget: LineChartWidget): string | undefined {
  return widget.xAxis?.highlightTime ?? widget.highlightTime;
}

/** 將 widget 解析為系列陣列（含舊版 yFields / 運能趨勢欄位遷移） */
export function resolveLineChartSeries(widget: LineChartWidget): LineChartSeriesConfig[] {
  if (widget.series?.length) return widget.series;

  const yFields = widget.yFields?.length ? widget.yFields : ['value'];
  return yFields.map((yField, i) => {
    const color = widget.strokeColors?.[i] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    const base: LineChartSeriesConfig = {
      id: `legacy-${i}`,
      yField,
      color,
      strokeWidth: 2,
    };
    if (i !== 0) return base;
    const hasLegacyEvents = !!(widget.anomalyFlagField || widget.anomalyLabelField);
    return {
      ...base,
      color: widget.normalLineColor ?? color,
      eventLabelsEnabled: hasLegacyEvents,
      eventFlagField: widget.anomalyFlagField,
      eventLabelField: widget.anomalyLabelField,
    };
  });
}

export function syncSeriesToLegacyFields(series: LineChartSeriesConfig[]): {
  yFields: string[];
  strokeColors: string[];
} {
  return {
    yFields: series.map(s => s.yField),
    strokeColors: series.map(s => s.color ?? '#06b6d4'),
  };
}
