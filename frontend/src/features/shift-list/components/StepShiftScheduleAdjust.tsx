import { useTranslation } from 'react-i18next';
import {
  ScheduleEngineCancelledError,
  type ScheduleEngineProgress,
} from '../utils/schedule-engine/worker/runScheduleEngineInBackground';
import i18n from '../../../i18n';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2, Undo, Redo, Maximize2, Minimize2, X, CopyPlus, Filter, ClipboardList, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import {
  buildAttributeIntervalLegends,
  parseStoredTemplateBody,
  type TimeSlotAttribute,
  type TimeSlotInterval,
  type ScheduleTask,
  type TaskTypeKey,
} from '../../time-templates/types/editor';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import { AttributeLegendBadgeChip } from '../../time-templates/components/AttributeLegendBadgeChip';
import type { ShiftScheduleCreateDraft, ShiftScheduleSelectedRoute } from '../types/create';
import { isShiftScheduleOutputFresh } from '../types/create';
import { buildScheduleAnalysisReport } from '../utils/buildScheduleAnalysisReport';
import { loadShiftRouteGroupCatalog } from '../utils/shiftRouteGroupCatalog';
import {
  SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
  normalizeMinimumRecoveryTimeSeconds,
} from '../utils/schedule-engine/physics';
import { ScheduleAnalysisReportPanel } from './ScheduleAnalysisReportPanel';
import { ScheduleTimeZoomToolbar } from './ScheduleTimeZoomToolbar';
import {
  PUBLISH_STATE_LABEL,
  buildSafetySettingsFingerprint,
  resolveSchedulePublishState,
  runSchedulePublishCheck,
  toPublishCheckRecord,
  type SchedulePublishCheckRecord,
} from '../utils/schedulePublishCheck';
import {
  buildShiftScheduleStoredOutput,
  trimPlanAdjustHistoryForPersist,
} from '../utils/buildShiftScheduleOutput';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  PlanAdjustHistoryEntry,
  ShiftScheduleFeasibilityReport,
  ShiftScheduleStoredOutput,
} from '../utils/shiftScheduleEngine.types';
import {
  resolveFeasibilityIssueMeta,
  type FeasibilityIssueKind,
} from '../utils/schedule-engine/feasibilityIssueMeta';
import {
  computeScheduleGateOk,
  evaluateScheduleAcceptance,
  layerSortKey,
  resolveIssueDisplayLayerFromIssue,
} from '../utils/scheduleAcceptance';
import {
  resolveGeneratedBlockTripCode,
  type MaintenanceSectionCodeBySection,
} from '../utils/maintenanceSectionCode';
import { scrollScheduleGridToBlock } from '../utils/locateScheduleBlock';
import { ShiftSchedulePlanGrid } from './ShiftSchedulePlanGrid';
import { CapacityTrendChart } from './CapacityTrendChart';
import { ManualScheduleEditorSidebar } from './ManualScheduleEditorSidebar';
import {
  applyManualBlockDwells,
  applyManualBlockRoute,
  applyManualBlockTimeRange,
  deleteManualScheduleBlock,
  duplicateManualScheduleBlock,
  hydrateManualPlanStationDwellsFromRoutes,
  insertManualScheduleBlock,
} from '../utils/manualScheduleEdit';
import {
  validateTimelineOverlaps,
  validatePassengerHeadway,
  validateRouteSwitchBuffers,
  validateTimelineCapacity,
  validateRotationCyclesComplete,
} from '../utils/schedule-engine/validate';

type AdjustTab = 'schedule' | 'capacity';

function applyHistoryToOutput(
  base: ShiftScheduleStoredOutput,
  history: PlanAdjustHistoryEntry[],
  historyIndex: number,
): ShiftScheduleStoredOutput {
  const entry = history[historyIndex];
  if (!entry) return base;
  // 畫面用的 plan 取自「未裁切」的目前位置；只有要寫進草稿的歷史才裁切
  const persisted = trimPlanAdjustHistoryForPersist(history, historyIndex);
  return {
    ...base,
    generatedAt: entry.plan.generatedAt,
    plan: entry.plan,
    feasibilityReport: entry.feasibilityReport,
    planAdjustHistory: persisted.history,
    planAdjustHistoryIndex: persisted.historyIndex,
  };
}

function resolveHistoryFromOutput(
  storedOutput: ShiftScheduleStoredOutput,
): { history: PlanAdjustHistoryEntry[]; historyIndex: number } {
  if (storedOutput.planAdjustHistory && storedOutput.planAdjustHistory.length > 0) {
    const historyIndex = Math.min(
      Math.max(0, storedOutput.planAdjustHistoryIndex ?? 0),
      storedOutput.planAdjustHistory.length - 1,
    );
    return { history: storedOutput.planAdjustHistory, historyIndex };
  }
  if (storedOutput.plan) {
    return {
      history: [{ plan: storedOutput.plan, feasibilityReport: storedOutput.feasibilityReport }],
      historyIndex: 0,
    };
  }
  return { history: [], historyIndex: -1 };
}

function kindBadgeClass(kind: FeasibilityIssueKind, severity: 'error' | 'warning'): string {
  if (kind === 'policy') {
    return severity === 'error'
      ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
      : 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  }
  if (kind === 'limit') {
    return severity === 'error'
      ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
      : 'border-violet-500/40 bg-violet-500/10 text-violet-200';
  }
  return severity === 'error'
    ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
}

/** 能對到班次卡才算可跳轉；參數／整輪類議題通常沒有目標。 */
function resolveFeasibilityIssueJumpBlockId(
  issue: FeasibilityIssue,
  plan: GeneratedSchedulePlan,
): string | null {
  const d = issue.detail;
  if (!d) return null;

  if (typeof d.blockId === 'string') return d.blockId;
  if (typeof d.yardBlockId === 'string') return d.yardBlockId;
  if (typeof d.passengerBlockId === 'string') return d.passengerBlockId;
  if (typeof d.nextBlockId === 'string') return d.nextBlockId;
  if (typeof d.laterBlockId === 'string') return d.laterBlockId;
  if (typeof d.earlierBlockId === 'string') return d.earlierBlockId;

  if (typeof d.routeId === 'string' && typeof d.laterDepartureMinute === 'number') {
    for (const timeline of plan.timelines) {
      const found = timeline.blocks.find(
        (b) =>
          b.routeId === d.routeId
          && Math.abs(b.plannedStartMinute - (d.laterDepartureMinute as number)) < 1e-9,
      );
      if (found) return found.id;
    }
  }
  if (typeof d.routeId === 'string' && typeof d.earlierDepartureMinute === 'number') {
    for (const timeline of plan.timelines) {
      const found = timeline.blocks.find(
        (b) =>
          b.routeId === d.routeId
          && Math.abs(b.plannedStartMinute - (d.earlierDepartureMinute as number)) < 1e-9,
      );
      if (found) return found.id;
    }
  }
  if (typeof d.timelineRow === 'number') {
    const timeline = plan.timelines.find((item) => item.row === d.timelineRow);
    return timeline?.blocks[0]?.id ?? null;
  }
  return null;
}

function findPlanBlock(
  plan: GeneratedSchedulePlan,
  blockId: string,
): { block: GeneratedScheduleBlock; index: number } | null {
  for (const timeline of plan.timelines) {
    const index = timeline.blocks.findIndex((b) => b.id === blockId);
    if (index >= 0) return { block: timeline.blocks[index]!, index };
  }
  return null;
}

/** 每則議題對應的班次代號（與甘特卡相同規則） */
function resolveFeasibilityIssueTripCode(
  issue: FeasibilityIssue,
  plan: GeneratedSchedulePlan | null,
  sectionCodes?: MaintenanceSectionCodeBySection | null,
): string {
  const fromDetail = issue.detail?.tripCode;
  if (typeof fromDetail === 'string' && fromDetail.trim()) return fromDetail.trim();

  if (!plan) {
    const row = issue.detail?.timelineRow;
    return typeof row === 'number' ? `L${row}` : '----';
  }

  const blockId = resolveFeasibilityIssueJumpBlockId(issue, plan);
  if (blockId) {
    const found = findPlanBlock(plan, blockId);
    if (found) {
      return resolveGeneratedBlockTripCode(found.block, found.index, sectionCodes);
    }
  }

  const row = issue.detail?.timelineRow;
  if (typeof row === 'number') return `L${row}`;
  if (typeof issue.detail?.routeId === 'string') {
    const compact = String(issue.detail.routeId).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (compact) return compact.slice(0, 8);
  }
  return '----';
}

type IssueGroupModel = {
  key: string;
  code: FeasibilityIssue['code'];
  severity: 'error' | 'warning';
  issues: FeasibilityIssue[];
};

function groupFeasibilityIssues(
  errors: FeasibilityIssue[],
  warnings: FeasibilityIssue[],
): IssueGroupModel[] {
  const order: IssueGroupModel[] = [];
  const indexByKey = new Map<string, number>();

  const push = (issue: FeasibilityIssue, severity: 'error' | 'warning') => {
    const key = `${severity}:${issue.code}`;
    const existing = indexByKey.get(key);
    if (existing != null) {
      order[existing]!.issues.push(issue);
      return;
    }
    indexByKey.set(key, order.length);
    order.push({ key, code: issue.code, severity, issues: [issue] });
  };

  for (const issue of errors) push(issue, 'error');
  for (const issue of warnings) push(issue, 'warning');

  // 硬錯誤 → 極限 → 可調 → 策略
  return order.sort((a, b) => {
    const layerA = resolveIssueDisplayLayerFromIssue({
      code: a.code,
      severity: a.severity,
      kind: a.issues[0]?.kind,
    });
    const layerB = resolveIssueDisplayLayerFromIssue({
      code: b.code,
      severity: b.severity,
      kind: b.issues[0]?.kind,
    });
    const diff = layerSortKey(layerA) - layerSortKey(layerB);
    if (diff !== 0) return diff;
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}

/**
 * 警告照<strong>根因</strong>分組，不是照 issue code 分組。
 *
 * 真實資料上常見的樣子是「11 則警告、2 個根因」：8 則班距未承接全部來自尖峰
 * 車不夠、1 則沒地方停來自充電樁不夠。照 code 分組的話畫面上是三張並排的卡，
 * 使用者得自己推「這 8 則是不是同一件事」（2026-08-10 使用者要求）。
 *
 * 這一層<strong>只管顯示</strong>：底下仍然是原本那些 code 分組卡，順序、
 * 展開規則、跳轉行為全部不變。認不出根因的 code 落到「其他」，
 * 所以之後新增 code 也不會憑空消失。
 */
type RootCauseDefinition = {
  id: string;
  title: string;
  /** 這個根因底下會出現哪些 issue code */
  codes: ReadonlySet<string>;
  /** 為什麼這些警告是同一件事——收合狀態也看得到 */
  hint: string;
  /**
   * 這個根因多半是誰的後果（上游根因 id）。
   *
   * <strong>可能不只一個。</strong>停靠站不夠同時是「車不夠」與「整備設施不夠」的下游：
   * 車多會擠站位，設施不夠也會——車進不了廠就只能繼續佔著停靠站。
   * 只記一個上游會讓另一條因果線在畫面上消失。
   */
  consequenceOf?: readonly string[];
  /** 上游還在畫面上時，這裡該先按兵不動的理由 */
  deferHint?: string;
};

/**
 * 根因之間<strong>有方向</strong>。
 *
 * 「停靠站容量不夠」多半不是獨立的毛病，是上游的後果：車擠在終點站，是因為
 * 車比需要的多、或整備排不進去。把它跟上游並排成三張卡，使用者會以為要分別解
 * 三件事。
 *
 * 更糟的是<strong>互相矛盾</strong>的情形：車不夠與停靠站不夠同時出現時，
 * 加車會讓站位更糟、減車會讓班距更糟——使用者照著建議改，會在兩者之間來回，
 * 永遠改不動（2026-08-11 使用者原話：「多車不是、少車也不是、多暫停格不是、
 * 少也不是，這樣會進入死迴圈改不動，這個系統就會很難用」）。
 * 遇到這種情形要<strong>明講它是拉扯</strong>，並且指出不衝突的第三個方向。
 */
const ROOT_CAUSES: RootCauseDefinition[] = [
  {
    id: 'fleet',
    title: i18n.t('shiftList.scheduleAdjust.rootFleet'),
    codes: new Set([
      'UNSERVED_SERVICE_PULSE',
      'HEADWAY_BELOW_TARGET',
      'ROUTE_ORIGIN_AWAY_FROM_VEHICLE',
      'ROUTE_ALIGNED_TO_VEHICLE_LOCATION',
      'INSUFFICIENT_TIMELINES',
      'RECOVERY_INSUFFICIENT',
    ]),
    hint: i18n.t('shiftList.scheduleAdjust.rootFleetHint'),
  },
  {
    id: 'facility',
    consequenceOf: ['fleet'],
    title: i18n.t('shiftList.scheduleAdjust.rootYard'),
    codes: new Set([
      'MAINTENANCE_FACILITY_UNAVAILABLE',
      'MAINTENANCE_TRANSFER_UNRESOLVED',
      'MAINTENANCE_TRANSFER_REQUIRED_MISSING',
      'VEHICLE_LOCATION_DISCONTINUITY',
      'MAINTENANCE_FACILITY_YIELDED',
    ]),
    hint:
      i18n.t('shiftList.scheduleAdjust.rootYardHint'),
    deferHint: i18n.t('shiftList.scheduleAdjust.rootYardDefer'),
  },
  {
    id: 'berth',
    consequenceOf: ['fleet', 'facility'],
    title: i18n.t('shiftList.scheduleAdjust.rootBerth'),
    codes: new Set([
      'STATION_BERTH_COLLISION',
      'STATION_BERTH_PROTECTION_GAP',
      'STATION_BERTH_DELAYED',
      'STATION_BERTH_BACKUP_USED',
      'STATION_BERTH_RELIEF_INSERTED',
    ]),
    hint: i18n.t('shiftList.scheduleAdjust.rootBerthHint'),
    deferHint:
      i18n.t('shiftList.scheduleAdjust.rootBerthDefer'),
  },
  {
    id: 'geometry',
    consequenceOf: ['fleet', 'facility', 'berth'],
    title: i18n.t('shiftList.scheduleAdjust.rootGeometry'),
    codes: new Set(['GEOMETRY_NOT_CONVERGED']),
    hint: i18n.t('shiftList.scheduleAdjust.rootGeometryHint'),
    deferHint: i18n.t('shiftList.scheduleAdjust.rootGeometryDefer'),
  },
];

const OTHER_ROOT_CAUSE: RootCauseDefinition = {
  id: 'other',
  title: i18n.t('shiftList.scheduleAdjust.rootOther'),
  codes: new Set(),
  hint: i18n.t('shiftList.scheduleAdjust.rootOtherHint'),
};

function resolveRootCause(code: string): RootCauseDefinition {
  return ROOT_CAUSES.find((cause) => cause.codes.has(code)) ?? OTHER_ROOT_CAUSE;
}

function RootCauseSection({
  cause,
  issueCount,
  upstreamTitles,
  isSource,
  tensionNote,
  children,
}: {
  cause: RootCauseDefinition;
  issueCount: number;
  /** 上游根因也在畫面上時，標出「這多半是它們的後果」 */
  upstreamTitles?: string[];
  /** 這一項沒有任何上游在畫面上——它就是源頭，先動它 */
  isSource?: boolean;
  /** 這一項跟上游互相拉扯時要講的話——照建議改會來回改不動 */
  tensionNote?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-[12px] font-semibold text-zinc-100">{cause.title}</span>
        <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-400">
          {t('shiftList.scheduleAdjust.linkedIssues', { count: issueCount })}
        </span>
        {isSource ? (
          <span className="rounded border border-emerald-600/50 bg-emerald-950/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
            {t('shiftList.scheduleAdjust.fixFromHere')}
          </span>
        ) : null}
        {upstreamTitles && upstreamTitles.length > 0 ? (
          <span className="rounded border border-zinc-700/70 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {t('shiftList.scheduleAdjust.mostlyConsequence', { titles: upstreamTitles.join('」「') })}
          </span>
        ) : null}
      </div>
      <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">{cause.hint}</p>
      {/*
        {t('shiftList.scheduleAdjust.deferBody')}
      */}
      {!isSource && cause.deferHint ? (
        <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
          <span className="text-zinc-400">{t('shiftList.scheduleAdjust.deferDontTouch')}</span>
          {cause.deferHint}
        </p>
      ) : null}
      {tensionNote ? (
        <p className="mb-1.5 rounded border border-amber-600/40 bg-amber-950/30 px-2 py-1 text-[10px] leading-4 text-amber-200">
          {tensionNote}
        </p>
      ) : null}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * 生成中的骨架。
 *
 * 原本是置中的轉圈 ＋ 一行字：整段時間畫面是空的，跑完才「啪」一下換成整張
 * 甘特圖，感覺很頓。改成先畫出<strong>跟結果同樣形狀</strong>的骨架——
 * 時間軸一列、下面幾列長短不一的條子——跑完換成真的內容時版面不會跳。
 *
 * 動畫<strong>只用 CSS 的 transform／opacity</strong>（見 index.css）。
 * 2026-09-30 起排班生成在背景執行緒跑（白皮書 GEN-15），主執行緒不再被卡住；進度由背景回報，
 * 可以按「取消生成」。
 */
function ScheduleGeneratingSkeleton({
  rowCount,
  progress,
  onCancel,
}: {
  rowCount: number;
  /** 背景執行緒回報的進度（生成在背景跑，主畫面仍可操作） */
  progress?: ScheduleEngineProgress | null;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const rows = Math.min(10, Math.max(4, rowCount));
  // 長短不一才像真的班表；固定序列，不用亂數（避免每次 render 都跳動）
  const widths = [82, 54, 68, 91, 47, 73, 60, 88, 51, 76];
  return (
        <div
      className="flex min-h-[320px] flex-1 flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3"
      role="status"
      aria-live="polite"
        >
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
        {t('shiftList.scheduleAdjust.generating')}
        {progress ? (
          <span className="text-zinc-500">
            {progress.message}（約 {Math.round(progress.fraction * 100)}%）
          </span>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            取消生成
          </button>
        ) : null}
        </div>
      {progress ? (
        <div className="h-1 w-full shrink-0 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-[#2B7FFF] transition-[width] duration-300" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
        </div>
      ) : null}
      {/* 時間軸 */}
      <div className="schedule-skeleton-bar h-4 w-full shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="schedule-skeleton-bar h-6 w-8 shrink-0" />
            <div
              className="schedule-skeleton-bar h-6"
              style={{
                width: `${widths[index % widths.length]}%`,
                // 每一列的呼吸與掃光各自錯開，看起來才不像整齊劃一的燈條
                animationDelay: `${(index % 5) * 0.18}s`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 引擎寫在 detail.searchLog 的搜尋過程（試過哪些候選、為什麼不採用）；主畫面只顯示結論。
 * 同一句重複出現（同一個候選在幾輪搜尋裡被拒絕同一個理由）合併成一行並標次數。
 */
function issueSearchLog(issue: FeasibilityIssue): string[] {
  const log = (issue.detail as { searchLog?: unknown } | undefined)?.searchLog;
  if (!Array.isArray(log)) return [];
  const counts = new Map<string, number>();
  for (const line of log) {
    if (typeof line !== 'string') continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()].map(([line, count]) => (count > 1 ? `${line}（×${count}）` : line));
}

function formatGeneratedClock(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-TW', { hour12: false });
}

function IssueSearchLog({ lines }: { lines: string[] }) {
  const { t } = useTranslation();
  if (lines.length === 0) return null;
  return (
    <details className="mt-1 rounded border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-zinc-400">
      <summary className="cursor-pointer select-none text-zinc-300">
        {t('shiftList.scheduleAdjust.searchLog', { count: lines.length })}
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {lines.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
    </details>
  );
}

function IssueGroupCard({
  group,
  plan,
  sectionCodes,
  defaultExpanded,
  onIssueClick,
}: {
  group: IssueGroupModel;
  plan: GeneratedSchedulePlan | null;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  defaultExpanded: boolean;
  onIssueClick: (issue: FeasibilityIssue) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const sample = group.issues[0]!;
  const meta = resolveFeasibilityIssueMeta(sample);
  const shellBase =
    group.severity === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : meta.kind === 'policy'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
        : meta.kind === 'limit'
          ? 'border-violet-500/30 bg-violet-500/10 text-violet-100'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  const icon =
    group.severity === 'error'
      ? 'text-red-400'
      : meta.kind === 'policy'
        ? 'text-sky-300'
        : meta.kind === 'limit'
          ? 'text-violet-300'
          : 'text-amber-400';
  const jumpHint =
    group.severity === 'error' ? 'text-red-400/90' : meta.kind === 'policy'
      ? 'text-sky-300/90'
      : meta.kind === 'limit'
        ? 'text-violet-300/90'
        : 'text-amber-400/90';

  return (
    <div className={`rounded-lg border ${shellBase}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/[0.03]"
        aria-expanded={expanded}
      >
        <AlertCircle className={`mt-0.5 size-4 shrink-0 ${icon}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${kindBadgeClass(meta.kind, group.severity)}`}
            >
              {meta.kindLabel}
            </span>
            <span className="text-sm font-medium text-zinc-100">{meta.groupTitle}</span>
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-400">
              {t('shiftList.scheduleAdjust.issueCount', { count: group.issues.length })}
            </span>
        </div>
          {!expanded ? (
            <div className="mt-1 truncate text-[11px] opacity-70">
              {group.issues
                .slice(0, 3)
                .map((issue) => resolveFeasibilityIssueTripCode(issue, plan, sectionCodes))
                .join(' · ')}
              {group.issues.length > 3 ? t('shiftList.scheduleAdjust.moreIssues', { count: group.issues.length - 3 }) : ''}
            </div>
          ) : null}
        </div>
        {expanded ? (
          <ChevronDown className="mt-0.5 size-4 shrink-0 opacity-70" />
        ) : (
          <ChevronRight className="mt-0.5 size-4 shrink-0 opacity-70" />
        )}
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-white/10 px-3 py-2">
          <p className="text-[11px] leading-relaxed opacity-80">{meta.guidance}</p>
          <ul className="space-y-1.5">
            {group.issues.map((issue, index) => {
              const tripCode = resolveFeasibilityIssueTripCode(issue, plan, sectionCodes);
              const jumpable =
                plan != null && resolveFeasibilityIssueJumpBlockId(issue, plan) != null;
              const rowKey = `${group.key}-${index}-${tripCode}-${issue.message}`;
              const searchLog = issueSearchLog(issue);
              if (jumpable) {
                return (
                  <li key={rowKey} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => onIssueClick(issue)}
                      className="flex w-full items-start gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-left transition hover:border-white/25 hover:bg-black/30"
                    >
                      <span className="shrink-0 rounded border border-white/15 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-zinc-100">
                        {tripCode}
                      </span>
                      <span className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-200">
                        {issue.message}
                      </span>
                      <span className={`shrink-0 text-[10px] ${jumpHint}`}>{t('shiftList.scheduleAdjust.jump')}</span>
                    </button>
                    <IssueSearchLog lines={searchLog} />
                  </li>
                );
              }
              return (
                <li
                  key={rowKey}
                  className="flex items-start gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2"
                >
                  <span className="shrink-0 rounded border border-white/15 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-zinc-100">
                    {tripCode}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-200">
                    {issue.message}
                    <IssueSearchLog lines={searchLog} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FeasibilityMessages({
  report,
  plan,
  sectionCodes,
  onIssueClick,
}: {
  report: ShiftScheduleFeasibilityReport;
  plan: GeneratedSchedulePlan | null;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  onIssueClick: (issue: FeasibilityIssue) => void;
}) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'all' | 'hard' | 'hidePolicy'>('hidePolicy');

  const acceptance = useMemo(() => evaluateScheduleAcceptance(report), [report]);

  const groups = useMemo(
    () => groupFeasibilityIssues(report.errors, report.warnings),
    [report.errors, report.warnings],
  );

  const errorCount = report.errors.length;
  const warningCount = report.warnings.length;
  const visibleGroups = groups.filter((g) => {
    if (viewMode === 'hard') return resolveIssueDisplayLayerFromIssue({ code: g.code, severity: g.severity, kind: g.issues[0]?.kind }) === 'hard';
    if (viewMode === 'hidePolicy') {
      const layer = resolveIssueDisplayLayerFromIssue({
        code: g.code,
        severity: g.severity,
        kind: g.issues[0]?.kind,
      });
      return layer !== 'policy';
    }
    return true;
  });

  if (groups.length === 0) return null;
  const unresolvedCount = Math.max(errorCount, acceptance.publishBlockingCount);

  return (
    <div className="mb-4 space-y-2">
      <div className="mb-2 space-y-1.5 px-1">
        {/* 計算已經結束：講清楚是「算完了、還有問題」，不是還在算 */}
        <div className="text-[11px] text-zinc-400" role="status">
          {acceptance.gatePassed
            ? t('shiftList.scheduleAdjust.calcDonePassed', { time: formatGeneratedClock(plan?.generatedAt) })
            : t('shiftList.scheduleAdjust.calcDoneWithIssues', {
              count: unresolvedCount,
              time: formatGeneratedClock(plan?.generatedAt),
            })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!acceptance.gatePassed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-400 ring-1 ring-red-500/30">
              <AlertCircle className="size-3 shrink-0" />
              {t('shiftList.scheduleAdjust.hardErrors', { count: Math.max(errorCount, acceptance.publishBlockingCount) })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/25">
              {t('shiftList.scheduleAdjust.hardPass')}
            </span>
          )}
          {acceptance.qualityPassed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300/90 ring-1 ring-emerald-500/20">
              {t('shiftList.scheduleAdjust.qualityPass')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-500/25">
              {t('shiftList.scheduleAdjust.qualityFail')}
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-[11px] text-zinc-500">
              {t('shiftList.scheduleAdjust.warnings', { count: warningCount })}
              {acceptance.policyNoiseCount > 0
                ? t('shiftList.scheduleAdjust.policyNoise', { count: acceptance.policyNoiseCount })
                : ''}
            </span>
          )}
          <div className="flex-1" />
          <div className="inline-flex rounded-full bg-zinc-900/80 p-0.5 ring-1 ring-zinc-700/80">
            {(
              [
                ['hidePolicy', t('shiftList.scheduleAdjust.filterHidePolicy')],
                ['hard', t('shiftList.scheduleAdjust.filterHard')],
                ['all', t('shiftList.scheduleAdjust.filterAll')],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                  viewMode === mode
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {mode === 'hidePolicy' ? <Filter className="size-3 shrink-0" /> : null}
                {label}
              </button>
      ))}
    </div>
        </div>
        <p className="text-[10px] leading-4 text-zinc-500">
          {t('shiftList.scheduleAdjust.gateHint')}
        </p>
      </div>
      {/*
        先照根因收攏，再放原本的 code 分組卡。visibleGroups 已經排好序
        （硬錯誤 → 極限 → 可調 → 策略），這裡照它第一次出現的順序決定根因順序，
        所以最嚴重的根因仍然排在最前面。
      */}
      {[...ROOT_CAUSES, OTHER_ROOT_CAUSE]
        .map((cause) => ({
          cause,
          groups: visibleGroups.filter((group) => resolveRootCause(group.code) === cause),
        }))
        .filter((entry) => entry.groups.length > 0)
        /*
          上游一定要排在下游前面。
          原本只照嚴重度排（visibleGroups 的順序），而下游的症狀往往比上游更嚴重
          ——站位碰撞是硬錯誤、車不夠只是警告——於是「從這裡改」會出現在畫面下方，
          使用者照順序看，第一眼看到的正好是最不該先動的那一項。
          先照因果深度排，同深度才回頭照嚴重度。
        */
        .sort((a, b) => {
          const depthOf = (
            cause: RootCauseDefinition,
            present: Set<string>,
            seen: Set<string> = new Set(),
          ): number => {
            if (seen.has(cause.id)) return 0;
            seen.add(cause.id);
            const upstream = (cause.consequenceOf ?? [])
              .filter((id) => present.has(id))
              .map((id) => ROOT_CAUSES.find((item) => item.id === id))
              .filter((item): item is RootCauseDefinition => Boolean(item));
            if (upstream.length === 0) return 0;
            return 1 + Math.max(...upstream.map((item) => depthOf(item, present, seen)));
          };
          const present = new Set(
            [...ROOT_CAUSES, OTHER_ROOT_CAUSE]
              .filter((cause) =>
                visibleGroups.some((group) => resolveRootCause(group.code) === cause))
              .map((cause) => cause.id),
          );
          const depthDiff = depthOf(a.cause, present) - depthOf(b.cause, present);
          if (depthDiff !== 0) return depthDiff;
          return visibleGroups.indexOf(a.groups[0]!) - visibleGroups.indexOf(b.groups[0]!);
        })
        .map(({ cause, groups }, _index, entries) => {
          /**
           * 只列<strong>畫面上真的有</strong>的上游。因果圖是靜態的，但這一次生成
           * 未必每個節點都出問題——標一個沒出現的上游只會讓人去找不存在的東西。
           */
          const upstreams = (cause.consequenceOf ?? [])
            .map((id) => entries.find((entry) => entry.cause.id === id)?.cause)
            .filter((item): item is RootCauseDefinition => Boolean(item));
          /**
           * 「車不夠」與下游同時出現＝互相拉扯：加車讓站位與設施更擠、減車讓班距更差。
           * 照單項建議改會在兩者之間來回，永遠改不動（使用者原話：「多車不是、少車也
           * 不是……這樣會進入死迴圈改不動」）。這時必須明講，並指出<strong>不衝突</strong>
           * 的第三個方向。
           */
          const tensionNote = upstreams.some((item) => item.id === 'fleet')
            ? t('shiftList.scheduleAdjust.tugOfWar')
            : undefined;
          return (
          <RootCauseSection
            key={cause.id}
            cause={cause}
            issueCount={groups.reduce((sum, group) => sum + group.issues.length, 0)}
            upstreamTitles={upstreams.map((item) => item.title)}
            /** 沒有任何上游在畫面上＝它就是源頭，動這裡才有槓桿 */
            isSource={upstreams.length === 0}
            tensionNote={tensionNote}
          >
            {groups.map((group) => {
              const layer = resolveIssueDisplayLayerFromIssue({
                code: group.code,
                severity: group.severity,
                kind: group.issues[0]?.kind,
              });
              return (
                <IssueGroupCard
                  key={group.key}
                  group={group}
                  plan={plan}
                  sectionCodes={sectionCodes}
                  defaultExpanded={
                    layer === 'hard' || (layer !== 'policy' && group.issues.length === 1)
                  }
                  onIssueClick={onIssueClick}
                />
              );
            })}
          </RootCauseSection>
          );
        })}
    </div>
  );
}



function revalidatePlan(
  plan: GeneratedSchedulePlan,
  selectedRoutes: ShiftScheduleSelectedRoute[],
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): ShiftScheduleFeasibilityReport {
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];
  const allBlocks = plan.timelines.flatMap((t) => t.blocks);
  const routeById = new Map(selectedRoutes.map((r) => [r.routeId, r] as const));

  validateTimelineOverlaps(plan.timelines, errors);
  validateRotationCyclesComplete(
    plan.timelines,
    selectedRoutes.filter((route) => !route.backupForInstanceId && !route.backupForRouteId).length,
    errors,
  );
  validateRouteSwitchBuffers(plan.timelines, routeById, errors);
  validatePassengerHeadway(
    allBlocks,
    intervals,
    attributes,
    routeById,
    errors,
    warnings,
    plan.scheduleRowCount,
  );
  validateTimelineCapacity(
    allBlocks.filter((b) => b.taskType === 'passenger' && b.source === 'template_bar'),
    plan.scheduleRowCount,
    intervals,
    attributes,
    routeById,
    warnings,
  );

  return {
    ok: computeScheduleGateOk(errors, warnings),
    errors,
    warnings,
  };
}

type StepShiftScheduleAdjustProps = {
  draft: ShiftScheduleCreateDraft;
  shiftId?: string;
  onScheduleOutputReady: (
    output: ShiftScheduleStoredOutput,
    options?: { flush?: boolean },
  ) => void | Promise<void>;
};

/**
 * 生成沒有產出班表時，把報告裡的錯誤原因列出來（沒選地圖、缺路段行駛時間、沒有關聯圖……）。
 * 只顯示「無法生成」而不講原因，使用者無從下手。每一則原因一行，最多 8 則，其餘以數量帶過。
 */
function describeGenerationFailure(
  headline: string,
  report: { errors?: Array<{ message?: string }> } | null | undefined,
): string {
  const reasons = (report?.errors ?? [])
    .map((issue) => issue.message?.trim())
    .filter((message): message is string => Boolean(message));
  if (reasons.length === 0) return headline;
  const shown = reasons.slice(0, 8).map((message) => `• ${message}`);
  if (reasons.length > shown.length) shown.push(`…另有 ${reasons.length - shown.length} 則`);
  return `${headline}：\n${shown.join('\n')}`;
}

export function StepShiftScheduleAdjust({
  draft,
  shiftId,
  onScheduleOutputReady,
}: StepShiftScheduleAdjustProps) {
  const { t } = useTranslation();
  const isManual = draft.creationMode === 'manual';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 生成在背景執行緒跑：目前這一次的取消控制與進度（新的一次開始就取消舊的，舊結果不會蓋掉新的） */
  const generationAbortRef = useRef<AbortController | null>(null);
  const [generationProgress, setGenerationProgress] = useState<ScheduleEngineProgress | null>(null);
  const startGeneration = () => {
    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;
    setGenerationProgress(null);
    return controller;
  };
  const cancelGeneration = () => {
    generationAbortRef.current?.abort();
  };
  const [plan, setPlan] = useState<GeneratedSchedulePlan | null>(null);
  const planRef = useRef<GeneratedSchedulePlan | null>(null);
  planRef.current = plan;
  const [report, setReport] = useState<ShiftScheduleFeasibilityReport | null>(null);
  const [showAnalysisReport, setShowAnalysisReport] = useState(false);
  const [publishCheck, setPublishCheck] = useState<SchedulePublishCheckRecord | null>(
    draft.scheduleOutput?.publishCheck ?? null,
  );
  const [checkingPublish, setCheckingPublish] = useState(false);
  const [intervals, setIntervals] = useState<TimeSlotInterval[]>([]);
  const [attributes, setAttributes] = useState<TimeSlotAttribute[]>([]);
  const [templateTasks, setTemplateTasks] = useState<ScheduleTask[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  /** 從報表定位過來、明細要釘住打開的那張卡；選別張卡就收起 */
  const [pinnedDetailBlockId, setPinnedDetailBlockId] = useState<string | null>(null);
  /** 上一次定位找不到的卡片（班表改過了），報表裡明確提示 */
  const [missingLocateBlockId, setMissingLocateBlockId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [history, setHistory] = useState<PlanAdjustHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isMaximized, setIsMaximized] = useState(false);
  /** 時間刻度縮放；1＝自動格寬（依最短班次算出「時間字串塞得下」的寬度） */
  const [gridZoom, setGridZoom] = useState(1);
  const [activeTab, setActiveTab] = useState<AdjustTab>('schedule');
  const [vehicleCapacity, setVehicleCapacity] = useState(50);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  useEffect(() => {
    undoRef.current = handleUndo;
    redoRef.current = handleRedo;
  });

  useEffect(() => {
    if (!isManual) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // 手動製作：即使焦點在側欄輸入框，也以班表歷史為準（欄位多為即時寫入）
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey && !event.altKey;
      const isRedo =
        (key === 'z' && event.shiftKey && !event.altKey)
        || (key === 'y' && !event.shiftKey && !event.altKey);

      if (isUndo) {
        event.preventDefault();
        undoRef.current();
        return;
      }
      if (isRedo) {
        event.preventDefault();
        redoRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isManual]);

  // 重生成確認 modal：Enter 預設取消（不會誤重算）
  useEffect(() => {
    if (!showRebuildConfirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        setShowRebuildConfirm(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showRebuildConfirm]);

  useEffect(() => {
    if (!duplicateWarning) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        setDuplicateWarning(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicateWarning]);

  useEffect(() => {
    let cancelled = false;
    let effectController: AbortController | null = null;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        let storedOutput = draft.scheduleOutput;
        const needsRegen = !storedOutput?.plan || !isShiftScheduleOutputFresh(draft);

        if (needsRegen) {
          const controller = startGeneration();
          effectController = controller;
          storedOutput = await buildShiftScheduleStoredOutput(draft, {
            shiftId,
            signal: controller.signal,
            onProgress: (progress) => { if (!cancelled) setGenerationProgress(progress); },
          });
          if (cancelled) return;
          void onScheduleOutputReady(storedOutput, { flush: true });
        }

        if (!storedOutput) {
          throw new Error(i18n.t('shiftList.scheduleAdjust.genFailed'));
        }

        let templateDetail: Awaited<ReturnType<typeof fetchTimeTemplateDetail>>;
        try {
          templateDetail = await fetchTimeTemplateDetail(draft.timeTemplate.templateId);
        } catch (templateError) {
          // 班表已生成時，模板重載失敗不應蓋掉可行性報告（常見：Failed to fetch）
          if (cancelled) return;
          console.warn('[shift-schedule] time template reload failed', templateError);
          const { history: restoredHistory, historyIndex: restoredIndex } =
            resolveHistoryFromOutput(storedOutput);
          if (restoredHistory.length > 0 && restoredIndex >= 0) {
            const current = restoredHistory[restoredIndex]!;
            setHistory(restoredHistory);
            setHistoryIndex(restoredIndex);
            setPlan(current.plan);
            setReport(current.feasibilityReport);
          }
          setError(
            templateError instanceof Error
              ? i18n.t('shiftList.scheduleAdjust.templateReloadFailedDetail', { message: templateError.message })
              : i18n.t('shiftList.scheduleAdjust.templateReloadFailed'),
          );
          setLoading(false);
          return;
        }
        if (cancelled) return;

        const template = parseStoredTemplateBody(templateDetail.body ?? {});
        setIntervals(template.intervals.filter((slot) => !slot.isDraft));
        setAttributes(template.attributes.filter((attr) => !attr.isDraft));
        setTemplateTasks(template.tasks ?? []);
        setVehicleCapacity(template.vehicleCapacity);

        const { history: restoredHistory, historyIndex: restoredIndex } =
          resolveHistoryFromOutput(storedOutput);

        if (restoredHistory.length > 0 && restoredIndex >= 0) {
          const current = restoredHistory[restoredIndex]!;
          let nextPlan = current.plan;
          let nextHistory = restoredHistory;
          // 參數生成→手動複製的班次卡缺少各站靠站；進入手動介面時從路線設定補回
          if (draft.creationMode === 'manual') {
            const hydrated = hydrateManualPlanStationDwellsFromRoutes({
              plan: current.plan,
              routes: draft.routeGroups.selectedRoutes,
            });
            if (hydrated !== current.plan) {
              nextPlan = hydrated;
              nextHistory = restoredHistory.map((entry, index) =>
                index === restoredIndex
                  ? { ...entry, plan: hydrated }
                  : entry,
              );
              void onScheduleOutputReady(
                applyHistoryToOutput(storedOutput, nextHistory, restoredIndex),
                { flush: true },
              );
            }
          }
          setHistory(nextHistory);
          setHistoryIndex(restoredIndex);
          setPlan(nextPlan);
          setReport(current.feasibilityReport);
        } else {
          setPlan(null);
          setReport(null);
          setHistory([]);
          setHistoryIndex(-1);
          // 沒有產出班表時要講原因（例如沒選地圖、缺路段行駛時間、沒有關聯圖），不能只留空白
          if (!storedOutput.plan) {
            setError(describeGenerationFailure(i18n.t('shiftList.scheduleAdjust.genFailed'), storedOutput.feasibilityReport));
          }
        }
        setSelectedBlockId(null);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof ScheduleEngineCancelledError
              ? '已取消生成。設定沒有改變；按「重新生成」可以再跑一次。'
              : e instanceof Error ? e.message : String(e),
          );
          setPlan(null);
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // 換頁或設定改變：背景的那一次不再需要，終止它，結果也不會回來蓋掉新的
      effectController?.abort();
    };
  }, [
    draft.creationMode,
    draft.maintenanceTask,
    draft.timeTemplate,
    draft.routeGroups,
    onScheduleOutputReady,
    shiftId,
  ]);



  const periodLegends = useMemo(
    () => buildAttributeIntervalLegends(intervals, attributes),
    [attributes, intervals],
  );

  const undoShortcutLabel = useMemo(() => {
    const isMac =
      typeof navigator !== 'undefined'
      && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    return isMac ? '⌘Z' : 'Ctrl+Z';
  }, []);

  const redoShortcutLabel = useMemo(() => {
    const isMac =
      typeof navigator !== 'undefined'
      && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    return isMac ? '⇧⌘Z' : 'Ctrl+Y';
  }, []);

  const pushNewState = (
    newPlan: GeneratedSchedulePlan,
    newReport: ShiftScheduleFeasibilityReport,
  ) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    const newState: PlanAdjustHistoryEntry = { plan: newPlan, feasibilityReport: newReport };
    nextHistory.push(newState);
    const nextIndex = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryIndex(nextIndex);
    setPlan(newPlan);
    setReport(newReport);

    const base = draft.scheduleOutput;
    if (base) {
      void onScheduleOutputReady(
        applyHistoryToOutput(base, nextHistory, nextIndex),
        { flush: true },
      );
    }
  };

  const performRebuild = async () => {
    const snapshotHistory = history;
    const snapshotIndex = historyIndex;

    setLoading(true);
    setError(null);
    const controller = startGeneration();
    try {
      const storedOutput = await buildShiftScheduleStoredOutput(draft, {
        shiftId,
        signal: controller.signal,
        onProgress: (progress) => { if (generationAbortRef.current === controller) setGenerationProgress(progress); },
      });
      // 期間又開始了更新的一次：這個結果已過期，丟掉
      if (generationAbortRef.current !== controller) return;

      if (!storedOutput.plan) {
        throw new Error(describeGenerationFailure(i18n.t('shiftList.scheduleAdjust.regenFailed'), storedOutput.feasibilityReport));
      }

      const newEntry: PlanAdjustHistoryEntry = {
        plan: storedOutput.plan,
        feasibilityReport: storedOutput.feasibilityReport,
      };

      // 重新生成視為「新增一個版本」：讓 Undo 可以回到重生成前。
      const nextHistory = snapshotHistory.slice(0, snapshotIndex + 1);
      nextHistory.push(newEntry);
      const nextIndex = nextHistory.length - 1;

      setHistory(nextHistory);
      setHistoryIndex(nextIndex);
      setPlan(newEntry.plan);
      setReport(newEntry.feasibilityReport);
      setSelectedBlockId(null);

      void onScheduleOutputReady(
        applyHistoryToOutput(storedOutput, nextHistory, nextIndex),
        { flush: true },
      );
    } catch (e) {
      if (generationAbortRef.current !== controller && !(e instanceof ScheduleEngineCancelledError)) return;
      setError(
        e instanceof ScheduleEngineCancelledError
          ? '已取消重新生成，畫面保留原本的班表。'
          : e instanceof Error ? e.message : String(e),
      );
    } finally {
      if (generationAbortRef.current === controller) setLoading(false);
    }
  };

  const requestRebuild = () => setShowRebuildConfirm(true);



  const handleDeleteBlock = (blockId?: string) => {
    const targetId = blockId ?? selectedBlockId;
    if (!plan || !targetId) return;

    if (isManual) {
      const current = planRef.current;
      if (!current) return;
      const result = deleteManualScheduleBlock({ plan: current, blockId: targetId });
      if (!result) return;
      planRef.current = result.plan;
      pushNewState(result.plan, result.report);
      setSelectedBlockId((prev) => (prev === targetId ? null : prev));
      return;
    }

    // 1. 複製 plan 並過濾掉選取的 block
    const updatedTimelines = plan.timelines.map((timeline) => ({
      ...timeline,
      blocks: timeline.blocks.filter((b) => b.id !== targetId),
    }));

    const newPlan = {
      ...plan,
      timelines: updatedTimelines,
      generatedAt: new Date().toISOString(),
    };

    // 2. 重新物理可行性校驗
    const newReport = revalidatePlan(
      newPlan,
      draft.routeGroups.selectedRoutes,
      intervals,
      attributes,
    );

    // 3. 寫入歷史棧並取消選取
    pushNewState(newPlan, newReport);
    setSelectedBlockId((prev) => (prev === targetId ? null : prev));
  };

  const handleDuplicateBlock = (blockId?: string) => {
    if (!isManual) return;
    const targetId = blockId ?? selectedBlockId;
    if (!targetId) return;
    const current = planRef.current;
    if (!current) return;
    const result = duplicateManualScheduleBlock({ plan: current, blockId: targetId });
    if (!result.ok) {
      setDuplicateWarning(result.reason);
      return;
    }
    planRef.current = result.plan;
    pushNewState(result.plan, result.report);
    setSelectedBlockId(result.blockId);
  };

  const handleDropTaskType = (
    timelineRow: number,
    startMinute: number,
    taskType: TaskTypeKey,
  ) => {
    if (!isManual) return;
    const current = planRef.current;
    if (!current) return;
    const result = insertManualScheduleBlock({
      plan: current,
      timelineRow,
      startMinute,
      taskType,
      selectedRoutes: draft.routeGroups.selectedRoutes,
      sectionCodes: draft.maintenanceTask.sectionCodeBySection,
    });
    if (!result) return;
    planRef.current = result.plan;
    pushNewState(result.plan, result.report);
    setSelectedBlockId(result.blockId);
  };

  const handleCommitBlockTimeRange = (
    blockId: string,
    startMinute: number,
    endMinute: number,
  ) => {
    if (!isManual) return;
    const current = planRef.current;
    if (!current) return;
    const result = applyManualBlockTimeRange({
      plan: current,
      blockId,
      startMinute,
      endMinute,
    });
    if (!result) return;
    planRef.current = result.plan;
    pushNewState(result.plan, result.report);
  };

  const handlePreviewBlockTimeRange = (
    blockId: string,
    startMinute: number,
    endMinute: number,
  ) => {
    if (!isManual) return;
    const current = planRef.current;
    if (!current) return;
    const result = applyManualBlockTimeRange({
      plan: current,
      blockId,
      startMinute,
      endMinute,
    });
    if (!result) return;
    planRef.current = result.plan;
    setPlan(result.plan);
    setReport(result.report);
  };

  const handleApplySelectedBlock = (next: {
    startMinute: number;
    endMinute: number;
    routeId: string | null;
  }) => {
    if (!selectedBlockId || !isManual) return;
    const current = planRef.current;
    if (!current) return;
    let working = current;
    const timeResult = applyManualBlockTimeRange({
      plan: working,
      blockId: selectedBlockId,
      startMinute: next.startMinute,
      endMinute: next.endMinute,
    });
    if (!timeResult) return;
    working = timeResult.plan;

    const route =
      next.routeId
        ? draft.routeGroups.selectedRoutes.find((item) => item.routeId === next.routeId) ?? null
        : null;
    const routeResult = applyManualBlockRoute({
      plan: working,
      blockId: selectedBlockId,
      route,
    });
    if (!routeResult) return;
    planRef.current = routeResult.plan;
    pushNewState(routeResult.plan, routeResult.report);
  };

  const handleApplyDwells = (next: {
    stationDwells: import('../types/create').ShiftScheduleStationDwell[];
    dwellSlackSeconds: number;
  }) => {
    if (!selectedBlockId || !isManual) return;
    const current = planRef.current;
    if (!current) return;
    const result = applyManualBlockDwells({
      plan: current,
      blockId: selectedBlockId,
      stationDwells: next.stationDwells,
      dwellSlackSeconds: next.dwellSlackSeconds,
    });
    if (!result) return;
    planRef.current = result.plan;
    pushNewState(result.plan, result.report);
  };

  const selectedBlock = useMemo(() => {
    if (!plan || !selectedBlockId) return null;
    for (const timeline of plan.timelines) {
      const found = timeline.blocks.find((block) => block.id === selectedBlockId);
      if (found) return found;
    }
    return null;
  }, [plan, selectedBlockId]);

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const prevIndex = historyIndex - 1;
    const prev = history[prevIndex]!;

    setHistoryIndex(prevIndex);
    setPlan(prev.plan);
    setReport(prev.feasibilityReport);
    setSelectedBlockId(null);

    const base = draft.scheduleOutput;
    if (base) {
      void onScheduleOutputReady(
        applyHistoryToOutput(base, history, prevIndex),
        { flush: true },
      );
    }
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    const next = history[nextIndex]!;

    setHistoryIndex(nextIndex);
    setPlan(next.plan);
    setReport(next.feasibilityReport);
    setSelectedBlockId(null);

    const base = draft.scheduleOutput;
    if (base) {
      void onScheduleOutputReady(
        applyHistoryToOutput(base, history, nextIndex),
        { flush: true },
      );
    }
  };

  /**
   * 定位一張卡片：問題清單跳轉與分析報表「查看班次」共用。
   *
   * 用確切的 blockId 找，找不到就明確提示、不動畫面——不能靠解析班次名稱，也不能
   * 找不到就跳到同列第一張卡（那是錯的班次）。從報表來的：切回班次預覽、收合報表
   * （讓格線有完整高度，不被報表壓住）、釘住那張卡的明細。捲動等畫面重排之後再做，
   * 沿用支援畫面外卡片的定位方式（見 scrollScheduleGridToBlock）。
   */
  const locateBlock = (targetBlockId: string, options: { fromReport?: boolean } = {}): boolean => {
    if (!plan) return false;
    const targetBlock = plan.timelines
      .flatMap((timeline) => timeline.blocks)
      .find((block) => block.id === targetBlockId);
    if (!targetBlock) {
      setMissingLocateBlockId(targetBlockId);
      return false;
    }
    setMissingLocateBlockId(null);
    setActiveTab('schedule');
    if (options.fromReport) {
      setShowAnalysisReport(false);
      setPinnedDetailBlockId(targetBlockId);
    }
    setSelectedBlockId(targetBlockId);
    setHighlightedBlockId(targetBlockId);
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedBlockId(null);
    }, 3000);
    setTimeout(() => scrollScheduleGridToBlock(targetBlock), 0);
    return true;
  };

  const handleIssueClick = (issue: FeasibilityIssue) => {
    if (!plan) return;
    const targetBlockId = resolveFeasibilityIssueJumpBlockId(issue, plan);
    if (!targetBlockId) return;
    locateBlock(targetBlockId);
  };

  // 分析報表：純計算，跟著 plan／時段／路線走；plan 還沒好就不算
  const analysisReport = useMemo(() => {
    if (!plan) return null;
    const rotationRoutes = draft.routeGroups.selectedRoutes.filter(
      (route) => !route.backupForInstanceId && !route.backupForRouteId,
    );
    return buildScheduleAnalysisReport({
      plan,
      intervals,
      attributes,
      passengerRoutes: rotationRoutes,
      selectedRoutes: draft.routeGroups.selectedRoutes,
      minimumRecoveryTimeSeconds:
        normalizeMinimumRecoveryTimeSeconds(
          draft.routeGroups.minimumRecoveryTimeSeconds,
        ),
      collisionProtectionSeconds:
        draft.routeGroups.collisionProtectionSeconds
        ?? SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
      sectionCodes: draft.maintenanceTask.sectionCodeBySection,
    });
  }, [
    draft.maintenanceTask.sectionCodeBySection,
    plan,
    intervals,
    attributes,
    draft.routeGroups.selectedRoutes,
    draft.routeGroups.minimumRecoveryTimeSeconds,
    draft.routeGroups.collisionProtectionSeconds,
  ]);

  // 發布前檢查：可重跑的動作。班表可以手動改，所以指紋對不上就回到「未檢查」
  // 路線停靠、保護時間等設定改了，舊的檢查結果不能沿用（路網在發布時由後端重驗）
  const publishSettingsFingerprint = useMemo(
    () => buildSafetySettingsFingerprint({
      selectedRoutes: draft.routeGroups.selectedRoutes,
      collisionProtectionSeconds:
        draft.routeGroups.collisionProtectionSeconds
        ?? SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
      sectionCodes: draft.maintenanceTask.sectionCodeBySection,
    }),
    [draft.routeGroups.selectedRoutes, draft.routeGroups.collisionProtectionSeconds, draft.maintenanceTask.sectionCodeBySection],
  );
  const publishState = resolveSchedulePublishState(publishCheck, plan, {
    settingsFingerprint: publishSettingsFingerprint,
  });

  const handleRunPublishCheck = async () => {
    if (!plan || checkingPublish) return;
    setCheckingPublish(true);
    setError(null);
    try {
      const catalog = await loadShiftRouteGroupCatalog(draft.routeGroups.mapId);
      // 載入期間若使用者已修改班表，檢查結果不能覆蓋新版。
      if (planRef.current !== plan) return;
      const result = runSchedulePublishCheck({
        plan,
        selectedRoutes: draft.routeGroups.selectedRoutes,
        collisionProtectionSeconds:
          draft.routeGroups.collisionProtectionSeconds
          ?? SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
        sectionCodes: draft.maintenanceTask.sectionCodeBySection,
        topology: catalog.pointTopology,
      });
      const record = toPublishCheckRecord(result, new Date().toISOString());
      setPublishCheck(record);
      // 檢查結果要跟著班表存起來，清單欄位才讀得到
      const base = draft.scheduleOutput;
      if (base) {
        await onScheduleOutputReady({ ...base, publishCheck: record }, { flush: true });
      }
    } catch (checkError) {
      setPublishCheck(null);
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setCheckingPublish(false);
    }
  };

  if (loading) {
    // 用上一次的列數畫骨架，換成真內容時列數不會跳；沒有就給 8 列
    return (
      <ScheduleGeneratingSkeleton
        rowCount={plan?.scheduleRowCount ?? 8}
        progress={generationProgress}
        onCancel={cancelGeneration}
      />
    );
  }

  if (error && !plan) {
    return (
      <div className="flex min-h-[240px] items-center justify-center p-4">
        <div className="max-w-3xl whitespace-pre-line rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200">
          {error}
        </div>
      </div>
    );
  }

  const renderToolbar = () => {
  return (
      <div className="flex shrink-0 select-none items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1">
        <button
          type="button"
          disabled={!selectedBlockId}
          onClick={() => handleDeleteBlock()}
          className={`rounded p-1.5 transition ${
            selectedBlockId
              ? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-red-400'
              : 'cursor-not-allowed text-zinc-600 opacity-40'
          }`}
          title={t('shiftList.scheduleAdjust.deleteSelected')}
        >
          <Trash2 className="size-4" />
        </button>

        {isManual ? (
          <button
            type="button"
            disabled={!selectedBlockId}
            onClick={() => handleDuplicateBlock()}
            className={`rounded p-1.5 transition ${
              selectedBlockId
                ? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-sky-300'
                : 'cursor-not-allowed text-zinc-600 opacity-40'
            }`}
            title={t('shiftList.scheduleAdjust.duplicateSelected')}
          >
            <CopyPlus className="size-4" />
          </button>
        ) : null}

        <div className="h-4 w-px bg-zinc-800" />

        <button
          type="button"
          disabled={historyIndex <= 0}
          onClick={handleUndo}
          className={`rounded p-1.5 transition ${
            historyIndex > 0
              ? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
              : 'cursor-not-allowed text-zinc-600 opacity-40'
          }`}
          title={isManual ? t('shiftList.scheduleAdjust.undoManual', { shortcut: undoShortcutLabel }) : t('shiftList.scheduleAdjust.undo')}
        >
          <Undo className="size-4" />
        </button>

        <button
          type="button"
          disabled={historyIndex >= history.length - 1}
          onClick={handleRedo}
          className={`rounded p-1.5 transition ${
            historyIndex < history.length - 1
              ? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
              : 'cursor-not-allowed text-zinc-600 opacity-40'
          }`}
          title={isManual ? t('shiftList.scheduleAdjust.redoManual', { shortcut: redoShortcutLabel }) : t('shiftList.scheduleAdjust.redo')}
        >
          <Redo className="size-4" />
        </button>

        {!isManual ? (
          <>
            <div className="h-4 w-px bg-zinc-800" />
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                requestRebuild();
              }}
              className={`rounded p-1.5 transition ${
                loading
                  ? 'cursor-not-allowed text-zinc-600 opacity-40'
                  : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
              }`}
              title={t('shiftList.scheduleAdjust.regenerate')}
            >
              <RefreshCw className="size-4" />
            </button>
          </>
        ) : null}

        <div className="h-4 w-px bg-zinc-800" />

        <button
          type="button"
          disabled={!plan || checkingPublish}
          onClick={() => void handleRunPublishCheck()}
          className={`rounded p-1.5 transition ${
            !plan
              ? 'cursor-not-allowed text-zinc-600 opacity-40'
              : publishState === 'blocked'
                ? 'text-red-400 hover:bg-zinc-800/60 hover:text-red-300'
                : publishState === 'ready'
                  ? 'text-emerald-400 hover:bg-zinc-800/60 hover:text-emerald-300'
                  : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
          }`}
          title={
            publishState === 'blocked'
              ? t('shiftList.scheduleAdjust.publishBlocked', { label: PUBLISH_STATE_LABEL.blocked, count: publishCheck?.publishBlockingCount ?? 0 })
              : publishState === 'ready'
                ? t('shiftList.scheduleAdjust.publishReady', { label: PUBLISH_STATE_LABEL.ready })
                : t('shiftList.scheduleAdjust.publishUnchecked')
          }
        >
          {checkingPublish ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        </button>

        <button
          type="button"
          disabled={!analysisReport}
          onClick={() => setShowAnalysisReport((open) => !open)}
          className={`rounded p-1.5 transition ${
            !analysisReport
              ? 'cursor-not-allowed text-zinc-600 opacity-40'
              : showAnalysisReport
                ? 'bg-zinc-800/80 text-zinc-100'
                : analysisReport.hasFindings
                  ? 'text-amber-400 hover:bg-zinc-800/60 hover:text-amber-300'
                  : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
          }`}
          title={
            analysisReport?.hasFindings
              ? t('shiftList.scheduleAdjust.analysisWithIssues', { count: analysisReport.suggestions.length })
              : t('shiftList.scheduleAdjust.analysisReport')
          }
        >
          <ClipboardList className="size-4" />
        </button>

        <div className="h-4 w-px bg-zinc-800" />

        <ScheduleTimeZoomToolbar zoom={gridZoom} onChange={setGridZoom} />

        <div className="h-4 w-px bg-zinc-800" />

        <button
          type="button"
          onClick={() => setIsMaximized(!isMaximized)}
          className="rounded p-1.5 text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          title={isMaximized ? t('shiftList.scheduleAdjust.restoreWindow') : t('shiftList.scheduleAdjust.maximize')}
        >
          {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
    );
  };

  return (
    <div className={isMaximized ? "fixed inset-0 z-50 bg-[#0c1017] p-6 flex flex-col overflow-y-auto" : "flex min-h-0 flex-1 flex-col"}>
      {error && plan ? (
        <div className="mb-3 max-h-60 shrink-0 overflow-y-auto whitespace-pre-line rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-amber-200">
          {error}
        </div>
      ) : null}
      {showRebuildConfirm && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          onClick={() => setShowRebuildConfirm(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rebuild-schedule-title"
            className="w-full max-w-[520px] rounded-2xl bg-[#222225] px-8 py-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                id="rebuild-schedule-title"
                className="text-lg font-semibold leading-7 text-[#F3F4F6]"
              >
                {t('shiftList.scheduleAdjust.confirmRegenTitle')}
      </h2>
              <button
                type="button"
                onClick={() => setShowRebuildConfirm(false)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label={t('shiftList.scheduleAdjust.close')}
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {t('shiftList.scheduleAdjust.confirmRegenBody')}
            </p>

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowRebuildConfirm(false)}
                autoFocus
                className="inline-flex h-[38px] items-center justify-center rounded-lg px-5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                {t('shiftList.scheduleAdjust.cancel')}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setShowRebuildConfirm(false);
                  await performRebuild();
                }}
                className="inline-flex h-[38px] items-center justify-center rounded-lg bg-[#2B7FFF] px-5 text-sm font-medium text-white transition hover:bg-[#2569e6] disabled:opacity-50"
              >
                {t('shiftList.scheduleAdjust.confirmRegen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateWarning ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          onClick={() => setDuplicateWarning(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-warning-title"
            className="w-full max-w-[520px] rounded-2xl bg-[#222225] px-8 py-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                id="duplicate-warning-title"
                className="text-lg font-semibold leading-7 text-[#F3F4F6]"
              >
                {t('shiftList.scheduleAdjust.cannotDuplicate')}
              </h2>
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label={t('shiftList.scheduleAdjust.close')}
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {duplicateWarning === i18n.t('shiftList.scheduleAdjust.noSpaceDuplicate')
                ? t('shiftList.scheduleAdjust.noSpaceDuplicateBody')
                : duplicateWarning}
            </p>
          </div>
        </div>
      ) : null}
      <div className="mb-3 flex shrink-0 items-center gap-4">
        <div className="flex shrink-0 items-center gap-5 border-b border-zinc-800/80">
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`relative pb-2 text-sm transition ${
              activeTab === 'schedule'
                ? 'font-medium text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t('shiftList.scheduleAdjust.tripPreview')}
            {activeTab === 'schedule' ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#2B7FFF]" />
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('capacity')}
            className={`relative pb-2 text-sm transition ${
              activeTab === 'capacity'
                ? 'font-medium text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t('shiftList.scheduleAdjust.capacityTrend')}
            {activeTab === 'capacity' ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#2B7FFF]" />
            ) : null}
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-2">
          {periodLegends.map((item) => (
            <AttributeLegendBadgeChip key={item.attributeId} item={item} />
          ))}
          {renderToolbar()}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {/* 保持掛載以免切換運能趨勢後橫移位置被重置 */}
        <div
          className={`flex min-h-0 flex-1 flex-col gap-4 ${
            activeTab === 'schedule' ? '' : 'hidden'
          }`}
        >
          {showAnalysisReport && analysisReport ? (
            <div className="min-h-[240px] shrink-0 basis-2/5">
              <ScheduleAnalysisReportPanel
                report={analysisReport}
                onClose={() => setShowAnalysisReport(false)}
                onLocateBlock={(blockId) => locateBlock(blockId, { fromReport: true })}
                missingBlockId={missingLocateBlockId}
              />
            </div>
          ) : null}
          <div className={`flex min-h-0 flex-1 ${isManual ? 'flex-row gap-3' : 'flex-col'}`}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {plan ? (
        <ShiftSchedulePlanGrid
          plan={plan}
          intervals={intervals}
          attributes={attributes}
                  templateTasks={templateTasks}
                  selectedBlockId={selectedBlockId}
                  onSelectBlock={(blockId) => {
                    setSelectedBlockId(blockId);
                    if (blockId !== pinnedDetailBlockId) setPinnedDetailBlockId(null);
                  }}
                  pinnedDetailBlockId={pinnedDetailBlockId}
                  report={isManual ? null : report}
                  highlightedBlockId={highlightedBlockId}
                  selectedRoutes={draft.routeGroups.selectedRoutes}
                  minimumRecoveryTimeSeconds={draft.routeGroups.minimumRecoveryTimeSeconds}
                  hideStrategyBuffers={isManual}
                  sectionCodes={draft.maintenanceTask.sectionCodeBySection}
                  showTemplateTasks
                  interactiveEdit={isManual}
                  onDropTaskType={isManual ? handleDropTaskType : undefined}
                  onCommitBlockTimeRange={isManual ? handleCommitBlockTimeRange : undefined}
                  onPreviewBlockTimeRange={isManual ? handlePreviewBlockTimeRange : undefined}
                  onDeleteBlock={isManual ? handleDeleteBlock : undefined}
                  onDuplicateBlock={isManual ? handleDuplicateBlock : undefined}
                  zoom={gridZoom}
        />
      ) : (
                <PanelNoData message={t('shiftList.scheduleAdjust.cannotGenerate')} className="min-h-[240px]" />
              )}
            </div>
            {isManual ? (
              <ManualScheduleEditorSidebar
                selectedBlock={selectedBlock}
                selectedRoutes={draft.routeGroups.selectedRoutes}
                sectionCodes={draft.maintenanceTask.sectionCodeBySection}
                onApplyBlock={handleApplySelectedBlock}
                onApplyDwells={handleApplyDwells}
              />
            ) : null}
          </div>

          {report && !isManual ? (
            <div className="max-h-[300px] shrink-0 overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-950/30 p-2">
              <div className="mb-2 px-1 text-xs font-semibold text-zinc-400">
                {t('shiftList.scheduleAdjust.feasibilityReport')}
              </div>
              <FeasibilityMessages
                report={report}
                plan={plan}
                sectionCodes={draft.maintenanceTask.sectionCodeBySection}
                onIssueClick={handleIssueClick}
              />
            </div>
          ) : null}
        </div>

        {activeTab === 'capacity' ? (
          plan ? (
            <CapacityTrendChart
              plan={plan}
              intervals={intervals}
              attributes={attributes}
              vehicleCapacity={vehicleCapacity}
              selectedRoutes={draft.routeGroups.selectedRoutes}
              serviceDirectionTags={draft.routeGroups.serviceDirectionTags}
              className="min-h-[280px]"
            />
          ) : (
            <PanelNoData message={t('shiftList.scheduleAdjust.cannotCapacity')} className="min-h-[240px]" />
          )
        ) : null}
      </div>
    </div>
  );
}
