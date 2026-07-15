export type VtmsStreamKind = 'telemetry' | 'operation' | 'health';

const VTMS_VEHICLE_TOPIC_RE =
  /^v1\/vtms\/([^/]+)\/(telemetry\/update|operation\/update|health\/heartbeat)$/i;

/** 解析 VTMS 車輛 MQTT 主題（已替換 ${vehicle_code} 後） */
export function parseVtmsVehicleTopic(
  topic: string,
): { vehicleCode: string; stream: VtmsStreamKind } | null {
  const m = VTMS_VEHICLE_TOPIC_RE.exec(topic.trim());
  if (!m) return null;
  const vehicleCode = m[1].trim().toUpperCase();
  const suffix = m[2].toLowerCase();
  const stream: VtmsStreamKind = suffix.startsWith('telemetry/')
    ? 'telemetry'
    : suffix.startsWith('operation/')
      ? 'operation'
      : 'health';
  return { vehicleCode, stream };
}

/** 車輛 telemetry / operation / health — 地圖 ingest 不需掃設施 */
export function isVtmsVehicleStreamTopic(topic: string): boolean {
  return /^v1\/vtms\/[^/]+\/(telemetry|operation|health)\//i.test(topic);
}
