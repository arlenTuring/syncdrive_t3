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
import { Button } from '../../../components/ui';

const PERIOD_DOTS = ['#A78BFA', '#22C55E', '#F97316'] as const;

const CARD = 'flex min-h-[210px] flex-col rounded-xl border border-border-quaternary bg-surface-popup p-3.5';

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
    // 設計稿四張卡寬度不同（目前模式 278、數據統計 388、執行班表 718、重大事件 374），照這個比例分；
    // 側欄展開時內容變窄，前、二、四張保留最低寬度（字不被擠斷），縮的是最寬的執行班表
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(12rem,278fr)_minmax(19rem,388fr)_minmax(0,718fr)_minmax(17rem,374fr)]">
      <section className={CARD}>
        <h2 className="text-body-m-bold text-text-primary">
          {t('shiftDeployment.summary.currentMode')}
        </h2>
        <div className="mt-3 flex flex-1 items-center justify-center rounded-xl bg-[#1B4332] px-4 py-8 text-center">
          <div>
            <div className="whitespace-nowrap text-headline-2 text-text-primary">{mode.modeLabel}</div>
            <div className="mt-1 text-body-s text-white-80">{mode.modeLevel}</div>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-body-m-bold text-text-primary">
            {t('shiftDeployment.summary.dataStats')}
          </h2>
          <span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-body-xs text-text-primary">
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
              <span className="flex-1 rounded-full bg-surface-secondary py-1 text-center text-body-xs text-text-primary">
                {t('shiftDeployment.summary.total', { count: stats.totalCount })}
              </span>
              <span className="flex-1 rounded-full bg-surface-secondary py-1 text-center text-body-xs text-text-primary">
                {t('shiftDeployment.summary.completed', { count: stats.completedCount })}
              </span>
            </div>
          </div>
          <div className="w-px bg-link-standard-hover" />
          <div className="flex flex-1 flex-col justify-center gap-3 text-body-s">
            <StatRow
              icon={<Clock className="size-4 text-text-tertiary" />}
              label={t('shiftDeployment.summary.delayed')}
              value={stats.delayedCount}
            />
            <StatRow
              icon={<AlertTriangle className="size-4 text-text-tertiary" />}
              label={t('shiftDeployment.summary.abnormal')}
              value={stats.abnormalCount}
            />
            <StatRow
              icon={<CircleX className="size-4 text-text-tertiary" />}
              label={t('shiftDeployment.summary.cancelled')}
              value={stats.cancelledCount}
            />
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-body-m-bold text-text-primary">
            {t('shiftDeployment.summary.executingSchedule')}
          </h2>
          <Button variant="outlined" onPress={() => onAction({ kind: 'schedule-adjust' })}>{t('shiftDeployment.summary.scheduleAdjust')}</Button>
        </div>
        <DispatchControlPanel dispatchEnabled={dispatchEnabled} onAction={onAction} />
        <div className="mt-3 flex flex-1 flex-col rounded-xl bg-surface-primary p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-xs text-text-tertiary">{schedule.scheduleMeta}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-body-xs ${
                schedule.pending
                  ? 'bg-status-warning-light text-status-warning'
                  : 'bg-status-success-light text-status-success'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  schedule.pending ? 'bg-status-warning' : 'bg-status-success'
                }`}
              />
              {schedule.statusLabel}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-5 w-0.5 rounded-full ${
                schedule.pending ? 'bg-status-warning' : 'bg-status-success'
              }`}
            />
            <span className="text-headline-5 text-text-primary">{schedule.scheduleName}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-body-xs text-text-secondary">
            <span className="text-text-quaternary">{t('shiftDeployment.summary.reviewer')}</span>
            <User className="size-3.5 text-text-quaternary" />
            {schedule.reviewerName}
          </div>
          <div className="mt-2 space-y-1 border-t border-border-quaternary pt-2">
            {schedule.periods.map((period, index) => (
              <div key={period} className="flex items-center gap-2 text-body-xs text-text-tertiary">
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
        <h2 className="text-body-m-bold text-text-primary">
          {t('shiftDeployment.summary.majorEvent')}
        </h2>
        <button
          type="button"
          onClick={() => onAction({ kind: 'event-open' })}
          className="mt-3 flex items-start gap-3 rounded-xl border border-border-danger-light bg-status-error-light p-3 text-left transition hover:bg-status-error-light"
        >
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-status-error-emphasis" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-text-primary">{event.title}</span>
              <span className="shrink-0 text-body-xs text-text-tertiary">{event.date}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <span className="text-body-xs text-text-tertiary">{event.level}</span>
              <span className="shrink-0 text-body-xs text-text-tertiary">{event.time}</span>
            </div>
          </div>
        </button>
        <div className="mt-2 flex flex-1 items-center justify-center rounded-xl bg-surface-primary text-body-s text-text-quaternary">
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
    ? 'bg-status-inactive'
    : dispatchEnabled
      ? 'bg-status-success'
      : 'bg-status-warning';

  /*
   * 一顆按鈕切換部署與暫停：暫停中時「開始部署」是這張卡唯一要做的事（主要、藍色實心）；
   * 調度中時「暫停部署」是次要動作（灰色淡底）。狀態讀不到時不給按，免得按了不知道結果。
   * 先前兩顆按鈕並排塞在窄卡裡，字被擠成直排。
   */
  const toggle = dispatchEnabled === true
    ? (
      <Button hierarchy="subordinate" variant="tonal" leadingIcon={<Pause />} className="shrink-0 whitespace-nowrap" onPress={() => onAction({ kind: 'dispatch-pause' })}>
        {t('shiftDeployment.dispatch.pause')}
      </Button>
    )
    : (
      <Button hierarchy="superior" variant="filled" leadingIcon={<Play />} className="shrink-0 whitespace-nowrap" onPress={() => onAction({ kind: 'dispatch-start' })} disabled={dispatchEnabled === null}>
        {t('shiftDeployment.dispatch.start')}
      </Button>
    );

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-primary px-3 py-2">
      {/* 狀態要看得到：卡片窄時名稱可以換行，不截掉後面的「已暫停／調度中」 */}
      <div className="min-w-0">
        <p className="text-caption-1 text-text-tertiary">{t('shiftDeployment.dispatch.label')}</p>
        <p className="flex items-center gap-1.5 text-body-s text-text-primary">
          <span className={`size-1.5 shrink-0 rounded-full ${dotColor}`} />
          {statusLabel}
        </p>
      </div>
      {toggle}
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
      <span className="flex items-center gap-2 text-text-tertiary">
        {icon}
        {label}
      </span>
      <span className="text-headline-4 text-text-primary">{value}</span>
    </div>
  );
}
