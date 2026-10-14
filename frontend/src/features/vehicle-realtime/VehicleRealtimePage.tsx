import { useEffect, useMemo, useState } from 'react';
import { Battery, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LocateFixed, RefreshCw, Search } from 'lucide-react';
import type { VehicleSnapshotQuery } from './api';
import { resolveConnectionStatus } from './mergeVehicleState';
import { VehicleLocationDialog } from './VehicleLocationDialog';
import type { VehicleRealtimeItem } from './types';
import { useVehicleRealtime } from './useVehicleRealtime';

const PAGE_SIZE = 10;

export function VehicleRealtimePage() {
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<VehicleSnapshotQuery['sortBy']>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const query = useMemo(() => ({ keyword, page, pageSize: PAGE_SIZE, sortBy, sortDirection }), [keyword, page, sortBy, sortDirection]);
  const { response, fleet, loading, error, retry } = useVehicleRealtime(query);
  const selected = fleet?.items.find((item) => item.vehicleCode === selectedCode) ?? response?.items.find((item) => item.vehicleCode === selectedCode) ?? null;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const search = () => { setKeyword(draft.trim()); setPage(1); };
  const reset = () => { setDraft(''); setKeyword(''); setPage(1); setSortBy('name'); setSortDirection('asc'); };
  const sort = (column: VehicleSnapshotQuery['sortBy']) => {
    if (sortBy === column) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc');
    else { setSortBy(column); setSortDirection('asc'); }
    setPage(1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-5 text-zinc-100">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex h-11 w-[280px] items-center rounded-lg bg-[#20252d] px-3 text-zinc-400">
          <Search className="mr-2 size-4" /><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} placeholder="請輸入載具名稱" className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500" />
        </div>
        <button type="button" onClick={search} className="flex size-11 items-center justify-center rounded-lg bg-[#20252d] text-zinc-300 hover:bg-zinc-700" aria-label="搜尋"><Search className="size-5" /></button>
        <button type="button" onClick={reset} className="flex h-11 items-center gap-2 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-400 hover:bg-white/5"><RefreshCw className="size-4" />重置</button>
      </div>

      {error ? <div className="mt-5 flex items-center justify-between rounded-lg border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-300"><span>{error}</span><button type="button" onClick={() => retry()} className="rounded border border-red-700 px-3 py-1">重試</button></div> : null}

      <div className="mt-6 min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1050px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[#15171b] text-zinc-500">
            <tr className="border-b border-zinc-800">
              <Sortable label="載具名稱" active={sortBy === 'name'} direction={sortDirection} onClick={() => sort('name')} />
              <Sortable label="行駛速度" active={sortBy === 'speed'} direction={sortDirection} onClick={() => sort('speed')} />
              <Sortable label="電池電量" active={sortBy === 'battery'} direction={sortDirection} onClick={() => sort('battery')} />
              <th className="px-4 py-4 font-normal">駕駛狀態</th>
              <Sortable label="連線狀態" active={sortBy === 'connection'} direction={sortDirection} onClick={() => sort('connection')} />
              <Sortable label="檔位" active={sortBy === 'gear'} direction={sortDirection} onClick={() => sort('gear')} />
              <th className="px-4 py-4 font-normal">運動狀態</th>
              <th className="w-20 px-4 py-4 text-center font-normal">定位</th>
            </tr>
          </thead>
          <tbody>
            {response?.items.map((item) => {
              const connection = resolveConnectionStatus(item, now, response.offlineAfterMs);
              const phase = typeof item.operation?.payload.vehicle_phase === 'string' ? item.operation.payload.vehicle_phase : null;
              return <tr key={item.id} className="border-b border-zinc-800/80 hover:bg-white/[0.025]">
                <td className="px-4 py-4 font-medium text-zinc-200">{item.displayName}</td>
                <td className="px-4 py-4">{item.speedKph == null ? '—' : `${item.speedKph.toFixed(1)} km/h`}</td>
                <td className="px-4 py-4"><span className="inline-flex items-center gap-2"><Battery className={`size-4 ${item.batteryLevel != null && item.batteryLevel < 20 ? 'text-amber-400' : 'text-emerald-400'}`} />{item.batteryLevel == null ? '—' : `${Math.round(item.batteryLevel)}%`}</span></td>
                <td className="px-4 py-4 text-zinc-400">未知</td>
                <td className="px-4 py-4"><Connection status={connection} /></td>
                <td className="px-4 py-4">{item.gear ?? '—'}</td>
                <td className="px-4 py-4">{phase ?? (item.speedKph == null ? '未知' : item.speedKph === 0 ? '停止' : '移動')}</td>
                <td className="px-4 py-4 text-center"><button type="button" onClick={() => setSelectedCode(item.vehicleCode)} className="rounded-lg p-2 text-zinc-300 hover:bg-sky-500/15 hover:text-sky-300" aria-label={`定位 ${item.displayName}`}><LocateFixed className="size-5" /></button></td>
              </tr>;
            })}
          </tbody>
        </table>
        {loading && !response ? <div className="flex h-48 items-center justify-center text-zinc-500">載入載具快照…</div> : null}
        {!loading && !error && response?.items.length === 0 ? <div className="flex h-48 items-center justify-center text-zinc-500">沒有符合條件的載具</div> : null}
      </div>

      {response ? <div className="flex shrink-0 items-center justify-center gap-3 border-t border-zinc-800 pt-4 text-sm text-zinc-400"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded p-1 disabled:opacity-30"><ChevronLeft className="size-4" /></button><span className="rounded-md border border-sky-500 px-2.5 py-1 text-sky-300">{response.pagination.page}</span><span>/ {response.pagination.totalPages}（共 {response.pagination.total} 輛）</span><button type="button" disabled={page >= response.pagination.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded p-1 disabled:opacity-30"><ChevronRight className="size-4" /></button></div> : null}

      {selected ? <VehicleLocationDialog item={{ ...selected, connectionStatus: resolveConnectionStatus(selected, now, fleet?.offlineAfterMs ?? response?.offlineAfterMs ?? 5000) }} fleet={fleet?.items ?? response?.items ?? []} onClose={() => setSelectedCode(null)} /> : null}
    </div>
  );
}

function Sortable({ label, active, direction, onClick }: { label: string; active: boolean; direction: 'asc' | 'desc'; onClick: () => void }) {
  return <th className="px-4 py-4 font-normal"><button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-zinc-200">{label}{active ? direction === 'asc' ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" /> : null}</button></th>;
}

function Connection({ status }: { status: VehicleRealtimeItem['connectionStatus'] }) {
  const text = status === 'ONLINE' ? '在線' : status === 'NO_DATA' ? '尚無資料' : '離線';
  const classes = status === 'ONLINE' ? 'bg-emerald-950 text-emerald-300' : status === 'NO_DATA' ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-800 text-zinc-300';
  return <span className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${classes}`}><span className={`size-1.5 rounded-full ${status === 'ONLINE' ? 'bg-emerald-400' : 'bg-zinc-500'}`} />{text}</span>;
}
