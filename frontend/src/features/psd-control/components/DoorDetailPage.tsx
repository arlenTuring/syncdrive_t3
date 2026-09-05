import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VEHICLE_DOORS, type ControlMode } from '../constants';
import { fetchVehicleStopDwellSeconds } from '../fetchVehicleStopDwell';
import type { PsdDoorTile } from '../loadPsdSources';
import {
  leafByUiId,
  visualFromDoorMqtt,
  type PsdDoorMqttPayload,
  type VehicleDoorMqttPayload,
} from '../mapDoorMqtt';
import { DockTimeDialog } from './DockTimeDialog';
import { DoorMonitorCard, type DoorKind, type DoorMonitorState } from './DoorMonitorCard';

function bodyVisualKey(
  visual: ReturnType<typeof visualFromDoorMqtt>['visual'],
): 'open' | 'closing' | 'opening' | 'alarm' | 'offline' | 'closed' {
  if (visual === 'open') return 'open';
  if (visual === 'closing') return 'closing';
  if (visual === 'opening') return 'opening';
  if (visual === 'alarm') return 'alarm';
  if (visual === 'offline') return 'offline';
  return 'closed';
}

export function DoorDetailPage({
  kind,
  title,
  vehicleCode,
  doors,
  liveVehicle,
  livePsd,
  onBack,
}: {
  kind: DoorKind;
  title: string;
  vehicleCode?: string;
  doors?: PsdDoorTile[];
  liveVehicle?: VehicleDoorMqttPayload;
  livePsd?: Map<string, PsdDoorMqttPayload>;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  const seedVehicleDoors = (): DoorMonitorState[] =>
    VEHICLE_DOORS.map((door) => ({
      id: door.id,
      label: t(`psdControl.doors.${door.id}`),
      mode: 'auto',
      latency: '0.12s',
      bodyStatus: t('psdControl.bodyVisual.closed'),
      connection: t('psdControl.status.connected'),
      opening: t('psdControl.status.defaultOpeningPct'),
      autoLock: t('psdControl.status.normal'),
      antiPinch: t('psdControl.status.normal'),
      speed: t('psdControl.status.defaultSpeed'),
      videoUrl: null,
    }));

  const seedPlatformDoors = (tiles: PsdDoorTile[]): DoorMonitorState[] =>
    tiles.map((door) => ({
      id: door.id,
      label: door.label,
      mode: 'auto',
      latency: '0.12s',
      bodyStatus: t('psdControl.bodyVisual.closed'),
      connection: t('psdControl.status.connected'),
      opening: t('psdControl.status.defaultOpeningMm'),
      autoLock: t('psdControl.status.normal'),
      antiPinch: t('psdControl.status.normal'),
      alignment: t('psdControl.status.aligned'),
      videoUrl: null,
    }));

  const [items, setItems] = useState<DoorMonitorState[]>(() =>
    kind === 'vehicle' ? seedVehicleDoors() : seedPlatformDoors(doors ?? []),
  );
  const [arrivalSeconds, setArrivalSeconds] = useState<number | null>(null);
  const [dwellLoading, setDwellLoading] = useState(kind === 'vehicle');
  const [dockDialog, setDockDialog] = useState(false);

  useEffect(() => {
    if (kind !== 'vehicle') return;
    const code = vehicleCode ?? title;
    let cancelled = false;
    setDwellLoading(true);
    void fetchVehicleStopDwellSeconds(code)
      .then((result) => {
        if (cancelled) return;
        setArrivalSeconds(result.seconds);
      })
      .finally(() => {
        if (!cancelled) setDwellLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, vehicleCode, title]);

  useEffect(() => {
    if (kind === 'vehicle' && liveVehicle) {
      setItems((prev) =>
        prev.map((door) => {
          const leaf = leafByUiId(liveVehicle, door.id);
          const visual = visualFromDoorMqtt(leaf?.motion, leaf?.open_percent, {
            displayState: leaf?.display_state,
            connection: liveVehicle.connection,
            alarm: leaf?.alarm,
          });
          const pct = Number(leaf?.open_percent);
          return {
            ...door,
            bodyStatus: t(`psdControl.bodyVisual.${bodyVisualKey(visual.visual)}`),
            connection:
              String(liveVehicle.connection ?? '').toUpperCase() === 'OFFLINE'
                ? t('psdControl.status.disconnected')
                : t('psdControl.status.connected'),
            opening: Number.isFinite(pct) ? `${Math.round(pct)} %` : door.opening,
            autoLock: leaf?.locked ? t('psdControl.status.locked') : t('psdControl.status.normal'),
            antiPinch:
              leaf?.anti_pinch === 'FAULT'
                ? t('psdControl.status.abnormal')
                : t('psdControl.status.normal'),
            speed: `${Number(liveVehicle.speed_kmh ?? 0).toFixed(0)} km/h`,
          };
        }),
      );
    }
    if (kind === 'platform' && livePsd) {
      setItems((prev) =>
        prev.map((door) => {
          const live = livePsd.get(door.id) ?? (door.mqttId ? livePsd.get(door.mqttId) : undefined);
          if (!live) return door;
          const visual = visualFromDoorMqtt(live.motion, live.open_percent, {
            displayState: live.display_state,
            connection: live.connection,
            alignment: live.alignment,
            alarm: live.alarm,
          });
          const pct = Number(live.open_percent);
          return {
            ...door,
            bodyStatus: t(`psdControl.bodyVisual.${bodyVisualKey(visual.visual)}`),
            connection:
              String(live.connection ?? '').toUpperCase() === 'OFFLINE'
                ? t('psdControl.status.disconnected')
                : t('psdControl.status.connected'),
            opening: Number.isFinite(pct) ? `${Math.round(pct)} %` : door.opening,
            autoLock: live.locked ? t('psdControl.status.locked') : t('psdControl.status.normal'),
            antiPinch:
              live.anti_pinch === 'FAULT'
                ? t('psdControl.status.abnormal')
                : t('psdControl.status.normal'),
            alignment:
              live.alignment === 'MISALIGNED'
                ? t('psdControl.status.misaligned')
                : t('psdControl.status.aligned'),
          };
        }),
      );
    }
  }, [kind, liveVehicle, livePsd, t]);

  const setMode = (id: string, mode: ControlMode) => {
    setItems((prev) => prev.map((door) => (door.id === id ? { ...door, mode } : door)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <div className="flex h-11 shrink-0 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-1 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            aria-label={t('psdControl.back')}
          >
            <ArrowLeft className="size-5 stroke-[1.75]" />
          </button>
          <h2 className="truncate text-[15px] font-normal tracking-[0.2px]">{title}</h2>
        </div>
        {kind === 'vehicle' ? (
          <div className="flex shrink-0 items-center gap-3">
            <p className="hidden text-[13px] text-zinc-100 sm:block">
              {dwellLoading
                ? t('psdControl.dwellLoading')
                : arrivalSeconds == null
                  ? t('psdControl.dwellNone')
                  : t('psdControl.dwellSeconds', { seconds: arrivalSeconds })}
            </p>
            <button
              type="button"
              onClick={() => setDockDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#2563eb] px-3 py-1.5 text-[13px] text-white hover:bg-[#1d4ed8]"
            >
              <SlidersHorizontal className="size-3.5 stroke-[1.75]" aria-hidden />
              {t('psdControl.editDockTime')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[repeat(4,minmax(0,1fr))] gap-2.5 overflow-auto p-3 md:grid-cols-2 md:grid-rows-2">
        {items.map((door) => (
          <DoorMonitorCard
            key={door.id}
            kind={kind}
            door={door}
            dwellSeconds={arrivalSeconds}
            onModeChange={(mode) => setMode(door.id, mode)}
          />
        ))}
      </div>

      {dockDialog ? (
        <DockTimeDialog
          vehicleCode={vehicleCode ?? title}
          onClose={() => setDockDialog(false)}
          onApply={(next) => {
            setArrivalSeconds(next);
            setDockDialog(false);
          }}
        />
      ) : null}
    </div>
  );
}
