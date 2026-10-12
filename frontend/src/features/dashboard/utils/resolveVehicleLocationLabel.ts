import type { VariableMap } from '../VariableContext';
import { formatMqttDisplayScalar } from './mqttFieldResolve';

/** 停靠點／站名（非軌道段、非設施格） */
const DOCKING_STATION_NAME_RE = /^(N2W|S2W|T3)(上行|下行)?$/i;

/**
 * 軌道段 D03 / U02 或設施格 E1、P1、H1…
 *
 * D 後面收一到兩位數：場區格位就叫 D1 到 D5，只收兩位數的話這些車的位置一律變成「—」。
 */
const TRACK_OR_FACILITY_RE = /^([DU]\d{1,2}|E\d+|P[1-4]|H\d+|M\d+|W\d+)$/i;

function normalizeTrackOrFacilityCode(raw: string): string {
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

export function resolveVehicleLocationLabel(sources: {
  variables?: VariableMap;
  operation?: Record<string, unknown> | null;
  telemetry?: Record<string, unknown> | null;
}): string {
  return formatMqttDisplayScalar(sources.variables?.segment_label) ?? '—';
}
