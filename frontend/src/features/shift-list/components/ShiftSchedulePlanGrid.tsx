import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { Info, AlertTriangle, Trash2, CopyPlus } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ScrollPinnedCardLabel } from '../../../components/ScrollPinnedCardLabel';
import {
  PRIMARY_DAY_COPY_INDEX,
  isWithinDayCycleWindow,
  useDayCycleGridScroll,
} from '../../../components/scheduleGridDayCycle';
import {
  clampGridZoom,
  SCHEDULE_SLOT_WIDTH_DEFAULT,
  SCHEDULE_TIME_AXIS_TEXT_CLASS,
  SCHEDULE_ENGINE_TASK_TYPE_COLORS,
  YARD_EXIT_MOVE_COLOR_SET,
  blendHexOnBase,
  formatSelectedIntervalHoverContent,
  getInactiveRangesWithinBar,
  parseIntervalMinuteRanges,
  type TimeSlotAttribute,
  type TimeSlotInterval,
  type TaskTypeKey,
} from '../../time-templates/types/editor';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
} from '../utils/shiftScheduleEngine.types';
import { resolveFeasibilityIssueMeta } from '../utils/schedule-engine/feasibilityIssueMeta';
import type { ScheduleTask } from '../../time-templates/types/editor';
import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationLegTravel,
} from '../types/create';
import {
  normalizeMinimumRecoveryTimeSeconds,
  normalizeSwitchBufferAfterSeconds,
} from '../types/create';
import {
  buildBlockStationDepartures,
  resolveBlockStationDwellInputs,
  resolveRouteForBlock,
  type BlockStationStopTime,
} from '../utils/buildBlockStationDepartures';
import { resolveEffectiveRouteTravelSeconds } from '../utils/stationLegTravel';
import {
  isMoveCardBlockSource,
  resolveGeneratedBlockTripCode,
  resolveMoveCardPrefix,
  type MaintenanceSectionCodeBySection,
} from '../utils/maintenanceSectionCode';
import {
  minuteFromClientX,
  minuteFromClientXUnbounded,
  resolveManualBlockMinDurationMinutes,
} from '../utils/manualScheduleEdit';
import {
  SCHEDULE_DAY_MINUTES,
  formatScheduleClockHm,
  formatScheduleClockHms,
  formatScheduleClockRangeHms,
  splitIntoDayCycleSegments,
  wrapScheduleMinute,
} from '../utils/scheduleDayCycle';
import { MANUAL_BLOCK_MIN_DURATION_SECONDS } from '../utils/buildManualShiftScheduleOutput';

const ROW_HEIGHT_PX = 82;
const ROW_LABEL_WIDTH = 48;


/**
 * 0 秒轉場卡的顯示寬度。
 *
 * 兩座設施在同一個 Area 時是「0 秒示意轉移」（使用者裁決：開始跟結束一樣就好，
 * 不用計算），時間長度真的是 0。但 0 長度切不出日循環區段，整張卡就這樣消失，
 * 畫面上「同區域 0 秒轉移」跟「這段整備根本排不出入場出場卡」<strong>長得一模一樣</strong>，
 * 使用者分不出來——這正是「SC0000 那邊都沒有整備入場出場卡，這樣看不懂」。
 *
 * 所以 0 秒卡照畫，用固定寬度撐出來，並且畫成虛線邊框表示<strong>它不佔時間</strong>。
 * 出廠卡掛在時刻的左邊（前一段任務的尾巴）、入廠卡掛在右邊（後一段任務的頭），
 * 各佔一側，誰也不蓋誰；後一段任務的卡面文字往右讓出同樣的寬度。
 */
const ZERO_DURATION_CARD_WIDTH_PX = 30;

// 班次卡大小高度調整參數
const TEMPLATE_TASK_BAR_HEIGHT = 26; // 頂部時間模板任務卡片高度
const REAL_TASK_BAR_HEIGHT = 52;     // 下層真實排班班次卡卡片高度
const REAL_TASK_BAR_TOP = 30;        // 下層真實排班班次卡卡片頂部位移
const EDGE_HANDLE_PX = 8;
const MANUAL_MIN_DURATION_MINUTES = MANUAL_BLOCK_MIN_DURATION_SECONDS / 60;

const GRID_SLOT_MINUTES = 10;
const GRID_VISIBLE_SLOTS = 144; // 24 hours * 6 slots/hour
/** 預設：每 10 分鐘格約 216px */
const GRID_SLOT_WIDTH_BASE = Math.round(SCHEDULE_SLOT_WIDTH_DEFAULT * 1.5);
const GRID_SLOT_WIDTH_MIN = Math.round(GRID_SLOT_WIDTH_BASE / 2.5);
const GRID_SLOT_WIDTH_MAX = Math.round(GRID_SLOT_WIDTH_BASE * 4);
/**
 * 班次卡底部「HH:MM:SS - HH:MM:SS」完整顯示約需寬度（含左色條與內距）。
 * 自動縮放以此為下限，依最短班次推算格寬。
 */
const BLOCK_TIME_RANGE_MIN_PX = 136;

type HoverCardPos = {
  top: number;
  left: number;
};

/**
 * 這則 issue 是不是指向這張班次卡。
 *
 * 站位碰撞類的 issue 會同時牽涉兩張卡（earlier／later），兩張都要標記，
 * 否則使用者只看得到其中一邊、對不出是跟誰撞。
 */
function matchIssuesForBlock(
  issues: FeasibilityIssue[] | undefined,
  blockId: string,
  templateTaskId: string | undefined,
): FeasibilityIssue[] {
  if (!issues?.length) return [];
  return issues.filter((issue) => {
    const d = issue.detail;
    if (!d) return false;
    return (
      d.blockId === blockId
      || d.nextBlockId === blockId
      || d.earlierBlockId === blockId
      || d.laterBlockId === blockId
      || d.templateTaskId === blockId
      || (templateTaskId != null && d.templateTaskId === templateTaskId)
    );
  });
}

/** 班次卡 ⚠ 的 hover 卡：列出這張卡實際命中的錯誤與警告內容 */
function BlockIssueHoverCard({
  blockCode,
  errors,
  warnings,
  pos,
}: {
  blockCode?: string | null;
  errors: FeasibilityIssue[];
  warnings: FeasibilityIssue[];
  pos: HoverCardPos;
}) {
  const rows = [
    ...errors.map((issue) => ({ issue, severity: 'error' as const })),
    ...warnings.map((issue) => ({ issue, severity: 'warning' as const })),
  ];
  if (rows.length === 0) return null;

  // 一張卡可能有好幾則，往上開會頂出畫面外、內容被切掉（使用者回報看不到全部）。
  // 上方空間不夠就改成往下開，左右也夾在畫面內，並依實際可用高度給捲動空間。
  const CARD_WIDTH = 460;
  const MARGIN = 12;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const spaceAbove = pos.top - MARGIN;
  const spaceBelow = viewportHeight - pos.top - MARGIN;
  const openDownwards = spaceBelow > spaceAbove;
  const availableHeight = Math.max(160, openDownwards ? spaceBelow : spaceAbove);
  const halfWidth = CARD_WIDTH / 2;
  const clampedLeft = Math.min(
    Math.max(pos.left, halfWidth + MARGIN),
    Math.max(halfWidth + MARGIN, viewportWidth - halfWidth - MARGIN),
  );

  return createPortal(
    <div
      className={
        'fixed z-[10050] w-[460px] -translate-x-1/2 overflow-y-auto rounded-lg'
        + ' border border-zinc-700/90 bg-zinc-950 px-2.5 py-2 shadow-2xl shadow-black/50'
        + (openDownwards ? '' : ' -translate-y-full')
      }
      style={{
        top: openDownwards ? pos.top + 16 : pos.top,
        left: clampedLeft,
        maxHeight: availableHeight,
      }}
      role="tooltip"
    >
      <div className="flex items-baseline gap-1.5 text-[11px] leading-4">
        {blockCode ? (
          <span className="shrink-0 font-semibold tabular-nums text-sky-300">
            {blockCode}
          </span>
        ) : null}
        <span className="font-semibold text-zinc-100">
          {errors.length > 0 ? i18n.t('shiftList.planGrid.errorsAndWarnings') : i18n.t('shiftList.planGrid.warnings')}
          <span className="ml-1 text-zinc-500">{i18n.t('shiftList.planGrid.countItems', { count: rows.length })}</span>
        </span>
      </div>
      <ul className="mt-1 space-y-1">
        {rows.map(({ issue, severity }, index) => {
          const meta = resolveFeasibilityIssueMeta(issue);
          return (
            <li
              key={`${issue.code}-${index}`}
              className={
                severity === 'error'
                  ? 'rounded border border-red-800/50 bg-red-950/30 px-1.5 py-1'
                  : 'rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-1'
              }
            >
              <div className="flex items-baseline gap-1 text-[10px] leading-[14px]">
                <span
                  className={
                    severity === 'error'
                      ? 'shrink-0 font-semibold text-red-300'
                      : 'shrink-0 font-semibold text-amber-300'
                  }
                >
                  {meta.groupTitle}
                </span>
                <span className="shrink-0 text-zinc-600">·</span>
                <span className="shrink-0 text-zinc-500">{meta.kindLabel}</span>
                <span className="shrink-0 text-zinc-600">·</span>
                <span className="min-w-0 font-mono text-[9px] text-zinc-500">
                  {issue.code}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] leading-[14px] text-zinc-200">
                {issue.message}
              </p>
              {meta.guidance ? (
                <p className="mt-0.5 text-[10px] leading-[14px] text-zinc-400">
                  {meta.guidance}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}

/**
 * 轉場小卡的說明；卡面只印使用者自訂的代號（充電 E → EI／EO，保養 M → MI／MO，
 * 行檢 P → PI／PO……），沒有固定的「MO／MI／PI／PO 四種」——標題與說明依
 * block.source（入廠／出廠、整備或調度）與 yardExitSectionLabel（充電／保養／
 * 行檢／洗車／待命／調度）動態組出來。
 */
function resolveMoveCardTitle(block: GeneratedScheduleBlock): string {
  const direction = block.source === 'yard_entry_move' ? i18n.t('shiftList.planGrid.enterYard') : i18n.t('shiftList.planGrid.exitYard');
  return `${block.yardExitSectionLabel ?? ''}${direction}`;
}

const MOVE_CARD_HINT_BY_SOURCE: Record<string, string> = {
  yard_exit_move: i18n.t('shiftList.planGrid.yardExitHint'),
  yard_entry_move: i18n.t('shiftList.planGrid.yardEntryHint'),
};

/** 移動小卡的 hover 說明：卡片本身太小塞不下任何文字，內容全在這裡 */
function MoveCardHoverCard({
  code,
  prefix,
  block,
  pos,
}: {
  code: string;
  /** 卡面短代號（不含列碼與時刻），例 MI／WO／TI */
  prefix: string | null;
  block: GeneratedScheduleBlock;
  pos: HoverCardPos;
}) {
  const { t } = useTranslation();
  const CARD_WIDTH = 260;
  const MARGIN = 12;
  const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const halfWidth = CARD_WIDTH / 2;
  const clampedLeft = Math.min(
    Math.max(pos.left, halfWidth + MARGIN),
    Math.max(halfWidth + MARGIN, viewportWidth - halfWidth - MARGIN),
  );

  return createPortal(
    <div
      className="fixed z-[10050] w-[260px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-2.5 py-2 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: clampedLeft }}
      role="tooltip"
    >
      <div className="flex items-baseline gap-1.5">
        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-bold text-zinc-100">
          {prefix ?? '·'}
        </span>
        <span className="text-[11px] font-semibold text-zinc-100">
          {resolveMoveCardTitle(block)}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-sky-300">{code}</span>
      </div>
      <div className="mt-1 text-[11px] leading-4 text-zinc-100">
        {block.source === 'yard_entry_move'
          ? `${block.yardExitStationLabel ?? block.yardExitStationId ?? i18n.t('shiftList.planGrid.currentStation')} → ${block.yardExitFacilityLabel ?? i18n.t('shiftList.planGrid.facility')}`
          : `${block.yardExitFacilityLabel ?? i18n.t('shiftList.planGrid.facility')} → ${block.yardExitStationLabel ?? block.yardExitStationId ?? i18n.t('shiftList.planGrid.transferStation')}`}
      </div>
      {/*
        途經節點：載客卡看得到停靠序，調度移動沒有理由是黑箱。只有兩端（起訖）時
        不重複顯示——那跟上一行一樣，沒有新資訊。
      */}
      {block.yardMoveViaLabels && block.yardMoveViaLabels.length > 2 ? (
        <div className="mt-0.5 text-[10px] leading-4 text-zinc-400">
          {t('shiftList.planGrid.viaNodes')} {block.yardMoveViaLabels.join(' › ')}
        </div>
      ) : null}
      <div className="mt-0.5 text-[10px] tabular-nums leading-4 text-zinc-400">
        {formatBlockTimeRange(block)}
        {i18n.t('shiftList.planGrid.secondsParen', { seconds: block.travelSeconds })}
      </div>
      {block.plannedEndMinute - block.plannedStartMinute <= 1e-9 ? (
        <div className="mt-0.5 text-[10px] leading-4 text-amber-300/90">
          {t('shiftList.planGrid.zeroTransferNote')}
        </div>
      ) : null}
      <p className="mt-1 text-[10px] leading-[14px] text-zinc-500">
        {block.source ? MOVE_CARD_HINT_BY_SOURCE[block.source] ?? '' : ''}
      </p>
      {block.yardExitAteYardTail ? (
        <p className="mt-0.5 text-[10px] leading-[14px] text-amber-400">
          {t('shiftList.planGrid.ateYardTail')}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}

/** 會佔用整備設施的任務類型（與引擎 moveCardShared.YARD_TASK_TYPES 同一組） */
const YARD_TASK_TYPES_FOR_UI = new Set([
  'charging',
  'inspection',
  'standby',
  'servicing',
  'washing',
]);

/**
 * 整備任務卡的 hover 說明：這一段停在哪一台設施、做多久。
 * 卡面只塞得下「類型 · 設施」一行，設施沒排到的原因、精確時長這些
 * 都放這裡——每張整備卡都要有 ⓘ，不能只有正線卡查得到細節。
 */
function YardTaskHoverCard({
  code,
  block,
  pos,
}: {
  code: string;
  block: GeneratedScheduleBlock;
  pos: HoverCardPos;
}) {
  const { t } = useTranslation();
  const CARD_WIDTH = 260;
  const MARGIN = 12;
  const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const halfWidth = CARD_WIDTH / 2;
  const clampedLeft = Math.min(
    Math.max(pos.left, halfWidth + MARGIN),
    Math.max(halfWidth + MARGIN, viewportWidth - halfWidth - MARGIN),
  );
  const durationMinutes = block.plannedEndMinute - block.plannedStartMinute;
  const hours = Math.floor(durationMinutes / 60);
  const minutes = Math.round(durationMinutes % 60);

  return createPortal(
    <div
      className="fixed z-[10050] w-[260px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-2.5 py-2 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: clampedLeft }}
      role="tooltip"
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-semibold text-zinc-100">{block.label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-sky-300">{code}</span>
      </div>
      <div className="mt-1 text-[11px] leading-4 text-zinc-100">
        {block.yardFacilityLabel
          ? i18n.t('shiftList.planGrid.facilityAssigned', { label: block.yardFacilityLabel })
          : i18n.t('shiftList.planGrid.facilityUnassigned')}
      </div>
      <div className="mt-0.5 text-[10px] tabular-nums leading-4 text-zinc-400">
        {formatBlockTimeRange(block)}
        （{hours > 0 ? i18n.t('shiftList.planGrid.hoursPart', { hours }) : ''}
        {minutes} {i18n.t('shiftList.planGrid.minutesUnit')}）
      </div>
      {block.source === 'hold' ? (
        <p className="mt-1 text-[10px] leading-[14px] text-zinc-400">
          {t('shiftList.planGrid.yardHoldHint')}
        </p>
      ) : null}
      {block.yardFacilityUnavailable ? (
        <p className="mt-1 text-[10px] leading-[14px] text-red-400">
          {t('shiftList.planGrid.noFacilitySlot')}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}

/** 頂部時間軸 hover 卡片（與建立時間模板相同內容格式） */
function IntervalAxisHoverCard({
  interval,
  attribute,
  pos,
}: {
  interval: TimeSlotInterval;
  attribute: TimeSlotAttribute | undefined;
  pos: HoverCardPos;
}) {
  const content = formatSelectedIntervalHoverContent(interval, attribute);
  const accent = attribute?.color ?? '#7C86FF';

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10050] w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-3 py-2.5 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <span className="text-[11px] font-semibold leading-4 text-zinc-100">
          {content.title}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-[10px] leading-[15px] text-zinc-300">
        {content.lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-zinc-700/90"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

/** 班次卡算法對照：頂部一行摘要 + 站↔站時間軸 */
function BlockAlgorithmHoverCard({
  routeName,
  blockCode,
  summary,
  stops,
  legs,
  pos,
  hideStrategyBuffers = false,
  entryServiceBerthCheck,
}: {
  routeName: string;
  /** 班次卡代號（如 TN0942） */
  blockCode?: string | null;
  summary: {
    topologyMinSeconds: number | null;
    topologyAvgSeconds: number | null;
    actualTravelSeconds: number;
    /** 各站靠站秒數加總（不含緩衝） */
    dwellBaseSeconds: number;
    dwellSlackSeconds: number;
    switchBufferSeconds: number;
    recoverySeconds: number;
  };
  stops: BlockStationStopTime[];
  legs: ShiftScheduleStationLegTravel[];
  pos: HoverCardPos;
  /** 手動製作：不顯示換線／恢復（僅卡上靠站與緩衝） */
  hideStrategyBuffers?: boolean;
  /** 調度營運班次（entry_service）落點診斷；見文件 §10.3 */
  entryServiceBerthCheck?: GeneratedScheduleBlock['entryServiceBerthCheck'];
}) {
  const { t } = useTranslation();
  const sec = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}s`;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10050] w-[440px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-2.5 py-2 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-4">
        {blockCode ? (
          <span className="shrink-0 font-semibold tabular-nums text-sky-300">
            {blockCode}
          </span>
        ) : null}
        <span className="min-w-0 truncate font-semibold text-zinc-100">
          {routeName}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-[14px] tabular-nums text-zinc-400">
        {t('shiftList.planGrid.travel')} {sec(summary.actualTravelSeconds)}
        <span className="text-zinc-600">（{t('shiftList.planGrid.avgShort')} {sec(summary.topologyAvgSeconds)} · {t('shiftList.planGrid.minShort')} {sec(summary.topologyMinSeconds)}）</span>
        <span className="text-zinc-600"> · </span>
        {t('shiftList.planGrid.dwell')} {sec(summary.dwellBaseSeconds)}
        <span className="text-zinc-600"> · </span>
        {t('shiftList.planGrid.slack')} {sec(summary.dwellSlackSeconds)}
        {!hideStrategyBuffers ? (
          <>
            <span className="text-zinc-600"> · </span>
            {t('shiftList.planGrid.switchBuf')} {sec(summary.switchBufferSeconds)}
            <span className="text-zinc-600"> · </span>
            {t('shiftList.planGrid.recovery')} {sec(summary.recoverySeconds)}
          </>
        ) : null}
      </p>
      {entryServiceBerthCheck ? (
        <p className="mt-1 rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-1 text-[10px] leading-[14px] tabular-nums text-amber-200">
          <span className="font-semibold">{t('shiftList.planGrid.insertSlack')}</span>
          <span className="text-amber-400/80"> · </span>
          {t('shiftList.planGrid.arrive')} {stops.find((s) => s.stationId === entryServiceBerthCheck.arriveStationId)?.stationName
            ?? entryServiceBerthCheck.arriveStationId}
          <span className="text-amber-400/80"> · </span>
          {t('shiftList.planGrid.berthClear')} {formatMinuteToHms(entryServiceBerthCheck.berthClearMinute)}
          <span className="text-amber-400/80"> · </span>
          {t('shiftList.planGrid.slackLabel')}{' '}
          <span
            className={
              entryServiceBerthCheck.slackSeconds < 0 ? 'font-semibold text-red-400' : 'font-semibold'
            }
          >
            {entryServiceBerthCheck.slackSeconds}s
          </span>
        </p>
      ) : null}

      {stops.length === 0 ? (
        <p className="mt-2 text-[10px] text-zinc-500">{t('shiftList.planGrid.noStationData')}</p>
      ) : (
        <ol className="mt-2 max-h-[260px] space-y-0 overflow-y-auto text-[10px] leading-[14px]">
          {stops.map((stop, index) => {
            const leg = legs[index];
            const actualLeg = stop.travelToNextSeconds;
            const showLeg = index < stops.length - 1;
            return (
              <li key={`${stop.order}-${stop.stationId}`} className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-1.5 text-zinc-300">
                  <span className="w-3 shrink-0 tabular-nums text-zinc-500">{stop.order}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">
                    {stop.stationName}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-400">
                    {(() => {
                      const isFirst = index === 0;
                      const isLast = index === stops.length - 1;
                      // 首站：本卡出發點，只顯示出發（抵達屬上一卡末站）
                      if (isFirst && !isLast) {
                        return (
                          <>
                            <span className="text-zinc-600">{t('shiftList.planGrid.depart')} </span>
                            {formatMinuteToHms(stop.departureMinute)}
                          </>
                        );
                      }
                      // 末站：抵達後完成靠站／緩衝，不以「出發」稱呼
                      if (isLast && !isFirst) {
                        return (
                          <>
                            <span className="text-zinc-600">{t('shiftList.planGrid.arrive')} </span>
                            {formatMinuteToHms(stop.arrivalMinute)}
                            <span className="mx-1 text-zinc-600">{t('shiftList.planGrid.dwellDone')} </span>
                            {formatMinuteToHms(stop.departureMinute)}
                          </>
                        );
                      }
                      // 單一站卡
                      if (
                        Math.round(stop.arrivalMinute * 60)
                        === Math.round(stop.departureMinute * 60)
                      ) {
                        return (
                          <>
                            <span className="text-zinc-600">{t('shiftList.planGrid.depart')} </span>
                            {formatMinuteToHms(stop.departureMinute)}
                          </>
                        );
                      }
                      if (isFirst && isLast) {
                        return (
                          <>
                            <span className="text-zinc-600">{t('shiftList.planGrid.depart')} </span>
                            {formatMinuteToHms(stop.arrivalMinute)}
                            <span className="mx-1 text-zinc-600">{t('shiftList.planGrid.dwellDone')} </span>
                            {formatMinuteToHms(stop.departureMinute)}
                          </>
                        );
                      }
                      // 中途站
                      return (
                        <>
                          <span className="text-zinc-600">{t('shiftList.planGrid.arrive')} </span>
                          {formatMinuteToHms(stop.arrivalMinute)}
                          <span className="mx-1 text-zinc-600">{t('shiftList.planGrid.depart')} </span>
                          {formatMinuteToHms(stop.departureMinute)}
                        </>
                      );
                    })()}
                  </span>
                  <span className="shrink-0 text-right tabular-nums text-zinc-500">
                    {t('shiftList.planGrid.dwell')} {sec(stop.baseDwellSeconds)}
                    <span className="text-zinc-600"> · </span>
                    {t('shiftList.planGrid.slack')} {sec(summary.dwellSlackSeconds > 0 && stop.baseDwellSeconds > 0
                      ? summary.dwellSlackSeconds
                      : 0)}
                  </span>
                </div>
                {showLeg ? (
                  <div className="ml-3 flex items-center gap-1.5 border-l border-zinc-800 py-1 pl-2.5 text-[10px] tabular-nums text-zinc-500">
                    <span className="text-zinc-600">↓</span>
                    <span>
                      {t('shiftList.planGrid.minShort')} {sec(leg?.minTravelTimeSeconds)}
                      <span className="text-zinc-600"> · </span>
                      {t('shiftList.planGrid.avgShort')} {sec(leg?.avgTravelTimeSeconds)}
                      {actualLeg != null ? (
                        <>
                          <span className="text-zinc-600"> · </span>
                          {t('shiftList.planGrid.thisTrip')} {sec(actualLeg)}
                        </>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-zinc-700/90"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

function formatMinuteToHm(minute: number): string {
  return formatScheduleClockHm(minute);
}

function formatMinuteToHms(minute: number): string {
  return formatScheduleClockHms(minute);
}

function formatBlockTimeRange(block: GeneratedScheduleBlock): string {
  return formatScheduleClockRangeHms(
    block.plannedStartMinute,
    block.plannedEndMinute,
  );
}

function TemplateTaskBar({
  task,
  slotWidthPx,
}: {
  task: ScheduleTask;
  slotWidthPx: number;
}) {
  const endMinute = task.startMinute + task.durationMinutes;
  const segments = splitIntoDayCycleSegments(task.startMinute, endMinute);
  const timeLabel = `${formatMinuteToHm(task.startMinute)}-${formatMinuteToHm(endMinute)}`;
  const isSticky = task.durationMinutes >= 20;

  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((seg, index) => {
        const leftPx = (seg.startMinute / GRID_SLOT_MINUTES) * slotWidthPx;
        const widthPx =
          ((seg.endMinute - seg.startMinute) / GRID_SLOT_MINUTES) * slotWidthPx;
        return (
          <div
            key={`${task.id}-${index}`}
            className="pointer-events-none absolute top-[2px] z-[2] flex items-center justify-start overflow-clip rounded-[4px] border border-zinc-700/60 bg-zinc-800/80 px-2"
            style={{
              left: leftPx,
              width: Math.max(widthPx, 4),
              height: TEMPLATE_TASK_BAR_HEIGHT,
            }}
            title={`${task.label} ${timeLabel}`}
            aria-hidden
          >
            {index === 0 ? (
              <span
                className={`${
                  isSticky ? 'sticky left-[56px]' : ''
                } shrink-0 max-w-full truncate text-[10px] font-normal leading-[18px] tracking-[0.5px] text-zinc-300`}
              >
                {task.label}
                <span className="opacity-70"> | {timeLabel}</span>
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function formatSlotLabel(slotIndex: number): string {
  const totalMinutes = slotIndex * GRID_SLOT_MINUTES;
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 依產出最短班次時長自動推算格寬，使起迄時間盡量完整顯示。 */
export function computeAutoSlotWidthPx(plan: GeneratedSchedulePlan): number {
  let minDurationMinutes = Number.POSITIVE_INFINITY;
  for (const timeline of plan.timelines) {
    for (const block of timeline.blocks) {
      const duration = block.plannedEndMinute - block.plannedStartMinute;
      if (duration > 0 && duration < minDurationMinutes) {
        minDurationMinutes = duration;
      }
    }
  }
  if (!Number.isFinite(minDurationMinutes)) {
    return GRID_SLOT_WIDTH_BASE;
  }
  const needed =
    (BLOCK_TIME_RANGE_MIN_PX * GRID_SLOT_MINUTES) / minDurationMinutes;
  return Math.round(
    Math.min(
      GRID_SLOT_WIDTH_MAX,
      Math.max(GRID_SLOT_WIDTH_MIN, Math.max(GRID_SLOT_WIDTH_BASE, needed)),
    ),
  );
}

/**
 * 班次卡代號。直接委派給 maintenanceSectionCode.ts 的
 * resolveGeneratedBlockTripCode()——這裡曾經是一份平行重寫的複製本，
 * 每次新增 source（MO/entry_service/PI/PO…）都要記得兩邊一起補，
 * 已經漏過兩次（MO 漏過一次、MI/PI/PO 漏過一次）。改成委派後
 * 兩邊不可能再失步。
 */
function resolveBlockCode(
  block: GeneratedScheduleBlock,
  index: number,
  sectionCodes?: MaintenanceSectionCodeBySection | null,
): string {
  return resolveGeneratedBlockTripCode(block, index, sectionCodes);
}

function ScheduleIntervalBackground({
  intervals,
  attributes,
  slotWidthPx,
  interactive = false,
}: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
  /** 頂部時間軸：可 hover 顯示時段屬性／班距 */
  interactive?: boolean;
}) {
  const totalWidth = GRID_VISIBLE_SLOTS * slotWidthPx;
  return (
    <>
      <div
        className="schedule-inactive-timeline pointer-events-none absolute inset-y-0 left-0"
        style={{ width: totalWidth }}
        aria-hidden
      />
      {intervals.map((slot) => {
        const start = parseIntervalMinuteRanges([slot])[0]?.start;
        const end = parseIntervalMinuteRanges([slot])[0]?.end;
        if (start == null || end == null || end <= start) return null;
        const attr = attributes.find((item) => item.id === slot.attributeId);
        const accent = attr?.color ?? '#7C86FF';
        const leftPx = (start / GRID_SLOT_MINUTES) * slotWidthPx;
        const widthPx = ((end - start) / GRID_SLOT_MINUTES) * slotWidthPx;
        if (interactive) {
          return (
            <ScheduleIntervalAxisHit
              key={slot.id}
              interval={slot}
              attribute={attr}
              leftPx={leftPx}
              widthPx={widthPx}
              accent={accent}
            />
          );
        }
        return (
          <div
            key={slot.id}
            className="pointer-events-none absolute inset-y-0 z-[1]"
            style={{
              left: leftPx,
              width: widthPx,
              // 不透明混色，完全蓋住底層斜線；僅無時段屬性區保留黑色斜紋
              backgroundColor: blendHexOnBase(accent, 0.38),
            }}
            aria-hidden
          />
        );
      })}
    </>
  );
}

function ScheduleIntervalAxisHit({
  interval,
  attribute,
  leftPx,
  widthPx,
  accent,
}: {
  interval: TimeSlotInterval;
  attribute: TimeSlotAttribute | undefined;
  leftPx: number;
  widthPx: number;
  accent: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<HoverCardPos | null>(null);

  const showAt = (clientX: number, clientY: number) => {
    setPos({
      top: Math.max(clientY - 12, 64),
      left: Math.min(Math.max(clientX, 120), window.innerWidth - 120),
    });
  };

  return (
    <>
      {/* 色帶在時間刻度之下，避免蓋住軸文字 */}
      <div
        className="pointer-events-none absolute inset-y-0 z-[1]"
        style={{
          left: leftPx,
          width: widthPx,
          backgroundColor: blendHexOnBase(accent, 0.38),
        }}
        aria-hidden
      />
      <button
        ref={anchorRef}
        type="button"
        className="absolute inset-y-0 z-[5] cursor-help border-0 bg-transparent p-0"
        style={{
          left: leftPx,
          width: widthPx,
        }}
        aria-label={`${interval.name} ${interval.startTime} — ${interval.endTime}`}
        onMouseEnter={(event) => {
          setHovered(true);
          showAt(event.clientX, event.clientY);
        }}
        onMouseMove={(event) => {
          if (!hovered) setHovered(true);
          showAt(event.clientX, event.clientY);
        }}
        onMouseLeave={() => {
          setHovered(false);
          setPos(null);
        }}
        onFocus={() => {
          const el = anchorRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          setHovered(true);
          showAt(rect.left + Math.min(rect.width, 200) / 2, rect.top);
        }}
        onBlur={() => {
          setHovered(false);
          setPos(null);
        }}
      />
      {hovered && pos ? (
        <IntervalAxisHoverCard
          interval={interval}
          attribute={attribute}
          pos={pos}
        />
      ) : null}
    </>
  );
}

/**
 * P5: 未服務運能缺口標記——在時間軸上顯示 UNSERVED_SERVICE_PULSE 紅色豪線。
 */
function UnservedPulseMarkers({
  report,
  slotWidthPx,
}: {
  report: ShiftScheduleFeasibilityReport | null;
  slotWidthPx: number;
}) {
  const { t } = useTranslation();
  const markers = useMemo(() => {
    if (!report) return [];
    const out: { departureSecond: number; message: string }[] = [];
    for (const issue of report.warnings) {
      if (issue.code !== 'UNSERVED_SERVICE_PULSE') continue;
      const sec = issue.detail?.departureSecond;
      if (typeof sec !== 'number') continue;
      out.push({ departureSecond: sec, message: issue.message });
    }
    return out;
  }, [report]);

  if (markers.length === 0) return null;

  return (
    <>
      {markers.map(({ departureSecond, message }) => {
        const minuteFromMidnight = departureSecond / 60;
        const leftPx = (minuteFromMidnight / GRID_SLOT_MINUTES) * slotWidthPx;
        return (
          <div
            key={`unserved-${departureSecond}`}
            className="group pointer-events-auto absolute bottom-0 top-0 z-[8] w-0"
            style={{ left: leftPx }}
            role="img"
            aria-label={message}
          >
            {/* 紅色豪線 */}
            <div className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-red-500/70" />
            {/* 上方小三角標記 */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-red-500/90" />
            {/* Hover tooltip */}
            <div
              className="pointer-events-none absolute left-1/2 top-full z-[10060] mt-1 hidden w-max max-w-[200px] -translate-x-1/2 rounded-lg border border-red-500/40 bg-zinc-950 px-2.5 py-2 text-[10px] leading-snug text-red-300 shadow-xl shadow-black/50 group-hover:block"
              role="tooltip"
            >
              <span className="mb-0.5 block font-semibold">{t('shiftList.planGrid.unservedSpan')}</span>
              {message}
            </div>
          </div>
        );
      })}
    </>
  );
}


function ShiftScheduleBlockBar({
  block,
  blockIndex,
  slotWidthPx,
  activeIntervalRanges,
  selected = false,
  onSelect,
  report = null,
  highlighted = false,
  selectedRoutes = [],
  minimumRecoveryTimeSeconds = null,
  sectionCodes = null,
  interactiveEdit = false,
  hideStrategyBuffers = false,
  previousPassengerBlock = null,
  onCommitTimeRange,
  onPreviewTimeRange,
  onDeleteBlock,
  onDuplicateBlock,
  primaryCopy = true,
  leadingInsetPx = 0,
  trackOffsetPx = 0,
}: {
  block: GeneratedScheduleBlock;
  blockIndex: number;
  slotWidthPx: number;
  activeIntervalRanges: ReturnType<typeof parseIntervalMinuteRanges>;
  selected?: boolean;
  onSelect?: (blockId: string | null) => void;
  report?: ShiftScheduleFeasibilityReport | null;
  highlighted?: boolean;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds?: number | null;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  interactiveEdit?: boolean;
  hideStrategyBuffers?: boolean;
  /** 同列前一正線卡；關節站時刻對齊用 */
  previousPassengerBlock?: GeneratedScheduleBlock | null;
  onCommitTimeRange?: (blockId: string, startMinute: number, endMinute: number) => void;
  onPreviewTimeRange?: (blockId: string, startMinute: number, endMinute: number) => void;
  onDeleteBlock?: (blockId: string) => void;
  onDuplicateBlock?: (blockId: string) => void;
  /**
   * 是不是中間那一份日拷貝。無限捲動會把同一張卡畫三次，
   * DOM id 與鍵盤焦點只能有一份，否則 getElementById 會抓到別份、
   * Tab 鍵要按三次才走得完一張卡。
   */
  primaryCopy?: boolean;
  /**
   * 卡面文字往右讓出的寬度。開頭剛好被一張 0 秒入廠卡壓住時，
   * 不讓的話代號（SC0000 這種）會整個被蓋掉。
   */
  leadingInsetPx?: number;
  /**
   * 這一份日拷貝的軌道左緣在捲動內容座標系裡的位置
   * （左側列號欄寬度 ＋ 第幾份 × 一日寬度）。卡面文字要跟著捲動貼齊可視左緣，
   * 得知道自己在整份內容裡的絕對位置。
   */
  trackOffsetPx?: number;
}) {
  const { t } = useTranslation();
  // 出場移動卡只有 30 秒，寬度幾個 px，塞不下任何文字：
  // 單一顏色、卡內不放內容，說明全部交給 hover。
  // 轉場小卡（入廠／出廠，整備或調度皆算）通常只有幾十秒寬，塞不下完整班次
  // 代號，卡面只印使用者自訂的代號，完整資訊全部交給 hover。
  const isMoveCard = isMoveCardBlockSource(block.source);
  // 調度營運班次（entry_service）就是載客正線，沿用正線色卡，
  // 不再另立一種顏色——它跟正線是同一件事，只是不算輪、不受班距約束。
  const colors = isMoveCard
    ? YARD_EXIT_MOVE_COLOR_SET
    : SCHEDULE_ENGINE_TASK_TYPE_COLORS[block.taskType];
  const durationMinutes = block.plannedEndMinute - block.plannedStartMinute;
  /**
   * 開始等於結束的卡。兩種來源：
   * 1. 同區域轉場卡——使用者裁決的「0 秒示意轉移」，是正常的。
   * 2. 0 長度的整備任務本身——模板那一列排錯了，是要被看見的問題。
   * 兩種都得畫出來，畫不出來的話跟「這裡什麼都沒排」分不出來。
   */
  const isZeroDuration = durationMinutes <= 1e-9;
  const daySegments = useMemo(
    () => {
      const segments = splitIntoDayCycleSegments(
        block.plannedStartMinute,
        block.plannedEndMinute,
      );
      if (segments.length > 0 || !isZeroDuration) return segments;
      // 0 長度切不出區段，整張卡會消失——但它是真的存在的一張卡。
      // 給它一個點區段，寬度靠 ZERO_DURATION_CARD_WIDTH_PX 撐出來。
      const point = wrapScheduleMinute(block.plannedStartMinute);
      return [{ startMinute: point, endMinute: point }];
    },
    [block.plannedStartMinute, block.plannedEndMinute, isZeroDuration],
  );
  // 跨午夜的卡（兩段）以前不給拖：那時日尾與日頭畫在畫面的兩端，拖哪一段
  // 都看不懂在拖什麼。無限捲動之後兩段實體相鄰、看起來就是一張，拖任一段
  // 都是搬整張卡，語意清楚了；而且一拖過午夜就變成不能再拖，那才是壞掉。
  const interactiveOnSegments = interactiveEdit;
  const inactiveRanges = useMemo(
    () =>
      getInactiveRangesWithinBar(
        block.plannedStartMinute,
        block.plannedEndMinute,
        activeIntervalRanges,
      ),
    [activeIntervalRanges, block.plannedEndMinute, block.plannedStartMinute],
  );
  const isIdleLike =
    !isMoveCard
    && (block.taskType === 'idle'
      || block.source === 'transition'
      || block.taskType === 'dispatch'
      || block.source === 'dispatch');
  const code = resolveBlockCode(block, blockIndex, sectionCodes);
  // 卡面／hover 徽章顯示的短代號（不含列碼與時刻），例 MI／WO／TI；
  // 調度視為整備任務的第六種類型，跟其餘五種共用同一套「代號＋I/O」規則。
  const moveCardPrefix = isMoveCard ? resolveMoveCardPrefix(block) : null;
  const timeLabel = formatBlockTimeRange(block);
  const selectable =
    block.source === 'template_bar'
    && block.taskType !== 'dispatch'
    && onSelect != null;
  const [stationHoverPos, setStationHoverPos] = useState<HoverCardPos | null>(null);
  const [issueHoverPos, setIssueHoverPos] = useState<HoverCardPos | null>(null);
  const [moveCardHoverPos, setMoveCardHoverPos] = useState<HoverCardPos | null>(null);
  const [yardHoverPos, setYardHoverPos] = useState<HoverCardPos | null>(null);

  const route = useMemo(
    () => resolveRouteForBlock(block, selectedRoutes),
    [block, selectedRoutes],
  );

  const previousRoute = useMemo(
    () =>
      previousPassengerBlock
        ? resolveRouteForBlock(previousPassengerBlock, selectedRoutes)
        : null,
    [previousPassengerBlock, selectedRoutes],
  );

  const stationStops = useMemo(() => {
    if (block.taskType !== 'passenger') return [];
    return buildBlockStationDepartures(block, route, {
      previousBlock: previousPassengerBlock,
      previousRoute,
    });
  }, [block, route, previousPassengerBlock, previousRoute]);

  const algorithmSummary = useMemo(() => {
    const travel = route ? resolveEffectiveRouteTravelSeconds(route) : null;
    const dwellInputs = resolveBlockStationDwellInputs(block, route);
    const dwellSlackSeconds = dwellInputs?.dwellSlackSeconds ?? 0;
    const dwellBaseSeconds =
      dwellInputs != null
        ? dwellInputs.stations.reduce(
            (sum, station) => sum + Math.max(0, station.dwellSeconds ?? 0),
            0,
          )
        : Math.max(0, block.dwellSeconds);
    return {
      topologyMinSeconds: travel?.minTravelTimeSeconds ?? route?.minTravelTimeSeconds ?? null,
      topologyAvgSeconds: travel?.avgTravelTimeSeconds ?? route?.avgTravelTimeSeconds ?? null,
      actualTravelSeconds: block.travelSeconds,
      dwellBaseSeconds,
      dwellSlackSeconds,
      switchBufferSeconds: normalizeSwitchBufferAfterSeconds(route?.switchBufferAfterSeconds),
      recoverySeconds: normalizeMinimumRecoveryTimeSeconds(minimumRecoveryTimeSeconds),
    };
  }, [
    block,
    minimumRecoveryTimeSeconds,
    route,
  ]);

  const topologyLegs = useMemo(
    () => route?.stationLegTravels ?? [],
    [route?.stationLegTravels],
  );

  const showStationInfo = Boolean(block.routeName) && block.taskType === 'passenger';
  /**
   * 整備任務卡（充電／洗車／保養／行檢／待命）：每一張都要有 ⓘ 可看設施與時長。
   *
   * 暫停卡掛的是 <code>taskType: 'idle'</code>（不能掛 standby，會被整備轉場機制
   * 重複服務），但它一樣是「車停在某一台設施裡」的那段時間，ⓘ 要照給。
   */
  const isYardTask =
    YARD_TASK_TYPES_FOR_UI.has(block.taskType) || block.source === 'hold';

  const blockErrors = useMemo(
    () => matchIssuesForBlock(report?.errors, block.id, block.templateTaskId),
    [report, block.id, block.templateTaskId],
  );
  const blockWarnings = useMemo(
    () => matchIssuesForBlock(report?.warnings, block.id, block.templateTaskId),
    [report, block.id, block.templateTaskId],
  );
  const hasError = blockErrors.length > 0;
  const hasWarning = blockWarnings.length > 0;

  let extraBorderClass = '';
  let extraStyle: CSSProperties = {};
  if (highlighted) {
    extraBorderClass = 'border-2 border-red-500 ring-4 ring-red-500 shadow-[0_0_24px_rgba(239,68,68,1)] animate-pulse';
  } else if (hasError) {
    extraBorderClass = 'border border-red-500 shadow-[inset_0_0_4px_rgba(239,68,68,0.4),0_0_8px_rgba(239,68,68,0.5)] animate-pulse';
  } else if (hasWarning) {
    extraBorderClass = 'border border-amber-500 shadow-[inset_0_0_4px_rgba(245,158,11,0.4),0_0_8px_rgba(245,158,11,0.5)]';
  }

  const onStationInfoEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setStationHoverPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  };

  const onIssueIconEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setIssueHoverPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  };

  const onYardInfoEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setYardHoverPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  };

  const onMoveCardInfoEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMoveCardHoverPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  };

  const beginInteractiveDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: 'move' | 'resize-start' | 'resize-end',
  ) => {
    if (!interactiveOnSegments || block.source !== 'template_bar') return;
    if (!onCommitTimeRange && !onPreviewTimeRange) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(block.id);

    const track = event.currentTarget.closest('[data-schedule-track="true"]') as HTMLElement | null;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const originStart = block.plannedStartMinute;
    const originEnd = block.plannedEndMinute;
    const originDuration = originEnd - originStart;
    const minDurationMinutes = Math.max(
      MANUAL_MIN_DURATION_MINUTES,
      resolveManualBlockMinDurationMinutes(block),
    );
    // 位移一律用不夾範圍的版本：格線無限捲動，游標很容易跑到相鄰的日拷貝上，
    // 夾在 [0, 1440] 的話往左拖到 00:00 就再也動不了，接不回 23:xx。
    const pointerOriginMinute = minuteFromClientXUnbounded({
      clientX: event.clientX,
      trackLeft: trackRect.left,
      slotWidthPx,
      slotMinutes: GRID_SLOT_MINUTES,
    });
    let lastStart = originStart;
    let lastEnd = originEnd;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);

    const applyPreview = (start: number, end: number) => {
      lastStart = start;
      lastEnd = end;
      onPreviewTimeRange?.(block.id, start, end);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const pointerMinute = minuteFromClientXUnbounded({
        clientX: moveEvent.clientX,
        trackLeft: trackRect.left,
        slotWidthPx,
        slotMinutes: GRID_SLOT_MINUTES,
      });
      const delta = pointerMinute - pointerOriginMinute;
      if (mode === 'move') {
        // 整張卡搬移可以跨午夜接過去：起點繞回鐘面、時長不變，
        // 結束就自然落在 1440 之後——這正是既有跨夜卡的表示法，
        // 渲染端的 splitIntoDayCycleSegments 本來就吃得下。
        // 縮放（resize）不繞：那會讓卡片自己跨過自己的另一端，語意不明。
        const nextStart = wrapScheduleMinute(originStart + delta);
        applyPreview(nextStart, nextStart + originDuration);
        return;
      }
      if (mode === 'resize-start') {
        applyPreview(
          Math.min(originEnd - minDurationMinutes, Math.max(0, originStart + delta)),
          originEnd,
        );
        return;
      }
      applyPreview(
        originStart,
        Math.max(originStart + minDurationMinutes, originEnd + delta),
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        target.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
      if (lastStart !== originStart || lastEnd !== originEnd) {
        onCommitTimeRange?.(block.id, lastStart, lastEnd);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <>
      {daySegments.map((seg, segIndex) => {
        const rawLeftPx = (seg.startMinute / GRID_SLOT_MINUTES) * slotWidthPx;
        const rawWidthPx =
          ((seg.endMinute - seg.startMinute) / GRID_SLOT_MINUTES) * slotWidthPx;
        // 出場移動卡只有 30 秒，日尺度上幾乎是 0 px，給一個看得到的最小寬度；
        // 0 秒的同區域轉場卡再寬一點，因為它要塞得下代號與 ⓘ。
        const widthPx = isZeroDuration
          ? ZERO_DURATION_CARD_WIDTH_PX
          : Math.max(rawWidthPx, isMoveCard ? 22 : 4);
        // 0 秒的出廠卡掛在時刻左邊（前一段任務的尾巴），入廠卡掛在右邊
        // （後一段任務的頭），兩張各佔一側，不會疊在同一個點上互相蓋掉。
        const leftPx =
          isZeroDuration && block.source === 'yard_exit_move'
            ? rawLeftPx - widthPx
            : rawLeftPx;
        // 跨夜卡被日界切成頭尾兩段，兩段是<strong>同一張卡</strong>，內容要一樣——
        // 只有 DOM id 與 hover 卡這種「整份文件只能有一個」的東西掛在第一段上。
        const showChrome = true;
        const isPrimarySegment = segIndex === 0;
  return (
    <div
      key={`${block.id}-day-${segIndex}`}
      id={isPrimarySegment && primaryCopy ? `block-card-${block.id}` : undefined}
      className={`absolute isolate flex flex-col justify-center overflow-hidden rounded-[4px] px-1 ${
        isIdleLike ? 'schedule-task-inactive-overlay pointer-events-none' : ''
      } ${
        selected ? 'ring-2 ring-[#2B7FFF] ring-offset-1 ring-offset-zinc-950' : ''
      } ${selectable ? (interactiveOnSegments ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : 'pointer-events-none'} ${
        // 虛線邊框＝這張卡不佔時間（同區域 0 秒示意轉移），
        // 跟一般有長度的轉場卡一眼分得出來
        isZeroDuration ? 'border border-dashed border-zinc-100/60' : ''
      } ${extraBorderClass}`}
      style={{
        left: leftPx,
        width: widthPx,
        height: REAL_TASK_BAR_HEIGHT,
        top: REAL_TASK_BAR_TOP,
        backgroundColor: colors.bg,
        // 0 秒卡疊在整備卡的邊界上，要壓在上面才看得到
        zIndex: highlighted
          ? 50
          : isZeroDuration
            ? 4
            : (block.source === 'template_bar' ? 2 : 1),
        ...extraStyle,
      }}
      title={
        isMoveCard
          ? [
              `${code} · ${resolveMoveCardTitle(block)}`,
              block.source === 'yard_entry_move'
                ? `${block.yardExitStationLabel ?? block.yardExitStationId ?? i18n.t('shiftList.planGrid.currentStation')} → ${block.yardExitFacilityLabel ?? i18n.t('shiftList.planGrid.yardFacility')}`
                : `${block.yardExitFacilityLabel ?? i18n.t('shiftList.planGrid.yardFacility')} → ${block.yardExitStationLabel ?? block.yardExitStationId ?? i18n.t('shiftList.planGrid.transferStation')}`,
              `${timeLabel}${i18n.t('shiftList.planGrid.secondsParen', { seconds: block.travelSeconds })}`,
              isZeroDuration
                ? i18n.t('shiftList.planGrid.zeroTransferTitle')
                : '',
              block.source ? MOVE_CARD_HINT_BY_SOURCE[block.source] ?? '' : '',
              block.yardExitAteYardTail ? i18n.t('shiftList.planGrid.ateYardTailShort') : '',
            ]
              .filter(Boolean)
              .join('\n')
          : `${block.label}${block.yardFacilityLabel ? ` · ${block.yardFacilityLabel}` : ''}${block.yardFacilityUnavailable ? `\n${i18n.t('shiftList.planGrid.noFacilityHover')}` : ''} ${timeLabel}${isZeroDuration ? `\n${i18n.t('shiftList.planGrid.zeroDurationWarn')}` : ''}${hasError ? i18n.t('shiftList.planGrid.hasSevereError') : ''}${hasWarning ? i18n.t('shiftList.planGrid.hasWarning') : ''}`
      }
      role={selectable ? 'button' : undefined}
      tabIndex={selectable && isPrimarySegment && primaryCopy ? 0 : undefined}
      onClick={
        selectable
          ? (event) => {
              event.stopPropagation();
              onSelect?.(block.id);
            }
          : undefined
      }
      onPointerDown={
        selectable && interactiveOnSegments
          ? (event) => beginInteractiveDrag(event, 'move')
          : undefined
      }
      onKeyDown={
        selectable && isPrimarySegment && primaryCopy
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(block.id);
              }
            }
          : undefined
      }
    >
      {interactiveOnSegments && selectable ? (
        <>
          <div
            className="absolute inset-y-0 left-0 z-[9] cursor-ew-resize"
            style={{ width: EDGE_HANDLE_PX }}
            onPointerDown={(event) => beginInteractiveDrag(event, 'resize-start')}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 right-0 z-[9] cursor-ew-resize"
            style={{ width: EDGE_HANDLE_PX }}
            onPointerDown={(event) => beginInteractiveDrag(event, 'resize-end')}
            aria-hidden
          />
          {(onDeleteBlock || onDuplicateBlock) ? (
            <div
              className="absolute top-0.5 z-[10] flex items-center gap-0.5"
              style={{ right: EDGE_HANDLE_PX + 14 }}
            >
              {onDeleteBlock ? (
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded text-zinc-300/80 transition hover:bg-black/25 hover:text-red-300"
                  title={t('shiftList.planGrid.deleteTrip')}
                  aria-label={t('shiftList.planGrid.deleteTrip')}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDeleteBlock(block.id);
                  }}
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              ) : null}
              {onDuplicateBlock ? (
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded text-zinc-300/80 transition hover:bg-black/25 hover:text-sky-300"
                  title={t('shiftList.planGrid.duplicateTrip')}
                  aria-label={t('shiftList.planGrid.duplicateTrip')}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDuplicateBlock(block.id);
                  }}
                >
                  <CopyPlus className="size-3" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {!isIdleLike && (
        <div
          className="absolute inset-y-0 left-0 z-[2] w-1"
          style={{ backgroundColor: hasError ? '#EF4444' : hasWarning ? '#F59E0B' : colors.bar }}
          aria-hidden
        />
      )}
      {inactiveRanges.map((range) => {
        // 跨夜條帶已改畫在 00:00 後，與絕對分鐘軸不成比例，略過 inactive 叠層
        if (
          durationMinutes <= 0
          || daySegments.length !== 1
          || block.plannedEndMinute > SCHEDULE_DAY_MINUTES + 1e-9
          || block.plannedStartMinute >= SCHEDULE_DAY_MINUTES - 1e-9
        ) {
          return null;
        }
        const leftPct =
          ((range.start - block.plannedStartMinute) / durationMinutes) * 100;
        const widthPct = ((range.end - range.start) / durationMinutes) * 100;
        return (
          <div
            key={`${range.start}-${range.end}`}
            className="schedule-task-inactive-overlay pointer-events-none absolute inset-y-0 z-[4]"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            aria-hidden
          />
        );
      })}
      {isMoveCard ? (
        <button
          type="button"
          className="pointer-events-auto absolute inset-0 z-[6] flex items-center justify-center text-zinc-100/80 hover:text-zinc-50"
          aria-label={t('shiftList.planGrid.cardContentAria', { code, title: resolveMoveCardTitle(block) })}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={onMoveCardInfoEnter}
          onPointerLeave={() => setMoveCardHoverPos(null)}
        >
          <span className="text-[9px] font-bold leading-none tracking-tight">
            {moveCardPrefix ?? '·'}
          </span>
          <Info className="ml-0.5 size-2.5 shrink-0 opacity-70" aria-hidden />
        </button>
      ) : null}
      {showChrome && !isMoveCard ? (
      <ScrollPinnedCardLabel
        cardLeftPx={trackOffsetPx + leftPx}
        cardWidthPx={widthPx}
        insetPx={leadingInsetPx}
        rowLabelWidth={ROW_LABEL_WIDTH}
        className="relative z-[6] w-fit min-w-0 max-w-full self-start px-1 will-change-transform"
      >
        <div
          className="flex items-center gap-1 truncate text-xs font-semibold leading-tight"
          style={{ color: hasError ? '#FCA5A5' : hasWarning ? '#FDE68A' : colors.text }}
        >
          {hasError || hasWarning ? (
            <button
              type="button"
              className="pointer-events-auto relative z-[8] inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 hover:bg-white/10"
              aria-label={t('shiftList.planGrid.issueContentAria', { code, kind: hasError ? t('shiftList.planGrid.error') : t('shiftList.planGrid.warning') })}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={onIssueIconEnter}
              onPointerLeave={() => setIssueHoverPos(null)}
            >
              <AlertTriangle
                className={
                  hasError
                    ? 'size-3 shrink-0 text-red-400'
                    : 'size-3 shrink-0 text-amber-400'
                }
                aria-hidden
              />
            </button>
          ) : null}
          <span className="truncate">{code}</span>
        </div>
        {block.routeName ? (
          <div className="flex min-w-0 items-center gap-0.5 truncate text-[11px] leading-tight text-zinc-200/90 font-medium">
            <span className="truncate">{block.routeName}</span>
            {showStationInfo ? (
              <button
                type="button"
                className="pointer-events-auto relative z-[8] inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-zinc-300 opacity-80 hover:bg-white/10 hover:opacity-100"
                aria-label={t('shiftList.planGrid.algoParamsAria', { route: block.routeName })}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={onStationInfoEnter}
                onPointerLeave={() => setStationHoverPos(null)}
              >
                <Info className="size-2.5" aria-hidden />
              </button>
            ) : (
            <Info className="size-2.5 shrink-0 opacity-70" aria-hidden />
            )}
          </div>
        ) : (
          <div
            className="flex min-w-0 items-center gap-0.5 truncate text-[11px] leading-tight opacity-90 font-medium"
            style={{ color: block.yardFacilityUnavailable ? '#FCA5A5' : colors.text }}
          >
            <span className="truncate">
            {block.label}
              {block.yardFacilityLabel ? ` · ${block.yardFacilityLabel}` : ''}
              {/* 沒地方停是產能問題，必須直接寫在卡面——只放 hover 使用者不會發現 */}
              {block.yardFacilityUnavailable ? t('shiftList.planGrid.noFacilityAvail') : ''}
            </span>
            {isYardTask ? (
              <button
                type="button"
                className="pointer-events-auto relative z-[8] inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-zinc-300 opacity-80 hover:bg-white/10 hover:opacity-100"
                aria-label={t('shiftList.planGrid.facilityDurationAria', { code, label: block.label })}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={onYardInfoEnter}
                onPointerLeave={() => setYardHoverPos(null)}
              >
                <Info className="size-2.5" aria-hidden />
              </button>
            ) : null}
          </div>
        )}
        <div className="whitespace-nowrap text-[10px] tabular-nums leading-tight text-zinc-300 font-medium">
          {timeLabel}
        </div>
      </ScrollPinnedCardLabel>
      ) : null}
      {isPrimarySegment && yardHoverPos && isYardTask ? (
        <YardTaskHoverCard code={code} block={block} pos={yardHoverPos} />
      ) : null}
      {isPrimarySegment && stationHoverPos && showStationInfo ? (
        <BlockAlgorithmHoverCard
          routeName={block.routeName ?? block.label}
          blockCode={code}
          summary={algorithmSummary}
          stops={stationStops}
          legs={topologyLegs}
          pos={stationHoverPos}
          hideStrategyBuffers={hideStrategyBuffers}
          entryServiceBerthCheck={
            block.source === 'entry_service' ? block.entryServiceBerthCheck : undefined
          }
        />
      ) : null}
      {isPrimarySegment && issueHoverPos ? (
        <BlockIssueHoverCard
          blockCode={code}
          errors={blockErrors}
          warnings={blockWarnings}
          pos={issueHoverPos}
        />
      ) : null}
      {isMoveCard && moveCardHoverPos ? (
        <MoveCardHoverCard
          code={code}
          prefix={moveCardPrefix}
          block={block}
          pos={moveCardHoverPos}
        />
      ) : null}
    </div>
        );
      })}
    </>
  );
}

export type ShiftSchedulePlanGridProps = {
  plan: GeneratedSchedulePlan;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  templateTasks: ScheduleTask[];
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string | null) => void;
  report?: ShiftScheduleFeasibilityReport | null;
  highlightedBlockId?: string | null;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  /** Step 4 最低恢復時間；供班次卡 i 對照顯示 */
  minimumRecoveryTimeSeconds?: number | null;
  /** 手動製作：hover 不顯示換線／恢復參數 */
  hideStrategyBuffers?: boolean;
  /** Step 2 整備區塊代號；非正線班次代號用 */
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  /** 手動製作：隱藏時間模板任務列（僅留空白時間軸） */
  showTemplateTasks?: boolean;
  /** 手動製作：允許拖放／拖曳／縮放班次卡 */
  interactiveEdit?: boolean;
  onDropTaskType?: (timelineRow: number, startMinute: number, taskType: TaskTypeKey) => void;
  onCommitBlockTimeRange?: (
    blockId: string,
    startMinute: number,
    endMinute: number,
  ) => void;
  /** 拖曳中即時預覽（不寫入 Undo 歷史） */
  onPreviewBlockTimeRange?: (
    blockId: string,
    startMinute: number,
    endMinute: number,
  ) => void;
  onDeleteBlock?: (blockId: string) => void;
  onDuplicateBlock?: (blockId: string) => void;
  /** 時間刻度縮放倍率（工具列 −／＋）；1＝自動格寬 */
  zoom?: number;
};

export function ShiftSchedulePlanGrid({
  plan,
  intervals,
  attributes,
  templateTasks,
  selectedBlockId = null,
  onSelectBlock,
  report = null,
  highlightedBlockId = null,
  selectedRoutes = [],
  minimumRecoveryTimeSeconds = null,
  hideStrategyBuffers = false,
  sectionCodes = null,
  showTemplateTasks = true,
  interactiveEdit = false,
  onDropTaskType,
  onCommitBlockTimeRange,
  onPreviewBlockTimeRange,
  onDeleteBlock,
  onDuplicateBlock,
  zoom = 1,
}: ShiftSchedulePlanGridProps) {
  const { t } = useTranslation();
  const slotWidthPx = useMemo(
    // 下限 8px：縮到最小時整天仍要畫得出格線，不能塌成 0
    () => Math.max(8, Math.round(computeAutoSlotWidthPx(plan) * clampGridZoom(zoom))),
    [plan, zoom],
  );
  const activeIntervalRanges = useMemo(
    () => parseIntervalMinuteRanges(intervals.filter((slot) => !slot.isDraft)),
    [intervals],
  );
  const timeSlots = Array.from({ length: GRID_VISIBLE_SLOTS }, (_, index) => index);
  const rows = Array.from({ length: plan.scheduleRowCount }, (_, index) => index + 1);
  const blocksByRow = useMemo(() => {
    const map = new Map<number, GeneratedScheduleBlock[]>();
    for (const timeline of plan.timelines) {
      map.set(
        timeline.row,
        [...timeline.blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute),
      );
    }
    return map;
  }, [plan.timelines]);

  /**
   * 每列先算好「畫這張卡需要知道的一切」，跟捲動位置無關的部分只算一次。
   *
   * <strong>順序敏感</strong>：blockIndex 是班次代號的流水號、
   * previousPassengerBlock 是關節站時刻對齊的依據，兩者都必須從<strong>整列</strong>
   * 推出來。裁切一定要發生在這之後——先裁再編號的話，捲動到哪裡代號就變成什麼，
   * 那是災難。
   *
   * 順便把 previousPassengerBlock 從「每張卡各自往回掃一遍」（整列 O(n²)，
   * 這份班表一列 170 張卡、每次 render 都重掃）改成一次線性掃描帶著走。
   */
  const rowEntriesByRow = useMemo(() => {
    const map = new Map<
      number,
      Array<{
        block: GeneratedScheduleBlock;
        index: number;
        previousPassengerBlock: GeneratedScheduleBlock | null;
        /** 這張卡在鐘面上實際佔用的區間（跨午夜會有兩段），裁切用 */
        spans: Array<{ start: number; end: number }>;
        /** 卡面文字要往右讓出的寬度（開頭被 0 秒入廠卡壓住時） */
        leadingInsetPx: number;
      }>
    >();
    for (const [row, blocks] of blocksByRow) {
      const visible = blocks.filter((block) => block.source !== 'transition');
      // 0 秒入廠卡壓在哪些時刻上——同一時刻開始的整備卡要把卡面讓開
      const zeroEntryMinutes = new Set<number>();
      for (const block of visible) {
        if (block.source !== 'yard_entry_move') continue;
        if (block.plannedEndMinute - block.plannedStartMinute > 1e-9) continue;
        zeroEntryMinutes.add(
          Math.round(wrapScheduleMinute(block.plannedStartMinute) * 60),
        );
      }
      let previousPassengerBlock: GeneratedScheduleBlock | null = null;
      const entries = visible.map((block, index) => {
        const startSecond = Math.round(
          wrapScheduleMinute(block.plannedStartMinute) * 60,
        );
        const entry = {
          block,
          index,
          previousPassengerBlock,
          // 0 秒卡切不出區段，這裡要補回一個點，否則裁切階段就把它整張丟掉，
          // 卡片再怎麼給最小寬度也畫不出來
          spans: (() => {
            const segments = splitIntoDayCycleSegments(
              block.plannedStartMinute,
              block.plannedEndMinute,
            ).map((seg) => ({ start: seg.startMinute, end: seg.endMinute }));
            if (segments.length > 0) return segments;
            const point = wrapScheduleMinute(block.plannedStartMinute);
            return [{ start: point, end: point }];
          })(),
          leadingInsetPx:
            !isMoveCardBlockSource(block.source) && zeroEntryMinutes.has(startSecond)
              ? ZERO_DURATION_CARD_WIDTH_PX
              : 0,
        };
        if (block.taskType === 'passenger') previousPassengerBlock = block;
        return entry;
      });
      map.set(row, entries);
    }
    return map;
  }, [blocksByRow]);

  const { scrollRef, dayWidthPx, totalTrackWidthPx, dayCopies, viewWindow } =
    useDayCycleGridScroll<HTMLDivElement>({
      slotWidthPx,
      slotMinutes: GRID_SLOT_MINUTES,
      rowLabelWidth: ROW_LABEL_WIDTH,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        data-schedule-grid-scroll="true"
      >
        <div
          className="min-w-max"
          style={{ width: totalTrackWidthPx + ROW_LABEL_WIDTH }}
        >
          <div className="sticky top-0 z-10 bg-[#0c0c0e]/95 backdrop-blur-sm">
            <div className="flex border-b border-zinc-800/80">
              <div className="sticky left-0 z-20 w-12 shrink-0 border-r border-zinc-800/60 bg-[#0c0c0e]/95" />
              {dayCopies.map((copyIndex) => (
                <div
                  key={copyIndex}
                  className="relative flex shrink-0"
                  style={{ width: dayWidthPx }}
                >
                <ScheduleIntervalBackground
                  intervals={intervals.filter((slot) => !slot.isDraft)}
                  attributes={attributes}
                  slotWidthPx={slotWidthPx}
                    interactive
                />
                  {/* P5: 未服務運能缺口標記 */}
                  <UnservedPulseMarkers report={report} slotWidthPx={slotWidthPx} />
                  {/* 時刻標籤不裁切：144 個小 div ×3 的成本遠低於班次卡，
                      而且它們是 flex 子元素，撐出表頭的高度，抽掉會塌 */}
                {timeSlots.map((slot) => (
                  <div
                    key={slot}
                      className={`pointer-events-none relative z-[6] shrink-0 border-r border-zinc-800/40 py-2 pl-1 text-left text-[11px] tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS}`}
                    style={{ width: slotWidthPx }}
                  >
                    {formatSlotLabel(slot)}
                  </div>
                ))}
              </div>
              ))}
            </div>
          </div>

          {rows.map((row) => {
            const rowEntries = rowEntriesByRow.get(row) ?? [];
            const rowTemplateTasks = showTemplateTasks
              ? templateTasks.filter((t) => t.rowIndex === row)
              : [];
            const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
              if (!interactiveEdit || !onDropTaskType) return;
              if (!event.dataTransfer.types.includes('application/x-shift-block-type')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            };
            const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
              if (!interactiveEdit || !onDropTaskType) return;
              event.preventDefault();
              const taskType = event.dataTransfer.getData(
                'application/x-shift-block-type',
              ) as TaskTypeKey;
              if (!taskType) return;
              const trackRect = event.currentTarget.getBoundingClientRect();
              const startMinute = minuteFromClientX({
                clientX: event.clientX,
                trackLeft: trackRect.left,
                slotWidthPx,
                slotMinutes: GRID_SLOT_MINUTES,
              });
              onDropTaskType(row, startMinute, taskType);
            };
            return (
              <div key={row} className="relative flex border-b border-zinc-800/50">
                <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center border-r border-zinc-800/60 bg-zinc-950/90 text-xs text-zinc-500">
                  {String(row).padStart(2, '0')}
                </div>
                {dayCopies.map((copyIndex) => {
                  // 這一份拷貝在虛擬數線上的起點；跟 viewWindow 同一套座標
                  const visibleEntries = rowEntries.filter((entry) =>
                    isWithinDayCycleWindow(viewWindow, copyIndex, entry.spans),
                  );
                  return (
                    <div
                      key={copyIndex}
                      className="relative flex shrink-0"
                      style={{ width: dayWidthPx }}
                      data-schedule-track="true"
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={() => {
                        if (onSelectBlock && selectedBlockId) {
                          onSelectBlock(null);
                        }
                      }}
                    >
                  <div className="pointer-events-none absolute inset-0 z-0">
                    <ScheduleIntervalBackground
                      intervals={intervals.filter((slot) => !slot.isDraft)}
                      attributes={attributes}
                      slotWidthPx={slotWidthPx}
                    />
                  </div>
                      {rowTemplateTasks.map((task) => (
                        <TemplateTaskBar
                          key={task.id}
                          task={task}
                          slotWidthPx={slotWidthPx}
                        />
                      ))}
                      {visibleEntries.map((entry) => (
                    <ShiftScheduleBlockBar
                          key={`${entry.block.id}#${copyIndex}`}
                          block={entry.block}
                          blockIndex={entry.index}
                      slotWidthPx={slotWidthPx}
                      activeIntervalRanges={activeIntervalRanges}
                          selected={selectedBlockId === entry.block.id}
                          onSelect={onSelectBlock}
                          report={report}
                          highlighted={highlightedBlockId === entry.block.id}
                          selectedRoutes={selectedRoutes}
                          minimumRecoveryTimeSeconds={minimumRecoveryTimeSeconds}
                          sectionCodes={sectionCodes}
                          interactiveEdit={interactiveEdit}
                          hideStrategyBuffers={hideStrategyBuffers}
                          previousPassengerBlock={entry.previousPassengerBlock}
                          onCommitTimeRange={onCommitBlockTimeRange}
                          onPreviewTimeRange={onPreviewBlockTimeRange}
                          onDeleteBlock={onDeleteBlock}
                          onDuplicateBlock={onDuplicateBlock}
                          primaryCopy={copyIndex === PRIMARY_DAY_COPY_INDEX}
                          leadingInsetPx={entry.leadingInsetPx}
                          trackOffsetPx={ROW_LABEL_WIDTH + copyIndex * dayWidthPx}
                    />
                  ))}
                  <div style={{ width: slotWidthPx, height: ROW_HEIGHT_PX }} aria-hidden />
                </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/60 px-3 py-2 text-xs text-zinc-500">
        <Info className="size-3.5 shrink-0 text-zinc-600" aria-hidden />
        <span>
          {interactiveEdit
            ? t('shiftList.planGrid.hintManual')
            : onSelectBlock
              ? t('shiftList.planGrid.hintEditable')
              : t('shiftList.planGrid.hintReadonly')}
        </span>
        <span className="text-zinc-600">← →</span>
      </div>
    </div>
  );
}
