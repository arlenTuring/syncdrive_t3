import type { MapAreaObject } from '../../map-editor/types/area';
import type { FacilityObject } from '../../map-editor/types/facility';
import type { MqttLiveEntry } from '../../map-editor/live/mqttLiveTypes';
import { mergePayloadIntoLive } from '../../map-editor/live/mqttPayload';
import { getMqttEntityId } from '../../map-editor/live/mqttEntityId';
import { readVehicleMetersFromPayload } from '../../map-editor/utils/areaVehicleMqtt';
import { readVehicleHeadingRad } from '../../map-editor/vehicles/readVehicleHeading';
import { EMPTY_TRACK_NETWORK } from '../../map-editor/vehicles/trackNetwork/scanMap';
import {
  buildTrackNetwork,
  isYardVehiclePayload,
  parseYardSlotIdFromPayload,
  resolveVehiclePlacementAcrossAreas,
  resolveYardFacilityPlacement,
  type TrackNetwork,
} from '../../map-editor/vehicles/resolveVehicleTrackPlacement';
import {
  parseYardSlotFromPayload,
  resolveYardFacilityFieldMeters,
} from '../../map-editor/utils/yardFacilitySlots';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';
import { readSimElapsedMs } from '../utils/simClock';
import { isVtmsVehicleStreamTopic } from '../utils/vtmsTopic';

export type MapMqttFlushSnapshot = {
  liveById: Record<string, MqttLiveEntry>;
  areaVehicles: AreaVehicleLive[];
  liveChanged: boolean;
  vehiclesChanged: boolean;
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

type IndexedFacility = {
  area: MapAreaObject;
  facility: FacilityObject;
  eid: string;
};

type FacilityIndex = {
  byEntityKey: Map<string, IndexedFacility[]>;
  areaPatterns: Array<{
    area: MapAreaObject;
    pattern: string;
    facilities: IndexedFacility[];
  }>;
};

function entityKeysForFacility(f: FacilityObject): string[] {
  const keys = new Set<string>();
  const inst = f.parameters?.mqttInstanceId;
  if (typeof inst === 'string' && inst.trim()) keys.add(inst.trim());
  const eid = getMqttEntityId(f);
  keys.add(eid);
  const tail = eid.split('/').pop();
  if (tail) keys.add(tail);
  return [...keys];
}

function buildFacilityIndex(areas: MapAreaObject[]): FacilityIndex {
  const byEntityKey = new Map<string, IndexedFacility[]>();
  const areaPatterns: FacilityIndex['areaPatterns'] = [];

  for (const area of areas) {
    const facilities: IndexedFacility[] = [];
    for (const f of area.facilities) {
      const eid = getMqttEntityId(f);
      const indexed: IndexedFacility = { area, facility: f, eid };
      facilities.push(indexed);
      for (const key of entityKeysForFacility(f)) {
        const list = byEntityKey.get(key) ?? [];
        if (!list.some((item) => item.eid === eid)) list.push(indexed);
        byEntityKey.set(key, list);
      }
    }
    const pattern = area.mqtt?.topic?.trim();
    if (pattern) areaPatterns.push({ area, pattern, facilities });
  }

  return { byEntityKey, areaPatterns };
}

function lookupIndexedFacilities(
  index: FacilityIndex,
  entityId: string,
  matcher: (f: FacilityObject, entityId: string) => boolean,
): IndexedFacility[] {
  const direct = index.byEntityKey.get(entityId);
  if (direct?.length) return direct;
  const out: IndexedFacility[] = [];
  for (const list of index.byEntityKey.values()) {
    for (const item of list) {
      if (matcher(item.facility, entityId) && !out.some((x) => x.eid === item.eid)) {
        out.push(item);
      }
    }
  }
  return out;
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
const OPERATION_DOOR_FIELDS = [
  'door_open_percent',
  'door_fl_open_percent',
  'door_fr_open_percent',
  'door_rl_open_percent',
  'door_rr_open_percent',
] as const;

function mergeOperationFields(
  telemetryPayload: Record<string, unknown>,
  operation: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!operation) return telemetryPayload;
  const trip = operation.trip_code ?? operation.tripCode;
  const leg = operation.current_leg;
  const doorFields: Record<string, unknown> = {};
  for (const key of OPERATION_DOOR_FIELDS) {
    if (operation[key] !== undefined) doorFields[key] = operation[key];
  }
  const opActions = operation.operation_actions;
  return {
    ...telemetryPayload,
    ...doorFields,
    order_id: operation.order_id ?? telemetryPayload.order_id,
    trip_code: trip ?? telemetryPayload.trip_code,
    badge_label: trip ?? operation.badge_label ?? telemetryPayload.badge_label,
    vehicle_phase: operation.vehicle_phase ?? telemetryPayload.vehicle_phase,
    dwelling: operation.dwelling ?? telemetryPayload.dwelling,
    line_kind: operation.line_kind ?? telemetryPayload.line_kind,
    operation_action: operation.operation_action ?? telemetryPayload.operation_action,
    ...(Array.isArray(opActions) && opActions.length > 0
      ? { operation_actions: opActions }
      : {}),
    current_leg: leg ?? telemetryPayload.current_leg,
    ...(telemetryPayload.yard_slot_id != null && telemetryPayload.yard_slot_id !== ''
      ? { yard_slot_id: telemetryPayload.yard_slot_id }
      : {}),
    ...(operation.yard_slot_id != null && operation.yard_slot_id !== ''
      ? { yard_slot_id: operation.yard_slot_id }
      : {}),
  };
}

type MergeCacheEntry = {
  telRef: Record<string, unknown> | undefined;
  opRef: Record<string, unknown> | undefined;
  merged: Record<string, unknown>;
};

export function createMapMqttIngestPipeline(
  onFlush: (snapshot: MapMqttFlushSnapshot) => void,
) {
  let areas: MapAreaObject[] = [];
  let trackNetwork: TrackNetwork = EMPTY_TRACK_NETWORK;
  let facilityIndex: FacilityIndex = { byEntityKey: new Map(), areaPatterns: [] };
  let rafId = 0;
  let liveBase: Record<string, MqttLiveEntry> = {};
  const livePatches = new Map<string, PendingLivePatch>();
  const pendingVehicles = new Map<string, PendingVehicle>();
  const operationByVehicle = new Map<string, Record<string, unknown>>();
  const mergeCache = new Map<string, MergeCacheEntry>();
  const pendingVehicleRemovals = new Set<string>();
  const placementCache = new Map<string, PlacementCacheEntry>();
  const emittedVehicles = new Map<string, AreaVehicleLive>();
  let lastAreaVehicles: AreaVehicleLive[] = [];
  const pendingIngest: Array<{ topic: string; payloadObj: Record<string, unknown> }> = [];

  function posKey(xM: number, yM: number): string {
    return `${xM.toFixed(2)}|${yM.toFixed(2)}`;
  }

  function mergeOperationFieldsCached(
    vehicleId: string,
    telemetryPayload: Record<string, unknown>,
    operation: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const cached = mergeCache.get(vehicleId);
    if (
      cached &&
      cached.telRef === telemetryPayload &&
      cached.opRef === operation
    ) {
      return cached.merged;
    }
    const merged = mergeOperationFields(telemetryPayload, operation);
    mergeCache.set(vehicleId, {
      telRef: telemetryPayload,
      opRef: operation,
      merged,
    });
    return merged;
  }

  function clearAllState() {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    liveBase = {};
    livePatches.clear();
    pendingVehicles.clear();
    pendingVehicleRemovals.clear();
    operationByVehicle.clear();
    mergeCache.clear();
    placementCache.clear();
    emittedVehicles.clear();
    lastAreaVehicles = [];
    pendingIngest.length = 0;
    trackNetwork = areas.length > 0 ? buildTrackNetwork(areas) : EMPTY_TRACK_NETWORK;
    facilityIndex =
      areas.length > 0 ? buildFacilityIndex(areas) : { byEntityKey: new Map(), areaPatterns: [] };
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

  function yardCoordsFromPayload(
    payload: Record<string, unknown> | undefined,
  ): { xM: number; yM: number; areaId: string } | null {
    if (!payload) return null;
    const yardSlot = parseYardSlotFromPayload(payload);
    if (!yardSlot) return null;
    const field = resolveYardFacilityFieldMeters(yardSlot.slotId, areas, {
      subIndex: yardSlot.subIndex,
    });
    if (!field) return null;
    return { xM: field.xM, yM: field.yM, areaId: field.area.id };
  }

  function resolveAreaIdForVehicle(
    vehicleId: string,
    xM: number,
    yM: number,
    payload?: Record<string, unknown>,
    headingRad?: number,
  ): string | null {
    const preferYard = isYardVehiclePayload(payload);

    if (preferYard && payload) {
      const yardPlacement = resolveYardFacilityPlacement(areas, payload);
      if (yardPlacement) {
        const slotKey = parseYardSlotIdFromPayload(payload) ?? 'yard';
        placementCache.set(vehicleId, { posKey: `yard:${slotKey}`, areaId: yardPlacement.area.id });
        return yardPlacement.area.id;
      }
    }

    const key = posKey(xM, yM);
    // 朝向會決定挑到上行還是下行，所以要進快取的鍵
    const headKey = headingRad === undefined ? '-' : headingRad.toFixed(3);
    const cacheKey = preferYard ? `${key}|yard` : `${key}|${headKey}`;
    const cached = placementCache.get(vehicleId);
    if (cached?.posKey === cacheKey) return cached.areaId;

    const resolved = resolveVehiclePlacementAcrossAreas(areas, xM, yM, trackNetwork, {
      preferYardPlacement: preferYard,
      payload,
      headingRad,
    });
    if (resolved) {
      placementCache.set(vehicleId, { posKey: cacheKey, areaId: resolved.area.id });
      return resolved.area.id;
    }

    return null;
  }

  function ingestFacilityLive(topic: string, payloadObj: Record<string, unknown>) {
    const payloadStr = JSON.stringify(payloadObj);

    if (topic.startsWith('syncdrive/')) {
      const entityId = topic.slice('syncdrive/'.length);
      const targets = lookupIndexedFacilities(facilityIndex, entityId, facilityMatchesEntity);
      for (const { eid } of targets) {
        const prev = liveBase[eid];
        livePatches.set(eid, {
          entityId: eid,
          entry: mergePayloadIntoLive(prev, topic, payloadStr),
        });
      }
      return;
    }

    for (const { area, pattern, facilities } of facilityIndex.areaPatterns) {
      if (!topicMatchesArea(pattern, topic)) continue;
      const entityId = entityIdFromTopic(topic, pattern);
      if (!entityId) continue;

      const pos = readVehicleMetersFromPayload(payloadObj, area.mqtt);
      if (!pos) continue;

      for (const { facility, eid } of facilities) {
        if (!facilityMatchesEntity(facility, entityId)) continue;
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
    if (operationByVehicle.get(vehicleId) === payloadObj) return;
    operationByVehicle.set(vehicleId, payloadObj);
    mergeCache.delete(vehicleId);

    const yardSnap = yardCoordsFromPayload(payloadObj);
    if (yardSnap && isYardVehiclePayload(payloadObj)) {
      const merged = mergeOperationFieldsCached(vehicleId, {}, payloadObj);
      pendingVehicles.set(vehicleId, {
        vehicleId,
        topic,
        payload: merged,
        xM: yardSnap.xM,
        yM: yardSnap.yM,
        visualKey: vehicleVisualKey(merged),
        updatedAt: Date.now(),
      });
    }

    const pending = pendingVehicles.get(vehicleId);
    if (pending) {
      const merged = mergeOperationFieldsCached(vehicleId, pending.payload, payloadObj);
      const snap = yardCoordsFromPayload(merged);
      pendingVehicles.set(vehicleId, {
        ...pending,
        payload: merged,
        xM: snap?.xM ?? pending.xM,
        yM: snap?.yM ?? pending.yM,
        visualKey: vehicleVisualKey(merged),
      });
    }

    const emitted = emittedVehicles.get(vehicleId);
    if (emitted) {
      const merged = mergeOperationFieldsCached(vehicleId, emitted.payload ?? {}, payloadObj);
      const snap = yardCoordsFromPayload(merged);
      pendingVehicles.set(vehicleId, {
        vehicleId,
        topic: emitted.topic,
        payload: merged,
        xM: snap?.xM ?? emitted.xM,
        yM: snap?.yM ?? emitted.yM,
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
    const mergedPayload = mergeOperationFieldsCached(vehicleId, payloadObj, operation);
    const visualKey = vehicleVisualKey(mergedPayload);
    const pendingSimMs = readSimElapsedMs(mergedPayload);

    const emitted = emittedVehicles.get(vehicleId);
    if (
      emitted &&
      emitted.xM === pos.x &&
      emitted.yM === pos.y &&
      emitted.payload &&
      vehicleVisualKey(emitted.payload) === visualKey &&
      readSimElapsedMs(emitted.payload) === pendingSimMs
    ) {
      return;
    }

    pendingVehicles.set(vehicleId, {
      vehicleId,
      topic,
      payload: mergedPayload,
      xM: pos.x,
      yM: pos.y,
      visualKey,
      updatedAt: Date.now(),
    });
  }

  /** VTMS 由 VehicleFleetMqttHub 單點訂閱；圖台每 tick 讀 Map，不再走 socket.onAny */
  function ingestVtmsFromFleetHub(
    telemetry: ReadonlyMap<string, Record<string, unknown>>,
    operation: ReadonlyMap<string, Record<string, unknown>>,
  ) {
    if (areas.length === 0) return;

    let touched = false;
    const codes = new Set<string>();
    for (const code of telemetry.keys()) codes.add(code);
    for (const code of operation.keys()) codes.add(code);
    if (codes.size === 0) return;

    for (const vehicleId of codes) {
      const op = operation.get(vehicleId);
      if (op) {
        ingestOperation(`v1/vtms/${vehicleId}/operation/update`, op);
        touched = true;
      }
      const tel = telemetry.get(vehicleId);
      if (tel) {
        ingestVehicle(`v1/vtms/${vehicleId}/telemetry/update`, tel);
        touched = true;
      }
    }

    if (touched) scheduleFlush();
  }

  function ingestLive(topic: string, payloadObj: Record<string, unknown>) {
    if (isVtmsVehicleStreamTopic(topic)) return;

    ingestFacilityLive(topic, payloadObj);
    if (topic.includes('/operation/')) {
      ingestOperation(topic, payloadObj);
    } else if (topic.includes('/telemetry/')) {
      ingestVehicle(topic, payloadObj);
    }
    scheduleFlush();
  }

  function ingest(topic: string, payloadObj: Record<string, unknown>) {
    if (topic.includes('/health/')) return;
    if (isVtmsVehicleStreamTopic(topic)) return;
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
      let xM = pending.xM;
      let yM = pending.yM;
      const yardSnap = yardCoordsFromPayload(pending.payload);
      if (yardSnap && isYardVehiclePayload(pending.payload)) {
        xM = yardSnap.xM;
        yM = yardSnap.yM;
      }

      const areaId = resolveAreaIdForVehicle(
        pending.vehicleId,
        xM,
        yM,
        pending.payload,
        readVehicleHeadingRad(pending.payload) ?? undefined,
      );
      if (!areaId) {
        // 定位失敗時保留上一帧，勿因整備 MQTT 標記而刪除載具
        continue;
      }

      const prev = next.get(pending.vehicleId);
      const prevSimMs = prev?.payload ? readSimElapsedMs(prev.payload) : undefined;
      const pendingSimMs = readSimElapsedMs(pending.payload);
      if (
        prev &&
        prev.areaId === areaId &&
        prev.xM === pending.xM &&
        prev.yM === pending.yM &&
        prev.payload &&
        vehicleVisualKey(prev.payload) === pending.visualKey &&
        prevSimMs === pendingSimMs
      ) {
        continue;
      }

      next.set(pending.vehicleId, {
        areaId,
        vehicleId: pending.vehicleId,
        xM,
        yM,
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
      liveChanged: hasLivePatches,
      vehiclesChanged,
    });
  }

  return {
    setAreas(nextAreas: MapAreaObject[]) {
      areas = nextAreas;
      trackNetwork = buildTrackNetwork(nextAreas);
      facilityIndex = buildFacilityIndex(nextAreas);
      placementCache.clear();

      if (areas.length > 0 && pendingIngest.length > 0) {
        const batch = pendingIngest.splice(0);
        for (const { topic, payloadObj } of batch) {
          ingestLive(topic, payloadObj);
        }
      } else if (areas.length > 0 && emittedVehicles.size > 0) {
        for (const vehicle of emittedVehicles.values()) {
          const operation = operationByVehicle.get(vehicle.vehicleId);
          const merged = mergeOperationFieldsCached(
            vehicle.vehicleId,
            vehicle.payload ?? {},
            operation,
          );
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
    ingestVtmsFromFleetHub,
    reset() {
      clearAllState();
    },
    dispose() {
      clearAllState();
    },
  };
}
