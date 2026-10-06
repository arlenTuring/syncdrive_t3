/**
 * 儀表板站點到站清單（N2W、S2W、T3…）
 * =================================
 *
 * 每一站列出接下來會到的車，依到站時刻排序。三種來源合在一起，每一筆都標明是哪一種：
 *
 * <table>
 *   <tr><td>live</td><td>車端回報的目前目標站與剩餘秒數（current_leg）。到站時刻＝回報當下的
 *       營運時刻＋剩餘秒數，所以加速重播也對。資料超過新鮮度門檻（實際時間）就不算即時。</td></tr>
 *   <tr><td>plan</td><td>每日計畫的站序時刻：這一班之後的站、還沒開始的班次。沒有即時資料時就是它，
 *       不冒充即時。</td></tr>
 * </table>
 *
 * 一筆的身分是「班次＋站」，不是「車＋站」：同一台車跑完一圈再次到同一站是另一筆，不會被當成重複刪掉。
 * 已到站（車停在這一站或已經往後面的站開）、班次已結束、取消、故障的移除；計畫時刻已過很久、
 * 又沒有任何執行資料的計畫筆數也移除（不是即將到站）。
 */

export type PlannedArrival = {
  tripCode: string;
  vehicleCode: string;
  stationId: string;
  stationName: string;
  /** 這一站在這班站序裡的位置（0 起算） */
  stopIndex: number;
  /** 營運時刻（毫秒） */
  arriveAt: number;
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

export type StationArrival = {
  key: string;
  vehicle_code: string;
  trip_code: string;
  station_id: string;
  station_name: string;
  eta_at: number;
  kind: 'live' | 'plan';
  planned_at: number | null;
  delay_seconds: number | null;
};

export type StationEtaGroup = {
  station_id: string;
  station_name: string;
  /** ok：有資料；no_vehicle：沒有車接近；stale：只剩過期的即時資料可用（不顯示成即時） */
  state: 'ok' | 'no_vehicle' | 'stale';
  arrivals: StationArrival[];
  stale_vehicles: string[];
};

/** 計畫時刻過了這麼久還沒有任何執行資料：不是即將到站 */
export const PLAN_EXPIRED_AFTER_MS = 2 * 60_000;
/** 到站判定：目標就是這一站、而且距離小於這個值或車端回報停靠中 */
export const ARRIVED_DISTANCE_M = 5;
const DWELLING_PHASES = new Set(['DWELLING', 'DOCKED', 'AT_STATION']);

export function mergeStationArrivals(args: {
  stationIds: string[];
  stationNames: Map<string, string>;
  planned: PlannedArrival[];
  /** 每班的站序（班次代號 → 站 id 陣列），判斷「已經開過這一站」用 */
  stopsByTrip: Map<string, string[]>;
  live: LiveVehicle[];
  tripStates: Map<string, TripState>;
  operatingNow: number;
  staleAfterSeconds: number;
  limit: number;
}): StationEtaGroup[] {
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

  const groups = args.stationIds.map((stationId) => ({
    station_id: stationId,
    station_name: args.stationNames.get(stationId) ?? stationId,
    arrivals: [] as StationArrival[],
    staleHere: new Set<string>(),
  }));
  const byStation = new Map(groups.map((g) => [g.station_id, g]));

  for (const plan of args.planned) {
    const group = byStation.get(plan.stationId);
    if (!group) continue;
    const state = args.tripStates.get(plan.tripCode);
    // 班次已結束（完成、取消、故障結案）：這一站已經不會再到
    if (state && (state.status === 'END' || state.status === 'FAULTED')) continue;
    const live = liveByTrip.get(plan.tripCode);
    const key = `${plan.tripCode}|${plan.stationId}|${plan.stopIndex}`;
    if (live) {
      const stops = args.stopsByTrip.get(plan.tripCode) ?? [];
      const targetIndex = live.targetStationId ? stops.indexOf(live.targetStationId) : -1;
      // 已經往後面的站開：這一站開過了
      if (targetIndex > plan.stopIndex) continue;
      if (targetIndex === plan.stopIndex) {
        const arrived =
          (live.distanceM != null && live.distanceM < ARRIVED_DISTANCE_M)
          || DWELLING_PHASES.has(String(live.vehiclePhase ?? '').toUpperCase());
        if (arrived) continue;
        if (live.etaSeconds != null) {
          const etaAt = live.observedOp + live.etaSeconds * 1000;
          group.arrivals.push({
            key,
            vehicle_code: plan.vehicleCode,
            trip_code: plan.tripCode,
            station_id: plan.stationId,
            station_name: plan.stationName,
            eta_at: etaAt,
            kind: 'live',
            planned_at: plan.arriveAt,
            delay_seconds: Math.round((etaAt - plan.arriveAt) / 1000),
          });
          continue;
        }
      }
    } else if (plan.arriveAt < args.operatingNow - PLAN_EXPIRED_AFTER_MS) {
      // 計畫時刻早就過了、也沒有執行資料：不是即將到站
      continue;
    }
    if (!live && staleVehicles.has(plan.vehicleCode) && plan.arriveAt <= args.operatingNow + 30 * 60_000) {
      group.staleHere.add(plan.vehicleCode);
    }
    group.arrivals.push({
      key,
      vehicle_code: plan.vehicleCode,
      trip_code: plan.tripCode,
      station_id: plan.stationId,
      station_name: plan.stationName,
      eta_at: plan.arriveAt,
      kind: 'plan',
      planned_at: plan.arriveAt,
      delay_seconds: null,
    });
  }

  return groups.map((group) => {
    const arrivals = group.arrivals
      .sort((a, b) => a.eta_at - b.eta_at || a.key.localeCompare(b.key))
      .slice(0, args.limit);
    const stale = [...group.staleHere];
    const state: StationEtaGroup['state'] = arrivals.length === 0
      ? (stale.length ? 'stale' : 'no_vehicle')
      : 'ok';
    return { station_id: group.station_id, station_name: group.station_name, state, arrivals, stale_vehicles: stale };
  });
}
