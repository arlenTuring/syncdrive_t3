import { fetchShiftRecordDetail, fetchShiftRecordList } from '../shift-records/api/shiftRecordsApi';
import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';
import type { ShiftRecordListItem } from '../shift-records/types';

type TimetableStation = {
  station_id?: string;
  station_name?: string;
  dwell_seconds?: number;
};

type TimetableTrip = {
  trip_code?: string;
  stations?: TimetableStation[];
  card_start_second?: number;
  card_end_second?: number;
};

function stationKey(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes('s2w') || s === 'station_6' || s === 'station_5') return 's2w';
  if (s.includes('t3') || s === 'station_4' || s === 'station_3') return 't3';
  if (s.includes('n2w') || s === 'station_1' || s === 'station_2') return 'n2w';
  return s;
}

function pickCurrentTrip(items: ShiftRecordListItem[]): ShiftRecordListItem | null {
  const live = items.filter((item) => item.execution_status !== 'completed');
  return (
    live.find((item) => item.execution_status === 'running' || item.execution_status === 'delayed')
    ?? live.find((item) => item.execution_status === 'pending')
    ?? live[0]
    ?? null
  );
}

function dwellFromStations(stations: TimetableStation[], targetId: string): number | null {
  if (stations.length === 0) return null;
  const target = stationKey(targetId);
  const matched = target
    ? stations.find(
        (s) =>
          stationKey(String(s.station_id ?? '')) === target
          || stationKey(String(s.station_name ?? '')) === target,
      )
    : undefined;
  const fromTarget = Number(matched?.dwell_seconds);
  if (Number.isFinite(fromTarget) && fromTarget > 0) return Math.round(fromTarget);
  const upcoming = stations.find((s) => Number(s.dwell_seconds) > 0);
  const fallback = Number(upcoming?.dwell_seconds);
  return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : null;
}

/**
 * 讀這台車當前站或即將抵達站的計畫停靠秒數（班表 `dwell_seconds`）。
 */
export async function fetchVehicleStopDwellSeconds(vehicleCode: string): Promise<{
  seconds: number | null;
  conflictTripItems: ShiftRecordListItem[];
}> {
  const list = await fetchShiftRecordList({
    tab: 'mainline',
    vehicle_code: vehicleCode,
    page: 1,
    page_size: 80,
  }).catch(() => ({ items: [] as ShiftRecordListItem[] }));

  const items = list.items ?? [];
  const current = pickCurrentTrip(items);

  let operation: Record<string, unknown> | null = null;
  try {
    const snap = await fetch(`${resolveBrowserApiBaseUrl()}/syncdrive-api/vehicles/snapshot`);
    if (snap.ok) {
      const data = (await snap.json()) as {
        vehicles?: Record<string, { operation?: Record<string, unknown> | null }>;
      };
      operation = data.vehicles?.[vehicleCode]?.operation ?? null;
    }
  } catch {
    operation = null;
  }

  const detail = current
    ? await fetchShiftRecordDetail(current.order_id).catch(() => null)
    : null;

  const phase = String(operation?.vehicle_phase ?? detail?.vehicle_phase ?? '').toUpperCase();
  const leg = (
    (operation?.current_leg && typeof operation.current_leg === 'object'
      ? operation.current_leg
      : detail?.current_leg) ?? {}
  ) as { target_station_id?: string };
  const targetId = String(leg.target_station_id ?? '').trim();

  const tripsRes = await fetch(
    `${resolveBrowserApiBaseUrl()}/syncdrive-api/operation-shift/timetable/trips`,
  ).catch(() => null);
  const trips: TimetableTrip[] = tripsRes?.ok
    ? (((await tripsRes.json()) as { trips?: TimetableTrip[] }).trips ?? [])
    : [];

  const tripCode = String(operation?.trip_code ?? current?.trip_code ?? '').trim();
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const trip =
    trips.find((item) => String(item.trip_code ?? '').toUpperCase() === tripCode.toUpperCase())
    ?? trips.find(
      (item) =>
        typeof item.card_start_second === 'number'
        && typeof item.card_end_second === 'number'
        && item.card_start_second <= nowSec
        && nowSec < item.card_end_second,
    )
    ?? trips.find(
      (item) => typeof item.card_start_second === 'number' && item.card_start_second >= nowSec,
    )
    ?? null;

  const hint = phase.includes('DWELL') ? targetId : targetId;
  const seconds = trip?.stations?.length ? dwellFromStations(trip.stations, hint) : null;

  return { seconds, conflictTripItems: items };
}
