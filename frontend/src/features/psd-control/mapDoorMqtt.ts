import type {
  DoorDisplayStateCode,
  DoorIndicatorModel,
  DoorVisualState,
  VehicleDoorId,
} from './constants';

export type DoorMotionCode = 'CLOSED' | 'OPENING' | 'OPEN' | 'CLOSING';

export type DoorLeafMqtt = {
  door_id?: string;
  label?: string;
  open_percent?: number;
  motion?: string;
  display_state?: string;
  locked?: boolean;
  anti_pinch?: string;
  alarm?: boolean;
};

export type VehicleDoorMqttPayload = {
  vehicle_code?: string;
  timestamp?: number;
  connection?: string;
  speed_kmh?: number;
  doors?: DoorLeafMqtt[];
};

export type PsdDoorMqttPayload = {
  psd_id?: string;
  timestamp?: number;
  open_percent?: number;
  motion?: string;
  display_state?: string;
  alignment?: string;
  connection?: string;
  locked?: boolean;
  anti_pinch?: string;
  alarm?: boolean;
};

const DOOR_ID_BY_MQTT: Record<string, VehicleDoorId> = {
  RF: 'rf',
  RR: 'rr',
  LF: 'lf',
  LR: 'lr',
};

const VISUAL_BY_DISPLAY: Record<DoorDisplayStateCode, DoorVisualState> = {
  OPEN: 'open',
  CLOSING: 'closing',
  CLOSED: 'closed',
  OPENING: 'opening',
  ALIGNMENT_ALARM: 'alarm',
  OFFLINE: 'offline',
};

export function doorVisualStateFor(
  doorId: string,
  states: Partial<Record<string, DoorIndicatorModel>>,
): DoorIndicatorModel {
  return states[doorId] ?? { visual: 'closed', openPercent: 0 };
}

export function deriveDisplayState(args: {
  displayState?: string;
  motion?: string;
  openPercent?: number;
  connection?: string;
  alignment?: string;
  alarm?: boolean;
}): DoorDisplayStateCode {
  const explicit = String(args.displayState ?? '').toUpperCase() as DoorDisplayStateCode;
  if (explicit in VISUAL_BY_DISPLAY) return explicit;
  if (String(args.connection ?? '').toUpperCase() === 'OFFLINE') return 'OFFLINE';
  if (args.alarm || String(args.alignment ?? '').toUpperCase() === 'MISALIGNED') {
    return 'ALIGNMENT_ALARM';
  }
  const code = String(args.motion ?? '').toUpperCase();
  const pct = Number(args.openPercent);
  if (code === 'OPENING') return 'OPENING';
  if (code === 'CLOSING') return 'CLOSING';
  if (code === 'OPEN' || (Number.isFinite(pct) && pct >= 99.5)) return 'OPEN';
  if (code === 'CLOSED' || !Number.isFinite(pct) || pct <= 0.5) return 'CLOSED';
  return 'OPENING';
}

export function visualFromDoorMqtt(
  motion?: string,
  openPercent?: number,
  extra?: {
    displayState?: string;
    connection?: string;
    alignment?: string;
    alarm?: boolean;
  },
): DoorIndicatorModel {
  const display = deriveDisplayState({
    displayState: extra?.displayState,
    motion,
    openPercent,
    connection: extra?.connection,
    alignment: extra?.alignment,
    alarm: extra?.alarm,
  });
  const pct = Number(openPercent);
  return {
    visual: VISUAL_BY_DISPLAY[display],
    openPercent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : display === 'OPEN' ? 100 : 0,
  };
}

export function vehicleDoorIdFromMqtt(doorId: string | undefined): VehicleDoorId | null {
  if (!doorId) return null;
  return DOOR_ID_BY_MQTT[doorId.trim().toUpperCase()] ?? null;
}

export function vehicleDoorStatesFromPayload(
  payload: VehicleDoorMqttPayload | undefined,
): Partial<Record<VehicleDoorId, DoorIndicatorModel>> {
  if (!payload?.doors?.length) return {};
  const out: Partial<Record<VehicleDoorId, DoorIndicatorModel>> = {};
  for (const leaf of payload.doors) {
    const id = vehicleDoorIdFromMqtt(leaf.door_id);
    if (!id) continue;
    out[id] = visualFromDoorMqtt(leaf.motion, leaf.open_percent, {
      displayState: leaf.display_state,
      connection: payload.connection,
      alarm: leaf.alarm,
    });
  }
  return out;
}

export function leafByUiId(
  payload: VehicleDoorMqttPayload | undefined,
  uiId: string,
): DoorLeafMqtt | undefined {
  const want = String(uiId).toUpperCase();
  const mqttId = want === 'RF' || want === 'RR' || want === 'LF' || want === 'LR'
    ? want
    : Object.entries(DOOR_ID_BY_MQTT).find(([, v]) => v === uiId)?.[0];
  if (!mqttId) return undefined;
  return payload?.doors?.find((d) => String(d.door_id).toUpperCase() === mqttId);
}

export function bodyStatusLabel(visual: DoorVisualState): string {
  if (visual === 'open') return '常態開';
  if (visual === 'closing') return '動作中關';
  if (visual === 'opening') return '動作中開';
  if (visual === 'alarm') return '對位告警';
  if (visual === 'offline') return '失去連線';
  return '常態關';
}

export function connectionLabel(raw?: string): string {
  return String(raw ?? '').toUpperCase() === 'OFFLINE' ? '未連線' : '已連線';
}
