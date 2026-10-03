/**
 * 車隊 MQTT 訊息「還算不算有效」。
 *
 * <h3>為什麼不能看 Socket 有沒有連線</h3>
 * 連線好好的，車端也可能早就不送了；health/heartbeat 又是 retain，重新訂閱時 broker
 * 會立刻補送最後一則，不管那是一秒前還是三天前的。只要收過一則，原本的集中快取就
 * 永遠留著它——卡片、圖示一直顯示著早就不存在的任務。
 *
 * <h3>期限</h3>
 * 協議（《車端介接說明書》§四）規定 telemetry／operation／health 都是 1 Hz；後端判定失聯
 * 也是 5 秒（backend/src/common/vehicle-liveness.ts VEHICLE_OFFLINE_AFTER_MS_DEFAULT）。
 * 這裡沿用同一個數字：最後一次收到超過 5 秒，就不再當成有效資料。
 *
 * 訊息自帶 timestamp（Unix 毫秒）時另外檢查：比「這台車上次被重置的時間」早、或比收到
 * 當下早超過「期限＋時鐘誤差容許」，就是舊快照（retain 補送、重連後的舊訊息），不收。
 * 時間戳跟上一則一樣是 retain 重送，不刷新收到時間。
 */
export const FLEET_MQTT_STALE_AFTER_MS = 5_000;

/** 車端與瀏覽器時鐘不同步的容許量（只用在判斷「舊快照」，不影響 5 秒期限） */
export const FLEET_MQTT_CLOCK_SKEW_MS = 10_000;

/** 訊息自帶的時間（毫秒）；沒有或看不懂就是 null */
export function payloadTimestampMs(payload: Record<string, unknown>): number | null {
  const raw = payload.timestamp ?? payload.updated_at ?? payload.sim_timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export type FleetMessageVerdict =
  | { accept: true; timestamp: number | null }
  | { accept: false; reason: 'before-reset' | 'old-snapshot' | 'retained-duplicate' };

export function judgeFleetMessage(input: {
  payload: Record<string, unknown>;
  receivedAt: number;
  /** 這台車最近一次被重置的時間（沒有就是 0） */
  resetAt: number;
  /** 這台車這個串流上一次收下的訊息時間戳 */
  lastTimestamp: number | null;
}): FleetMessageVerdict {
  const timestamp = payloadTimestampMs(input.payload);
  if (timestamp !== null) {
    if (input.resetAt > 0 && timestamp < input.resetAt) return { accept: false, reason: 'before-reset' };
    if (input.receivedAt - timestamp > FLEET_MQTT_STALE_AFTER_MS + FLEET_MQTT_CLOCK_SKEW_MS) {
      return { accept: false, reason: 'old-snapshot' };
    }
    if (input.lastTimestamp !== null && timestamp === input.lastTimestamp) {
      return { accept: false, reason: 'retained-duplicate' };
    }
  }
  return { accept: true, timestamp };
}

export function isFleetEntryExpired(receivedAt: number | undefined, now: number): boolean {
  return receivedAt === undefined || now - receivedAt > FLEET_MQTT_STALE_AFTER_MS;
}
