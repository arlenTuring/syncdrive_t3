import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../dashboard/elements/socketManager';
import { DEFAULT_DATASOURCE } from '../dashboard/store/useDataSourceStore';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { LiveEventsPage } from './LiveEventsPage';

/** 即時事件清單入口：Socket 與 invalidation 只在這裡訂閱，有新事件或別人回報時重查目前這一頁。 */
export function EventManagementPage() {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const coalesce = useRef<number | null>(null);
  const refresh = useCallback(() => {
    if (coalesce.current !== null) return;
    coalesce.current = window.setTimeout(() => {
      coalesce.current = null;
      setRefreshSignal((value) => value + 1);
    }, 250);
  }, []);

  useEffect(() => {
    const url = DEFAULT_DATASOURCE.backendUrl;
    const socket = acquireSocket(url);
    socket.on('security_event', refresh);
    socket.io.on('reconnect', refresh);
    const unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes('table:security_event_log')) refresh();
    });
    const fallback = window.setInterval(refresh, 30_000);
    return () => {
      window.clearInterval(fallback);
      if (coalesce.current !== null) window.clearTimeout(coalesce.current);
      socket.off('security_event', refresh);
      socket.io.off('reconnect', refresh);
      releaseSocket(url);
      unsubscribe();
    };
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col p-5 text-zinc-100">
      <LiveEventsPage refreshSignal={refreshSignal} onChanged={refresh} />
    </div>
  );
}
