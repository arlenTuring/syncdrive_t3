import type { VariableMap } from '../VariableContext';
import { formatMqttDisplayScalar } from './mqttFieldResolve';

/** 停靠點／站名（非軌道段、非設施格） */
const DOCKING_STATION_NAME_RE = /^(N2W|S2W|T3)(上行|下行)?$/i;

/** 軌道段 D03 / U02 或設施格 E1、P1、H1… */
const TRACK_OR_FACILITY_RE = /^([DU]\d{2}|E\d+|P[1-4]|H\d+|M\d+|W\d+)$/i;

const MAINLINE_TRIP_RE = /^[DU][0-9]{4}$/i;

function isMaintenanceLocationContext(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
}): boolean {
  const opLine = String(sources.operation?.line_kind ?? '').toUpperCase();
  if (opLine === 'MAINTENANCE') return true;
  if (sources.operation?.maint_type_label) return true;
  if (sources.operation?.yard_slot_id != null && sources.operation?.yard_slot_id !== '') return true;

  const varLine = String(sources.variables?.line_kind ?? '').toUpperCase();
  if (varLine === 'MAINTENANCE') return true;
  if (String(sources.variables?.badge_kind ?? '').toLowerCase() === 'maintenance') return true;
  if (sources.variables?.maint_type_label) return true;
  return false;
}

function isMainlineLocationContext(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
}): boolean {
  if (isMaintenanceLocationContext(sources)) return false;

  const lineKind = String(
    sources.operation?.line_kind ?? sources.variables?.line_kind ?? '',
  ).toUpperCase();
  if (lineKind === 'MAINLINE') return true;
  const trip = String(sources.operation?.trip_code ?? sources.variables?.trip_code ?? '').trim();
  return MAINLINE_TRIP_RE.test(trip);
}

function isMainlineAwaitingDeparture(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
}): boolean {
  const orderStatus = String(
    sources.operation?.order_status ?? sources.variables?.order_status ?? '',
  ).toUpperCase();
  const phase = String(sources.operation?.vehicle_phase ?? '').toUpperCase();
  return orderStatus === 'PENDING' || phase === 'AWAITING_DEPARTURE';
}

function normalizeTrackOrFacilityCode(raw: string): string {
  const m = /^([DU])(\d{1,2})$/i.exec(raw.trim());
  if (m) {
    return `${m[1].toUpperCase()}${String(Number(m[2])).padStart(2, '0')}`;
  }
  return raw.trim().toUpperCase();
}

/** 只接受軌道段或設施格代碼；拒絕 N2W下行、T3 等停靠點名稱 */
export function sanitizeTrackOrFacilityLabel(raw: unknown): string | undefined {
  const scalar = formatMqttDisplayScalar(raw);
  if (!scalar) return undefined;
  if (DOCKING_STATION_NAME_RE.test(scalar)) return undefined;
  if (/上行|下行|車站/.test(scalar)) return undefined;
  if (scalar.includes('→')) {
    for (const part of scalar.split('→')) {
      const parsed = sanitizeTrackOrFacilityLabel(part.trim());
      if (parsed) return parsed;
    }
    return undefined;
  }
  if (TRACK_OR_FACILITY_RE.test(scalar)) {
    return normalizeTrackOrFacilityCode(scalar);
  }
  return undefined;
}

/** 車輛卡位置：yard_slot_id（設施）或 segment_label（軌道段）；不含停靠點站名 */
export function resolveVehicleLocationLabel(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
  telemetry?: Record<string, unknown> | null;
}): string {
  const yardFromOperation = sanitizeTrackOrFacilityLabel(
    sources.operation?.yard_slot_id
    ?? (sources.operation && 'value' in sources.operation ? sources.operation.value : undefined),
  );
  if (yardFromOperation) return yardFromOperation;

  if (isMaintenanceLocationContext(sources)) {
    const yard = sanitizeTrackOrFacilityLabel(
      sources.variables?.yard_slot_id
      ?? sources.variables?.segment_label,
    );
    if (yard) return yard;
    return '—';
  }

  if (isMainlineLocationContext(sources)) {
    if (isMainlineAwaitingDeparture(sources)) {
      const yard = sanitizeTrackOrFacilityLabel(
        sources.operation?.yard_slot_id
        ?? sources.variables?.yard_slot_id
        ?? sources.variables?.segment_label,
      );
      if (yard) return yard;
    }
    const track = sanitizeTrackOrFacilityLabel(
      sources.telemetry?.segment_label
      ?? sources.variables?.segment_label,
    );
    if (track) return track;
    return '—';
  }

  const yard = sanitizeTrackOrFacilityLabel(
    sources.operation?.yard_slot_id
    ?? sources.variables?.yard_slot_id,
  );
  if (yard) return yard;

  const track = sanitizeTrackOrFacilityLabel(
    sources.telemetry?.segment_label
    ?? sources.variables?.segment_label,
  );
  if (track) return track;

  return '—';
}
