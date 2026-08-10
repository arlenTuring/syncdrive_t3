import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { MaintenanceBodySectionKey } from './maintenanceFirstTripOrigins';
import { SCHEDULE_DAY_MINUTES } from './scheduleDayCycle';

/**
 * 整備轉場小卡共用的設施比對與佔用邏輯。
 *
 * 這些片段原本散在入廠／出廠／整備間轉場三個檔案裡各自重複一份，一字不差，
 * 所以抽出來共用；三者後來也合併成 insertMaintenanceTransferCards.ts。
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

const DAY_SECONDS = SCHEDULE_DAY_MINUTES * 60;

/**
 * 一段時間窗在日循環上實際覆蓋到的區段（0 ≤ t < 一天）。
 *
 * 整備區塊的時刻可以落在一天之外：入廠卡把開頭往前拉過午夜時，那一段整備會
 * 記成「開始 23:5x、結束 1440＋」；同樣的一格設施在別列車眼中可能記成
 * 「00:00–01:30」。直接比大小的話這兩段永遠不會判定成重疊，但它們在實體上
 * 就是同一台設施的同一段時間，會排出兩台車同時佔一格。
 */
function daySegmentsOf(startSecond: number, endSecond: number): Array<[number, number]> {
  const span = endSecond - startSecond;
  if (span <= 0) return [];
  if (span >= DAY_SECONDS) return [[0, DAY_SECONDS]];
  const start = ((startSecond % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const end = start + span;
  if (end <= DAY_SECONDS) return [[start, end]];
  return [[start, DAY_SECONDS], [0, end - DAY_SECONDS]];
}

/** 同一台設施在該時段是否已被別列車佔著（日循環比對） */
export function moveCardFacilityIsFree(
  bookings: MoveCardFacilityBooking[],
  facilityNodeId: string,
  startSecond: number,
  endSecond: number,
  timelineRow: number,
): boolean {
  const want = daySegmentsOf(startSecond, endSecond);
  if (want.length === 0) return true;
  return !bookings.some((b) => {
    if (b.facilityNodeId !== facilityNodeId) return false;
    if (b.timelineRow === timelineRow) return false;
    const booked = daySegmentsOf(b.startSecond, b.endSecond);
    return booked.some(([bs, be]) =>
      want.some(([ws, we]) => bs < we - 1e-9 && ws < be - 1e-9));
  });
}
