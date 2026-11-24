import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery, ChevronDown, ChevronUp, LocateFixed, RefreshCw, Search } from 'lucide-react';
import type { VehicleSnapshotQuery } from './api';
import { resolveConnectionStatus } from './mergeVehicleState';
import { VehicleLocationDialog } from './VehicleLocationDialog';
import type { VehicleRealtimeItem } from './types';
import { useVehicleRealtime } from './useVehicleRealtime';
import { vehiclePhaseLabel } from './vehiclePhaseLabel';
import { Button, IconButton, Pagination, cn, fieldClass } from '../../components/ui';

const PAGE_SIZE = 10;

export function VehicleRealtimePage() {
  const { i18n } = useTranslation();
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
    <div className="flex h-full min-h-0 flex-col px-6 py-5 text-text-primary">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className={cn(fieldClass({ fullWidth: false }), 'flex w-[280px] items-center text-text-tertiary')}>
          <Search className="mr-2 size-4" /><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} placeholder="請輸入載具名稱" className="min-w-0 flex-1 bg-transparent text-body-s text-text-primary outline-none placeholder:text-text-quaternary" />
        </div>
        <IconButton label="搜尋" hierarchy="subordinate" variant="tonal" icon={<Search />} onPress={search} />
        <Button hierarchy="subordinate" variant="outlined" leadingIcon={<RefreshCw />} onPress={reset}>重置</Button>
      </div>

      {error ? <div className="mt-5 flex items-center justify-between rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis"><span>{error}</span><Button hierarchy="danger" variant="outlined" onPress={() => retry()}>重試</Button></div> : null}

      <div className="mt-6 min-h-0 flex-1 overflow-auto">
        <table className="t3-table w-full min-w-[1050px] table-fixed text-left text-body-s">
          <thead className="sticky top-0 z-10 bg-surface-primary text-text-quaternary">
            <tr className="border-b border-border-quaternary">
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
              const phase = vehiclePhaseLabel(item.operation?.payload.vehicle_phase, i18n.language);
              return <tr key={item.id} className="border-b border-border-quaternary hover:bg-link-standard">
                <td className="px-4 py-4 font-medium text-text-primary">{item.displayName}</td>
                <td className="px-4 py-4">{item.speedKph == null ? '—' : `${item.speedKph.toFixed(1)} km/h`}</td>
                <td className="px-4 py-4"><span className="inline-flex items-center gap-2"><Battery className={`size-4 ${item.batteryLevel != null && item.batteryLevel < 20 ? 'text-status-warning' : 'text-status-success'}`} />{item.batteryLevel == null ? '—' : `${Math.round(item.batteryLevel)}%`}</span></td>
                <td className="px-4 py-4 text-text-tertiary">未知</td>
                <td className="px-4 py-4"><Connection status={connection} /></td>
                <td className="px-4 py-4">{item.gear ?? '—'}</td>
                <td className="px-4 py-4">{phase ?? (i18n.language.startsWith('en') ? (item.speedKph == null ? 'Unknown' : item.speedKph === 0 ? 'Stopped' : 'Moving') : (item.speedKph == null ? '未知' : item.speedKph === 0 ? '停止' : '移動'))}</td>
                <td className="px-4 py-4 text-center"><IconButton label={`定位 ${item.displayName}`} hierarchy="subordinate" variant="standard" icon={<LocateFixed />} onPress={() => setSelectedCode(item.vehicleCode)} /></td>
              </tr>;
            })}
          </tbody>
        </table>
        {loading && !response ? <div className="flex h-48 items-center justify-center text-text-quaternary">載入載具快照…</div> : null}
        {!loading && !error && response?.items.length === 0 ? <div className="flex h-48 items-center justify-center text-text-quaternary">沒有符合條件的載具</div> : null}
      </div>

      {response ? <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border-quaternary pt-4 text-body-s text-text-tertiary"><Pagination page={response.pagination.page} total={response.pagination.total} pageSize={PAGE_SIZE} onChange={setPage} /><span>共 {response.pagination.total} 輛</span></div> : null}

      {selected ? <VehicleLocationDialog item={{ ...selected, connectionStatus: resolveConnectionStatus(selected, now, fleet?.offlineAfterMs ?? response?.offlineAfterMs ?? 5000) }} fleet={fleet?.items ?? response?.items ?? []} onClose={() => setSelectedCode(null)} /> : null}
    </div>
  );
}

function Sortable({ label, active, direction, onClick }: { label: string; active: boolean; direction: 'asc' | 'desc'; onClick: () => void }) {
  return <th className="px-4 py-4 font-normal"><Button hierarchy="subordinate" variant="text" onPress={onClick} trailingIcon={active ? direction === 'asc' ? <ChevronUp /> : <ChevronDown /> : undefined}>{label}</Button></th>;
}

function Connection({ status }: { status: VehicleRealtimeItem['connectionStatus'] }) {
  const text = status === 'ONLINE' ? '在線' : status === 'NO_DATA' ? '尚無資料' : '離線';
  const classes = status === 'ONLINE' ? 'bg-status-success-light text-status-success' : status === 'NO_DATA' ? 'bg-surface-secondary text-text-tertiary' : 'bg-surface-secondary text-text-secondary';
  return <span className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${classes}`}><span className={`size-1.5 rounded-full ${status === 'ONLINE' ? 'bg-status-success' : 'bg-status-inactive'}`} />{text}</span>;
}
