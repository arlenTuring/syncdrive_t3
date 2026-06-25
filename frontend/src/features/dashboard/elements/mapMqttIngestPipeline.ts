import type { MapAreaObject } from '../../map-editor/types/area';
import type { FacilityObject } from '../../map-editor/types/facility';
import type { MqttLiveEntry } from '../../map-editor/live/mqttLiveTypes';
import { mergePayloadIntoLive } from '../../map-editor/live/mqttPayload';
import { getMqttEntityId } from '../../map-editor/live/mqttEntityId';
import { readVehicleMetersFromPayload } from '../../map-editor/utils/areaVehicleMqtt';
import {
  buildTrackNetwork,
  isYardVehiclePayload,
  resolveVehiclePlacementAcrossAreas,
  type TrackNetwork,
} from '../../map-editor/vehicles/resolveVehicleTrackPlacement';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';

export type MapMqttFlushSnapshot = {
  liveById: Record<string, MqttLiveEntry>;
  areaVehicles: AreaVehicleLive[];
};

function entityIdFromTopic(topic: string, pattern: string): string | null {
  const tParts = topic.split('/');
  const pParts = pattern.split('/');
  if (tParts.length !== pParts.length) return null;
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i] === '+') return tParts[i] ?? null;
    if (pParts[i] !== tParts[i]) return null;
  }
  return null;
}

function facilityMatchesEntity(f: FacilityObject, entityId: string): boolean {
  const inst = f.parameters?.mqttInstanceId;
  if (typeof inst === 'string' && inst.trim() === entityId) return true;
  const eid = getMqttEntityId(f);
  return eid === entityId || eid.endsWith(`/${entityId}`) || eid.includes(`/${entityId}/`);
}

function topicMatchesArea(areaTopic: string | undefined, messageTopic: string): boolean {
  if (!areaTopic) return false;
  if (areaTopic === messageTopic) return true;
  if (areaTopic.includes('+')) {
    const tParts = messageTopic.split('/');
    const pParts = areaTopic.split('/');
    if (tParts.length !== pParts.length) return false;
    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i] === '+') continue;
      if (pParts[i] !== tParts[i]) return false;
    }
    return true;
  }
  return false;
}

export function vehicleVisualKey(payload: Record<string, unknown>): string {
  const x = typeof payload.x === 'number' ? payload.x.toFixed(2) : String(payload.x ?? '');
  const y = typeof payload.y === 'number' ? payload.y.toFixed(2) : String(payload.y ?? '');
  const door = payload.door_open_percent ?? 0;
  const action = payload.operation_action ?? '';
  const actions = Array.isArray(payload.operation_actions)
    ? payload.operation_actions.join(',')
    : '';
  const heading =
    (payload.local_pose as { heading?: number } | undefined)?.heading ??
    payload.heading ??
    0;
  const headingStr =
    typeof heading === 'number' && Number.isFinite(heading) ? heading.toFixed(3) : '0';
  const steerRaw =
    (payload.actuation_feedback as { steering_angle?: number } | undefined)?.steering_angle ??
    payload.steering_angle ??
    0;
  const steer =
    typeof steerRaw === 'number' && Number.isFinite(steerRaw) ? steerRaw.toFixed(3) : '0';
  const track = payload.segment_label ?? '';
  const trip = payload.trip_code ?? '';
  const badge = payload.badge_label ?? '';
  const lineKind = payload.line_kind ?? '';
  return `${x}|${y}|${door}|${action}|${actions}|${steer}|${headingStr}|${track}|${trip}|${badge}|${lineKind}`;
}

type PlacementCacheEntry = {
  posKey: string;
  areaId: string;
};

type PendingLivePatch = {
  entityId: string;
  entry: MqttLiveEntry;
};

type PendingVehicle = {
  vehicleId: string;
  topic: string;
  payload: Record<string, unknown>;
  xM: number;
  yM: number;
  visualKey: string;
  updatedAt: number;
};

/** 營運欄位：合併 operation/update 至圖台載具 payload（telemetry 不含 trip_code） */
function mergeOperationFields(
  telemetryPayload: Record<string, unknown>,
  operation: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!operation) return telemetryPayload;
  const trip = operation.trip_code ?? operation.tripCode;
  const leg = operation.current_leg;
  const legTarget =
    leg && typeof leg === 'object'
      ? String((leg as { target_station_id?: unknown }).target_station_id ?? '').trim()
      : '';
  return {
    ...telemetryPayload,
    order_id: operation.order_id ?? telemetryPayload.order_id,
    trip_code: trip ?? telemetryPayload.trip_code,
    badge_label: trip ?? operation.badge_label ?? telemetryPayload.badge_label,
    vehicle_phase: operation.vehicle_phase ?? telemetryPayload.vehicle_phase,
    line_kind: operation.line_kind ?? telemetryPayload.line_kind,
    operation_action: operation.operation_action ?? telemetryPayload.operation_action,
    current_leg: leg ?? telemetryPayload.current_leg,
    ...(legTarget && !telemetryPayload.segment_label
      ? { segment_label: legTarget }
      : {}),
  };
}

export function createMapMqttIngestPipeline(
  onFlush: (snapshot: MapMqttFlushSnapshot) => void,
) {
  let areas: MapAreaObject[] = [];
  let trackNetwork: TrackNetwork = { segments: [] };
  let rafId = 0;
  let liveBase: Record<string, MqttLiveEntry> = {};
  const livePatches = new Map<string, PendingLivePatch>();
  const pendingVehicles = new Map<string, PendingVehicle>();
  const operationByVehicle = new Map<string, Record<string, unknown>>();
  const pendingVehicleRemovals = new Set<string>();
  const placementCache = new Map<string, PlacementCacheEntry>();
  const emittedVehicles = new Map<string, AreaVehicleLive>();
  let lastAreaVehicles: AreaVehicleLive[] = [];
  const pendingIngest: Array<{ topic: string; payloadObj: Record<string, unknown> }> = [];

  function posKey(xM: number, yM: number): string {
    return `${xM.toFixed(2)}|${yM.toFixed(2)}`;
  }

  function scheduleFlush() {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      flush();
    });
  }

  function resolveVehicleId(topic: string, payloadObj: Record<string, unknown>): string | null {
    const direct =
      payloadObj.vehicle_code ??
      payloadObj.vehicleCode ??
      payloadObj.vehicle_id;
    if (direct != null && String(direct).trim()) return String(direct).trim();

    const topicParts = topic.split('/');
    if (topicParts[0] === 'v1' && topicParts[1] === 'vtms' && topicParts[2] && topicParts[2] !== '+') {
      return topicParts[2];
    }

    const idFieldCandidates = new Set<string>();
    for (const area of areas) {
      const pattern = area.mqtt?.topic?.trim();
      if (!pattern || !topicMatchesArea(pattern, topic)) continue;
      idFieldCandidates.add(area.mqtt?.vehicleIdField ?? 'vehicle_code');
    }

    for (const field of idFieldCandidates) {
      const raw = payloadObj[field];
      if (raw != null && String(raw).trim()) return String(raw).trim();
    }

    const pattern =
      areas.map((a) => a.mqtt?.topic?.trim()).find((p) => p && topicMatchesArea(p, topic)) ?? '';
    return entityIdFromTopic(topic, pattern);
  }

  function resolveAreaIdForVehicle(
    vehicleId: string,
    xM: number,
    yM: number,
    payload?: Record<string, unknown>,
  ): string | null {
    const key = posKey(xM, yM);
    const preferYard = isYardVehiclePayload(payload);
    const cacheKey = preferYard ? `${key}|yard` : key;
    const cached = placementCache.get(vehicleId);
    if (cached?.posKey === cacheKey) return cached.areaId;

    const resolved = resolveVehiclePlacementAcrossAreas(areas, xM, yM, trackNetwork, {
      preferYardPlacement: preferYard,
      payload,
    });
    if (resolved) {
      placementCache.set(vehicleId, { posKey: cacheKey, areaId: resolved.area.id });
      return resolved.area.id;
    }

    return null;
  }

  function ingestFacilityLive(topic: string, payloadObj: Record<string, unknown>) {
    const payloadStr = JSON.stringify(payloadObj);

    // 內建設施 MQTT：syncdrive/{entityId}（例如 syncdrive/Gate/142）
    if (topic.startsWith('syncdrive/')) {
      const entityId = topic.slice('syncdrive/'.length);
      for (const area of areas) {
        for (const f of area.facilities) {
          if (!facilityMatchesEntity(f, entityId)) continue;
          const eid = getMqttEntityId(f);
          const prev = liveBase[eid];
          livePatches.set(eid, {
            entityId: eid,
            entry: mergePayloadIntoLive(prev, topic, payloadStr),
          });
        }
      }
      return;
    }

    for (const area of areas) {
      const pattern = area.mqtt?.topic?.trim();
      if (!pattern || !topicMatchesArea(pattern, topic)) continue;
      const entityId = entityIdFromTopic(topic, pattern);
      if (!entityId) continue;

      const pos = readVehicleMetersFromPayload(payloadObj, area.mqtt);
      if (!pos) continue;

      for (const f of area.facilities) {
        if (!facilityMatchesEntity(f, entityId)) continue;
        const eid = getMqttEntityId(f);
        const prev = liveBase[eid];
        livePatches.set(eid, {
          entityId: eid,
          entry: {
            ...mergePayloadIntoLive(prev, topic, payloadStr),
            positionMeters: pos,
          },
        });
      }
    }
  }

  function ingestOperation(topic: string, payloadObj: Record<string, unknown>) {
    if (!topic.includes('/operation/')) return;
    const vehicleId = resolveVehicleId(topic, payloadObj);
    if (!vehicleId) return;
    operationByVehicle.set(vehicleId, payloadObj);

    const pending = pendingVehicles.get(vehicleId);
    if (pending) {
      const merged = mergeOperationFields(pending.payload, payloadObj);
      pendingVehicles.set(vehicleId, {
        ...pending,
        payload: merged,
        visualKey: vehicleVisualKey(merged),
      });
    }

    const emitted = emittedVehicles.get(vehicleId);
    if (emitted) {
      const merged = mergeOperationFields(emitted.payload ?? {}, payloadObj);
      pendingVehicles.set(vehicleId, {
        vehicleId,
        topic: emitted.topic,
        payload: merged,
        xM: emitted.xM,
        yM: emitted.yM,
        visualKey: vehicleVisualKey(merged),
        updatedAt: Date.now(),
      });
    }
  }

  function ingestVehicle(topic: string, payloadObj: Record<string, unknown>) {
    if (!topic.includes('/telemetry/')) return;

    const vehicleId = resolveVehicleId(topic, payloadObj);
    if (!vehicleId) return;

    if (payloadObj.map_visible === false) {
      pendingVehicleRemovals.add(vehicleId);
      scheduleFlush();
      return;
    }

    const pos =
      readVehicleMetersFromPayload(payloadObj, { xField: 'x', yField: 'y' }) ??
      readVehicleMetersFromPayload(payloadObj, {
        xField: 'local_pose.position.x',
        yField: 'local_pose.position.y',
      }) ??
      readVehicleMetersFromPayload(
        payloadObj,
        areas.find((a) => a.mqtt?.topic && topicMatchesArea(a.mqtt.topic, topic))?.mqtt,
      );
    if (!pos) return;

    const operation = operationByVehicle.get(vehicleId);
    const mergedPayload = mergeOperationFields(payloadObj, operation);

    pendingVehicles.set(vehicleId, {
      vehicleId,
      topic,
      payload: mergedPayload,
      xM: pos.x,
      yM: pos.y,
      visualKey: vehicleVisualKey(mergedPayload),
      updatedAt: Date.now(),
    });
  }

  function ingestLive(topic: string, payloadObj: Record<string, unknown>) {
    ingestFacilityLive(topic, payloadObj);
    if (topic.includes('/operation/')) {
      ingestOperation(topic, payloadObj);
    } else {
      ingestVehicle(topic, payloadObj);
    }
    scheduleFlush();
  }

  function ingest(topic: string, payloadObj: Record<string, unknown>) {
    if (areas.length === 0) {
      pendingIngest.push({ topic, payloadObj });
      if (pendingIngest.length > 500) pendingIngest.shift();
      return;
    }
    ingestLive(topic, payloadObj);
  }

  function buildAreaVehicles(): { vehicles: AreaVehicleLive[]; changed: boolean } {
    const hasRemovals = pendingVehicleRemovals.size > 0;
    if (pendingVehicles.size === 0 && !hasRemovals) {
      return { vehicles: lastAreaVehicles, changed: false };
    }

    const next = new Map(emittedVehicles);
    for (const vehicleId of pendingVehicleRemovals) {
      next.delete(vehicleId);
    }
    for (const pending of pendingVehicles.values()) {
      const areaId = resolveAreaIdForVehicle(
        pending.vehicleId,
        pending.xM,
        pending.yM,
        pending.payload,
      );
      if (!areaId) {
        if (isYardVehiclePayload(pending.payload)) {
          next.delete(pending.vehicleId);
        }
        continue;
      }

      const prev = next.get(pending.vehicleId);
      if (
        prev &&
        prev.areaId === areaId &&
        prev.xM === pending.xM &&
        prev.yM === pending.yM &&
        prev.payload &&
        vehicleVisualKey(prev.payload) === pending.visualKey
      ) {
        continue;
      }

      next.set(pending.vehicleId, {
        areaId,
        vehicleId: pending.vehicleId,
        xM: pending.xM,
        yM: pending.yM,
        payload: pending.payload,
        topic: pending.topic,
        updatedAt: pending.updatedAt,
      });
    }

    const list = [...next.values()];
    const unchanged =
      list.length === lastAreaVehicles.length &&
      list.every((v, i) => v === lastAreaVehicles[i]);
    if (unchanged) {
      return { vehicles: lastAreaVehicles, changed: false };
    }

    emittedVehicles.clear();
    for (const v of list) emittedVehicles.set(v.vehicleId, v);
    lastAreaVehicles = list;
    return { vehicles: list, changed: true };
  }

  function flush() {
    const hasLivePatches = livePatches.size > 0;
    const hasVehicles = pendingVehicles.size > 0 || pendingVehicleRemovals.size > 0;
    if (!hasLivePatches && !hasVehicles) return;

    let nextLive = liveBase;
    if (hasLivePatches) {
      nextLive = { ...liveBase };
      for (const patch of livePatches.values()) {
        nextLive[patch.entityId] = patch.entry;
      }
      liveBase = nextLive;
      livePatches.clear();
    }

    const { vehicles: nextVehicles, changed: vehiclesChanged } = buildAreaVehicles();
    pendingVehicles.clear();
    pendingVehicleRemovals.clear();

    if (!hasLivePatches && !vehiclesChanged) return;

    onFlush({
      liveById: nextLive,
      areaVehicles: nextVehicles,
    });
  }

  return {
    setAreas(nextAreas: MapAreaObject[]) {
      areas = nextAreas;
      trackNetwork = buildTrackNetwork(nextAreas);
      placementCache.clear();

      if (areas.length > 0 && pendingIngest.length > 0) {
        const batch = pendingIngest.splice(0);
        for (const { topic, payloadObj } of batch) {
          ingestLive(topic, payloadObj);
        }
      } else if (areas.length > 0 && emittedVehicles.size > 0) {
        for (const vehicle of emittedVehicles.values()) {
          const operation = operationByVehicle.get(vehicle.vehicleId);
          const merged = mergeOperationFields(vehicle.payload ?? {}, operation);
          pendingVehicles.set(vehicle.vehicleId, {
            vehicleId: vehicle.vehicleId,
            topic: vehicle.topic,
            payload: merged,
            xM: vehicle.xM,
            yM: vehicle.yM,
            visualKey: vehicleVisualKey(merged),
            updatedAt: vehicle.updatedAt,
          });
        }
        scheduleFlush();
      }
    },
    ingest,
    reset() {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      liveBase = {};
      livePatches.clear();
      pendingVehicles.clear();
      pendingVehicleRemovals.clear();
      operationByVehicle.clear();
      placementCache.clear();
      emittedVehicles.clear();
      lastAreaVehicles = [];
      pendingIngest.length = 0;
      /** 保留 areas，重建 trackNetwork（否則 pause→start 後 MQTT 無法再定位） */
      trackNetwork = areas.length > 0 ? buildTrackNetwork(areas) : { segments: [] };
    },
    dispose() {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
    },
  };
}
