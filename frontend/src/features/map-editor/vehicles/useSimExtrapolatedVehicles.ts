import { useEffect, useRef } from 'react';
import type { AreaVehicleLive } from './types';
import { readVehicleHeadingRad } from './readVehicleHeading';
import { lerp, lerpAngleRad, readLegSnapKey, readSimElapsedMs } from '../../dashboard/utils/simClock';
import {
  MAP_VEHICLE_PLAYOUT_FRAME_COUNT,
} from '../../dashboard/constants/mapVehiclePlayout';
import { useSimClockFrame } from '../../dashboard/utils/simClockFrame';

const MAX_BUFFER_SAMPLES = MAP_VEHICLE_PLAYOUT_FRAME_COUNT + 9;

export type SimPlayback = {
  active: boolean;
  speedMultiplier: number;
};

type MotionSample = {
  xM: number;
  yM: number;
  simMs: number;
  legKey: string;
  headingRad: number | null;
};

type VehiclePlayout = {
  samples: MotionSample[];
  /** 已存滿 MAP_VEHICLE_PLAYOUT_FRAME_COUNT 幀，從第一幀開始播 */
  playoutReady: boolean;
  displaySimMs: number;
  lastAdvanceWallMs: number;
};

type MotionFrame = {
  xM: number;
  yM: number;
  headingRad: number | null;
};

function readVehicleDwelling(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  if (payload.dwelling === true) return true;
  return String(payload.vehicle_phase ?? '').toUpperCase() === 'DWELLING';
}

/** 整備格／停留中車輛不需 lerp，避免空轉 60fps 重繪拖垮分頁 */
function vehicleNeedsInterpolation(vehicle: AreaVehicleLive): boolean {
  if (readVehicleDwelling(vehicle.payload)) return false;
  return readSimElapsedMs(vehicle.payload) !== undefined;
}

function sampleFromVehicle(vehicle: AreaVehicleLive): MotionSample | null {
  const simMs = readSimElapsedMs(vehicle.payload);
  if (simMs === undefined) return null;
  return {
    xM: vehicle.xM,
    yM: vehicle.yM,
    simMs,
    legKey: readLegSnapKey(vehicle.payload ?? {}),
    headingRad: readVehicleHeadingRad(vehicle.payload),
  };
}

function headingFromMotion(a: MotionSample, b: MotionSample): number | null {
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  if (Math.hypot(dx, dy) < 1e-4) return b.headingRad ?? a.headingRad;
  return Math.atan2(dy, dx);
}

function patchPayloadHeading(
  payload: Record<string, unknown>,
  headingRad: number,
): Record<string, unknown> {
  const localPose = payload.local_pose;
  if (localPose && typeof localPose === 'object') {
    return {
      ...payload,
      local_pose: { ...(localPose as Record<string, unknown>), heading: headingRad },
    };
  }
  return { ...payload, heading: headingRad };
}

function resetPlayout(state: VehiclePlayout, sample: MotionSample): void {
  state.samples = [sample];
  state.playoutReady = false;
  state.displaySimMs = sample.simMs;
  state.lastAdvanceWallMs = Date.now();
}

function tryStartPlayout(state: VehiclePlayout): void {
  if (state.playoutReady || state.samples.length < MAP_VEHICLE_PLAYOUT_FRAME_COUNT) return;
  state.playoutReady = true;
  const latest = state.samples[state.samples.length - 1];
  // 從最新幀開始播，不回跳至 samples[0]（避免存滿緩衝後視覺倒車）
  state.displaySimMs = latest.simMs;
  state.lastAdvanceWallMs = Date.now();
}

function trimSamplesBehindHead(state: VehiclePlayout): void {
  while (state.samples.length > MAX_BUFFER_SAMPLES) {
    const drop = state.samples[1];
    if (!drop || drop.simMs > state.displaySimMs) break;
    state.samples.shift();
  }
}

function pushSample(state: VehiclePlayout, sample: MotionSample): void {
  const last = state.samples.at(-1);
  if (
    last
    && last.simMs === sample.simMs
    && last.xM === sample.xM
    && last.yM === sample.yM
    && last.legKey === sample.legKey
    && last.headingRad === sample.headingRad
  ) {
    return;
  }

  if (last && sample.legKey !== last.legKey) {
    resetPlayout(state, sample);
    return;
  }

  if (last && sample.simMs < last.simMs) {
    resetPlayout(state, sample);
    return;
  }

  if (last && sample.simMs === last.simMs) {
    state.samples[state.samples.length - 1] = sample;
    return;
  }

  state.samples.push(sample);
  trimSamplesBehindHead(state);
  tryStartPlayout(state);
}

function advancePlayout(state: VehiclePlayout, speed: number): void {
  if (!state.playoutReady || state.samples.length === 0) return;

  const now = Date.now();
  const wallDelta = Math.max(0, now - state.lastAdvanceWallMs);
  state.lastAdvanceWallMs = now;
  state.displaySimMs += wallDelta * speed;

  const latest = state.samples[state.samples.length - 1];
  const oldest = state.samples[0];
  state.displaySimMs = Math.min(state.displaySimMs, latest.simMs);
  state.displaySimMs = Math.max(state.displaySimMs, oldest.simMs);
  trimSamplesBehindHead(state);
}

function resolveHeading(a: MotionSample, b: MotionSample, t: number): number | null {
  if (a.headingRad != null && b.headingRad != null) {
    return lerpAngleRad(a.headingRad, b.headingRad, t);
  }
  return headingFromMotion(a, b);
}

/** 僅在已收到的兩筆樣本之間 lerp；絕不超出最新樣本 */
function interpolateAt(samples: MotionSample[], displaySimMs: number): MotionFrame | null {
  if (samples.length === 0) return null;
  if (samples.length === 1) {
    return {
      xM: samples[0].xM,
      yM: samples[0].yM,
      headingRad: samples[0].headingRad,
    };
  }

  if (displaySimMs <= samples[0].simMs) {
    return {
      xM: samples[0].xM,
      yM: samples[0].yM,
      headingRad: samples[0].headingRad,
    };
  }

  const latest = samples[samples.length - 1];
  if (displaySimMs >= latest.simMs) {
    return {
      xM: latest.xM,
      yM: latest.yM,
      headingRad: latest.headingRad,
    };
  }

  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (displaySimMs < a.simMs || displaySimMs > b.simMs) continue;
    const span = b.simMs - a.simMs;
    const t = span > 0 ? (displaySimMs - a.simMs) / span : 1;
    return {
      xM: lerp(a.xM, b.xM, t),
      yM: lerp(a.yM, b.yM, t),
      headingRad: resolveHeading(a, b, t),
    };
  }

  return {
    xM: latest.xM,
    yM: latest.yM,
    headingRad: latest.headingRad,
  };
}

/**
 * 模擬播放：先存滿 MAP_VEHICLE_PLAYOUT_FRAME_COUNT 幀 MQTT，再啟用 lerp；
 * 顯示貼最新幀，只在相鄰樣本間插值（不回跳至 buffer 最舊幀）。
 */
export function useSimExtrapolatedVehicles(
  vehicles: AreaVehicleLive[],
  playback: SimPlayback,
): AreaVehicleLive[] {
  const playoutRef = useRef<Map<string, VehiclePlayout>>(new Map());
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const activeIds = new Set(vehicles.map((v) => v.vehicleId));
    for (const id of playoutRef.current.keys()) {
      if (!activeIds.has(id)) playoutRef.current.delete(id);
    }

    for (const vehicle of vehicles) {
      const sample = sampleFromVehicle(vehicle);
      if (!sample) continue;

      let state = playoutRef.current.get(vehicle.vehicleId);
      if (!state) {
        state = {
          samples: [],
          playoutReady: false,
          displaySimMs: sample.simMs,
          lastAdvanceWallMs: Date.now(),
        };
        playoutRef.current.set(vehicle.vehicleId, state);
      }
      if (readVehicleDwelling(vehicle.payload)) {
        resetPlayout(state, sample);
        state.playoutReady = true;
        continue;
      }
      pushSample(state, sample);
    }
  }, [vehicles]);

  const needsMotion =
    playback.active && vehicles.some(vehicleNeedsInterpolation);
  const frame = useSimClockFrame(needsMotion);

  if (!needsMotion) return vehicles;

  const speed = Math.max(1, playback.speedMultiplier);
  if (frame !== lastFrameRef.current) {
    lastFrameRef.current = frame;
    for (const state of playoutRef.current.values()) {
      advancePlayout(state, speed);
    }
  }

  const out: AreaVehicleLive[] = [];
  for (const vehicle of vehicles) {
    if (readVehicleDwelling(vehicle.payload)) {
      out.push(vehicle);
      continue;
    }

    const state = playoutRef.current.get(vehicle.vehicleId);
    if (!state || state.samples.length === 0) {
      out.push(vehicle);
      continue;
    }

    const latestSample = state.samples[state.samples.length - 1];
    const displayMs = state.playoutReady ? state.displaySimMs : latestSample.simMs;
    const frameAt = interpolateAt(state.samples, displayMs);
    if (!frameAt) {
      out.push(vehicle);
      continue;
    }

    const payload =
      frameAt.headingRad != null
        ? patchPayloadHeading(vehicle.payload ?? {}, frameAt.headingRad)
        : vehicle.payload;

    out.push({
      ...vehicle,
      xM: frameAt.xM,
      yM: frameAt.yM,
      payload,
    });
  }

  return out;
}
