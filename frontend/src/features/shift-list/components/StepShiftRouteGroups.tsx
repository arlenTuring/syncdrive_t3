import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
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
  ShiftScheduleStationDwell,
} from '../types/create';
import {
  applyDwellSlackSeconds,
  areStationDwellsComplete,
  isMainlineRouteWithinTurnaroundLimit,
  moveSelectedRouteExecutionOrder,
  nextExecutionOrder,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeSelectedRouteExecutionOrders,
  resolveRouteOrderPosition,
  resolveNextRouteInExecutionOrder,
  sortSelectedRoutesByExecutionOrder,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
} from '../types/create';
import {
  loadShiftRouteGroupCatalog,
  type ShiftRouteGroupCatalogItem,
  type ShiftRouteOption,
} from '../utils/shiftRouteGroupCatalog';
import { ShiftSelectionEmptyState } from './ShiftSelectionEmptyState';

type StepShiftRouteGroupsProps = {
  draft: ShiftScheduleRouteGroupsDraft;
  onChange: (next: ShiftScheduleRouteGroupsDraft) => void;
  timeTemplateId: string;
  creationMode?: ShiftScheduleCreationMode;
};

type GroupSelectionState = 'none' | 'partial' | 'all';

const DWELL_INPUT_CLASS =
  'h-8 w-20 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-2 text-sm tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30 disabled:cursor-not-allowed disabled:opacity-60';

function resolveGroupSelectionState(
  group: ShiftRouteGroupCatalogItem,
  selectedRouteIds: ReadonlySet<string>,
): GroupSelectionState {
  if (group.routes.length === 0) return 'none';
  const selectedCount = group.routes.filter((r) => selectedRouteIds.has(r.routeId)).length;
  if (selectedCount === 0) return 'none';
  if (selectedCount === group.routes.length) return 'all';
  return 'partial';
}

function TriStateCheckbox({
  state,
  disabled,
  onToggle,
  label,
}: {
  state: GroupSelectionState;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = state === 'partial';
    }
  }, [state]);

  const title =
    state === 'all'
      ? `取消選取「${label}」內全部路線`
      : state === 'partial'
        ? `「${label}」部分路線已選，點擊全選`
        : `全選「${label}」內全部路線`;

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={state === 'all'}
      disabled={disabled}
      onChange={onToggle}
      title={title}
      aria-label={title}
      className="size-4 shrink-0 rounded border-zinc-600 bg-zinc-900 accent-[#2B7FFF] disabled:opacity-40"
    />
  );
}

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
    return {
      stationId,
      stationName: route.stationNames[index] ?? prev?.stationName ?? stationId,
      dwellSeconds: prev?.dwellSeconds ?? null,
    };
  });
}

function StationDwellEditor({
  route,
  turnaroundLimitSeconds,
  minimumRecoveryTimeSeconds,
  onUpdateDwell,
  onUpdateDwellSlack,
}: {
  route: ShiftScheduleSelectedRoute;
  turnaroundLimitSeconds: number | null;
  minimumRecoveryTimeSeconds: number | null;
  onUpdateDwell: (stationId: string, value: string) => void;
  onUpdateDwellSlack: (value: string) => void;
}) {
  const dwellsComplete = areStationDwellsComplete(route.stationDwells);
  const withinLimit = isMainlineRouteWithinTurnaroundLimit(
    route,
    turnaroundLimitSeconds,
    minimumRecoveryTimeSeconds ?? 0,
  );

  const totalDwellWithSlack = route.stationDwells.reduce((sum, d) => {
    return sum + applyDwellSlackSeconds(d.dwellSeconds ?? 0, route.dwellSlackSeconds);
  }, 0);
  const totalMinSum = (route.minTravelTimeSeconds ?? 0) + (minimumRecoveryTimeSeconds ?? 0) + totalDwellWithSlack;
  const totalAvgSum = (route.avgTravelTimeSeconds ?? 0) + (minimumRecoveryTimeSeconds ?? 0) + totalDwellWithSlack;
  const showIncompleteWarning = !dwellsComplete;
  const showTurnaroundWarning = dwellsComplete && !withinLimit;

  return (
    <div className="ml-10 mt-2 space-y-2 rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-3 py-3">
      <p className="text-[11px] text-[#2B7FFF]/90 flex items-center gap-1 font-medium">
        💡 提示：請輸入各站靠站時間。預設為空白表示必定要填寫，若輸入「0」秒則表示不停靠該站。
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {route.stationDwells.map((dwell) => (
          <label key={dwell.stationId} className="block">
            <span className="mb-1 block text-[11px] text-zinc-500" title="填寫 0 秒預設為不停靠此站">{dwell.stationName}</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={dwell.dwellSeconds == null ? '' : String(dwell.dwellSeconds)}
                onChange={(e) => onUpdateDwell(dwell.stationId, e.target.value.replace(/\D/g, ''))}
                placeholder="必填"
                title="填寫 0 秒預設為不停靠此站"
                className={DWELL_INPUT_CLASS}
                aria-label={`${dwell.stationName} 停靠秒數`}
              />
              <span className="text-xs text-zinc-500">秒</span>
            </div>
          </label>
        ))}

        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">靠站緩衝</span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              value={String(route.dwellSlackSeconds)}
              onChange={(e) => onUpdateDwellSlack(e.target.value)}
              className={DWELL_INPUT_CLASS}
              aria-label={`${route.routeName} 靠站緩衝秒數`}
            />
            <span className="text-xs text-zinc-500">秒</span>
          </div>
        </label>
      </div>

      <div className="mt-2 space-y-1">
        {showIncompleteWarning && (
          <p className="text-[10px] text-zinc-500">
            ⚠️ 停靠時間尚未填寫完整（不可留空，不停靠請填 0 秒）。
          </p>
        )}
        {showTurnaroundWarning && (
          <p className="text-[10px] text-red-400">
            ⚠️ 此路線最快單趟加總已超過折返時限限制！
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-zinc-500 font-medium justify-start">
          <span className="text-zinc-400">最快一趟 + 恢復 + 靠站總和(含緩衝)：</span>
          <span className="tabular-nums text-zinc-300">
            {formatSecondsLabel(totalMinSum)}
          </span>
          <span className="text-zinc-600">
            ({route.minTravelTimeSeconds ?? 0}s 行駛 + {minimumRecoveryTimeSeconds ?? 0}s 恢復 + {totalDwellWithSlack}s 靠站)
          </span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">平均一趟 + 恢復 + 靠站總和(含緩衝)：</span>
          <span className="tabular-nums text-zinc-300">
            {formatSecondsLabel(totalAvgSum)}
          </span>
          <span className="text-zinc-600">
            ({route.avgTravelTimeSeconds ?? 0}s 行駛 + {minimumRecoveryTimeSeconds ?? 0}s 恢復 + {totalDwellWithSlack}s 靠站)
          </span>
        </div>
      </div>
    </div>
  );
}


function RouteOrderControls({
  executionOrder,
  showArrows,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  executionOrder: number;
  showArrows: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: 'up' | 'down') => void;
}) {
  if (executionOrder <= 0) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-1"
      onClick={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span
        className="flex size-6 items-center justify-center rounded-full bg-[#2B7FFF]/15 text-xs font-semibold tabular-nums text-[#7CB8FF]"
        title="執行順序"
      >
        {executionOrder}
      </span>
      {showArrows ? (
        <div className="flex flex-col">
          <button
            type="button"
            title="提前順序"
            disabled={!canMoveUp}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMove('up');
            }}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            title="延後順序"
            disabled={!canMoveDown}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMove('down');
            }}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
          >
            <ArrowDown className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RouteCheckboxRow({
  route,
  checked,
  disabled,
  onToggle,
}: {
  route: ShiftRouteOption;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label
        className={`ml-3 flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
          disabled
            ? 'cursor-not-allowed border-zinc-800/60 bg-zinc-950/20 opacity-60'
            : checked
              ? 'cursor-pointer border-[#2B7FFF]/40 bg-[rgba(43,127,255,0.08)]'
              : 'cursor-pointer border-zinc-800/80 bg-zinc-950/40 hover:border-zinc-700'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="mt-0.5 size-4 shrink-0 rounded border-zinc-600 bg-zinc-900 accent-[#2B7FFF] disabled:opacity-40"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-100">{route.label}</span>
            <span className="text-[10px] text-zinc-500 font-normal">
              最快一趟: {formatSecondsLabel(route.minTravelTimeSeconds)} · 平均一趟: {formatSecondsLabel(route.avgTravelTimeSeconds)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{route.stationPathLabel}</span>
        </span>
      </label>
    </div>
  );
}

function SelectedRoutesSummaryPanel({
  routes,
  turnaroundLimitSeconds,
  minimumRecoveryTimeSeconds,
  creationMode = 'parametric',
  onMove,
  onUpdateSwitchBuffer,
  onUpdateRouteCode,
  onUpdateDwell,
  onUpdateDwellSlack,
  onUpdateRecoveryTime,
}: {
  routes: ShiftScheduleSelectedRoute[];
  turnaroundLimitSeconds: number | null;
  minimumRecoveryTimeSeconds: number | null;
  creationMode?: ShiftScheduleCreationMode;
  onMove: (routeId: string, direction: 'up' | 'down') => void;
  onUpdateSwitchBuffer: (routeId: string, value: string) => void;
  onUpdateRouteCode: (routeId: string, value: string) => void;
  onUpdateDwell: (routeId: string, stationId: string, value: string) => void;
  onUpdateDwellSlack: (routeId: string, value: string) => void;
  onUpdateRecoveryTime: (value: string) => void;
}) {
  const isManual = creationMode === 'manual';
  const orderedRoutes = useMemo(
    () => sortSelectedRoutesByExecutionOrder(routes),
    [routes],
  );

  return (
    <section className="flex min-h-[220px] shrink-0 flex-col border-t border-zinc-800/80 bg-zinc-950/20 pt-4">
      {!isManual ? (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-sm text-zinc-300">
              最低恢復時間（秒）
              <InfoTooltip
                content="每趟正線行駛結束後，至下一趟正線發車前至少預留的整備／恢復時間。"
                example="輸入「30」代表最少保留 30 秒恢復空檔。"
              />
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
        </div>
      ) : null}

      <div className="mb-3 shrink-0 px-1">
        <h3 className="text-sm font-medium text-zinc-100">已選路線</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {isManual
            ? '依 ↑↓ 調整執行順序，並為每條路線填寫路線代號（手動製作班次卡用）。'
            : '依 ↑↓ 調整執行順序；在路線之間設定切換緩衝（秒）。內容隨上方停靠設定同步更新。'}
        </p>
      </div>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {orderedRoutes.map((route) => {
          const orderPosition = resolveRouteOrderPosition(routes, route.routeId);
          const nextRoute = resolveNextRouteInExecutionOrder(routes, route.routeId);

          return (
            <li key={route.routeId} className="space-y-2">
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-3">
                <div className="flex items-start gap-2">
                  <RouteOrderControls
                    executionOrder={orderPosition.executionOrder}
                    showArrows={orderPosition.showControls}
                    canMoveUp={orderPosition.canMoveUp}
                    canMoveDown={orderPosition.canMoveDown}
                    onMove={(direction) => onMove(route.routeId, direction)}
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100">
                        {route.routeName}
                      </span>
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
                            onUpdateRouteCode(
                              route.routeId,
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
                    </div>
                    {!route.routeCode?.trim() ? (
                      <p className="text-[11px] text-amber-400/90">
                        {isManual
                          ? '請填寫路線代號，供手動製作班次代號使用。'
                          : '請填寫路線代號；變更後需重新產生班表。'}
                      </p>
                    ) : null}

                    {!isManual ? (
                      <StationDwellEditor
                        route={route}
                        turnaroundLimitSeconds={turnaroundLimitSeconds}
                        minimumRecoveryTimeSeconds={minimumRecoveryTimeSeconds}
                        onUpdateDwell={(stationId, val) => onUpdateDwell(route.routeId, stationId, val)}
                        onUpdateDwellSlack={(val) => onUpdateDwellSlack(route.routeId, val)}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              {!isManual && orderedRoutes.length > 1 && nextRoute ? (
                <div className="ml-10 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-800/80 bg-zinc-950/30 px-3 py-2">
                  <span className="text-xs text-zinc-500">
                    切換至「{nextRoute.routeName}」緩衝
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(route.switchBufferAfterSeconds)}
                    onChange={(e) => onUpdateSwitchBuffer(route.routeId, e.target.value)}
                    className={DWELL_INPUT_CLASS}
                    aria-label={`${route.routeName} 切換至 ${nextRoute.routeName} 緩衝秒數`}
                  />
                  <span className="pb-1 text-xs text-zinc-500">秒</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RouteGroupSection({
  group,
  expanded,
  selectionState,
  onToggleExpanded,
  onToggleGroup,
  selectedRouteIds,
  onToggleRoute,
}: {
  group: ShiftRouteGroupCatalogItem;
  expanded: boolean;
  selectionState: GroupSelectionState;
  onToggleExpanded: () => void;
  onToggleGroup: () => void;
  selectedRouteIds: ReadonlySet<string>;
  onToggleRoute: (route: ShiftRouteOption) => void;
}) {
  const selectedInGroup = group.routes.filter((r) => selectedRouteIds.has(r.routeId)).length;
  const hasRoutes = group.routes.length > 0;

  return (
    <section
      className={[
        'overflow-hidden rounded-xl border bg-zinc-950/30 transition-colors',
        selectionState === 'all'
          ? 'border-[#2B7FFF]/35'
          : selectionState === 'partial'
            ? 'border-[#2B7FFF]/20'
            : 'border-zinc-800/80',
      ].join(' ')}
    >
      <div className="flex items-stretch gap-2 px-3 py-3 sm:px-4">
        <div className="flex shrink-0 items-center">
          <TriStateCheckbox
            state={selectionState}
            disabled={!hasRoutes}
            onToggle={onToggleGroup}
            label=""
          />
        </div>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:opacity-90"
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-zinc-500" />
          )}
          <FolderOpen className="size-4 shrink-0 text-sky-400/90" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
            {group.groupName}
          </span>
          {hasRoutes ? (
            <span className="shrink-0 text-xs text-zinc-500">
              {selectedInGroup > 0
                ? `已選 ${selectedInGroup}/${group.routes.length}`
                : `${group.routes.length} 條路線`}
            </span>
          ) : null}
        </button>
      </div>

      {expanded ? (
        <div className="space-y-2 border-t border-zinc-800/80 px-3 pb-3 pt-2">
          {group.routes.length === 0 ? (
            <p className="px-1 py-2 text-xs text-zinc-600">此群組尚無路線</p>
          ) : (
            group.routes.map((route) => (
              <RouteCheckboxRow
                key={route.routeId}
                route={route}
                checked={selectedRouteIds.has(route.routeId)}
                onToggle={() => onToggleRoute(route)}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [turnaroundLimitSeconds, setTurnaroundLimitSeconds] = useState<number | null>(null);
  const [turnaroundLoading, setTurnaroundLoading] = useState(false);
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
        onChangeRef.current({
          mapId: result.mapId,
          minimumRecoveryTimeSeconds: draftRef.current.minimumRecoveryTimeSeconds,
          selectedRoutes: normalizeSelectedRouteExecutionOrders(
            draftRef.current.selectedRoutes
              .filter((selected) => validRouteIds.has(selected.routeId))
              .map((selected) => {
                const meta = routeMeta.get(selected.routeId);
                if (!meta) return selected;
                return {
                  ...selected,
                  stationIds: [...meta.stationIds],
                  stationDwells: buildStationDwells(meta, selected.stationDwells),
                  // 地圖拓撲／路線時間更新後，重載目錄時一併刷新 leg 快照
                  stationLegTravels: meta.stationLegTravels.map((leg) => ({ ...leg })),
                  avgTravelTimeSeconds: meta.avgTravelTimeSeconds,
                  minTravelTimeSeconds: meta.minTravelTimeSeconds,
                };
              }),
          ),
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

  const selectedRouteIds = useMemo(
    () => new Set(draft.selectedRoutes.map((r) => r.routeId)),
    [draft.selectedRoutes],
  );

  const selectedById = useMemo(
    () => new Map(draft.selectedRoutes.map((r) => [r.routeId, r] as const)),
    [draft.selectedRoutes],
  );

  const patchSelectedRoute = (
    routeId: string,
    patch: Partial<ShiftScheduleSelectedRoute>,
  ) => {
    onChange({
      ...draft,
      selectedRoutes: draft.selectedRoutes.map((route) =>
        route.routeId === routeId ? { ...route, ...patch } : route,
      ),
    });
  };

  const toSelected = (
    group: ShiftRouteGroupCatalogItem,
    route: ShiftRouteOption,
    existing?: ShiftScheduleSelectedRoute,
  ): ShiftScheduleSelectedRoute => ({
    routeId: route.routeId,
    routeName: route.label,
    groupId: group.groupId,
    groupName: group.groupName,
    stationIds: [...route.stationIds],
    stationDwells: buildStationDwells(route, existing?.stationDwells),
    stationDwellsConfirmed: existing?.stationDwellsConfirmed === true,
    stationLegTravels: route.stationLegTravels.map((leg) => ({ ...leg })),
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
    executionOrder:
      existing?.executionOrder && existing.executionOrder > 0
        ? existing.executionOrder
        : nextExecutionOrder(draft.selectedRoutes),
    switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(
      existing?.switchBufferAfterSeconds,
    ),
    dwellSlackSeconds: normalizeDwellSlackSeconds(existing?.dwellSlackSeconds),
  });

  const toggleRoute = (
    group: ShiftRouteGroupCatalogItem,
    route: ShiftRouteOption,
  ) => {
    const exists = selectedRouteIds.has(route.routeId);
    const nextSelected = exists
      ? normalizeSelectedRouteExecutionOrders(
          draft.selectedRoutes.filter((r) => r.routeId !== route.routeId),
        )
      : normalizeSelectedRouteExecutionOrders([
          ...draft.selectedRoutes,
          toSelected(group, route),
        ]);
    onChange({
      ...draft,
      selectedRoutes: nextSelected,
    });
  };

  const moveRouteOrder = (routeId: string, direction: 'up' | 'down') => {
    onChange({
      ...draft,
      selectedRoutes: moveSelectedRouteExecutionOrder(draft.selectedRoutes, routeId, direction),
    });
  };

  const toggleGroup = (group: ShiftRouteGroupCatalogItem) => {
    if (group.routes.length === 0) return;
    const state = resolveGroupSelectionState(group, selectedRouteIds);
    if (state === 'all') {
      const groupRouteIds = new Set(group.routes.map((r) => r.routeId));
      onChange({
        ...draft,
        selectedRoutes: normalizeSelectedRouteExecutionOrders(
          draft.selectedRoutes.filter((r) => !groupRouteIds.has(r.routeId)),
        ),
      });
      return;
    }
    const existingById = new Map(draft.selectedRoutes.map((r) => [r.routeId, r] as const));
    const toAdd = group.routes
      .filter((route) => !existingById.has(route.routeId))
      .map((route) => ({
        ...toSelected(group, route),
        executionOrder: 0,
      }));
    onChange({
      ...draft,
      selectedRoutes: normalizeSelectedRouteExecutionOrders([
        ...draft.selectedRoutes,
        ...toAdd,
      ]),
    });
  };

  const updateDwell = (routeId: string, stationId: string, raw: string) => {
    const digits = sanitizeIntegerInput(raw);
    const dwellSeconds = digits === '' ? null : Math.max(1, Number(digits));
    const current = selectedById.get(routeId);
    if (!current) return;
    patchSelectedRoute(routeId, {
      stationDwellsConfirmed: false,
      stationDwells: current.stationDwells.map((dwell) =>
        dwell.stationId === stationId ? { ...dwell, dwellSeconds } : dwell,
      ),
    });
  };

  const updateDwellSlack = (routeId: string, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const seconds =
      digits === '' ? 0 : normalizeDwellSlackSeconds(Number(digits));
    patchSelectedRoute(routeId, {
      dwellSlackSeconds: seconds,
      stationDwellsConfirmed: false,
    });
  };



  const updateRecoveryTime = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const seconds =
      digits === '' ? null : normalizeMinimumRecoveryTimeSeconds(Number(digits));
    onChange({
      ...draft,
      minimumRecoveryTimeSeconds: seconds,
      selectedRoutes: draft.selectedRoutes.map((route) => ({
        ...route,
        stationDwellsConfirmed: false,
      })),
    });
  };

  const updateSwitchBuffer = (routeId: string, raw: string) => {
    const digits = sanitizeIntegerInput(raw);
    const switchBufferAfterSeconds =
      digits === '' ? 0 : normalizeSwitchBufferAfterSeconds(Number(digits));
    patchSelectedRoute(routeId, {
      switchBufferAfterSeconds,
      stationDwellsConfirmed: false,
    });
  };

  const updateRouteCode = (routeId: string, val: string) => {
    patchSelectedRoute(routeId, {
      routeCode: val.trim() ? val.trim().toUpperCase() : null,
      stationDwellsConfirmed: false,
    });
  };

  const isGroupOpen = (groupId: string) => !collapsed[groupId];

  const totalMinTravel = draft.selectedRoutes.reduce((acc, r) => acc + (r.minTravelTimeSeconds ?? 0), 0);
  const totalAvgTravel = draft.selectedRoutes.reduce((acc, r) => acc + (r.avgTravelTimeSeconds ?? 0), 0);
  const totalDwells = draft.selectedRoutes.reduce((acc, r) => {
    return acc + r.stationDwells.reduce((sum, d) => {
      return sum + applyDwellSlackSeconds(d.dwellSeconds ?? 0, r.dwellSlackSeconds);
    }, 0);
  }, 0);
  const totalSwitchBuffer = draft.selectedRoutes.reduce((acc, r) => acc + (r.switchBufferAfterSeconds ?? 0), 0);
  
  const totalMinCycle = totalMinTravel + totalDwells + totalSwitchBuffer + (draft.minimumRecoveryTimeSeconds ?? 0);
  const totalAvgCycle = totalAvgTravel + totalDwells + totalSwitchBuffer + (draft.minimumRecoveryTimeSeconds ?? 0);
  const hasLimit = turnaroundLimitSeconds != null && turnaroundLimitSeconds > 0;
  const isOver = hasLimit && totalMinCycle > (turnaroundLimitSeconds ?? 0);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-6 shrink-0">
        <h2 className="text-base font-medium text-zinc-100">選擇要套用的路線群組</h2>
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
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-3 pb-4">
              {catalog.map((group) => (
                <RouteGroupSection
                  key={group.groupId}
                  group={group}
                  expanded={isGroupOpen(group.groupId)}
                  selectionState={resolveGroupSelectionState(group, selectedRouteIds)}
                  onToggleExpanded={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [group.groupId]: !prev[group.groupId],
                    }))
                  }
                  onToggleGroup={() => toggleGroup(group)}
                  selectedRouteIds={selectedRouteIds}
                  onToggleRoute={(route) => toggleRoute(group, route)}
                />
              ))}
            </div>
          </div>

          {draft.selectedRoutes.length > 0 ? (
            <div className="mt-4 shrink-0 space-y-4 border-t border-zinc-800 bg-zinc-950/40 p-4">
              <SelectedRoutesSummaryPanel
                routes={draft.selectedRoutes}
                turnaroundLimitSeconds={turnaroundLimitSeconds}
                minimumRecoveryTimeSeconds={draft.minimumRecoveryTimeSeconds}
                creationMode={creationMode}
                onMove={moveRouteOrder}
                onUpdateSwitchBuffer={updateSwitchBuffer}
                onUpdateRouteCode={updateRouteCode}
                onUpdateDwell={updateDwell}
                onUpdateDwellSlack={updateDwellSlack}
                onUpdateRecoveryTime={updateRecoveryTime}
              />
              
              {creationMode !== 'manual' ? (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-zinc-200">通盤可行性對抗</h4>
                  {turnaroundLimitSeconds != null && (
                    <span className="text-xs text-zinc-500">
                      車輛折返時限限制: {formatSecondsLabel(turnaroundLimitSeconds)}
                    </span>
                  )}
                </div>
                
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className={`rounded-lg border p-4 transition-all duration-300 ${
                    isOver 
                      ? 'border-red-500/30 bg-red-500/5' 
                      : 'border-emerald-500/20 bg-emerald-500/5'
                  }`}>
                    <div className="text-xs font-medium text-zinc-400">完整循環最快時間</div>
                    <div className={`mt-2 text-2xl font-bold tabular-nums ${
                      isOver ? 'text-red-400' : 'text-emerald-400'
                    }`}>
                      {formatSecondsLabel(totalMinCycle)}
                    </div>
                    <div className="mt-1.5 text-[10px] text-zinc-500 font-medium">
                      ({totalMinTravel}s 行駛 + {totalDwells}s 停靠 + {totalSwitchBuffer}s 切換 + {draft.minimumRecoveryTimeSeconds ?? 0}s 恢復)
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                    <div className="text-xs font-medium text-zinc-400">完整循環平均時間</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-200">
                      {formatSecondsLabel(totalAvgCycle)}
                    </div>
                    <div className="mt-1.5 text-[10px] text-zinc-500 font-medium">
                      ({totalAvgTravel}s 行駛 + {totalDwells}s 停靠 + {totalSwitchBuffer}s 切換 + {draft.minimumRecoveryTimeSeconds ?? 0}s 恢復)
                    </div>
                  </div>
                </div>

                {turnaroundLimitSeconds != null && (
                  <div className="mt-3">
                    {isOver ? (
                      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
                        <span>
                          <strong>校驗未通過</strong>：完整循環最快時間（{formatSecondsLabel(totalMinCycle)}）大於車輛折返時限限制（{formatSecondsLabel(turnaroundLimitSeconds)}）。請縮短停靠時間、靠站緩衝秒數，或降低最低恢復時間。
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                        <span>
                          <strong>校驗通過</strong>：完整循環最快時間符合車輛折返時限限制。
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function InfoTooltip({ content, example }: { content: string; example?: string }) {
  return (
    <span className="group relative inline-flex cursor-help items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400 size-3.5 hover:bg-zinc-700 hover:text-zinc-200">
      ?
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 w-60 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] font-normal leading-normal text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 z-50">
        {content}
        {example && <span className="mt-1 block text-zinc-500">{example}</span>}
      </span>
    </span>
  );
}
