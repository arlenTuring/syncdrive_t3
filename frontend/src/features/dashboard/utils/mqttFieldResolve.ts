import { getByPath } from './jsonPath';

function unwrapMqttPayload(mqttRaw: unknown): Record<string, unknown> | null {
  if (mqttRaw === null || mqttRaw === undefined) return null;
  if (typeof mqttRaw !== 'object') return null;
  const o = mqttRaw as Record<string, unknown>;
  if ('value' in o && Object.keys(o).length === 1) {
    const inner = o.value;
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
    return { value: inner };
  }
  return o;
}

const HEALTH_SUBSYSTEM_FIELD_PATHS: Record<string, string> = {
  status_computing: 'subsystems.COMPUTING.status',
  status_sensing: 'subsystems.SENSING.status',
  status_communication: 'subsystems.COMMUNICATION.status',
  status_chassis: 'subsystems.CHASSIS.status',
};

/** 從 MQTT payload 解析單一欄位（支援點號路徑） */
export function resolveMqttFieldValue(mqttRaw: unknown, field: string): unknown {
  const key = field.trim();
  if (!key) return null;

  const payload = unwrapMqttPayload(mqttRaw);
  if (!payload) {
    if (mqttRaw !== null && mqttRaw !== undefined && typeof mqttRaw !== 'object') return mqttRaw;
    return null;
  }

  if (key in payload) return payload[key];

  const dotted = getByPath(payload, key);
  if (dotted !== undefined) return dotted;

  const subPath = HEALTH_SUBSYSTEM_FIELD_PATHS[key];
  if (subPath) {
    const subVal = getByPath(payload, subPath);
    if (subVal !== undefined) return subVal;
  }

  return null;
}

export function isFullMqttPayload(mqttRaw: unknown): mqttRaw is Record<string, unknown> {
  const p = unwrapMqttPayload(mqttRaw);
  return p !== null && Object.keys(p).length > 1;
}
