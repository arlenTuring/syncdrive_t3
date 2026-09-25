'use strict';

import type { ChargingSpec } from './dispatch.plan';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 班表綁定的整備任務 → 依格位代號查充電參數。
 *
 * 充電設備列的 <code>mapCode</code> 就是場區格位代號（E1…E4），跟整備訂單的
 * <code>yard_slot_id</code> 同一套命名，所以直接對格位。查不到的原因一律寫進
 * <code>error</code>，不補預設速率——速率錯了，車端算出來的電量就是假的。
 *
 * @param task 整備任務（null 表示班表沒綁或找不到）
 * @param lookupError 取不到整備任務時的原因
 */
export function buildChargingLookup(
  task: { id: string; body: Record<string, unknown> } | null,
  lookupError: string | null = null,
): (yardSlotId: string) => ChargingSpec {
  const failAll = (equipmentCode: string, error: string): ChargingSpec => ({
    equipmentCode,
    rateKwhPerMin: null,
    upperLimitPercent: 100,
    maintenanceTaskId: task?.id ?? null,
    error,
  });

  if (!task) {
    const reason = lookupError ?? '班表沒有綁定整備任務，無法取得充電速率';
    return (slot) => failAll(slot, reason);
  }

  const charging = asRecord(task.body.charging);
  if (!charging || charging.stepEnabled === false) {
    return (slot) => failAll(slot, `整備任務 ${task.id} 未啟用充電步驟`);
  }

  const upper = charging.upperLimitDetectionEnabled === true
    ? positiveNumber(charging.upperLimitPercent)
    : null;
  const upperLimitPercent = upper == null ? 100 : Math.min(100, upper);

  const rateBySlot = new Map<string, number | null>();
  const rows = Array.isArray(charging.equipmentRows) ? charging.equipmentRows : [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const code = typeof row?.mapCode === 'string' ? row.mapCode.trim().toUpperCase() : '';
    if (!code) continue;
    rateBySlot.set(code, positiveNumber(row?.chargeRateKwhPerMin));
  }

  return (yardSlotId) => {
    const slot = yardSlotId.trim().toUpperCase();
    if (!rateBySlot.has(slot)) {
      return failAll(slot, `整備任務 ${task.id} 的充電設備清單沒有 ${slot}`);
    }
    const rate = rateBySlot.get(slot) ?? null;
    if (rate == null) {
      return failAll(slot, `整備任務 ${task.id} 的充電設備 ${slot} 沒有有效的充電速率（kWh/min）`);
    }
    return {
      equipmentCode: slot,
      rateKwhPerMin: rate,
      upperLimitPercent,
      maintenanceTaskId: task.id,
      error: null,
    };
  };
}

/**
 * 整備單在 payload 裡的作業欄位（訂單 payload 與 dispatch/plan?full=1 共用同一份，
 * 車端與模擬器重播看到的欄位才會一致）。
 */
export function maintenancePayloadFields(
  maintenance: { yardSlotId: string; taskType: string; charging: ChargingSpec | null } | null,
): Record<string, unknown> {
  if (!maintenance) return {};
  return {
    yard_slot_id: maintenance.yardSlotId,
    // 作業內容看班表卡的任務類型，不看卡片文字或格位字首
    maintenance_task_type: maintenance.taskType,
    ...(maintenance.charging
      ? {
          charging: {
            equipment_code: maintenance.charging.equipmentCode,
            rate_kwh_per_min: maintenance.charging.rateKwhPerMin,
            upper_limit_percent: maintenance.charging.upperLimitPercent,
            maintenance_task_id: maintenance.charging.maintenanceTaskId,
            error: maintenance.charging.error,
          },
        }
      : {}),
  };
}
