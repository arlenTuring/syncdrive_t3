import {
  computeCapacityPphpd,
  computeHeadwaySecondsFromPphpd,
  resolveIntervalMinuteRanges,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute, ShiftScheduleServiceDirectionTag } from '../types/create';
import {
  recoverServiceDirectionTagsFromRoutes,
  sortSelectedRoutesByExecutionOrder,
} from '../types/create';
import type { GeneratedScheduleBlock, GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';

export const CAPACITY_DAY_MINUTES = 24 * 60;

/** @deprecated 舊上下行標籤；運能已改為以服務方向／路線為方向流 */
export type ServiceDirection = 'up' | 'down';

/**
 * 運能趨勢聚合方式：
 * - serviceDirection：同服務方向的班次併成一流，以滾動視窗平均班距換 pphpd
 * - route：每條路線各自一條流（診斷用）
 */
export type CapacityTrendViewMode = 'serviceDirection' | 'route';

/** @deprecated 舊別名；請用 serviceDirection */
export type CapacityTrendViewModeLegacyGroup = 'group';

/** 一條運能方向流（服務方向或單一路線） */
export type CapacityRouteStream = {
  streamKey: string;
  kind: CapacityTrendViewMode;
  routeId: string | null;
  groupId: string | null;
  serviceDirectionId: string | null;
  label: string;
  color: string;
  departureCount: number;
};

export type CapacityTrendSample = {
  /** 自 00:00 起算的分鐘 */
  minute: number;
  /**
   * 各路線流 pphpd 的平均（僅供與模板單向目標對照／摘要）。
   * 真正的 per-direction 值在 pphpdByStream。
   */
  pphpd: number;
  /** 該分鐘仍在執行正線的車輛數（輔助資訊） */
  activeVehicleCount: number;
  /**
   * 與摘要 pphpd 對齊的等效班距（秒）＝ vehicleCapacity × 3600 / pphpd。
   */
  headwaySeconds: number | null;
  /** 該分鐘有有效班距的路線流數量 */
  activeStreamCount: number;
  /** 各路線流 pphpd */
  pphpdByStream: Record<string, number>;
  /** 各路線流等效班距秒 */
  headwayByStream: Record<string, number>;
};

export type CapacityTrendSeries = {
  vehicleCapacity: number;
  samples: CapacityTrendSample[];
  /** 有發車的路線流（圖上各畫一條線） */
  streams: CapacityRouteStream[];
  maxPphpd: number;
  /** 已納入運能計算的正線發車趟次 */
  departureCount: number;
  /** 班表上的正線 template_bar 總數 */
  passengerBlockCount: number;
};

type DepartureEvent = {
  startSecond: number;
};

function isCapacityPassengerBlock(block: GeneratedScheduleBlock): boolean {
  return (
    block.taskType === 'passenger'
    && (
      block.source === 'template_bar'
      || block.source === 'entry_service'
      || block.source === 'relief_loop'
    )
  );
}

const STREAM_COLORS = [
  '#7CB8FF',
  '#5EEAD4',
  '#FBBF24',
  '#F472B6',
  '#A78BFA',
  '#34D399',
  '#FB923C',
  '#E879F9',
];

/**
 * 運能換算用的最短有效班距（秒）。
 * 低於此值的同路線連發視為「同班次／補完偽影」而非服務班距。
 */
export const MIN_CAPACITY_HEADWAY_SECONDS = 60;

/**
 * 趨勢線分桶（分鐘）。
 * 滾動視窗運能後再分桶取樣，避免點數過多。
 */
export const CAPACITY_TREND_BUCKET_MINUTES = 10;

/** 分桶後對 pphpd 做鄰近移動平均的半寬（點數）；1 → 三點平滑 */
export const CAPACITY_TREND_SMOOTH_HALF_WIDTH = 1;

/**
 * 運能計算視窗（分鐘）＝真正的「每小時」含義。
 * 用過去 window 分鐘內的同向班次數 × 載客量，避免站位微延後造成的密→疏瞬间班距把曲線畫成鋸齒。
 */
export const CAPACITY_ROLLING_WINDOW_MINUTES = 60;

function countPassengerTemplateBars(
  plan: GeneratedSchedulePlan | null | undefined,
): number {
  let count = 0;
  for (const timeline of plan?.timelines ?? []) {
    for (const block of timeline.blocks) {
      if (block.taskType === 'passenger' && block.source === 'template_bar') {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * 單一路線流鍵（route 模式）。
 * 無 routeId 時退回代號／名稱，仍避免把不同路線混成一桶。
 */
export function resolveCapacityStreamKey(
  block: GeneratedScheduleBlock,
): string | null {
  const routeId = block.routeId?.trim();
  if (routeId) return routeId;

  const code = block.routeCode?.trim().toUpperCase();
  if (code) return `code:${code}`;

  const name = block.routeName?.trim();
  if (name) return `name:${name}`;

  return null;
}

/** 路線群組流鍵；找不到群組時退回單一路線鍵，避免丟資料 */
export function resolveCapacityGroupStreamKey(
  block: GeneratedScheduleBlock,
  routeById: Map<string, ShiftScheduleSelectedRoute>,
): string | null {
  const routeId = block.routeId?.trim();
  if (routeId) {
    const route = routeById.get(routeId);
    if (route?.groupId?.trim()) return `group:${route.groupId.trim()}`;
  }
  return resolveCapacityStreamKey(block);
}

/** 服務方向流鍵；未設定服務方向時退回單一路線鍵 */
export function resolveCapacityServiceDirectionStreamKey(
  routeKey: string,
  routeById: Map<string, ShiftScheduleSelectedRoute>,
): string {
  const route = routeById.get(routeKey);
  const serviceDirectionId = route?.serviceDirectionId?.trim();
  if (serviceDirectionId) return `sdir:${serviceDirectionId}`;
  return routeKey;
}

function resolveStreamMeta(
  streamKey: string,
  mode: CapacityTrendViewMode,
  block: GeneratedScheduleBlock | undefined,
  selectedRoutes: ShiftScheduleSelectedRoute[],
  serviceDirectionTags: ShiftScheduleServiceDirectionTag[],
): Pick<
  CapacityRouteStream,
  'kind' | 'routeId' | 'groupId' | 'serviceDirectionId' | 'label'
> {
  if (mode === 'serviceDirection' && streamKey.startsWith('sdir:')) {
    const serviceDirectionId = streamKey.slice('sdir:'.length);
    const tag = serviceDirectionTags.find((item) => item.id === serviceDirectionId);
    const members = selectedRoutes.filter(
      (route) => route.serviceDirectionId?.trim() === serviceDirectionId,
    );
    const member = members[0];
    const fromMemberName = members
      .map((route) => route.serviceDirectionName?.trim())
      .find((name) => name);
    const label =
      tag?.name?.trim()
      || fromMemberName
      || '服務方向';
    return {
      kind: 'serviceDirection',
      routeId: null,
      groupId: member?.groupId?.trim() || null,
      serviceDirectionId,
      label,
    };
  }

  const fromSelected = selectedRoutes.find((route) => route.routeId === streamKey);
  if (fromSelected) {
    const code = fromSelected.routeCode?.trim();
    return {
      kind: 'route',
      routeId: fromSelected.routeId,
      groupId: fromSelected.groupId?.trim() || null,
      serviceDirectionId: fromSelected.serviceDirectionId?.trim() || null,
      label: code ? `${code} ${fromSelected.routeName}`.trim() : fromSelected.routeName,
    };
  }

  if (block?.routeCode?.trim() && block.routeName?.trim()) {
    return {
      kind: 'route',
      routeId: block.routeId?.trim() || null,
      groupId: null,
      serviceDirectionId: null,
      label: `${block.routeCode.trim()} ${block.routeName.trim()}`,
    };
  }
  if (block?.routeName?.trim()) {
    return {
      kind: 'route',
      routeId: block.routeId?.trim() || null,
      groupId: null,
      serviceDirectionId: null,
      label: block.routeName.trim(),
    };
  }
  if (block?.routeCode?.trim()) {
    return {
      kind: 'route',
      routeId: block.routeId?.trim() || null,
      groupId: null,
      serviceDirectionId: null,
      label: block.routeCode.trim(),
    };
  }
  if (streamKey.startsWith('code:')) {
    return {
      kind: 'route',
      routeId: null,
      groupId: null,
      serviceDirectionId: null,
      label: streamKey.slice(5),
    };
  }
  if (streamKey.startsWith('name:')) {
    return {
      kind: 'route',
      routeId: null,
      groupId: null,
      serviceDirectionId: null,
      label: streamKey.slice(5),
    };
  }
  return {
    kind: 'route',
    routeId: block?.routeId?.trim() || null,
    groupId: null,
    serviceDirectionId: null,
    label: streamKey,
  };
}

type CollectedStreams = {
  byStream: Map<string, DepartureEvent[]>;
  sampleBlockByStream: Map<string, GeneratedScheduleBlock>;
};

/** 一律以「路線」為單位收集發車；服務方向聚合時再合併發車序列 */
function collectDeparturesByRoute(
  plan: GeneratedSchedulePlan | null | undefined,
): CollectedStreams {
  const byStream = new Map<string, DepartureEvent[]>();
  const sampleBlockByStream = new Map<string, GeneratedScheduleBlock>();

  for (const timeline of plan?.timelines ?? []) {
    for (const block of timeline.blocks) {
      if (!isCapacityPassengerBlock(block)) continue;
      const routeKey = resolveCapacityStreamKey(block);
      if (!routeKey) continue;

      const list = byStream.get(routeKey) ?? [];
      list.push({ startSecond: minuteToSecond(block.plannedStartMinute) });
      byStream.set(routeKey, list);

      if (!sampleBlockByStream.has(routeKey)) {
        sampleBlockByStream.set(routeKey, block);
      }
    }
  }

  for (const list of byStream.values()) {
    list.sort((a, b) => a.startSecond - b.startSecond);
  }

  return { byStream, sampleBlockByStream };
}

/**
 * 服務方向發車：同一時間線上、同向連續**不同路線**路段（如 NT→TS）只算 **一趟班次**
 * （取該趟第一個發車）。同一起始路線再開一趟則另計，避免把串接路段算成兩倍運能。
 * Map key 已是流鍵（`sdir:…` 或未標籤的路線鍵）。
 */
function collectDeparturesByServiceDirection(
  plan: GeneratedSchedulePlan | null | undefined,
  routeById: Map<string, ShiftScheduleSelectedRoute>,
): CollectedStreams {
  const byStream = new Map<string, DepartureEvent[]>();
  const sampleBlockByStream = new Map<string, GeneratedScheduleBlock>();

  for (const timeline of plan?.timelines ?? []) {
    const blocks = timeline.blocks
      .filter(isCapacityPassengerBlock)
      .slice()
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

    let runStreamKey: string | null = null;
    let runStartRouteKey: string | null = null;
    let runStartSecond: number | null = null;
    let runSampleBlock: GeneratedScheduleBlock | null = null;

    const flushRun = () => {
      if (runStreamKey == null || runStartSecond == null) return;
      const list = byStream.get(runStreamKey) ?? [];
      list.push({ startSecond: runStartSecond });
      byStream.set(runStreamKey, list);
      if (runSampleBlock && !sampleBlockByStream.has(runStreamKey)) {
        sampleBlockByStream.set(runStreamKey, runSampleBlock);
      }
      runStreamKey = null;
      runStartRouteKey = null;
      runStartSecond = null;
      runSampleBlock = null;
    };

    for (const block of blocks) {
      const routeKey = resolveCapacityStreamKey(block);
      if (!routeKey) {
        flushRun();
        continue;
      }
      const streamKey = resolveCapacityServiceDirectionStreamKey(routeKey, routeById);

      if (streamKey === runStreamKey) {
        if (routeKey === runStartRouteKey) {
          // 同向又從同一起始路線出發＝下一趟班次
          flushRun();
        } else {
          // 同向、不同路線＝串接路段，併入本趟
          continue;
        }
      } else {
        flushRun();
      }

      runStreamKey = streamKey;
      runStartRouteKey = routeKey;
      runStartSecond = minuteToSecond(block.plannedStartMinute);
      runSampleBlock = block;
    }
    flushRun();
  }

  for (const list of byStream.values()) {
    list.sort((a, b) => a.startSecond - b.startSecond);
  }

  return { byStream, sampleBlockByStream };
}

function orderStreamKeys(
  streamKeys: string[],
  mode: CapacityTrendViewMode,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): string[] {
  const sortedRoutes = sortSelectedRoutesByExecutionOrder(selectedRoutes);

  if (mode === 'serviceDirection') {
    const directionOrder = new Map<string, number>();
    for (const [index, route] of sortedRoutes.entries()) {
      const key = route.serviceDirectionId?.trim()
        ? `sdir:${route.serviceDirectionId.trim()}`
        : route.routeId;
      if (!directionOrder.has(key)) directionOrder.set(key, index);
    }
    return [...streamKeys].sort((a, b) => {
      const ai = directionOrder.get(a);
      const bi = directionOrder.get(b);
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return a.localeCompare(b);
    });
  }

  const orderIndex = new Map(
    sortedRoutes.map((route, index) => [route.routeId, index] as const),
  );
  return [...streamKeys].sort((a, b) => {
    const ai = orderIndex.get(a);
    const bi = orderIndex.get(b);
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b);
  });
}

/**
 * 發車秒序列（排序去重）。
 * @param platoonFilter 為 true 時，過近連發視為同班次偽影只留先頭（單路線診斷用）。
 *   服務方向應為 false：已先合併同向連續路段，此處保留各趟班次。
 */
function uniqueDepartureLeadSeconds(
  departures: DepartureEvent[],
  platoonFilter: boolean,
): number[] {
  const uniqueSeconds = [...new Set(departures.map((event) => event.startSecond))].sort(
    (a, b) => a - b,
  );
  if (!platoonFilter) return uniqueSeconds;

  const platoonLeadSeconds: number[] = [];
  for (const second of uniqueSeconds) {
    const previous = platoonLeadSeconds[platoonLeadSeconds.length - 1];
    if (previous == null || second - previous >= MIN_CAPACITY_HEADWAY_SECONDS) {
      platoonLeadSeconds.push(second);
    }
  }
  return platoonLeadSeconds;
}

/**
 * 過去 windowSeconds 內「落在視窗中的相鄰班距」做平均，再換 pphpd。
 * 比「只用當下那一格瞬間班距」更能代表小時運能：密疏交錯會被平均掉。
 */
export function resolveRollingWindowCapacity(args: {
  leadSeconds: number[];
  sampleSecond: number;
  vehicleCapacity: number;
  windowSeconds: number;
}): { pphpd: number; headwaySeconds: number } | null {
  const { leadSeconds, sampleSecond, vehicleCapacity, windowSeconds } = args;
  if (windowSeconds <= 0 || vehicleCapacity <= 0 || leadSeconds.length < 2) return null;
  const windowStart = sampleSecond - windowSeconds;
  let gapSum = 0;
  let gapCount = 0;
  for (let i = 0; i < leadSeconds.length - 1; i += 1) {
    const start = leadSeconds[i]!;
    const end = leadSeconds[i + 1]!;
    const gap = end - start;
    if (gap < MIN_CAPACITY_HEADWAY_SECONDS) continue;
    // 班距時段與取樣視窗 [windowStart, sampleSecond] 有交集才計入
    if (end <= windowStart || start > sampleSecond) continue;
    gapSum += gap;
    gapCount += 1;
  }
  if (gapCount <= 0) return null;
  const meanHeadway = gapSum / gapCount;
  return {
    pphpd: computeCapacityPphpd(vehicleCapacity, meanHeadway),
    headwaySeconds: Math.round(meanHeadway),
  };
}

function countActiveVehiclesAt(
  plan: GeneratedSchedulePlan | null | undefined,
  minute: number,
): number {
  let count = 0;
  for (const timeline of plan?.timelines ?? []) {
    const active = timeline.blocks.some(
      (block) =>
        block.taskType === 'passenger'
        && block.source === 'template_bar'
        && block.plannedStartMinute <= minute
        && minute < block.plannedEndMinute,
    );
    if (active) count += 1;
  }
  return count;
}

function averageRecordValues(record: Record<string, number>): number | null {
  const values = Object.values(record);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * 將每分鐘樣本收成固定分鐘桶的平均，供趨勢線使用。
 */
export function bucketCapacitySamples(
  samples: CapacityTrendSample[],
  bucketMinutes: number,
  streamKeys: string[],
): CapacityTrendSample[] {
  if (samples.length === 0 || bucketMinutes <= 1) return samples;

  const byMinute = new Map(samples.map((sample) => [sample.minute, sample] as const));
  const out: CapacityTrendSample[] = [];

  for (
    let bucketStart = 0;
    bucketStart <= CAPACITY_DAY_MINUTES;
    bucketStart += bucketMinutes
  ) {
    const bucketEnd = Math.min(CAPACITY_DAY_MINUTES, bucketStart + bucketMinutes - 1);
    const group: CapacityTrendSample[] = [];
    for (let minute = bucketStart; minute <= bucketEnd; minute += 1) {
      const sample = byMinute.get(minute);
      if (sample) group.push(sample);
    }
    if (group.length === 0) continue;

    let pphpdSum = 0;
    let pphpdCount = 0;
    let vehicleSum = 0;
    const streamPphpdSum: Record<string, number> = {};
    const streamPphpdCount: Record<string, number> = {};

    for (const item of group) {
      if (item.activeStreamCount > 0) {
        pphpdSum += item.pphpd;
        pphpdCount += 1;
      }
      vehicleSum += item.activeVehicleCount;
      for (const key of streamKeys) {
        const streamPphpd = item.pphpdByStream[key];
        if (streamPphpd == null) continue;
        streamPphpdSum[key] = (streamPphpdSum[key] ?? 0) + streamPphpd;
        streamPphpdCount[key] = (streamPphpdCount[key] ?? 0) + 1;
      }
    }

    const pphpdByStream: Record<string, number> = {};
    for (const key of streamKeys) {
      const count = streamPphpdCount[key] ?? 0;
      if (count > 0) {
        pphpdByStream[key] = Math.round((streamPphpdSum[key] ?? 0) / count);
      }
    }

    out.push({
      minute: bucketStart,
      pphpd: pphpdCount === 0 ? 0 : Math.round(pphpdSum / pphpdCount),
      headwaySeconds: null,
      activeVehicleCount: Math.round(vehicleSum / group.length),
      activeStreamCount: Object.keys(pphpdByStream).length,
      pphpdByStream,
      headwayByStream: {},
    });
  }

  const last = out[out.length - 1];
  if (last && last.minute !== CAPACITY_DAY_MINUTES) {
    const endSample = byMinute.get(CAPACITY_DAY_MINUTES) ?? last;
    out.push({
      ...endSample,
      minute: CAPACITY_DAY_MINUTES,
      headwaySeconds: null,
      headwayByStream: {},
    });
  }

  return out;
}

/** 以顯示中的 pphpd 反推等效班距，確保與運能數字一致 */
export function syncHeadwaysWithPphpd(
  samples: CapacityTrendSample[],
  vehicleCapacity: number,
  streamKeys: string[],
): CapacityTrendSample[] {
  return samples.map((sample) => {
    const headwayByStream: Record<string, number> = {};
    for (const key of streamKeys) {
      const streamPphpd = sample.pphpdByStream[key];
      if (streamPphpd == null || streamPphpd <= 0) continue;
      const headway = computeHeadwaySecondsFromPphpd(vehicleCapacity, streamPphpd);
      if (headway != null) headwayByStream[key] = headway;
    }
    return {
      ...sample,
      headwaySeconds: computeHeadwaySecondsFromPphpd(vehicleCapacity, sample.pphpd),
      headwayByStream,
    };
  });
}

/**
 * 對分桶後運能做鄰近移動平均，並用同一套結果反推等效班距。
 */
export function smoothCapacityTrendSamples(
  samples: CapacityTrendSample[],
  vehicleCapacity: number,
  streamKeys: string[],
  halfWidth: number = CAPACITY_TREND_SMOOTH_HALF_WIDTH,
): CapacityTrendSample[] {
  if (samples.length === 0 || halfWidth <= 0) {
    return syncHeadwaysWithPphpd(samples, vehicleCapacity, streamKeys);
  }

  const smoothed = samples.map((sample, index) => {
    if (sample.activeStreamCount === 0 && sample.pphpd === 0) return sample;

    let pphpdSum = 0;
    let pphpdCount = 0;
    const streamPphpdSum: Record<string, number> = {};
    const streamPphpdCount: Record<string, number> = {};

    for (
      let i = Math.max(0, index - halfWidth);
      i <= Math.min(samples.length - 1, index + halfWidth);
      i += 1
    ) {
      const neighbor = samples[i]!;
      if (neighbor.activeStreamCount === 0 && neighbor.pphpd === 0) continue;
      pphpdSum += neighbor.pphpd;
      pphpdCount += 1;
      for (const key of streamKeys) {
        const streamPphpd = neighbor.pphpdByStream[key];
        if (streamPphpd == null) continue;
        streamPphpdSum[key] = (streamPphpdSum[key] ?? 0) + streamPphpd;
        streamPphpdCount[key] = (streamPphpdCount[key] ?? 0) + 1;
      }
    }
    if (pphpdCount === 0) return sample;

    const pphpdByStream: Record<string, number> = {};
    for (const key of streamKeys) {
      const count = streamPphpdCount[key] ?? 0;
      if (count > 0) {
        pphpdByStream[key] = Math.round((streamPphpdSum[key] ?? 0) / count);
      }
    }

    return {
      ...sample,
      pphpd: Math.round(pphpdSum / pphpdCount),
      pphpdByStream,
      activeStreamCount: Object.keys(pphpdByStream).length,
    };
  });

  return syncHeadwaysWithPphpd(smoothed, vehicleCapacity, streamKeys);
}

/**
 * 依第五步最終班表計算運能趨勢。
 *
 * pphpd 定義：vehicleCapacity × (3600 / 平均班距)
 * 平均班距取「過去 CAPACITY_ROLLING_WINDOW_MINUTES 分鐘」同向班次數推得
 * （= 視窗內班次數換算的每小時運能），再經分桶＋鄰近平滑顯示。
 *
 * 方向流：
 * - serviceDirection（預設）：同服務方向標籤＝同向**班次**；
 *   同一時間線上連續同向路段只算一趟。未設標籤的路線各自獨立。
 * - route：每條 routeId 各自計算（診斷用）。
 *
 * 發車時刻取 plannedStartMinute（與班表卡片一致）。
 */
export function buildCapacityTrendFromPlan(args: {
  plan: GeneratedSchedulePlan | null | undefined;
  vehicleCapacity: number;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  /** 服務方向標籤（顯示名稱）；缺省則用 id */
  serviceDirectionTags?: ShiftScheduleServiceDirectionTag[];
  /**
   * serviceDirection＝同向班次班距（分桶均化）；
   * route＝各路線分開。
   * 相容舊呼叫：`group` 視為 `serviceDirection`。
   */
  viewMode?: CapacityTrendViewMode | 'group';
  /** 取樣間隔（分鐘），預設 1 */
  sampleStepMinutes?: number;
}): CapacityTrendSeries {
  const vehicleCapacity = Math.max(1, Math.round(args.vehicleCapacity || 0));
  const step = Math.max(1, args.sampleStepMinutes ?? 1);
  const selectedRoutes = args.selectedRoutes ?? [];
  const serviceDirectionTags = recoverServiceDirectionTagsFromRoutes(
    args.serviceDirectionTags ?? [],
    selectedRoutes,
  );
  const rawMode = args.viewMode ?? 'serviceDirection';
  const viewMode: CapacityTrendViewMode =
    rawMode === 'group' ? 'serviceDirection' : rawMode;
  const passengerBlockCount = countPassengerTemplateBars(args.plan);
  const routeById = new Map(selectedRoutes.map((route) => [route.routeId, route] as const));

  // serviceDirection：同向連續路段併成一趟班次；route：各路線分開
  const collected =
    viewMode === 'serviceDirection'
      ? collectDeparturesByServiceDirection(args.plan, routeById)
      : collectDeparturesByRoute(args.plan);
  const streamKeys = orderStreamKeys(
    [...collected.byStream.keys()],
    viewMode,
    selectedRoutes,
  );

  const departuresByStream = new Map<string, DepartureEvent[]>();
  const leadSecondsByStream = new Map<string, number[]>();
  for (const streamKey of streamKeys) {
    const list = [...(collected.byStream.get(streamKey) ?? [])];
    list.sort((a, b) => a.startSecond - b.startSecond);
    departuresByStream.set(streamKey, list);
    // 服務方向班次已去重連續路段，不再做偽影連發過濾；route 仍過濾
    leadSecondsByStream.set(
      streamKey,
      uniqueDepartureLeadSeconds(list, viewMode === 'route'),
    );
  }

  let departureCount = 0;
  for (const streamKey of streamKeys) {
    departureCount += (departuresByStream.get(streamKey) ?? []).length;
  }

  const streams: CapacityRouteStream[] = streamKeys.map((streamKey, index) => {
    const departures = departuresByStream.get(streamKey) ?? [];
    const sampleBlock = collected.sampleBlockByStream.get(streamKey);
    const meta = resolveStreamMeta(
      streamKey,
      viewMode,
      sampleBlock,
      selectedRoutes,
      serviceDirectionTags,
    );
    return {
      streamKey,
      ...meta,
      color: STREAM_COLORS[index % STREAM_COLORS.length]!,
      departureCount: departures.length,
    };
  });

  const windowSeconds = CAPACITY_ROLLING_WINDOW_MINUTES * 60;

  const resolveAt = (minute: number): CapacityTrendSample => {
    const sampleSecond = minuteToSecond(minute);
    const pphpdByStream: Record<string, number> = {};
    const headwayByStream: Record<string, number> = {};

    for (const streamKey of streamKeys) {
      const rolling = resolveRollingWindowCapacity({
        leadSeconds: leadSecondsByStream.get(streamKey) ?? [],
        sampleSecond,
        vehicleCapacity,
        windowSeconds,
      });
      if (!rolling) continue;
      pphpdByStream[streamKey] = rolling.pphpd;
      headwayByStream[streamKey] = rolling.headwaySeconds;
    }

    const activeStreamCount = Object.keys(pphpdByStream).length;
    const pphpd = averageRecordValues(pphpdByStream) ?? 0;
    const headwaySeconds = averageRecordValues(headwayByStream);

    return {
      minute,
      pphpd,
      activeVehicleCount: countActiveVehiclesAt(args.plan, minute),
      headwaySeconds,
      activeStreamCount,
      pphpdByStream,
      headwayByStream,
    };
  };

  const rawSamples: CapacityTrendSample[] = [];
  for (let minute = 0; minute <= CAPACITY_DAY_MINUTES; minute += step) {
    rawSamples.push(resolveAt(minute));
  }
  if (rawSamples[rawSamples.length - 1]?.minute !== CAPACITY_DAY_MINUTES) {
    rawSamples.push(resolveAt(CAPACITY_DAY_MINUTES));
  }

  const samples = smoothCapacityTrendSamples(
    bucketCapacitySamples(rawSamples, CAPACITY_TREND_BUCKET_MINUTES, streamKeys),
    vehicleCapacity,
    streamKeys,
  );

  const maxPphpd = samples.reduce((max, sample) => {
    let sampleMax = 0;
    for (const value of Object.values(sample.pphpdByStream)) {
      sampleMax = Math.max(sampleMax, value);
    }
    if (sampleMax <= 0 && sample.pphpd > 0) sampleMax = sample.pphpd;
    if (
      sample.headwaySeconds != null
      && sample.headwaySeconds < MIN_CAPACITY_HEADWAY_SECONDS
    ) {
      return max;
    }
    return Math.max(max, sampleMax);
  }, 0);

  return {
    vehicleCapacity,
    samples,
    streams,
    maxPphpd,
    departureCount,
    passengerBlockCount,
  };
}

export type CapacityPeriodBand = {
  attributeId: string;
  name: string;
  color: string;
  startMinute: number;
  endMinute: number;
  headwaySeconds: number | null;
  capacityPphpd: number;
};

export function buildCapacityPeriodBands(
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): CapacityPeriodBand[] {
  const attrById = new Map(attributes.map((attr) => [attr.id, attr] as const));
  const bands: CapacityPeriodBand[] = [];

  for (const interval of intervals) {
    if (interval.isDraft) continue;
    const attr = attrById.get(interval.attributeId);
    if (!attr || attr.isDraft) continue;
    // 跨午夜的時段在鐘面上是兩段色帶：日尾一條、日頭一條
    for (const range of resolveIntervalMinuteRanges(interval.startTime, interval.endTime)) {
      bands.push({
        attributeId: attr.id,
        name: attr.name,
        color: attr.color,
        startMinute: range.start,
        endMinute: range.end,
        headwaySeconds: attr.headwaySeconds,
        capacityPphpd: attr.capacityPphpd,
      });
    }
  }

  return bands.sort((a, b) => a.startMinute - b.startMinute);
}

export function resolveCapacityPeriodAtMinute(
  bands: CapacityPeriodBand[],
  minute: number,
): CapacityPeriodBand | null {
  const clamped = ((minute % CAPACITY_DAY_MINUTES) + CAPACITY_DAY_MINUTES) % CAPACITY_DAY_MINUTES;
  for (const band of bands) {
    if (clamped >= band.startMinute && clamped < band.endMinute) return band;
  }
  return null;
}

/** Y 軸上限：至少蓋住模板目標與合理實際值；忽略病理尖峰以免軸被撐爆 */
export function resolveCapacityAxisMax(
  actualMaxPphpd: number,
  attributes: TimeSlotAttribute[],
): number {
  const targetMax = attributes.reduce(
    (max, attr) => Math.max(max, attr.isDraft ? 0 : attr.capacityPphpd),
    0,
  );
  const reasonableActual =
    targetMax > 0
      ? Math.min(actualMaxPphpd, Math.max(targetMax * 1.5, targetMax + 400))
      : actualMaxPphpd;
  const raw = Math.max(reasonableActual, targetMax, 200);
  return Math.ceil(raw / 200) * 200;
}

export function formatMinuteAsHm(minute: number): string {
  const total = Math.max(0, Math.min(CAPACITY_DAY_MINUTES, Math.round(minute)));
  if (total >= CAPACITY_DAY_MINUTES) return '24:00';
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatRouteStreamHeadwayTooltip(
  headwayByStream: Record<string, number>,
  streams: CapacityRouteStream[],
): string | null {
  const labelByKey = new Map(streams.map((stream) => [stream.streamKey, stream.label]));
  const parts = Object.entries(headwayByStream).map(([key, headway]) => {
    const label = labelByKey.get(key) ?? key;
    return `${label} ${headway.toLocaleString('en-US')} 秒`;
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** @deprecated 改用 formatRouteStreamHeadwayTooltip */
export function formatDirectionalHeadwayTooltip(
  headwayByDirection: Partial<Record<ServiceDirection, number>>,
): string | null {
  const parts = (['up', 'down'] as const).flatMap((direction) => {
    const headway = headwayByDirection[direction];
    if (headway == null) return [];
    return [`${direction === 'up' ? '上行' : '下行'} ${headway.toLocaleString('en-US')} 秒`];
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** 實際運能相對時段目標偏低時的簡短修正提示 */
export function formatCapacityGapHint(args: {
  actualPphpd: number;
  targetPphpd: number | null | undefined;
  actualHeadwaySeconds: number | null | undefined;
  targetHeadwaySeconds: number | null | undefined;
}): string | null {
  const target = args.targetPphpd;
  if (target == null || target <= 0 || args.actualPphpd <= 0) return null;
  if (args.actualPphpd >= target * 0.98) return null;

  const actualHw = args.actualHeadwaySeconds;
  const targetHw = args.targetHeadwaySeconds;
  if (actualHw != null && targetHw != null && actualHw > targetHw) {
    return `低於目標：等效班距 ${actualHw} 秒（目標 ${targetHw} 秒）。可增加時間線、減少整備佔用，或放寬該時段目標班距後重新生成。`;
  }
  return '低於目標：此區間實際發車偏疏。可增加時間線、減少整備佔用，或調整該時段班距後重新生成。';
}
