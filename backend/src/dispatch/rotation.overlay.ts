import type { PlannedDispatch } from './dispatch.plan';

/** 一筆已確認的輪替對計畫的影響 */
export type RotationOverlay = {
  /** 這一天起兩台車對調列 */
  effectiveDay: string;
  /** 換手發生的營運日 */
  operatingDay: string;
  outgoing: string;
  incoming: string;
  /** 換手當天要多發的兩趟調車 */
  shunts: PlannedDispatch[];
  /**
   * 不再發的任務。訂單編號帶日期，所以同一份清單涵蓋兩天：換手當天被換車的最後一段，
   * 以及生效日備用列開頭、被換車還沒回到格位的場內任務。
   */
  cancelledOrderIds: string[];
};

/**
 * 車隊順序決定「第 N 列由誰擔任」（見 vehicleForRow）。輪替就是把兩台車的位置對調，
 * 所以班次、移動、整備的指派都不必改；隔天起整列自動換人。
 *
 * 對調要依發生順序一筆一筆做。車已經不在車隊裡（停用、除役）就跳過那一筆，
 * 不能讓同一台車出現在兩列。
 */
export function fleetAfterRotations(
  fleet: readonly string[],
  overlays: readonly RotationOverlay[],
  day: string,
): string[] {
  const order = [...fleet];
  for (const overlay of overlays) {
    if (overlay.effectiveDay > day) continue;
    const a = order.indexOf(overlay.outgoing);
    const b = order.indexOf(overlay.incoming);
    if (a < 0 || b < 0) continue;
    order[a] = overlay.incoming;
    order[b] = overlay.outgoing;
  }
  return order;
}

/** 換手當天的計畫：拿掉被取消的任務，加上調車 */
export function applyRotationOverlay(
  planned: readonly PlannedDispatch[],
  overlays: readonly RotationOverlay[],
  day: string,
): PlannedDispatch[] {
  const today = overlays.filter((overlay) => overlay.operatingDay === day);
  const cancelled = new Set(
    overlays
      .filter((overlay) => overlay.operatingDay === day || overlay.effectiveDay === day)
      .flatMap((overlay) => overlay.cancelledOrderIds),
  );
  if (today.length === 0 && cancelled.size === 0) return [...planned];
  return [
    ...planned.filter((item) => !cancelled.has(item.orderId)),
    ...today.flatMap((overlay) => overlay.shunts),
  ].sort((a, b) => a.departAt - b.departAt);
}
