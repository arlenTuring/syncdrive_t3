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
  looksLikeDefaultCrossoverPortalStationId,
  moveSelectedRouteExecutionOrder,
  setSelectedRouteAsHead,
  nextExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeSelectedRouteExecutionOrders,
  resolveRouteOrderPosition,
  resolveNextRouteInExecutionOrder,
  resolveSelectedRouteInstanceId,
  resolveStationDwellListRole,
  formatStationDwellRoleLabel,
  resolveStationDwellMode,
  sortSelectedRoutesByExecutionOrder,
  syncRouteRelationGraphWithRoutes,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
} from '../types/create';
import {
  loadShiftRouteGroupCatalog,
  type ShiftRouteGroupCatalogItem,
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
  isThroughVerificationCurrent,
  sortListedThroughCycles,
  type RouteThroughCycle,
} from '../utils/routeRelationThroughCycles';
import { resolveRouteOriginStation } from '../utils/routeRelationGraph';

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
  return `${seconds}秒`;
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
            : !looksLikeDefaultCrossoverPortalStationId(stationId);
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
    ? '最快一趟 + 靠站總和(含緩衝)'
    : '最快一趟 + 恢復 + 靠站總和(含緩衝)';
  const avgCycleLabel = hideRecoveryInSummary
    ? '平均一趟 + 靠站總和(含緩衝)'
    : '平均一趟 + 恢復 + 靠站總和(含緩衝)';
  const breakdownSuffix = hideRecoveryInSummary
    ? `(${route.minTravelTimeSeconds ?? 0}s 行駛 + ${totalDwellWithSlack}s 靠站)`
    : `(${route.minTravelTimeSeconds ?? 0}s 行駛 + ${recoverySeconds}s 恢復 + ${totalDwellWithSlack}s 靠站)`;
  const avgBreakdownSuffix = hideRecoveryInSummary
    ? `(${route.avgTravelTimeSeconds ?? 0}s 行駛 + ${totalDwellWithSlack}s 靠站)`
    : `(${route.avgTravelTimeSeconds ?? 0}s 行駛 + ${recoverySeconds}s 恢復 + ${totalDwellWithSlack}s 靠站)`;

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
                站點:{dwell.stationName}
              </span>
              <div className="flex h-8 items-center justify-center gap-1.5">
                <ShiftMenuSelect
                  label={`${dwell.stationName} 停靠方式`}
                  hideLabel
                  size="sm"
                  value={mode}
                  options={[
                    { value: 'seconds', label: '秒數' },
                    { value: 'no_stop', label: '不停靠' },
                    { value: 'line_change', label: '換線停靠' },
                  ]}
                  onChange={(next) =>
                    onUpdateDwellMode(dwell.stationId, next as ShiftStationDwellMode)
                  }
                  widthClass="w-[100px] shrink-0"
                  panelWidth={112}
                  aria-label={`${dwell.stationName} 停靠方式`}
                />
                {mode === 'seconds' ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={dwell.dwellSeconds == null ? '' : String(dwell.dwellSeconds)}
                    onChange={(e) =>
                      onUpdateDwellSeconds(dwell.stationId, e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="必填"
                    className={DWELL_INPUT_CLASS}
                    aria-label={`${dwell.stationName} 停靠秒數`}
                  />
                ) : null}
              </div>
            </label>
          );
        })}

        <label className="block text-center">
          <span className="mb-1 block text-[11px] text-zinc-500">靠站緩衝</span>
          <div className="flex h-8 items-center justify-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              value={String(route.dwellSlackSeconds)}
              onChange={(e) => onUpdateDwellSlack(e.target.value)}
              className={DWELL_INPUT_CLASS}
              aria-label={`${route.routeName} 靠站緩衝秒數`}
            />
          </div>
        </label>

        {showSwitchBuffer && onUpdateSwitchBuffer ? (
          <label className="block text-center">
            <span className="mb-1 block text-[11px] text-zinc-500">換線緩衝</span>
            <div className="flex h-8 items-center justify-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={String(route.switchBufferAfterSeconds)}
                onChange={(e) => onUpdateSwitchBuffer(e.target.value)}
                className={DWELL_INPUT_CLASS}
                aria-label={`${route.routeName} 換線緩衝秒數`}
              />
            </div>
          </label>
        ) : null}
      </div>

      <div className="mt-2 space-y-1">
        {showIncompleteWarning && (
          <p className="text-[10px] text-zinc-500">
            ⚠️ 停靠設定尚未填寫完整（選秒數時不可留空）。
          </p>
        )}
        {showTurnaroundWarning && (
          <p className="text-[10px] text-red-400">
            ⚠️ 此路線最快單趟加總已超過折返時限限制！
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
  if (!showArrows) return null;

  return (
    <div className="flex shrink-0 flex-col">
      <button
        type="button"
        title="提前順序"
        disabled={!canMoveUp}
        onClick={() => onMove('up')}
        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
      >
        <ArrowUp className="size-3.5" />
      </button>
      <button
        type="button"
        title="延後順序"
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
  serviceDirectionTags,
  onAddTag,
  onRemoveTag,
}: {
  minimumRecoveryTimeSeconds: number | null;
  onUpdateRecoveryTime: (value: string) => void;
  serviceDirectionTags: ShiftScheduleServiceDirectionTag[];
  onAddTag: (name: string) => void;
  onRemoveTag: (id: string) => void;
}) {
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
          <HelpTip label="最低恢復時間說明">
            <p>每趟正線行駛結束後，至下一趟正線發車前至少預留的整備／恢復時間。</p>
            <p className="mt-1 text-zinc-500">輸入「30」代表最少保留 30 秒恢復空檔。</p>
          </HelpTip>
          最低恢復時間（秒）
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={minimumRecoveryTimeSeconds ?? ''}
            onChange={(e) => onUpdateRecoveryTime(e.target.value.replace(/\D/g, ''))}
            placeholder="必填，如 30"
            className="h-[36px] w-[140px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm tabular-nums text-zinc-100 placeholder-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]"
            aria-label="最低恢復時間"
          />
          <span className="text-sm text-zinc-500">秒</span>
        </div>
      </label>

      <div className="min-w-0 flex-1">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm text-zinc-300">
          <HelpTip label="服務方向說明" widthClass="w-64">
            <p>
              服務方向標示哪些路線的班次算同一向。同一趟車連續跑的同向路段只算一班；運能用相鄰班次班距換算，再分桶均化顯示。
            </p>
            <p className="mt-1 text-zinc-500">
              與下方關聯圖的輪替接續不同；關聯圖是車怎麼換線，服務方向是乘客看到的同向服務。
            </p>
            <p className="mt-1 text-zinc-500">例如可建「往 T3」「往南港」，再於各路線卡單選一個。</p>
          </HelpTip>
          服務方向
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
                title={`刪除「${tag.name}」`}
                aria-label={`刪除服務方向 ${tag.name}`}
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
                placeholder="方向名稱"
                maxLength={24}
                className="w-28 bg-transparent px-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
                aria-label="新服務方向名稱"
              />
              <button
                type="button"
                title="確認新增"
                aria-label="確認新增服務方向"
                onClick={commitDraft}
                disabled={!draftName.trim()}
                className="rounded-md p-1 text-emerald-400 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="size-4" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                title="取消"
                aria-label="取消新增服務方向"
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
              title="新增服務方向"
              aria-label="新增服務方向"
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
  confirmLabel = '確認新增',
  emptyHint = '請先選擇一條路線',
  title = '新增路線',
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
            placeholder={availableGroups.length === 0 ? '沒有可選路線' : emptyHint}
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
          取消
        </button>
      ) : null}
    </div>
  );
}

export function StepShiftRouteGroups({
  draft,
  onChange,
  timeTemplateId,
  creationMode = 'parametric',
}: StepShiftRouteGroupsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapDisplayName, setMapDisplayName] = useState('');
  const [catalog, setCatalog] = useState<ShiftRouteGroupCatalogItem[]>([]);
  const [turnaroundLimitSeconds, setTurnaroundLimitSeconds] = useState<number | null>(null);
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
    void loadShiftRouteGroupCatalog()
      .then((result) => {
        if (cancelled) return;
        setCatalog(result.groups);
        setMapDisplayName(result.mapDisplayName);
        const validRouteIds = new Set(
          result.groups.flatMap((g) => g.routes.map((r) => r.routeId)),
        );
        const routeMeta = new Map(
          result.groups.flatMap((g) => g.routes.map((r) => [r.routeId, r] as const)),
        );
        const nextRoutes = normalizeSelectedRouteExecutionOrders(
          draftRef.current.selectedRoutes
            .filter(
              (selected) =>
                isPrimarySelectedRoute(selected) && validRouteIds.has(selected.routeId),
            )
            .map((selected) => {
              const meta = routeMeta.get(selected.routeId);
              if (!meta) {
                return {
                  ...selected,
                  backupForInstanceId: null,
                  backupForRouteId: null,
                };
              }
              return {
                ...selected,
                stationIds: [...meta.stationIds],
                stationDwells: buildStationDwells(meta, selected.stationDwells),
                stationLegTravels: meta.stationLegTravels.map((leg) => ({ ...leg })),
                avgTravelTimeSeconds: meta.avgTravelTimeSeconds,
                minTravelTimeSeconds: meta.minTravelTimeSeconds,
                backupForInstanceId: null,
                backupForRouteId: null,
              };
            }),
        );
        onChangeRef.current({
          ...draftRef.current,
          mapId: result.mapId,
          minimumRecoveryTimeSeconds: draftRef.current.minimumRecoveryTimeSeconds,
          selectedRoutes: nextRoutes,
          serviceDirectionTags: draftRef.current.serviceDirectionTags ?? [],
          routeRelationGraph: syncRouteRelationGraphWithRoutes(
            draftRef.current.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
            nextRoutes,
          ),
          throughAnchors:
            draftRef.current.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft(),
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setCatalog([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!timeTemplateId.trim()) {
      setTurnaroundLimitSeconds(null);
      setTurnaroundLoading(false);
      return;
    }
    let cancelled = false;
    setTurnaroundLoading(true);
    void fetchTimeTemplateDetail(timeTemplateId)
      .then((detail) => {
        if (cancelled) return;
        const body = parseStoredTemplateBody(detail.body ?? {});
        setTurnaroundLimitSeconds(
          resolveStrictestTurnaroundLimitSeconds(body.tasks, body.intervals, body.attributes),
        );
      })
      .catch(() => {
        if (!cancelled) setTurnaroundLimitSeconds(null);
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
      blockers.push('尚未填寫最低恢復時間');
    }
    if (!graphHasLinks) {
      blockers.push('關聯圖尚無連線');
    } else if (!cycleMarksReady) {
      blockers.push('尚未設好「由此起算」與「到此結算」');
    } else if (!headInStarts) {
      blockers.push('首班車必須也是起算路線');
    } else if (!hasExplicitPreferred || referenceCycle == null) {
      blockers.push('尚未選擇優先採用的路線組合');
    } else if (throughGateStatus === 'overLimit') {
      blockers.push('優先採用的路線組合超過折返時限');
    } else if (!throughVerified || throughGateStatus !== 'passed') {
      if (
        throughAnchors.listedFingerprint === currentCheckFingerprint
        && listedThroughCycles.length === 0
      ) {
        blockers.push('找不到從起算到結算的路徑');
      } else if (listedIsStale || listedThroughCycles.length === 0) {
        blockers.push('請按右下角「重新檢查路線組合」確認後才能下一步');
      } else {
        blockers.push('請按右下角「產生路線組合」確認後才能下一步');
      }
    }
    const recovery = draft.minimumRecoveryTimeSeconds;
    if (recovery != null) {
      const notReady = primaryRoutes.filter(
        (route) => !isSelectedRouteDwellReady(route, turnaroundLimitSeconds, recovery),
      );
      if (notReady.length > 0) {
        blockers.push(`尚有 ${notReady.length} 條路線靠站時間未填完，或單線超過折返時限`);
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
                  confirmLabel="確認更換路線"
                  emptyHint="重新選擇路線"
                />
                <button
                  type="button"
                  onClick={() => {
                    setEditingRouteId(null);
                    setPendingEditRouteId('');
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  取消編輯
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {orderPosition.executionOrder === 1 ? (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                    起始
                  </span>
                ) : null}
                <span className="text-sm font-medium text-zinc-100">{route.routeName}</span>
                <label className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5">
                  <span className="text-[10px] font-medium text-zinc-400">
                    代號
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
                    title="路線代號（必填，班次卡顯示用）"
                    aria-label={`${route.routeName} 路線代號（必填）`}
                    aria-required
                  />
                </label>
                <span className="text-xs text-zinc-500">{route.groupName}</span>
                {!isManual ? (
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className="shrink-0">服務方向</span>
                    <select
                      value={route.serviceDirectionId ?? ''}
                      onChange={(e) => updateServiceDirectionId(instanceId, e.target.value)}
                      disabled={serviceDirectionTags.length === 0}
                      className="h-7 max-w-[140px] rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 focus:border-[#2B7FFF] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${route.routeName} 服務方向`}
                      title={
                        serviceDirectionTags.length === 0
                          ? '請先在上方新增服務方向'
                          : '選擇此路線所屬服務方向（單選）'
                      }
                    >
                      <option value="">未設定</option>
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
                  ? '請填寫路線代號，供手動製作班次代號使用。'
                  : '請填寫路線代號；變更後需重新產生班表。'}
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
                title="編輯路線"
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
                title="刪除"
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

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-6 shrink-0">
        <h2 className="text-base font-medium text-zinc-100">配置路線群組</h2>
        {!loading && !error && mapDisplayName ? (
          <p className="mt-1 text-xs text-zinc-500">
            資料來源：目前使用地圖「{mapDisplayName}」
            {turnaroundLoading
              ? ' · 載入折返時限…'
              : turnaroundLimitSeconds != null
                ? ` · 車輛折返時限 ${formatSecondsLabel(turnaroundLimitSeconds)}`
                : timeTemplateId
                  ? ' · 時間模板尚無可計算的折返時限'
                  : ' · 請先選擇時間模板'}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          載入路線群組中…
        </div>
      ) : error ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center px-6 text-sm text-red-400">
          {error}
        </div>
      ) : catalog.length === 0 ? (
        <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
          <ShiftSelectionEmptyState />
          <p className="pb-8 text-center text-xs text-zinc-500">
            請至地圖編輯器建立路線群組與路線，並設為目前使用地圖
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
          {!isManual ? (
            <RecoveryAndServiceDirectionBar
              minimumRecoveryTimeSeconds={draft.minimumRecoveryTimeSeconds}
              onUpdateRecoveryTime={updateRecoveryTime}
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
              confirmLabel="確認新增路線"
              emptyHint="依群組選擇路線"
              title="新增路線"
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
                    <p className="text-[11px] text-zinc-500">請先在關聯圖拉好路線接續（至少一條連線）。</p>
                  ) : throughGateStatus === 'missingMarks' ? (
                    <p className="text-[11px] text-zinc-400">
                      請至少各設一條「由此起算」與「到此結算」，並設好首班車。
                    </p>
                  ) : throughGateStatus === 'headNotInStarts' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-200">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                      <span>首班車必須也是「由此起算」的其中一條。</span>
                    </p>
                  ) : throughGateStatus === 'failed' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                      <span>找不到從起算走到結算的路徑，請檢查優先連線。</span>
                    </p>
                  ) : throughGateStatus === 'missingPreferred' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-200">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                      <span>請在下方清單點選一列設為「優先採用」後才能下一步。</span>
                    </p>
                  ) : null}

                  {listedThroughCycles.length > 0 ? (
                    <div className="space-y-1">
                      <p className="pb-1 text-[11px] text-zinc-500">
                        點選一列設為「優先採用」（全優先在上、次要在下）。
                        {listedIsStale
                          ? ' 清單可能已過時，變更關聯後請再按檢查更新。'
                          : ' 排班會盡量走這組，約束衝突時才改派其他組合。'}
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
                                        ? '次'
                                        : '優'}
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
                                  ? '全優先'
                                  : `次要×${cycle.secondaryCount}`}
                              </span>
                              {isReference ? (
                                <>
                                  <span className="text-zinc-600">·</span>
                                  <span className="text-emerald-300">優先採用</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-zinc-600">·</span>
                                  <span className="text-zinc-500">點選採用</span>
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
                                <span className="text-zinc-500">快 </span>
                                {formatSecondsLabel(cycle.minCycleSeconds)}
                              </div>
                              <div className="text-sm">
                                <span className="text-zinc-500">均 </span>
                                {formatSecondsLabel(cycle.avgCycleSeconds)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {throughGateStatus === 'overLimit' && referenceCycle ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                      <span>
                        優先採用（{referenceCycle.labels.join('→')}）最快{' '}
                        {formatSecondsLabel(referenceCycle.minCycleSeconds)}
                        、平均 {formatSecondsLabel(referenceCycle.avgCycleSeconds)}
                        大於折返時限（{formatSecondsLabel(turnaroundLimitSeconds)}）。
                      </span>
                    </p>
                  ) : null}

                  {throughGateStatus === 'passed' && referenceCycle ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      <span>
                        已確認：{referenceCycle.labels.join('→')}
                        {hasLimit ? '，符合折返時限' : ''}
                        。可以下一步。
                      </span>
                    </p>
                  ) : throughGateStatus === 'passed' ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      <span>路線組合仍有效。可以下一步。</span>
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
                        ? '重新檢查路線組合'
                        : '產生路線組合'}
                    </button>
                    {nextStepBlockers.length > 0 ? (
                      <div className="w-full rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-left text-[11px] text-amber-100/90">
                        <p className="font-medium text-amber-200">下一步尚無法使用：</p>
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
