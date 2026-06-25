import { acquireSocket } from '../elements/socketManager';
import { DEFAULT_DATASOURCE } from '../store/useDataSourceStore';

export type DatasourceInvalidatePayload = {
  tags: string[];
  at: number;
  reason?: string;
};

type Listener = (payload: DatasourceInvalidatePayload) => void;

const listeners = new Set<Listener>();
let socketHooked = false;

function ensureSocketSubscription(): void {
  if (socketHooked) return;
  const url = DEFAULT_DATASOURCE.backendUrl;
  const socket = acquireSocket(url);
  socket.on('datasource/invalidate', (payload: DatasourceInvalidatePayload) => {
    if (!payload?.tags?.length) return;
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
