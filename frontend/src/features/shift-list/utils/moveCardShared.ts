import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { MaintenanceBodySectionKey } from './maintenanceFirstTripOrigins';

/**
 * 四張移動小卡（MO／MI／PI／PO）共用的設施比對與佔用邏輯。
 *
 * 這些片段原本在 insertYardExitMoveCards.ts／insertYardEntryMoveCards.ts／
 * insertParkMoveCards.ts 裡各自重複了一份，一字不差。新增「整備間轉場卡」
 * （insertYardTransitionMoveCards.ts）會是第四份重複，所以這次直接抽出來。
 */

/** 整備任務類型 → 整備中心設施區段鍵 */
export const FACILITY_SECTION_BY_TASK_TYPE: Partial<
  Record<TaskTypeKey, MaintenanceBodySectionKey>
> = {
  charging: 'charging',
  inspection: 'preTrip',
  standby: 'mobile',
  servicing: 'maintenance',
  washing: 'carWash',
};

/** 會佔用整備中心設施的任務類型（時間模板 taskType，不含調度） */
export const YARD_TASK_TYPES = new Set<string>([
  'charging',
  'inspection',
  'standby',
  'servicing',
  'washing',
]);

export function normalizeMoveCardCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 拓樸節點 id／顯示名是否命中整備任務設定的 mapCode */
export function nodeMatchesMoveCardCodes(
  node: { id: string; label?: string },
  codes: string[],
): boolean {
  if (codes.length === 0) return false;
  const id = normalizeMoveCardCode(node.id);
  const label = normalizeMoveCardCode(node.label ?? '');
  return codes.some((raw) => {
    const code = normalizeMoveCardCode(raw);
    if (!code || code === 'UNSPECIFIED') return false;
    return code === id || code === label || label.startsWith(code) || id.endsWith(code);
  });
}

export type MoveCardFacilityBooking = {
  facilityNodeId: string;
  startSecond: number;
  endSecond: number;
  timelineRow: number;
};

/** 同一台設施在該時段是否已被別列車佔著 */
export function moveCardFacilityIsFree(
  bookings: MoveCardFacilityBooking[],
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
