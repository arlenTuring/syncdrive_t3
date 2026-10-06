import type { PlannedDispatch } from './dispatch.plan';
import { maintenancePayloadFields } from './dispatch.charging';
import {
  classifyTask,
  type BusinessLineKind,
} from '../order/order-business-kind';

export type { BusinessLineKind };

/**
 * 原任務子類型。整備班次的 taskType 一律是 'maintenance'，真正的子類型（充電、保養、待命、暫停…）
 * 在 maintenance.taskType——只看 taskType 會把待命也當成整備。
 */
export function originalTaskType(
  item: Pick<PlannedDispatch, 'taskType'> & {
    maintenance?: Pick<
      NonNullable<PlannedDispatch['maintenance']>,
      'taskType'
    > | null;
  },
): string {
  return item.maintenance?.taskType || item.taskType;
}

const TRANSITION_PURPOSE_WORD: Record<NonNullable<PlannedDispatch['transitionPurpose']>, string> = {
  yard_exit: '出廠',
  yard_entry: '入廠',
  standby: '待命',
  hold: '暫停',
};

/**
 * 過渡卡的短名稱：用途＋設施（出廠 E3、入廠 D2、待命 D3、暫停 D1）。
 * 出廠後面是出發的設施、入廠後面是要去的設施。用途不明回 null，畫面顯示中性的「過渡」。
 */
export function transitionShortLabel(
  purpose: PlannedDispatch['transitionPurpose'],
  facility: string | null | undefined,
): string | null {
  if (!purpose) return null;
  const word = TRANSITION_PURPOSE_WORD[purpose];
  const place = facility?.trim();
  return place ? `${word} ${place}` : word;
}

export function businessLineKind(
  item: Pick<PlannedDispatch, 'kind' | 'taskType'> & {
    maintenance?: Pick<
      NonNullable<PlannedDispatch['maintenance']>,
      'taskType'
    > | null;
  },
): BusinessLineKind {
  // 班表展開出來的任務一定有用途；子類型空白的整備卡沿用舊行為歸整備
  return classifyTask(item.kind, originalTaskType(item)) ?? 'MAINTENANCE';
}

/**
 * 一張調度訂單的業務欄位：分類、整備徽章與格位、卡片要用的任務資訊。
 *
 * 正式調度下單與模擬器重播都用這一份（模擬器經 /dispatch/plan/shift/:id 拿到），
 * 兩邊的卡片才會長得一樣，不會各自定一套分類或標籤。
 */
export function dispatchOrderFields(item: PlannedDispatch): {
  line_kind: BusinessLineKind;
  maint_type_label?: string;
  maint_type_bg?: string;
  maint_type_color?: string;
  maint_station?: string;
  payload: Record<string, unknown>;
} {
  return {
    line_kind: businessLineKind(item),
    ...(item.maintenance
      ? {
          maint_type_label: item.maintenance.typeLabel,
          maint_type_bg: item.maintenance.typeBg,
          maint_type_color: item.maintenance.typeColor,
          maint_station: item.maintenance.yardSlotId,
        }
      : {}),
    payload: {
      kind: item.kind,
      // 整備分佈的 SQL 讀 payload->>'yard_slot_id' 判斷哪一格被佔著
      ...maintenancePayloadFields(item.maintenance),
      timeline_row: item.timelineRow,
      // 原任務子類型（充電、保養、待命…），卡片與分類都看這個，不看卡片文字
      task_type: originalTaskType(item),
      card_label: item.cardLabel,
      route_code: item.routeCode,
      route_name: item.routeName,
      // 過渡卡顯示用（trip_code、order_id 不變）
      ...(businessLineKind(item) === 'TRANSITION'
        ? {
            transition_purpose: item.transitionPurpose ?? null,
            transition_facility: item.transitionFacility ?? null,
            transition_label: transitionShortLabel(item.transitionPurpose, item.transitionFacility),
          }
        : {}),
    },
  };
}
