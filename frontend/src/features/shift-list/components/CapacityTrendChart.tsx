import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { GeneratedSchedulePlan } from '../utils/shiftScheduleEngine.types';
import {
  buildCapacityPeriodBands,
  buildCapacityTrendFromPlan,
  CAPACITY_DAY_MINUTES,
  CAPACITY_TREND_BUCKET_MINUTES,
  formatMinuteAsHm,
  resolveCapacityAxisMax,
  resolveCapacityPeriodAtMinute,
  formatDirectionalHeadwayTooltip,
  formatCapacityGapHint,
  type CapacityTrendSample,
} from '../utils/buildCapacityTrend';

type CapacityTrendChartProps = {
  plan: GeneratedSchedulePlan | null | undefined;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  /** 時間模板車體載運量（人／車） */
  vehicleCapacity: number;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  className?: string;
};

const CHART_WIDTH = 960;
const CHART_HEIGHT = 360;
const PAD = { top: 24, right: 20, bottom: 52, left: 56 };
const PLOT_W = CHART_WIDTH - PAD.left - PAD.right;
const PLOT_H = CHART_HEIGHT - PAD.top - PAD.bottom;
const BAND_H = 10;

function xForMinute(minute: number): number {
  return PAD.left + (minute / CAPACITY_DAY_MINUTES) * PLOT_W;
}

function yForPphpd(pphpd: number, axisMax: number): number {
  const ratio = axisMax <= 0 ? 0 : Math.min(1, Math.max(0, pphpd / axisMax));
  return PAD.top + PLOT_H * (1 - ratio);
}

function buildAreaPath(samples: CapacityTrendSample[], axisMax: number): string {
  if (samples.length === 0) return '';
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const baseline = yForPphpd(0, axisMax);
  let d = `M ${xForMinute(first.minute)} ${baseline}`;
  for (const sample of samples) {
    d += ` L ${xForMinute(sample.minute)} ${yForPphpd(sample.pphpd, axisMax)}`;
  }
  d += ` L ${xForMinute(last.minute)} ${baseline} Z`;
  return d;
}

function buildLinePath(samples: CapacityTrendSample[], axisMax: number): string {
  if (samples.length === 0) return '';
  return samples
    .map((sample, index) => {
      const x = xForMinute(sample.minute);
      const y = yForPphpd(sample.pphpd, axisMax);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

function sampleAtMinute(
  samples: CapacityTrendSample[],
  minute: number,
): CapacityTrendSample | null {
  if (samples.length === 0) return null;
  let best = samples[0]!;
  let bestDist = Math.abs(best.minute - minute);
  for (const sample of samples) {
    const dist = Math.abs(sample.minute - minute);
    if (dist < bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
}

export function CapacityTrendChart({
  plan,
  intervals,
  attributes,
  vehicleCapacity,
  selectedRoutes,
  className = '',
}: CapacityTrendChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverMinute, setHoverMinute] = useState<number | null>(null);

  const series = useMemo(
    () =>
      buildCapacityTrendFromPlan({
        plan,
        vehicleCapacity: Number.isFinite(vehicleCapacity) && vehicleCapacity > 0
          ? vehicleCapacity
          : 50,
        selectedRoutes,
        sampleStepMinutes: 1,
      }),
    [plan, vehicleCapacity, selectedRoutes],
  );

  const bands = useMemo(
    () => buildCapacityPeriodBands(intervals, attributes),
    [intervals, attributes],
  );

  const axisMax = useMemo(
    () => resolveCapacityAxisMax(series.maxPphpd, attributes),
    [series.maxPphpd, attributes],
  );

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = axisMax <= 800 ? 200 : axisMax <= 2000 ? 200 : 400;
    for (let v = 0; v <= axisMax; v += step) ticks.push(v);
    return ticks;
  }, [axisMax]);

  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let minute = 0; minute <= CAPACITY_DAY_MINUTES; minute += 120) {
      ticks.push(minute);
    }
    return ticks;
  }, []);

  const hoverSample =
    hoverMinute == null ? null : sampleAtMinute(series.samples, hoverMinute);
  const hoverBand =
    hoverMinute == null ? null : resolveCapacityPeriodAtMinute(bands, hoverMinute);

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    const ratio = (x - PAD.left) / PLOT_W;
    const minute = Math.round(
      Math.min(CAPACITY_DAY_MINUTES, Math.max(0, ratio * CAPACITY_DAY_MINUTES)),
    );
    setHoverMinute(minute);
  };

  const areaPath = buildAreaPath(series.samples, axisMax);
  const linePath = buildLinePath(series.samples, axisMax);

  const tooltipLeft =
    hoverSample == null
      ? 0
      : Math.min(
          CHART_WIDTH - 180,
          Math.max(PAD.left, xForMinute(hoverSample.minute) + 12),
        );
  const tooltipTop =
    hoverSample == null
      ? 0
      : Math.max(8, yForPphpd(hoverSample.pphpd, axisMax) - 96);

  const capacityGapHint =
    hoverSample == null
      ? null
      : formatCapacityGapHint({
          actualPphpd: hoverSample.pphpd,
          targetPphpd: hoverBand?.capacityPphpd,
          actualHeadwaySeconds: hoverSample.headwaySeconds,
          targetHeadwaySeconds: hoverBand?.headwaySeconds,
        });

  const safeVehicleCapacity =
    Number.isFinite(vehicleCapacity) && vehicleCapacity > 0
      ? Math.round(vehicleCapacity)
      : series.vehicleCapacity;

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <p className="mb-3 text-xs text-zinc-400">
        藍線為 {CAPACITY_TREND_BUCKET_MINUTES}{' '}
        分鐘區間的供給運能（pphpd）；各時段細虛線為該段要求運能（與下方色帶同色）。載運量{' '}
        <span className="font-medium tabular-nums text-zinc-200">
          {safeVehicleCapacity} 人／車
        </span>
        {series.departureCount > 0 ? (
          <span className="ml-2 text-zinc-600">
            · 最終班表 {series.departureCount} 趟正線發車
          </span>
        ) : null}
      </p>

      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-[#0b0d12]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full select-none"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverMinute(null)}
          role="img"
          aria-label="運能趨勢折線圖"
        >
          <defs>
            <linearGradient id="capacityAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2B7FFF" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#2B7FFF" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* 格線 */}
          {yTicks.map((tick) => {
            const y = yForPphpd(tick, axisMax);
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + PLOT_W}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4 6"
                />
                <text
                  x={PAD.left - 10}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-zinc-500"
                  style={{ fontSize: 11 }}
                >
                  {tick.toLocaleString('en-US')}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick) => {
            const x = xForMinute(tick);
            return (
              <g key={`x-${tick}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD.top}
                  y2={PAD.top + PLOT_H}
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="4 6"
                />
                <text
                  x={x}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-zinc-500"
                  style={{ fontSize: 11 }}
                >
                  {formatMinuteAsHm(tick)}
                </text>
              </g>
            );
          })}

          <text
            x={16}
            y={PAD.top + PLOT_H / 2}
            textAnchor="middle"
            transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}
            className="fill-zinc-500"
            style={{ fontSize: 11 }}
          >
            pphpd
          </text>

          {/* 面積 + 供給折線 */}
          {areaPath ? <path d={areaPath} fill="url(#capacityAreaFill)" /> : null}
          {linePath ? (
            <path
              d={linePath}
              fill="none"
              stroke="#7CB8FF"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {/* 各時段要求運能：細虛線（與下方色帶同色）＋中段標註 */}
          {bands.map((band) => {
            if (!(band.capacityPphpd > 0)) return null;
            const x1 = xForMinute(band.startMinute);
            const x2 = xForMinute(band.endMinute);
            const y = yForPphpd(band.capacityPphpd, axisMax);
            const midX = (x1 + x2) / 2;
            const label = band.capacityPphpd.toLocaleString('en-US');
            const bandWidth = x2 - x1;
            // 過窄時段略過文字，避免擠成一團
            if (bandWidth < 28) {
              return (
                <line
                  key={`target-${band.attributeId}-${band.startMinute}-${band.endMinute}`}
                  x1={x1}
                  x2={x2}
                  y1={y}
                  y2={y}
                  stroke={band.color}
                  strokeWidth={1.25}
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                  opacity={0.9}
                />
              );
            }
            const labelW = Math.min(bandWidth - 6, Math.max(28, label.length * 7));
            return (
              <g key={`target-${band.attributeId}-${band.startMinute}-${band.endMinute}`}>
                <line
                  x1={x1}
                  x2={x2}
                  y1={y}
                  y2={y}
                  stroke={band.color}
                  strokeWidth={1.25}
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                  opacity={0.9}
                />
                <rect
                  x={midX - labelW / 2}
                  y={y - 9}
                  width={labelW}
                  height={14}
                  rx={3}
                  fill="#0b0d12"
                  opacity={0.82}
                />
                <text
                  x={midX}
                  y={y + 2}
                  textAnchor="middle"
                  style={{ fontSize: 10, fontWeight: 600, fill: band.color }}
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* 時段色帶 */}
          {bands.map((band) => {
            const x = xForMinute(band.startMinute);
            const w = Math.max(1, xForMinute(band.endMinute) - x);
            return (
              <rect
                key={`${band.attributeId}-${band.startMinute}`}
                x={x}
                y={PAD.top + PLOT_H + 8}
                width={w}
                height={BAND_H}
                fill={band.color}
                opacity={0.85}
                rx={2}
              />
            );
          })}

          {/* Hover 十字線 */}
          {hoverSample ? (
            <g>
              <line
                x1={xForMinute(hoverSample.minute)}
                x2={xForMinute(hoverSample.minute)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="rgba(255,255,255,0.55)"
                strokeDasharray="4 4"
              />
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={yForPphpd(hoverSample.pphpd, axisMax)}
                y2={yForPphpd(hoverSample.pphpd, axisMax)}
                stroke="rgba(255,255,255,0.35)"
                strokeDasharray="4 4"
              />
              {hoverBand != null && hoverBand.capacityPphpd > 0 ? (
                <circle
                  cx={xForMinute(hoverSample.minute)}
                  cy={yForPphpd(hoverBand.capacityPphpd, axisMax)}
                  r={3.5}
                  fill={hoverBand.color}
                  stroke="#0b0d12"
                  strokeWidth={1.5}
                />
              ) : null}
              <circle
                cx={xForMinute(hoverSample.minute)}
                cy={yForPphpd(hoverSample.pphpd, axisMax)}
                r={4}
                fill="#7CB8FF"
                stroke="#0b0d12"
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>

        {hoverSample ? (
          <div
            className="pointer-events-none absolute z-10 min-w-[168px] max-w-[260px] rounded-lg border border-zinc-700/80 bg-[#141820]/95 px-3 py-2 shadow-lg backdrop-blur-sm"
            style={{
              left: `${(tooltipLeft / CHART_WIDTH) * 100}%`,
              top: `${(tooltipTop / CHART_HEIGHT) * 100}%`,
            }}
          >
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-zinc-100">
              <span
                className="inline-block h-3 w-1 rounded-sm"
                style={{ backgroundColor: hoverBand?.color ?? '#7CB8FF' }}
              />
              <span className="truncate">{hoverBand?.name ?? '無時段屬性'}</span>
              <span className="ml-auto tabular-nums text-zinc-400">
                {formatMinuteAsHm(hoverSample.minute)}
              </span>
            </div>
            <p className="text-xs text-zinc-300">
              等效班距{' '}
              <span className="tabular-nums text-zinc-100">
                {formatDirectionalHeadwayTooltip(hoverSample.headwayByDirection)
                  ?? (hoverSample.headwaySeconds != null
                    ? `${hoverSample.headwaySeconds.toLocaleString('en-US')} 秒`
                    : '—')}
              </span>
              {hoverBand?.headwaySeconds != null ? (
                <span className="ml-1 text-zinc-500">
                  （目標 {hoverBand.headwaySeconds.toLocaleString('en-US')} 秒）
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-zinc-300">
              供給{' '}
              <span className="tabular-nums text-zinc-100">
                {hoverSample.pphpd.toLocaleString('en-US')} pphpd
              </span>
              {hoverBand != null && hoverBand.capacityPphpd > 0 ? (
                <span className="ml-1 text-zinc-500">
                  ／要求{' '}
                  <span
                    className="tabular-nums"
                    style={{ color: hoverBand.color }}
                  >
                    {hoverBand.capacityPphpd.toLocaleString('en-US')}
                  </span>
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              在跑正線{' '}
              <span className="tabular-nums text-zinc-400">
                {hoverSample.activeVehicleCount.toLocaleString('en-US')} 台
              </span>
              <span className="ml-1">（參考）</span>
            </p>
            {capacityGapHint ? (
              <p className="mt-1.5 max-w-[220px] text-[11px] leading-snug text-amber-200/90">
                {capacityGapHint}
              </p>
            ) : null}
          </div>
        ) : null}

        {series.departureCount < 2 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0b0d12]/70 text-sm text-zinc-500">
            需要至少兩趟正線發車才能繪製運能趨勢
          </div>
        ) : null}
      </div>
    </div>
  );
}
