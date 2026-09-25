/**
 * 每台車<strong>最後一次收到新遙測</strong>的時刻。
 *
 * 圖台的車輛清單只在畫面上有變化時才重新發出（停著的車座標不變就不重畫），所以車輛物件上的
 * updatedAt 是「最後一次畫面有變化」，不是「最後一次收到資料」。停站的車用它判斷過期會誤報。
 * 這裡另外記收到的時刻，不觸發重畫；圖台每隔幾秒自己來讀。
 */
const lastSeen = new Map<string, number>();

export function markVehicleSeen(vehicleId: string, at = Date.now()): void {
  lastSeen.set(vehicleId, at);
}

export function vehicleLastSeenAt(vehicleId: string): number | undefined {
  return lastSeen.get(vehicleId);
}
