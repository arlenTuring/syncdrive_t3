export type SimulatedFaultEvent = {
  vehicleCode: string;
  eventCode: string;
  severity: string;
  message: string;
  timestamp: number;
  commandId?: string;
};

export type DemoSimulationTransport = {
  running: boolean;
  transportPaused: boolean;
  speedMultiplier: number;
  /** 已提交之模擬經過毫秒（tick 錨點，100ms 格） */
  virtualElapsedMs: number;
  /** 上次 ack 牆鐘時刻；前端可外推：anchor + (now - lastAckWallMs) × speed */
  lastAckWallMs?: number;
  stepNonce: number;
  tickMs: number;
  simStartMs?: number | null;
  lastSimulatedEvent?: SimulatedFaultEvent | null;
};

export type DemoSimulationStatus = {
  running: boolean;
  paused: boolean;
  source: 'managed' | 'external' | 'none';
  startedAt: string | null;
  pid: number | null;
  transport: DemoSimulationTransport | null;
};

const FETCH_TIMEOUT_MS = 12_000;

function apiUrl(backendUrl: string, path: string): string {
  const base = backendUrl.replace(/\/$/, '');
  return `${base}/syncdrive-api/demo/simulation${path}`;
}

function formatApiError(err: unknown, backendUrl: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const target = backendUrl || 'Vite 代理 → 127.0.0.1:3000';
  if (
    msg === 'Failed to fetch'
    || msg.includes('NetworkError')
    || msg.includes('Load failed')
    || msg.includes('timed out')
    || msg.includes('TimeoutError')
    || msg.includes('aborted')
  ) {
    return `無法連線後端 (${target})，請在專案根目錄執行 npm run dev:restart`;
  }
  return msg;
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export async function fetchDemoSimulationStatus(backendUrl: string): Promise<DemoSimulationStatus> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, '/status'));
    if (!res.ok) throw new Error(`無法取得模擬狀態 (${res.status})`);
    return res.json() as Promise<DemoSimulationStatus>;
  } catch (e) {
    throw new Error(formatApiError(e, backendUrl));
  }
}

export async function fetchDemoSimulationTransport(
  backendUrl: string,
): Promise<DemoSimulationTransport> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, '/transport'));
    if (!res.ok) throw new Error(`無法取得傳輸狀態 (${res.status})`);
    return res.json() as Promise<DemoSimulationTransport>;
  } catch (e) {
    throw new Error(formatApiError(e, backendUrl));
  }
}

export async function updateDemoSimulationTransport(
  backendUrl: string,
  patch: { transportPaused?: boolean; speedMultiplier?: number },
): Promise<DemoSimulationTransport> {
  const body = JSON.stringify(patch);
  const patchUrl = apiUrl(backendUrl, '/transport');
  const postUrl = apiUrl(backendUrl, '/transport/update');
  try {
    let res = await apiFetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.status === 404) {
      res = await apiFetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    }
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('傳輸控制 API 未就緒，請重啟後端 (npm run dev:restart)');
      }
      throw new Error(`無法更新傳輸設定 (${res.status})`);
    }
    return res.json() as Promise<DemoSimulationTransport>;
  } catch (e) {
    if (e instanceof Error && e.message.includes('傳輸控制')) throw e;
    throw new Error(formatApiError(e, backendUrl));
  }
}

export async function stepDemoSimulationTransport(
  backendUrl: string,
  direction: 'next' | 'prev' = 'next',
): Promise<DemoSimulationTransport> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, '/transport/step'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json() as { message?: string | string[] };
        const m = json.message;
        detail = Array.isArray(m) ? m.join(' ') : (m ?? '');
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new Error(detail || `無法逐幀播放 (${res.status})`);
    }
    return res.json() as Promise<DemoSimulationTransport>;
  } catch (e) {
    throw new Error(formatApiError(e, backendUrl));
  }
}

export async function startDemoSimulation(backendUrl: string): Promise<DemoSimulationStatus> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, '/start'), { method: 'POST' });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json() as { message?: string | string[] };
        const m = json.message;
        detail = Array.isArray(m) ? m.join(' ') : (m ?? '');
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new Error(detail || `無法開始模擬 (${res.status})`);
    }
    return res.json() as Promise<DemoSimulationStatus>;
  } catch (e) {
    throw new Error(formatApiError(e, backendUrl));
  }
}

export async function pauseDemoSimulation(backendUrl: string): Promise<DemoSimulationStatus> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, '/pause'), { method: 'POST' });
    if (!res.ok) throw new Error(`無法暫停模擬 (${res.status})`);
    return res.json() as Promise<DemoSimulationStatus>;
  } catch (e) {
    throw new Error(formatApiError(e, backendUrl));
  }
}

export const VTMS_DEMO_VEHICLE_CODES = Array.from(
  { length: 11 },
  (_, i) => `PMS-${String(i + 1).padStart(2, '0')}`,
);

export async function triggerDemoVehicleFault(
  backendUrl: string,
  vehicleCode: string,
): Promise<{
  commandId: string;
  vehicleCode: string;
  action: string;
  expectedEvent: Pick<SimulatedFaultEvent, 'eventCode' | 'severity' | 'message'>;
}> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, '/trigger-fault'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleCode }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json() as { message?: string | string[] };
        const m = json.message;
        detail = Array.isArray(m) ? m.join(' ') : (m ?? '');
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new Error(detail || `無法觸發故障模擬 (${res.status})`);
    }
    return res.json() as Promise<{
      commandId: string;
      vehicleCode: string;
      action: string;
      expectedEvent: Pick<SimulatedFaultEvent, 'eventCode' | 'severity' | 'message'>;
    }>;
  } catch (e) {
    if (e instanceof Error && !e.message.includes('fetch') && !e.message.includes('Failed')) throw e;
    throw new Error(formatApiError(e, backendUrl));
  }
}

async function postSimulatorVehicleAction(
  backendUrl: string,
  path: string,
  vehicleCode: string,
  errorLabel: string,
): Promise<{ vehicleCode: string; action: string }> {
  try {
    const res = await apiFetch(apiUrl(backendUrl, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleCode }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json() as { message?: string | string[] };
        const m = json.message;
        detail = Array.isArray(m) ? m.join(' ') : (m ?? '');
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new Error(detail || `${errorLabel} (${res.status})`);
    }
    return res.json() as Promise<{ vehicleCode: string; action: string }>;
  } catch (e) {
    if (e instanceof Error && !e.message.includes('fetch') && !e.message.includes('Failed')) throw e;
    throw new Error(formatApiError(e, backendUrl));
  }
}

export async function clearDemoVehicleFault(
  backendUrl: string,
  vehicleCode: string,
): Promise<{ vehicleCode: string; action: string }> {
  return postSimulatorVehicleAction(backendUrl, '/clear-fault', vehicleCode, '無法清除故障');
}

export async function simulateDemoVehicleObstacle(
  backendUrl: string,
  vehicleCode: string,
): Promise<{ vehicleCode: string; action: string }> {
  return postSimulatorVehicleAction(backendUrl, '/simulate-obstacle', vehicleCode, '無法模擬障礙物事件');
}
