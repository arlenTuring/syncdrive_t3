import type { TimelineGap } from "../replay-core/replayState";
import type { ParameterChange, ReplayGap } from "./api";

/**
 * 歷史降級回放的狀態重建：游標、排序、逐幀規則與一般運行紀錄共用（replay-core），
 * 這裡只留降級特有的部分（參數變更、營運時間軸上的缺段）。
 */
export {
  applyFrame,
  gapAt,
  orderOverrideFrom,
  stateAt,
  stateFromSnapshot,
  typicalTelemetryInterval,
  visibleVehicles,
  type HiddenVehicle,
  type ReplayState,
  type ReplayVehicle,
} from "../replay-core/replayState";

/** 降級的缺段換算到回放時間軸（營運時間）；沒有營運時間的缺段無法對到時間軸上，不畫 */
export function timelineGaps(gaps: readonly ReplayGap[]): TimelineGap[] {
  return gaps
    .filter((gap) => gap.from_operating != null)
    .map((gap) => ({ from: gap.from_operating, to: gap.to_operating, reason: gap.reason, count: gap.count }));
}

/** 游標當下生效的降級參數（生效時刻不晚於游標的最後一次；從沒生效的變更不算） */
export function parametersAt(
  changes: readonly ParameterChange[],
  at: number,
): { level: number; speedLimitKmh: number; since: number } | null {
  let current: { level: number; speedLimitKmh: number; since: number } | null = null;
  for (const change of changes) {
    if (change.effective_at_operating == null || change.effective_at_operating > at) continue;
    if (change.level == null || change.speed_limit_kmh == null) continue;
    if (current && change.effective_at_operating < current.since) continue;
    current = {
      level: change.level,
      speedLimitKmh: change.speed_limit_kmh,
      since: change.effective_at_operating,
    };
  }
  return current;
}
