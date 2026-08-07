/**
 * 調度班次前綴標記（Yard Dispatch Tag）：
 *
 * 整備任務（保養 servicing / 行前 inspection / 充電 charging / 機動 standby）之後
 * 的第一個正線班次，一律掛上「整備代號 + 路線代號」：
 *
 *   yardDispatchPrefix = 整備代號 + 路線代號（如「P」+「TN」→「PTN」、「M」+「TN」→「MTN」）
 *
 * 原因：這班是從整備設施出發的調度，不是該地點／交路的一般首班運營。
 * 即使出場站剛好等於下一班路線首站（例如保養／行前都在 T3、下一班走 TN），仍要掛代號。
 *
 * 班次代號顯示：`{yardDispatchPrefix}{HHMM}`。
 *
 * 相接整備串（充電→保養→行前）時，以**串尾那個整備**的代號為準
 * （同一正線可能被多次 set，後寫覆蓋前寫）。
 *
 * 禁止：同列整備「前面」已是正線（整備被 defer／擠進正線區段中）時，
 * 不得把後面的正線標成調度（例如 TS→ST 之後再冒出 MTN）。
 */

import type { TaskTypeKey } from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import type { MaintenanceSectionCodeBySection } from '../maintenanceSectionCode';
import { resolveMaintenanceSectionCodeForTaskType } from '../maintenanceSectionCode';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import type {
  GeneratedScheduleTimeline,
  GeneratedScheduleBlock,
} from './types';

/** 整備後首班一律可掛代號（含保養） */
const DISPATCH_TAG_TASK_TYPES = new Set<TaskTypeKey>([
  'inspection',
  'charging',
  'standby',
  'servicing',
]);

function isPassengerOccupier(block: GeneratedScheduleBlock): boolean {
  if (block.taskType !== 'passenger') return false;
  return block.source === 'template_bar' || block.source === 'entry_service';
}

/** 整備緊鄰前一格已是正線 → 正線中段，不准再標記調度 */
export function isYardPrecededByMainlinePassenger(
  sorted: GeneratedScheduleBlock[],
  yardIndex: number,
): boolean {
  for (let j = yardIndex - 1; j >= 0; j -= 1) {
    const block = sorted[j]!;
    if (block.source === 'transition' || block.taskType === 'idle') continue;
    return isPassengerOccupier(block);
  }
  return false;
}

function findFirstPassengerAfterYard(
  sorted: GeneratedScheduleBlock[],
  yardIndex: number,
): GeneratedScheduleBlock | null {
  for (let j = yardIndex + 1; j < sorted.length; j += 1) {
    const block = sorted[j]!;
    if (block.source === 'entry_service' || block.source === 'transition') continue;
    if (block.taskType === 'idle') continue;
    if (block.taskType === 'passenger' && block.source === 'template_bar') {
      return block;
    }
    if (block.source === 'template_bar') return null;
  }
  return null;
}

export function resolveYardDispatchPrefixForBlock(args: {
  yardBlock: GeneratedScheduleBlock;
  passengerBlock: GeneratedScheduleBlock;
  /** @deprecated 不再依出場站決定是否掛代號；保留參數以相容呼叫端 */
  origins?: MaintenanceFirstTripOrigin[];
  /** @deprecated 同上 */
  maintenanceBody?: Record<string, unknown> | null | undefined;
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
}): string | null {
  const { yardBlock, passengerBlock, sectionCodes } = args;
  const taskType = yardBlock.taskType as TaskTypeKey;

  if (!DISPATCH_TAG_TASK_TYPES.has(taskType)) return null;

  const sectionCode = resolveMaintenanceSectionCodeForTaskType(
    taskType,
    sectionCodes,
  );
  if (!sectionCode) return null;

  const routeCode = passengerBlock.routeCode?.trim();
  if (!routeCode) return null;

  return `${sectionCode}${routeCode}`;
}

export function tagYardDispatchTrips(args: {
  timelines: GeneratedScheduleTimeline[];
  origins?: MaintenanceFirstTripOrigin[];
  maintenanceBody?: Record<string, unknown> | null | undefined;
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
}): GeneratedScheduleTimeline[] {
  const {
    timelines,
    origins = [],
    maintenanceBody = null,
    sectionCodes,
    selectedRoutes = [],
  } = args;

  return timelines.map((timeline) => {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );

    const prefixById = new Map<string, string>();

    for (let i = 0; i < sorted.length; i += 1) {
      const yardBlock = sorted[i]!;
      if (yardBlock.source !== 'template_bar') continue;
      if (!DISPATCH_TAG_TASK_TYPES.has(yardBlock.taskType as TaskTypeKey)) {
        continue;
      }
      if (isYardPrecededByMainlinePassenger(sorted, i)) continue;

      const passengerBlock = findFirstPassengerAfterYard(sorted, i);
      if (!passengerBlock) continue;

      const prefix = resolveYardDispatchPrefixForBlock({
        yardBlock,
        passengerBlock,
        origins,
        maintenanceBody,
        sectionCodes,
        selectedRoutes,
      });
      if (prefix) {
        prefixById.set(passengerBlock.id, prefix);
      }
    }

    if (prefixById.size === 0) return timeline;

    return {
      ...timeline,
      blocks: timeline.blocks.map((block) => {
        const prefix = prefixById.get(block.id);
        if (!prefix) {
          // 重新標記時清掉舊前綴，避免後處理後殘留錯誤代號
          if (block.yardDispatchPrefix) {
            const { yardDispatchPrefix: _drop, ...rest } = block;
            return rest;
          }
          return block;
        }
        return { ...block, yardDispatchPrefix: prefix };
      }),
    };
  });
}

/**
 * 兜底：正線班次之後不得再保留進場載客標記或調度前綴。
 * entry_service → template_bar；清掉 yardDispatchPrefix。
 */
export function scrubMidMainlineDispatchArtifacts(
  timelines: GeneratedScheduleTimeline[],
): GeneratedScheduleTimeline[] {
  return timelines.map((timeline) => {
    const sorted = [...timeline.blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || a.id.localeCompare(b.id),
    );
    const demoteIds = new Set<string>();
    const clearPrefixIds = new Set<string>();

    for (let i = 0; i < sorted.length; i += 1) {
      const block = sorted[i]!;
      let prev: GeneratedScheduleBlock | null = null;
      for (let j = i - 1; j >= 0; j -= 1) {
        const candidate = sorted[j]!;
        if (candidate.source === 'transition' || candidate.taskType === 'idle') {
          continue;
        }
        prev = candidate;
        break;
      }
      if (!prev || !isPassengerOccupier(prev)) continue;

      if (block.source === 'entry_service') {
        demoteIds.add(block.id);
      }
      if (block.yardDispatchPrefix) {
        clearPrefixIds.add(block.id);
      }
    }

    if (demoteIds.size === 0 && clearPrefixIds.size === 0) return timeline;

    return {
      ...timeline,
      blocks: timeline.blocks.map((block) => {
        let next = block;
        if (demoteIds.has(block.id) && block.source === 'entry_service') {
          const { entryServiceSectionCode: _drop, ...rest } = next;
          next = { ...rest, source: 'template_bar' };
        }
        if (clearPrefixIds.has(next.id) && next.yardDispatchPrefix) {
          const { yardDispatchPrefix: _p, ...rest } = next;
          next = rest;
        }
        return next;
      }),
    };
  });
}
