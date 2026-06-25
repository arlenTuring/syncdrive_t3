import type {
  ChartAxisBandConfig,
  ChartAxisConfig,
  ChartAxisUnit,
  ChartTimeClock,
  ChartViewportMode,
  LineChartWidget,
} from '../types';
import { isLiveTimeAxis, resolveTimeWindow } from './lineChartSeries';

const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';

export const CHART_PAD = { top: 16, right: 16, bottom: 36, left: 48 };

export function resolveChartPadding(widget: LineChartWidget): { top: number; right: number; bottom: number; left: number } {
  const defaults = CHART_PAD;
  const p = widget.chartPadding;
  return {
    top: p?.top ?? defaults.top,
    right: p?.right ?? defaults.right,
    bottom: p?.bottom ?? defaults.bottom,
    left: p?.left ?? defaults.left,
  };
}

export function chartPlotSize(
  width: number,
  height: number,
  pad = CHART_PAD,
) {
  const cw = Math.max(0, width - pad.left - pad.right);
  const ch = Math.max(0, height - pad.top - pad.bottom);
  return { cw, ch, pad };
}

/** 當日 0:00 起算的分鐘數（0–1439） */
export function getNowMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 過去 pastRatio ：未來 futureRatio 的時間視窗（預設 2:4） */
export function computeCurrentTimeWindow(
  nowMin: number,
  pastRatio = 2,
  futureRatio = 4,
  totalMinutes = 360,
  snapToHour = false,
): { min: number; max: number; now: number } {
  const sum = Math.max(1, pastRatio + futureRatio);
  const pastSpan = (pastRatio / sum) * totalMinutes;
  const futureSpan = (futureRatio / sum) * totalMinutes;
  let min = Math.max(0, nowMin - pastSpan);
  let max = Math.min(24 * 60 - 1, nowMin + futureSpan);
  if (snapToHour) {
    min = Math.floor(min / 60) * 60;
    max = Math.min(24 * 60 - 1, Math.ceil(max / 60) * 60);
    if (max <= min) max = Math.min(24 * 60 - 1, min + 60);
  }
  return { min, max, now: nowMin };
}

/** 時鐘分鐘 → 相對「現在」的偏移（處理跨日 HH:mm） */
export function clockToOffsetMinutes(clockMin: number, nowMin: number): number {
  let d = clockMin - nowMin;
  const halfDay = 12 * 60;
  const day = 24 * 60;
  if (d > halfDay) d -= day;
  if (d < -halfDay) d += day;
  return d;
}

/** 即時軸：固定總長視窗，現在永遠在 pastRatio : futureRatio 分界 */
export function computeLiveOffsetWindow(
  pastRatio = 2,
  futureRatio = 4,
  totalMinutes = 360,
): { min: number; max: number; now: number } {
  const sum = Math.max(1, pastRatio + futureRatio);
  const pastSpan = (pastRatio / sum) * totalMinutes;
  const futureSpan = (futureRatio / sum) * totalMinutes;
  return { min: -pastSpan, max: futureSpan, now: 0 };
}

/** 即時軸整點刻度（偏移座標，對齊時鐘小時） */
export function hourTickOffsets(
  viewMin: number,
  viewMax: number,
  nowMin: number,
  stepMinutes = 60,
): number[] {
  const absMin = nowMin + viewMin;
  const absMax = nowMin + viewMax;
  const step = Math.max(1, stepMinutes);
  const first = Math.ceil(absMin / step) * step;
  const ticks: number[] = [];
  for (let m = first; m <= absMax + 1e-6; m += step) {
    ticks.push(m - nowMin);
  }
  if (ticks.length === 0) ticks.push(viewMin);
  return ticks;
}

export function minutesToTimeString(minutes: number, clock: ChartTimeClock = '24h'): string {
  return formatTimeMinutes(minutes, clock, 'hm');
}

/** 在時間軸上插值取得 Y 值（供「現在」高亮） */
export function interpolateYAtMinute(
  xs: number[],
  ys: number[],
  minute: number,
): number | null {
  if (!xs.length) return null;
  if (minute <= xs[0]) return ys[0];
  if (minute >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    if (minute >= x0 && minute <= x1) {
      const t = x1 === x0 ? 0 : (minute - x0) / (x1 - x0);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[ys.length - 1];
}

export function plotSizeFromWidget(widget: LineChartWidget, headerHeight = 0) {
  return {
    width: Math.max(1, Math.floor(widget.width)),
    height: Math.max(1, Math.floor(widget.height - headerHeight)),
  };
}

/** 將時間字串或數字轉為「當日分鐘」(0–1439) */
export function parseTimeValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    if (raw >= 0 && raw < 24 * 60) return raw;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    return raw;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[4]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + min;
  }
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return null;
}

export function parseAxisBound(raw: unknown, unit: ChartAxisUnit): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (unit === 'time') {
    const t = parseTimeValue(raw);
    return t === null ? undefined : t;
  }
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

export function parseDataValue(raw: unknown, unit: ChartAxisUnit, index: number): number {
  if (unit === 'time') {
    const t = parseTimeValue(raw);
    if (t !== null) return t;
  }
  const n = Number(raw);
  if (!Number.isNaN(n)) return n;
  return index;
}

/** Y 軸數值：空值不繪點（多線各自欄位可為 NULL） */
export function parseYDataValue(raw: unknown, unit: ChartAxisUnit): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (unit === 'time') {
    const t = parseTimeValue(raw);
    return t !== null ? t : null;
  }
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

export function formatAxisValue(value: number, axis?: ChartAxisConfig): string {
  const unit = axis?.unit ?? 'number';
  if (unit === 'time') {
    return formatTimeMinutes(value, axis?.timeClock ?? '24h', axis?.timeStyle ?? 'hm');
  }
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (value % 1 === 0) return String(value);
  return value.toFixed(1);
}

export function formatTimeMinutes(minutes: number, clock: ChartTimeClock, style: 'hm'): string {
  const m = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (clock === '24h' || style !== 'hm') {
    return `${pad(h24)}:${pad(min)}`;
  }
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad(min)} ${ap}`;
}

export function computeViewRange(
  dataValues: number[],
  axis: ChartAxisConfig | undefined,
  mode: ChartViewportMode,
  paddingRatio: number,
): { min: number; max: number } {
  const unit = axis?.unit ?? 'number';
  const dataMin = dataValues.length ? Math.min(...dataValues) : 0;
  const dataMax = dataValues.length ? Math.max(...dataValues) : unit === 'time' ? 24 * 60 : 1;
  const span = dataMax - dataMin || (unit === 'time' ? 60 : 1);

  const boundMin = parseAxisBound(axis?.min, unit);
  const boundMax = parseAxisBound(axis?.max, unit);

  if (mode === 'fixed-axis') {
    return {
      min: boundMin ?? dataMin,
      max: boundMax ?? Math.max(dataMax, dataMin + span),
    };
  }

  const pad = span * Math.max(0, Math.min(0.45, paddingRatio));
  let viewMin = dataMin - pad;
  let viewMax = dataMax + pad;
  if (boundMin !== undefined) viewMin = Math.max(viewMin, boundMin);
  if (boundMax !== undefined) viewMax = Math.min(viewMax, boundMax);
  if (viewMax <= viewMin) {
    viewMin = dataMin - span * 0.05;
    viewMax = dataMax + span * 0.05;
  }
  return { min: viewMin, max: viewMax };
}

export function makeScale(viewMin: number, viewMax: number, plotSize: number) {
  const range = viewMax - viewMin || 1;
  return (v: number) => ((v - viewMin) / range) * plotSize;
}

export function makeInverseScale(viewMin: number, viewMax: number, plotSize: number) {
  const range = viewMax - viewMin || 1;
  return (px: number) => viewMin + (px / plotSize) * range;
}

export function buildChartScales(
  data: Record<string, unknown>[],
  widget: LineChartWidget,
  yFields: string[],
  clockNow?: number,
) {
  const xUnit = widget.xAxis?.unit ?? 'number';
  const yUnit = widget.yAxis?.unit ?? 'number';
  const mode = widget.viewportMode ?? 'fixed-axis';
  const padding = widget.viewportPadding ?? 0.12;
  const fields = yFields.length ? yFields : ['value'];

  const useLiveTime = isLiveTimeAxis(widget);
  const tw = resolveTimeWindow(widget);
  const anchorNow = clockNow ?? getNowMinutes();

  const xs = data.map((d, i) => {
    const clock = parseDataValue(d[widget.xField], xUnit, i);
    if (useLiveTime && xUnit === 'time') {
      const t = parseTimeValue(d[widget.xField]) ?? clock;
      return clockToOffsetMinutes(t, anchorNow);
    }
    return clock;
  });
  const ysAll = fields.flatMap(field =>
    data.map(d => parseYDataValue(d[field], yUnit)).filter((v): v is number => v !== null),
  );
  const primaryField = fields[0];
  const ys = data.map(d => parseYDataValue(d[primaryField], yUnit) ?? 0);

  let xView: { min: number; max: number; now?: number };
  if (useLiveTime) {
    xView = computeLiveOffsetWindow(
      tw.pastRatio ?? 2,
      tw.futureRatio ?? 4,
      tw.totalMinutes ?? 360,
    );
  } else {
    xView = computeViewRange(xs, widget.xAxis, mode, padding);
  }
  const yView = computeViewRange(ysAll, widget.yAxis, mode, padding);

  return {
    xs,
    ys,
    yUnit,
    xUnit,
    xView,
    yView,
    mode,
    xAxis: widget.xAxis,
    yAxis: widget.yAxis,
    clockNow: useLiveTime ? anchorNow : undefined,
  };
}

export function tickValues(viewMin: number, viewMax: number, count = 5): number[] {
  const range = viewMax - viewMin || 1;
  return Array.from({ length: count }, (_, i) => viewMin + (i / (count - 1)) * range);
}

/** 時間軸：整點每小時一格（14:00、15:00…），視窗滑動時刻度間距固定 */
export function hourTickValues(viewMin: number, viewMax: number, stepMinutes = 60): number[] {
  if (viewMax <= viewMin) return [viewMin];
  const step = Math.max(1, stepMinutes);
  const first = Math.floor(viewMin / step) * step;
  const ticks: number[] = [];
  for (let m = first; m <= viewMax + 1e-6; m += step) {
    ticks.push(m);
  }
  if (ticks.length === 0) ticks.push(viewMin);
  return ticks;
}

export function axisLabelStyle(fontSize = 9) {
  return {
    fill: 'rgba(255,255,255,0.32)',
    fontSize,
    fontFamily: FONT_MONO,
  } as const;
}

export function gridLineStyle() {
  return { stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 };
}

export function axisLineStyle() {
  return { stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 };
}

export interface AxisBandRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 依區段識別欄位值解析色帶顏色（規則在元件內設定） */
export function resolveAxisBandColor(
  raw: unknown,
  band: ChartAxisBandConfig,
): string {
  const key = String(raw ?? '').trim();
  const hit = band.colorRules.find(r => String(r.value) === key);
  return hit?.color ?? band.defaultColor ?? 'rgba(148,163,184,0.7)';
}

/** 將資料列轉成可繪製的軸向色帶矩形（X/Y 通用） */
export function buildAxisBandRects(params: {
  data: Record<string, unknown>[];
  widget: LineChartWidget;
  band: ChartAxisBandConfig;
  xScale: (v: number) => number;
  yScale: (v: number) => number;
  xViewMin: number;
  xViewMax: number;
  yViewMin: number;
  yViewMax: number;
  cw: number;
  ch: number;
  /** 即時軸：將 HH:mm 轉為相對現在的偏移 */
  liveClockNow?: number;
}): AxisBandRect[] {
  const {
    data, widget, band, xScale, yScale, xViewMin, xViewMax, yViewMin, yViewMax, cw, ch, liveClockNow,
  } = params;
  if (!data.length) return [];
  const opacity = clamp(band.opacity ?? 1, 0, 1);
  const thickness = Math.max(1, Math.floor(band.thickness ?? 4));
  const rects: AxisBandRect[] = [];

  const toXValue = (raw: unknown, index: number, unit: ChartAxisUnit): number => {
    const clock = parseDataValue(raw, unit, Math.max(0, index));
    if (liveClockNow !== undefined && unit === 'time') {
      const t = parseTimeValue(raw) ?? clock;
      return clockToOffsetMinutes(t, liveClockNow);
    }
    return clock;
  };

  if (band.axis === 'x') {
    const startField = band.startField || widget.xField;
    const unit = widget.xAxis?.unit ?? 'number';
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const start = toXValue(row[startField], i, unit);
      const endRaw = band.endField ? row[band.endField] : (data[i + 1]?.[startField] ?? xViewMax);
      const end = !band.endField && !data[i + 1] && typeof endRaw === 'number'
        ? endRaw
        : toXValue(endRaw, i + 1, unit);
      const leftVal = Math.min(start, end);
      const rightVal = Math.max(start, end);
      if (rightVal <= xViewMin || leftVal >= xViewMax) continue;
      const a = clamp(leftVal, xViewMin, xViewMax);
      const b = clamp(rightVal, xViewMin, xViewMax);
      const x1 = clamp(xScale(a), 0, cw);
      const x2 = clamp(xScale(b), 0, cw);
      const color = resolveAxisBandColor(row[band.segmentField], band);
      if (x2 - x1 <= 0.5) continue;
      rects.push({
        x: x1,
        y: ch - thickness,
        width: Math.max(1, x2 - x1),
        height: thickness,
        color,
        opacity,
      });
    }
    return rects;
  }

  const startField = band.startField || widget.yFields[0] || 'value';
  const unit = widget.yAxis?.unit ?? 'number';
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const start = parseDataValue(row[startField], unit, i);
    const endRaw = band.endField ? row[band.endField] : (data[i + 1]?.[startField] ?? yViewMax);
    const end = parseDataValue(endRaw, unit, i + 1);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high <= yViewMin || low >= yViewMax) continue;
    const a = clamp(low, yViewMin, yViewMax);
    const b = clamp(high, yViewMin, yViewMax);
    const yTop = ch - yScale(b);
    const yBottom = ch - yScale(a);
    const color = resolveAxisBandColor(row[band.segmentField], band);
    if (yBottom - yTop <= 0.5) continue;
    rects.push({
      x: -thickness,
      y: yTop,
      width: thickness,
      height: Math.max(1, yBottom - yTop),
      color,
      opacity,
    });
  }
  return rects;
}
