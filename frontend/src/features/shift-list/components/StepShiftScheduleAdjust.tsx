import { AlertCircle, ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2, Undo, Redo, Maximize2, Minimize2, X, CopyPlus } from 'lucide-react';
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
import { buildShiftScheduleStoredOutput } from '../utils/buildShiftScheduleOutput';
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
  resolveGeneratedBlockTripCode,
  type MaintenanceSectionCodeBySection,
} from '../utils/maintenanceSectionCode';
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
  return {
    ...base,
    generatedAt: entry.plan.generatedAt,
    plan: entry.plan,
    feasibilityReport: entry.feasibilityReport,
    planAdjustHistory: history,
    planAdjustHistoryIndex: historyIndex,
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
  return order;
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
              {group.issues.length} 則
            </span>
          </div>
          {!expanded ? (
            <div className="mt-1 truncate text-[11px] opacity-70">
              {group.issues
                .slice(0, 3)
                .map((issue) => resolveFeasibilityIssueTripCode(issue, plan, sectionCodes))
                .join(' · ')}
              {group.issues.length > 3 ? ` · 另 ${group.issues.length - 3} 則` : ''}
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
              if (jumpable) {
                return (
                  <li key={rowKey}>
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
                      <span className={`shrink-0 text-[10px] ${jumpHint}`}>跳轉 ⚡</span>
                    </button>
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
  const groups = useMemo(
    () => groupFeasibilityIssues(report.errors, report.warnings),
    [report.errors, report.warnings],
  );

  if (groups.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {groups.map((group) => (
        <IssueGroupCard
          key={group.key}
          group={group}
          plan={plan}
          sectionCodes={sectionCodes}
          defaultExpanded={group.issues.length === 1}
          onIssueClick={onIssueClick}
        />
      ))}
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
    ok: errors.length === 0,
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

export function StepShiftScheduleAdjust({
  draft,
  shiftId,
  onScheduleOutputReady,
}: StepShiftScheduleAdjustProps) {
  const isManual = draft.creationMode === 'manual';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeneratedSchedulePlan | null>(null);
  const planRef = useRef<GeneratedSchedulePlan | null>(null);
  planRef.current = plan;
  const [report, setReport] = useState<ShiftScheduleFeasibilityReport | null>(null);
  const [intervals, setIntervals] = useState<TimeSlotInterval[]>([]);
  const [attributes, setAttributes] = useState<TimeSlotAttribute[]>([]);
  const [templateTasks, setTemplateTasks] = useState<ScheduleTask[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [history, setHistory] = useState<PlanAdjustHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isMaximized, setIsMaximized] = useState(false);
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
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        let storedOutput = draft.scheduleOutput;
        const needsRegen = !storedOutput?.plan || !isShiftScheduleOutputFresh(draft);

        if (needsRegen) {
          storedOutput = await buildShiftScheduleStoredOutput(draft, { shiftId });
          if (cancelled) return;
          void onScheduleOutputReady(storedOutput, { flush: true });
        }

        if (!storedOutput) {
          throw new Error('無法生成班表產出');
        }

        const templateDetail = await fetchTimeTemplateDetail(draft.timeTemplate.templateId);
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
        }
        setSelectedBlockId(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPlan(null);
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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
    try {
      const storedOutput = await buildShiftScheduleStoredOutput(draft, {
        shiftId,
      });

      if (!storedOutput.plan) {
        throw new Error('無法重新生成班表產出');
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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

  const handleIssueClick = (issue: FeasibilityIssue) => {
    if (!plan) return;
    const targetBlockId = resolveFeasibilityIssueJumpBlockId(issue, plan);
    if (!targetBlockId) return;

    setSelectedBlockId(targetBlockId);
    setHighlightedBlockId(targetBlockId);
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedBlockId(null);
    }, 3000);

    const targetId = targetBlockId;
    setTimeout(() => {
      const el = document.getElementById(`block-card-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }, 50);
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-zinc-500">
        <Loader2 className="size-6 animate-spin" />
        正在依時間模板、整備任務與路線群組生成班表…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-sm text-red-400">
        {error}
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
          title="刪除已選班次"
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
            title="增生已選班次"
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
          title={isManual ? `還原 (${undoShortcutLabel})` : '還原 (Undo)'}
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
          title={isManual ? `重做 (${redoShortcutLabel})` : '重複 (Redo)'}
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
              title="重新生成班表"
            >
              <RefreshCw className="size-4" />
            </button>
          </>
        ) : null}

        <div className="h-4 w-px bg-zinc-800" />

        <button
          type="button"
          onClick={() => setIsMaximized(!isMaximized)}
          className="rounded p-1.5 text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          title={isMaximized ? '還原視窗' : '放大至全螢幕'}
        >
          {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
    );
  };

  return (
    <div className={isMaximized ? "fixed inset-0 z-50 bg-[#0c1017] p-6 flex flex-col overflow-y-auto" : "flex min-h-0 flex-1 flex-col"}>
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
                確認重新生成班表
              </h2>
              <button
                type="button"
                onClick={() => setShowRebuildConfirm(false)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="關閉"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-400">
              重新生成班表將會用目前的設定重新計算所有班次。
              你可以在此步驟中使用「還原 (Undo)」回到重生成前的版本。
            </p>

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowRebuildConfirm(false)}
                autoFocus
                className="inline-flex h-[38px] items-center justify-center rounded-lg px-5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                取消
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
                確認重新生成
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
                無法增生班次
              </h2>
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="關閉"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {duplicateWarning === '沒有足夠的空間可以增生'
                ? '目前空間不足，無法在原班次右側增生一模一樣的班次。請先調整鄰近班次或縮短原班次後再試。'
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
            班次預覽
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
            運能趨勢
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
          <div className={`flex min-h-0 flex-1 ${isManual ? 'flex-row gap-3' : 'flex-col'}`}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {plan ? (
                <ShiftSchedulePlanGrid
                  plan={plan}
                  intervals={intervals}
                  attributes={attributes}
                  templateTasks={templateTasks}
                  selectedBlockId={selectedBlockId}
                  onSelectBlock={setSelectedBlockId}
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
                />
              ) : (
                <PanelNoData message="無法生成班表" className="min-h-[240px]" />
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
                系統可行性檢驗報告與錯誤原因對照清單
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
            <PanelNoData message="無法生成運能趨勢" className="min-h-[240px]" />
          )
        ) : null}
      </div>
    </div>
  );
}
