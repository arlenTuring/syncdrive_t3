import { acquireSocket } from '../elements/socketManager';
import { DEFAULT_DATASOURCE, clearDatasourceQueryCacheForTags } from '../store/useDataSourceStore';

export type DatasourceInvalidatePayload = {
  tags: string[];
  at: number;
  reason?: string;
};

/**
 * 一般資料更新（車輛位置、訂單進度、事件、格位、排程到點）：資料只是往前走，
 * 在途查詢晚回來的結果仍可先顯示，再由補查換成最新的。這些每秒可能好幾則。
 *
 * 其餘原因（測試重置、資料管理寫入、營運時鐘換段、沒有標原因的舊通知）一律當硬邊界：
 * 可能是刪除／清空／換重播 run，邊界之前送出的查詢結果不能回來把舊資料補回去。
 */
const SOFT_INVALIDATION_REASONS = new Set([
  'order_lifecycle',
  'vehicle_position',
  'security_event',
  'slot_status',
  'daily_plan',
  'scheduled_order_created',
  'scheduled_order_published',
  'media_schedule_due',
]);

export function isSoftInvalidation(payload: Pick<DatasourceInvalidatePayload, 'reason'>): boolean {
  return Boolean(payload.reason && SOFT_INVALIDATION_REASONS.has(payload.reason));
}

type Listener = (payload: DatasourceInvalidatePayload) => void;

const listeners = new Set<Listener>();
let socketHooked = false;

function ensureSocketSubscription(): void {
  if (socketHooked) return;
  const url = DEFAULT_DATASOURCE.backendUrl;
  const socket = acquireSocket(url);
  socket.on('datasource/invalidate', (payload: DatasourceInvalidatePayload) => {
    if (!payload?.tags?.length) return;
    // 先作廢共用快取與進行中的查詢，各元件接著重查時才不會拿到失效前的結果
    clearDatasourceQueryCacheForTags(payload.tags);
    listeners.forEach((fn) => fn(payload));
  });
  socketHooked = true;
}

/** 訂閱後端寫庫後推送的 SQL 失效事件 */
export function subscribeDatasourceInvalidation(listener: Listener): () => void {
  ensureSocketSubscription();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
