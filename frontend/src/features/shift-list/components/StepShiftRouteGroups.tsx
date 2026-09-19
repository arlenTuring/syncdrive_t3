import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeIntegerInput } from '../../maintenance-tasks/utils/numericInput';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { computeTurnaroundLimitSegments } from '../../time-templates/utils/turnaroundLimitSegments';
import { resolveStrictestTurnaroundLimitSeconds } from '../../time-templates/utils/turnaroundLimitSegments';
import type {
  ShiftScheduleCreationMode,
  ShiftScheduleRouteGroupsDraft,
  ShiftScheduleSelectedRoute,
  ShiftScheduleServiceDirectionTag,
  ShiftScheduleStationDwell,
  ShiftStationDwellMode,
} from '../types/create';
import {
  applyStationDwellWithSlack,
  areStationDwellsComplete,
  createSelectedRouteInstanceId,
  createServiceDirectionTagId,
  emptyShiftRouteRelationGraph,
  isMainlineRouteWithinTurnaroundLimit,
  isPrimarySelectedRoute,
  isSelectedRouteDwellReady,
  isStationDwellRequired,
  moveSelectedRouteExecutionOrder,
  setSelectedRouteAsHead,
  nextExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeCollisionProtectionSeconds,
  normalizeSelectedRouteExecutionOrders,
  resolveRouteOrderPosition,
  resolveNextRouteInExecutionOrder,
  resolveSelectedRouteInstanceId,
  resolveStationDwellListRole,
  formatStationDwellRoleLabel,
  resolveStationDwellMode,
  sortSelectedRoutesByExecutionOrder,
  pruneRouteRelationLinksByJunction,
  syncRouteRelationGraphWithRoutes,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
} from '../types/create';
import type { MaintenanceFirstTripOrigin } from '../utils/maintenanceFirstTripOrigins';
import {
  loadShiftRouteGroupCatalog,
  type ShiftRouteGroupCatalogItem,
  type ShiftRouteGroupMapOption,
  type ShiftRouteOption,
} from '../utils/shiftRouteGroupCatalog';
import { RouteRelationGraphEditor } from './RouteRelationGraphEditor';
import { HelpTip } from './HelpTip';
import { ShiftMenuSelect } from './ShiftMenuSelect';
import { ShiftSelectionEmptyState } from './ShiftSelectionEmptyState';
import {
  buildThroughVerificationFingerprint,
  computeRouteThroughPaths,
  emptyShiftRouteThroughAnchorsDraft,
  invalidateThroughAnchorsForRouteChange,
  isThroughVerificationCurrent,
  sortListedThroughCycles,
  type RouteThroughCycle,
} from '../utils/routeRelationThroughCycles';

type StepShiftRouteGroupsProps = {
  draft: ShiftScheduleRouteGroupsDraft;
  onChange: (
    next:
      | ShiftScheduleRouteGroupsDraft
      | ((prev: ShiftScheduleRouteGroupsDraft) => ShiftScheduleRouteGroupsDraft),
  ) => void;
  timeTemplateId: string;
  creationMode?: ShiftScheduleCreationMode;
};

const DWELL_INPUT_CLASS =
  'h-8 w-20 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-2 text-center text-xs tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30 disabled:cursor-not-allowed disabled:opacity-60';

const DWELL_STATIC_CLASS =
  'flex h-8 items-center justify-center rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2.5 text-xs text-zinc-500';

function formatSecondsLabel(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  return i18n.t('shiftList.routeGroups.seconds', { value: seconds });
}

/** 折返時限是哪一段時段算出來的——訊息要指名那一段，使用者才知道回模板改哪裡 */
function formatClockRange(startMinute: number, endMinute: number): string {
  const hhmm = (minute: number) => {
    const total = Math.max(0, Math.round(minute));
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  return `${hhmm(startMinute)}–${hhmm(endMinute)}`;
}

function buildStationDwells(
  route: ShiftRouteOption,
  existing?: ShiftScheduleStationDwell[],
): ShiftScheduleStationDwell[] {
  const byId = new Map((existing ?? []).map((item) => [item.stationId, item]));
  return route.stationIds.map((stationId, index) => {
    const prev = byId.get(stationId);
    const isOrigin = index === 0;
    const flagged = route.stationDwellRequired?.[index];
    const dwellRequired = isOrigin
      ? false
      : flagged === false
        ? false
        : flagged === true
          ? true
          : prev?.dwellRequired === false
            ? false
            : true;
    const dwellMode = dwellRequired
      ? (prev?.dwellMode === 'no_stop' || prev?.dwellMode === 'line_change' || prev?.dwellMode === 'seconds'
          ? prev.dwellMode
          : 'seconds')
      : undefined;
    const dwellSeconds = !dwellRequired
      ? 0
      : dwellMode === 'no_stop' || dwellMode === 'line_change'
        ? 0
        : (prev?.dwellSeconds ?? null);
    return {
      stationId,
      stationName:
        route.stationNames[index]
        ?? prev?.stationName
        ?? stationId,
      dwellSeconds,
      ...(dwellMode ? { dwellMode } : {}),
      dwellRequired,
    };
  });
}

function findCatalogRoute(
  catalog: ShiftRouteGroupCatalogItem[],
  routeId: string,
): { group: ShiftRouteGroupCatalogItem; route: ShiftRouteOption } | null {
  for (const group of catalog) {
    const route = group.routes.find((item) => item.routeId === routeId);
    if (route) return { group, route };
  }
  return null;
}

function StationDwellEditor({
  route,
  turnaroundLimitSeconds,
  minimumRecoveryTimeSeconds,
  hideRecoveryInSummary = false,
  showSwitchBuffer = false,
  onUpdateDwellSeconds,
  onUpdateDwellMode,
  onUpdateDwellSlack,
  onUpdateSwitchBuffer,
}: {
  route: ShiftScheduleSelectedRoute;
  turnaroundLimitSeconds: number | null;
  minimumRecoveryTimeSeconds: number | null;
  hideRecoveryInSummary?: boolean;
  showSwitchBuffer?: boolean;
  onUpdateDwellSeconds: (stationId: string, value: string) => void;
  onUpdateDwellMode: (stationId: string, mode: ShiftStationDwellMode) => void;
  onUpdateDwellSlack: (value: string) => void;
  onUpdateSwitchBuffer?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const dwellsComplete = areStationDwellsComplete(route.stationDwells);
  const recoveryForBudget = hideRecoveryInSummary
    ? 0
    : (minimumRecoveryTimeSeconds ?? 0);
  const withinLimit = isMainlineRouteWithinTurnaroundLimit(
    route,
    turnaroundLimitSeconds,
    recoveryForBudget,
  );

  const totalDwellWithSlack = route.stationDwells.reduce((sum, d, index) => {
    return sum + applyStationDwellWithSlack(d, route.dwellSlackSeconds, index);
  }, 0);
  const recoverySeconds = hideRecoveryInSummary ? 0 : (minimumRecoveryTimeSeconds ?? 0);
  const totalMinSum = (route.minTravelTimeSeconds ?? 0) + recoverySeconds + totalDwellWithSlack;
  const totalAvgSum = (route.avgTravelTimeSeconds ?? 0) + recoverySeconds + totalDwellWithSlack;
  const showIncompleteWarning = !dwellsComplete;
  const showTurnaroundWarning = dwellsComplete && !withinLimit;
  const cycleLabel = hideRecoveryInSummary
    ? i18n.t('shiftList.routeGroups.cycleMinNoRecovery')
    : i18n.t('shiftList.routeGroups.cycleMinWithRecovery');
  const avgCycleLabel = hideRecoveryInSummary
    ? i18n.t('shiftList.routeGroups.cycleAvgNoRecovery')
    : i18n.t('shiftList.routeGroups.cycleAvgWithRecovery');
  const breakdownSuffix = hideRecoveryInSummary
    ? i18n.t('shiftList.routeGroups.breakdownNoRecovery', { travel: route.minTravelTimeSeconds ?? 0, dwell: totalDwellWithSlack })
    : i18n.t('shiftList.routeGroups.breakdownWithRecovery', { travel: route.minTravelTimeSeconds ?? 0, recovery: recoverySeconds, dwell: totalDwellWithSlack });
  const avgBreakdownSuffix = hideRecoveryInSummary
    ? i18n.t('shiftList.routeGroups.breakdownNoRecovery', { travel: route.avgTravelTimeSeconds ?? 0, dwell: totalDwellWithSlack })
    : i18n.t('shiftList.routeGroups.breakdownWithRecovery', { travel: route.avgTravelTimeSeconds ?? 0, recovery: recoverySeconds, dwell: totalDwellWithSlack });

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-3 py-3">
      <div className="flex flex-wrap items-end gap-3">
        {route.stationDwells.map((dwell, index) => {
          const role = resolveStationDwellListRole(dwell, index);
          if (role !== 'editable') {
            const roleLabel = formatStationDwellRoleLabel(role);
            return (
              <div key={dwell.stationId} className="block text-center">
            <span className="mb-1 block text-[11px] text-zinc-500">{dwell.stationName}</span>
                <div
                  className={DWELL_STATIC_CLASS}
                  aria-label={`${dwell.stationName} ${roleLabel}`}
                >
                  {roleLabel}
                </div>
              </div>
            );
          }
          const mode = resolveStationDwellMode(dwell);
          return (
            <label key={dwell.stationId} className="block text-center">
              <span className="mb-1 block text-[11px] text-zinc-500">
                {t('shiftList.routeGroups.station', { name: dwell.stationName })}
              </span>
              <div className="flex h-8 items-center justify-center gap-1.5">
                <ShiftMenuSelect
                  label={t('shiftList.routeGroups.dwellMode', { name: dwell.stationName })}
                  hideLabel
                  size="sm"
                  value={mode}
                  options={[
                    { value: 'seconds', label: t('shiftList.routeGroups.dwellSeconds') },
                    { value: 'no_stop', label: t('shiftList.routeGroups.noStop') },
                    { value: 'line_change', label: t('shiftList.routeGroups.lineChange') },
                  ]}
                  onChange={(next) =>
                    onUpdateDwellMode(dwell.stationId, next as ShiftStationDwellMode)
                  }
                  widthClass="w-[100px] shrink-0"
                  panelWidth={112}
                  aria-label={t('shiftList.routeGroups.dwellMode', { name: dwell.stationName })}
                />
                {mode === 'seconds' ? (
              <input
                type="text"
                inputMode="numeric"
                value={dwell.dwellSeconds == null ? '' : String(dwell.dwellSeconds)}
                    onChange={(e) =>
                      onUpdateDwellSeconds(dwell.stationId, e.target.value.replace(/\D/g, ''))
                    }
                    placeholder={t('shiftList.routeGroups.required')}
                className={DWELL_INPUT_CLASS}
                aria-label={t('shiftList.routeGroups.dwellSecondsAria', { name: dwell.stationName })}
              />
                ) : null}
            </div>
          </label>
          );
        })}

        <label className="block text-center">
          <span className="mb-1 block text-[11px] text-zinc-500">{t('shiftList.routeGroups.dwellSlack')}</span>
          <div className="flex h-8 items-center justify-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              value={String(route.dwellSlackSeconds)}
              onChange={(e) => onUpdateDwellSlack(e.target.value)}
              className={DWELL_INPUT_CLASS}
              aria-label={t('shiftList.routeGroups.dwellSlackAria', { name: route.routeName })}
            />
          </div>
        </label>

        {showSwitchBuffer && onUpdateSwitchBuffer ? (
          <label className="block text-center">
            <span className="mb-1 block text-[11px] text-zinc-500">{t('shiftList.routeGroups.switchBuffer')}</span>
            <div className="flex h-8 items-center justify-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={String(route.switchBufferAfterSeconds)}
                onChange={(e) => onUpdateSwitchBuffer(e.target.value)}
                className={DWELL_INPUT_CLASS}
                aria-label={t('shiftList.routeGroups.switchBufferAria', { name: route.routeName })}
              />
            </div>
          </label>
          ) : null}
      </div>

      <div className="mt-2 space-y-1">
        {showIncompleteWarning && (
          <p className="text-[10px] text-zinc-500">
            {t('shiftList.routeGroups.dwellIncomplete')}
          </p>
        )}
        {showTurnaroundWarning && (
          <p className="text-[10px] leading-4 text-red-400">
            {t('shiftList.routeGroups.overTurnaroundBefore', { min: formatSecondsLabel(totalMinSum) })}
            （{formatSecondsLabel(turnaroundLimitSeconds)}）
            {turnaroundLimitSeconds != null && turnaroundLimitSeconds > 0
              ? ` ${formatSecondsLabel(totalMinSum - turnaroundLimitSeconds)}`
              : ''}
            {t('shiftList.routeGroups.overTurnaroundAfter')}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-start gap-x-1.5 gap-y-1 text-[10px] font-medium text-zinc-500">
          <span className="text-zinc-400">{cycleLabel}：</span>
          <span className="tabular-nums text-zinc-300">{formatSecondsLabel(totalMinSum)}</span>
          <span className="text-zinc-600">{breakdownSuffix}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">{avgCycleLabel}：</span>
          <span className="tabular-nums text-zinc-300">{formatSecondsLabel(totalAvgSum)}</span>
          <span className="text-zinc-600">{avgBreakdownSuffix}</span>
        </div>
        </div>
    </div>
  );
}

function RouteOrderControls({
  showArrows,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  showArrows: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const { t } = useTranslation();
  if (!showArrows) return null;

  return (
    <div className="flex shrink-0 flex-col">
          <button
            type="button"
            title={t('shiftList.routeGroups.moveEarlier')}
            disabled={!canMoveUp}
        onClick={() => onMove('up')}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            title={t('shiftList.routeGroups.moveLater')}
            disabled={!canMoveDown}
        onClick={() => onMove('down')}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
          >
            <ArrowDown className="size-3.5" />
          </button>
    </div>
  );
}

function RecoveryAndServiceDirectionBar({
  minimumRecoveryTimeSeconds,
  onUpdateRecoveryTime,
  collisionProtectionSeconds,
  onUpdateCollisionProtection,
  serviceDirectionTags,
  onAddTag,
  onRemoveTag,
}: {
  minimumRecoveryTimeSeconds: number | null;
  onUpdateRecoveryTime: (value: string) => void;
  collisionProtectionSeconds: number | null;
  onUpdateCollisionProtection: (value: string) => void;
  serviceDirectionTags: ShiftScheduleServiceDirectionTag[];
  onAddTag: (name: string) => void;
  onRemoveTag: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (drafting) inputRef.current?.focus();
  }, [drafting]);

  const commitDraft = () => {
    const name = draftName.trim();
    if (!name) {
      setDrafting(false);
      setDraftName('');
      return;
    }
    onAddTag(name);
    setDraftName('');
    setDrafting(false);
  };

  return (
    <div className="flex flex-wrap items-start gap-6 rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm text-zinc-300">
          <HelpTip label={t('shiftList.routeGroups.minRecoveryHelp')}>
            <p>{t('shiftList.routeGroups.minRecoveryHelp1')}</p>
            <p className="mt-1 text-zinc-500">{t('shiftList.routeGroups.minRecoveryHelp2')}</p>
          </HelpTip>
          {t('shiftList.routeGroups.minRecoveryLabel')}
        </span>
        <div className="flex items-center gap-2">
        <input
            type="text"
            inputMode="numeric"
            value={minimumRecoveryTimeSeconds ?? ''}
            onChange={(e) => onUpdateRecoveryTime(e.target.value.replace(/\D/g, ''))}
            placeholder={t('shiftList.routeGroups.minRecoveryPlaceholder')}
            className="h-[36px] w-[140px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm tabular-nums text-zinc-100 placeholder-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]"
            aria-label={t('shiftList.routeGroups.minRecoveryAria')}
          />
          <span className="text-sm text-zinc-500">{t('shiftList.routeGroups.secondsUnit')}</span>
        </div>
      </label>

      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm text-zinc-300">
          <HelpTip label={t('shiftList.routeGroups.collisionHelp')} widthClass="w-72">
            <p>
              {t('shiftList.routeGroups.collisionHelp1')}
            </p>
            <p className="mt-1 text-zinc-500">
              {t('shiftList.routeGroups.collisionHelp2')}
            </p>
            <p className="mt-1 text-zinc-500">
              {t('shiftList.routeGroups.collisionHelp3')}
            </p>
          </HelpTip>
          {t('shiftList.routeGroups.collisionLabel')}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={collisionProtectionSeconds ?? ''}
            onChange={(e) => onUpdateCollisionProtection(e.target.value.replace(/\D/g, ''))}
            placeholder={t('shiftList.routeGroups.collisionPlaceholder')}
            className="h-[36px] w-[140px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm tabular-nums text-zinc-100 placeholder-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]"
            aria-label={t('shiftList.routeGroups.collisionAria')}
          />
          <span className="text-sm text-zinc-500">{t('shiftList.routeGroups.secondsUnit')}</span>
    </div>
      </label>

      <div className="min-w-0 flex-1">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm text-zinc-300">
          <HelpTip label={t('shiftList.routeGroups.serviceDirHelp')} widthClass="w-64">
            <p>
              {t('shiftList.routeGroups.serviceDirHelp1')}
            </p>
            <p className="mt-1 text-zinc-500">
              {t('shiftList.routeGroups.serviceDirHelp2')}
            </p>
            <p className="mt-1 text-zinc-500">{t('shiftList.routeGroups.serviceDirHelp3')}</p>
          </HelpTip>
          {t('shiftList.routeGroups.serviceDir')}
            </span>
                    <div className="flex flex-wrap items-center gap-2">
          {serviceDirectionTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 pl-2.5 pr-1 text-sm text-sky-100"
            >
              {tag.name}
              <button
                type="button"
                title={t('shiftList.routeGroups.deleteTag', { name: tag.name })}
                aria-label={t('shiftList.routeGroups.deleteTagAria', { name: tag.name })}
                onClick={() => onRemoveTag(tag.id)}
                className="rounded-md p-1 text-sky-200/70 hover:bg-sky-500/20 hover:text-sky-50"
              >
                <X className="size-3.5" />
              </button>
                      </span>
          ))}

          {drafting ? (
            <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-950 px-1.5">
                  <input
                ref={inputRef}
                    type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    return;
                  }
                  if (e.key === 'Escape') {
                    setDrafting(false);
                    setDraftName('');
                  }
                }}
                placeholder={t('shiftList.routeGroups.directionName')}
                maxLength={24}
                className="w-28 bg-transparent px-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
                aria-label={t('shiftList.routeGroups.newDirAria')}
              />
              <button
                type="button"
                title={t('shiftList.routeGroups.confirmAdd')}
                aria-label={t('shiftList.routeGroups.confirmAddDirAria')}
                onClick={commitDraft}
                disabled={!draftName.trim()}
                className="rounded-md p-1 text-emerald-400 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="size-4" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                title={t('common.cancel')}
                aria-label={t('shiftList.routeGroups.cancelAddDirAria')}
                onClick={() => {
                  setDrafting(false);
                  setDraftName('');
                }}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="size-3.5" />
              </button>
                </div>
          ) : (
            <button
              type="button"
              title={t('shiftList.routeGroups.addServiceDir')}
              aria-label={t('shiftList.routeGroups.addServiceDir')}
              onClick={() => setDrafting(true)}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-dashed border-zinc-600 text-zinc-400 hover:border-sky-500/50 hover:text-sky-200"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RoutePickerBar({
  catalog,
  excludedRouteIds,
  selectedRouteId,
  onSelectRouteId,
  onConfirm,
  confirmLabel = i18n.t('shiftList.routeGroups.confirmAdd'),
  emptyHint = i18n.t('shiftList.routeGroups.emptyHint'),
  title = i18n.t('shiftList.routeGroups.addRouteTitle'),
  expanded = true,
  onExpand,
  onCancel,
}: {
  catalog: ShiftRouteGroupCatalogItem[];
  excludedRouteIds: ReadonlySet<string>;
  selectedRouteId: string;
  onSelectRouteId: (routeId: string) => void;
  onConfirm: (routeId: string) => void;
  confirmLabel?: string;
  emptyHint?: string;
  title?: string;
  /** false 時只顯示整列按鈕；點擊後才展開下拉＋勾選 */
  expanded?: boolean;
  onExpand?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const availableGroups = useMemo(
    () =>
      catalog
        .map((group) => ({
          ...group,
          routes: group.routes.filter((route) => !excludedRouteIds.has(route.routeId)),
        }))
        .filter((group) => group.routes.length > 0),
    [catalog, excludedRouteIds],
  );

  const canConfirm = Boolean(selectedRouteId) && !excludedRouteIds.has(selectedRouteId);

  if (!expanded) {
  return (
      <button
        type="button"
        onClick={onExpand}
        disabled={availableGroups.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#2B7FFF]/40 bg-[rgba(43,127,255,0.06)] px-4 py-4 text-sm font-medium text-zinc-200 transition hover:border-[#2B7FFF]/70 hover:bg-[rgba(43,127,255,0.1)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-4 text-[#7CB8FF]" />
        {title}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[#2B7FFF]/35 bg-[rgba(43,127,255,0.06)] px-4 py-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-zinc-200">
            <Plus className="size-4 text-[#7CB8FF]" />
            {title}
          </span>
          <ShiftMenuSelect
            label={title}
            hideLabel
            value={selectedRouteId}
            placeholder={availableGroups.length === 0 ? t('shiftList.routeGroups.noRoutesAvailable') : emptyHint}
            groups={availableGroups.map((group) => ({
              label: group.groupName,
              options: group.routes.map((route) => ({
                value: route.routeId,
                label: route.label,
              })),
            }))}
            onChange={onSelectRouteId}
            disabled={availableGroups.length === 0}
            widthClass="min-w-[220px] flex-1"
            panelWidth={280}
            aria-label={title}
          />
        </div>
        <button
          type="button"
          disabled={!canConfirm || availableGroups.length === 0}
          onClick={() => {
            if (!selectedRouteId || excludedRouteIds.has(selectedRouteId)) return;
            onConfirm(selectedRouteId);
          }}
          title={confirmLabel}
          aria-label={confirmLabel}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          <Check className="size-5" strokeWidth={2.5} />
        </button>
      </div>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="px-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          {t('common.cancel')}
        </button>
      ) : null}
    </div>
  );
}

function formatFirstTripOriginsHint(
  origins: MaintenanceFirstTripOrigin[],
): string | null {
  if (origins.length === 0) return null;
  const parts = origins.slice(0, 4).map((origin) => {
    const facilities =
      origin.facilityLabels.length > 0
        ? origin.facilityLabels.join('、')
        : i18n.t('shiftList.routeGroups.yardOrigins');
    return `${facilities} → ${origin.label}`;
  });
  const more = origins.length > 4 ? i18n.t('shiftList.routeGroups.yardExitMore', { count: origins.length }) : '';
  return i18n.t('shiftList.routeGroups.yardExitLabel', { parts: parts.join('；'), more });
}

export function StepShiftRouteGroups({
  draft,
  onChange,
  timeTemplateId,
  creationMode = 'parametric',
}: StepShiftRouteGroupsProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapDisplayName, setMapDisplayName] = useState('');
  const [availableMaps, setAvailableMaps] = useState<ShiftRouteGroupMapOption[]>([]);
  const [firstTripOriginsHint, setFirstTripOriginsHint] = useState<string | null>(null);
  /**
   * 換圖／改起迄之後，哪些東西被自動清掉了。
   *
   * 換圖是允許的動作，但關聯與起算／結算都綁在 instanceId 上，路線換了它們就不能算數。
   * 靜靜清掉一樣難查，所以把「幾條路線換了、剪掉幾條關聯、起算結算有沒有重置」寫出來。
   */
  const [routeSyncNotice, setRouteSyncNotice] = useState<{
    routes: number;
    links: number;
    anchors: boolean;
  } | null>(null);
  /** 使用者／草稿選定的地圖；空字串＝初次載入時跟場域管理目前使用地圖 */
  const [preferredMapId, setPreferredMapId] = useState(() => draft.mapId.trim());
  const [catalog, setCatalog] = useState<ShiftRouteGroupCatalogItem[]>([]);
  const [turnaroundLimitSeconds, setTurnaroundLimitSeconds] = useState<number | null>(null);
  /**
   * 折返時限是<strong>算出來的</strong>，不是某個欄位填的：
   * 該時段同時在跑的正線列數 × 該時段班距，再取全天最小的那一段。
   * 使用者看到數字卻找不到哪裡改，所以要把「是哪一段在擋、怎麼組成的」一起講。
   */
  const [turnaroundBinding, setTurnaroundBinding] = useState<{
    startMinute: number;
    endMinute: number;
    activePassengerCount: number;
    headwaySeconds: number | null;
  } | null>(null);
  const [turnaroundLoading, setTurnaroundLoading] = useState(false);

  const [pendingAddRouteId, setPendingAddRouteId] = useState('');
  const [addPrimaryOpen, setAddPrimaryOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [pendingEditRouteId, setPendingEditRouteId] = useState('');

  const draftRef = useRef(draft);
  const onChangeRef = useRef(onChange);
  draftRef.current = draft;
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadShiftRouteGroupCatalog(preferredMapId || undefined)
      .then((result) => {
        if (cancelled) return;
        setCatalog(result.groups);
        setMapDisplayName(result.mapDisplayName);
        setAvailableMaps(result.availableMaps);
        setFirstTripOriginsHint(formatFirstTripOriginsHint(result.firstTripOrigins));
        setPreferredMapId((prev) => (prev === result.mapId ? prev : result.mapId));
        const validRouteIds = new Set(
          result.groups.flatMap((g) => g.routes.map((r) => r.routeId)),
        );
        const routeMeta = new Map(
          result.groups.flatMap((g) =>
            g.routes.map(
              (r) => [r.routeId, { route: r, group: g }] as const,
            ),
          ),
        );
        const mapChanged =
          draftRef.current.mapId.trim() !== ''
          && draftRef.current.mapId.trim() !== result.mapId;
        /** 這一輪同步後「instanceId 指到別條路線」的那些；關聯與起算結算要跟著失效 */
        const changedInstanceIds = new Set<string>();
        const nextRoutes = normalizeSelectedRouteExecutionOrders(
            draftRef.current.selectedRoutes
            .filter(
              (selected) =>
                isPrimarySelectedRoute(selected) && validRouteIds.has(selected.routeId),
            )
              .map((selected) => {
                const selectedInstanceId = selected.instanceId?.trim() || selected.routeId;
                const hit = routeMeta.get(selected.routeId);
              if (!hit) {
                return {
                  ...selected,
                  backupForInstanceId: null,
                  backupForRouteId: null,
                };
              }
                const { route: meta, group } = hit;
                const prevFirst = selected.stationIds[0] ?? '';
                const prevLast =
                  selected.stationIds[selected.stationIds.length - 1] ?? '';
                const nextFirst = meta.stationIds[0] ?? '';
                const nextLast =
                  meta.stationIds[meta.stationIds.length - 1] ?? '';
                /*
                 * 換地圖或起迄站變了＝這條 routeId 已不是當初編代號時那條。
                 *
                 * routeId 是流水號，換一張圖就可能對到另一條路線（實測 route_4～route_7
                 * 整組挪了一位）。代號要清掉，關聯與起算／結算也一起失效——它們存的都是
                 * instanceId，指向的路線換了就不能再算數。
                 */
                const routeIdentityChanged =
                  mapChanged
                  || prevFirst !== nextFirst
                  || prevLast !== nextLast;
                if (routeIdentityChanged) changedInstanceIds.add(selectedInstanceId);
                return {
                  ...selected,
                  // routeId 在不同地圖可能對到不同路線；名稱／群組／站序必須一起同步
                  routeName: meta.label,
                  groupId: group.groupId,
                  groupName: group.groupName,
                  routeCode: routeIdentityChanged ? null : selected.routeCode,
                  cardLabel: routeIdentityChanged ? null : selected.cardLabel,
                  stationIds: [...meta.stationIds],
                stationDwells: buildStationDwells(
                  meta,
                  mapChanged || routeIdentityChanged
                    ? undefined
                    : selected.stationDwells,
                ),
                stationLegTravels: meta.stationLegTravels.map((leg) => ({ ...leg })),
                avgTravelTimeSeconds: meta.avgTravelTimeSeconds,
                minTravelTimeSeconds: meta.minTravelTimeSeconds,
                backupForInstanceId: null,
                backupForRouteId: null,
                };
              }),
        );
        /*
         * 關聯與起算／結算都存 instanceId，指到的路線換了就不能再算數。
         *
         * 先跟著路線對帳，再把「終站 ≠ 下一條起站」的連線剪掉——留著的話導通驗算會
         * 默默丟掉它們：箭頭照畫在圖上，組合卻算不出來，看不出是哪裡壞的。剪掉幾條、
         * 起算結算有沒有被清，一律寫出來給使用者看。
         */
        const syncedGraph = syncRouteRelationGraphWithRoutes(
          draftRef.current.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
          nextRoutes,
        );
        const pruned = pruneRouteRelationLinksByJunction(syncedGraph, nextRoutes);
        const anchorsResult = invalidateThroughAnchorsForRouteChange(
          draftRef.current.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft(),
          changedInstanceIds,
        );
        setRouteSyncNotice(
          changedInstanceIds.size > 0 || pruned.removed > 0
            ? {
                routes: changedInstanceIds.size,
                links: pruned.removed,
                anchors: anchorsResult.changed,
              }
            : null,
        );
        onChangeRef.current({
          ...draftRef.current,
          mapId: result.mapId,
          minimumRecoveryTimeSeconds: draftRef.current.minimumRecoveryTimeSeconds,
          selectedRoutes: nextRoutes,
          serviceDirectionTags: draftRef.current.serviceDirectionTags ?? [],
          routeRelationGraph: pruned.graph,
          throughAnchors: anchorsResult.anchors,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setCatalog([]);
          setFirstTripOriginsHint(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preferredMapId]);

  useEffect(() => {
    if (!timeTemplateId.trim()) {
      setTurnaroundLimitSeconds(null);
      setTurnaroundBinding(null);
      setTurnaroundLoading(false);
      return;
    }
    let cancelled = false;
    setTurnaroundLoading(true);
    void fetchTimeTemplateDetail(timeTemplateId)
      .then((detail) => {
        if (cancelled) return;
        const body = parseStoredTemplateBody(detail.body ?? {});
        const limit = resolveStrictestTurnaroundLimitSeconds(
          body.tasks, body.intervals, body.attributes,
        );
        setTurnaroundLimitSeconds(limit);
        // 找出實際在擋的那一段——全天最小的那個時限就是它
        const segments = computeTurnaroundLimitSegments(
          body.tasks, body.intervals, body.attributes,
        );
        const binding = limit == null
          ? null
          : segments.find((seg) => seg.turnaroundLimitSeconds === limit) ?? null;
        setTurnaroundBinding(
          binding
            ? {
                startMinute: binding.startMinute,
                endMinute: binding.endMinute,
                activePassengerCount: binding.activePassengerCount,
                headwaySeconds: binding.headwaySeconds,
              }
            : null,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTurnaroundLimitSeconds(null);
        setTurnaroundBinding(null);
      })
      .finally(() => {
        if (!cancelled) setTurnaroundLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timeTemplateId]);

  const primaryRouteIds = useMemo(
    () =>
      new Set(
        draft.selectedRoutes
          .filter((route) => isPrimarySelectedRoute(route))
          .map((route) => route.routeId),
      ),
    [draft.selectedRoutes],
  );

  const selectedByInstanceId = useMemo(
    () =>
      new Map(
        draft.selectedRoutes.map(
          (r) => [resolveSelectedRouteInstanceId(r), r] as const,
        ),
      ),
    [draft.selectedRoutes],
  );

  const primaryRoutes = useMemo(
    () =>
      sortSelectedRoutesByExecutionOrder(
        draft.selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
      ),
    [draft.selectedRoutes],
  );

  const patchSelectedRoute = (
    instanceId: string,
    patch: Partial<ShiftScheduleSelectedRoute>,
  ) => {
    const affectsThrough =
      'stationDwells' in patch
      || 'dwellSlackSeconds' in patch
      || 'switchBufferAfterSeconds' in patch
      || 'minTravelTimeSeconds' in patch
      || 'avgTravelTimeSeconds' in patch
      || 'stationLegTravels' in patch;
    if (affectsThrough) {
      // 結構變更只讓驗證失效；清單保留到使用者再按檢查
    }
    onChange((prev) => {
      const anchors = prev.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
      return {
        ...prev,
        selectedRoutes: prev.selectedRoutes.map((route) =>
          resolveSelectedRouteInstanceId(route) === instanceId ? { ...route, ...patch } : route,
        ),
        ...(affectsThrough
          ? {
              throughAnchors: {
                ...anchors,
                verifiedFingerprint: null,
                verifiedPathCount: 0,
              },
            }
          : {}),
      };
    });
  };

  const commitSelectedRoutes = (selectedRoutes: ShiftScheduleSelectedRoute[]) => {
    const normalized = normalizeSelectedRouteExecutionOrders(
      selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
    );
    onChange((prev) => {
      const anchors = prev.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
      return {
        ...prev,
        selectedRoutes: normalized,
        routeRelationGraph: syncRouteRelationGraphWithRoutes(
          prev.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
          normalized,
        ),
        throughAnchors: {
          ...anchors,
          verifiedFingerprint: null,
          verifiedPathCount: 0,
        },
      };
    });
  };

  const toSelected = (
    group: ShiftRouteGroupCatalogItem,
    route: ShiftRouteOption,
    options?: {
      existing?: ShiftScheduleSelectedRoute;
      executionOrder?: number;
    },
  ): ShiftScheduleSelectedRoute => ({
    instanceId: options?.existing?.instanceId?.trim() || createSelectedRouteInstanceId(),
    routeId: route.routeId,
    routeName: route.label,
    routeCode: options?.existing?.routeCode,
    cardLabel: options?.existing?.cardLabel,
    groupId: group.groupId,
    groupName: group.groupName,
    stationIds: [...route.stationIds],
    stationDwells: buildStationDwells(route, options?.existing?.stationDwells),
    stationDwellsConfirmed: false,
    stationLegTravels: route.stationLegTravels.map((leg) => ({ ...leg })),
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
    executionOrder:
      options?.executionOrder
      ?? options?.existing?.executionOrder
      ?? nextExecutionOrder(draft.selectedRoutes),
    switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(
      options?.existing?.switchBufferAfterSeconds,
    ),
    dwellSlackSeconds: normalizeDwellSlackSeconds(options?.existing?.dwellSlackSeconds),
    backupForInstanceId: null,
    backupForRouteId: null,
  });

  const confirmAddPrimary = (routeId: string) => {
    const id = routeId.trim();
    if (!id) return;
    const found = findCatalogRoute(catalog, id);
    if (!found || primaryRouteIds.has(id)) return;
    commitSelectedRoutes([
      ...draft.selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
      toSelected(found.group, found.route),
    ]);
    setPendingAddRouteId('');
    setAddPrimaryOpen(false);
  };

  const replaceRoute = (oldInstanceId: string, newRouteId: string) => {
    const found = findCatalogRoute(catalog, newRouteId);
    if (!found) return;
    const existing = selectedByInstanceId.get(oldInstanceId);
    if (!existing) return;

    const excluded = new Set(primaryRouteIds);
    excluded.delete(existing.routeId);
    if (excluded.has(newRouteId)) return;

    commitSelectedRoutes(
      draft.selectedRoutes
        .filter((route) => isPrimarySelectedRoute(route))
        .map((route) => {
          if (resolveSelectedRouteInstanceId(route) !== oldInstanceId) return route;
          return toSelected(found.group, found.route, {
            existing,
            executionOrder: existing.executionOrder,
          });
        }),
    );
  };

  const deletePrimary = (instanceId: string) => {
    commitSelectedRoutes(
      draft.selectedRoutes.filter((r) => {
        if (!isPrimarySelectedRoute(r)) return false;
        return resolveSelectedRouteInstanceId(r) !== instanceId;
      }),
    );
    if (editingRouteId === instanceId) setEditingRouteId(null);
  };

  const moveRouteOrder = (instanceId: string, direction: 'up' | 'down') => {
    commitSelectedRoutes(
      moveSelectedRouteExecutionOrder(
        draft.selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
        instanceId,
        direction,
      ),
    );
  };

  const setRouteAsHead = (instanceId: string) => {
    const anchors = draft.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
    const startInstanceIds = anchors.startInstanceIds.includes(instanceId)
      ? anchors.startInstanceIds
      : [...anchors.startInstanceIds, instanceId];
    const endInstanceIds = anchors.endInstanceIds.filter((id) => id !== instanceId);
    const normalized = normalizeSelectedRouteExecutionOrders(
      setSelectedRouteAsHead(
        draft.selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
        instanceId,
      ),
    );
      onChange({
        ...draft,
      selectedRoutes: normalized,
      routeRelationGraph: syncRouteRelationGraphWithRoutes(
        draft.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
        normalized,
      ),
      throughAnchors: {
        ...anchors,
        startInstanceIds,
        endInstanceIds,
        verifiedFingerprint: null,
        verifiedPathCount: 0,
      },
    });
  };

  const updateDwellSeconds = (instanceId: string, stationId: string, raw: string) => {
    const digits = sanitizeIntegerInput(raw);
    const dwellSeconds = digits === '' ? null : Math.max(1, Number(digits));
    const current = selectedByInstanceId.get(instanceId);
    if (!current) return;
    const target = current.stationDwells.find((dwell) => dwell.stationId === stationId);
    if (target && !isStationDwellRequired(target)) return;
    patchSelectedRoute(instanceId, {
      stationDwellsConfirmed: false,
      stationDwells: current.stationDwells.map((dwell) =>
        dwell.stationId === stationId
          ? { ...dwell, dwellMode: 'seconds', dwellSeconds }
          : dwell,
      ),
    });
  };

  const updateDwellMode = (
    instanceId: string,
    stationId: string,
    mode: ShiftStationDwellMode,
  ) => {
    const current = selectedByInstanceId.get(instanceId);
    if (!current) return;
    const target = current.stationDwells.find((dwell) => dwell.stationId === stationId);
    if (target && !isStationDwellRequired(target)) return;
    patchSelectedRoute(instanceId, {
      stationDwellsConfirmed: false,
      stationDwells: current.stationDwells.map((dwell) => {
        if (dwell.stationId !== stationId) return dwell;
        if (mode === 'no_stop' || mode === 'line_change') {
          return { ...dwell, dwellMode: mode, dwellSeconds: 0 };
        }
        return {
          ...dwell,
          dwellMode: 'seconds',
          dwellSeconds: dwell.dwellSeconds != null && dwell.dwellSeconds > 0
            ? dwell.dwellSeconds
            : null,
        };
      }),
    });
  };

  const updateDwellSlack = (instanceId: string, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const seconds = digits === '' ? 0 : normalizeDwellSlackSeconds(Number(digits));
    patchSelectedRoute(instanceId, {
      dwellSlackSeconds: seconds,
      stationDwellsConfirmed: false,
    });
  };

  const updateRecoveryTime = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const seconds =
      digits === '' ? null : normalizeMinimumRecoveryTimeSeconds(Number(digits));
    const anchors = draft.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
    onChange({
      ...draft,
      minimumRecoveryTimeSeconds: seconds,
      selectedRoutes: draft.selectedRoutes.map((route) => ({
        ...route,
        stationDwellsConfirmed: false,
      })),
      throughAnchors: {
        ...anchors,
        verifiedFingerprint: null,
        verifiedPathCount: 0,
      },
    });
  };

  // 碰撞保護時間只影響站位間隔判定，不影響交路循環時間，
  // 所以不必作廢導通驗證與各站停靠確認——只要重新生成班表即可
  // （paramsFingerprint 已含此值，產出會自動被判定為過期）。
  const updateCollisionProtection = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const seconds =
      digits === '' ? null : normalizeCollisionProtectionSeconds(Number(digits));
    onChange({ ...draft, collisionProtectionSeconds: seconds });
  };

  const serviceDirectionTags = draft.serviceDirectionTags ?? [];

  const addServiceDirectionTag = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onChange((prev) => {
      const existing = prev.serviceDirectionTags ?? [];
      if (existing.some((tag) => tag.name === trimmed)) return prev;
      return {
        ...prev,
        serviceDirectionTags: [
          ...existing,
          { id: createServiceDirectionTagId(), name: trimmed },
        ],
      };
    });
  };

  const removeServiceDirectionTag = (id: string) => {
    onChange((prev) => ({
      ...prev,
      serviceDirectionTags: (prev.serviceDirectionTags ?? []).filter((tag) => tag.id !== id),
      selectedRoutes: prev.selectedRoutes.map((route) =>
        route.serviceDirectionId === id
          ? { ...route, serviceDirectionId: null, serviceDirectionName: null }
          : route,
      ),
    }));
  };

  const updateServiceDirectionId = (instanceId: string, tagId: string) => {
    const trimmed = tagId.trim();
    const tag = trimmed
      ? serviceDirectionTags.find((item) => item.id === trimmed)
      : null;
    patchSelectedRoute(instanceId, {
      serviceDirectionId: trimmed || null,
      serviceDirectionName: tag?.name?.trim() || null,
    });
  };

  const updateSwitchBuffer = (instanceId: string, raw: string) => {
    const digits = sanitizeIntegerInput(raw);
    const switchBufferAfterSeconds =
      digits === '' ? 0 : normalizeSwitchBufferAfterSeconds(Number(digits));
    patchSelectedRoute(instanceId, {
      switchBufferAfterSeconds,
      stationDwellsConfirmed: false,
    });
  };

  const updateRouteCode = (instanceId: string, val: string) => {
    patchSelectedRoute(instanceId, {
      routeCode: val.trim() ? val.trim().toUpperCase() : null,
      stationDwellsConfirmed: false,
    });
  };

  const updateCardLabel = (instanceId: string, val: string) => {
    patchSelectedRoute(instanceId, {
      cardLabel: val.slice(0, 12),
    });
  };

  /** 新增／編輯：排除已選路線 catalog id */
  const excludedForAddPrimary = primaryRouteIds;

  const excludedForEdit = (instance: ShiftScheduleSelectedRoute) => {
    const next = new Set(primaryRouteIds);
    next.delete(instance.routeId);
    return next;
  };

  const throughAnchors = draft.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
  const startInstanceIds = throughAnchors.startInstanceIds;
  const endInstanceIds = throughAnchors.endInstanceIds;

  const headRoute = useMemo(
    () => primaryRoutes.find((route) => route.executionOrder === 1) ?? null,
    [primaryRoutes],
  );
  const headInstanceId = headRoute
    ? resolveSelectedRouteInstanceId(headRoute)
    : null;

  const patchThroughAnchors = (
    patch: Partial<ReturnType<typeof emptyShiftRouteThroughAnchorsDraft>>,
  ) => {
    onChange({
      ...draft,
      throughAnchors: {
        ...throughAnchors,
        ...patch,
        verifiedFingerprint: null,
        verifiedPathCount: 0,
        // 結構變更時清掉偏好，避免指到已不存在的組合
        preferredThroughCycleId:
          patch.preferredThroughCycleId !== undefined
            ? patch.preferredThroughCycleId
            : null,
      },
    });
  };

  useEffect(() => {
    const valid = new Set(primaryRoutes.map((route) => resolveSelectedRouteInstanceId(route)));
    let nextStarts = startInstanceIds.filter((id) => valid.has(id));
    let nextEnds = endInstanceIds.filter((id) => valid.has(id));
    // 起算／結算互斥：同卡同時存在時保留起算
    const conflict = new Set(nextStarts.filter((id) => nextEnds.includes(id)));
    if (conflict.size > 0) {
      nextEnds = nextEnds.filter((id) => !conflict.has(id));
    }
    if (
      nextStarts.length === startInstanceIds.length
      && nextEnds.length === endInstanceIds.length
      && nextStarts.every((id, i) => id === startInstanceIds[i])
      && nextEnds.every((id, i) => id === endInstanceIds[i])
    ) {
      return;
    }
    onChange((prev) => {
      const anchors = prev.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
      return {
        ...prev,
        throughAnchors: {
          ...anchors,
          startInstanceIds: nextStarts,
          endInstanceIds: nextEnds,
          verifiedFingerprint: null,
          verifiedPathCount: 0,
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在路線集合變化時清理失效起算／結算
  }, [primaryRoutes]);

  const throughVerified = useMemo(
    () =>
      isThroughVerificationCurrent({
        anchors: throughAnchors,
        routes: primaryRoutes,
        graph: draft.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
        minimumRecoveryTimeSeconds: draft.minimumRecoveryTimeSeconds,
        turnaroundLimitSeconds,
      }),
    [
      throughAnchors,
      primaryRoutes,
      draft.routeRelationGraph,
      draft.minimumRecoveryTimeSeconds,
      turnaroundLimitSeconds,
    ],
  );

  const currentCheckFingerprint = useMemo(
    () =>
      buildThroughVerificationFingerprint({
        startInstanceIds,
        endInstanceIds,
        routes: primaryRoutes,
        graph: draft.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
        minimumRecoveryTimeSeconds: draft.minimumRecoveryTimeSeconds,
        turnaroundLimitSeconds,
      }),
    [
      startInstanceIds,
      endInstanceIds,
      primaryRoutes,
      draft.routeRelationGraph,
      draft.minimumRecoveryTimeSeconds,
      turnaroundLimitSeconds,
    ],
  );

  /** 持久清單：回 Step 4 仍顯示；僅按「檢查」時覆寫 */
  const listedThroughCycles = useMemo(
    () => sortListedThroughCycles(throughAnchors.listedThroughCycles ?? []),
    [throughAnchors.listedThroughCycles],
  );
  const listedIsStale =
    listedThroughCycles.length > 0
    && (
      !throughAnchors.listedFingerprint
      || throughAnchors.listedFingerprint !== currentCheckFingerprint
    );
  const hasExplicitPreferred = Boolean(throughAnchors.preferredThroughCycleId?.trim());

  const referenceCycle = useMemo(() => {
    const preferredId = throughAnchors.preferredThroughCycleId?.trim();
    if (!preferredId || listedThroughCycles.length === 0) return null;
    return listedThroughCycles.find((item) => item.id === preferredId) ?? null;
  }, [listedThroughCycles, throughAnchors.preferredThroughCycleId]);

  const hasLimit = turnaroundLimitSeconds != null && turnaroundLimitSeconds > 0;
  const isOver =
    hasLimit
    && referenceCycle != null
    && referenceCycle.minCycleSeconds > (turnaroundLimitSeconds ?? 0);
  const graphHasLinks = (draft.routeRelationGraph?.links.length ?? 0) > 0;
  const cycleMarksReady = startInstanceIds.length > 0 && endInstanceIds.length > 0;
  const headInStarts =
    headInstanceId == null || startInstanceIds.includes(headInstanceId);

  const selectPreferredThroughCycle = (cycle: RouteThroughCycle) => {
    const overLimit =
      turnaroundLimitSeconds != null
      && turnaroundLimitSeconds > 0
      && cycle.minCycleSeconds > turnaroundLimitSeconds;
    const listFresh =
      throughAnchors.listedFingerprint != null
      && throughAnchors.listedFingerprint === currentCheckFingerprint
      && listedThroughCycles.some((item) => item.id === cycle.id);
    const canVerify =
      listFresh && !overLimit && headInStarts && graphHasLinks && cycleMarksReady;
    onChange({
      ...draft,
      throughAnchors: {
        ...throughAnchors,
        preferredThroughCycleId: cycle.id,
        verifiedFingerprint: canVerify ? currentCheckFingerprint : null,
        verifiedPathCount: canVerify ? listedThroughCycles.length : 0,
      },
    });
  };

  const runThroughVerification = () => {
    if (!cycleMarksReady || !graphHasLinks) return;
    const graph = draft.routeRelationGraph ?? emptyShiftRouteRelationGraph();
    const paths = sortListedThroughCycles(
      computeRouteThroughPaths({
        startInstanceIds,
        endInstanceIds,
        routes: primaryRoutes,
        graph,
        minimumRecoveryTimeSeconds: draft.minimumRecoveryTimeSeconds,
      }),
    );
    const checkFingerprint = buildThroughVerificationFingerprint({
      startInstanceIds,
      endInstanceIds,
      routes: primaryRoutes,
      graph,
      minimumRecoveryTimeSeconds: draft.minimumRecoveryTimeSeconds,
      turnaroundLimitSeconds,
    });
    const previousPreferredId = throughAnchors.preferredThroughCycleId?.trim() || null;
    const preferredStillValid =
      previousPreferredId != null && paths.some((item) => item.id === previousPreferredId)
        ? paths.find((item) => item.id === previousPreferredId)!
        : null;
    const overLimit =
      turnaroundLimitSeconds != null
      && turnaroundLimitSeconds > 0
      && preferredStillValid != null
      && preferredStillValid.minCycleSeconds > turnaroundLimitSeconds;
    const headOk = headInStarts;
    // 檢查只更新清單；未點選「優先採用」不得視為通過
    const canVerify =
      paths.length > 0
      && preferredStillValid != null
      && !overLimit
      && headOk;
    onChange({
      ...draft,
      throughAnchors: {
        ...throughAnchors,
        startStationIds: [],
        endStationIds: [],
        listedThroughCycles: paths,
        listedFingerprint: checkFingerprint,
        preferredThroughCycleId: preferredStillValid?.id ?? null,
        verifiedFingerprint: canVerify ? checkFingerprint : null,
        verifiedPathCount: canVerify ? paths.length : 0,
      },
    });
  };

  const toggleStartInstance = (instanceId: string) => {
    if (startInstanceIds.includes(instanceId)) {
      patchThroughAnchors({
        startInstanceIds: startInstanceIds.filter((id) => id !== instanceId),
      });
      return;
    }
    // 起算與結算互斥：設起算時清掉同卡結算
    patchThroughAnchors({
      startInstanceIds: [...startInstanceIds, instanceId],
      endInstanceIds: endInstanceIds.filter((id) => id !== instanceId),
    });
  };

  const toggleEndInstance = (instanceId: string) => {
    if (endInstanceIds.includes(instanceId)) {
      patchThroughAnchors({
        endInstanceIds: endInstanceIds.filter((id) => id !== instanceId),
      });
      return;
    }
    // 起算與結算互斥：設結算時清掉同卡起算
    patchThroughAnchors({
      endInstanceIds: [...endInstanceIds, instanceId],
      startInstanceIds: startInstanceIds.filter((id) => id !== instanceId),
    });
  };

  const throughGateStatus:
    | 'missingGraph'
    | 'missingMarks'
    | 'headNotInStarts'
    | 'stale'
    | 'failed'
    | 'missingPreferred'
    | 'overLimit'
    | 'passed' =
    throughVerified && !isOver && hasExplicitPreferred && referenceCycle != null
      ? 'passed'
      : !graphHasLinks
        ? 'missingGraph'
        : !cycleMarksReady
          ? 'missingMarks'
          : !headInStarts
            ? 'headNotInStarts'
            : throughAnchors.listedFingerprint === currentCheckFingerprint
              && listedThroughCycles.length === 0
              ? 'failed'
              : throughAnchors.listedFingerprint === currentCheckFingerprint
                && listedThroughCycles.length > 0
                && !hasExplicitPreferred
                ? 'missingPreferred'
                : throughAnchors.listedFingerprint === currentCheckFingerprint
                  && listedThroughCycles.length > 0
                  && isOver
                  ? 'overLimit'
                  : throughVerified && isOver
                    ? 'overLimit'
                    : 'stale';

  const isManual = creationMode === 'manual';

  const nextStepBlockers = useMemo(() => {
    if (isManual) return [] as string[];
    const blockers: string[] = [];
    if (draft.minimumRecoveryTimeSeconds == null) {
      blockers.push(i18n.t('shiftList.routeGroups.needMinRecovery'));
    }
    if (!graphHasLinks) {
      blockers.push(i18n.t('shiftList.routeGroups.needEdges'));
    } else if (!cycleMarksReady) {
      blockers.push(i18n.t('shiftList.routeGroups.needStartEnd'));
    } else if (!headInStarts) {
      blockers.push(i18n.t('shiftList.routeGroups.firstMustStart'));
    } else if (!hasExplicitPreferred || referenceCycle == null) {
      blockers.push(i18n.t('shiftList.routeGroups.needPreferred'));
    } else if (throughGateStatus === 'overLimit') {
      blockers.push(
        turnaroundLimitSeconds != null && referenceCycle != null
          ? i18n.t('shiftList.routeGroups.preferredOverLimitDetail', { over: formatSecondsLabel(referenceCycle.minCycleSeconds - turnaroundLimitSeconds) })
          : i18n.t('shiftList.routeGroups.preferredOverLimit'),
      );
    } else if (!throughVerified || throughGateStatus !== 'passed') {
      if (
        throughAnchors.listedFingerprint === currentCheckFingerprint
        && listedThroughCycles.length === 0
      ) {
        blockers.push(i18n.t('shiftList.routeGroups.noPath'));
      } else if (listedIsStale || listedThroughCycles.length === 0) {
        blockers.push(i18n.t('shiftList.routeGroups.needRecheck'));
      } else {
        blockers.push(i18n.t('shiftList.routeGroups.needGenerate'));
      }
    }
    const recovery = draft.minimumRecoveryTimeSeconds;
    if (recovery != null) {
      const notReady = primaryRoutes.filter(
        (route) => !isSelectedRouteDwellReady(route, turnaroundLimitSeconds, recovery),
      );
      if (notReady.length > 0) {
        blockers.push(i18n.t('shiftList.routeGroups.routesNotReady', { count: notReady.length }));
      }
    }
    return blockers;
  }, [
    isManual,
    draft.minimumRecoveryTimeSeconds,
    graphHasLinks,
    cycleMarksReady,
    headInStarts,
    hasExplicitPreferred,
    referenceCycle,
    throughVerified,
    throughGateStatus,
    primaryRoutes,
    turnaroundLimitSeconds,
    throughAnchors.listedFingerprint,
    currentCheckFingerprint,
    listedThroughCycles.length,
    listedIsStale,
  ]);

  const renderConfiguredCard = (route: ShiftScheduleSelectedRoute) => {
    const instanceId = resolveSelectedRouteInstanceId(route);
    const isEditing = editingRouteId === instanceId;
    const orderPosition = resolveRouteOrderPosition(primaryRoutes, instanceId);
    const nextRoute = !isManual
      ? resolveNextRouteInExecutionOrder(primaryRoutes, route.routeId)
      : null;
    // 多路線才顯示換線緩衝欄；不標「接哪一條」——結合關係在參數／關聯圖確定前未知
    const showSwitchBuffer = !isManual && primaryRoutes.length > 1 && Boolean(nextRoute);

    return (
      <div
        key={instanceId}
        className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          {orderPosition ? (
            <RouteOrderControls
              showArrows={orderPosition.showControls}
              canMoveUp={orderPosition.canMoveUp}
              canMoveDown={orderPosition.canMoveDown}
              onMove={(direction) => moveRouteOrder(instanceId, direction)}
            />
          ) : null}

          <div className="min-w-0 flex-1 space-y-2">
            {isEditing ? (
              <div className="space-y-2">
                <RoutePickerBar
                  catalog={catalog}
                  excludedRouteIds={excludedForEdit(route)}
                  selectedRouteId={pendingEditRouteId}
                  onSelectRouteId={setPendingEditRouteId}
                  onConfirm={(nextRouteId) => {
                    if (!nextRouteId) return;
                    replaceRoute(instanceId, nextRouteId);
                    setEditingRouteId(null);
                    setPendingEditRouteId('');
                  }}
                  confirmLabel={t('shiftList.routeGroups.confirmReplace')}
                  emptyHint={t('shiftList.routeGroups.reselectRoute')}
                />
                <button
                  type="button"
                  onClick={() => {
                    setEditingRouteId(null);
                    setPendingEditRouteId('');
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {t('shiftList.routeGroups.cancelEdit')}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {orderPosition.executionOrder === 1 ? (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                    {t('shiftList.routeGroups.startBadge')}
                  </span>
                ) : null}
                <span className="text-sm font-medium text-zinc-100">{route.routeName}</span>
                <label className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5">
                  <span className="text-[10px] font-medium text-zinc-400">
                    {t('shiftList.routeGroups.code')}
                    <span className="text-rose-400" aria-hidden>
                      *
                    </span>
                  </span>
                  <input
                    type="text"
                    value={route.routeCode ?? ''}
                    maxLength={3}
                    required
                    onChange={(e) =>
                      updateRouteCode(
                        instanceId,
                        e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase(),
                      )
                    }
                    className="w-8 bg-transparent text-center text-xs font-bold text-[#2B7FFF] focus:outline-none"
                    title={t('shiftList.routeGroups.codeTitle')}
                    aria-label={t('shiftList.routeGroups.codeAria', { name: route.routeName })}
                    aria-required
                  />
                </label>
                <span className="text-xs text-zinc-500">{route.groupName}</span>
                <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="shrink-0">班次卡標籤</span>
                  <input
                    type="text"
                    value={route.cardLabel ?? ''}
                    maxLength={12}
                    placeholder="例：環線 A"
                    onChange={(e) => updateCardLabel(instanceId, e.target.value)}
                    className="h-7 w-28 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none"
                    aria-label={`${route.routeName} 班次卡標籤`}
                  />
                </label>
                {!isManual ? (
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className="shrink-0">{t('shiftList.routeGroups.serviceDir')}</span>
                    <select
                      value={route.serviceDirectionId ?? ''}
                      onChange={(e) => updateServiceDirectionId(instanceId, e.target.value)}
                      disabled={serviceDirectionTags.length === 0}
                      className="h-7 max-w-[140px] rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 focus:border-[#2B7FFF] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${route.routeName} ${t('shiftList.routeGroups.serviceDir')}`}
                      title={
                        serviceDirectionTags.length === 0
                          ? t('shiftList.routeGroups.serviceDirNeedTags')
                          : t('shiftList.routeGroups.serviceDirPick')
                      }
                    >
                      <option value="">{t('shiftList.routeGroups.serviceDirUnset')}</option>
                      {serviceDirectionTags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            )}

            {!isEditing && !route.routeCode?.trim() ? (
              <p className="text-[11px] text-amber-400/90">
                {isManual
                  ? t('shiftList.routeGroups.codeRequiredManual')
                  : t('shiftList.routeGroups.codeRequired')}
              </p>
            ) : null}

            {!isEditing ? (
              <StationDwellEditor
                route={route}
                turnaroundLimitSeconds={turnaroundLimitSeconds}
                minimumRecoveryTimeSeconds={isManual ? 0 : draft.minimumRecoveryTimeSeconds}
                hideRecoveryInSummary={isManual}
                showSwitchBuffer={showSwitchBuffer}
                onUpdateDwellSeconds={(stationId, val) =>
                  updateDwellSeconds(instanceId, stationId, val)
                }
                onUpdateDwellMode={(stationId, mode) =>
                  updateDwellMode(instanceId, stationId, mode)
                }
                onUpdateDwellSlack={(val) => updateDwellSlack(instanceId, val)}
                onUpdateSwitchBuffer={(val) => updateSwitchBuffer(instanceId, val)}
              />
            ) : null}
          </div>

          {!isEditing ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={t('shiftList.routeGroups.editRoute')}
                onClick={() => {
                  setEditingRouteId(instanceId);
                  setPendingEditRouteId(route.routeId);
                }}
                className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                title={t('shiftList.routeGroups.delete')}
                onClick={() => deletePrimary(instanceId)}
                className="rounded-lg p-2 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const mapSelectOptions = useMemo(
    () =>
      availableMaps.map((map) => ({
        value: map.mapId,
        label: map.displayName,
      })),
    [availableMaps],
  );
  const selectedMapId = draft.mapId.trim() || preferredMapId;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-6 shrink-0 space-y-3">
        <div>
          <h2 className="text-base font-medium text-zinc-100">{t('shiftList.routeGroups.configureTitle')}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {t('shiftList.routeGroups.configureHint')}
            {turnaroundLoading
              ? t('shiftList.routeGroups.loadingTurnaround')
              : turnaroundLimitSeconds != null
                ? t('shiftList.routeGroups.turnaroundValue', { value: formatSecondsLabel(turnaroundLimitSeconds) })
                : timeTemplateId
                  ? t('shiftList.routeGroups.noTurnaround')
                  : t('shiftList.routeGroups.needTimeTemplate')}
          </p>
              </div>
        <div className="flex flex-wrap items-end gap-3">
          <ShiftMenuSelect
            label={t('shiftList.routeGroups.siteMap')}
            value={selectedMapId}
            placeholder={t('shiftList.routeGroups.selectMap')}
            options={mapSelectOptions}
            widthClass="w-[280px] shrink-0"
            panelWidth={280}
            disabled={loading || mapSelectOptions.length === 0}
            onChange={(mapId) => {
              if (!mapId || mapId === selectedMapId) return;
              setPreferredMapId(mapId);
            }}
          />
          {!loading && !error && mapDisplayName ? (
            <p className="pb-2 text-xs text-zinc-500">
              {t('shiftList.routeGroups.loadedMapId', { id: selectedMapId || '—' })}
            </p>
          ) : null}
          </div>
        {!loading && !error && routeSyncNotice ? (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            地圖或路線已變動，下列項目已自動重置，請重新指定後再檢查路線組合：
            <span className="ml-1 font-medium">
              {routeSyncNotice.routes > 0 ? `${routeSyncNotice.routes} 條路線改對到不同路徑（代號已清空）` : null}
              {routeSyncNotice.routes > 0 && routeSyncNotice.links > 0 ? '、' : null}
              {routeSyncNotice.links > 0 ? `${routeSyncNotice.links} 條關聯已接不起來並移除` : null}
              {routeSyncNotice.anchors
                ? `${routeSyncNotice.routes > 0 || routeSyncNotice.links > 0 ? '、' : ''}起算／結算與上次驗算結果已清除`
                : null}
            </span>
          </div>
        ) : null}
        {!loading && !error && firstTripOriginsHint ? (
          <p className="text-xs text-zinc-400">{firstTripOriginsHint}</p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          {t('shiftList.routeGroups.loadingGroups')}
        </div>
      ) : error ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center px-6 text-sm text-red-400">
          {error}
        </div>
      ) : catalog.length === 0 ? (
        <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
          <ShiftSelectionEmptyState />
          <p className="pb-8 text-center text-xs text-zinc-500">
            {t('shiftList.routeGroups.emptyGroups')}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
          {!isManual ? (
            <RecoveryAndServiceDirectionBar
                  minimumRecoveryTimeSeconds={draft.minimumRecoveryTimeSeconds}
              onUpdateRecoveryTime={updateRecoveryTime}
              collisionProtectionSeconds={draft.collisionProtectionSeconds ?? null}
              onUpdateCollisionProtection={updateCollisionProtection}
              serviceDirectionTags={serviceDirectionTags}
              onAddTag={addServiceDirectionTag}
              onRemoveTag={removeServiceDirectionTag}
            />
          ) : null}

          <div className="space-y-3">
            {primaryRoutes.map((route) => renderConfiguredCard(route))}

            <RoutePickerBar
              catalog={catalog}
              excludedRouteIds={excludedForAddPrimary}
              selectedRouteId={pendingAddRouteId}
              onSelectRouteId={setPendingAddRouteId}
              onConfirm={confirmAddPrimary}
              confirmLabel={t('shiftList.routeGroups.confirmAddRoutes')}
              emptyHint={t('shiftList.routeGroups.pickByGroup')}
              title={t('shiftList.routeGroups.addRouteTitle')}
              expanded={addPrimaryOpen}
              onExpand={() => setAddPrimaryOpen(true)}
              onCancel={() => {
                setAddPrimaryOpen(false);
                setPendingAddRouteId('');
              }}
            />
          </div>

          {primaryRoutes.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50">
              <RouteRelationGraphEditor
                framed={false}
                routes={primaryRoutes}
                graph={draft.routeRelationGraph ?? emptyShiftRouteRelationGraph()}
                headInstanceId={headInstanceId}
                startInstanceIds={startInstanceIds}
                endInstanceIds={endInstanceIds}
                onChange={(routeRelationGraph) => {
                  onChange({
                    ...draft,
                    routeRelationGraph,
                    throughAnchors: {
                      ...throughAnchors,
                      verifiedFingerprint: null,
                      verifiedPathCount: 0,
                      preferredThroughCycleId: null,
                    },
                  });
                }}
                onSetHead={(instanceId) => setRouteAsHead(instanceId)}
                onToggleStartInstance={toggleStartInstance}
                onToggleEndInstance={toggleEndInstance}
              />

              {!isManual ? (
                <div className="space-y-3 border-t border-zinc-800/70 px-4 py-3">
                  {throughGateStatus === 'missingGraph' ? (
                    <p className="text-[11px] text-zinc-500">{t('shiftList.routeGroups.needEdgesHint')}</p>
                  ) : throughGateStatus === 'missingMarks' ? (
                    <p className="text-[11px] text-zinc-400">
                      {t('shiftList.routeGroups.needStartEndHint')}
                    </p>
                  ) : throughGateStatus === 'headNotInStarts' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-200">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                      <span>{t('shiftList.routeGroups.firstMustStartHint')}</span>
                    </p>
                  ) : throughGateStatus === 'failed' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                      <span>{t('shiftList.routeGroups.noPathHint')}</span>
                    </p>
                  ) : throughGateStatus === 'missingPreferred' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-200">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                      <span>{t('shiftList.routeGroups.pickPreferredHint')}</span>
                    </p>
                  ) : null}

                  {listedThroughCycles.length > 0 ? (
                    <div className="space-y-1">
                      <p className="pb-1 text-[11px] text-zinc-500">
                        {t('shiftList.routeGroups.pickPreferredList')}
                        {listedIsStale
                          ? t('shiftList.routeGroups.listStale')
                          : t('shiftList.routeGroups.preferHint')}
                      </p>
                      {listedThroughCycles.map((cycle) => {
                        const rowOver =
                          hasLimit && cycle.minCycleSeconds > (turnaroundLimitSeconds ?? 0);
                        const isReference = referenceCycle?.id === cycle.id;
                        return (
                          <button
                            key={cycle.id}
                            type="button"
                            onClick={() => selectPreferredThroughCycle(cycle)}
                            aria-pressed={isReference}
                            className={[
                              'flex w-full items-start justify-between gap-6 rounded-md px-2 py-2.5 text-left text-sm transition-colors',
                              isReference
                                ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40'
                                : listedIsStale
                                  ? 'opacity-80 hover:bg-zinc-800/50'
                                  : 'hover:bg-zinc-800/50',
                            ].join(' ')}
                          >
                            <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2">
                              {cycle.labels.map((label, labelIndex) => (
                                <span key={`${cycle.id}-${labelIndex}`} className="contents">
                                  {labelIndex > 0 ? (
                                    <span
                                      className={[
                                        'inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold',
                                        cycle.linkKinds[labelIndex - 1] === 'secondary'
                                          ? 'bg-violet-500/30 text-violet-100'
                                          : 'bg-sky-500/30 text-sky-100',
                                      ].join(' ')}
                                    >
                                      {cycle.linkKinds[labelIndex - 1] === 'secondary'
                                        ? t('shiftList.routeGroups.secondaryShort')
                                        : t('shiftList.routeGroups.primaryShort')}
                                    </span>
                                  ) : null}
                                  <span className="font-medium text-zinc-100">{label}</span>
                                </span>
                              ))}
                              <span className="text-zinc-600">·</span>
                              <span
                                className={
                                  cycle.secondaryCount === 0 ? 'text-sky-300' : 'text-violet-300'
                                }
                              >
                                {cycle.secondaryCount === 0
                                  ? t('shiftList.routeGroups.allPrimary')
                                  : t('shiftList.routeGroups.secondaryCount', { count: cycle.secondaryCount })}
                              </span>
                              {isReference ? (
                                <>
                                  <span className="text-zinc-600">·</span>
                                  <span className="text-emerald-300">{t('shiftList.routeGroups.preferred')}</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-zinc-600">·</span>
                                  <span className="text-zinc-500">{t('shiftList.routeGroups.clickAdopt')}</span>
                                </>
                              )}
            </div>
                            <div
                              className={[
                                'shrink-0 space-y-0.5 text-right tabular-nums',
                                rowOver ? 'text-red-400' : 'text-zinc-200',
                              ].join(' ')}
                            >
                              <div className="text-sm">
                                <span className="text-zinc-500">{t('shiftList.routeGroups.fastShort')} </span>
                                {formatSecondsLabel(cycle.minCycleSeconds)}
          </div>
                              <div className="text-sm">
                                <span className="text-zinc-500">{t('shiftList.routeGroups.avgShort')} </span>
                                {formatSecondsLabel(cycle.avgCycleSeconds)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {throughGateStatus === 'overLimit' && referenceCycle ? (
                    (() => {
                      // 只講「超過了」使用者不知道要動哪裡。把三條可行的路一起列出來，
                      // 而且第一條要具體：清單裡如果本來就有沒超過的組合，直接點名。
                      const limit = turnaroundLimitSeconds ?? 0;
                      const shortfall = referenceCycle.minCycleSeconds - limit;
                      const withinLimit = listedThroughCycles
                        .filter((item) => item.minCycleSeconds <= limit)
                        .sort((a, b) => a.minCycleSeconds - b.minCycleSeconds);
                      return (
                        <div className="space-y-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5">
                          <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                            <span>
                              {t('shiftList.routeGroups.preferredOver', {
                                path: referenceCycle.labels.join('→'),
                                min: formatSecondsLabel(referenceCycle.minCycleSeconds),
                                limit: formatSecondsLabel(limit),
                                over: formatSecondsLabel(shortfall),
                              })}
                            </span>
                          </p>
                          <p className="pl-5 text-[10px] leading-4 text-zinc-500">
                            {t('shiftList.routeGroups.gateUsesFast', {
                              avg: formatSecondsLabel(referenceCycle.avgCycleSeconds),
                            })}
                          </p>
                          <div className="pl-5 text-[11px] leading-5 text-zinc-300">
                            <p className="text-zinc-400">{t('shiftList.routeGroups.solutionsTitle')}</p>
                            <ul className="list-disc space-y-0.5 pl-4">
                              {withinLimit.length > 0 ? (
                                <li>
                                  <span className="text-zinc-200">{t('shiftList.routeGroups.adoptWithin')}</span>
                                  {t('shiftList.routeGroups.adoptWithinDetail', {
                                    path: withinLimit[0]!.labels.join('→'),
                                    min: formatSecondsLabel(withinLimit[0]!.minCycleSeconds),
                                  })}
                                  {withinLimit.length > 1
                                    ? t('shiftList.routeGroups.adoptWithinMore', {
                                        count: withinLimit.length - 1,
                                      })
                                    : ''}
                                </li>
                              ) : (
                                <li>{t('shiftList.routeGroups.allOver')}</li>
                              )}
                              <li>
                                <span className="text-zinc-200">{t('shiftList.routeGroups.shortenOccupy')}</span>
                                {t('shiftList.routeGroups.shortenOccupyDetail', {
                                  value: formatSecondsLabel(shortfall),
                                })}
                              </li>
                              <li>
                                <span className="text-zinc-200">{t('shiftList.routeGroups.raiseLimit')}</span>
                                {t('shiftList.routeGroups.raiseLimitNotField')}
                                <span className="text-zinc-200">
                                  {t('shiftList.routeGroups.raiseLimitFormula')}
                                </span>
                                {t('shiftList.routeGroups.raiseLimitMinDay')}
                                {turnaroundBinding ? (
                                  <>
                                    {t('shiftList.routeGroups.stuckInterval')}
                                    <span className="font-medium text-amber-300">
                                      {formatClockRange(
                                        turnaroundBinding.startMinute,
                                        turnaroundBinding.endMinute,
                                      )}
                                    </span>
                                    {t('shiftList.routeGroups.stuckDetail', {
                                      trains: turnaroundBinding.activePassengerCount,
                                      headway: formatSecondsLabel(turnaroundBinding.headwaySeconds),
                                      limit: formatSecondsLabel(limit),
                                    })}
                                  </>
                                ) : (
                                  <>{t('shiftList.routeGroups.raiseLimitGeneric')}</>
                                )}
                              </li>
                            </ul>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}

                  {throughGateStatus === 'passed' && referenceCycle ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      <span>
                        {t('shiftList.routeGroups.confirmedOk', { path: referenceCycle.labels.join('→'), limitOk: hasLimit ? t('shiftList.routeGroups.withinTurnaround') : '' })}
                      </span>
                    </p>
                  ) : throughGateStatus === 'passed' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      <span>{t('shiftList.routeGroups.stillValid')}</span>
                    </p>
                  ) : null}

                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      disabled={!cycleMarksReady || !graphHasLinks}
                      onClick={runThroughVerification}
                      className="rounded-md border border-[#2B7FFF]/50 bg-[#2B7FFF]/15 px-3 py-1.5 text-xs font-medium text-[#9ec5ff] hover:bg-[#2B7FFF]/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {listedThroughCycles.length > 0
                        ? t('shiftList.routeGroups.recheckCycles')
                        : t('shiftList.routeGroups.generateCycles')}
                    </button>
                    {nextStepBlockers.length > 0 ? (
                      <div className="w-full rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-left text-[11px] text-amber-100/90">
                        <p className="font-medium text-amber-200">{t('shiftList.routeGroups.nextBlocked')}</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-100/80">
                          {nextStepBlockers.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
