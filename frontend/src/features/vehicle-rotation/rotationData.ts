import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

export type RotationMode = 'confirm' | 'auto';
export type HoldState = 'available' | 'reserved' | 'overhaul';
export type ItemStatus = 'pending' | 'confirmed' | 'skipped' | 'done' | 'aborted';
export type StepStatus = 'waiting' | 'running' | 'done' | 'fault';
export type ChangeKind = 'add' | 'cancel' | 'reassign';
export type PlanTaskKind = 'passenger' | 'movement' | 'maintenance';

export type RotationRules = {
  intervalKm: number;
  takeoverSlots: string[];
  windowStart: string;
  windowEnd: string;
  mode: RotationMode;
  reportBy: string;
};

export type ShuntChange = {
  key: string;
  at: number;
  kind: ChangeKind;
  taskKind: PlanTaskKind;
  tripCode: string | null;
  route: string;
  before: string | null;
  after: string | null;
  estimated?: boolean;
};

export type ShuntOrder = {
  code: string;
  outgoing: string;
  incoming: string;
  window: {
    row: number;
    zone: string;
    location: string;
    meetAt: string;
    takeoverDepartAt: number;
  };
  changes: ShuntChange[];
  context: { trip_code: string; depart_at: number; vehicle_code: string | null; origin: string; destination: string }[];
  counts: { add: number; cancel: number; reassign: number; passenger: number; unaffected: number };
};

export type CarView = {
  code: string;
  row: number;
  on_line: boolean;
  current_km: number;
  last_rotation_km: number;
  battery_pct: number | null;
  rest_since: number | null;
  hold: HoldState;
  location: string | null;
  state: string;
};

export type FleetCar = CarView & { next_rotation_km: number; blockers: string[] };

export type MonitorStep = {
  key: string;
  label: string;
  detail: string;
  at: number | null;
  status: StepStatus;
};

export type RotationItem = {
  id: string;
  operating_day: string;
  effective_day: string;
  status: ItemStatus;
  fault: string | null;
  order: ShuntOrder;
  confirmed_by: string | null;
  incoming_status: CarView | null;
  steps: MonitorStep[];
};

export type RotationToday = {
  operating_day: string;
  now: number;
  rules: RotationRules;
  deployed_at: number | null;
  report_generated_at: number | null;
  blocked: { code: string; reason: string }[];
  items: RotationItem[];
  slot_options: string[];
};

export type RotationRecord = {
  id: string;
  at: number | null;
  operating_day: string;
  outgoing: string;
  incoming: string;
  location: string;
  result: 'done' | 'skipped' | 'aborted';
  fault: string | null;
  by: string | null;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const csrf = document.cookie.split('; ').find((part) => part.startsWith('syncdrive_csrf='))?.split('=').slice(1).join('=');
  const response = await fetch(`${resolveBrowserApiBaseUrl()}/syncdrive-api/vehicle-rotation${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? `操作失敗（HTTP ${response.status}）`);
  return payload as T;
}

export const fetchToday = () => request<RotationToday>('GET', '/today');
export const fetchVehicles = () => request<{ items: FleetCar[] }>('GET', '/vehicles');
export const fetchRecords = () => request<{ items: RotationRecord[] }>('GET', '/records');
export const deployRules = (rules: RotationRules) => request('PUT', '/rules', rules);
export const generateReport = () => request('POST', '/report/generate', {});
export const confirmItem = (id: string) => request('POST', `/items/${id}/confirm`, {});
export const skipItem = (id: string) => request('POST', `/items/${id}/skip`, {});
export const setVehicleHold = (code: string, hold: HoldState) => request('PUT', `/vehicles/${code}/hold`, { hold });
