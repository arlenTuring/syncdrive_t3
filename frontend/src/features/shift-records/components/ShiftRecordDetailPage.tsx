import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { StatusTag } from '../../../components/StatusTag';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { fetchShiftRecordDetail, type ShiftRecordDetail } from '../api/shiftRecordsApi';
import { EXECUTION_TAG_STYLE } from '../types';

type ShiftRecordDetailPageProps = {
  orderId: string;
  onBack: () => void;
};

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) {
    return <span className="text-zinc-500">—</span>;
  }
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-xs text-zinc-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ShiftRecordDetailPage({ orderId, onBack }: ShiftRecordDetailPageProps) {
  const [detail, setDetail] = useState<ShiftRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShiftRecordDetail(orderId);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.some((t) => t === 'table:operation_orders' || t.includes('operation'))) {
        void load();
      }
    });
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            <ArrowLeft className="size-4" />
            返回列表
          </button>
          <h1 className="text-lg font-semibold">班次詳細監控</h1>
          {detail && (
            <span className="font-mono text-sm text-zinc-500">{detail.trip_code}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className="size-4" />
          重新整理
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <Loader2 className="size-5 animate-spin" />
            載入中…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {detail && !loading && (
          <div className="mx-auto max-w-5xl space-y-6">
            <section className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <InfoCell label="班次代號" value={detail.trip_code} />
              <InfoCell label="訂單編號" value={detail.order_id} mono />
              <InfoCell label="執行載具" value={detail.vehicle_code} />
              <InfoCell
                label="執行狀態"
                value={
                  <StatusTag
                    label={detail.execution_status_label}
                    style={EXECUTION_TAG_STYLE[detail.execution_status]}
                  />
                }
              />
              <InfoCell label="執行路線" value={detail.route_label} />
              <InfoCell label="車端階段" value={String(detail.vehicle_phase ?? '—')} />
              <InfoCell label="發車時間" value={detail.depart_time ?? '—'} mono />
              <InfoCell label="結束時間" value={detail.end_time ?? ''} mono />
              <InfoCell
                label="延誤（分）"
                value={detail.delay_minutes > 0 ? String(detail.delay_minutes) : '0'}
              />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">當前路段 current_leg</h2>
              <JsonBlock value={detail.current_leg} />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">微觀任務 task_group</h2>
              {detail.task_group.length === 0 ? (
                <p className="text-sm text-zinc-500">尚無 task_group 資料</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-zinc-900/80 text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">task_id</th>
                        <th className="px-3 py-2 font-medium">task_name</th>
                        <th className="px-3 py-2 font-medium">status</th>
                        <th className="px-3 py-2 font-medium">note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.task_group.map((task, idx) => (
                        <tr key={String(task.task_id ?? idx)} className="border-t border-zinc-800/80">
                          <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                            {String(task.task_id ?? '—')}
                          </td>
                          <td className="px-3 py-2 text-zinc-200">{String(task.task_name ?? '—')}</td>
                          <td className="px-3 py-2 text-zinc-300">{String(task.status ?? '—')}</td>
                          <td className="px-3 py-2 text-zinc-500">{String(task.note ?? '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">站點動作 order_action_states</h2>
              {detail.actions.length === 0 ? (
                <p className="text-sm text-zinc-500">尚無站點動作實例</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-zinc-900/80 text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">站點</th>
                        <th className="px-3 py-2 font-medium">動作</th>
                        <th className="px-3 py-2 font-medium">狀態</th>
                        <th className="px-3 py-2 font-medium">node_id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.actions.map((action) => (
                        <tr key={action.action_id} className="border-t border-zinc-800/80">
                          <td className="px-3 py-2 text-zinc-200">{action.station_id}</td>
                          <td className="px-3 py-2 text-zinc-300">{action.action_type}</td>
                          <td className="px-3 py-2 text-zinc-300">{action.action_status}</td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                            {action.node_id ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">訂單 payload（原始）</h2>
              <JsonBlock value={detail.payload} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-zinc-500">{label}</div>
      <div className={`text-sm text-zinc-100 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
