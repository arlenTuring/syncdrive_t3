import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Battery, Gauge, MapPin, X } from 'lucide-react';
import { MapPlatformCanvas } from '../dashboard/elements/MapPlatformLayer';
import { MapViewport } from '../degraded-operation/MapViewport';
import { resolveParsedMapForPlatform } from '../map-editor/utils/mapLibraryStorage';
import type { AreaVehicleLive } from '../map-editor/vehicles/types';
import { useMapVehicleModel } from '../vehicle-editor/model/useMapVehicleModel';
import type { VehicleRealtimeItem } from './types';
import { vehiclePhaseLabel } from './vehiclePhaseLabel';

type Parsed = Awaited<ReturnType<typeof resolveParsedMapForPlatform>>;

export function VehicleLocationDialog({ item, fleet, onClose }: { item: VehicleRealtimeItem; fleet: VehicleRealtimeItem[]; onClose: () => void }) {
  const { i18n } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [map, setMap] = useState<Parsed>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const model = useMapVehicleModel(item.mapId);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setMap(null);
    setMapError(null);
    if (!item.mapId) {
      setMapError('此載具尚無可用地圖');
      return;
    }
    void resolveParsedMapForPlatform(item.mapId)
      .then((parsed) => {
        if (cancelled) return;
        if (!parsed) setMapError('找不到載具所屬地圖');
        else setMap(parsed);
      })
      .catch(() => { if (!cancelled) setMapError('地圖載入失敗'); });
    return () => { cancelled = true; };
  }, [item.mapId]);

  const vehicles = useMemo<AreaVehicleLive[]>(() => fleet
    .filter((candidate) => candidate.mapId === item.mapId && candidate.location)
    .map((candidate) => ({
      areaId: candidate.location!.objectId ?? '',
      vehicleId: candidate.vehicleCode,
      xM: candidate.location!.x,
      yM: candidate.location!.y,
      payload: {
        ...(candidate.telemetry?.payload ?? {}),
        vehicle_code: candidate.vehicleCode,
        segment_label: candidate.location!.label,
        // 後端對這筆遙測的位置判定（站點／設施／軌道）：圖台據此讓停在格位的車以車身中心對齊格位
        location_kind: candidate.location!.kind,
        location_object_id: candidate.location!.objectId,
        __selected: candidate.vehicleCode === item.vehicleCode,
        local_pose: {
          ...((candidate.telemetry?.payload.local_pose as Record<string, unknown> | undefined) ?? {}),
          heading: candidate.location!.headingRad,
          position: { x: candidate.location!.x, y: candidate.location!.y, z: candidate.location!.z },
        },
      },
      topic: `snapshot/${candidate.vehicleCode}`,
      updatedAt: candidate.telemetry?.receivedAt ?? 0,
    })), [fleet, item.mapId, item.vehicleCode]);

  const tasks = Array.isArray(item.operation?.payload.task_group)
    ? item.operation.payload.task_group as Array<Record<string, unknown>>
    : [];
  const activeTasks = tasks.filter((task) => ['PENDING', 'IN_PROGRESS', 'FAILED'].includes(String(task.status)));
  const phase = vehiclePhaseLabel(item.operation?.payload.vehicle_phase, i18n.language) ?? '—';
  const trip = String(item.operation?.payload.trip_code ?? item.contractOrder?.tripCode ?? '—');
  const lastAt = Math.max(item.telemetry?.receivedAt ?? 0, item.operation?.receivedAt ?? 0, item.health?.receivedAt ?? 0);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="vehicle-location-title" className="flex h-[min(820px,92vh)] w-[min(1450px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#15171b] shadow-2xl">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-700 px-6">
          <div>
            <h2 id="vehicle-location-title" className="text-xl font-semibold text-zinc-100">{item.displayName}</h2>
            <p className="text-xs text-zinc-500">{item.vehicleCode}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-300 hover:bg-white/10" aria-label="關閉定位視窗"><X className="size-6" /></button>
        </header>
        <div className="min-h-0 flex-1 bg-[#080d14] p-4">
          <div className="h-full overflow-hidden rounded-xl border border-zinc-800">
            {map && item.location ? (
              <MapViewport storageKey={`vehicle-realtime:${item.vehicleCode}`}>
                <MapPlatformCanvas
                  map={{ areas: map.areas, routes: map.routes ?? [], pixelSize: map.pixelSize, pixelOrigin: map.pixelOrigin }}
                  vehicles={vehicles}
                  liveById={{}}
                  tweenMs={1200}
                  orderStationsById={{}}
                  vehicleTemplate={model.template}
                />
              </MapViewport>
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-400">
                <AlertTriangle className="mr-2 size-5 text-amber-400" />
                {mapError ?? (!item.location ? '尚無有效位置，不會畫在原點' : '地圖載入中…')}
              </div>
            )}
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 border-t border-zinc-700 px-7 py-5 text-sm md:grid-cols-3">
          <Info icon={<MapPin />} label="目前位置" value={item.location?.label ?? (item.location ? `${item.location.x.toFixed(2)}, ${item.location.y.toFixed(2)}` : '未知')} />
          <Info label="車輛階段" value={phase} />
          <Info label="訂單契約狀態" value={item.contractOrder?.status ?? '目前無執行任務'} />
          <Info label="目前任務" value={activeTasks.length ? activeTasks.map((task) => `${String(task.task_name ?? task.task_id ?? '任務')}（${String(task.status)}）`).join('、') : '目前無執行任務'} />
          <Info label="目前班次" value={trip} />
          <Info icon={<Battery />} label="電量" value={item.batteryLevel == null ? '未知' : `${Math.round(item.batteryLevel)}%`} />
          <Info icon={<Gauge />} label="速度" value={item.speedKph == null ? '未知' : `${item.speedKph.toFixed(1)} km/h`} />
          <Info label="連線狀態" value={item.connectionStatus === 'ONLINE' ? '在線' : item.connectionStatus === 'NO_DATA' ? '尚無資料' : '離線（最後資料）'} />
          <Info label="最後更新" value={lastAt ? new Date(lastAt).toLocaleString(i18n.language.startsWith('en') ? 'en-US' : 'zh-TW') : '—'} />
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Info({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return <div className="min-w-0"><span className="flex items-center gap-1 text-xs text-zinc-500">{icon ? <span className="[&>svg]:size-3.5">{icon}</span> : null}{label}</span><span className="mt-0.5 block truncate text-zinc-200" title={value}>{value}</span></div>;
}
