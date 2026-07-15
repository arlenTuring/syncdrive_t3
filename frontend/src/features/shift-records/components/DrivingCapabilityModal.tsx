import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  Loader2,
  Music2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { fetchShiftRecordDetail } from '../api/shiftRecordsApi';
import {
  buildDrivingCapabilityModel,
  filterEventsByLane,
  type DrivingCapabilityModel,
  type TaskLaneFilter,
  type TimelineEvent,
  type TimelineEventKind,
} from '../utils/buildDrivingCapabilityModel';

type DrivingCapabilityModalProps = {
  orderId: string;
  onClose: () => void;
};

const LANE_FILTERS: Array<{ value: TaskLaneFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'main', label: '主任務' },
  { value: 'secondary', label: '次任務' },
];

const PX_PER_MINUTE = 108;
const LANE_LABEL_W = 72;

function msToLeft(ms: number, model: DrivingCapabilityModel): number {
  return ((ms - model.rangeStartMs) / 60_000) * PX_PER_MINUTE;
}

function timelineWidth(model: DrivingCapabilityModel): number {
  const minutes = model.durationMinutes + 1;
  return Math.max(minutes * PX_PER_MINUTE, 480);
}

function minuteTicks(model: DrivingCapabilityModel): number[] {
  const count = model.durationMinutes + 1;
  return Array.from({ length: count }, (_, i) => i);
}

function formatAxisMinute(model: DrivingCapabilityModel, offsetMin: number): string {
  const ms = model.rangeStartMs + offsetMin * 60_000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatEventTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function EventIcon({ kind }: { kind: TimelineEventKind }) {
  if (kind === 'depart') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/50">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (kind === 'door_open') {
    return (
      <span className="flex size-5 items-center justify-center rounded bg-sky-500/15 ring-1 ring-sky-500/40">
        <span className="h-2.5 w-3 rounded-sm border border-sky-400" />
      </span>
    );
  }
  if (kind === 'door_close') {
    return (
      <span className="flex size-5 items-center justify-center rounded bg-sky-500/15 ring-1 ring-sky-500/40">
        <span className="h-2.5 w-3 rounded-sm bg-sky-400/80" />
      </span>
    );
  }
  if (kind === 'alarm') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-red-500/20 text-red-400">
        <AlertTriangle className="size-3" />
      </span>
    );
  }
  if (kind === 'broadcast') {
    return <Music2 className="size-3 text-zinc-500" />;
  }
  return <span className="size-2 rounded-full bg-zinc-500" />;
}

function TimelineEventNode({ event, model }: { event: TimelineEvent; model: DrivingCapabilityModel }) {
  const left = msToLeft(event.atMs, model);
  const isMain = event.lane === 'main';

  return (
    <div
      className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left }}
      title={`${formatEventTime(event.atMs)} ${event.label}`}
    >
      <div className={`flex flex-col items-center gap-0.5 ${isMain ? 'min-w-[88px]' : 'min-w-[72px]'}`}>
        {isMain ? <EventIcon kind={event.kind} /> : <EventIcon kind={event.kind} />}
        <span className="whitespace-nowrap font-mono text-[10px] text-zinc-500">
          {formatEventTime(event.atMs)}
        </span>
        <span
          className={`whitespace-nowrap text-center text-[10px] leading-tight ${
            isMain ? 'text-zinc-200' : 'text-zinc-500'
          }`}
        >
          {event.label}
        </span>
      </div>
    </div>
  );
}

function StatusBarRow({
  model,
  filter,
}: {
  model: DrivingCapabilityModel;
  filter: TaskLaneFilter;
}) {
  if (filter === 'secondary') return <div className="h-9" />;

  const width = timelineWidth(model);
  return (
    <div className="relative h-9" style={{ width }}>
      {model.statusSegments.map((seg) => {
        const left = msToLeft(seg.fromMs, model);
        const w = Math.max(4, msToLeft(seg.toMs, model) - left);
        const bg =
          seg.tone === 'green'
            ? 'bg-emerald-500/35 border-emerald-500/50'
            : seg.tone === 'blue'
              ? 'bg-sky-500/35 border-sky-500/50'
              : 'bg-red-500/35 border-red-500/50';
        return (
          <div
            key={seg.id}
            className={`absolute top-1 flex h-7 items-center justify-center rounded border px-2 text-[11px] text-zinc-100 ${bg}`}
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
  lane,
  events,
}: {
  model: DrivingCapabilityModel;
  lane: 'main' | 'secondary';
  events: TimelineEvent[];
}) {
  const width = timelineWidth(model);
  const laneEvents = events.filter((e) => e.lane === lane);
  const lineClass =
    lane === 'main'
      ? 'border-t-2 border-solid border-sky-500'
      : 'border-t-2 border-dashed border-zinc-600';

  return (
    <div className="relative h-16" style={{ width }}>
      <div className={`absolute left-0 right-0 top-1/2 ${lineClass}`} />
      {laneEvents.map((ev) => (
        <TimelineEventNode key={ev.id} event={ev} model={model} />
      ))}
    </div>
  );
}

function TimelinePanel({ model, filter }: { model: DrivingCapabilityModel; filter: TaskLaneFilter }) {
  const events = useMemo(() => filterEventsByLane(model.events, filter), [model.events, filter]);
  const width = timelineWidth(model);
  const ticks = minuteTicks(model);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
      <div className="flex min-h-0 flex-1">
        <div
          className="shrink-0 border-r border-zinc-800/80 bg-zinc-950/60 pt-8 text-[11px] text-zinc-500"
          style={{ width: LANE_LABEL_W }}
        >
          {filter !== 'secondary' && (
            <div className="flex h-9 items-center justify-end pr-2">狀態</div>
          )}
          {(filter === 'all' || filter === 'main') && (
            <div className="flex h-16 items-center justify-end pr-2">主任務</div>
          )}
          {(filter === 'all' || filter === 'secondary') && (
            <div className="flex h-16 items-center justify-end pr-2">次任務</div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: width + 24, minWidth: '100%' }} className="px-3 pb-2 pt-3">
            <div className="relative mb-2 h-5 border-b border-zinc-800/60" style={{ width }}>
              {ticks.map((i) => (
                <span
                  key={i}
                  className="absolute -translate-x-1/2 font-mono text-[10px] text-zinc-500"
                  style={{ left: i * PX_PER_MINUTE }}
                >
                  {formatAxisMinute(model, i)}
                </span>
              ))}
            </div>

            <StatusBarRow model={model} filter={filter} />
            {(filter === 'all' || filter === 'main') && (
              <TaskTrackRow model={model} lane="main" events={events} />
            )}
            {(filter === 'all' || filter === 'secondary') && (
              <TaskTrackRow model={model} lane="secondary" events={events} />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-zinc-800/60 px-4 py-2 text-[11px] text-zinc-500">
        <Info className="size-3.5 shrink-0" />
        時軸可以左右滑動，查看更多任務
        <span className="text-zinc-600">← →</span>
      </div>
    </div>
  );
}

function TimelineLegend() {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">任務時間軸</h3>
      <div className="grid gap-2 text-[11px] text-zinc-400 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-8 border-t-2 border-sky-500" />
          主任務
        </div>
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-8 border-t-2 border-dashed border-zinc-500" />
          次任務
        </div>
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-8 border-t-2 border-red-500" />
          主任務（加速時段）
        </div>
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-8 border-t-2 border-dashed border-red-500" />
          次任務（加速時段）
        </div>
        <div className="flex items-center gap-2">
          <EventIcon kind="door_open" />
          開門
        </div>
        <div className="flex items-center gap-2">
          <EventIcon kind="door_close" />
          關門
        </div>
        <div className="flex items-center gap-2">
          <EventIcon kind="alarm" />
          告警
        </div>
      </div>
    </div>
  );
}

function TimelineSummary({ model }: { model: DrivingCapabilityModel }) {
  const [open, setOpen] = useState(true);
  const punctualityClass =
    model.punctuality === '準時'
      ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
      : model.punctuality === '延誤'
        ? 'bg-orange-500/15 text-orange-400 ring-orange-500/30'
        : 'bg-zinc-700/40 text-zinc-400 ring-zinc-600/40';

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-medium text-zinc-300">任務時間軸</h3>
        {open ? <ChevronUp className="size-4 text-zinc-500" /> : <ChevronDown className="size-4 text-zinc-500" />}
      </button>
      {open && (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">計劃時間</dt>
            <dd className="font-mono text-zinc-200">{model.plannedDurationHms}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">實際時間</dt>
            <dd className="font-mono text-zinc-200">{model.actualDurationHms}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">狀態類型</dt>
            <dd>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${punctualityClass}`}>
                {model.punctuality}
              </span>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export function DrivingCapabilityModal({ orderId, onClose }: DrivingCapabilityModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskLaneFilter>('all');
  const [model, setModel] = useState<DrivingCapabilityModel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchShiftRecordDetail(orderId);
      setModel(buildDrivingCapabilityModel(detail));
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
        aria-labelledby="driving-capability-title"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0c0e] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-5 py-4">
          <div className="min-w-0 space-y-3">
            <h2 id="driving-capability-title" className="text-base font-semibold text-zinc-100">
              行車能力監控
            </h2>
            {model && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-sky-600 px-2 py-0.5 font-mono text-sm font-semibold text-white">
                    {model.tripCode}
                  </span>
                  <span className="text-sm text-zinc-300">{model.routeEndpoints}</span>
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    # {model.directionLabel}
                  </span>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Clock className="size-3.5 shrink-0" aria-hidden />
                  {model.timeRangeLabel}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4">
          {loading && (
            <div className="flex flex-1 items-center justify-center gap-2 py-16 text-zinc-500">
              <Loader2 className="size-5 animate-spin" />
              載入中…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {model && !loading && (
            <>
              <div className="inline-flex w-fit rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                {LANE_FILTERS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFilter(opt.value)}
                    className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                      filter === opt.value
                        ? 'bg-zinc-700 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <TimelinePanel model={model} filter={filter} />

              <div className="grid shrink-0 gap-3 sm:grid-cols-2">
                <TimelineLegend />
                <TimelineSummary model={model} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
