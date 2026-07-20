import {
  computeCapacityPphpd,
  computeHeadwaySecondsFromPphpd,
  parseIntervalEndMinutes,
  parseIntervalStartMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { sortSelectedRoutesByExecutionOrder } from '../types/create';
import type { GeneratedScheduleBlock, GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';

export const CAPACITY_DAY_MINUTES = 24 * 60;

export type ServiceDirection = 'up' | 'down';

export type CapacityTrendSample = {
  /** 自 00:00 起算的分鐘 */
  minute: number;
  /**
   * 該分鐘的供給運能（pphpd）。
   * 上行／下行分別依班距換算後取平均（與模板單向目標 band 對照）。
   */
  pphpd: number;
  /** 該分鐘仍在執行正線的車輛數（輔助資訊） */
  activeVehicleCount: number;
  /**
   * 與 pphpd 對齊的等效班距（秒）＝ vehicleCapacity × 3600 / pphpd。
   * 分桶／平滑後不再顯示瞬时班距，避免與運能數字矛盾。
   */
  headwaySeconds: number | null;
  /** 該分鐘有有效班距的方向數 */
  activeDirectionCount: number;
  /** 各方向 pphpd（供 tooltip 細節） */
  pphpdByDirection: Partial<Record<ServiceDirection, number>>;
  /** 各方向等效班距秒（由該向 pphpd 反推，與運能一致） */
  headwayByDirection: Partial<Record<ServiceDirection, number>>;
};

export type CapacityTrendSeries = {
  vehicleCapacity: number;
  samples: CapacityTrendSample[];
  maxPphpd: number;
  /** 正線發車趟次數（template_bar passenger） */
  departureCount: number;
};

type DepartureEvent = {
  startSecond: number;
};

type HeadwaySegment = {
  startSecond: number;
  endSecond: number;
  headwaySeconds: number;
};

const SERVICE_DIRECTIONS: ServiceDirection[] = ['up', 'down'];

function resolveDirectionFromRoute(route: ShiftScheduleSelectedRoute): ServiceDirection | null {
  const code = route.routeCode?.trim().toUpperCase();
  if (code === 'U' || code === 'UP') return 'up';
  if (code === 'D' || code === 'DOWN') return 'down';
  if (route.routeName.includes('上行')) return 'up';
  if (route.routeName.includes('下行')) return 'down';
  return null;
}

function resolveDirectionFromBlock(block: GeneratedScheduleBlock): ServiceDirection | null {
  const code = block.routeCode?.trim().toUpperCase();
  if (code === 'U' || code === 'UP') return 'up';
  if (code === 'D' || code === 'DOWN') return 'down';

  const name = block.routeName ?? '';
  if (name.includes('上行')) return 'up';
  if (name.includes('下行')) return 'down';
  return null;
}

/**
 * 由路線群組建立 routeId → 方向對照。
 * 產品慣例：執行順序第 1 條為下行、第 2 條為上行（下行→上行輪替）。
 */
export function buildDirectionByRouteId(
  selectedRoutes: ShiftScheduleSelectedRoute[],
): Map<string, ServiceDirection> {
  const map = new Map<string, ServiceDirection>();
  const sorted = sortSelectedRoutesByExecutionOrder(selectedRoutes);

  for (const [index, route] of sorted.entries()) {
    const explicit = resolveDirectionFromRoute(route);
    if (explicit) {
      map.set(route.routeId, explicit);
      continue;
    }
    if (sorted.length === 2) {
      map.set(route.routeId, index === 0 ? 'down' : 'up');
    }
  }

  return map;
}

/**
 * 服務方向鍵：僅回傳 up / down；無法判定時回傳 null（不納入錯誤的 timeline 分流）。
 */
export function resolveDepartureStreamKey(
  block: GeneratedScheduleBlock,
  directionByRouteId?: Map<string, ServiceDirection>,
): ServiceDirection | null {
  const fromBlock = resolveDirectionFromBlock(block);
  if (fromBlock) return fromBlock;

  if (block.routeId && directionByRouteId?.has(block.routeId)) {
    return directionByRouteId.get(block.routeId) ?? null;
  }

  return null;
}

function collectDeparturesByDirection(
  plan: GeneratedSchedulePlan | null | undefined,
  directionByRouteId?: Map<string, ServiceDirection>,
): Map<ServiceDirection, DepartureEvent[]> {
  const byDirection = new Map<ServiceDirection, DepartureEvent[]>([
    ['up', []],
    ['down', []],
  ]);

  for (const timeline of plan?.timelines ?? []) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger' || block.source !== 'template_bar') continue;
      const direction = resolveDepartureStreamKey(block, directionByRouteId);
      if (!direction) continue;

      const list = byDirection.get(direction)!;
      list.push({ startSecond: minuteToSecond(block.plannedStartMinute) });
    }
  }

  for (const list of byDirection.values()) {
    list.sort((a, b) => a.startSecond - b.startSecond);
  }

  return byDirection;
}

/**
 * 運能換算用的最短有效班距（秒）。
 * 低於此值的同方向連發視為「同班次／補完偽影」而非服務班距
 * （例如日界回程補完造成 10 秒連發 → pphpd 虛增至數萬）。
 */
export const MIN_CAPACITY_HEADWAY_SECONDS = 60;

/**
 * 趨勢線分桶（分鐘）。
 * 尖峰軟延後班距常在目標上下交替（例如 180／220），每分鐘階梯會畫成梳子；
 * 分桶取時長加權平均後再做鄰近平滑。
 */
export const CAPACITY_TREND_BUCKET_MINUTES = 10;

/** 分桶後對 pphpd 做鄰近移動平均的半寬（點數）；1 → 三點平滑 */
export const CAPACITY_TREND_SMOOTH_HALF_WIDTH = 1;

/**
 * 將每分鐘樣本收成固定分鐘桶的時長加權平均，供趨勢線使用。
 * 總量與方向細項用同一套平均，避免 tooltip「班距 180／運能却是 1155」。
 */
export function bucketCapacitySamples(
  samples: CapacityTrendSample[],
  bucketMinutes: number,
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
    const dirPphpdSum: Partial<Record<ServiceDirection, number>> = {};
    const dirPphpdCount: Partial<Record<ServiceDirection, number>> = {};
    const dirHeadwaySum: Partial<Record<ServiceDirection, number>> = {};
    const dirHeadwayCount: Partial<Record<ServiceDirection, number>> = {};

    for (const item of group) {
      if (item.activeDirectionCount > 0) {
        pphpdSum += item.pphpd;
        pphpdCount += 1;
      }
      vehicleSum += item.activeVehicleCount;
      for (const direction of SERVICE_DIRECTIONS) {
        const dirPphpd = item.pphpdByDirection[direction];
        if (dirPphpd != null) {
          dirPphpdSum[direction] = (dirPphpdSum[direction] ?? 0) + dirPphpd;
          dirPphpdCount[direction] = (dirPphpdCount[direction] ?? 0) + 1;
        }
        const dirHeadway = item.headwayByDirection[direction];
        if (dirHeadway != null) {
          dirHeadwaySum[direction] = (dirHeadwaySum[direction] ?? 0) + dirHeadway;
          dirHeadwayCount[direction] = (dirHeadwayCount[direction] ?? 0) + 1;
        }
      }
    }

    const pphpdByDirection: Partial<Record<ServiceDirection, number>> = {};
    const headwayByDirection: Partial<Record<ServiceDirection, number>> = {};
    for (const direction of SERVICE_DIRECTIONS) {
      const pCount = dirPphpdCount[direction] ?? 0;
      if (pCount > 0) {
        pphpdByDirection[direction] = Math.round((dirPphpdSum[direction] ?? 0) / pCount);
      }
      const hCount = dirHeadwayCount[direction] ?? 0;
      if (hCount > 0) {
        headwayByDirection[direction] = Math.round((dirHeadwaySum[direction] ?? 0) / hCount);
      }
    }

    const directionalHeadways = SERVICE_DIRECTIONS.flatMap((direction) => {
      const headway = headwayByDirection[direction];
      return headway == null ? [] : [headway];
    });
    const activeDirectionCount = Object.keys(pphpdByDirection).length;

    out.push({
      minute: bucketStart,
      pphpd: pphpdCount === 0 ? 0 : Math.round(pphpdSum / pphpdCount),
      headwaySeconds:
        directionalHeadways.length === 0
          ? null
          : Math.round(
              directionalHeadways.reduce((sum, value) => sum + value, 0)
                / directionalHeadways.length,
            ),
      activeVehicleCount: Math.round(vehicleSum / group.length),
      activeDirectionCount,
      pphpdByDirection,
      headwayByDirection,
    });
  }

  // 確保 24:00 端點存在，便於畫滿全日
  const last = out[out.length - 1];
  if (last && last.minute !== CAPACITY_DAY_MINUTES) {
    const endSample = byMinute.get(CAPACITY_DAY_MINUTES) ?? last;
    out.push({ ...endSample, minute: CAPACITY_DAY_MINUTES });
  }

  return out;
}

/**
 * 對分桶後運能做鄰近移動平均，並用同一套結果反推等效班距。
 * 保證 tooltip 的班距與 pphpd 永遠可用同一公式對得起來。
 */
export function smoothCapacityTrendSamples(
  samples: CapacityTrendSample[],
  vehicleCapacity: number,
  halfWidth: number = CAPACITY_TREND_SMOOTH_HALF_WIDTH,
): CapacityTrendSample[] {
  if (samples.length === 0 || halfWidth <= 0) {
    return syncHeadwaysWithPphpd(samples, vehicleCapacity);
  }

  const smoothed = samples.map((sample, index) => {
    if (sample.activeDirectionCount === 0 && sample.pphpd === 0) return sample;

    let pphpdSum = 0;
    let pphpdCount = 0;
    const dirPphpdSum: Partial<Record<ServiceDirection, number>> = {};
    const dirPphpdCount: Partial<Record<ServiceDirection, number>> = {};

    for (
      let i = Math.max(0, index - halfWidth);
      i <= Math.min(samples.length - 1, index + halfWidth);
      i += 1
    ) {
      const neighbor = samples[i]!;
      if (neighbor.activeDirectionCount === 0 && neighbor.pphpd === 0) continue;
      pphpdSum += neighbor.pphpd;
      pphpdCount += 1;
      for (const direction of SERVICE_DIRECTIONS) {
        const dirPphpd = neighbor.pphpdByDirection[direction];
        if (dirPphpd == null) continue;
        dirPphpdSum[direction] = (dirPphpdSum[direction] ?? 0) + dirPphpd;
        dirPphpdCount[direction] = (dirPphpdCount[direction] ?? 0) + 1;
      }
    }
    if (pphpdCount === 0) return sample;

    const pphpdByDirection: Partial<Record<ServiceDirection, number>> = {};
    for (const direction of SERVICE_DIRECTIONS) {
      const count = dirPphpdCount[direction] ?? 0;
      if (count > 0) {
        pphpdByDirection[direction] = Math.round((dirPphpdSum[direction] ?? 0) / count);
      }
    }

    return {
      ...sample,
      pphpd: Math.round(pphpdSum / pphpdCount),
      pphpdByDirection,
      activeDirectionCount: Object.keys(pphpdByDirection).length,
    };
  });

  return syncHeadwaysWithPphpd(smoothed, vehicleCapacity);
}

/** 以顯示中的 pphpd 反推等效班距，確保與運能數字一致 */
export function syncHeadwaysWithPphpd(
  samples: CapacityTrendSample[],
  vehicleCapacity: number,
): CapacityTrendSample[] {
  return samples.map((sample) => {
    const headwayByDirection: Partial<Record<ServiceDirection, number>> = {};
    for (const direction of SERVICE_DIRECTIONS) {
      const dirPphpd = sample.pphpdByDirection[direction];
      if (dirPphpd == null || dirPphpd <= 0) continue;
      const headway = computeHeadwaySecondsFromPphpd(vehicleCapacity, dirPphpd);
      if (headway != null) headwayByDirection[direction] = headway;
    }
    const headwaySeconds = computeHeadwaySecondsFromPphpd(vehicleCapacity, sample.pphpd);
    return {
      ...sample,
      headwaySeconds,
      headwayByDirection,
    };
  });
}

/**
 * 同一方向內，跨所有時間線的相鄰實際發車間隔定義班距區段 [d_i, d_{i+1})。
 * 間隔過短的連發會被收斂為同一班「波次」，不產生虛高運能。
 */
function buildHeadwaySegments(departures: DepartureEvent[]): HeadwaySegment[] {
  const uniqueSeconds = [...new Set(departures.map((event) => event.startSecond))].sort(
    (a, b) => a - b,
  );

  // 波次收斂：過近的同方向發車只保留第一班，避免日界補完等偽影
  const platoonLeadSeconds: number[] = [];
  for (const second of uniqueSeconds) {
    const previous = platoonLeadSeconds[platoonLeadSeconds.length - 1];
    if (previous == null || second - previous >= MIN_CAPACITY_HEADWAY_SECONDS) {
      platoonLeadSeconds.push(second);
    }
  }

  const segments: HeadwaySegment[] = [];
  for (let i = 0; i < platoonLeadSeconds.length - 1; i += 1) {
    const startSecond = platoonLeadSeconds[i]!;
    const endSecond = platoonLeadSeconds[i + 1]!;
    const gapSeconds = endSecond - startSecond;
    if (gapSeconds < MIN_CAPACITY_HEADWAY_SECONDS) continue;
    segments.push({
      startSecond,
      endSecond,
      headwaySeconds: gapSeconds,
    });
  }
  return segments;
}

function findSegmentAt(
  segments: HeadwaySegment[],
  sampleSecond: number,
): HeadwaySegment | null {
  for (const segment of segments) {
    if (sampleSecond >= segment.startSecond && sampleSecond < segment.endSecond) {
      return segment;
    }
  }
  return null;
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

/**
 * 依第五步最終班表計算運能趨勢。
 *
 * 學術定義（TCQSM / per-direction offered capacity）：
 *   pphpd_dir = vehicleCapacity × (3600 / headwaySeconds_dir)
 *   headwaySeconds_dir = 同一方向、跨所有時間線的相鄰實際發車間隔
 *
 * 發車時刻取 plannedStartMinute（與班表卡片一致）。
 */
export function buildCapacityTrendFromPlan(args: {
  plan: GeneratedSchedulePlan | null | undefined;
  vehicleCapacity: number;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  /** 取樣間隔（分鐘），預設 1 */
  sampleStepMinutes?: number;
}): CapacityTrendSeries {
  const vehicleCapacity = Math.max(1, Math.round(args.vehicleCapacity || 0));
  const step = Math.max(1, args.sampleStepMinutes ?? 1);
  const directionByRouteId = args.selectedRoutes?.length
    ? buildDirectionByRouteId(args.selectedRoutes)
    : undefined;
  const departuresByDirection = collectDeparturesByDirection(args.plan, directionByRouteId);
  const segmentsByDirection = new Map<ServiceDirection, HeadwaySegment[]>();

  let departureCount = 0;
  for (const direction of SERVICE_DIRECTIONS) {
    const departures = departuresByDirection.get(direction) ?? [];
    departureCount += departures.length;
    segmentsByDirection.set(direction, buildHeadwaySegments(departures));
  }

  const resolveAt = (minute: number): CapacityTrendSample => {
    const sampleSecond = minuteToSecond(minute);
    const pphpdByDirection: Partial<Record<ServiceDirection, number>> = {};
    const headwayByDirection: Partial<Record<ServiceDirection, number>> = {};
    const directionalPphpd: number[] = [];
    const directionalHeadways: number[] = [];

    for (const direction of SERVICE_DIRECTIONS) {
      const segments = segmentsByDirection.get(direction) ?? [];
      const segment = findSegmentAt(segments, sampleSecond);
      if (!segment) continue;

      const pphpd = computeCapacityPphpd(vehicleCapacity, segment.headwaySeconds);
      pphpdByDirection[direction] = pphpd;
      headwayByDirection[direction] = segment.headwaySeconds;
      directionalPphpd.push(pphpd);
      directionalHeadways.push(segment.headwaySeconds);
    }

    const activeDirectionCount = directionalPphpd.length;
    const pphpd =
      activeDirectionCount === 0
        ? 0
        : Math.round(
            directionalPphpd.reduce((sum, value) => sum + value, 0)
              / activeDirectionCount,
          );
    const headwaySeconds =
      activeDirectionCount === 0
        ? null
        : Math.round(
            directionalHeadways.reduce((sum, value) => sum + value, 0)
              / activeDirectionCount,
          );

    return {
      minute,
      pphpd,
      activeVehicleCount: countActiveVehiclesAt(args.plan, minute),
      headwaySeconds,
      activeDirectionCount,
      pphpdByDirection,
      headwayByDirection,
    };
  };

  const rawSamples: CapacityTrendSample[] = [];
  for (let minute = 0; minute <= CAPACITY_DAY_MINUTES; minute += step) {
    rawSamples.push(resolveAt(minute));
  }
  if (rawSamples[rawSamples.length - 1]?.minute !== CAPACITY_DAY_MINUTES) {
    rawSamples.push(resolveAt(CAPACITY_DAY_MINUTES));
  }

  // 趨勢線分桶 + 鄰近平滑，並反推等效班距，讓 tooltip 數字自洽。
  const samples = smoothCapacityTrendSamples(
    bucketCapacitySamples(rawSamples, CAPACITY_TREND_BUCKET_MINUTES),
    vehicleCapacity,
  );

  const maxPphpd = samples.reduce((max, sample) => {
    // 班距低於有效下限的樣本不參與 max（與軸高一致，避免圖例／摘要被污染）
    if (
      sample.headwaySeconds != null
      && sample.headwaySeconds < MIN_CAPACITY_HEADWAY_SECONDS
    ) {
      return max;
    }
    return Math.max(max, sample.pphpd);
  }, 0);

  return {
    vehicleCapacity,
    samples,
    maxPphpd,
    departureCount,
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
    const start = parseIntervalStartMinutes(interval.startTime);
    const end = parseIntervalEndMinutes(interval.endTime);
    if (start == null || end == null || end <= start) continue;
    const attr = attrById.get(interval.attributeId);
    if (!attr || attr.isDraft) continue;
    bands.push({
      attributeId: attr.id,
      name: attr.name,
      color: attr.color,
      startMinute: start,
      endMinute: end,
      headwaySeconds: attr.headwaySeconds,
      capacityPphpd: attr.capacityPphpd,
    });
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
  // 實際值若超過目標 1.5 倍（或目標+400），視為異常尖峰，不納入軸高
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

function formatDirectionLabel(direction: ServiceDirection): string {
  return direction === 'up' ? '上行' : '下行';
}

export function formatDirectionalHeadwayTooltip(
  headwayByDirection: Partial<Record<ServiceDirection, number>>,
): string | null {
  const parts = SERVICE_DIRECTIONS.flatMap((direction) => {
    const headway = headwayByDirection[direction];
    if (headway == null) return [];
    return [`${formatDirectionLabel(direction)} ${headway.toLocaleString('en-US')} 秒`];
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
