import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusTag } from '../../../components/StatusTag';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { fetchShiftRecordDetail, type ShiftRecordDetail } from '../api/shiftRecordsApi';
import { EXECUTION_TAG_STYLE, executionDisplayKey } from '../types';

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
  const { t } = useTranslation();
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
      if (payload.tags.some((tag) => tag === 'table:operation_orders' || tag.includes('operation'))) {
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
            {t('shiftRecords.detail.backToList')}
          </button>
          <h1 className="text-lg font-semibold">{t('shiftRecords.detail.title')}</h1>
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
          {t('common.refresh')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <Loader2 className="size-5 animate-spin" />
            {t('common.loading')}
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
              <InfoCell label={t('shiftRecords.columns.tripCode')} value={detail.trip_code} />
              <InfoCell label={t('shiftRecords.detail.orderId')} value={detail.order_id} mono />
              <InfoCell label={t('shiftRecords.columns.vehicle')} value={detail.vehicle_code} />
              <InfoCell
                label={t('shiftRecords.columns.executionStatus')}
                value={
                  <StatusTag
                    label={detail.execution_status_label}
                    style={EXECUTION_TAG_STYLE[executionDisplayKey(detail)]}
                  />
                }
              />
              <InfoCell label={t('shiftRecords.columns.route')} value={detail.route_label} />
              <InfoCell
                label={t('shiftRecords.detail.vehiclePhase')}
                value={String(detail.vehicle_phase ?? '—')}
              />
              <InfoCell
                label={t('shiftRecords.columns.departTime')}
                value={detail.depart_time ?? '—'}
                mono
              />
              <InfoCell
                label={t('shiftRecords.columns.endTime')}
                value={detail.end_time ?? ''}
                mono
              />
              <InfoCell
                label={t('shiftRecords.detail.delayMinutes')}
                value={detail.delay_minutes > 0 ? String(detail.delay_minutes) : '0'}
              />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">
                {t('shiftRecords.detail.currentLeg')}
              </h2>
              <JsonBlock value={detail.current_leg} />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">
                {t('shiftRecords.detail.taskGroup')}
              </h2>
              {detail.task_group.length === 0 ? (
                <p className="text-sm text-zinc-500">{t('shiftRecords.detail.noTaskGroup')}</p>
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
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">
                {t('shiftRecords.detail.stationActions')}
              </h2>
              {detail.actions.length === 0 ? (
                <p className="text-sm text-zinc-500">{t('shiftRecords.detail.noStationActions')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-zinc-900/80 text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('shiftRecords.detail.colStation')}</th>
                        <th className="px-3 py-2 font-medium">{t('shiftRecords.detail.colAction')}</th>
                        <th className="px-3 py-2 font-medium">{t('shiftRecords.detail.colStatus')}</th>
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
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">
                {t('shiftRecords.detail.rawPayload')}
              </h2>
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
