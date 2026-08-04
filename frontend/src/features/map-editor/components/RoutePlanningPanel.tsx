import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Info,
  Save,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute, MapRouteGroup } from '../types/mapFile'
import { RouteGroupEditorView, type RouteGroupDraft } from './RouteGroupEditorView'
import { RouteGroupListView } from './RouteGroupListView'
import {
  stationDisplayLabel,
  isRouteTravelTimePairValid,
  isRoutePlanningDraftSavable,
  type RoutePlanningDraft,
} from '../utils/routePlanning'
import { resolveRoutePreviewGeometry } from '../utils/routeTrackPath'
import type { PointTopology } from '../types/pointTopology'
import {
  buildTopologyRouteTravelBreakdown,
  formatTopologyLegSummary,
  partitionStationsForTopologyRouteAppend,
  type TopologyRouteAppendOption,
} from '../utils/topologyRouteTravel'

function groupRouteAppendOptionsByKind(options: TopologyRouteAppendOption[]) {
  return {
    docking: options.filter((option) => option.kind === 'docking'),
    facilityDocking: options.filter((option) => option.kind === 'facility-docking'),
    waypoint: options.filter((option) => option.kind === 'waypoint'),
    crossoverWaypoint: options.filter((option) => option.kind === 'crossover-waypoint'),
  }
}

function RouteAppendOptionGroup({
  title,
  titleClassName,
  options,
  disabled,
  dropdownStationId,
  onPick,
}: {
  title: string
  titleClassName: string
  options: TopologyRouteAppendOption[]
  disabled?: boolean
  dropdownStationId: string
  onPick: (stationId: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="px-1 pb-1">
      <p className={['px-2 py-1 text-[9px] font-semibold uppercase tracking-wider', titleClassName].join(' ')}>
        {title}
      </p>
      {options.map((station) => (
        disabled ? (
          <div
            key={station.stationId}
            className="cursor-not-allowed rounded px-2 py-1.5 opacity-45"
          >
            <p className="text-[11px] text-zinc-500">
              {station.stationName}
            </p>
            <p className="text-[9px] text-zinc-600">
              {station.reason}
            </p>
          </div>
        ) : (
          <button
            key={station.stationId}
            type="button"
            onClick={() => onPick(station.stationId)}
            className={[
              'w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-zinc-800',
              dropdownStationId === station.stationId
                ? 'bg-amber-950/40 text-amber-100'
                : 'text-zinc-100',
            ].join(' ')}
          >
            {station.stationName}{' '}
            <span className="font-mono text-[10px] text-zinc-500">
              ({station.stationId})
            </span>
          </button>
        )
      ))}
    </div>
  )
}

type Props = {
  areas: MapAreaObject[]
  routeGroups: MapRouteGroup[]
  routes: MapPlannedRoute[]
  pointTopology: PointTopology
  editMode: boolean
  draft: RoutePlanningDraft | null
  groupDraft: RouteGroupDraft | null
  visibleRouteIds: ReadonlySet<string>
  pickMode: boolean
  onStartNewRoute: (groupId: string | null) => void
  onStartNewGroup: () => void
  onEditRoute: (routeId: string) => void
  onEditGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onToggleRouteVisibility: (routeId: string) => void
  onToggleGroupRouteVisibility: (routeIds: string[]) => void
  onCancelDraft: () => void
  onCancelGroupDraft: () => void
  onSaveDraft: () => void
  onSaveGroupDraft: () => void
  onDeleteRoute: (routeId: string) => void
  onDraftNameChange: (name: string) => void
  onDraftAvgTravelTimeChange: (seconds: number | null) => void
  onDraftMinTravelTimeChange: (seconds: number | null) => void
  onGroupDraftNameChange: (name: string) => void
  onRemoveStationAt: (index: number) => void
  onMoveStation: (from: number, to: number) => void
  onAppendStation: (stationId: string) => void
}

export function RoutePlanningPanel({
  areas,
  routeGroups,
  routes,
  pointTopology,
  editMode,
  draft,
  groupDraft,
  visibleRouteIds,
  pickMode: _pickMode,
  onStartNewRoute,
  onStartNewGroup,
  onEditRoute,
  onEditGroup,
  onDeleteGroup,
  onToggleRouteVisibility,
  onToggleGroupRouteVisibility,
  onCancelDraft,
  onCancelGroupDraft,
  onSaveDraft,
  onSaveGroupDraft,
  onDeleteRoute,
  onDraftNameChange,
  onDraftAvgTravelTimeChange,
  onDraftMinTravelTimeChange,
  onGroupDraftNameChange,
  onRemoveStationAt,
  onMoveStation,
  onAppendStation,
}: Props) {
  const editingRoute = draft !== null
  const editingGroup = groupDraft !== null
  const [dropdownStationId, setDropdownStationId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const topologyBreakdown = useMemo(() => {
    if (!draft || draft.stationIds.length < 2) return null
    return buildTopologyRouteTravelBreakdown(pointTopology, areas, draft.stationIds)
  }, [draft, pointTopology, areas])

  const canSave = Boolean(draft && isRoutePlanningDraftSavable(draft))

  // 整線行駛時間由拓撲自動加總
  useEffect(() => {
    if (!draft || !editMode) return
    if (!topologyBreakdown) {
      if (draft.avgTravelTimeSeconds != null) onDraftAvgTravelTimeChange(null)
      if (draft.minTravelTimeSeconds != null) onDraftMinTravelTimeChange(null)
      return
    }
    const nextAvg = topologyBreakdown.timesComplete
      ? topologyBreakdown.totalAvgTravelTimeSeconds
      : null
    const nextMin = topologyBreakdown.timesComplete
      ? topologyBreakdown.totalMinTravelTimeSeconds
      : null
    if (draft.avgTravelTimeSeconds !== nextAvg) onDraftAvgTravelTimeChange(nextAvg)
    if (draft.minTravelTimeSeconds !== nextMin) onDraftMinTravelTimeChange(nextMin)
  }, [
    draft,
    editMode,
    topologyBreakdown,
    onDraftAvgTravelTimeChange,
    onDraftMinTravelTimeChange,
  ])

  const travelTimeInvalid =
    draft != null
    && !isRouteTravelTimePairValid(draft.avgTravelTimeSeconds, draft.minTravelTimeSeconds)
    && (draft.avgTravelTimeSeconds != null || draft.minTravelTimeSeconds != null)

  const routePreview = useMemo(() => {
    if (!draft || draft.stationIds.length < 2) return null
    return resolveRoutePreviewGeometry(areas, draft.stationIds)
  }, [areas, draft])

  // 軌道預覽警告僅供參考；路線是否成立改由拓撲決定
  const routeWarnings = routePreview?.warnings ?? []

  const stationPartition = useMemo(() => {
    if (!draft) return { selectable: [], disabled: [] }
    return partitionStationsForTopologyRouteAppend(
      pointTopology,
      areas,
      draft.stationIds,
    )
  }, [pointTopology, areas, draft])

  const { selectable: selectableStations, disabled: disabledStations } =
    stationPartition

  const selectableGroups = useMemo(
    () => groupRouteAppendOptionsByKind(selectableStations),
    [selectableStations],
  )
  const disabledGroups = useMemo(
    () => groupRouteAppendOptionsByKind(disabledStations),
    [disabledStations],
  )

  useEffect(() => {
    if (
      dropdownStationId &&
      !selectableStations.some((s) => s.stationId === dropdownStationId)
    ) {
      setDropdownStationId('')
    }
  }, [dropdownStationId, selectableStations])

  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [pickerOpen])

  const selectedStationLabel = useMemo(() => {
    if (!dropdownStationId) return null
    const hit =
      selectableStations.find((s) => s.stationId === dropdownStationId) ??
      disabledStations.find((s) => s.stationId === dropdownStationId)
    return hit ? `${hit.stationName} (${hit.stationId})` : null
  }, [dropdownStationId, selectableStations, disabledStations])

  const appendFromDropdown = () => {
    if (!dropdownStationId) return
    if (!selectableStations.some((s) => s.stationId === dropdownStationId)) {
      return
    }
    onAppendStation(dropdownStationId)
    setDropdownStationId('')
    setPickerOpen(false)
  }

  const pickStation = (stationId: string) => {
    setDropdownStationId(stationId)
    setPickerOpen(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {editingGroup && groupDraft ? (
        <RouteGroupEditorView
          draft={groupDraft}
          editMode={editMode}
          onBack={onCancelGroupDraft}
          onSave={onSaveGroupDraft}
          onNameChange={onGroupDraftNameChange}
        />
      ) : !editingRoute ? (
        <RouteGroupListView
          areas={areas}
          routeGroups={routeGroups}
          routes={routes}
          pointTopology={pointTopology}
          editMode={editMode}
          visibleRouteIds={visibleRouteIds}
          onToggleRouteVisibility={onToggleRouteVisibility}
          onToggleGroupRouteVisibility={onToggleGroupRouteVisibility}
          onEditRoute={onEditRoute}
          onDeleteRoute={onDeleteRoute}
          onEditGroup={onEditGroup}
          onDeleteGroup={onDeleteGroup}
          onStartNewRoute={onStartNewRoute}
          onStartNewGroup={onStartNewGroup}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <button
            type="button"
            onClick={onCancelDraft}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-600/80 bg-zinc-950/60 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-100"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            回到路線清單
          </button>

          <p className="text-[11px] font-semibold text-zinc-200">
            {draft.routeId ? '編輯路線' : '製作路線'}
          </p>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-zinc-400">
              路線名稱
            </label>
            <input
              type="text"
              value={draft.displayName}
              onChange={(e) => onDraftNameChange(e.target.value)}
              placeholder="例如：N2W 下行"
              disabled={!editMode}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          {editMode ? (
            <div className="space-y-2">
              <label className="block text-[10px] font-medium text-zinc-400">
                從清單加入停靠點
              </label>
              <div className="flex gap-1">
                <div ref={pickerRef} className="relative min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-left text-[11px] text-zinc-100 hover:border-amber-500/50 focus:border-amber-500/60 focus:outline-none"
                  >
                    <span
                      className={
                        selectedStationLabel ? 'truncate' : 'truncate text-zinc-500'
                      }
                    >
                      {selectedStationLabel ??
                        (selectableStations.length === 0
                          ? '所有停靠點已加入'
                          : '選擇停靠點…')}
                    </span>
                    <ChevronDown
                      className={[
                        'size-3.5 shrink-0 text-zinc-500 transition',
                        pickerOpen ? 'rotate-180' : '',
                      ].join(' ')}
                    />
                  </button>
                  {pickerOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-52 overflow-y-auto rounded-md border border-zinc-600 bg-zinc-950 py-1 shadow-xl">
                      {selectableStations.length > 0 ? (
                        <>
                          <RouteAppendOptionGroup
                            title="正線停靠點"
                            titleClassName="text-blue-400/80"
                            options={selectableGroups.docking}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title="設施停靠點"
                            titleClassName="text-amber-400/80"
                            options={selectableGroups.facilityDocking}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title="途經點"
                            titleClassName="text-emerald-400/80"
                            options={selectableGroups.waypoint}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title="渡線途經點"
                            titleClassName="text-violet-400/80"
                            options={selectableGroups.crossoverWaypoint}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                        </>
                      ) : null}
                      {disabledStations.length > 0 ? (
                        <div className="border-t border-zinc-800 pt-1">
                          <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                            無法連接（不可選）
                          </p>
                          <RouteAppendOptionGroup
                            title="正線停靠點"
                            titleClassName="text-zinc-600"
                            options={disabledGroups.docking}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title="設施停靠點"
                            titleClassName="text-zinc-600"
                            options={disabledGroups.facilityDocking}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title="途經點"
                            titleClassName="text-zinc-600"
                            options={disabledGroups.waypoint}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title="渡線途經點"
                            titleClassName="text-zinc-600"
                            options={disabledGroups.crossoverWaypoint}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={appendFromDropdown}
                  disabled={!dropdownStationId}
                  className="shrink-0 rounded-md border border-amber-500/50 bg-amber-950/40 px-2 py-1.5 text-[10px] font-medium text-amber-200 hover:bg-amber-900/50 disabled:opacity-40"
                >
                  加入
                </button>
              </div>
            </div>
          ) : null}

          {routeWarnings.length > 0 ? (
            <div className="space-y-1.5 rounded-md border border-zinc-700/50 bg-zinc-950/40 px-2.5 py-2">
              <p className="flex items-center gap-1.5 text-[9px] font-medium text-zinc-500">
                <AlertTriangle className="size-3 shrink-0" />
                地圖軌道預覽（僅參考，不影響路線是否成立）
              </p>
              <ul className="space-y-1">
                {routeWarnings.map((w) => (
                  <li
                    key={`${w.fromStationId}-${w.toStationId}`}
                    className="text-[9px] leading-snug text-zinc-600"
                  >
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="mb-1.5 text-[10px] font-medium text-zinc-400">
              站序（{draft.stationIds.length}）
            </p>
            {draft.stationIds.length === 0 ? (
              <p className="rounded border border-dashed border-zinc-700/60 px-2 py-4 text-center text-[10px] text-zinc-600">
                尚未選站
              </p>
            ) : (
              <ol className="space-y-1">
                {draft.stationIds.map((stationId, index) => {
                  const leg =
                    topologyBreakdown && index < draft.stationIds.length - 1
                      ? topologyBreakdown.legs[index]
                      : null
                  return (
                    <li key={`${stationId}-${index}`} className="space-y-1">
                      <div className="flex items-center gap-1 rounded border border-zinc-700/80 bg-zinc-950/60 px-1.5 py-1">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-200">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] font-medium text-zinc-200">
                            {stationDisplayLabel(areas, stationId)}
                          </p>
                          <p className="truncate font-mono text-[9px] text-zinc-500">
                            {stationId}
                          </p>
                        </div>
                        {editMode ? (
                          <div className="flex shrink-0 flex-col">
                            <button
                              type="button"
                              title="上移"
                              disabled={index === 0}
                              onClick={() => onMoveStation(index, index - 1)}
                              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                            >
                              <ArrowUp className="size-3" />
                            </button>
                            <button
                              type="button"
                              title="下移"
                              disabled={index === draft.stationIds.length - 1}
                              onClick={() => onMoveStation(index, index + 1)}
                              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                            >
                              <ArrowDown className="size-3" />
                            </button>
                            <button
                              type="button"
                              title="移除"
                              onClick={() => onRemoveStationAt(index)}
                              className="rounded p-0.5 text-zinc-500 hover:bg-red-950/50 hover:text-red-300"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {leg ? (
                        <div
                          className={[
                            'ml-6 rounded border px-2 py-1 text-[9px] leading-snug',
                            leg.pathFound && leg.metricsComplete
                              ? 'border-zinc-800 bg-zinc-950/40 text-zinc-400'
                              : 'border-amber-800/50 bg-amber-950/20 text-amber-200/90',
                          ].join(' ')}
                        >
                          → {stationDisplayLabel(areas, leg.toStationId)}
                          {' · '}
                          {formatTopologyLegSummary(leg)}
                          {leg.nodePath.length > 2 ? (
                            <span className="text-zinc-600">
                              {' '}
                              （經 {leg.nodePath.length - 2} 途經點）
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>

          {/* 選定至少 2 站後才顯示拓撲加總結果 */}
          {draft.stationIds.length >= 2 ? (
            <div
              className={[
                'shrink-0 rounded-lg border px-3 py-2.5 transition',
                topologyBreakdown?.timesComplete
                  ? 'border-cyan-700/50 bg-gradient-to-b from-cyan-950/40 to-zinc-950/80'
                  : 'border-zinc-700/70 bg-zinc-950/70',
              ].join(' ')}
            >
              <div className="mb-2 flex items-center gap-1">
                <p className="text-[10px] font-semibold text-zinc-200">
                  拓撲加總結果
                </p>
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    className="rounded p-0.5 text-zinc-400 transition hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/60"
                    aria-label="行駛時間說明"
                  >
                    <Info className="size-3.5" strokeWidth={2} aria-hidden />
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden w-56 rounded-md border border-zinc-600 bg-zinc-900 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-200 shadow-xl group-hover:block group-focus-within:block"
                  >
                    <span className="block">依站序在路網拓撲上自動加總。</span>
                    <span className="mt-1 block text-zinc-400">
                      可經途經點；不含月台門停靠。
                    </span>
                    {topologyBreakdown?.totalDistanceMeters != null ? (
                      <span className="mt-1.5 block border-t border-zinc-700/80 pt-1.5 tabular-nums text-zinc-100">
                        距離：{topologyBreakdown.totalDistanceMeters} m
                      </span>
                    ) : (
                      <span className="mt-1.5 block border-t border-zinc-700/80 pt-1.5 text-zinc-500">
                        距離：尚無完整資料
                      </span>
                    )}
                    <span className="mt-1 block text-zinc-500">
                      請在「編輯路網拓撲」補齊連線與時間。
                    </span>
                  </span>
                </span>
              </div>

              {topologyBreakdown?.timesComplete ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-zinc-950/60 px-2.5 py-2">
                    <p className="text-[9px] text-zinc-400">平均時間</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-zinc-50">
                      {draft.avgTravelTimeSeconds}
                      <span className="ml-1 text-[10px] font-normal text-zinc-400">秒</span>
                    </p>
                  </div>
                  <div className="rounded-md bg-zinc-950/60 px-2.5 py-2">
                    <p className="text-[9px] text-zinc-400">最快時間</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-zinc-50">
                      {draft.minTravelTimeSeconds}
                      <span className="ml-1 text-[10px] font-normal text-zinc-400">秒</span>
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] leading-snug text-zinc-400">
                  {!topologyBreakdown?.pathsComplete
                    ? '拓撲尚無此站序組合，無法計算行駛時間。'
                    : '拓撲路徑已連通，請補齊各段最快／平均時間。'}
                </p>
              )}

              {topologyBreakdown?.timesComplete
                && topologyBreakdown.totalDistanceMeters != null ? (
                <p className="mt-2 text-[10px] tabular-nums text-zinc-400">
                  距離 {topologyBreakdown.totalDistanceMeters} m
                </p>
              ) : null}

              {travelTimeInvalid ? (
                <p className="mt-1.5 text-[9px] text-red-400">
                  加總異常：最快時間須 ≤ 平均時間
                </p>
              ) : null}
            </div>
          ) : (
            <p className="shrink-0 rounded-lg border border-dashed border-zinc-700/70 px-3 py-2.5 text-center text-[10px] text-zinc-500">
              選定至少 2 個停靠點後，此處會顯示拓撲加總的行駛時間
            </p>
          )}

          {editMode ? (
            <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-zinc-700/80 pt-2">
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={!canSave}
                className="flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-600/50 bg-emerald-950/40 px-2 py-1.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
              >
                <Save className="size-3.5" />
                儲存路線
              </button>
              <button
                type="button"
                onClick={onCancelDraft}
                className="rounded-md border border-zinc-600 px-2 py-1.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
              >
                回到清單
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
