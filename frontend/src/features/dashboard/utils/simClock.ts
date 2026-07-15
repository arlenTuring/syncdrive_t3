/** 從 MQTT payload 讀取模擬時鐘（毫秒） */
export function readSimElapsedMs(payload: Record<string, unknown> | null | undefined): number | undefined {
  if (!payload) return undefined;
  const direct = Number(payload.sim_elapsed_ms);
  if (Number.isFinite(direct)) return direct;
  const ts = Number(payload.sim_timestamp);
  const start = Number(payload.sim_start_ms);
  if (Number.isFinite(ts) && Number.isFinite(start)) return ts - start;
  return undefined;
}

export function readPayloadWallMs(payload: Record<string, unknown> | null | undefined): number {
  if (!payload) return Date.now();
  const ts = Number(payload.timestamp);
  return Number.isFinite(ts) ? ts : Date.now();
}

/**
 * 影片加速式模擬時鐘：在兩筆 MQTT 之間依倍速連續推進模擬毫秒。
 * playing=false 時凍結在最新樣本。
 */
export function extrapolateSimElapsedMs(
  payload: Record<string, unknown> | null | undefined,
  speedMultiplier: number,
  playing: boolean,
  /** MQTT 收到當下的牆鐘；payload.timestamp 若為場域時間必須傳此值 */
  recvWallMs?: number,
): number | undefined {
  const base = readSimElapsedMs(payload);
  if (base === undefined) return undefined;
  if (!playing || speedMultiplier <= 0) return base;
  const recvWall = recvWallMs ?? readPayloadWallMs(payload);
  const wallDelta = Math.max(0, Date.now() - recvWall);
  return base + wallDelta * speedMultiplier;
}

/** 連續倒數：eta 隨模擬時鐘流逝而減少（非整秒跳格） */
export function extrapolateLegEtaSeconds(
  payload: Record<string, unknown> | null | undefined,
  speedMultiplier: number,
  playing: boolean,
): number | undefined {
  if (!payload?.current_leg || typeof payload.current_leg !== 'object') return undefined;
  const leg = payload.current_leg as { eta_seconds?: unknown };
  const baseEta = Number(leg.eta_seconds);
  if (!Number.isFinite(baseEta)) return undefined;
  if (!playing || speedMultiplier <= 0) return Math.max(0, baseEta);
  const recvWall = readPayloadWallMs(payload);
  const elapsedSimSec = (Math.max(0, Date.now() - recvWall) * speedMultiplier) / 1000;
  return Math.max(0, baseEta - elapsedSimSec);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 弧度最短弧插值 */
export function lerpAngleRad(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}

export function readLegSnapKey(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const trip = String(payload.trip_code ?? payload.badge_label ?? '').trim();
  const target =
    payload.current_leg && typeof payload.current_leg === 'object'
      ? String((payload.current_leg as { target_station_id?: unknown }).target_station_id ?? '').trim()
      : '';
  // 不含 segment_label：行進中軌道代碼會隨座標變，不應中斷 lerp／瞬移
  return `${trip}|${target}`;
}
