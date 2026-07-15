import type { VtmsStreamKind } from './vtmsTopic';

export function operationRowKey(row: Record<string, unknown>): string {
  const leg =
    row.current_leg && typeof row.current_leg === 'object'
      ? (row.current_leg as Record<string, unknown>)
      : null;
  return [
    row.vehicle_code,
    row.order_id,
    row.trip_code,
    row.yard_slot_id,
    row.maint_type_label,
    row.vehicle_phase,
    row.operation_action,
    row.line_kind,
    leg?.target_station_id,
    leg?.eta_seconds,
    row.badge_label,
  ].join('|');
}

export function telemetryRowKey(row: Record<string, unknown>): string {
  const kin = row.kinematics as Record<string, unknown> | undefined;
  const energy = row.energy as Record<string, unknown> | undefined;
  return [
    row.timestamp ?? row.sim_timestamp,
    kin?.velocity,
    energy?.battery_level,
    row.x,
    row.y,
  ].join('|');
}

export function healthRowKey(row: Record<string, unknown>): string {
  return [
    row.overall_health,
    row.status_computing,
    row.status_sensing,
    row.status_communication,
    row.status_chassis,
    row.alert_message,
  ].join('|');
}

export function vtmsRowKeyForStream(
  stream: VtmsStreamKind,
  row: Record<string, unknown>,
): string {
  if (stream === 'operation') return operationRowKey(row);
  if (stream === 'telemetry') return telemetryRowKey(row);
  return healthRowKey(row);
}
