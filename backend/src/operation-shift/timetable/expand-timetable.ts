import {
  DAY_END_SECOND,
  formatSecondToHms,
  minuteToSecond,
  parseClockToSecond,
} from './clock';
import {
  buildTimetableStationStops,
  resolveRouteForBlock,
  type TimetableBlock,
  type TimetableRoute,
  type TimetableStationDwell,
  type TimetableStationLegTravel,
  type TimetableStationStop,
} from './build-station-stops';
import { resolveTimetableTripCode } from './trip-code';
import {
  buildStationAliasIndexFromMapDocument,
  isVirtualCrossoverStationId,
  loadMapDocumentForShift,
  resolveStationAlias,
} from './station-alias';

export type TimeRangeFilter = {
  /** 含；預設 0 */
  fromSecond: number;
  /** 含；預設日終 */
  toSecond: number;
};

export type TimetableTripStationDto = {
  order: number;
  station_id: string;
  station_name: string;
  /** 首站僅關心出發；中途有抵達／出發；末站抵達＋靠站完成 */
  role: 'origin' | 'intermediate' | 'terminal';
  arrival: string | null;
  departure: string | null;
  dwell_complete: string | null;
  base_dwell_seconds: number;
  dwell_seconds: number;
  travel_to_next_seconds: number | null;
};

export type TimetableTripDto = {
  trip_code: string;
  block_id: string;
  timeline_row: number;
  task_type: string;
  /** 任務顯示名（保養／行檢／充電等）；正線常為空 */
  label: string | null;
  /** 儀表板班次卡標籤；由班表作者明確設定，不由路線方向推論。 */
  card_label: string;
  source: string;
  route_id: string | null;
  route_code: string | null;
  route_name: string | null;
  card_start: string;
  card_end: string;
  card_start_second: number;
  card_end_second: number;
  stations: TimetableTripStationDto[];
};

export type StationEtaEventDto = {
  station_id: string;
  /** 地圖停靠點別名（顯示主標題）；找不到則退回站序名 */
  station_alias: string;
  station_name: string;
  /** origin｜intermediate｜terminal */
  role: 'origin' | 'intermediate' | 'terminal';
  /** 計畫抵達（首站 origin 通常為 null） */
  eta_arrive: string | null;
  /**
   * 計畫離站：
   * - origin／intermediate：出發
   * - terminal：靠站完成（卡結束）
   */
  eta_depart: string | null;
  eta_arrive_second: number | null;
  eta_depart_second: number | null;
  /** 到站與離站為同一秒（不停靠／途經） */
  non_stop: boolean;
  /** 設定靠站秒數（不含緩衝） */
  base_dwell_seconds: number;
  /** 有效停靠秒數（靠站＋緩衝；末站可能含卡尾併入） */
  dwell_seconds: number;
  /** 靠站緩衝秒數（有效停靠 − 設定靠站，≧0） */
  buffer_seconds: number;
  trip_code: string;
  block_id: string;
  timeline_row: number;
  route_code: string | null;
  route_name: string | null;
  /** 車輛號碼尚未綁定班表時間線，固定 null */
  vehicle_id: null;
};

export function parseTimeRangeQuery(args: {
  from?: string;
  to?: string;
}): TimeRangeFilter {
  const fromSecond = parseClockToSecond(args.from) ?? 0;
  const toSecond = parseClockToSecond(args.to) ?? DAY_END_SECOND;
  if (toSecond < fromSecond) {
    return { fromSecond: toSecond, toSecond: fromSecond };
  }
  return { fromSecond, toSecond };
}

function overlapsRange(
  startSecond: number,
  endSecond: number,
  range: TimeRangeFilter,
): boolean {
  return endSecond >= range.fromSecond && startSecond <= range.toSecond;
}

function inRange(second: number, range: TimeRangeFilter): boolean {
  return second >= range.fromSecond && second <= range.toSecond;
}

function stopToDto(
  stop: TimetableStationStop,
  index: number,
  total: number,
): TimetableTripStationDto {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const arrival = formatSecondToHms(stop.arrivalSecond);
  const departure = formatSecondToHms(stop.departureSecond);

  if (isFirst && !isLast) {
    return {
      order: stop.order,
      station_id: stop.stationId,
      station_name: stop.stationName,
      role: 'origin',
      arrival: null,
      departure,
      dwell_complete: null,
      base_dwell_seconds: stop.baseDwellSeconds,
      dwell_seconds: stop.dwellSeconds,
      travel_to_next_seconds: stop.travelToNextSeconds,
    };
  }
  if (isLast && !isFirst) {
    return {
      order: stop.order,
      station_id: stop.stationId,
      station_name: stop.stationName,
      role: 'terminal',
      arrival,
      departure: null,
      dwell_complete: departure,
      base_dwell_seconds: stop.baseDwellSeconds,
      dwell_seconds: stop.dwellSeconds,
      travel_to_next_seconds: null,
    };
  }
  if (isFirst && isLast) {
    return {
      order: stop.order,
      station_id: stop.stationId,
      station_name: stop.stationName,
      role: 'terminal',
      arrival: stop.arrivalSecond === stop.departureSecond ? null : arrival,
      departure: formatSecondToHms(stop.arrivalSecond),
      dwell_complete: departure,
      base_dwell_seconds: stop.baseDwellSeconds,
      dwell_seconds: stop.dwellSeconds,
      travel_to_next_seconds: null,
    };
  }
  return {
    order: stop.order,
    station_id: stop.stationId,
    station_name: stop.stationName,
    role: 'intermediate',
    arrival,
    departure,
    dwell_complete: null,
    base_dwell_seconds: stop.baseDwellSeconds,
    dwell_seconds: stop.dwellSeconds,
    travel_to_next_seconds: stop.travelToNextSeconds,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const DEFAULT_SECTION_CARD_LABELS: Record<string, string> = {
  charging: '充電',
  washing: '洗車',
  servicing: '保養',
  inspection: '行檢',
  standby: '待命',
  idle: '暫停',
  dispatch: '調度',
};

function resolveCardLabel(args: {
  body: Record<string, unknown>;
  block: TimetableBlock;
  route: TimetableRoute | null;
}): string {
  const { body, block, route } = args;
  if (block.source === 'hold') return '暫停';
  if (block.taskType === 'passenger') return route?.cardLabel?.trim() || '營運';

  const labels = asRecord(body.maintenanceSectionCardLabelBySection);
  const key = block.taskType === 'washing'
    ? 'carWash'
    : block.taskType === 'servicing'
      ? 'maintenance'
      : block.taskType === 'inspection'
        ? 'preTrip'
        : block.taskType === 'standby'
          ? 'mobile'
          : block.taskType;
  const configured = typeof labels?.[key] === 'string' ? String(labels[key]).trim() : '';
  return configured || DEFAULT_SECTION_CARD_LABELS[block.taskType] || block.label?.trim() || '整備';
}

function parseStationDwells(raw: unknown): TimetableStationDwell[] {
  if (!Array.isArray(raw)) return [];
  const out: TimetableStationDwell[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.stationId !== 'string') continue;
    out.push({
      stationId: row.stationId,
      stationName: typeof row.stationName === 'string' ? row.stationName : undefined,
      dwellSeconds:
        typeof row.dwellSeconds === 'number' && Number.isFinite(row.dwellSeconds)
          ? row.dwellSeconds
          : null,
      dwellRequired: typeof row.dwellRequired === 'boolean' ? row.dwellRequired : undefined,
      dwellMode:
        row.dwellMode === 'no_stop' || row.dwellMode === 'line_change'
          ? row.dwellMode
          : 'seconds',
    });
  }
  return out;
}

function parseLegs(raw: unknown): TimetableStationLegTravel[] {
  if (!Array.isArray(raw)) return [];
  const out: TimetableStationLegTravel[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    if (typeof row.fromStationId !== 'string' || typeof row.toStationId !== 'string') continue;
    const avg = Number(row.avgTravelTimeSeconds);
    const min = Number(row.minTravelTimeSeconds);
    if (!Number.isFinite(avg) || !Number.isFinite(min)) continue;
    out.push({
      fromStationId: row.fromStationId,
      toStationId: row.toStationId,
      avgTravelTimeSeconds: avg,
      minTravelTimeSeconds: min,
    });
  }
  return out;
}

export function parseSelectedRoutes(body: Record<string, unknown>): TimetableRoute[] {
  const raw = body.selectedRoutes;
  if (!Array.isArray(raw)) return [];
  const out: TimetableRoute[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.routeId !== 'string') continue;
    const stationIds = Array.isArray(row.stationIds)
      ? row.stationIds.filter((id): id is string => typeof id === 'string')
      : [];
    out.push({
      routeId: row.routeId,
      routeName: typeof row.routeName === 'string' ? row.routeName : undefined,
      routeCode: typeof row.routeCode === 'string' ? row.routeCode : undefined,
      cardLabel: typeof row.cardLabel === 'string' ? row.cardLabel.trim() : undefined,
      stationIds,
      stationDwells: parseStationDwells(row.stationDwells),
      stationLegTravels: parseLegs(row.stationLegTravels),
      avgTravelTimeSeconds:
        typeof row.avgTravelTimeSeconds === 'number' ? row.avgTravelTimeSeconds : undefined,
      minTravelTimeSeconds:
        typeof row.minTravelTimeSeconds === 'number' ? row.minTravelTimeSeconds : undefined,
      dwellSlackSeconds:
        typeof row.dwellSlackSeconds === 'number' ? row.dwellSlackSeconds : undefined,
    });
  }
  return out;
}

export function extractPlanBlocks(body: Record<string, unknown>): TimetableBlock[] {
  const scheduleOutput = asRecord(body.scheduleOutput);
  const plan = asRecord(scheduleOutput?.plan);
  const timelines = plan?.timelines;
  if (!Array.isArray(timelines)) return [];

  const blocks: TimetableBlock[] = [];
  for (const timeline of timelines) {
    const tl = asRecord(timeline);
    if (!tl || !Array.isArray(tl.blocks)) continue;
    for (const item of tl.blocks) {
      const row = asRecord(item);
      if (!row || typeof row.id !== 'string') continue;
      if (typeof row.plannedStartMinute !== 'number' || typeof row.plannedEndMinute !== 'number') {
        continue;
      }
      blocks.push({
        id: row.id,
        timelineRow: typeof row.timelineRow === 'number' ? row.timelineRow : 1,
        taskType: typeof row.taskType === 'string' ? row.taskType : 'passenger',
        label: typeof row.label === 'string' ? row.label : undefined,
        routeId: typeof row.routeId === 'string' ? row.routeId : undefined,
        routeName: typeof row.routeName === 'string' ? row.routeName : undefined,
        routeCode: typeof row.routeCode === 'string' ? row.routeCode : undefined,
        plannedStartMinute: row.plannedStartMinute,
        plannedEndMinute: row.plannedEndMinute,
        source: typeof row.source === 'string' ? row.source : undefined,
        entryServiceSectionCode:
          typeof row.entryServiceSectionCode === 'string'
            ? row.entryServiceSectionCode
            : undefined,
        stationDwells: parseStationDwells(row.stationDwells),
        dwellSlackSeconds:
          typeof row.dwellSlackSeconds === 'number' ? row.dwellSlackSeconds : undefined,
      });
    }
  }
  return blocks;
}

export function expandTimetableTrips(args: {
  body: Record<string, unknown>;
  range: TimeRangeFilter;
  /**
   * true：只載客正線（含進場載客 entry_service）。
   * false：載入全部任務（保養／行檢／充電／待命／調度等）；仍略過 transition。
   * 預設 false。
   */
  passengerOnly?: boolean;
}): TimetableTripDto[] {
  const routes = parseSelectedRoutes(args.body);
  const blocks = extractPlanBlocks(args.body);
  const passengerOnly = args.passengerOnly === true;
  const trips: TimetableTripDto[] = [];

  let tripIndex = 0;
  for (const block of blocks) {
    if (block.source === 'transition') continue;
    if (passengerOnly && block.taskType !== 'passenger') continue;

    const startSecond = Math.round(minuteToSecond(block.plannedStartMinute));
    const endSecond = Math.round(minuteToSecond(block.plannedEndMinute));
    if (!overlapsRange(startSecond, endSecond, args.range)) continue;

    const route = resolveRouteForBlock(block, routes);
    const stops = buildTimetableStationStops(block, route);
    const tripCode = resolveTimetableTripCode(block, tripIndex);
    tripIndex += 1;

    trips.push({
      trip_code: tripCode,
      block_id: block.id,
      timeline_row: block.timelineRow,
      task_type: block.taskType,
      label: block.label?.trim() || null,
      card_label: resolveCardLabel({ body: args.body, block, route }),
      source: block.source ?? 'template_bar',
      route_id: block.routeId ?? route?.routeId ?? null,
      route_code: block.routeCode ?? route?.routeCode ?? null,
      route_name: block.routeName ?? route?.routeName ?? block.label ?? null,
      card_start: formatSecondToHms(startSecond),
      card_end: formatSecondToHms(endSecond),
      card_start_second: startSecond,
      card_end_second: endSecond,
      stations: stops.map((stop, index) => stopToDto(stop, index, stops.length)),
    });
  }

  trips.sort((a, b) => a.card_start_second - b.card_start_second
    || a.timeline_row - b.timeline_row);
  return trips;
}

export function expandStationEtas(args: {
  body: Record<string, unknown>;
  range: TimeRangeFilter;
  stationId?: string;
  /** 預設 true：排除虛擬渡線端點，只留停靠點 */
  passengerStopsOnly?: boolean;
}): StationEtaEventDto[] {
  const trips = expandTimetableTrips({
    body: args.body,
    range: { fromSecond: 0, toSecond: DAY_END_SECOND },
    /** ETA 站顯只看正線停靠點事件 */
    passengerOnly: true,
  });
  const stationFilter = args.stationId?.trim() || null;
  const passengerStopsOnly = args.passengerStopsOnly !== false;
  const { mapDocument } = loadMapDocumentForShift(args.body);
  const aliasIndex = buildStationAliasIndexFromMapDocument(mapDocument);
  const events: StationEtaEventDto[] = [];

  for (const trip of trips) {
    for (const stop of trip.stations) {
      if (stationFilter && stop.station_id !== stationFilter) continue;
      if (passengerStopsOnly && isVirtualCrossoverStationId(stop.station_id)) {
        continue;
      }

      const arriveSecond =
        stop.arrival != null ? parseClockToSecond(stop.arrival) : null;
      const departClock = stop.departure ?? stop.dwell_complete;
      const departSecond =
        departClock != null ? parseClockToSecond(departClock) : null;

      const touchArrive = arriveSecond != null && inRange(arriveSecond, args.range);
      const touchDepart = departSecond != null && inRange(departSecond, args.range);
      if (!touchArrive && !touchDepart) continue;

      const nonStop =
        (arriveSecond == null && departSecond != null)
        || (arriveSecond != null
          && departSecond != null
          && arriveSecond === departSecond)
        || stop.dwell_seconds <= 0;

      events.push({
        station_id: stop.station_id,
        station_alias: resolveStationAlias(
          stop.station_id,
          aliasIndex,
          stop.station_name,
        ),
        station_name: stop.station_name,
        role: stop.role,
        eta_arrive: stop.arrival,
        eta_depart: departClock,
        eta_arrive_second: arriveSecond,
        eta_depart_second: departSecond,
        non_stop: nonStop,
        base_dwell_seconds: stop.base_dwell_seconds,
        dwell_seconds: stop.dwell_seconds,
        buffer_seconds: Math.max(0, stop.dwell_seconds - stop.base_dwell_seconds),
        trip_code: trip.trip_code,
        block_id: trip.block_id,
        timeline_row: trip.timeline_row,
        route_code: trip.route_code,
        route_name: trip.route_name,
        vehicle_id: null,
      });
    }
  }

  events.sort((a, b) => {
    const aKey = a.eta_arrive_second ?? a.eta_depart_second ?? 0;
    const bKey = b.eta_arrive_second ?? b.eta_depart_second ?? 0;
    if (aKey !== bKey) return aKey - bKey;
    const aliasCmp = a.station_alias.localeCompare(b.station_alias, 'zh-Hant');
    if (aliasCmp !== 0) return aliasCmp;
    return a.timeline_row - b.timeline_row;
  });
  return events;
}

export type StationEtaGroupDto = {
  station_id: string;
  station_alias: string;
  station_name: string;
  eta_count: number;
  etas: StationEtaEventDto[];
};

/**
 * 依站分組；並補齊地圖上全部停靠點別名（0 筆也要列出）。
 * 虛擬渡線端點不列為頁籤。
 */
export function groupStationEtasIncludingMapAliases(args: {
  etas: StationEtaEventDto[];
  mapDocument: Record<string, unknown> | null | undefined;
  stationId?: string | null;
}): StationEtaGroupDto[] {
  const stationFilter = args.stationId?.trim() || null;
  const map = new Map<string, {
    station_id: string;
    station_alias: string;
    station_name: string;
    etas: StationEtaEventDto[];
  }>();

  for (const eta of args.etas) {
    if (stationFilter && eta.station_id !== stationFilter) continue;
    const existing = map.get(eta.station_id);
    if (existing) {
      existing.etas.push(eta);
    } else {
      map.set(eta.station_id, {
        station_id: eta.station_id,
        station_alias: eta.station_alias,
        station_name: eta.station_name,
        etas: [eta],
      });
    }
  }

  const aliasIndex = buildStationAliasIndexFromMapDocument(args.mapDocument);
  for (const [stationId, alias] of aliasIndex.entries()) {
    if (isVirtualCrossoverStationId(stationId)) continue;
    if (stationFilter && stationId !== stationFilter) continue;
    const existing = map.get(stationId);
    if (existing) {
      existing.station_alias = alias;
      continue;
    }
    map.set(stationId, {
      station_id: stationId,
      station_alias: alias,
      station_name: alias,
      etas: [],
    });
  }

  if (stationFilter && !map.has(stationFilter)) {
    map.set(stationFilter, {
      station_id: stationFilter,
      station_alias: resolveStationAlias(stationFilter, aliasIndex, stationFilter),
      station_name: stationFilter,
      etas: [],
    });
  }

  return [...map.values()]
    .map((group) => ({
      station_id: group.station_id,
      station_alias: group.station_alias,
      station_name: group.station_name,
      eta_count: group.etas.length,
      etas: [...group.etas].sort((a, b) => {
        const aKey = a.eta_arrive_second ?? a.eta_depart_second ?? 0;
        const bKey = b.eta_arrive_second ?? b.eta_depart_second ?? 0;
        return aKey - bKey;
      }),
    }))
    .sort((a, b) => a.station_alias.localeCompare(b.station_alias, 'zh-Hant'));
}
