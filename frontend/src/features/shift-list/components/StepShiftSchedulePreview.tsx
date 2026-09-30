import {
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
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
  normalizeCollisionProtectionSeconds,
  normalizeSwitchBufferAfterSeconds,
  formatStationDwellRoleLabel,
  resolveStationDwellListRole,
  resolveStationDwellMode,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSecondsWithSlack,
  summarizeRouteGroupsCycle,
} from '../types/create';
import {
  fetchMediaLibraryOptions,
  type MediaLibraryOption,
} from '../api/mediaLibraryApi';
import {
  SHIFT_ACTION_ZONE_LABELS,
  isMediaBehavior,
  labelForActionBehavior,
  labelForOffsetUnit,
  resolveShiftActionCategory,
} from '../utils/actionSettingsCatalog';
import type { ShiftRouteSegmentAction } from '../utils/actionSettings';
import {
  loadActionFacilityGroups,
  resolveFacilityTargetLabel,
  type ActionFacilityTypeGroup,
} from '../utils/actionFacilityOptions';
import { ShiftSchedulePlanGrid } from './ShiftSchedulePlanGrid';
import { CapacityTrendChart } from './CapacityTrendChart';
import { ScheduleTimeZoomToolbar } from './ScheduleTimeZoomToolbar';

type PreviewTab = 'schedule' | 'capacity';

type StepShiftSchedulePreviewProps = {
  draft: ShiftScheduleCreateDraft;
  turnaroundLimitSeconds?: number | null;
  /** 點鉛筆僅跳轉至對應步驟，不在預覽頁內編輯 */
  onNavigateToStep?: (step: CreateShiftScheduleStep) => void;
  /** 清單唯讀結果：隱藏引導文案 */
  resultView?: boolean;
  /** 僅顯示第七步班次／運能預覽板（供班表調整申請等嵌入） */
  previewBoardOnly?: boolean;
};

function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  return i18n.t('shiftList.schedulePreview.seconds', { value: Math.round(seconds) });
}

function formatActionReviewLine(
  action: ShiftRouteSegmentAction,
  mediaById: Map<string, MediaLibraryOption>,
  facilityGroups: ActionFacilityTypeGroup[],
): string {
  const category = resolveShiftActionCategory(action.categoryId);
  const parts: string[] = [category?.label ?? i18n.t('shiftList.schedulePreview.noCategory')];

  if (
    category
    && category.offsetUnits.length > 0
    && action.offsetValue != null
    && action.offsetUnit
  ) {
    parts.push(
      `${category.offsetLabel ?? ''}${action.offsetValue}${labelForOffsetUnit(action.offsetUnit)}`,
    );
  }

  if (category?.requiresTargetSelect) {
    const targetLabel = resolveFacilityTargetLabel(
      action.targetKind,
      action.targetId,
      facilityGroups,
    );
    parts.push(targetLabel || i18n.t('shiftList.schedulePreview.noFacility'));
  }

  if (action.behavior) {
    if (isMediaBehavior(action.behavior)) {
      const resourceId = action.resourceId?.trim() ?? '';
      const media = resourceId ? mediaById.get(resourceId) : undefined;
      if (media) {
        const kindLabel = media.kind === 'group' ? i18n.t('shiftList.schedulePreview.mediaGroup') : i18n.t('shiftList.schedulePreview.music');
        parts.push(i18n.t('shiftList.schedulePreview.playNamed', { kind: kindLabel, name: media.name }));
      } else if (resourceId) {
        parts.push(i18n.t('shiftList.schedulePreview.playMusicId', { id: resourceId }));
      } else {
        parts.push(i18n.t('shiftList.schedulePreview.behaviorNoMedia', { behavior: labelForActionBehavior(action.behavior) }));
      }
    } else {
      parts.push(labelForActionBehavior(action.behavior));
    }
  }

  return parts.join(' · ');
}

function ActionZoneReviewBlock({
  zoneLabel,
  actions,
  mediaById,
  facilityGroups,
}: {
  zoneLabel: string;
  actions: ShiftRouteSegmentAction[];
  mediaById: Map<string, MediaLibraryOption>;
  facilityGroups: ActionFacilityTypeGroup[];
}) {
  if (actions.length === 0) return null;
  return (
    <div className="rounded-lg border border-dashed border-zinc-700/60 bg-zinc-950/50 px-3 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-zinc-400">{zoneLabel}</p>
      <ul className="mt-1.5 space-y-1">
        {actions.map((action, index) => (
          <li key={action.id} className="text-xs text-zinc-300">
            <span className="mr-1.5 font-semibold uppercase text-[#7CB8FF]">
              {String.fromCharCode(97 + index)}.
            </span>
            {formatActionReviewLine(action, mediaById, facilityGroups)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewSection({
  step,
  title,
  onNavigate,
  unstyled = false,
  children,
}: {
  step: CreateShiftScheduleStep;
  title: string;
  onNavigate?: (step: CreateShiftScheduleStep) => void;
  unstyled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      className={
        unstyled
          ? 'flex min-h-0 flex-1 flex-col'
          : 'rounded-xl border border-zinc-800/80 bg-[#0c0c0e] px-5 py-4'
      }
    >
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate(step)}
              title={t('shiftList.schedulePreview.goTo', { title })}
              aria-label={t('shiftList.schedulePreview.goTo', { title })}
              className="inline-flex size-8 items-center justify-center rounded-lg text-[#2B7FFF] transition hover:bg-[rgba(43,127,255,0.12)]"
            >
              <Pencil className="size-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}
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
  const { t } = useTranslation();
  const hasLimit = turnaroundLimitSeconds != null && turnaroundLimitSeconds > 0;
  const isOver = hasLimit && summary.totalMinCycleSeconds > (turnaroundLimitSeconds ?? 0);

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-zinc-200">{t('shiftList.schedulePreview.overallValues')}</h4>
        {hasLimit ? (
          <span className="text-xs text-zinc-500">
            {t('shiftList.schedulePreview.turnaroundLimit', { value: formatSeconds(turnaroundLimitSeconds) })}
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
          <div className="text-xs font-medium text-zinc-400">{t('shiftList.schedulePreview.cycleFastest')}</div>
          <div
            className={`mt-2 text-2xl font-bold tabular-nums ${
              isOver ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {formatSeconds(summary.totalMinCycleSeconds)}
          </div>
          <div className="mt-1.5 text-[10px] font-medium text-zinc-500">
            {t('shiftList.schedulePreview.cycleBreakdown', { travel: summary.totalMinTravelSeconds, dwell: summary.totalDwellWithSlackSeconds, switch: summary.totalSwitchBufferSeconds, recovery: summary.recoverySeconds })}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="text-xs font-medium text-zinc-400">{t('shiftList.schedulePreview.cycleAverage')}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-200">
            {formatSeconds(summary.totalAvgCycleSeconds)}
          </div>
          <div className="mt-1.5 text-[10px] font-medium text-zinc-500">
            {t('shiftList.schedulePreview.cycleBreakdown', { travel: summary.totalAvgTravelSeconds, dwell: summary.totalDwellWithSlackSeconds, switch: summary.totalSwitchBufferSeconds, recovery: summary.recoverySeconds })}
          </div>
        </div>
      </div>

      {hasLimit ? (
        <div className="mt-3">
          {isOver ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
              <span>
                {t('shiftList.schedulePreview.overLimit')}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <span>{t('shiftList.schedulePreview.withinLimit')}</span>
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
  compact = false,
}: {
  route: ShiftScheduleSelectedRoute;
  recoverySeconds: number;
  /** 手動製作：列出站點名稱，不顯示路線預設靠站／緩衝秒數（各班次卡可不同） */
  compact?: boolean;
}) {
  const { t } = useTranslation();
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
            {t('shiftList.schedulePreview.group', { name: route.groupName || '—' })}
            {compact
              ? null
              : route.stationDwellsConfirmed
                ? t('shiftList.schedulePreview.dwellConfirmed')
                : t('shiftList.schedulePreview.dwellUnconfirmed')}
          </p>
        </div>
      </div>

      {compact ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-zinc-500">{t('shiftList.schedulePreview.stations')}</p>
          {route.stationDwells.length === 0 ? (
            <p className="text-xs text-zinc-600">{t('shiftList.schedulePreview.noStationData')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {route.stationDwells.map((dwell, index) => (
                <li
                  key={`${route.routeId}-${dwell.stationId}`}
                  className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-300"
                >
                  <span className="mr-1 tabular-nums text-zinc-500">{index + 1}.</span>
                  <span className="text-zinc-200">{dwell.stationName || dwell.stationId}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <RouteReviewCardParametricDetails
          route={route}
          recoverySeconds={recoverySeconds}
        />
      )}
    </div>
  );
}

function RouteReviewCardParametricDetails({
  route,
  recoverySeconds,
}: {
  route: ShiftScheduleSelectedRoute;
  recoverySeconds: number;
}) {
  const { t } = useTranslation();
  const dwellSlack = normalizeDwellSlackSeconds(route.dwellSlackSeconds);
  const switchBuffer = normalizeSwitchBufferAfterSeconds(route.switchBufferAfterSeconds);
  const dwellWithSlack = sumStationDwellSecondsWithSlack(route.stationDwells, dwellSlack);

  return (
    <>
      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-zinc-500">{t('shiftList.schedulePreview.avgTravel')}</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">
            {formatSeconds(route.avgTravelTimeSeconds)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">{t('shiftList.schedulePreview.minTravel')}</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">
            {formatSeconds(route.minTravelTimeSeconds)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">{t('shiftList.schedulePreview.switchBuffer')}</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">{formatSeconds(switchBuffer)}</p>
        </div>
        <div>
          <p className="text-zinc-500">{t('shiftList.schedulePreview.dwellSlack')}</p>
          <p className="mt-0.5 tabular-nums text-zinc-200">{formatSeconds(dwellSlack)}</p>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs text-zinc-500">{t('shiftList.schedulePreview.stationDwells')}</p>
        {route.stationDwells.length === 0 ? (
          <p className="text-xs text-zinc-600">{t('shiftList.schedulePreview.noStationData')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {route.stationDwells.map((dwell, index) => {
              const role = resolveStationDwellListRole(dwell, index);
              const mode = resolveStationDwellMode(dwell);
              const modeLabel =
                role !== 'editable'
                  ? formatStationDwellRoleLabel(role)
                  : mode === 'no_stop'
                    ? t('shiftList.schedulePreview.noStop')
                    : mode === 'line_change'
                      ? t('shiftList.schedulePreview.lineChange')
                      : formatSeconds(dwell.dwellSeconds);
              return (
                <li
                  key={`${route.routeId}-${dwell.stationId}`}
                  className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-300"
                >
                  <span className="text-zinc-200">{dwell.stationName}</span>
                  <span className="ml-1.5 tabular-nums text-zinc-500">{modeLabel}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          {t('shiftList.schedulePreview.effectiveDwell')}{' '}
          <span className="tabular-nums text-zinc-300">
            {formatSeconds(dwellWithSlack)}
          </span>
          <span className="mx-1.5 text-zinc-700">·</span>
          {t('shiftList.schedulePreview.recovery')}{' '}
          <span className="tabular-nums text-zinc-300">{formatSeconds(recoverySeconds)}</span>
        </p>
      </div>
    </>
  );
}

export function StepShiftSchedulePreview({
  draft,
  turnaroundLimitSeconds = null,
  onNavigateToStep,
  resultView = false,
  previewBoardOnly = false,
}: StepShiftSchedulePreviewProps) {
  const { t } = useTranslation();
  const output = draft.scheduleOutput;
  const [activeTab, setActiveTab] = useState<PreviewTab>('schedule');
  const [gridZoom, setGridZoom] = useState(1);
  const [intervals, setIntervals] = useState<TimeSlotInterval[]>([]);
  const [attributes, setAttributes] = useState<TimeSlotAttribute[]>([]);
  const [templateTasks, setTemplateTasks] = useState<ScheduleTask[]>([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [vehicleCapacity, setVehicleCapacity] = useState(50);
  const [mediaOptions, setMediaOptions] = useState<MediaLibraryOption[]>([]);
  const [facilityGroups, setFacilityGroups] = useState<ActionFacilityTypeGroup[]>([]);
  const orderedRoutes = useMemo(
    () => sortSelectedRoutesByExecutionOrder(draft.routeGroups.selectedRoutes),
    [draft.routeGroups.selectedRoutes],
  );

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaLibraryOption>();
    for (const item of mediaOptions) {
      map.set(item.id, item);
    }
    return map;
  }, [mediaOptions]);

  const recoverySeconds = normalizeMinimumRecoveryTimeSeconds(
    draft.routeGroups.minimumRecoveryTimeSeconds,
  );

  const routeCycleSummary = useMemo(
    () => summarizeRouteGroupsCycle(draft.routeGroups),
    [draft.routeGroups],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchMediaLibraryOptions()
      .then((items) => {
        if (!cancelled) setMediaOptions(items);
      })
      .catch(() => {
        if (!cancelled) setMediaOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const mapId = draft.routeGroups.mapId;
    if (!mapId.trim()) {
      setFacilityGroups([]);
      return;
    }
    void loadActionFacilityGroups(mapId)
      .then((groups) => {
        if (!cancelled) setFacilityGroups(groups);
      })
      .catch(() => {
        if (!cancelled) setFacilityGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.routeGroups.mapId]);

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
    ? t('shiftList.schedulePreview.skipMaintenance')
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
      {!previewBoardOnly && !resultView ? (
        <h2 className="mb-5 shrink-0 text-base font-medium text-zinc-100">
          {t('shiftList.schedulePreview.confirmTitle')}
        </h2>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {!previewBoardOnly ? (
        <>
        <ReviewSection step={1} title={t('shiftList.schedulePreview.basic')} onNavigate={onNavigateToStep}>
          <MetaGrid
            items={[
              { label: t('shiftList.schedulePreview.name'), value: draft.basic.name },
              { label: t('shiftList.schedulePreview.version'), value: draft.basic.version },
              { label: t('shiftList.schedulePreview.remarks'), value: draft.basic.remarks },
            ]}
          />
        </ReviewSection>

        <ReviewSection step={2} title={t('shiftList.schedulePreview.timeTemplate')} onNavigate={onNavigateToStep}>
          <SimpleNameLine value={templateDisplayName} />
        </ReviewSection>

        <ReviewSection step={3} title={t('shiftList.schedulePreview.maintenance')} onNavigate={onNavigateToStep}>
          <SimpleNameLine value={maintenanceDisplayName} />
        </ReviewSection>

        <ReviewSection step={4} title={t('shiftList.schedulePreview.routeGroups')} onNavigate={onNavigateToStep}>
          {orderedRoutes.length === 0 ? (
            <p className="text-sm text-zinc-500">{t('shiftList.schedulePreview.noRoutes')}</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 px-3 py-2 text-xs text-zinc-400">
                {draft.creationMode !== 'manual' ? (
                  <>
                    <span>{t('shiftList.schedulePreview.strategyMinRecovery')} </span>
                    <span className="tabular-nums text-zinc-200">
                      {formatSeconds(recoverySeconds)}
                    </span>
                    <span className="mx-2 text-zinc-700">·</span>
                    <span>{t('shiftList.schedulePreview.collisionProtect')} </span>
                    <span className="tabular-nums text-zinc-200">
                      {formatSeconds(
                        normalizeCollisionProtectionSeconds(
                          draft.routeGroups.collisionProtectionSeconds,
                        ),
                      )}
                    </span>
                    <span className="mx-2 text-zinc-700">·</span>
                  </>
                ) : null}
                <span>{t('shiftList.schedulePreview.selectedRoutes')} </span>
                <span className="tabular-nums text-zinc-200">{orderedRoutes.length}</span>
                <span className="mx-2 text-zinc-700">·</span>
                <span>{t('shiftList.schedulePreview.execOrder')} </span>
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
                  compact={draft.creationMode === 'manual'}
                />
              ))}
            </div>
          )}
        </ReviewSection>

        <ReviewSection step={5} title={t('shiftList.schedulePreview.actionSettings')} onNavigate={onNavigateToStep}>
            {draft.actionSettings.routes.every((route) => {
              const stationCount = (route.stations ?? []).reduce(
                (sum, station) =>
                  sum + station.beforeArrive.length + station.afterArrive.length,
                0,
              );
              const movingCount = (route.movingLegs ?? []).reduce(
                (sum, leg) => sum + leg.actions.length,
                0,
              );
              return stationCount + movingCount === 0;
            }) ? (
              <p className="text-sm text-zinc-500">{t('shiftList.schedulePreview.noActions')}</p>
            ) : (
              <div className="space-y-4">
                {draft.actionSettings.routes.map((route) => {
                  const stations = route.stations ?? [];
                  const movingLegs = route.movingLegs ?? [];
                  const hasAnyAction =
                    stations.some(
                      (station) =>
                        station.beforeArrive.length > 0
                        || station.afterArrive.length > 0,
                    )
                    || movingLegs.some((leg) => leg.actions.length > 0);
                  if (!hasAnyAction) return null;

                  return (
                    <div
                      key={route.routeId}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-4 py-3"
                    >
                      <p className="text-sm font-medium text-zinc-100">
                        {route.routeName}
                        {route.routeCode ? (
                          <span className="ml-2 text-xs text-zinc-500">{route.routeCode}</span>
                        ) : null}
                      </p>

                      <div className="mt-3 space-y-4">
                        {stations.map((station, stationIndex) => {
                          const nextStation = stations[stationIndex + 1];
                          const movingLeg = nextStation
                            ? movingLegs.find(
                                (leg) =>
                                  leg.fromStationId === station.stationId
                                  && leg.toStationId === nextStation.stationId,
                              )
                            : null;
                          const hasStationActions =
                            station.beforeArrive.length > 0
                            || station.afterArrive.length > 0
                            || (movingLeg?.actions.length ?? 0) > 0;
                          if (!hasStationActions) return null;

                          return (
                            <div key={station.stationId} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="flex size-6 items-center justify-center rounded-full bg-[#2B7FFF]/15 text-[10px] font-semibold tabular-nums text-[#7CB8FF]">
                                  {stationIndex + 1}
                                </span>
                                <span className="text-xs font-medium text-zinc-200">
                                  {station.stationName}
                                </span>
                              </div>

                              <div className="space-y-2 pl-1">
                                <ActionZoneReviewBlock
                                  zoneLabel={SHIFT_ACTION_ZONE_LABELS.before_arrive}
                                  actions={station.beforeArrive}
                                  mediaById={mediaById}
                                  facilityGroups={facilityGroups}
                                />
                                <ActionZoneReviewBlock
                                  zoneLabel={SHIFT_ACTION_ZONE_LABELS.after_arrive}
                                  actions={station.afterArrive}
                                  mediaById={mediaById}
                                  facilityGroups={facilityGroups}
                                />
                                {movingLeg ? (
                                  <ActionZoneReviewBlock
                                    zoneLabel={`${SHIFT_ACTION_ZONE_LABELS.moving} · ${movingLeg.fromStationName} → ${movingLeg.toStationName}`}
                                    actions={movingLeg.actions}
                                    mediaById={mediaById}
                                    facilityGroups={facilityGroups}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ReviewSection>
        </>
        ) : null}

        <ReviewSection
          step={6}
          title={previewBoardOnly ? '' : t('shiftList.schedulePreview.adjustSchedule')}
          onNavigate={previewBoardOnly ? undefined : onNavigateToStep}
          unstyled={previewBoardOnly}
        >
          {!output ? (
            <PanelNoData
              message={t('shiftList.schedulePreview.noScheduleOutput')}
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
                    {t('shiftList.schedulePreview.tripPreview')}
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
                    {t('shiftList.schedulePreview.capacityTrend')}
                    {activeTab === 'capacity' ? (
                      <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#2B7FFF]" />
                    ) : null}
                  </button>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-2 pb-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                    {periodLegends.map((item) => (
                      <AttributeLegendBadgeChip key={item.attributeId} item={item} />
                    ))}
                  </div>
                  {activeTab === 'schedule' ? (
                    <ScheduleTimeZoomToolbar
                      zoom={gridZoom}
                      onChange={setGridZoom}
                      standalone
                    />
                  ) : null}
                </div>
              </div>

              {/* 保持掛載以免切換運能趨勢後橫移位置被重置 */}
              <div className={activeTab === 'schedule' ? '' : 'hidden'}>
                {templateLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                    {t('shiftList.schedulePreview.loadingPreview')}
                  </div>
                ) : output.plan ? (
                  <ShiftSchedulePlanGrid
                    plan={output.plan}
                    intervals={intervals}
                    attributes={attributes}
                    templateTasks={templateTasks}
                    selectedRoutes={draft.routeGroups.selectedRoutes}
                    minimumRecoveryTimeSeconds={draft.routeGroups.minimumRecoveryTimeSeconds}
                    hideStrategyBuffers={draft.creationMode === 'manual'}
                    zoom={gridZoom}
                  />
                ) : (
                  <PanelNoData message={t('shiftList.schedulePreview.missingTrips')} className="min-h-[240px]" />
                )}
              </div>
              {activeTab === 'capacity' ? (
                templateLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                    {t('shiftList.schedulePreview.loadingCapacity')}
                  </div>
                ) : (
                  <CapacityTrendChart
                    plan={output.plan}
                    intervals={intervals}
                    attributes={attributes}
                    vehicleCapacity={vehicleCapacity}
                    selectedRoutes={draft.routeGroups.selectedRoutes}
                    serviceDirectionTags={draft.routeGroups.serviceDirectionTags}
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
