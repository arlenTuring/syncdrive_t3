import { useEffect, useMemo, useState } from 'react';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';
import { fetchShiftRecordDetail } from '../../shift-records/api/shiftRecordsApi';

/**
 * 圖台上每台車目前這張任務的<strong>有序站序</strong>（訂單 payload.stations）。
 *
 * 判位要「這張任務接下來該走哪幾條分支」，車端的 operation/update 只帶目標站，所以照
 * 訂單 id 向後端拿一次站序（既有的班次詳情 API），之後快取。拿不到（查無此單、網路失敗）
 * 就記成空，判位退回沒有路徑的做法，不會反覆重試。
 */
const cache = new Map<string, readonly string[]>();
const inflight = new Set<string>();
const MAX_CACHE = 300;

function orderIdOf(vehicle: AreaVehicleLive): string | null {
  const id = vehicle.payload?.order_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export function useOrderRouteStations(vehicles: readonly AreaVehicleLive[]): Record<string, readonly string[]> {
  const orderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of vehicles) {
      const id = orderIdOf(v);
      if (id) ids.add(id);
    }
    return [...ids].sort();
  }, [vehicles]);
  const key = orderIds.join('|');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    for (const id of orderIds) {
      if (cache.has(id) || inflight.has(id)) continue;
      inflight.add(id);
      void fetchShiftRecordDetail(id)
        .then((detail) => {
          const stations = (detail.payload?.stations ?? [])
            .map((s) => (typeof s?.station_id === 'string' ? s.station_id : ''))
            .filter(Boolean);
          cache.set(id, stations);
        })
        .catch(() => {
          cache.set(id, []);
        })
        .finally(() => {
          inflight.delete(id);
          if (cache.size > MAX_CACHE) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          if (!cancelled) setVersion((n) => n + 1);
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const out: Record<string, readonly string[]> = {};
    for (const id of orderIds) {
      const stations = cache.get(id);
      if (stations && stations.length >= 2) out[id] = stations;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}
