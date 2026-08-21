import { useEffect, useMemo, useState } from 'react';
import { DoorLinkIndicator } from './components/DoorLinkIndicator';
import { DoorDetailPage } from './components/DoorDetailPage';
import type { DoorIndicatorModel } from './constants';
import { VEHICLE_DOORS } from './constants';
import {
  doorVisualStateFor,
  vehicleDoorStatesFromPayload,
  visualFromDoorMqtt,
} from './mapDoorMqtt';
import {
  listActiveMapPlatforms,
  listRegisteredVehicles,
  type PsdPlatformCard,
  type PsdVehicleCard,
} from './loadPsdSources';
import { useDoorBodyMqtt } from './useDoorBodyMqtt';

type TabKey = 'vehicle' | 'platform';

type DetailView =
  | { kind: 'vehicle'; title: string; vehicleCode: string }
  | { kind: 'platform'; title: string; doors: PsdPlatformCard['doors'] };

function ControlCard({
  title,
  doors,
  doorStates,
  onOpen,
}: {
  title: string;
  doors: ReadonlyArray<{ id: string; label: string }>;
  doorStates?: Partial<Record<string, DoorIndicatorModel>>;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-zinc-800/80 bg-[#18181b] px-6 py-5 text-left transition hover:border-zinc-600 hover:bg-[#1c1c20]"
    >
      <p className="mb-5 text-center text-sm font-medium tracking-[0.5px] text-zinc-100">{title}</p>
      <div className="flex items-start justify-between gap-3">
        {doors.map((door) => {
          const model = doorVisualStateFor(door.id, doorStates ?? {});
          return (
            <DoorLinkIndicator
              key={door.id}
              label={door.label}
              state={model.visual}
              openPercent={model.openPercent}
            />
          );
        })}
      </div>
    </button>
  );
}

export function PsdControlPage() {
  const [tab, setTab] = useState<TabKey>('vehicle');
  const [vehicles, setVehicles] = useState<PsdVehicleCard[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(true);
  const [platforms, setPlatforms] = useState<PsdPlatformCard[]>([]);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [detail, setDetail] = useState<DetailView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVehicleLoading(true);
    void listRegisteredVehicles()
      .then((items) => {
        if (!cancelled) setVehicles(items);
      })
      .finally(() => {
        if (!cancelled) setVehicleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlatformLoading(true);
    void listActiveMapPlatforms()
      .then((items) => {
        if (cancelled) return;
        setPlatforms(items);
        setPlatformError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPlatforms([]);
        setPlatformError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setPlatformLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const vehicleCodes = useMemo(() => vehicles.map((v) => v.label), [vehicles]);
  const psdIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of platforms) {
      for (const d of p.doors) {
        ids.add(d.id);
        if (d.mqttId) ids.add(d.mqttId);
      }
    }
    return [...ids];
  }, [platforms]);
  const { byVehicle, byPsd } = useDoorBodyMqtt(vehicleCodes, psdIds);

  if (detail?.kind === 'vehicle') {
    return (
      <DoorDetailPage
        kind="vehicle"
        title={detail.title}
        vehicleCode={detail.vehicleCode}
        liveVehicle={byVehicle.get(detail.vehicleCode)}
        onBack={() => setDetail(null)}
      />
    );
  }
  if (detail?.kind === 'platform') {
    return (
      <DoorDetailPage
        kind="platform"
        title={detail.title}
        doors={detail.doors}
        livePsd={byPsd}
        onBack={() => setDetail(null)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <div className="flex shrink-0 gap-6 border-b border-zinc-800/80 px-6">
        <button
          type="button"
          onClick={() => setTab('vehicle')}
          className={`relative py-3 text-sm tracking-[0.5px] ${
            tab === 'vehicle' ? 'text-[#51A2FF]' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          車門
          {tab === 'vehicle' ? (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#2B7FFF]" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab('platform')}
          className={`relative py-3 text-sm tracking-[0.5px] ${
            tab === 'platform' ? 'text-[#51A2FF]' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          月台門
          {tab === 'platform' ? (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#2B7FFF]" />
          ) : null}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {tab === 'vehicle' ? (
          vehicleLoading ? (
            <p className="py-16 text-center text-sm text-zinc-500">載入車輛…</p>
          ) : vehicles.length === 0 ? (
            <p className="py-16 text-center text-sm text-zinc-500">尚無已註冊載具</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {vehicles.map((vehicle) => (
                <ControlCard
                  key={vehicle.id}
                  title={vehicle.label}
                  doors={VEHICLE_DOORS}
                  doorStates={vehicleDoorStatesFromPayload(byVehicle.get(vehicle.label))}
                  onOpen={() =>
                    setDetail({ kind: 'vehicle', title: vehicle.label, vehicleCode: vehicle.label })
                  }
                />
              ))}
            </div>
          )
        ) : platformLoading ? (
          <p className="py-16 text-center text-sm text-zinc-500">載入月台門…</p>
        ) : platformError ? (
          <p className="py-16 text-center text-sm text-red-400">{platformError}</p>
        ) : platforms.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500">目前啟用地圖沒有月台門元件</p>
        ) : (
          <div className="flex flex-col gap-4">
            {platforms.map((platform) => (
              <ControlCard
                key={platform.id}
                title={platform.name}
                doors={platform.doors}
                doorStates={Object.fromEntries(
                  platform.doors.map((door) => {
                    const live = byPsd.get(door.id) ?? (door.mqttId ? byPsd.get(door.mqttId) : undefined);
                    return [
                      door.id,
                      visualFromDoorMqtt(live?.motion, live?.open_percent, {
                        displayState: live?.display_state,
                        connection: live?.connection,
                        alignment: live?.alignment,
                        alarm: live?.alarm,
                      }),
                    ] as const;
                  }),
                )}
                onOpen={() =>
                  setDetail({ kind: 'platform', title: platform.name, doors: platform.doors })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
