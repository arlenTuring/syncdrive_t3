import {
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import {
  buildAttributeIntervalLegends,
  parseStoredTemplateBody,
  type TimeSlotAttribute,
  type TimeSlotInterval,
  type ScheduleTask,
} from '../../time-templates/types/editor';
import { AttributeLegendBadgeChip } from '../../time-templates/components/AttributeLegendBadgeChip';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import type {
  CreateShiftScheduleStep,
  ShiftScheduleCreateDraft,
  ShiftScheduleSelectedRoute,
} from '../types/create';
import {
  normalizeDwellSlackSeconds,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeSwitchBufferAfterSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSecondsWithSlack,
  summarizeRouteGroupsCycle,
} from '../types/create';
import { ShiftSchedulePlanGrid } from './ShiftSchedulePlanGrid';
import { CapacityTrendChart } from './CapacityTrendChart';

type PreviewTab = 'schedule' | 'capacity';

type StepShiftSchedulePreviewProps = {
  draft: ShiftScheduleCreateDraft;
  turnaroundLimitSeconds?: number | null;
  /** 點鉛筆僅跳轉至對應步驟，不在預覽頁內編輯 */
  onNavigateToStep?: (step: CreateShiftScheduleStep) => void;
  /** 清單唯讀結果：隱藏引導文案 */
  resultView?: boolean;
};

function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  return `${Math.round(seconds)} 秒`;
}

function ReviewSection({
  step,
  title,
  onNavigate,
  children,
}: {
  step: CreateShiftScheduleStep;
  title: string;
  onNavigate?: (step: CreateShiftScheduleStep) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[#0c0c0e] px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        {onNavigate ? (
          <button
            type="button"
            onClick={() => onNavigate(step)}
            title={`前往${title}`}
            aria-label={`前往${title}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-[#2B7FFF] transition hover:bg-[rgba(43,127,255,0.12)]"
          >
            <Pencil className="size-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetaGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-zinc-500">{item.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-zinc-200">
            {item.value.trim() ? item.value : '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SimpleNameLine({ label, value }: { label?: string; value: string }) {
  return (
    <p className="text-sm text-zinc-200">
      {label ? <span className="text-zinc-500">{label}：</span> : null}
      {value.trim() ? value : '—'}
    </p>
  );
}

function RouteGroupsCycleSummaryPanel({
  summary,
  turnaroundLimitSeconds,
}: {
  summary: ReturnType<typeof summarizeRouteGroupsCycle>;
  turnaroundLimitSeconds?: number | null;
}) {
  const hasLimit = turnaroundLimitSeconds != null && turnaroundLimitSeconds > 0;
  const isOver = hasLimit && summary.totalMinCycleSeconds > (turnaroundLimitSeconds ?? 0);

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-zinc-200">通盤綜合值</h4>
        {hasLimit ? (
          <span className="text-xs text-zinc-500">
            車輛折返時限 {formatSeconds(turnaroundLimitSeconds)}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div
          className={`rounded-lg border p-4 ${
            isOver
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-emerald-500/20 bg-emerald-500/5'
          }`}
        >
          <div className="text-xs font-medium text-zinc-400">完整循環最快時間</div>
          <div
            className={`mt-2 text-2xl font-bold tabular-nums ${
              isOver ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {formatSeconds(summary.totalMinCycleSeconds)}
          </div>
          <div className="mt-1.5 text-[10px] font-medium text-zinc-500">
            ({summary.totalMinTravelSeconds}s 行駛 + {summary.totalDwellWithSlackSeconds}s 停靠
            + {summary.totalSwitchBufferSeconds}s 切換 + {summary.recoverySeconds}s 恢復)
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="text-xs font-medium text-zinc-400">完整循環平均時間</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-200">
            {formatSeconds(summary.totalAvgCycleSeconds)}
          </div>
          <div className="mt-1.5 text-[10px] font-medium text-zinc-500">
            ({summary.totalAvgTravelSeconds}s 行駛 + {summary.totalDwellWithSlackSeconds}s 停靠
            + {summary.totalSwitchBufferSeconds}s 切換 + {summary.recoverySeconds}s 恢復)
          </div>
        </div>
      </div>

      {hasLimit ? (
        <div className="mt-3">
          {isOver ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
              <span>
                完整循環最快時間超過折返時限，請回到路線群組調整。
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <span>完整循環最快時間在折返時限內。</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RouteReviewCard({
  route,
  recoverySeconds,
}: {
  route: ShiftScheduleSelectedRoute;
  recoverySeconds: number;
}) {
  const dwellSlack = normalizeDwellSlackSeconds(route.dwellSlackSeconds);
  const switchBuffer = normalizeSwitchBufferAfterSeconds(route.switchBufferAfterSeconds);
  const dwellWithSlack = sumStationDwellSecondsWithSlack(route.stationDwells, dwellSlack);

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#2B7FFF]/15 text-xs font-semibold tabular-nums text-[#7CB8FF]">
              {route.executionOrder}
            </span>
            <p className="truncate text-sm font-medium text-zinc-100">{route.routeName}</p>
            {route.routeCode ? (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                {route.routeCode}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            群組 {route.groupName || '—'}
            {route.stationDwellsConfirmed ? ' · 停靠已確認' : ' · 停靠未確認'}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-zinc-500">平均行駛</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">
            {formatSeconds(route.avgTravelTimeSeconds)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">最快行駛</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">
            {formatSeconds(route.minTravelTimeSeconds)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">換線緩衝</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">{formatSeconds(switchBuffer)}</p>
        </div>
        <div>
          <p className="text-zinc-500">靠站緩衝</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">{formatSeconds(dwellSlack)}</p>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs text-zinc-500">站點停靠</p>
        {route.stationDwells.length === 0 ? (
          <p className="text-xs text-zinc-600">無站點資料</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {route.stationDwells.map((dwell) => (
              <li
                key={`${route.routeId}-${dwell.stationId}`}
                className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-300"
              >
                <span className="text-zinc-200">{dwell.stationName}</span>
                <span className="ml-1.5 tabular-nums text-zinc-500">
                  {formatSeconds(dwell.dwellSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          有效停靠合計（含靠站緩衝）{' '}
          <span className="tabular-nums text-zinc-300">
            {formatSeconds(dwellWithSlack)}
          </span>
          <span className="mx-1.5 text-zinc-700">·</span>
          恢復時間{' '}
          <span className="tabular-nums text-zinc-300">{formatSeconds(recoverySeconds)}</span>
        </p>
      </div>
    </div>
  );
}

export function StepShiftSchedulePreview({
  draft,
  turnaroundLimitSeconds = null,
  onNavigateToStep,
  resultView = false,
}: StepShiftSchedulePreviewProps) {
  const output = draft.scheduleOutput;
  const [activeTab, setActiveTab] = useState<PreviewTab>('schedule');
  const [intervals, setIntervals] = useState<TimeSlotInterval[]>([]);
  const [attributes, setAttributes] = useState<TimeSlotAttribute[]>([]);
  const [templateTasks, setTemplateTasks] = useState<ScheduleTask[]>([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [vehicleCapacity, setVehicleCapacity] = useState(50);

  const orderedRoutes = useMemo(
    () => sortSelectedRoutesByExecutionOrder(draft.routeGroups.selectedRoutes),
    [draft.routeGroups.selectedRoutes],
  );

  const recoverySeconds = normalizeMinimumRecoveryTimeSeconds(
    draft.routeGroups.minimumRecoveryTimeSeconds,
  );

  const routeCycleSummary = useMemo(
    () => summarizeRouteGroupsCycle(draft.routeGroups),
    [draft.routeGroups],
  );

  useEffect(() => {
    const templateId = output?.timeTemplateRef.templateId ?? draft.timeTemplate.templateId;
    if (!templateId.trim()) {
      setIntervals([]);
      setAttributes([]);
      setTemplateTasks([]);
      setTemplateLoading(false);
      return;
    }

    let cancelled = false;
    setTemplateLoading(true);
    void fetchTimeTemplateDetail(templateId)
      .then((detail) => {
        if (cancelled) return;
        const template = parseStoredTemplateBody(detail.body ?? {});
        setIntervals(template.intervals.filter((slot) => !slot.isDraft));
        setAttributes(template.attributes.filter((attr) => !attr.isDraft));
        setTemplateTasks(
          template.tasks.filter(
            (t) => t.rowIndex >= 1 && t.rowIndex <= template.scheduleRowCount,
          ),
        );
        setVehicleCapacity(template.vehicleCapacity);
      })
      .catch(() => {
        if (!cancelled) {
          setIntervals([]);
          setAttributes([]);
          setTemplateTasks([]);
        }
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draft.timeTemplate.templateId, output?.timeTemplateRef.templateId]);

  const periodLegends = useMemo(
    () => buildAttributeIntervalLegends(intervals, attributes),
    [attributes, intervals],
  );

  const maintenanceDisplayName = draft.maintenanceTask.skipped
    ? '略過整備任務'
    : (draft.maintenanceTask.taskName.trim()
      || output?.maintenanceTaskBinding.taskName
      || draft.maintenanceTask.taskId
      || '—');

  const templateDisplayName =
    draft.timeTemplate.templateName.trim()
    || output?.timeTemplateRef.templateName
    || draft.timeTemplate.templateId
    || '—';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!resultView ? (
        <h2 className="mb-5 shrink-0 text-base font-medium text-zinc-100">
          確認班表細節並完成建立
        </h2>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <ReviewSection step={1} title="基本資料" onNavigate={onNavigateToStep}>
          <MetaGrid
            items={[
              { label: '班表名稱', value: draft.basic.name },
              { label: '版本編號', value: draft.basic.version },
              { label: '備註說明', value: draft.basic.remarks },
            ]}
          />
        </ReviewSection>

        <ReviewSection step={2} title="整備任務" onNavigate={onNavigateToStep}>
          <SimpleNameLine value={maintenanceDisplayName} />
        </ReviewSection>

        <ReviewSection step={3} title="時間模板" onNavigate={onNavigateToStep}>
          <SimpleNameLine value={templateDisplayName} />
        </ReviewSection>

        <ReviewSection step={4} title="路線群組" onNavigate={onNavigateToStep}>
          {orderedRoutes.length === 0 ? (
            <p className="text-sm text-zinc-500">尚未選擇路線</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 px-3 py-2 text-xs text-zinc-400">
                <span>策略參數｜最低恢復時間 </span>
                <span className="tabular-nums text-zinc-200">
                  {formatSeconds(recoverySeconds)}
                </span>
                <span className="mx-2 text-zinc-700">·</span>
                <span>已選路線 </span>
                <span className="tabular-nums text-zinc-200">{orderedRoutes.length}</span>
                <span className="mx-2 text-zinc-700">·</span>
                <span>執行順序 </span>
                <span className="text-zinc-200">
                  {orderedRoutes.map((route) => route.routeName).join(' → ')}
                </span>
              </div>

              {draft.creationMode !== 'manual' ? (
                <RouteGroupsCycleSummaryPanel
                  summary={routeCycleSummary}
                  turnaroundLimitSeconds={turnaroundLimitSeconds}
                />
              ) : null}

              {orderedRoutes.map((route) => (
                <RouteReviewCard
                  key={route.routeId}
                  route={route}
                  recoverySeconds={recoverySeconds}
                />
              ))}
            </div>
          )}
        </ReviewSection>

        <ReviewSection step={5} title="調整班表" onNavigate={onNavigateToStep}>
          {!output ? (
            <PanelNoData
              message="尚無班表產出，請先回到「調整班表」重新生成"
              className="min-h-[160px]"
            />
          ) : (
            <div className="flex min-h-0 flex-col">
              {!output.feasibilityReport.ok && draft.creationMode !== 'manual' && (
                <div className="mb-3 space-y-2">
                  {output.feasibilityReport.errors.map((issue) => (
                    <div
                      key={`${issue.code}-${issue.message}`}
                      className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                    >
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{issue.message}</span>
                    </div>
                  ))}
                  {output.feasibilityReport.warnings.map((issue) => (
                    <div
                      key={`warn-${issue.code}-${issue.message}`}
                      className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-5 border-b border-zinc-800/80">
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

                {periodLegends.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 pb-2">
                    {periodLegends.map((item) => (
                      <AttributeLegendBadgeChip key={item.attributeId} item={item} />
                    ))}
                  </div>
                ) : null}
              </div>

              {/* 保持掛載以免切換運能趨勢後橫移位置被重置 */}
              <div className={activeTab === 'schedule' ? '' : 'hidden'}>
                {templateLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                    載入班表預覽…
                  </div>
                ) : output.plan ? (
                  <ShiftSchedulePlanGrid
                    plan={output.plan}
                    intervals={intervals}
                    attributes={attributes}
                    templateTasks={templateTasks}
                    selectedRoutes={draft.routeGroups.selectedRoutes}
                    minimumRecoveryTimeSeconds={draft.routeGroups.minimumRecoveryTimeSeconds}
                  />
                ) : (
                  <PanelNoData message="班表產出缺少班次資料" className="min-h-[240px]" />
                )}
              </div>
              {activeTab === 'capacity' ? (
                templateLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                    載入運能趨勢…
                  </div>
                ) : (
                  <CapacityTrendChart
                    plan={output.plan}
                    intervals={intervals}
                    attributes={attributes}
                    vehicleCapacity={vehicleCapacity}
                    selectedRoutes={draft.routeGroups.selectedRoutes}
                    className="min-h-[280px]"
                  />
                )
              ) : null}
            </div>
          )}
        </ReviewSection>
      </div>
    </div>
  );
}
