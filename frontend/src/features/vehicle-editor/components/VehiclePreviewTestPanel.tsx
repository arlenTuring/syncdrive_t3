import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, SkipForward } from 'lucide-react';
import { VEHICLE_BEHAVIOR_ACTION_CATALOG } from '../constants/behaviorActionCatalog';
import {
  VEHICLE_PREVIEW_TEST_INTERVAL_MS,
  VEHICLE_PREVIEW_TEST_SEQUENCE,
} from '../constants/vehiclePreviewTestSequence';
import type { VehicleDefinition } from '../types';
import { readOperationActions } from '../utils/resolveBehaviorActions';

function mergePreviewData(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(base ?? {}), ...patch };
}

export function VehiclePreviewTestPanel({
  vehicle,
  onUpdatePreviewData,
}: {
  vehicle: VehicleDefinition;
  onUpdatePreviewData: (previewData: Record<string, unknown>) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const preview = vehicle.previewData ?? {};
  const currentStep = VEHICLE_PREVIEW_TEST_SEQUENCE[stepIndex];

  const applyStep = useCallback(
    (index: number) => {
      const step = VEHICLE_PREVIEW_TEST_SEQUENCE[index];
      if (!step) return;
      setStepIndex(index);
      onUpdatePreviewData(mergePreviewData(vehicle.previewData, step.data));
    },
    [onUpdatePreviewData, vehicle.previewData],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStepIndex((prev) => {
        const next = (prev + 1) % VEHICLE_PREVIEW_TEST_SEQUENCE.length;
        const step = VEHICLE_PREVIEW_TEST_SEQUENCE[next];
        if (step) {
          onUpdatePreviewData(mergePreviewData(vehicle.previewData, step.data));
        }
        return next;
      });
    }, VEHICLE_PREVIEW_TEST_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, onUpdatePreviewData, vehicle.previewData]);

  const patchField = (key: string, value: unknown) => {
    onUpdatePreviewData({ ...preview, [key]: value });
  };

  const activeActions = readOperationActions(preview);

  const toggleAction = (code: string) => {
    const set = new Set(activeActions);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    const next = [...set];
    onUpdatePreviewData({
      ...preview,
      operation_actions: next,
      operation_action: next[0] ?? '',
    });
  };

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600">
            數據測試
          </span>
          <span className="text-[11px] text-zinc-500">
            {stepIndex + 1} / {VEHICLE_PREVIEW_TEST_SEQUENCE.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
            {currentStep?.label}
          </span>
          <button
            type="button"
            onClick={() => applyStep(Math.max(0, stepIndex - 1))}
            className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-white"
            title="上一步"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="flex items-center gap-1 rounded border border-cyan-800 bg-cyan-950/40 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-600"
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? '暫停' : '線性播放'}
          </button>
          <button
            type="button"
            onClick={() => applyStep((stepIndex + 1) % VEHICLE_PREVIEW_TEST_SEQUENCE.length)}
            className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-white"
            title="下一步"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => applyStep(0)}
            className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-white"
          >
            <SkipForward size={12} />
            重設
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">班次</span>
            <input
              value={String(preview.trip_code ?? '')}
              onChange={(e) => {
                const trip = e.target.value;
                onUpdatePreviewData({ ...preview, trip_code: trip, badge_label: trip });
              }}
              className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">車輛編號</span>
            <input
              value={String(preview.vehicle_code ?? '')}
              onChange={(e) => patchField('vehicle_code', e.target.value)}
              className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">行進方向</span>
            <select
              value={String(preview.direction_label ?? '下行')}
              onChange={(e) => {
                const dir = e.target.value;
                const trip = String(preview.trip_code ?? '');
                const next: Record<string, unknown> = { ...preview, direction_label: dir };
                if (/^[DU]\d/.test(trip)) {
                  const nextTrip = (dir === '上行' ? 'U' : 'D') + trip.slice(1);
                  next.trip_code = nextTrip;
                  next.badge_label = nextTrip;
                }
                onUpdatePreviewData(next);
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
            >
              <option value="下行">下行</option>
              <option value="上行">上行</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">車門開度 {String(preview.door_open_percent ?? 0)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Number(preview.door_open_percent ?? 0)}
              onChange={(e) => patchField('door_open_percent', Number(e.target.value))}
              className="w-32"
            />
          </label>
          <label className="flex items-center gap-1.5 pb-1">
            <input
              type="checkbox"
              checked={Boolean(preview.head_light_on)}
              onChange={(e) => patchField('head_light_on', e.target.checked)}
            />
            <span className="text-zinc-400">前燈</span>
          </label>
          <label className="flex items-center gap-1.5 pb-1">
            <input
              type="checkbox"
              checked={Boolean(preview.tail_light_on)}
              onChange={(e) => patchField('tail_light_on', e.target.checked)}
            />
            <span className="text-zinc-400">後燈</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-zinc-500">行為做動</span>
          {VEHICLE_BEHAVIOR_ACTION_CATALOG.map((action) => {
            const active = activeActions.includes(action.code);
            return (
              <button
                key={action.code}
                type="button"
                onClick={() => toggleAction(action.code)}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  active
                    ? 'border-amber-500/60 bg-amber-950/50 text-amber-300'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                }`}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
