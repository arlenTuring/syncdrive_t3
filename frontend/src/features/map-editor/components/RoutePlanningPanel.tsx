import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  Info,
  Save,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { PointTopology } from '../types/pointTopology'
import {
  buildTopologyRouteTravelBreakdown,
  formatTopologyLegSummary,
  partitionStationsForTopologyRouteAppend,
  type TopologyRouteAppendOption,
} from '../utils/topologyRouteTravel'
import { Button, IconButton } from '../../../components/ui';

function groupRouteAppendOptionsByKind(options: TopologyRouteAppendOption[]) {
  return {
    docking: options.filter((option) => option.kind === 'docking'),
    facilityDocking: options.filter((option) => option.kind === 'facility-docking'),
    waypoint: options.filter((option) => option.kind === 'waypoint'),
    crossWaypoint: options.filter((option) => option.kind === 'cross-waypoint'),
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
      <p className={['px-2 py-1 text-caption-2 uppercase', titleClassName].join(' ')}>
        {title}
      </p>
      {options.map((station) => (
        disabled ? (
          <div
            key={station.stationId}
            className="cursor-not-allowed rounded px-2 py-1.5 opacity-45"
          >
            <p className="text-body-xs text-text-quaternary">
              {station.stationName}
            </p>
            <p className="text-caption-2 text-text-disabled">
              {station.reason}
            </p>
          </div>
        ) : (
          <button
            key={station.stationId}
            type="button"
            onClick={() => onPick(station.stationId)}
            className={[
              'w-full rounded px-2 py-1.5 text-left text-body-xs hover:bg-link-standard-hover',
              dropdownStationId === station.stationId
                ? 'bg-status-warning-light text-status-warning'
                : 'text-text-primary',
            ].join(' ')}
          >
            {station.stationName}{' '}
            <span className="font-mono text-caption-2 text-text-quaternary">
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
  onEditSimRoutePath: (routeId: string) => void
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
  onEditSimRoutePath,
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
  const { t } = useTranslation()
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
          onEditSimRoutePath={onEditSimRoutePath}
          onDeleteRoute={onDeleteRoute}
          onEditGroup={onEditGroup}
          onDeleteGroup={onDeleteGroup}
          onStartNewRoute={onStartNewRoute}
          onStartNewGroup={onStartNewGroup}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Button hierarchy="subordinate" variant="outlined" className="shrink-0" leadingIcon={<ChevronLeft />} onPress={onCancelDraft}>{t('mapEditor.routePlanning.backToList')}</Button>

          <p className="text-body-xs-bold text-text-primary">
            {draft.routeId ? t('mapEditor.routePlanning.editRoute') : t('mapEditor.routePlanning.createRoute')}
          </p>
          <div>
            <label className="mb-1 block text-caption-2 text-text-tertiary">
              {t('mapEditor.routePlanning.routeName')}
            </label>
            <input
              type="text"
              value={draft.displayName}
              onChange={(e) => onDraftNameChange(e.target.value)}
              placeholder={t('mapEditor.routePlanning.namePlaceholder')}
              disabled={!editMode}
              className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-body-xs text-text-primary placeholder:text-text-quaternary focus:border-status-warning-light focus:outline-none"
            />
          </div>

          {editMode ? (
            <div className="space-y-2">
              <label className="block text-caption-2 text-text-tertiary">
                {t('mapEditor.routePlanning.addStop')}
              </label>
              <div className="flex gap-1">
                <div ref={pickerRef} className="relative min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-left text-body-xs text-text-primary hover:border-status-warning-light focus:border-status-warning-light focus:outline-none"
                  >
                    <span
                      className={
                        selectedStationLabel ? 'truncate' : 'truncate text-text-quaternary'
                      }
                    >
                      {selectedStationLabel ??
                        (selectableStations.length === 0
                          ? t('mapEditor.routePlanning.allStopsAdded')
                          : t('mapEditor.routePlanning.selectStop'))}
                    </span>
                    <ChevronDown
                      className={[
                        'size-3.5 shrink-0 text-text-quaternary transition',
                        pickerOpen ? 'rotate-180' : '',
                      ].join(' ')}
                    />
                  </button>
                  {pickerOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-52 overflow-y-auto rounded-md border border-border-tertiary bg-surface-sub-background py-1 shadow-xl [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
                      {selectableStations.length > 0 ? (
                        <>
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.docking')}
                            titleClassName="text-text-theme"
                            options={selectableGroups.docking}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.facilityDocking')}
                            titleClassName="text-status-warning"
                            options={selectableGroups.facilityDocking}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.waypoint')}
                            titleClassName="text-status-success"
                            options={selectableGroups.waypoint}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.crossWaypoint')}
                            titleClassName="text-status-success"
                            options={selectableGroups.crossWaypoint}
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                        </>
                      ) : null}
                      {disabledStations.length > 0 ? (
                        <div className="border-t border-border-quaternary pt-1">
                          <p className="px-2 py-1 text-caption-2 uppercase text-text-disabled">
                            {t('mapEditor.routePlanning.cannotConnect')}
                          </p>
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.docking')}
                            titleClassName="text-text-disabled"
                            options={disabledGroups.docking}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.facilityDocking')}
                            titleClassName="text-text-disabled"
                            options={disabledGroups.facilityDocking}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.waypoint')}
                            titleClassName="text-text-disabled"
                            options={disabledGroups.waypoint}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                          <RouteAppendOptionGroup
                            title={t('mapEditor.routePlanning.crossWaypoint')}
                            titleClassName="text-text-disabled"
                            options={disabledGroups.crossWaypoint}
                            disabled
                            dropdownStationId={dropdownStationId}
                            onPick={pickStation}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <Button hierarchy="subordinate" variant="outlined" className="shrink-0" onPress={appendFromDropdown} disabled={!dropdownStationId}>{t('mapEditor.routePlanning.add')}</Button>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
            <p className="mb-1.5 text-caption-2 text-text-tertiary">
              {t('mapEditor.routePlanning.stationOrder', { count: draft.stationIds.length })}
            </p>
            {draft.stationIds.length === 0 ? (
              <p className="rounded border border-dashed border-border-quaternary px-2 py-4 text-center text-caption-2 text-text-disabled">
                {t('mapEditor.routePlanning.noStations')}
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
                      <div className="flex items-center gap-1 rounded border border-border-quaternary bg-black-30 px-1.5 py-1">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-status-warning-light text-caption-2 text-status-warning">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption-2 text-text-primary">
                            {stationDisplayLabel(areas, stationId)}
                          </p>
                          <p className="truncate font-mono text-caption-2 text-text-quaternary">
                            {stationId}
                          </p>
                        </div>
                        {editMode ? (
                          <div className="flex shrink-0 flex-col">
                            <IconButton size="small" hierarchy="subordinate" variant="standard" title={t('mapEditor.routePlanning.moveUp')} disabled={index === 0} onPress={() => onMoveStation(index, index - 1)} label={t('mapEditor.routePlanning.moveUp')} icon={<ArrowUp />} />
                            <IconButton size="small" hierarchy="subordinate" variant="standard" title={t('mapEditor.routePlanning.moveDown')} disabled={index === draft.stationIds.length - 1} onPress={() => onMoveStation(index, index + 1)} label={t('mapEditor.routePlanning.moveDown')} icon={<ArrowDown />} />
                            <IconButton size="small" hierarchy="danger" variant="standard" title={t('mapEditor.routePlanning.remove')} onPress={() => onRemoveStationAt(index)} label={t('mapEditor.routePlanning.remove')} icon={<X />} />
                          </div>
                        ) : null}
                      </div>
                      {leg ? (
                        <div
                          className={[
                            'ml-6 rounded border px-2 py-1 text-caption-2',
                            leg.pathFound && leg.metricsComplete
                              ? 'border-border-quaternary bg-black-30 text-text-tertiary'
                              : 'border-status-warning-light bg-status-warning-light text-status-warning',
                          ].join(' ')}
                        >
                          → {stationDisplayLabel(areas, leg.toStationId)}
                          {' · '}
                          {formatTopologyLegSummary(leg)}
                          {leg.nodePath.length > 2 ? (
                            <span className="text-text-disabled">
                              {' '}
                              {t('mapEditor.routePlanning.viaWaypoints', {
                                count: leg.nodePath.length - 2,
                              })}
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
                  ? 'border-border-theme-light bg-gradient-to-b from-cyan-950/40 to-zinc-950/80'
                  : 'border-border-quaternary bg-zinc-950/70',
              ].join(' ')}
            >
              <div className="mb-2 flex items-center gap-1">
                <p className="text-caption-2 text-text-primary">
                  {t('mapEditor.routePlanning.topologySumTitle')}
                </p>
                <span className="group relative inline-flex">
                  <IconButton size="small" hierarchy="subordinate" variant="standard" label={t('mapEditor.routePlanning.travelTimeHelpAria')} icon={<Info />} />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden w-56 rounded-md border border-border-tertiary bg-surface-primary px-2.5 py-2 text-caption-2 text-text-primary shadow-xl group-hover:block group-focus-within:block"
                  >
                    <span className="block">{t('mapEditor.routePlanning.topologySumHint1')}</span>
                    <span className="mt-1 block text-text-tertiary">
                      {t('mapEditor.routePlanning.topologySumHint2')}
                    </span>
                    {topologyBreakdown?.totalDistanceMeters != null ? (
                      <span className="mt-1.5 block border-t border-border-quaternary pt-1.5 tabular-nums text-text-primary">
                        {t('mapEditor.routePlanning.distanceMeters', {
                          meters: topologyBreakdown.totalDistanceMeters,
                        })}
                      </span>
                    ) : (
                      <span className="mt-1.5 block border-t border-border-quaternary pt-1.5 text-text-quaternary">
                        {t('mapEditor.routePlanning.distanceIncomplete')}
                      </span>
                    )}
                    <span className="mt-1 block text-text-quaternary">
                      {t('mapEditor.routePlanning.fillTopologyHint')}
                    </span>
                  </span>
                </span>
              </div>

              {topologyBreakdown?.timesComplete ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-black-30 px-2.5 py-2">
                    <p className="text-caption-2 text-text-tertiary">{t('mapEditor.routePlanning.avgTime')}</p>
                    <p className="mt-0.5 text-body-m-bold tabular-nums text-text-primary">
                      {draft.avgTravelTimeSeconds}
                      <span className="ml-1 text-caption-2 font-normal text-text-tertiary">
                        {t('mapEditor.routePlanning.seconds')}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-md bg-black-30 px-2.5 py-2">
                    <p className="text-caption-2 text-text-tertiary">{t('mapEditor.routePlanning.minTime')}</p>
                    <p className="mt-0.5 text-body-m-bold tabular-nums text-text-primary">
                      {draft.minTravelTimeSeconds}
                      <span className="ml-1 text-caption-2 font-normal text-text-tertiary">
                        {t('mapEditor.routePlanning.seconds')}
                      </span>
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-caption-2 text-text-tertiary">
                  {!topologyBreakdown?.pathsComplete
                    ? t('mapEditor.routePlanning.noTopologyCombo')
                    : t('mapEditor.routePlanning.topologyIncompleteTimes')}
                </p>
              )}

              {topologyBreakdown?.timesComplete
                && topologyBreakdown.totalDistanceMeters != null ? (
                <p className="mt-2 text-caption-2 tabular-nums text-text-tertiary">
                  {t('mapEditor.routePlanning.distanceShort', {
                    meters: topologyBreakdown.totalDistanceMeters,
                  })}
                </p>
              ) : null}

              {travelTimeInvalid ? (
                <p className="mt-1.5 text-caption-2 text-status-error-emphasis">
                  {t('mapEditor.routePlanning.timeInvalid')}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="shrink-0 rounded-lg border border-dashed border-border-quaternary px-3 py-2.5 text-center text-caption-2 text-text-quaternary">
              {t('mapEditor.routePlanning.needTwoStops')}
            </p>
          )}

          {editMode ? (
            <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border-quaternary pt-2">
              <Button hierarchy="subordinate" variant="outlined" className="flex-1" leadingIcon={<Save />} onPress={onSaveDraft} disabled={!canSave}>{t('mapEditor.routePlanning.saveRoute')}</Button>
              <Button hierarchy="subordinate" variant="outlined" onPress={onCancelDraft}>{t('mapEditor.routePlanning.backToListShort')}</Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
