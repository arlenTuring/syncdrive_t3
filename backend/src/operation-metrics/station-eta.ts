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
 *
 * 不分卡片種類（使用者 2026-11-20）：載客、出入場移動都算，經過不停的移動卡列一筆「通過」。每一筆帶
 * 車輛意圖（依卡片，見 station-eta.plan.ts），出發那一筆另外標出發前在站上的月台暫停／待命。
 */

export type StationEventKind = 'arrive' | 'depart';

export type PlannedStop = {
  tripCode: string;
  /**
   * 這張卡的唯一身分（預設＝班次代號）。班次代號只在同一營運日內唯一：前一天延續到凌晨的卡
   * 跟今天同代號的卡要分開，呼叫端用「營運日｜代號」。
   */
  tripKey?: string;
  vehicleCode: string;
  stationId: string;
  stationName: string;
  taskLabel: string;
  /** 車開進這一站時的意圖（依卡片：載客上行、終點下車、出場…）；沒給就用 taskLabel */
  arriveIntent?: string;
  /** 車從這一站開出時的意圖 */
  departIntent?: string;
  /** 移動卡經過這一站、不停（停留 0 秒的途經點）：只列一筆「通過」 */
  pass?: boolean;
  /** 這一站在這班站序裡的位置（0 起算） */
  stopIndex: number;
  /** 營運時刻（毫秒）；起站沒有到站、終站沒有出發 */
  arriveAt: number | null;
  departAt: number | null;
};

export type LiveVehicle = {
  vehicleCode: string;
  tripCode: string | null;
  /** 對應 PlannedStop.tripKey；沒給就用 tripCode */
  tripKey?: string | null;
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

export type TripState = { status: string; closedReason: string | null; lastDwellStationId?: string | null };

/** 月台暫停／待命卡：車停在這一站的時段（營運時刻毫秒） */
export type StationHoldSpan = {
  vehicleCode: string;
  stationId: string;
  startAt: number;
  endAt: number;
  /** 卡片名稱：暫停、待命 */
  label: string;
};

export type StationEvent = {
  key: string;
  /** 同一車輛、同一次停靠的穩定識別；到站轉出發時不改變。 */
  coupling_key: string;
  row_key: string;
  /** pass：移動卡經過這一站、不停 */
  event: StationEventKind | 'pass';
  vehicle_code: string;
  trip_code: string;
  station_id: string;
  station_name: string;
  vehicle_name: string;
  task_label: string;
  event_label: '抵達' | '出發' | '通過';
  /** 車輛意圖（依排班卡片：載客上行、載客下行、終點下車、出場、入廠、通過） */
  intent: string;
  /** 出發前停在站上的月台暫停／待命卡名稱；出發那一筆才有 */
  hold_label: string | null;
  /** 營運時刻（毫秒） */
  at: number;
  /** live：依車端即時回報推估；plan：每日計畫時刻 */
  kind: 'live' | 'plan';
  /** 車已停在這一站（出發那一筆） */
  at_station: boolean;
  planned_at: number | null;
  delay_seconds: number | null;
  time_state: 'countdown' | 'overdue' | 'due' | 'stale';
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
  /** 月台暫停／待命卡；出發那一筆標出發前在站上做什麼 */
  holds?: StationHoldSpan[];
  operatingNow: number;
  staleAfterSeconds: number;
  limit: number;
  /** 沒有即時資料的計畫列，過了表定時間再留多久（毫秒） */
  planExpiredAfterMs?: number;
}): StationEventGroup[] {
  const keyOf = (stop: PlannedStop) => stop.tripKey ?? stop.tripCode;
  const liveByTrip = new Map<string, LiveVehicle>();
  const staleVehicles = new Set<string>();
  for (const vehicle of args.live) {
    if (!vehicle.tripCode) continue;
    if (vehicle.ageSeconds > args.staleAfterSeconds) {
      staleVehicles.add(vehicle.vehicleCode);
      continue;
    }
    liveByTrip.set(vehicle.tripKey ?? vehicle.tripCode, vehicle);
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

  const firstAtByTrip = new Map<string, number>();
  const vehicleByTrip = new Map<string, string>();
  for (const stop of args.planned) {
    const at = Math.min(stop.arriveAt ?? Number.POSITIVE_INFINITY, stop.departAt ?? Number.POSITIVE_INFINITY);
    const id = keyOf(stop);
    if (Number.isFinite(at)) firstAtByTrip.set(id, Math.min(firstAtByTrip.get(id) ?? at, at));
    vehicleByTrip.set(id, stop.vehicleCode);
  }
  const latestProgressedAtByVehicle = new Map<string, number>();
  for (const [tripCode, state] of args.tripStates) {
    if (!['PROCESSING', 'END', 'FAULTED'].includes(state.status)) continue;
    const vehicleCode = vehicleByTrip.get(tripCode);
    const at = firstAtByTrip.get(tripCode);
    if (!vehicleCode || at == null) continue;
    latestProgressedAtByVehicle.set(vehicleCode, Math.max(latestProgressedAtByVehicle.get(vehicleCode) ?? at, at));
  }

  // 只在這個 Table 明確選取的停靠點內，依車輛與計畫順序把「前一班到站 → 下一班出發」配成同一次停靠。
  const couplingByEvent = new Map<string, string>();
  const eventId = (stop: PlannedStop, event: StationEventKind | 'pass') => `${keyOf(stop)}|${stop.stationId}|${stop.stopIndex}|${event}`;
  const byVehicle = new Map<string, Array<{ stop: PlannedStop; event: StationEventKind; at: number }>>();
  for (const stop of args.planned) {
    const group = byStation.get(stop.stationId);
    if (!group || stop.pass) continue;
    const stops = args.stopsByTrip.get(keyOf(stop)) ?? [];
    const events = byVehicle.get(stop.vehicleCode) ?? [];
    if (group.wants.has('arrive') && stop.arriveAt != null && stop.stopIndex !== 0) {
      events.push({ stop, event: 'arrive', at: stop.arriveAt });
    }
    if (group.wants.has('depart') && stop.departAt != null && stop.stopIndex !== stops.length - 1) {
      events.push({ stop, event: 'depart', at: stop.departAt });
    }
    byVehicle.set(stop.vehicleCode, events);
  }
  for (const [vehicleCode, events] of byVehicle) {
    let dwellKey: string | null = null;
    events.sort((a, b) => a.at - b.at || (a.event === 'arrive' ? -1 : 1));
    for (const item of events) {
      if (item.event === 'arrive') {
        dwellKey = `${vehicleCode}|${keyOf(item.stop)}|${item.stop.stationId}|${item.stop.stopIndex}`;
        couplingByEvent.set(eventId(item.stop, item.event), dwellKey);
      } else {
        const key = dwellKey ?? `${vehicleCode}|${keyOf(item.stop)}|${item.stop.stationId}|${item.stop.stopIndex}`;
        couplingByEvent.set(eventId(item.stop, item.event), key);
        dwellKey = null;
      }
    }
  }

  /** 出發前停在這一站的月台暫停／待命卡：同一台車、同一站，卡片結束就是這一班出發（容許 2 秒） */
  const holdBefore = (stop: PlannedStop): string | null => {
    if (stop.departAt == null) return null;
    const hold = (args.holds ?? []).find((h) => h.vehicleCode === stop.vehicleCode
      && h.stationId === stop.stationId
      && Math.abs(h.endAt - stop.departAt!) <= 2000);
    return hold?.label ?? null;
  };

  const confirmedDwells = new Set<string>();
  const completedTerminalDwells = new Set<string>();
  for (const stop of args.planned) {
    if (stop.pass) continue;
    const live = liveByTrip.get(keyOf(stop));
    const stops = args.stopsByTrip.get(keyOf(stop)) ?? [];
    const targetIndex = live?.targetStationId ? stops.indexOf(live.targetStationId) : -1;
    const state = args.tripStates.get(keyOf(stop));
    const normalTerminalCompletion = state?.status === 'END'
      && !state.closedReason
      && stop.stopIndex === stops.length - 1;
    if (normalTerminalCompletion) {
      const key = couplingByEvent.get(eventId(stop, 'arrive'));
      if (key) completedTerminalDwells.add(key);
    }
    if (state?.lastDwellStationId === stop.stationId) {
      const key = couplingByEvent.get(eventId(stop, 'arrive'));
      if (key) confirmedDwells.add(key);
    }
    if (live
      && targetIndex === stop.stopIndex
      && DWELLING_PHASES.has(String(live.vehiclePhase ?? '').toUpperCase())
    ) {
      const key = couplingByEvent.get(eventId(stop, 'arrive'));
      if (key) confirmedDwells.add(key);
    }
  }

  for (const stop of args.planned) {
    const group = byStation.get(stop.stationId);
    if (!group) continue;
    const state = args.tripStates.get(keyOf(stop));
    // 班次已結束（完成、取消、故障結案）：這一站已經不會再有到站或出發
    if (state && (state.status === 'END' || state.status === 'FAULTED')) continue;
    // 舊待發單若已被同車後續實際任務超越，不能再靠計畫時間補回畫面。
    if (state?.status === 'PENDING'
      && (firstAtByTrip.get(keyOf(stop)) ?? 0) < (latestProgressedAtByVehicle.get(stop.vehicleCode) ?? 0)) continue;
    const live = liveByTrip.get(keyOf(stop));
    const stops = args.stopsByTrip.get(keyOf(stop)) ?? [];
    const targetIndex = live?.targetStationId ? stops.indexOf(live.targetStationId) : -1;
    const atTarget = !!live && targetIndex === stop.stopIndex;
    // 距離只是定位估值，不能單獨證明停靠；到站只認車端停靠 phase，跨班終點則認正常 REST 結案。
    const arrived = atTarget && DWELLING_PHASES.has(String(live!.vehiclePhase ?? '').toUpperCase());
    const liveArriveAt = atTarget && !arrived && live!.etaSeconds != null
      ? live!.observedOp + live!.etaSeconds * 1000
      : null;
    // 已經開往後面的站：這一站到站與出發都過了。起站：班次已開始、車已經在開往第二站
    const passed = !!live && targetIndex > stop.stopIndex;
    const staleHere = !live && staleVehicles.has(stop.vehicleCode);

    const push = (event: StationEventKind | 'pass', at: number, kind: 'live' | 'plan', plannedAt: number | null, atStation = false) => {
      const couplingKey = couplingByEvent.get(eventId(stop, event)) ?? eventId(stop, event);
      const timeState: StationEvent['time_state'] = staleHere
        ? 'stale'
        : at <= now
          ? (event === 'depart' && atStation ? 'due' : 'overdue')
          : 'countdown';
      group.events.push({
        key: eventId(stop, event),
        coupling_key: couplingKey,
        row_key: couplingKey,
        event,
        vehicle_code: stop.vehicleCode,
        trip_code: stop.tripCode,
        station_id: stop.stationId,
        station_name: stop.stationName,
        vehicle_name: stop.vehicleCode,
        task_label: stop.taskLabel,
        event_label: event === 'arrive' ? '抵達' : event === 'pass' ? '通過' : '出發',
        intent: event === 'pass'
          ? '通過'
          : (event === 'depart' ? stop.departIntent : stop.arriveIntent) || stop.taskLabel,
        hold_label: event === 'depart' ? holdBefore(stop) : null,
        at,
        kind,
        at_station: atStation,
        planned_at: plannedAt,
        delay_seconds: plannedAt != null ? Math.round((at - plannedAt) / 1000) : null,
        time_state: timeState,
      });
      if (staleHere && at <= now + 30 * 60_000) group.staleHere.add(stop.vehicleCode);
    };
    // 沒有即時資料可依：計畫時刻已過就不列（已開始的班次沒有即時資料也一樣，不冒充即將發生）
    const expired = (plannedAt: number) => !live && plannedAt < now - (args.planExpiredAfterMs ?? PLAN_EXPIRED_AFTER_MS);

    // 經過、不停：站上有設定到站或出發就列一筆「通過」；已經開往後面的站就拿掉
    if (stop.pass) {
      const at = stop.arriveAt ?? stop.departAt;
      if (at == null || passed || !(group.wants.has('arrive') || group.wants.has('depart'))) continue;
      if (liveArriveAt != null) push('pass', liveArriveAt, 'live', at);
      else if (!expired(at)) push('pass', at, 'plan', at);
      continue;
    }

    /*
     * 班與班接續的站（ST 的終點 T3上行＝下一班 TN 的起站）：計畫在兩班各記一次，其實是同一次
     * 到站與出發。到站算前一班的終點、出發算後一班的起站，各只列一次。
     */
    const isOrigin = stop.stopIndex === 0;
    const isTerminal = stops.length > 0 && stop.stopIndex === stops.length - 1;
    const arrivalCoupling = couplingByEvent.get(eventId(stop, 'arrive'));
    const departureCoupling = couplingByEvent.get(eventId(stop, 'depart'));
    const dwellConfirmed = arrived
      || (!!arrivalCoupling && confirmedDwells.has(arrivalCoupling))
      || (!!departureCoupling && confirmedDwells.has(departureCoupling))
      // 前一班正常結案可延續終點停靠證據，但下一班必須真的已建成待發單，不能拿歷史計畫補事件。
      || (state?.status === 'PENDING' && (
        (!!arrivalCoupling && completedTerminalDwells.has(arrivalCoupling))
        || (!!departureCoupling && completedTerminalDwells.has(departureCoupling))
      ));

    if (group.wants.has('arrive') && stop.arriveAt != null && !isOrigin && !passed && !dwellConfirmed) {
      if (liveArriveAt != null) push('arrive', liveArriveAt, 'live', stop.arriveAt);
      else if (!expired(stop.arriveAt)) push('arrive', stop.arriveAt, 'plan', stop.arriveAt);
    }

    if (group.wants.has('depart') && stop.departAt != null && !isTerminal && !passed && dwellConfirmed) {
      push('depart', stop.departAt, 'live', stop.departAt, true);
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
