import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { VEHICLE_DOORS, type ControlMode } from '../constants';
import { fetchVehicleStopDwellSeconds } from '../fetchVehicleStopDwell';
import type { PsdDoorTile } from '../loadPsdSources';
import {
  bodyStatusLabel,
  connectionLabel,
  leafByUiId,
  visualFromDoorMqtt,
  type PsdDoorMqttPayload,
  type VehicleDoorMqttPayload,
} from '../mapDoorMqtt';
import { DockTimeDialog } from './DockTimeDialog';
import { DoorMonitorCard, type DoorKind, type DoorMonitorState } from './DoorMonitorCard';

function seedVehicleDoors(): DoorMonitorState[] {
  return VEHICLE_DOORS.map((door) => ({
    id: door.id,
    label: door.label,
    mode: 'auto',
    latency: '0.12s',
    bodyStatus: '常態關',
    connection: '已連線',
    opening: '0 %',
    autoLock: '正常',
    antiPinch: '正常',
    speed: '0 km/h',
    videoUrl: null,
  }));
}

function seedPlatformDoors(doors: PsdDoorTile[]): DoorMonitorState[] {
  return doors.map((door) => ({
    id: door.id,
    label: door.label,
    mode: 'auto',
    latency: '0.12s',
    bodyStatus: '常態關',
    connection: '已連線',
    opening: '0 mm',
    autoLock: '正常',
    antiPinch: '正常',
    alignment: '停準',
    videoUrl: null,
  }));
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
            bodyStatus: bodyStatusLabel(visual.visual),
            connection: connectionLabel(liveVehicle.connection),
            opening: Number.isFinite(pct) ? `${Math.round(pct)} %` : door.opening,
            autoLock: leaf?.locked ? '鎖定' : '正常',
            antiPinch: leaf?.anti_pinch === 'FAULT' ? '異常' : '正常',
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
            bodyStatus: bodyStatusLabel(visual.visual),
            connection: connectionLabel(live.connection),
            opening: Number.isFinite(pct) ? `${Math.round(pct)} %` : door.opening,
            autoLock: live.locked ? '鎖定' : '正常',
            antiPinch: live.anti_pinch === 'FAULT' ? '異常' : '正常',
            alignment: live.alignment === 'MISALIGNED' ? '未對準' : '停準',
          };
        }),
      );
    }
  }, [kind, liveVehicle, livePsd]);

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
            aria-label="返回"
          >
            <ArrowLeft className="size-5 stroke-[1.75]" />
          </button>
          <h2 className="truncate text-[15px] font-normal tracking-[0.2px]">{title}</h2>
        </div>
        {kind === 'vehicle' ? (
          <div className="flex shrink-0 items-center gap-3">
            <p className="hidden text-[13px] text-zinc-100 sm:block">
              {dwellLoading
                ? '即將到站的停靠時間：載入中…'
                : arrivalSeconds == null
                  ? '即將到站的停靠時間：尚無資料'
                  : `即將到站的停靠時間：${arrivalSeconds}秒`}
            </p>
            <button
              type="button"
              onClick={() => setDockDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#2563eb] px-3 py-1.5 text-[13px] text-white hover:bg-[#1d4ed8]"
            >
              <SlidersHorizontal className="size-3.5 stroke-[1.75]" aria-hidden />
              單次修改停靠時間
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
