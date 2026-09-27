import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AppliedSlackAdjustmentItem,
  ScheduleAnalysisReport,
  ScheduleAnalysisSuggestion,
} from '../utils/buildScheduleAnalysisReport';
import { formatScheduleClockHms } from '../utils/scheduleDayCycle';

function formatClock(minute: number): string {
  const total = Math.max(0, Math.round(minute));
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatVehicles(value: number | null): string {
  return value == null ? '—' : value.toFixed(1);
}

/** 過剩／不足的著色：只有偏離 1 台以上才上色，避免小數雜訊看起來像問題 */
function surplusClass(value: number | null): string {
  if (value == null) return 'text-zinc-500';
  if (value >= 1) return 'text-amber-300 font-semibold';
  if (value <= -1) return 'text-sky-300 font-semibold';
  return 'text-zinc-300';
}

const SUGGESTION_CODES: Array<ScheduleAnalysisSuggestion['code']> = [
  'FLEET_SHORTAGE',
  'FLEET_SURPLUS',
  'BERTH_OVERFLOW',
  'NO_ALTERNATIVE_BERTH',
];

const TH = 'px-2 py-1.5 text-left text-[11px] font-semibold text-zinc-400';
const TD = 'px-2 py-1.5 text-[11px] text-zinc-200 tabular-nums';

/**
 * 「已套用的緩衝調整」一筆。按鈕是原生 button，Tab 聚焦、Enter／Space 觸發都照原生行為。
 */
function AppliedSlackItem({
  item,
  onLocate,
  missing,
}: {
  item: AppliedSlackAdjustmentItem;
  onLocate?: (blockId: string) => void;
  missing: boolean;
}) {
  const { t } = useTranslation();
  const hms = formatScheduleClockHms;
  return (
    <li className="rounded border border-sky-800/50 bg-sky-950/25 px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[11px] leading-4 text-zinc-200">
          <span className="font-semibold tabular-nums text-sky-300">{item.tripCode}</span>
          <span className="ml-1.5 text-zinc-400">
            {t('shiftList.analysisReport.appliedSlack.row', { row: item.timelineRow })}
          </span>
          <span className="ml-1.5 tabular-nums text-zinc-400">
            {t('shiftList.analysisReport.appliedSlack.blockRange', {
              before: `${hms(item.blockBefore.startMinute)}–${hms(item.blockBefore.endMinute)}`,
              now: `${hms(item.blockStartMinute)}–${hms(item.blockEndMinute)}`,
            })}
          </span>
        </div>
        {onLocate ? (
          <button
            type="button"
            onClick={() => onLocate(item.blockId)}
            aria-label={t('shiftList.analysisReport.appliedSlack.locateAria', {
              code: item.tripCode,
              row: item.timelineRow,
            })}
            className="shrink-0 rounded border border-sky-700/60 px-1.5 py-0.5 text-[10px] text-sky-200 transition hover:bg-sky-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {t('shiftList.analysisReport.appliedSlack.locate')}
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] tabular-nums text-zinc-300">
        {t('shiftList.analysisReport.appliedSlack.slackBreakdown', {
          base: item.baseSlackSeconds,
          added: item.addedSeconds,
          effective: item.effectiveSlackSeconds,
        })}
      </p>
      <p className="text-[11px] text-zinc-400">
        {t('shiftList.analysisReport.appliedSlack.reason', { message: item.reasonMessage })}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {item.stops.map((stop) => (
          <li key={stop.order} className="border-l border-sky-800/60 pl-2 text-[10px] leading-4 tabular-nums text-zinc-300">
            {t('shiftList.analysisReport.appliedSlack.stopLine', {
              station: stop.stationName,
              base: stop.baseDwellSeconds,
              before: stop.dwellBeforeSeconds,
              now: stop.dwellNowSeconds,
              arriveBefore: hms(stop.arrivalBeforeMinute),
              arriveNow: hms(stop.arrivalNowMinute),
              departBefore: hms(stop.departureBeforeMinute),
              departNow: hms(stop.departureNowMinute),
            })}
          </li>
        ))}
      </ul>
      {missing ? (
        <p role="alert" className="mt-1 text-[11px] text-amber-300">
          {t('shiftList.analysisReport.appliedSlack.targetMissing', { code: item.tripCode })}
        </p>
      ) : null}
    </li>
  );
}

export function ScheduleAnalysisReportPanel({
  report,
  onClose,
  onLocateBlock,
  missingBlockId,
}: {
  report: ScheduleAnalysisReport;
  onClose: () => void;
  /** 點「查看班次」：用確切 blockId 定位，不靠解析班次名稱 */
  onLocateBlock?: (blockId: string) => void;
  /** 上一次定位找不到的卡片（班表改過了），在那一筆下面明確提示 */
  missingBlockId?: string | null;
}) {
  const { t } = useTranslation();
  const { fleet, berths, suggestions, summary, appliedSlackAdjustments, appliedRetimes } = report;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-zinc-100">
            {t('shiftList.analysisReport.title')}
          </span>
          <span className="text-[11px] text-zinc-500">
            {t('shiftList.analysisReport.summary', {
              timelines: summary.timelineCount,
              trips: summary.totalTrips,
              hours: summary.revenueVehicleHours.toFixed(1),
            })}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          aria-label={t('shiftList.analysisReport.closeAria')}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <section className="mb-3" aria-labelledby="applied-slack-title">
          <h3 id="applied-slack-title" className="mb-1 text-xs font-semibold text-zinc-300">
            {t('shiftList.analysisReport.appliedSlack.title')}
            <span className="ml-1 font-normal text-zinc-500">
              {t('shiftList.analysisReport.itemCount', { count: appliedSlackAdjustments.length })}
            </span>
          </h3>
          {appliedSlackAdjustments.length === 0 ? (
            <p className="text-[11px] text-zinc-500">{t('shiftList.analysisReport.appliedSlack.none')}</p>
          ) : (
            <>
              <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
                {t('shiftList.analysisReport.appliedSlack.hint')}
              </p>
              <ul className="space-y-1.5">
                {appliedSlackAdjustments.map((item) => (
                  <AppliedSlackItem
                    key={item.blockId}
                    item={item}
                    onLocate={onLocateBlock}
                    missing={missingBlockId === item.blockId}
                  />
                ))}
              </ul>
            </>
          )}
        </section>

        {appliedRetimes.length > 0 ? (
          <section className="mb-3" aria-labelledby="applied-retime-title">
            <h3 id="applied-retime-title" className="mb-1 text-xs font-semibold text-zinc-300">
              {t('shiftList.analysisReport.appliedRetime.title')}
              <span className="ml-1 font-normal text-zinc-500">
                {t('shiftList.analysisReport.itemCount', { count: appliedRetimes.length })}
              </span>
            </h3>
            <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
              {t('shiftList.analysisReport.appliedRetime.hint')}
            </p>
            <ul className="space-y-1">
              {appliedRetimes.map((item) => (
                <li key={item.blockId} className="rounded border border-violet-800/50 bg-violet-950/20 px-2 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-[11px] leading-4 text-zinc-200">
                      <span className="font-semibold tabular-nums text-violet-300">{item.tripCode}</span>
                      <span className="ml-1.5 text-zinc-400">
                        {t('shiftList.analysisReport.appliedSlack.row', { row: item.timelineRow })}
                      </span>
                      <span className="ml-1.5 tabular-nums text-zinc-400">
                        {t('shiftList.analysisReport.appliedSlack.blockRange', {
                          before: `${formatScheduleClockHms(item.blockBefore.startMinute)}–${formatScheduleClockHms(item.blockBefore.endMinute)}`,
                          now: `${formatScheduleClockHms(item.blockStartMinute)}–${formatScheduleClockHms(item.blockEndMinute)}`,
                        })}
                      </span>
                      <p className="text-zinc-300">{item.description}</p>
                      <p className="text-zinc-400">
                        {t('shiftList.analysisReport.appliedSlack.reason', { message: item.reasonMessage })}
                      </p>
                      {missingBlockId === item.blockId ? (
                        <p role="alert" className="text-amber-300">
                          {t('shiftList.analysisReport.appliedSlack.targetMissing', { code: item.tripCode })}
                        </p>
                      ) : null}
                    </div>
                    {onLocateBlock ? (
                      <button
                        type="button"
                        onClick={() => onLocateBlock(item.blockId)}
                        aria-label={t('shiftList.analysisReport.appliedSlack.locateAria', {
                          code: item.tripCode,
                          row: item.timelineRow,
                        })}
                        className="shrink-0 rounded border border-violet-700/60 px-1.5 py-0.5 text-[10px] text-violet-200 transition hover:bg-violet-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                      >
                        {t('shiftList.analysisReport.appliedSlack.locate')}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {suggestions.length === 0 ? (
          <p className="rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1.5 text-[11px] text-emerald-200">
            {t('shiftList.analysisReport.noIssues')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {SUGGESTION_CODES.map((code) => {
              const items = suggestions.filter((item) => item.code === code);
              if (items.length === 0) return null;
              return (
                <details
                  key={code}
                  open={items.length <= 1}
                  className="rounded border border-amber-700/40 bg-amber-950/25 px-2 py-1.5"
                >
                  <summary className="cursor-pointer text-[11px] font-semibold text-amber-200 marker:text-amber-500/70">
                    {t(`shiftList.analysisReport.suggestions.${code}.title`)}
                    <span className="ml-1 font-normal text-zinc-400">
                      {t('shiftList.analysisReport.itemCount', { count: items.length })}
                    </span>
                  </summary>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-400">
                    {t(`shiftList.analysisReport.suggestions.${code}.hint`)}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {items.map((item, index) => (
                      <li
                        key={`${item.code}-${index}`}
                        className="border-l border-amber-700/40 pl-2 text-[11px] leading-[16px] text-zinc-200"
                      >
                        {item.message}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}

        <h3 className="mb-1 mt-4 text-xs font-semibold text-zinc-300">
          {t('shiftList.analysisReport.fleetTitle')}
        </h3>
        <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
          {t('shiftList.analysisReport.fleetHint')}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className={TH}>{t('shiftList.analysisReport.columns.interval')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.targetHeadway')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.cycle')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.required')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.actual')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.peak')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.used')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.surplus')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.idle')}</th>
                <th className={TH}>{t('shiftList.analysisReport.columns.trips')}</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((row) => (
                <tr key={row.intervalId} className="border-b border-zinc-900">
                  <td className={TD}>
                    <span className="text-zinc-100">{row.intervalName}</span>
                    <span className="ml-1 text-zinc-500">
                      {formatClock(row.startMinute)}–{formatClock(row.endMinute)}
                    </span>
                  </td>
                  <td className={TD}>
                    {row.targetHeadwaySeconds == null
                      ? t('shiftList.analysisReport.unset')
                      : t('shiftList.analysisReport.seconds', {
                          value: row.targetHeadwaySeconds,
                        })}
                  </td>
                  <td className={TD}>
                    {t('shiftList.analysisReport.minutes', {
                      value: (row.cycleSeconds / 60).toFixed(1),
                    })}
                  </td>
                  <td className={TD}>
                    {t('shiftList.analysisReport.vehicles', {
                      value: formatVehicles(row.requiredVehicles),
                    })}
                  </td>
                  <td className={TD}>
                    {t('shiftList.analysisReport.vehicles', {
                      value: row.actualVehicles.toFixed(1),
                    })}
                  </td>
                  <td className={TD}>
                    {t('shiftList.analysisReport.vehicles', {
                      value: row.peakConcurrentVehicles,
                    })}
                  </td>
                  <td className={TD}>
                    {t('shiftList.analysisReport.rows', { value: row.distinctRowCount })}
                  </td>
                  <td className={`${TD} ${surplusClass(row.surplusVehicles)}`}>
                    {row.surplusVehicles == null
                      ? '—'
                      : t('shiftList.analysisReport.vehicles', {
                          value: `${row.surplusVehicles > 0 ? '+' : ''}${row.surplusVehicles.toFixed(1)}`,
                        })}
                  </td>
                  <td className={TD}>
                    {t('shiftList.analysisReport.minutes', {
                      value: row.idleMinutesPerVehicleHour.toFixed(0),
                    })}
                  </td>
                  <td className={TD}>{row.tripCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mb-1 mt-4 text-xs font-semibold text-zinc-300">
          {t('shiftList.analysisReport.berthTitle')}
        </h3>
        <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
          {t('shiftList.analysisReport.berthHint')}
        </p>
        {berths.length === 0 ? (
          <p className="text-[11px] text-zinc-500">{t('shiftList.analysisReport.berthOk')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className={TH}>{t('shiftList.analysisReport.berthColumns.station')}</th>
                  <th className={TH}>{t('shiftList.analysisReport.berthColumns.capacity')}</th>
                  <th className={TH}>{t('shiftList.analysisReport.berthColumns.peak')}</th>
                  <th className={TH}>{t('shiftList.analysisReport.berthColumns.overflow')}</th>
                  <th className={TH}>{t('shiftList.analysisReport.berthColumns.longest')}</th>
                  <th className={TH}>{t('shiftList.analysisReport.berthColumns.alternatives')}</th>
                </tr>
              </thead>
              <tbody>
                {berths.map((berth) => (
                  <tr key={berth.stationId} className="border-b border-zinc-900">
                    <td className={TD}>
                      <span className="text-zinc-100">{berth.stationName}</span>
                    </td>
                    <td className={TD}>
                      {t('shiftList.analysisReport.vehicles', { value: berth.capacity })}
                    </td>
                    <td className={TD}>
                      {t('shiftList.analysisReport.vehicles', {
                        value: berth.peakConcurrentVehicles,
                      })}
                      <span className="ml-1 text-zinc-500">
                        {formatClock(berth.peakAtMinute)}
                      </span>
                    </td>
                    <td className={`${TD} text-amber-300 font-semibold`}>
                      {t('shiftList.analysisReport.vehicles', {
                        value: berth.overflowVehicles,
                      })}
                    </td>
                    <td className={TD}>
                      {t('shiftList.analysisReport.minutes', {
                        value: berth.longestIdleMinutes.toFixed(0),
                      })}
                    </td>
                    <td className={TD}>
                      {berth.alternativeBerthCount == null ? (
                        <span className="text-zinc-500">
                          {t('shiftList.analysisReport.noGraph')}
                        </span>
                      ) : berth.alternativeBerthCount === 0 ? (
                        <span className="text-amber-300 font-semibold">
                          {t('shiftList.analysisReport.rows', { value: 0 })}
                        </span>
                      ) : (
                        <span title={berth.alternativeBerthNames.join('、')}>
                          {t('shiftList.analysisReport.rows', {
                            value: berth.alternativeBerthCount,
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
