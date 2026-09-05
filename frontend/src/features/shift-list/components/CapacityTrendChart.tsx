import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute, ShiftScheduleServiceDirectionTag } from '../types/create';
import type { GeneratedSchedulePlan } from '../utils/shiftScheduleEngine.types';
import {
  buildCapacityPeriodBands,
  buildCapacityTrendFromPlan,
  CAPACITY_DAY_MINUTES,
  formatMinuteAsHm,
  resolveCapacityAxisMax,
  resolveCapacityPeriodAtMinute,
  formatRouteStreamHeadwayTooltip,
  formatCapacityGapHint,
  type CapacityTrendSample,
  type CapacityRouteStream,
} from '../utils/buildCapacityTrend';

type CapacityTrendChartProps = {
  plan: GeneratedSchedulePlan | null | undefined;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  /** 時間模板車體載運量（人／車） */
  vehicleCapacity: number;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  /** Step 4 服務方向標籤（運能流顯示名稱） */
  serviceDirectionTags?: ShiftScheduleServiceDirectionTag[];
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

function buildStreamLinePath(
  samples: CapacityTrendSample[],
  streamKey: string,
  axisMax: number,
): string {
  const points: Array<{ minute: number; pphpd: number }> = [];
  for (const sample of samples) {
    const pphpd = sample.pphpdByStream[streamKey];
    if (pphpd == null) continue;
    points.push({ minute: sample.minute, pphpd });
  }
  if (points.length === 0) return '';
  return points
    .map((point, index) => {
      const x = xForMinute(point.minute);
      const y = yForPphpd(point.pphpd, axisMax);
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

function streamHasDrawableLine(
  samples: CapacityTrendSample[],
  stream: CapacityRouteStream,
): boolean {
  return samples.some((sample) => sample.pphpdByStream[stream.streamKey] != null);
}

export function CapacityTrendChart({
  plan,
  intervals,
  attributes,
  vehicleCapacity,
  selectedRoutes,
  serviceDirectionTags,
  className = '',
}: CapacityTrendChartProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverMinute, setHoverMinute] = useState<number | null>(null);
  const [hiddenStreamKeys, setHiddenStreamKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleStreamVisibility = (streamKey: string) => {
    setHiddenStreamKeys((previous) => {
      const next = new Set(previous);
      if (next.has(streamKey)) {
        next.delete(streamKey);
      } else {
        next.add(streamKey);
      }
      return next;
    });
  };

  const series = useMemo(
    () =>
      buildCapacityTrendFromPlan({
        plan,
        vehicleCapacity: Number.isFinite(vehicleCapacity) && vehicleCapacity > 0
          ? vehicleCapacity
          : 50,
        selectedRoutes,
        serviceDirectionTags,
        viewMode: 'serviceDirection',
        sampleStepMinutes: 1,
      }),
    [plan, vehicleCapacity, selectedRoutes, serviceDirectionTags],
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

  const drawableStreams = useMemo(
    () => series.streams.filter((stream) => streamHasDrawableLine(series.samples, stream)),
    [series.samples, series.streams],
  );

  const visibleStreams = useMemo(
    () => drawableStreams.filter((stream) => !hiddenStreamKeys.has(stream.streamKey)),
    [drawableStreams, hiddenStreamKeys],
  );

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
      : Math.max(8, yForPphpd(Math.max(hoverSample.pphpd, 1), axisMax) - 96);

  const capacityGapHint =
    hoverSample == null
      ? null
      : formatCapacityGapHint({
          actualPphpd: hoverSample.pphpd,
          targetPphpd: hoverBand?.capacityPphpd,
          actualHeadwaySeconds: hoverSample.headwaySeconds,
          targetHeadwaySeconds: hoverBand?.headwaySeconds,
        });

  const canDraw = drawableStreams.length > 0;

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-[#0b0d12]">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {drawableStreams.map((stream) => {
              const hidden = hiddenStreamKeys.has(stream.streamKey);
              return (
                <button
                  key={stream.streamKey}
                  type="button"
                  onClick={() => toggleStreamVisibility(stream.streamKey)}
                  aria-pressed={!hidden}
                  title={hidden ? t('shiftList.capacityTrend.showStream', { label: stream.label }) : t('shiftList.capacityTrend.hideStream', { label: stream.label })}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
                    hidden
                      ? 'border-zinc-800 bg-transparent text-zinc-600 hover:text-zinc-400'
                      : 'border-zinc-800/80 bg-zinc-900/70 text-zinc-300 hover:text-zinc-100'
                  }`}
                >
                  <span
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{
                      backgroundColor: stream.color,
                      opacity: hidden ? 0.35 : 1,
                    }}
                    aria-hidden
                  />
                  <span className="max-w-[180px] truncate">{stream.label}</span>
                  {hidden ? (
                    <EyeOff className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <Eye className="size-3.5 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full select-none"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverMinute(null)}
          role="img"
          aria-label={t('shiftList.capacityTrend.chartAria')}
        >
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

          {visibleStreams.map((stream) => {
            const path = buildStreamLinePath(series.samples, stream.streamKey, axisMax);
            if (!path) return null;
            return (
              <path
                key={`line-${stream.streamKey}`}
                d={path}
                fill="none"
                stroke={stream.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {bands.map((band) => {
            if (!(band.capacityPphpd > 0)) return null;
            const x1 = xForMinute(band.startMinute);
            const x2 = xForMinute(band.endMinute);
            const y = yForPphpd(band.capacityPphpd, axisMax);
            const midX = (x1 + x2) / 2;
            const label = band.capacityPphpd.toLocaleString('en-US');
            const bandWidth = x2 - x1;
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
              {visibleStreams.map((stream) => {
                const pphpd = hoverSample.pphpdByStream[stream.streamKey];
                if (pphpd == null) return null;
                return (
                  <circle
                    key={`dot-${stream.streamKey}`}
                    cx={xForMinute(hoverSample.minute)}
                    cy={yForPphpd(pphpd, axisMax)}
                    r={4}
                    fill={stream.color}
                    stroke="#0b0d12"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          ) : null}
        </svg>

        {hoverSample ? (
          <div
            className="pointer-events-none absolute z-10 min-w-[168px] max-w-[280px] rounded-lg border border-zinc-700/80 bg-[#141820]/95 px-3 py-2 shadow-lg backdrop-blur-sm"
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
              <span className="truncate">{hoverBand?.name ?? t('shiftList.capacityTrend.noBand')}</span>
              <span className="ml-auto tabular-nums text-zinc-400">
                {formatMinuteAsHm(hoverSample.minute)}
              </span>
            </div>
            <p className="text-xs text-zinc-300">
              {t('shiftList.capacityTrend.headway')}{' '}
              <span className="tabular-nums text-zinc-100">
                {formatRouteStreamHeadwayTooltip(
                  hoverSample.headwayByStream,
                  visibleStreams,
                )
                  ?? (hoverSample.headwaySeconds != null
                    ? t('shiftList.capacityTrend.seconds', { value: hoverSample.headwaySeconds.toLocaleString('en-US') })
                    : '—')}
              </span>
              {hoverBand?.headwaySeconds != null ? (
                <span className="ml-1 text-zinc-500">
                  {t('shiftList.capacityTrend.targetSeconds', { value: hoverBand.headwaySeconds.toLocaleString('en-US') })}
                </span>
              ) : null}
            </p>
            <div className="mt-0.5 space-y-0.5 text-xs text-zinc-300">
              {visibleStreams.map((stream) => {
                const pphpd = hoverSample.pphpdByStream[stream.streamKey];
                if (pphpd == null) return null;
                return (
                  <p key={`tip-${stream.streamKey}`} className="flex items-center gap-1.5">
                    <span
                      className="inline-block size-1.5 rounded-full"
                      style={{ backgroundColor: stream.color }}
                      aria-hidden
                    />
                    <span className="truncate text-zinc-400">{stream.label}</span>
                    <span className="ml-auto tabular-nums text-zinc-100">
                      {pphpd.toLocaleString('en-US')} pphpd
                    </span>
                  </p>
                );
              })}
              {hoverBand != null && hoverBand.capacityPphpd > 0 ? (
                <p className="text-zinc-500">
                  {t('shiftList.capacityTrend.required')}{' '}
                  <span className="tabular-nums" style={{ color: hoverBand.color }}>
                    {hoverBand.capacityPphpd.toLocaleString('en-US')}
                  </span>
                </p>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {t('shiftList.capacityTrend.activeMainline')}{' '}
              <span className="tabular-nums text-zinc-400">
                {t('shiftList.capacityTrend.vehicles', { count: hoverSample.activeVehicleCount.toLocaleString('en-US') })}
              </span>
              <span className="ml-1">{t('shiftList.capacityTrend.reference')}</span>
            </p>
            {capacityGapHint ? (
              <p className="mt-1.5 max-w-[240px] text-[11px] leading-snug text-amber-200/90">
                {capacityGapHint}
              </p>
            ) : null}
          </div>
        ) : null}

        {!canDraw ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0b0d12]/70 px-6 text-center text-sm text-zinc-500">
            {series.passengerBlockCount >= 2
              ? t('shiftList.capacityTrend.needMoreSameDirection')
              : t('shiftList.capacityTrend.needTwoTrips')}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
