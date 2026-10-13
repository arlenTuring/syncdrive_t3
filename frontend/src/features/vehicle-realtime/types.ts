export type StreamKind = 'telemetry' | 'operation' | 'health';

export type VehicleStreamSnapshot = {
  payload: Record<string, unknown>;
  dataAt: number;
  receivedAt: number;
  persisted: boolean;
};

export type VehicleRealtimeItem = {
  id: string;
  vehicleCode: string;
  displayName: string;
  connectionStatus: 'ONLINE' | 'OFFLINE' | 'NO_DATA';
  mapId: string | null;
  location: {
    x: number;
    y: number;
    z: number | null;
    headingRad: number | null;
    label: string | null;
    kind: string | null;
    objectId: string | null;
  } | null;
  speedKph: number | null;
  batteryLevel: number | null;
  gear: string | null;
  telemetry: VehicleStreamSnapshot | null;
  operation: VehicleStreamSnapshot | null;
  health: VehicleStreamSnapshot | null;
  contractOrder: { orderId: string; tripCode: string; status: string } | null;
};

export type VehicleStateEnvelope = VehicleStreamSnapshot & {
  vehicleCode: string;
  stream: StreamKind;
  derivedLocation?: { label: string | null; kind: string | null; objectId: string | null };
};

export type VehicleSnapshotResponse = {
  serverTime: number;
  offlineAfterMs: number;
  items: VehicleRealtimeItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
