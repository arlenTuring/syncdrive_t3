import { SiteSelect } from '../../../components/SiteSelect';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Pause, Play, SkipForward } from 'lucide-react';
import { VEHICLE_BEHAVIOR_ACTION_CATALOG } from '../constants/behaviorActionCatalog';
import {
  VEHICLE_PREVIEW_TEST_INTERVAL_MS,
  VEHICLE_PREVIEW_TEST_SEQUENCE,
} from '../constants/vehiclePreviewTestSequence';
import type { VehicleDefinition } from '../types';
import { readOperationActions } from '../utils/resolveBehaviorActions';
import { Button, Checkbox, IconButton } from '../../../components/ui';

function mergePreviewData(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(base ?? {}), ...patch };
}

/** Domain data values stored in previewData — not UI labels. */
const DIR_DOWN = '下行';
const DIR_UP = '上行';

export function VehiclePreviewTestPanel({
  vehicle,
  onUpdatePreviewData,
}: {
  vehicle: VehicleDefinition;
  onUpdatePreviewData: (previewData: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
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
    <div className="shrink-0 border-t border-border-quaternary bg-surface-popup px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption-2 uppercase text-cyan-600">
            {t('vehicleEditor.preview.title')}
          </span>
          <span className="text-body-xs text-text-quaternary">
            {stepIndex + 1} / {VEHICLE_PREVIEW_TEST_SEQUENCE.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-body-xs text-text-tertiary">
            {currentStep?.label}
          </span>
          <IconButton hierarchy="subordinate" variant="outlined" onPress={() => applyStep(Math.max(0, stepIndex - 1))} title={t('vehicleEditor.preview.prev')} label={t('vehicleEditor.preview.prev')} icon={<ChevronLeft />} />
          <Button variant="outlined" onPress={() => setPlaying((v) => !v)}>{playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? t('vehicleEditor.preview.pause') : t('vehicleEditor.preview.play')}</Button>
          <IconButton hierarchy="subordinate" variant="outlined" onPress={() => applyStep((stepIndex + 1) % VEHICLE_PREVIEW_TEST_SEQUENCE.length)} title={t('vehicleEditor.preview.next')} label={t('vehicleEditor.preview.next')} icon={<ChevronRight />} />
          <Button hierarchy="subordinate" variant="outlined" onPress={() => applyStep(0)} leadingIcon={<SkipForward />}>{t('vehicleEditor.preview.reset')}</Button>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-body-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-caption-2 text-text-quaternary">{t('vehicleEditor.preview.trip')}</span>
            <input
              value={String(preview.trip_code ?? '')}
              onChange={(e) => {
                const trip = e.target.value;
                onUpdatePreviewData({ ...preview, trip_code: trip, badge_label: trip });
              }}
              className="w-24 rounded border border-border-quaternary bg-surface-primary px-2 py-1 font-mono text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-caption-2 text-text-quaternary">{t('vehicleEditor.preview.vehicleCode')}</span>
            <input
              value={String(preview.vehicle_code ?? '')}
              onChange={(e) => patchField('vehicle_code', e.target.value)}
              className="w-24 rounded border border-border-quaternary bg-surface-primary px-2 py-1 font-mono text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-caption-2 text-text-quaternary">{t('vehicleEditor.preview.direction')}</span>
            <SiteSelect
              value={String(preview.direction_label ?? DIR_DOWN)}
              onChange={(e) => {
                const dir = e.target.value;
                const trip = String(preview.trip_code ?? '');
                const next: Record<string, unknown> = { ...preview, direction_label: dir };
                if (/^[DU]\d/.test(trip)) {
                  const nextTrip = (dir === DIR_UP ? 'U' : 'D') + trip.slice(1);
                  next.trip_code = nextTrip;
                  next.badge_label = nextTrip;
                }
                onUpdatePreviewData(next);
              }}
              size="sm"
            >
              <option value={DIR_DOWN}>{t('vehicleEditor.preview.down')}</option>
              <option value={DIR_UP}>{t('vehicleEditor.preview.up')}</option>
            </SiteSelect>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-caption-2 text-text-quaternary">
              {t('vehicleEditor.preview.doorOpen', { pct: String(preview.door_open_percent ?? 0) })}
            </span>
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
            <Checkbox checked={Boolean(preview.head_light_on)} onCheckedChange={(checked) => patchField('head_light_on', checked)} />
            <span className="text-text-tertiary">{t('vehicleEditor.preview.headLight')}</span>
          </label>
          <label className="flex items-center gap-1.5 pb-1">
            <Checkbox checked={Boolean(preview.tail_light_on)} onCheckedChange={(checked) => patchField('tail_light_on', checked)} />
            <span className="text-text-tertiary">{t('vehicleEditor.preview.tailLight')}</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption-2 text-text-quaternary">{t('vehicleEditor.preview.actions')}</span>
          {VEHICLE_BEHAVIOR_ACTION_CATALOG.map((action) => {
            const active = activeActions.includes(action.code);
            return (
              <button
                key={action.code}
                type="button"
                onClick={() => toggleAction(action.code)}
                className={`rounded-full border px-2 py-0.5 text-caption-2 transition-colors ${
                  active
                    ? 'border-amber-500/60 bg-amber-950/50 text-status-warning'
                    : 'border-border-quaternary text-text-quaternary hover:border-border-primary'
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
