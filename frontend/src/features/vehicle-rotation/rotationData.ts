import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';
import type { FleetCar, HoldState, PlanTask, RotationRules } from './rotationModel';

/** POC 只讀：今日計畫與營運時鐘，兩支都是 GET，不會下單也不會改班表 */
export type RotationPlan = { shiftName: string; tasks: PlanTask[] };

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${resolveBrowserApiBaseUrl()}${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`讀取失敗（HTTP ${response.status}）`);
  return response.json() as Promise<T>;
}

export async function fetchRotationPlan(): Promise<RotationPlan | null> {
  const body = await getJson<{ deployed: boolean; shift_name?: string; trips?: PlanTask[] }>(
    '/syncdrive-api/dispatch/plan?full=1',
  );
  if (!body.deployed) return null;
  return { shiftName: body.shift_name ?? '', tasks: body.trips ?? [] };
}

export async function fetchOperatingNow(): Promise<number> {
  const body = await getJson<{ operating_now: number }>('/syncdrive-api/dispatch/operating-clock');
  return body.operating_now;
}

type SampleCar = {
  currentKm: number;
  lastRotationKm: number;
  batteryPct: number;
  restHours?: number;
  hold?: HoldState;
};

/** 系統還沒有真實里程，這份範例只用來看畫面 */
const SAMPLE_FLEET: Record<string, SampleCar> = {
  PMS01: { currentKm: 12480, lastRotationKm: 11350, batteryPct: 78 },
  PMS02: { currentKm: 12210, lastRotationKm: 11290, batteryPct: 66 },
  PMS03: { currentKm: 11790, lastRotationKm: 11100, batteryPct: 71 },
  PMS04: { currentKm: 13040, lastRotationKm: 11960, batteryPct: 83 },
  PMS05: { currentKm: 10870, lastRotationKm: 10300, batteryPct: 59 },
  PMS06: { currentKm: 12610, lastRotationKm: 11710, batteryPct: 74 },
  PMS07: { currentKm: 11420, lastRotationKm: 10950, batteryPct: 68 },
  PMS08: { currentKm: 12055, lastRotationKm: 11150, batteryPct: 81 },
  PMS09: { currentKm: 9120, lastRotationKm: 8120, batteryPct: 40, restHours: 72, hold: 'overhaul' },
  PMS10: { currentKm: 9680, lastRotationKm: 8700, batteryPct: 92, restHours: 19 },
  PMS11: { currentKm: 10410, lastRotationKm: 9400, batteryPct: 85, restHours: 2 },
};

/** 車輛與列的對應來自真實計畫；里程、電量、休息時間是範例 */
export function buildSampleFleet(tasks: readonly PlanTask[], now: number): FleetCar[] {
  const rows = new Map<string, { row: number; passenger: boolean }>();
  for (const task of tasks) {
    if (!task.vehicle_code) continue;
    const entry = rows.get(task.vehicle_code) ?? { row: task.timeline_row, passenger: false };
    entry.passenger ||= task.kind === 'passenger';
    rows.set(task.vehicle_code, entry);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, { row, passenger }]) => {
      const sample = SAMPLE_FLEET[code] ?? { currentKm: 10000, lastRotationKm: 9500, batteryPct: 70, restHours: 8 };
      return {
        code,
        row,
        onLine: passenger,
        currentKm: sample.currentKm,
        lastRotationKm: sample.lastRotationKm,
        batteryPct: sample.batteryPct,
        restSince: passenger ? null : now - (sample.restHours ?? 8) * 3_600_000,
        hold: sample.hold ?? 'available',
      };
    });
}

export type RotationRecord = {
  id: string;
  at: number;
  outgoing: string;
  incoming: string;
  location: string;
  result: '完成' | '異常' | '略過';
  by: string;
};

const DAY_MS = 86_400_000;

/** 輪替紀錄還沒有資料來源，這幾筆只用來看畫面 */
export function buildSampleRecords(now: number): RotationRecord[] {
  return [
    { id: 'sample-1', at: now - DAY_MS, outgoing: 'PMS06', incoming: 'PMS09', location: 'NW下發1', result: '完成', by: '範例' },
    { id: 'sample-2', at: now - 3 * DAY_MS, outgoing: 'PMS02', incoming: 'PMS11', location: 'E1', result: '略過', by: '範例' },
    { id: 'sample-3', at: now - 6 * DAY_MS, outgoing: 'PMS08', incoming: 'PMS10', location: 'D5', result: '完成', by: '範例' },
  ];
}

export type RotationPocState = { rules?: Partial<RotationRules>; deployedAt?: number; holds?: Record<string, HoldState> };

const POC_STORAGE_KEY = 'syncdrive.vehicle-rotation.poc';

export function readPocState(): RotationPocState {
  try {
    return (JSON.parse(window.localStorage.getItem(POC_STORAGE_KEY) ?? '{}') as RotationPocState) ?? {};
  } catch {
    return {};
  }
}

export function writePocState(state: RotationPocState): void {
  try {
    window.localStorage.setItem(POC_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 存不進去只影響重新整理後的畫面 */
  }
}
