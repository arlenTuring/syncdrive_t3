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
import { Badge, Button } from '../../../components/ui';
import { useAuth } from '../../access-control/AuthContext';

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
  /** 今天最新一筆嚴重事件；沒有就是 null */
  event: MajorEventData | null;
  /** 即時調度引擎目前有沒有在自動下訂單；null 表示還沒拉到、狀態未知 */
  dispatchEnabled: boolean | null;
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const { t } = useTranslation();
  const canAdjust = useAuth().can('operations.shift-deployment.adjust');

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
          {/* 權限表「班表部署 → 調整申請」 */}
          {canAdjust ? <Button variant="outlined" onPress={() => onAction({ kind: 'schedule-adjust' })}>{t('shiftDeployment.summary.scheduleAdjust')}</Button> : null}
        </div>
        {/*
          * 照設計稿：一個內框，左邊綠色直線＋班表資訊、右上狀態標籤；分隔線下是三個時段。
          * 部署開關只留一顆按鈕，放在狀態標籤下面（按鈕文字本身就說明目前狀態）。
          */}
        <div className="mt-3 flex flex-1 flex-col rounded-xl bg-surface-primary p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span
                className={`w-1 shrink-0 self-stretch rounded-full ${
                  schedule.pending ? 'bg-status-warning' : 'bg-status-success'
                }`}
              />
              <div className="min-w-0">
                <p className="text-body-s text-text-tertiary">{schedule.scheduleMeta}</p>
                <p className="mt-0.5 truncate text-headline-4 text-text-primary">{schedule.scheduleName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-body-m text-text-primary">
                  <span className="text-text-tertiary">{t('shiftDeployment.summary.reviewer')}</span>
                  <User className="size-4 shrink-0 text-text-primary" />
                  {schedule.reviewerName}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Badge size="md" dot tone={schedule.pending ? 'warning' : 'success'}>
                {schedule.statusLabel}
              </Badge>
              <DispatchToggle dispatchEnabled={dispatchEnabled} onAction={onAction} />
            </div>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-border-quaternary pt-3">
            {schedule.periods.map((period, index) => (
              <div key={period} className="flex items-center gap-2 text-body-m text-text-tertiary">
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
        {event ? <button
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
        </button> : null}
        <div className="mt-2 flex flex-1 items-center justify-center rounded-xl bg-surface-primary text-body-s text-text-quaternary">
          {event ? t('shiftDeployment.summary.noMoreEvents') : '今天沒有重大事件'}
        </div>
      </section>
    </div>
  );
}

/**
 * 即時調度引擎的部署開關：暫停／開始自動下訂單。
 *
 * 要在地端拿模擬器測試時，得先讓真實班表停下來，不然調度引擎跟模擬器手動
 * 建的測試單會搶同一批車。暫停不影響已經在跑的訂單，車輛照樣把手上這一趟
 * 開完，只是不會再收到下一張——真的要清空車隊還是得等在跑的訂單自然結束，
 * 或另外用取消。
 *
 * 一顆按鈕切換：暫停中時「開始部署」是主要動作（藍色實心）；調度中時「暫停部署」是
 * 次要動作（灰色淡底）。狀態讀不到時不給按，免得按了不知道結果。
 */
function DispatchToggle({
  dispatchEnabled,
  onAction,
}: {
  dispatchEnabled: boolean | null;
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const { t } = useTranslation();
  // 權限表「班表部署 → 部署／啟用」：沒有就不給暫停／開始部署（後端同一個權限擋）
  if (!useAuth().can('operations.shift-deployment.deploy')) return null;
  return dispatchEnabled === true
    ? (
      <Button hierarchy="subordinate" variant="tonal" leadingIcon={<Pause />} className="whitespace-nowrap" onPress={() => onAction({ kind: 'dispatch-pause' })}>
        {t('shiftDeployment.dispatch.pause')}
      </Button>
    )
    : (
      <Button hierarchy="superior" variant="filled" leadingIcon={<Play />} className="whitespace-nowrap" onPress={() => onAction({ kind: 'dispatch-start' })} disabled={dispatchEnabled === null}>
        {t('shiftDeployment.dispatch.start')}
      </Button>
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
