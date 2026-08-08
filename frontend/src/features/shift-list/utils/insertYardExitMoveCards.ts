import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type {
  MaintenanceFacilityExit,
  MaintenanceFirstTripOrigin,
} from './maintenanceFirstTripOrigins';
import {
  extractFacilityMapCodes,
  type MaintenanceBodySectionKey,
} from './maintenanceFirstTripOrigins';
import {
  resolveMaintenanceSectionCodeForTaskType,
  type MaintenanceSectionCodeBySection,
} from './maintenanceSectionCode';
import {
  minuteToSecond,
  secondToMinute,
  type GeneratedScheduleBlock,
  type GeneratedSchedulePlan,
} from './schedule-engine/types';

/**
 * 出場移動卡（班次代號 = 整備代號 + EX）
 * ======================================
 *
 * 整備做完之後，車還停在整備設施裡（例 M2 那一格），並不在正線的轉乘站上。
 * 這張卡就是把它從設施開到轉乘站的那一段，時長直接取路網拓樸上
 * 「設施 → 站」邊的空駛秒數，不需要另外規劃路徑。
 *
 * 三條規則決定它排在哪：
 *
 * 1. **往前貼、零秒緩衝。** 結束時刻貼齊後面那一段的發車時刻，由此往前推開始時刻。
 *    不是整備一做完就開出去——那樣會白白佔著轉乘站的站格；是要走之前才就位。
 * 2. **後面那一段時間不動。** 調度營運班次（外掛）或正線的時刻一律維持原樣，
 *    只在它前面塞這張卡。
 * 3. **空間不夠時可以吃整備尾巴。** 若整備結束到發車之間塞不下這段空駛
 *    （極端是整備做完零秒就要發車），這張卡把整備區塊的結束時刻往前縮。
 *    <strong>全系統只有這張卡有這個特權</strong>，前提就是空間真的不夠。
 *
 * 設施要標到<strong>具體哪一台</strong>（M1／M2…），因此用
 * `MaintenanceFirstTripOrigin.facilities` 逐台的空駛時間，不能用聚合的
 * `deadheadSeconds`（那是最壞值）。同一時刻不讓兩台車佔同一台設施。
 *
 * 入場方向（正線跑完開進設施）目前<strong>不做</strong>。
 */

/** 整備任務類型 → 整備中心設施區段鍵 */
const FACILITY_SECTION_BY_TASK_TYPE: Partial<
  Record<TaskTypeKey, MaintenanceBodySectionKey>
> = {
  charging: 'charging',
  inspection: 'preTrip',
  standby: 'mobile',
  servicing: 'maintenance',
  washing: 'carWash',
};

const YARD_TASK_TYPES = new Set<string>([
  'charging',
  'inspection',
  'standby',
  'servicing',
  'washing',
]);

/** 這一段是否需要車「人已經在轉乘站上」才能開始 */
function requiresVehicleAtStation(block: GeneratedScheduleBlock): boolean {
  return block.taskType === 'passenger';
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 設施節點 id／顯示名是否命中整備任務設定的 mapCode */
function facilityMatchesCodes(
  facility: MaintenanceFacilityExit,
  codes: string[],
): boolean {
  if (codes.length === 0) return false;
  const id = normalizeCode(facility.nodeId);
  const label = normalizeCode(facility.label);
  return codes.some((raw) => {
    const code = normalizeCode(raw);
    if (!code || code === 'UNSPECIFIED') return false;
    return code === id || code === label || label.startsWith(code) || id.endsWith(code);
  });
}

type FacilityBooking = {
  facilityNodeId: string;
  startSecond: number;
  endSecond: number;
  timelineRow: number;
};

/** 同一台設施在該時段是否已被別列車佔著 */
function facilityIsFree(
  bookings: FacilityBooking[],
  facilityNodeId: string,
  startSecond: number,
  endSecond: number,
  timelineRow: number,
): boolean {
  return !bookings.some(
    (b) =>
      b.facilityNodeId === facilityNodeId
      && b.timelineRow !== timelineRow
      && b.startSecond < endSecond - 1e-9
      && startSecond < b.endSecond - 1e-9,
  );
}

export type YardExitMoveCardsResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 實際插入的卡數 */
  inserted: number;
  /** 其中吃到整備尾巴的卡數 */
  ateYardTail: number;
  /** 找不到可用設施／拓樸邊而略過的整備段 */
  skipped: Array<{ timelineRow: number; taskType: string; reason: string }>;
};

export function insertYardExitMoveCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): YardExitMoveCardsResult {
  const { timelines, origins, maintenanceBody, selectedRoutes, sectionCodes } = args;
  const skipped: YardExitMoveCardsResult['skipped'] = [];
  let inserted = 0;
  let ateYardTail = 0;

  if (origins.length === 0) {
    return { timelines, inserted, ateYardTail, skipped };
  }

  const originByStation = new Map(origins.map((o) => [o.stationId, o] as const));
  const routeStartStation = new Map<string, string>();
  for (const route of selectedRoutes) {
    const start = route.stationIds?.[0]?.trim();
    if (route.routeId && start) routeStartStation.set(route.routeId, start);
  }
  const codesBySection = new Map<MaintenanceBodySectionKey, string[]>();
  const facilityCodesFor = (taskType: string): string[] => {
    const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as TaskTypeKey];
    if (!section) return [];
    const cached = codesBySection.get(section);
    if (cached) return cached;
    const codes = extractFacilityMapCodes(maintenanceBody, section);
    codesBySection.set(section, codes);
    return codes;
  };

  // 設施佔用跨列共用：同一台設施同一時刻只能停一台車
  const bookings: FacilityBooking[] = [];

  // 先依開始時刻掃描，讓早的整備先挑設施（晚的才需要讓）
  type Pending = {
    timeline: GeneratedSchedulePlan['timelines'][number];
    yard: GeneratedScheduleBlock;
    next: GeneratedScheduleBlock;
  };
  const pending: Pending[] = [];

  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;

      // 連續整備串只在串尾出場：車是從串尾那一段的設施開出來的
      const nextYardIndex = sorted.findIndex(
        (b, idx) => idx > i && YARD_TASK_TYPES.has(b.taskType),
      );
      const next = sorted
        .slice(i + 1)
        .find((b) => requiresVehicleAtStation(b));
      if (!next) continue;
      if (
        nextYardIndex >= 0
        && sorted[nextYardIndex]!.plannedStartMinute < next.plannedStartMinute
      ) {
        // 後面還有整備排在這一段載客之前 → 這一段不是串尾，交給串尾處理
        continue;
      }
      pending.push({ timeline, yard, next });
    }
  }

  pending.sort((a, b) => a.yard.plannedStartMinute - b.yard.plannedStartMinute);

  for (const { timeline, yard, next } of pending) {
    // 要的是「這一段自己從哪一站發車」＝路線起點站。
    // 不能用 firstTripOriginStationId——那個欄位在調度營運班次上存的是
    // 「要把車送到的首班起點站」（終點側），拿來當起點會查到完全另一站。
    const stationId = (next.routeId ? routeStartStation.get(next.routeId) : undefined)
      || resolveBlockOriginStationId(next)
      || next.firstTripOriginStationId?.trim();
    if (!stationId) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: '下一段載客查不到起點站',
      });
      continue;
    }
    const origin = originByStation.get(stationId);
    // facilities 是後加的欄位；手寫 fixture 與舊產物可能沒有，容錯成空陣列
    const originFacilities = origin?.facilities ?? [];
    if (!origin || originFacilities.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: `拓樸沒有設施連到 ${stationId}`,
      });
      continue;
    }

    const codes = facilityCodesFor(yard.taskType);
    const candidates = originFacilities
      .filter((f) => facilityMatchesCodes(f, codes))
      // 快的先挑：佔整備尾巴的風險最小
      .sort((a, b) => a.deadheadSeconds - b.deadheadSeconds);
    if (candidates.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: `整備設定的設施（${codes.join('／') || '未設定'}）都沒有連到 ${stationId}`,
      });
      continue;
    }

    const departSecond = minuteToSecond(next.plannedStartMinute);
    const yardEndSecond = minuteToSecond(yard.plannedEndMinute);
    const yardStartSecond = minuteToSecond(yard.plannedStartMinute);

    let chosen: MaintenanceFacilityExit | null = null;
    let chosenStart = 0;
    for (const facility of candidates) {
      const startSecond = departSecond - facility.deadheadSeconds;
      // 出場移動不得早於整備開始（那代表整備根本沒做）
      if (startSecond < yardStartSecond - 1e-9) continue;
      if (!facilityIsFree(bookings, facility.nodeId, yardStartSecond, startSecond, timeline.row)) {
        continue;
      }
      chosen = facility;
      chosenStart = startSecond;
      break;
    }
    if (!chosen) {
      skipped.push({
        timelineRow: timeline.row,
        taskType: yard.taskType,
        reason: '設施都被別列車佔著，或空駛時間長到蓋掉整段整備',
      });
      continue;
    }

    // 空間不夠 → 吃整備尾巴（全系統唯一有此特權的卡）
    const eatsTail = chosenStart < yardEndSecond - 1e-9;
    if (eatsTail) {
      yard.plannedEndMinute = secondToMinute(chosenStart);
      ateYardTail += 1;
    }

    const card: GeneratedScheduleBlock = {
      id: `yardexit-${yard.id}-${Math.round(chosenStart)}`,
      timelineRow: timeline.row,
      taskType: 'dispatch',
      label: `出場移動 · ${chosen.label} → ${origin.label}`,
      anchorStartMinute: secondToMinute(chosenStart),
      plannedStartMinute: secondToMinute(chosenStart),
      plannedEndMinute: next.plannedStartMinute,
      travelSeconds: chosen.deadheadSeconds,
      dwellSeconds: 0,
      source: 'yard_exit_move',
      yardExitFacilityNodeId: chosen.nodeId,
      yardExitFacilityLabel: chosen.label,
      yardExitStationId: origin.stationId,
      yardExitStationLabel: origin.label,
      yardExitSectionCode:
        resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes)
        ?? undefined,
      yardExitAteYardTail: eatsTail || undefined,
    };
    timeline.blocks.push(card);
    bookings.push({
      facilityNodeId: chosen.nodeId,
      startSecond: yardStartSecond,
      endSecond: chosenStart,
      timelineRow: timeline.row,
    });
    inserted += 1;
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return { timelines, inserted, ateYardTail, skipped };
}

function resolveBlockOriginStationId(
  block: GeneratedScheduleBlock,
): string | null {
  const dwells = block.stationDwells;
  if (Array.isArray(dwells) && dwells.length > 0) {
    return dwells[0]?.stationId?.trim() || null;
  }
  return null;
}
