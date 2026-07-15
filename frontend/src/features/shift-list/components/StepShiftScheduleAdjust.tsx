import { AlertCircle, Loader2, RefreshCw, Trash2, Undo, Redo, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import {
  buildAttributeIntervalLegends,
  formatMinutesToTime,
  parseStoredTemplateBody,
  parseTimeToMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
  type ScheduleTask,
} from '../../time-templates/types/editor';
import { TimeOfDayPicker } from '../../time-templates/components/TimeOfDayPicker';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import { AttributeLegendBadgeChip } from '../../time-templates/components/AttributeLegendBadgeChip';
import type { ShiftScheduleCreateDraft, ShiftScheduleSelectedRoute } from '../types/create';
import { isShiftScheduleOutputFresh } from '../types/create';
import { applyManualBlockStartAdjustment } from '../utils/adjustShiftSchedulePlan';
import { buildShiftScheduleStoredOutput } from '../utils/buildShiftScheduleOutput';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
  ShiftScheduleStoredOutput,
} from '../utils/shiftScheduleEngine.types';
import { ShiftSchedulePlanGrid } from './ShiftSchedulePlanGrid';
import {
  validateTimelineOverlaps,
  validatePassengerHeadway,
  validateRouteSwitchBuffers,
  validateTimelineCapacity,
} from '../utils/schedule-engine/validate';

function FeasibilityMessages({
  report,
  onIssueClick,
}: {
  report: ShiftScheduleFeasibilityReport;
  onIssueClick: (issue: FeasibilityIssue) => void;
}) {
  if (report.ok && report.warnings.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {report.errors.map((issue) => (
        <button
          type="button"
          key={`${issue.code}-${issue.message}-${JSON.stringify(issue.detail)}`}
          onClick={() => onIssueClick(issue)}
          className="flex w-full items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-sm text-red-300 transition hover:bg-red-500/20 hover:border-red-500/50 focus:outline-none focus:ring-1 focus:ring-red-500/40"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2 flex-wrap">
            <span className="font-medium">{issue.message}</span>
            <span className="text-[10px] text-red-400/90 font-normal shrink-0">（點擊自動跳轉並閃爍定位 ⚡）</span>
          </div>
        </button>
      ))}
      {report.warnings.map((issue) => (
        <button
          type="button"
          key={`${issue.code}-${issue.message}-${JSON.stringify(issue.detail)}`}
          onClick={() => onIssueClick(issue)}
          className="flex w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-200 transition hover:bg-amber-500/20 hover:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2 flex-wrap">
            <span className="font-medium">{issue.message}</span>
            <span className="text-[10px] text-amber-400/90 font-normal shrink-0">（點擊自動跳轉並閃爍定位 ⚡）</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function findBlockById(
  plan: GeneratedSchedulePlan,
  blockId: string,
): GeneratedScheduleBlock | null {
  for (const timeline of plan.timelines) {
    const found = timeline.blocks.find((block) => block.id === blockId);
    if (found) return found;
  }
  return null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeneratedSchedulePlan | null>(null);
  const [report, setReport] = useState<ShiftScheduleFeasibilityReport | null>(null);
  const [intervals, setIntervals] = useState<TimeSlotInterval[]>([]);
  const [attributes, setAttributes] = useState<TimeSlotAttribute[]>([]);
  const [templateTasks, setTemplateTasks] = useState<ScheduleTask[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState('');
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [history, setHistory] = useState<{ plan: GeneratedSchedulePlan; report: ShiftScheduleFeasibilityReport }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        let storedOutput = draft.scheduleOutput;

        if (!isShiftScheduleOutputFresh(draft)) {
          storedOutput = await buildShiftScheduleStoredOutput(draft, { shiftId });
          if (cancelled) return;
          void onScheduleOutputReady(storedOutput);
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
        if (storedOutput.plan) {
          setPlan(storedOutput.plan);
          setReport(storedOutput.feasibilityReport);
          setHistory([{ plan: storedOutput.plan, report: storedOutput.feasibilityReport }]);
          setHistoryIndex(0);
        } else {
          setPlan(null);
          setReport(null);
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
    draft.maintenanceTask,
    draft.timeTemplate,
    draft.routeGroups,
    draft.scheduleOutput,
    onScheduleOutputReady,
    shiftId,
  ]);

  const selectedBlock = useMemo(
    () => (plan && selectedBlockId ? findBlockById(plan, selectedBlockId) : null),
    [plan, selectedBlockId],
  );

  useEffect(() => {
    if (!selectedBlock) {
      setEditStartTime('');
      return;
    }
    setEditStartTime(formatMinutesToTime(selectedBlock.plannedStartMinute));
  }, [selectedBlock]);

  const periodLegends = useMemo(
    () => buildAttributeIntervalLegends(intervals, attributes),
    [attributes, intervals],
  );

  const pushNewState = (
    newPlan: GeneratedSchedulePlan,
    newReport: ShiftScheduleFeasibilityReport,
  ) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    const newState = { plan: newPlan, report: newReport };
    nextHistory.push(newState);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setPlan(newPlan);
    setReport(newReport);

    const base = draft.scheduleOutput;
    if (base) {
      void onScheduleOutputReady({
        ...base,
        generatedAt: newPlan.generatedAt,
        plan: newPlan,
        feasibilityReport: newReport,
      }, { flush: true });
    }
  };

  const handleRebuild = async () => {
    setLoading(true);
    setError(null);
    try {
      const storedOutput = await buildShiftScheduleStoredOutput(draft, {
        shiftId,
      });
      void onScheduleOutputReady(storedOutput, { flush: true });
      if (storedOutput.plan) {
        setPlan(storedOutput.plan);
        setReport(storedOutput.feasibilityReport);
        setHistory([{ plan: storedOutput.plan, report: storedOutput.feasibilityReport }]);
        setHistoryIndex(0);
      } else {
        setPlan(null);
        setReport(null);
      }
      setSelectedBlockId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const applyStartAdjustment = async () => {
    if (!plan || !selectedBlockId) return;
    const newStartMinute = parseTimeToMinutes(editStartTime);
    if (newStartMinute == null) return;

    const adjusted = applyManualBlockStartAdjustment({
      plan,
      blockId: selectedBlockId,
      newStartMinute,
      selectedRoutes: draft.routeGroups.selectedRoutes,
      minimumRecoveryTimeSeconds: draft.routeGroups.minimumRecoveryTimeSeconds ?? 0,
      intervals,
      attributes,
    });
    if (!adjusted) return;

    pushNewState(adjusted.plan, adjusted.report);
  };

  const handleDeleteBlock = () => {
    if (!plan || !selectedBlockId) return;

    // 1. 複製 plan 並過濾掉選取的 block
    const updatedTimelines = plan.timelines.map((timeline) => ({
      ...timeline,
      blocks: timeline.blocks.filter((b) => b.id !== selectedBlockId),
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
    setSelectedBlockId(null);
  };

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const prevIndex = historyIndex - 1;
    const prev = history[prevIndex]!;

    setHistoryIndex(prevIndex);
    setPlan(prev.plan);
    setReport(prev.report);
    setSelectedBlockId(null);

    const base = draft.scheduleOutput;
    if (base) {
      void onScheduleOutputReady({
        ...base,
        generatedAt: prev.plan.generatedAt,
        plan: prev.plan,
        feasibilityReport: prev.report,
      }, { flush: true });
    }
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    const next = history[nextIndex]!;

    setHistoryIndex(nextIndex);
    setPlan(next.plan);
    setReport(next.report);
    setSelectedBlockId(null);

    const base = draft.scheduleOutput;
    if (base) {
      void onScheduleOutputReady({
        ...base,
        generatedAt: next.plan.generatedAt,
        plan: next.plan,
        feasibilityReport: next.report,
      }, { flush: true });
    }
  };

  const handleIssueClick = (issue: FeasibilityIssue) => {
    if (!plan) return;
    const d = issue.detail;
    if (!d) return;

    let targetBlockId: string | null = null;
    if (typeof d.blockId === 'string') {
      targetBlockId = d.blockId;
    } else if (typeof d.earlierBlockId === 'string') {
      targetBlockId = d.earlierBlockId;
    } else if (typeof d.laterBlockId === 'string') {
      targetBlockId = d.laterBlockId;
    } else if (typeof d.routeId === 'string' && typeof d.earlierDepartureMinute === 'number') {
      // 根據 routeId 與發車分鐘來回溯 block
      for (const timeline of plan.timelines) {
        const found = timeline.blocks.find(
          (b) => b.routeId === d.routeId && b.plannedStartMinute === d.earlierDepartureMinute
        );
        if (found) {
          targetBlockId = found.id;
          break;
        }
      }
    } else if (typeof d.routeId === 'string' && typeof d.laterDepartureMinute === 'number') {
      // 根據 routeId 與發車分鐘來回溯 block
      for (const timeline of plan.timelines) {
        const found = timeline.blocks.find(
          (b) => b.routeId === d.routeId && b.plannedStartMinute === d.laterDepartureMinute
        );
        if (found) {
          targetBlockId = found.id;
          break;
        }
      }
    }

    if (targetBlockId) {
      // 1. 選取該卡片
      setSelectedBlockId(targetBlockId);
      // 2. 設置閃爍狀態
      setHighlightedBlockId(targetBlockId);
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedBlockId(null);
      }, 3000); // 3秒後自動停止閃爍

      // 3. 跳過去那個地方（Scroll Into View）
      const targetId = targetBlockId;
      setTimeout(() => {
        const el = document.getElementById(`block-card-${targetId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }, 50);
    }
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
      <div className="flex items-center gap-2 rounded-lg bg-zinc-900/80 border border-zinc-800 px-2 py-1 select-none shrink-0">
        {/* 垃圾桶 */}
        <button
          type="button"
          disabled={!selectedBlockId}
          onClick={handleDeleteBlock}
          className={`p-1.5 rounded transition ${
            selectedBlockId
              ? 'text-zinc-300 hover:text-red-400 hover:bg-zinc-800/60'
              : 'text-zinc-600 cursor-not-allowed opacity-40'
          }`}
          title="刪除已選班次"
        >
          <Trash2 className="size-4" />
        </button>

        <div className="w-px h-4 bg-zinc-800" />

        {/* Undo */}
        <button
          type="button"
          disabled={historyIndex <= 0}
          onClick={handleUndo}
          className={`p-1.5 rounded transition ${
            historyIndex > 0
              ? 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60'
              : 'text-zinc-600 cursor-not-allowed opacity-40'
          }`}
          title="還原 (Undo)"
        >
          <Undo className="size-4" />
        </button>

        {/* Redo */}
        <button
          type="button"
          disabled={historyIndex >= history.length - 1}
          onClick={handleRedo}
          className={`p-1.5 rounded transition ${
            historyIndex < history.length - 1
              ? 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60'
              : 'text-zinc-600 cursor-not-allowed opacity-40'
          }`}
          title="重複 (Redo)"
        >
          <Redo className="size-4" />
        </button>

        <div className="w-px h-4 bg-zinc-800" />

        {/* 放大 / 縮小 */}
        <button
          type="button"
          onClick={() => setIsMaximized(!isMaximized)}
          className="p-1.5 rounded text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60 transition"
          title={isMaximized ? "還原視窗" : "放大至全螢幕"}
        >
          {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
    );
  };

  return (
    <div className={isMaximized ? "fixed inset-0 z-50 bg-[#0c1017] p-6 flex flex-col overflow-y-auto" : "flex min-h-0 flex-1 flex-col"}>
      {isMaximized ? (
        // 全螢幕極致化排版 (如設計稿二)
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            調整自動生成的班表細節
          </h2>
          <div className="flex items-center gap-3">
            {periodLegends.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {periodLegends.map((item) => (
                  <AttributeLegendBadgeChip key={item.attributeId} item={item} />
                ))}
              </div>
            )}
            {renderToolbar()}
          </div>
        </div>
      ) : (
        // 一般嵌入式排版
        <>
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <h2 className="text-base font-medium text-zinc-100">
              調整自動生成的班表細節
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRebuild}
                className="flex h-[32px] items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition"
              >
                <RefreshCw className="size-3.5" />
                重新生成排班
              </button>
            </div>
          </div>

          <div className="mb-3 flex shrink-0 items-center justify-between">
            {periodLegends.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {periodLegends.map((item) => (
                  <AttributeLegendBadgeChip key={item.attributeId} item={item} />
                ))}
              </div>
            ) : <div />}
            {renderToolbar()}
          </div>
        </>
      )}

      {selectedBlock ? (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">已選任務</div>
            <div className="truncate text-sm text-zinc-100">
              {selectedBlock.label}
              {selectedBlock.routeName ? ` · ${selectedBlock.routeName}` : ''}
            </div>
          </div>
          <div className="w-[160px]">
            <div className="mb-1 text-xs text-zinc-500">計畫發車（10 秒刻度）</div>
            <TimeOfDayPicker
              label="發車"
              value={editStartTime}
              onChange={setEditStartTime}
            />
          </div>
          <button
            type="button"
            onClick={() => void applyStartAdjustment()}
            className="h-[34px] rounded-lg bg-[#2B7FFF] px-3 text-sm font-medium text-white hover:bg-[#2569e6]"
          >
            套用
          </button>
          <button
            type="button"
            onClick={() => setSelectedBlockId(null)}
            className="h-[34px] rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-800/60"
          >
            取消選取
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex-1 min-h-0 flex flex-col">
          {plan ? (
            <ShiftSchedulePlanGrid
              plan={plan}
              intervals={intervals}
              attributes={attributes}
              templateTasks={templateTasks}
              selectedBlockId={selectedBlockId}
              onSelectBlock={setSelectedBlockId}
              report={report}
              highlightedBlockId={highlightedBlockId}
            />
          ) : (
            <PanelNoData message="無法生成班表" className="min-h-[240px]" />
          )}
        </div>

        {report && (
          <div className="shrink-0 max-h-[300px] overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-950/30 p-2">
            <div className="mb-2 px-1 text-xs font-semibold text-zinc-400">系統可行性檢驗報告與錯誤原因對照清單</div>
            <FeasibilityMessages report={report} onIssueClick={handleIssueClick} />
          </div>
        )}
      </div>
    </div>
  );
}
