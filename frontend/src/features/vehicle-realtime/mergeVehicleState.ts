import type { StreamKind, VehicleRealtimeItem, VehicleStateEnvelope, VehicleStreamSnapshot } from './types';

export function isNewerStream(
  next: Pick<VehicleStreamSnapshot, 'dataAt' | 'receivedAt'>,
  current: VehicleStreamSnapshot | null,
): boolean {
  return !current || next.dataAt > current.dataAt || (next.dataAt === current.dataAt && next.receivedAt > current.receivedAt);
}

export function mergeVehicleEnvelope(
  item: VehicleRealtimeItem,
  envelope: VehicleStateEnvelope,
): VehicleRealtimeItem {
  const current = item[envelope.stream];
  if (!isNewerStream(envelope, current)) return item;
  const next = { ...item, [envelope.stream]: envelope } as VehicleRealtimeItem;
  if (envelope.stream === 'telemetry') applyTelemetry(next, envelope.payload, envelope.derivedLocation);
  return next;
}

export function mergeBufferedEnvelopes(
  item: VehicleRealtimeItem,
  buffered: Partial<Record<StreamKind, VehicleStateEnvelope>> | undefined,
): VehicleRealtimeItem {
  let next = item;
  for (const stream of ['telemetry', 'operation', 'health'] as const) {
    const envelope = buffered?.[stream];
    if (envelope) next = mergeVehicleEnvelope(next, envelope);
  }
  return next;
}

function finite(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function applyTelemetry(
  item: VehicleRealtimeItem,
  payload: Record<string, unknown>,
  derivedLocation?: VehicleStateEnvelope['derivedLocation'],
) {
  const kinematics = payload.kinematics as Record<string, unknown> | undefined;
  const energy = payload.energy as Record<string, unknown> | undefined;
  const actuation = payload.actuation_feedback as Record<string, unknown> | undefined;
  const localPose = payload.local_pose as Record<string, unknown> | undefined;
  const position = localPose?.position as Record<string, unknown> | undefined;
  const velocityMps = finite(kinematics?.velocity);
  item.speedKph = velocityMps == null ? null : velocityMps * 3.6;
  item.batteryLevel = finite(energy?.battery_level);
  item.gear = typeof actuation?.gear === 'string' && ['P', 'R', 'N', 'D'].includes(actuation.gear)
    ? actuation.gear
    : null;
  const x = finite(position?.x);
  const y = finite(position?.y);
  if (x == null || y == null) return;
  item.location = {
    x,
    y,
    z: finite(position?.z),
    headingRad: finite(localPose?.heading),
    label: derivedLocation?.label ?? item.location?.label ?? null,
    kind: derivedLocation?.kind ?? item.location?.kind ?? null,
    objectId: derivedLocation?.objectId ?? item.location?.objectId ?? null,
  };
}

export function resolveConnectionStatus(
  item: VehicleRealtimeItem,
  now: number,
  offlineAfterMs: number,
): VehicleRealtimeItem['connectionStatus'] {
  if (!item.telemetry && !item.operation && !item.health) return 'NO_DATA';
  return item.health && now - item.health.receivedAt <= offlineAfterMs ? 'ONLINE' : 'OFFLINE';
}
