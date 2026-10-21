import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { acquireSocket, releaseSocket } from '../dashboard/elements/socketManager';
import { DEFAULT_DATASOURCE } from '../dashboard/store/useDataSourceStore';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { HistoryEventsPage } from './HistoryEventsPage';
import { LiveEventsPage } from './LiveEventsPage';

export type EventTab = 'pending' | 'confirmed' | 'history';

/** 單一事件入口：共用一份 Socket／invalidation，三個標籤保留各自的畫面狀態。 */
export function EventManagementPage({ initialTab = 'pending' }: { initialTab?: EventTab }) {
  const [tab, setTab] = useState<EventTab>(initialTab);
  const [totals, setTotals] = useState({ pending: null as number | null, confirmed: null as number | null });
  const [refreshSignal, setRefreshSignal] = useState(0);
  const coalesce = useRef<number | null>(null);
  const tabs: Array<{ id: EventTab; label: string }> = [
    { id: 'pending', label: '待確認' },
    { id: 'confirmed', label: '已確認' },
    { id: 'history', label: '歷史事件查詢' },
  ];
  const updateTotals = useCallback((pending: number, confirmed: number) => setTotals({ pending, confirmed }), []);
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

  const selectWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex((item) => item.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[next].id;
    setTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`event-tab-${nextTab}`)?.focus());
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-5 text-zinc-100">
      <div role="tablist" aria-label="事件管理清單" onKeyDown={selectWithKeyboard} className="mb-4 flex gap-1 border-b border-zinc-800">
        {tabs.map((item) => {
          const count = item.id === 'pending' ? totals.pending : item.id === 'confirmed' ? totals.confirmed : null;
          return <button id={`event-tab-${item.id}`} key={item.id} type="button" role="tab" aria-controls={`event-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} className={`border-b-2 px-5 py-3 text-sm transition ${tab === item.id ? 'border-sky-400 text-sky-300' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}>{item.label}{count !== null ? <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs">{count}</span> : null}</button>;
        })}
      </div>
      <div id="event-panel-pending" role="tabpanel" aria-labelledby="event-tab-pending" className={tab === 'pending' ? 'flex min-h-0 flex-1' : 'hidden'}><LiveEventsPage bucket="pending" active={tab === 'pending'} refreshSignal={refreshSignal} onTotals={updateTotals} onChanged={refresh} /></div>
      <div id="event-panel-confirmed" role="tabpanel" aria-labelledby="event-tab-confirmed" className={tab === 'confirmed' ? 'flex min-h-0 flex-1' : 'hidden'}><LiveEventsPage bucket="confirmed" active={tab === 'confirmed'} refreshSignal={refreshSignal} onTotals={updateTotals} onChanged={refresh} /></div>
      <div id="event-panel-history" role="tabpanel" aria-labelledby="event-tab-history" className={tab === 'history' ? 'flex min-h-0 flex-1' : 'hidden'}><HistoryEventsPage refreshSignal={refreshSignal} /></div>
    </div>
  );
}
