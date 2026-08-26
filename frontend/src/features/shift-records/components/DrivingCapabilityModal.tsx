import {
  Clock,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { fetchShiftRecordDetail } from '../api/shiftRecordsApi';
import {
  buildDrivingCapabilityModel,
  filterEventsByLane,
  iconUrlForTimelineKind,
  type DrivingCapabilityModel,
  type TaskLaneFilter,
  type TimelineEvent,
  type TimelineEventKind,
} from '../utils/buildDrivingCapabilityModel';

/** 圖例順序對齊設計稿：線型 → 常用動作 → 號誌／告警 → 整備類 */
const LEGEND_ITEMS: Array<{ kind: TimelineEventKind; label: string; channel?: 'action' | 'event' }> = [
  { kind: 'music', label: '音樂' },
  { kind: 'enter', label: '進站' },
  { kind: 'exit', label: '出站' },
  { kind: 'door_open', label: '開門' },
  { kind: 'door_close', label: '關門' },
  { kind: 'signal', label: '號誌', channel: 'event' },
  { kind: 'alert', label: '告警', channel: 'event' },
  { kind: 'dispatch', label: '調度' },
  { kind: 'charging', label: '充電' },
  { kind: 'wash', label: '洗車' },
  { kind: 'maintenance', label: '保養' },
  { kind: 'repair', label: '維修' },
  { kind: 'parking', label: '臨停' },
];

type DrivingCapabilityModalProps = {
  orderId: string;
  onClose: () => void;
};

const CHANNEL_FILTERS: Array<{ value: TaskLaneFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'action', label: '動作' },
  { value: 'event', label: '事件' },
];

/** 設計稿：刻度對齊節點、可左右滑動；約 40s 視覺間距 */
const PX_PER_MINUTE = 140;
const LANE_LABEL_W = 48;
const AXIS_H = 24;
const STATUS_H = 32;
const NODE_SIZE = 36;
const NODE_INNER = 22;
const MIN_NODE_GAP = 108;
const LINE_Y = 22;
const LANE_H = 100;
const AXIS_LABEL_MIN_GAP = 56;
const LINE_Z = 5;
const NODE_INNER_Z = 10;

function msToLeft(ms: number, model: DrivingCapabilityModel): number {
  return ((ms - model.rangeStartMs) / 60_000) * PX_PER_MINUTE;
}

function timelineWidth(model: DrivingCapabilityModel): number {
  const spanMinutes = (model.rangeEndMs - model.rangeStartMs) / 60_000;
  return Math.max(spanMinutes * PX_PER_MINUTE + 80, 880);
}

function layoutLaneLefts(events: TimelineEvent[], model: DrivingCapabilityModel): Map<string, number> {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
  const lefts = new Map<string, number>();
  let prev = Number.NEGATIVE_INFINITY;
  for (const event of sorted) {
    const natural = msToLeft(event.atMs, model);
    const left = Math.max(natural, prev + MIN_NODE_GAP);
    lefts.set(event.id, left);
    prev = left;
  }
  return lefts;
}

function formatEventTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** 整分省略秒；其餘完整（對齊設計稿 06:00 / 06:00:40） */
function formatAxisTick(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = d.getSeconds();
  if (ss === 0) return `${hh}:${mm}`;
  return `${hh}:${mm}:${String(ss).padStart(2, '0')}`;
}

type AxisTick = { key: string; ms: number; left: number };

/**
 * 設計稿時間軸：
 * 1) 起迄 + 等距填補刻度（真實時間）
 * 2) 每個動作／事件節點各一格（用碰撞佈局 left，確保看得見）
 */
function buildAxisTicks(
  model: DrivingCapabilityModel,
  eventLeftById: Map<string, number>,
): AxisTick[] {
  const span = Math.max(1, model.rangeEndMs - model.rangeStartMs);
  const stepMs =
    span > 30 * 60_000 ? 60_000 : span > 12 * 60_000 ? 40_000 : span > 5 * 60_000 ? 30_000 : 20_000;

  const candidates: AxisTick[] = [
    {
      key: 'range-start',
      ms: model.rangeStartMs,
      left: msToLeft(model.rangeStartMs, model),
    },
  ];

  const firstStep = Math.ceil(model.rangeStartMs / stepMs) * stepMs;
  for (let t = firstStep; t < model.rangeEndMs - stepMs / 4; t += stepMs) {
    if (t <= model.rangeStartMs + 5_000) continue;
    candidates.push({
      key: `interval-${t}`,
      ms: t,
      left: msToLeft(t, model),
    });
  }

  for (const event of model.events) {
    const left = eventLeftById.get(event.id);
    if (left == null) continue;
    candidates.push({
      key: `event-${event.id}`,
      ms: event.atMs,
      left,
    });
  }

  candidates.push({
    key: 'range-end',
    ms: model.rangeEndMs,
    left: msToLeft(model.rangeEndMs, model),
  });

  // 先保留節點刻度，再填區間刻度；過近則丟棄較弱者
  const sorted = [...candidates].sort((a, b) => a.left - b.left || a.ms - b.ms);
  const out: AxisTick[] = [];
  for (const tick of sorted) {
    const isEvent = tick.key.startsWith('event-');
    const last = out[out.length - 1];
    if (!last) {
      out.push(tick);
      continue;
    }
    if (tick.left - last.left >= AXIS_LABEL_MIN_GAP) {
      out.push(tick);
      continue;
    }
    // 過近：優先保留「事件節點」刻度
    if (isEvent && !last.key.startsWith('event-')) {
      out[out.length - 1] = tick;
    }
  }
  return out;
}

function nodeTone(kind: TimelineEventKind, channel: 'action' | 'event') {
  const alarm = kind === 'alert' || kind === 'signal' || channel === 'event';
  return {
    alarm,
    ring: alarm ? 'ring-zinc-400/65' : 'ring-[#51A2FF]/75',
    glow: alarm
      ? 'shadow-[0_0_0_7px_rgba(161,161,170,0.14)]'
      : 'shadow-[0_0_0_7px_rgba(43,127,255,0.18)]',
    core: alarm ? 'bg-[#52525b]' : 'bg-[#2563eb]',
  };
}

/** 圖例用完整節點（外圈光暈 + 內圓）；時軸用分層繪製讓線穿過 */
function EventIcon({
  kind,
  iconUrl,
  channel = 'action',
  size = NODE_SIZE,
  innerSize = NODE_INNER,
}: {
  kind: TimelineEventKind;
  iconUrl?: string | null;
  channel?: 'action' | 'event';
  size?: number;
  innerSize?: number;
}) {
  const src = iconUrl || iconUrlForTimelineKind(kind);
  const tone = nodeTone(kind, channel);
  return (
    <span
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span
        className={`pointer-events-none absolute inset-0 rounded-full bg-transparent ring-[1.5px] ${tone.ring} ${tone.glow}`}
      />
      <span
        className={`relative flex items-center justify-center rounded-full ${tone.core}`}
        style={{ width: innerSize, height: innerSize }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className="object-contain brightness-0 invert"
            style={{ width: innerSize - 8, height: innerSize - 8 }}
          />
        ) : (
          <span className="size-1.5 rounded-full bg-white" />
        )}
      </span>
    </span>
  );
}

function NodeHalo({
  left,
  kind,
  channel,
}: {
  left: number;
  kind: TimelineEventKind;
  channel: 'action' | 'event';
}) {
  const tone = nodeTone(kind, channel);
  return (
    <span
      className={`pointer-events-none absolute -translate-x-1/2 rounded-full bg-transparent ring-[1.5px] ${tone.ring} ${tone.glow}`}
      style={{
        left,
        top: LINE_Y - NODE_SIZE / 2,
        width: NODE_SIZE,
        height: NODE_SIZE,
        zIndex: 1,
      }}
      aria-hidden
    />
  );
}

function TimelineEventNode({
  event,
  left,
  selected,
  onSelect,
}: {
  event: TimelineEvent;
  left: number;
  selected: boolean;
  onSelect: (event: TimelineEvent) => void;
}) {
  const src = event.iconUrl || iconUrlForTimelineKind(event.kind);
  const tone = nodeTone(event.kind, event.channel);

  return (
    <button
      type="button"
      className={`absolute flex -translate-x-1/2 flex-col items-center ${
        selected ? 'brightness-125' : ''
      }`}
      style={{
        left,
        top: LINE_Y - NODE_SIZE / 2,
        zIndex: NODE_INNER_Z,
      }}
      title={`${formatEventTime(event.atMs)} ${event.label}`}
      onClick={() => onSelect(event)}
    >
      {/* 內圓疊在軌道線之上；外圈由 NodeHalo 畫在線下 */}
      <span
        className="relative flex items-center justify-center"
        style={{ width: NODE_SIZE, height: NODE_SIZE }}
      >
        <span
          className={`flex items-center justify-center rounded-full ${tone.core}`}
          style={{ width: NODE_INNER, height: NODE_INNER }}
        >
          {src ? (
            <img
              src={src}
              alt=""
              className="object-contain brightness-0 invert"
              style={{ width: NODE_INNER - 8, height: NODE_INNER - 8 }}
            />
          ) : (
            <span className="size-1.5 rounded-full bg-white" />
          )}
        </span>
      </span>
      <span className="mt-2 flex w-[96px] flex-col items-center gap-0.5">
        <span className="font-mono text-[10px] leading-none text-zinc-400">
          {formatEventTime(event.atMs)}
        </span>
        <span className="line-clamp-2 text-center text-[11px] leading-tight text-zinc-100">
          {event.label}
        </span>
        {event.delayLabel ? (
          <span className="rounded bg-[#422006] px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
            {event.delayLabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function StatusBarRow({
  model,
  filter,
  width,
}: {
  model: DrivingCapabilityModel;
  filter: TaskLaneFilter;
  width: number;
}) {
  if (filter === 'event') return null;

  return (
    <div className="relative" style={{ width, height: STATUS_H }}>
      {model.statusSegments.map((seg, index) => {
        const left = msToLeft(seg.fromMs, model);
        const right = msToLeft(seg.toMs, model);
        const w = Math.max(12, right - left);
        const bg =
          seg.tone === 'green'
            ? 'bg-[#22C55E]'
            : seg.tone === 'blue'
              ? 'bg-[#38BDF8]'
              : 'bg-red-500';
        const isFirst = index === 0;
        const isLast = index === model.statusSegments.length - 1;
        return (
          <div
            key={seg.id}
            className={`absolute top-1 flex h-6 items-center justify-center px-2 text-[11px] font-medium text-white ${bg} ${
              isFirst ? 'rounded-l-md' : ''
            } ${isLast ? 'rounded-r-md' : ''}`}
            style={{ left, width: w }}
          >
            <span className="truncate">{seg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function TaskTrackRow({
  model,
  channel,
  events,
  width,
  selectedId,
  onSelect,
  lefts: leftsProp,
}: {
  model: DrivingCapabilityModel;
  channel: 'action' | 'event';
  events: TimelineEvent[];
  width: number;
  selectedId: string | null;
  onSelect: (event: TimelineEvent) => void;
  lefts?: Map<string, number>;
}) {
  const laneEvents = events.filter((e) => e.channel === channel);
  const lefts = leftsProp ?? layoutLaneLefts(laneEvents, model);
  const dashed = channel === 'event';

  return (
    <div className="relative" style={{ width, height: LANE_H }}>
      {laneEvents.map((ev) => (
        <NodeHalo
          key={`halo-${ev.id}`}
          left={lefts.get(ev.id) ?? 0}
          kind={ev.kind}
          channel={ev.channel}
        />
      ))}

      <div
        className="pointer-events-none absolute left-0 right-0"
        style={{
          top: LINE_Y - 1,
          height: 2,
          zIndex: LINE_Z,
          ...(dashed
            ? {
                backgroundImage:
                  'repeating-linear-gradient(to right, #a1a1aa 0 6px, transparent 6px 11px)',
              }
            : { backgroundColor: '#3B82F6' }),
        }}
      />

      {laneEvents.map((ev) => (
        <TimelineEventNode
          key={ev.id}
          event={ev}
          left={lefts.get(ev.id) ?? 0}
          selected={selectedId === ev.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TimelinePanel({
  model,
  filter,
  selectedId,
  onSelect,
}: {
  model: DrivingCapabilityModel;
  filter: TaskLaneFilter;
  selectedId: string | null;
  onSelect: (event: TimelineEvent) => void;
}) {
  const events = useMemo(() => filterEventsByLane(model.events, filter), [model.events, filter]);
  const actionEvents = useMemo(
    () => events.filter((e) => e.channel === 'action'),
    [events],
  );
  const eventEvents = useMemo(
    () => events.filter((e) => e.channel === 'event'),
    [events],
  );

  const actionLefts = useMemo(
    () => layoutLaneLefts(actionEvents, model),
    [actionEvents, model],
  );
  const eventLefts = useMemo(
    () => layoutLaneLefts(eventEvents, model),
    [eventEvents, model],
  );

  const eventLeftById = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, left] of actionLefts) map.set(id, left);
    for (const [id, left] of eventLefts) map.set(id, left);
    return map;
  }, [actionLefts, eventLefts]);

  const width = useMemo(() => {
    const base = timelineWidth(model);
    let maxLeft = base;
    for (const left of eventLeftById.values()) maxLeft = Math.max(maxLeft, left + 64);
    return maxLeft;
  }, [eventLeftById, model]);

  const ticks = useMemo(
    () => buildAxisTicks(model, eventLeftById),
    [model, eventLeftById],
  );

  const showStatus = filter !== 'event';
  const showAction = filter === 'all' || filter === 'action';
  const showEvent = filter === 'all' || filter === 'event';

  const bodyH =
    (showStatus ? STATUS_H + 8 : 0)
    + (showAction ? LANE_H : 0)
    + (showEvent ? LANE_H : 0);
  const labelPadTop = AXIS_H + (showStatus ? STATUS_H + 8 : 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/60 bg-[#0c0c0e]/80">
      <div className="flex min-h-0 flex-1">
        <div
          className="shrink-0 text-[12px]"
          style={{ width: LANE_LABEL_W, paddingTop: labelPadTop }}
        >
          {showAction ? (
            <div
              className="flex items-start justify-end border-b border-[#51A2FF]/40 pr-2 font-medium text-[#51A2FF]"
              style={{ height: LANE_H, paddingTop: LINE_Y - 8 }}
            >
              動作
            </div>
          ) : null}
          {showEvent ? (
            <div
              className="flex items-start justify-end border-b border-dashed border-zinc-600 pr-2 text-zinc-200"
              style={{ height: LANE_H, paddingTop: LINE_Y - 8 }}
            >
              事件
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: width + 48, minWidth: '100%' }} className="relative px-3 pb-2 pt-3">
            {/* 時間軸刻度 + 垂直格線（貫穿狀態列／動作／事件） */}
            <div className="relative" style={{ width, height: AXIS_H + bodyH }}>
              {ticks.map((tick) => (
                <div
                  key={`grid-${tick.key}`}
                  className="pointer-events-none absolute top-0 w-px bg-zinc-700/55"
                  style={{ left: tick.left, height: AXIS_H + bodyH }}
                  aria-hidden
                />
              ))}

              <div className="relative z-[1]" style={{ height: AXIS_H }}>
                {ticks.map((tick) => (
                  <span
                    key={tick.key}
                    className="absolute -translate-x-1/2 font-mono text-[10px] tabular-nums text-zinc-300"
                    style={{ left: tick.left }}
                  >
                    {formatAxisTick(tick.ms)}
                  </span>
                ))}
              </div>

              <div className="relative z-[1]">
                {showStatus ? (
                  <div className="mb-2">
                    <StatusBarRow model={model} filter={filter} width={width} />
                  </div>
                ) : null}

                {showAction ? (
                  <div className="rounded-md bg-zinc-900/35">
                    <TaskTrackRow
                      model={model}
                      channel="action"
                      events={events}
                      width={width}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      lefts={actionLefts}
                    />
                  </div>
                ) : null}
                {showEvent ? (
                  <TaskTrackRow
                    model={model}
                    channel="event"
                    events={events}
                    width={width}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    lefts={eventLefts}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-zinc-800/50 px-4 py-2.5 text-[11px] text-zinc-500">
        <Info className="size-3.5 shrink-0" aria-hidden />
        時軸可以左右滑動，查看更多任務
        <span className="text-zinc-600">← →</span>
      </div>
    </div>
  );
}

function LegendLine({
  color,
  dashed,
}: {
  color: string;
  dashed?: boolean;
}) {
  return (
    <span
      className="inline-block w-9"
      style={{
        height: 2,
        backgroundColor: dashed ? 'transparent' : color,
        backgroundImage: dashed
          ? `repeating-linear-gradient(to right, ${color} 0 5px, transparent 5px 9px)`
          : undefined,
      }}
    />
  );
}

function TimelineLegend() {
  return (
    <div className="rounded-xl border border-[#2B7FFF]/35 bg-[#0c0c0e]/60 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5 text-[12px] text-zinc-300">
        <div className="flex items-center gap-2">
          <LegendLine color="#3b82f6" />
          主任務
        </div>
        <div className="flex items-center gap-2">
          <LegendLine color="#a1a1aa" dashed />
          次任務
        </div>
        {LEGEND_ITEMS.map((item) => (
          <div key={item.kind} className="flex items-center gap-2">
            <EventIcon kind={item.kind} channel={item.channel} size={26} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DrivingCapabilityModal({ orderId, onClose }: DrivingCapabilityModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskLaneFilter>('all');
  const [model, setModel] = useState<DrivingCapabilityModel | null>(null);
  const [selected, setSelected] = useState<TimelineEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchShiftRecordDetail(orderId);
      const next = buildDrivingCapabilityModel(detail);
      setModel(next);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.some((t) => t === 'table:operation_orders' || t.includes('operation'))) {
        void load();
      }
    });
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-record-title"
        className="flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#18181b] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="relative shrink-0 px-6 pt-5 pb-1">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <X className="size-5" />
          </button>

          <h2 id="operation-record-title" className="pr-10 text-base font-semibold tracking-wide text-zinc-100">
            運行紀錄
          </h2>

          {model ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pr-8">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-sm text-zinc-200">
                <span className="rounded-md bg-[#2B7FFF] px-2.5 py-0.5 font-mono text-[13px] font-semibold text-white">
                  {model.tripCode}
                </span>
                <span className="truncate">{model.routeEndpoints.replace(/➔|→/g, '→')}</span>
              </div>
              <div className="inline-flex shrink-0 items-center gap-2 text-[12px] text-zinc-400">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                <span className="font-mono tabular-nums">{model.timeRangeLabel}</span>
                <span className="text-zinc-500">總時長 {model.durationMinutes} 分鐘</span>
              </div>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 pt-3 pb-5">
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-16 text-zinc-500">
              <Loader2 className="size-5 animate-spin" />
              載入中…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          {model && !loading ? (
            <>
              {/* 設計稿：連段式 segmented control */}
              <div className="inline-flex w-fit rounded-lg bg-[#27272a] p-0.5">
                {CHANNEL_FILTERS.map((opt) => {
                  const active = filter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFilter(opt.value)}
                      className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                        active
                          ? 'bg-[#3f3f46] text-zinc-100 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <TimelinePanel
                model={model}
                filter={filter}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />

              <div className="shrink-0">
                <TimelineLegend />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
