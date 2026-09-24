import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CircleX,
  Clock,
  Pause,
  Play,
  User,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  CurrentModeData,
  DataStatsData,
  ExecutingScheduleData,
  MajorEventData,
  ShiftDeploymentAction,
} from '../types';
import { RingProgress } from './RingProgress';

const PERIOD_DOTS = ['#A78BFA', '#22C55E', '#F97316'] as const;

const CARD = 'flex min-h-[210px] flex-col rounded-xl border border-zinc-800/80 bg-[#18181b] p-3.5';

export function SummaryCards({
  mode,
  stats,
  schedule,
  event,
  dispatchEnabled,
  onAction,
}: {
  mode: CurrentModeData;
  stats: DataStatsData;
  schedule: ExecutingScheduleData;
  event: MajorEventData;
  /** 即時調度引擎目前有沒有在自動下訂單；null 表示還沒拉到、狀態未知 */
  dispatchEnabled: boolean | null;
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <section className={CARD}>
        <h2 className="text-[15px] font-semibold text-zinc-100">
          {t('shiftDeployment.summary.currentMode')}
        </h2>
        <div className="mt-3 flex flex-1 items-center justify-center rounded-xl bg-[#1B4332] px-4 py-8 text-center">
          <div>
            <div className="text-[28px] font-bold leading-tight text-white">{mode.modeLabel}</div>
            <div className="mt-1 text-sm text-white/80">{mode.modeLevel}</div>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-zinc-100">
            {t('shiftDeployment.summary.dataStats')}
          </h2>
          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-200">
            {t('shiftDeployment.summary.ontimeRate', { pct: stats.ontimePct })}
          </span>
        </div>
        <div className="mt-3 flex min-h-0 flex-1 gap-3">
          <div className="flex w-[46%] shrink-0 flex-col items-center">
            <RingProgress
              value={stats.achievementPct}
              caption={t('shiftDeployment.summary.achievement')}
            />
            <div className="mt-2 flex w-full gap-1.5">
              <span className="flex-1 rounded-full bg-zinc-800 py-1 text-center text-[11px] text-zinc-200">
                {t('shiftDeployment.summary.total', { count: stats.totalCount })}
              </span>
              <span className="flex-1 rounded-full bg-zinc-800 py-1 text-center text-[11px] text-zinc-200">
                {t('shiftDeployment.summary.completed', { count: stats.completedCount })}
              </span>
            </div>
          </div>
          <div className="w-px bg-white/10" />
          <div className="flex flex-1 flex-col justify-center gap-3 text-sm">
            <StatRow
              icon={<Clock className="size-4 text-zinc-400" />}
              label={t('shiftDeployment.summary.delayed')}
              value={stats.delayedCount}
            />
            <StatRow
              icon={<AlertTriangle className="size-4 text-zinc-400" />}
              label={t('shiftDeployment.summary.abnormal')}
              value={stats.abnormalCount}
            />
            <StatRow
              icon={<CircleX className="size-4 text-zinc-400" />}
              label={t('shiftDeployment.summary.cancelled')}
              value={stats.cancelledCount}
            />
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-zinc-100">
            {t('shiftDeployment.summary.executingSchedule')}
          </h2>
          <button
            type="button"
            onClick={() => onAction({ kind: 'schedule-adjust' })}
            className="rounded-lg border border-sky-500 px-2.5 py-1 text-[11px] text-sky-400 transition hover:bg-sky-500/10"
          >
            {t('shiftDeployment.summary.scheduleAdjust')}
          </button>
        </div>
        <DispatchControlPanel dispatchEnabled={dispatchEnabled} onAction={onAction} />
        <div className="mt-3 flex flex-1 flex-col rounded-xl bg-[#212124] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400">{schedule.scheduleMeta}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                schedule.pending
                  ? 'bg-orange-950 text-orange-300'
                  : 'bg-emerald-900 text-emerald-300'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  schedule.pending ? 'bg-orange-400' : 'bg-emerald-400'
                }`}
              />
              {schedule.statusLabel}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-5 w-0.5 rounded-full ${
                schedule.pending ? 'bg-orange-400' : 'bg-emerald-500'
              }`}
            />
            <span className="text-lg font-semibold text-zinc-50">{schedule.scheduleName}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-zinc-300">
            <span className="text-zinc-500">{t('shiftDeployment.summary.reviewer')}</span>
            <User className="size-3.5 text-zinc-500" />
            {schedule.reviewerName}
          </div>
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
            {schedule.periods.map((period, index) => (
              <div key={period} className="flex items-center gap-2 text-[11px] text-zinc-400">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PERIOD_DOTS[index] ?? '#71717A' }}
                />
                {period}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="text-[15px] font-semibold text-zinc-100">
          {t('shiftDeployment.summary.majorEvent')}
        </h2>
        <button
          type="button"
          onClick={() => onAction({ kind: 'event-open' })}
          className="mt-3 flex items-start gap-3 rounded-xl border border-red-400/80 bg-red-950/30 p-3 text-left transition hover:bg-red-950/50"
        >
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-zinc-50">{event.title}</span>
              <span className="shrink-0 text-[11px] text-zinc-400">{event.date}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <span className="text-[12px] text-zinc-400">{event.level}</span>
              <span className="shrink-0 text-[11px] text-zinc-400">{event.time}</span>
            </div>
          </div>
        </button>
        <div className="mt-2 flex flex-1 items-center justify-center rounded-xl bg-[#212124] text-[13px] text-zinc-500">
          {t('shiftDeployment.summary.noMoreEvents')}
        </div>
      </section>
    </div>
  );
}

/**
 * 即時調度引擎的小控制面板：暫停／開始自動下訂單。
 *
 * 要在地端拿模擬器測試時，得先讓真實班表停下來，不然調度引擎跟模擬器手動
 * 建的測試單會搶同一批車。暫停不影響已經在跑的訂單，車輛照樣把手上這一趟
 * 開完，只是不會再收到下一張——真的要清空車隊還是得等在跑的訂單自然結束，
 * 或另外用取消。
 */
function DispatchControlPanel({
  dispatchEnabled,
  onAction,
}: {
  dispatchEnabled: boolean | null;
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const { t } = useTranslation();
  const statusLabel = dispatchEnabled === null
    ? t('shiftDeployment.dispatch.unknown')
    : dispatchEnabled
      ? t('shiftDeployment.dispatch.running')
      : t('shiftDeployment.dispatch.paused');
  const dotColor = dispatchEnabled === null
    ? 'bg-zinc-500'
    : dispatchEnabled
      ? 'bg-emerald-400'
      : 'bg-orange-400';

  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-[#212124] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[12px] text-zinc-300">
        <span className={`size-1.5 rounded-full ${dotColor}`} />
        {t('shiftDeployment.dispatch.label')}：{statusLabel}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onAction({ kind: 'dispatch-pause' })}
          disabled={dispatchEnabled === false}
          className="flex items-center gap-1 rounded-md border border-orange-500 px-2 py-1 text-[11px] text-orange-400 transition hover:bg-orange-500/10 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
        >
          <Pause className="size-3" />
          {t('shiftDeployment.dispatch.pause')}
        </button>
        <button
          type="button"
          onClick={() => onAction({ kind: 'dispatch-start' })}
          disabled={dispatchEnabled === true}
          className="flex items-center gap-1 rounded-md border border-emerald-500 px-2 py-1 text-[11px] text-emerald-400 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600"
        >
          <Play className="size-3" />
          {t('shiftDeployment.dispatch.start')}
        </button>
      </div>
    </div>
  );
}

function StatRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-zinc-400">
        {icon}
        {label}
      </span>
      <span className="text-xl font-semibold text-zinc-50">{value}</span>
    </div>
  );
}
