import type { ReplaySource } from "../replay-core/useReplayPlayer";
import {
  fetchHistoryFrames,
  fetchHistoryNeighbor,
  fetchHistorySnapshot,
  type HistoryScope,
  type InvestigatedVehicle,
} from "./api";

export type Window = { from: number; to: number; ongoing: boolean };

/** 回放來源（調查載具或背景）：每支 API 都帶調查載具的穩定識別與範圍 */
export function historySource(id: string, vehicle: InvestigatedVehicle, scope: HistoryScope, window_: Window): ReplaySource {
  return {
    key: `${id}|${scope}|${vehicle.id}|${window_.from}-${window_.to}`,
    window: window_,
    snapshot: async (cursor, signal) => {
      const body = await fetchHistorySnapshot(vehicle.id, scope, cursor, signal);
      return { frames: body.frames, reference: body.reference };
    },
    frames: async ({ after, to }, signal) => {
      const page = await fetchHistoryFrames({ vehicleId: vehicle.id, scope, from: after.t, to, after }, signal);
      return { frames: page.frames, coveredTo: page.covered_to, next: page.next };
    },
    neighbor: async (cursor, dir, signal) =>
      (await fetchHistoryNeighbor(vehicle.id, cursor, dir, { min: window_.from, max: window_.to }, signal)).frame,
  };
}

