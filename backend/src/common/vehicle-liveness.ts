/**
 * 車輛失聯判定。
 *
 * <h3>為什麼不能用「有沒有收到訊息」判斷</h3>
 * <code>health/heartbeat</code> 的 retain 是 true：訂閱的當下 broker 會立刻把最後
 * 一則補送過來，不管那是一秒前還是三天前發的。所以「收得到就是活著」在這個通道上
 * 不成立，必須看<strong>最後一次收到是多久以前</strong>。
 *
 * <h3>門檻</h3>
 * 車端心跳 1 Hz（《車端介接說明書》§四）。五秒代表連掉四拍才判失聯——單則丟包、
 * 一次重連都不會誤判，而真的斷線最慢五秒就會反映在圖台上。
 *
 * <h3>OFFLINE 是誰的狀態</h3>
 * 車端只送 OK／WARNING／ERROR 三個值。OFFLINE 是<strong>中心端推導</strong>的第四個
 * 值：車自己說不出「我失聯了」，那句話只能由收不到它的人來說。
 */
export const VEHICLE_OFFLINE_AFTER_MS_DEFAULT = 5_000

/** 車端可以上報的 overall_health 值域（不含 OFFLINE） */
export const VEHICLE_REPORTED_HEALTH_VALUES = ['OK', 'WARNING', 'ERROR'] as const

/** 中心端推導的失聯值 */
export const VEHICLE_HEALTH_OFFLINE = 'OFFLINE'

export type VehicleLivenessMark = {
  /** 中心端收到那一則心跳的時刻（本機時鐘） */
  receivedAt: number
  /** 該則心跳自己帶的 timestamp，用來認出 retain 重送 */
  timestamp: string | null
}

/**
 * 這一則心跳算不算「活的一拍」。
 *
 * retain 重送的那一則，內容與上一次收到的完全相同——包括 timestamp。1 Hz 的即時
 * 串流不會重複同一個 timestamp，所以時間戳沒變就是重送，不能拿來刷新存活。
 *
 * 車端沒帶 timestamp 時無從比對，一律當成新的一拍；那是車端沒照規格送，不是失聯。
 */
export function isFreshHeartbeat(
  previous: VehicleLivenessMark | null,
  timestamp: string | null,
): boolean {
  if (!previous) return true
  if (timestamp === null || previous.timestamp === null) return true
  return timestamp !== previous.timestamp
}

export function isVehicleOffline(
  mark: VehicleLivenessMark | null,
  now: number,
  offlineAfterMs: number,
): boolean {
  if (!mark) return true
  return now - mark.receivedAt > offlineAfterMs
}

/**
 * 把推導出來的失聯狀態套進要送給前端的 health payload。
 *
 * 不改寫快取裡那一則——車端上報的內容要保持原樣以供稽核；失聯是我方的判讀，
 * 疊在輸出上。
 */
export type DerivedVehicleHealth = Record<string, unknown> & {
  overall_health: string
  offline: boolean
  last_seen_at: number | null
}

export function withDerivedOffline(
  health: Record<string, unknown> | null,
  offline: boolean,
  mark: VehicleLivenessMark | null,
): DerivedVehicleHealth | null {
  const lastSeenAt = mark?.receivedAt ?? null
  if (!health) {
    if (!offline) return null
    // 一次都沒收到過：沒有車端內容可以疊，只回報失聯本身
    return { overall_health: VEHICLE_HEALTH_OFFLINE, offline: true, last_seen_at: lastSeenAt }
  }
  const reported =
    typeof health.overall_health === 'string' ? health.overall_health : 'OK'
  return {
    ...health,
    overall_health: offline ? VEHICLE_HEALTH_OFFLINE : reported,
    offline,
    last_seen_at: lastSeenAt,
  }
}
