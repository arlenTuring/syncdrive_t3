/**
 * 儀表板站點到站／出發清單（N2W、S2W、T3…）
 * =======================================
 *
 * 每一站可以列「到站」、「出發」或兩者，依時刻排序。每一筆都標明時刻是即時推估還是計畫：
 *
 * <table>
 *   <tr><td>到站</td><td>車正開往這一站：回報當下的營運時刻＋車端剩餘秒數（live）。否則用每日計畫的
 *       到站時刻（plan）。</td></tr>
 *   <tr><td>出發</td><td>車已停在這一站：計畫出發時刻，已經過了就是現在（live，停靠中）。車正開往這一站：
 *       計畫出發與即時到站取較晚者（live）。其餘用計畫出發時刻（plan）。</td></tr>
 * </table>
 *
 * 即時資料超過新鮮度門檻（實際時間）就不算即時，退回計畫並標示過期，不冒充即時。
 *
 * 一筆的身分是「班次＋站序位置＋到站／出發」，不是「車＋站」：同一台車跑完一圈再次到同一站是另一筆，
 * 不會被當成重複刪掉。已到站（到站那一筆）、已開走（出發那一筆）、班次已結束、取消、故障的移除；
 * 計畫時刻已過很久又沒有任何執行資料的也移除。
 */

export type StationEventKind = 'arrive' | 'depart';

export type PlannedStop = {
  tripCode: string;
  vehicleCode: string;
  stationId: string;
  stationName: string;
  taskLabel: string;
  /** 這一站在這班站序裡的位置（0 起算） */
  stopIndex: number;
  /** 營運時刻（毫秒）；起站沒有到站、終站沒有出發 */
  arriveAt: number | null;
  departAt: number | null;
};

export type LiveVehicle = {
  vehicleCode: string;
  tripCode: string | null;
  orderId: string | null;
  targetStationId: string | null;
  etaSeconds: number | null;
  distanceM: number | null;
  vehiclePhase: string | null;
  /** 回報當下的營運時刻 */
  observedOp: number;
  /** 實際時間上，資料已經多舊（秒） */
  ageSeconds: number;
};

export type TripState = { status: string; closedReason: string | null };

export type StationEvent = {
  key: string;
  event: StationEventKind;
  vehicle_code: string;
  trip_code: string;
  station_id: string;
  station_name: string;
  vehicle_name: string;
  task_label: string;
  event_label: '到站' | '出發';
  /** 營運時刻（毫秒） */
  at: number;
  /** live：依車端即時回報推估；plan：每日計畫時刻 */
  kind: 'live' | 'plan';
  /** 車已停在這一站（出發那一筆） */
  at_station: boolean;
  planned_at: number | null;
  delay_seconds: number | null;
};

export type StationEventGroup = {
  station_id: string;
  station_name: string;
  /** ok：有資料；no_vehicle：沒有車接近；stale：只剩過期的即時資料可用（不顯示成即時） */
  state: 'ok' | 'no_vehicle' | 'stale';
  events: StationEvent[];
  stale_vehicles: string[];
};

/**
 * 計畫時刻過了這麼久、又沒有即時資料：不是即將發生，不列。先過濾再取前幾筆，
 * 過去的計畫時刻才不會把接下來的到站、出發擠出清單。
 */
export const PLAN_EXPIRED_AFTER_MS = 30_000;
/** 到站判定：目標就是這一站、而且距離小於這個值或車端回報停靠中 */
export const ARRIVED_DISTANCE_M = 5;
const DWELLING_PHASES = new Set(['DWELLING', 'DOCKED', 'AT_STATION']);

export function mergeStationEvents(args: {
  /** 每一站要列哪幾種 */
  stations: Array<{ stationId: string; events: StationEventKind[] }>;
  stationNames: Map<string, string>;
  planned: PlannedStop[];
  /** 每班的站序（班次代號 → 站 id 陣列），判斷「已經開過這一站」用 */
  stopsByTrip: Map<string, string[]>;
  live: LiveVehicle[];
  tripStates: Map<string, TripState>;
  operatingNow: number;
  staleAfterSeconds: number;
  limit: number;
}): StationEventGroup[] {
  const liveByTrip = new Map<string, LiveVehicle>();
  const staleVehicles = new Set<string>();
  for (const vehicle of args.live) {
    if (!vehicle.tripCode) continue;
    if (vehicle.ageSeconds > args.staleAfterSeconds) {
      staleVehicles.add(vehicle.vehicleCode);
      continue;
    }
    liveByTrip.set(vehicle.tripCode, vehicle);
  }

  const groups = args.stations.map((station) => ({
    station_id: station.stationId,
    station_name: args.stationNames.get(station.stationId) ?? station.stationId,
    wants: new Set(station.events),
    events: [] as StationEvent[],
    staleHere: new Set<string>(),
  }));
  const byStation = new Map(groups.map((g) => [g.station_id, g]));
  const now = args.operatingNow;

  for (const stop of args.planned) {
    const group = byStation.get(stop.stationId);
    if (!group) continue;
    const state = args.tripStates.get(stop.tripCode);
    // 班次已結束（完成、取消、故障結案）：這一站已經不會再有到站或出發
    if (state && (state.status === 'END' || state.status === 'FAULTED')) continue;
    const live = liveByTrip.get(stop.tripCode);
    const stops = args.stopsByTrip.get(stop.tripCode) ?? [];
    const targetIndex = live?.targetStationId ? stops.indexOf(live.targetStationId) : -1;
    const atTarget = !!live && targetIndex === stop.stopIndex;
    const arrived = atTarget && (
      (live!.distanceM != null && live!.distanceM < ARRIVED_DISTANCE_M)
      || DWELLING_PHASES.has(String(live!.vehiclePhase ?? '').toUpperCase())
    );
    const liveArriveAt = atTarget && !arrived && live!.etaSeconds != null
      ? live!.observedOp + live!.etaSeconds * 1000
      : null;
    // 已經開往後面的站：這一站到站與出發都過了。起站：班次已開始、車已經在開往第二站
    const passed = !!live && targetIndex > stop.stopIndex;
    const staleHere = !live && staleVehicles.has(stop.vehicleCode);

    const push = (event: StationEventKind, at: number, kind: 'live' | 'plan', plannedAt: number | null, atStation = false) => {
      group.events.push({
        key: `${stop.tripCode}|${stop.stationId}|${stop.stopIndex}|${event}`,
        event,
        vehicle_code: stop.vehicleCode,
        trip_code: stop.tripCode,
        station_id: stop.stationId,
        station_name: stop.stationName,
        vehicle_name: stop.vehicleCode,
        task_label: stop.taskLabel,
        event_label: event === 'arrive' ? '到站' : '出發',
        at,
        kind,
        at_station: atStation,
        planned_at: plannedAt,
        delay_seconds: plannedAt != null ? Math.round((at - plannedAt) / 1000) : null,
      });
      if (staleHere && at <= now + 30 * 60_000) group.staleHere.add(stop.vehicleCode);
    };
    // 沒有即時資料可依：計畫時刻已過就不列（已開始的班次沒有即時資料也一樣，不冒充即將發生）
    const expired = (plannedAt: number) => !live && plannedAt < now - PLAN_EXPIRED_AFTER_MS;

    /*
     * 班與班接續的站（ST 的終點 T3上行＝下一班 TN 的起站）：計畫在兩班各記一次，其實是同一次
     * 到站與出發。到站算前一班的終點、出發算後一班的起站，各只列一次。
     */
    const isOrigin = stop.stopIndex === 0;
    const isTerminal = stops.length > 0 && stop.stopIndex === stops.length - 1;

    if (group.wants.has('arrive') && stop.arriveAt != null && !isOrigin && !passed && !arrived) {
      if (liveArriveAt != null) push('arrive', liveArriveAt, 'live', stop.arriveAt);
      else if (!expired(stop.arriveAt)) push('arrive', stop.arriveAt, 'plan', stop.arriveAt);
    }

    if (group.wants.has('depart') && stop.departAt != null && !isTerminal && !passed) {
      if (arrived) {
        push('depart', Math.max(stop.departAt, now), 'live', stop.departAt, true);
      } else if (liveArriveAt != null) {
        push('depart', Math.max(stop.departAt, liveArriveAt), 'live', stop.departAt);
      } else if (!expired(stop.departAt)) {
        push('depart', stop.departAt, 'plan', stop.departAt);
      }
    }
  }

  return groups.map((group) => {
    const events = group.events
      .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
      .slice(0, args.limit);
    const stale = [...group.staleHere];
    const state: StationEventGroup['state'] = events.length === 0
      ? (stale.length ? 'stale' : 'no_vehicle')
      : 'ok';
    return { station_id: group.station_id, station_name: group.station_name, state, events, stale_vehicles: stale };
  });
}
