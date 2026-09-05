import { Building2, ChevronLeft, DoorOpen, GitBranch, LayoutGrid, MapPin, Network, Radio, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute, MapRouteGroup } from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import type { PaletteItem } from '../constants/palette'
import { AssetPaletteBar } from './AssetPaletteBar'
import { RoutePlanningPanel } from './RoutePlanningPanel'
import type { RouteGroupDraft } from './RouteGroupEditorView'
import {
  collectDockingPointEntries,
  collectEquipmentEntries,
  collectFacilityDockingPointEntries,
  collectFacilityEntries,
  type FacilityListEntry,
} from '../utils/facilityListEntries'
import type { RoutePlanningDraft } from '../utils/routePlanning'
export type MapListDrawerTab = 'docking' | 'facility' | 'equipment' | 'routes' | 'palette' | null

type Props = {
  areas: MapAreaObject[]
  openTab: MapListDrawerTab
  onOpenTab: (tab: MapListDrawerTab) => void
  selectedAreaId: string | null
  selectedFacilityId: string | null
  onSelectEntry: (areaId: string, facilityId: string) => void
  onEntryDoubleClick: (areaId: string, facilityId: string) => void
  mapRoutes: MapPlannedRoute[]
  mapRouteGroups: MapRouteGroup[]
  mapEditMode: boolean
  routePlanningDraft: RoutePlanningDraft | null
  routeGroupDraft: RouteGroupDraft | null
  visibleRouteIds: ReadonlySet<string>
  routePickMode: boolean
  onStartNewRoute: (groupId: string | null) => void
  onStartNewGroup: () => void
  onEditRoute: (routeId: string) => void
  onEditGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onToggleRouteVisibility: (routeId: string) => void
  onToggleGroupRouteVisibility: (routeIds: string[]) => void
  onCancelRouteDraft: () => void
  onCancelGroupDraft: () => void
  onSaveRouteDraft: () => void
  onSaveGroupDraft: () => void
  onDeleteRoute: (routeId: string) => void
  onDraftRouteNameChange: (name: string) => void
  onDraftRouteAvgTravelTimeChange: (seconds: number | null) => void
  onDraftRouteMinTravelTimeChange: (seconds: number | null) => void
  onGroupDraftNameChange: (name: string) => void
  onRemoveRouteStationAt: (index: number) => void
  onMoveRouteStation: (from: number, to: number) => void
  onAppendRouteStation: (stationId: string) => void
  onOpenPointTopology?: () => void
  pointTopology: PointTopology
  /** 編輯模式下從元件庫加入資產 */
  onPickPaletteItem?: (item: PaletteItem) => void
}

function formatRef(entry: FacilityListEntry): string {
  return entry.refFieldText || '—'
}

function formatPx(entry: FacilityListEntry): string {
  return `${entry.pxX.toFixed(1)}, ${entry.pxY.toFixed(1)} px`
}

function formatListDescription(entry: FacilityListEntry): string {
  if (entry.purpose && entry.purpose !== entry.name) {
    return `${entry.areaName} · ${entry.purpose}`
  }
  return entry.areaName
}

function ListRow({
  entry,
  selected,
  onSelect,
  onDoubleClickOpen,
}: {
  entry: FacilityListEntry
  selected: boolean
  onSelect: () => void
  onDoubleClickOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault()
        onDoubleClickOpen()
      }}
      className={[
        'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-cyan-500/70 bg-cyan-500/10'
          : 'border-zinc-700/80 bg-zinc-950/40 hover:border-zinc-500 hover:bg-zinc-900/80',
      ].join(' ')}
    >
      <p className="truncate text-[11px] font-medium text-zinc-100">{entry.name}</p>
      <p className="mt-0.5 truncate text-[10px] text-zinc-500">
        {formatListDescription(entry)}
      </p>
      <div className="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[10px] text-zinc-400">
        <span>{t('mapEditor.listDrawer.field', { value: formatRef(entry) })}</span>
        <span>{t('mapEditor.listDrawer.pixels', { value: formatPx(entry) })}</span>
      </div>
    </button>
  )
}

function SectionBlock({
  title,
  entries,
  selectedAreaId,
  selectedFacilityId,
  onSelectEntry,
  onEntryDoubleClick,
}: {
  title: string
  entries: FacilityListEntry[]
  selectedAreaId: string | null
  selectedFacilityId: string | null
  onSelectEntry: (areaId: string, facilityId: string) => void
  onEntryDoubleClick: (areaId: string, facilityId: string) => void
}) {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-700/70 px-2 py-3 text-center text-[10px] text-zinc-600">
        {t('mapEditor.listDrawer.emptySection', { title })}
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      {entries.map((entry) => (
        <ListRow
          key={`${entry.areaId}:${entry.facilityId}:${entry.refFieldKey}:${entry.pxX.toFixed(2)}:${entry.pxY.toFixed(2)}:${entry.purpose}`}
          entry={entry}
          selected={
            selectedAreaId === entry.areaId &&
            selectedFacilityId === entry.facilityId
          }
          onSelect={() => onSelectEntry(entry.areaId, entry.facilityId)}
          onDoubleClickOpen={() =>
            onEntryDoubleClick(entry.areaId, entry.facilityId)
          }
        />
      ))}
    </div>
  )
}

const TAB_BUTTON_CLASS = {
  docking: {
    active: 'rounded-r-md border-cyan-500/60 bg-cyan-950/90 text-cyan-200',
    idle: 'rounded-r-md border-zinc-700/80 bg-zinc-900/95 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
  },
  facility: {
    active: 'rounded-r-md border-sky-500/60 bg-sky-950/90 text-sky-200',
    idle: 'rounded-r-md border-zinc-700/80 bg-zinc-900/95 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
  },
  equipment: {
    active: 'rounded-r-md border-violet-500/60 bg-violet-950/90 text-violet-200',
    idle: 'rounded-r-md border-zinc-700/80 bg-zinc-900/95 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
  },
  routes: {
    active: 'rounded-r-md border-amber-500/60 bg-amber-950/90 text-amber-200',
    idle: 'rounded-r-md border-zinc-700/80 bg-zinc-900/95 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
  },
  palette: {
    active: 'rounded-r-md border-cyan-500/60 bg-cyan-950/90 text-cyan-200',
    idle: 'rounded-r-md border-zinc-700/80 bg-zinc-900/95 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
  },
} as const

export function MapListDrawer({
  areas,
  openTab,
  onOpenTab,
  selectedAreaId,
  selectedFacilityId,
  onSelectEntry,
  onEntryDoubleClick,
  mapRoutes,
  mapRouteGroups,
  mapEditMode,
  routePlanningDraft,
  routeGroupDraft,
  visibleRouteIds,
  routePickMode,
  onStartNewRoute,
  onStartNewGroup,
  onEditRoute,
  onEditGroup,
  onDeleteGroup,
  onToggleRouteVisibility,
  onToggleGroupRouteVisibility,
  onCancelRouteDraft,
  onCancelGroupDraft,
  onSaveRouteDraft,
  onSaveGroupDraft,
  onDeleteRoute,
  onDraftRouteNameChange,
  onDraftRouteAvgTravelTimeChange,
  onDraftRouteMinTravelTimeChange,
  onGroupDraftNameChange,
  onRemoveRouteStationAt,
  onMoveRouteStation,
  onAppendRouteStation,
  onOpenPointTopology,
  pointTopology,
  onPickPaletteItem,
}: Props) {
  const { t } = useTranslation()
  const dockingEntries = useMemo(
    () => collectDockingPointEntries(areas),
    [areas],
  )
  const facilityDockingEntries = useMemo(
    () => collectFacilityDockingPointEntries(areas),
    [areas],
  )
  const facilityEntries = useMemo(
    () => collectFacilityEntries(areas),
    [areas],
  )
  const { signals: signalEntries, poles: poleEntries, psds: psdEntries } = useMemo(
    () => collectEquipmentEntries(areas),
    [areas],
  )
  const panelOpen = openTab !== null && openTab !== 'palette'
  const paletteOpen = openTab === 'palette'

  const panelTitle =
    openTab === 'docking'
      ? t('mapEditor.listDrawer.dockingList')
      : openTab === 'facility'
        ? t('mapEditor.listDrawer.facilityList')
        : openTab === 'routes'
          ? routePlanningDraft
            ? routePlanningDraft.routeId
              ? t('mapEditor.listDrawer.editRoute')
              : t('mapEditor.listDrawer.createRoute')
            : t('mapEditor.listDrawer.routeList')
          : t('mapEditor.listDrawer.equipmentList')

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-40 flex">
        {/* 僅按鈕可點；空白區不攔截，避免擋住其他左緣 UI */}
        <div
          className={[
            'pointer-events-none flex h-full flex-col items-stretch pt-16',
            // 抽屜開啟時底部留給整塊抽屜，避免雙把手重疊
            paletteOpen ? 'pb-24' : 'pb-3',
          ].join(' ')}
        >
          <button
            type="button"
            title={t('mapEditor.listDrawer.dockingList')}
            onClick={() => onOpenTab(openTab === 'docking' ? null : 'docking')}
            className={[
              'pointer-events-auto flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'docking' ? TAB_BUTTON_CLASS.docking.active : TAB_BUTTON_CLASS.docking.idle,
            ].join(' ')}
          >
            <MapPin className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.listDrawer.dockingList')}</span>
          </button>
          <button
            type="button"
            title={t('mapEditor.listDrawer.facilityList')}
            onClick={() => onOpenTab(openTab === 'facility' ? null : 'facility')}
            className={[
              'pointer-events-auto mt-2 flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'facility' ? TAB_BUTTON_CLASS.facility.active : TAB_BUTTON_CLASS.facility.idle,
            ].join(' ')}
          >
            <Building2 className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.listDrawer.facilityList')}</span>
          </button>
          <button
            type="button"
            title={t('mapEditor.listDrawer.equipmentList')}
            onClick={() => onOpenTab(openTab === 'equipment' ? null : 'equipment')}
            className={[
              'pointer-events-auto mt-2 flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'equipment' ? TAB_BUTTON_CLASS.equipment.active : TAB_BUTTON_CLASS.equipment.idle,
            ].join(' ')}
          >
            <Radio className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.listDrawer.equipmentList')}</span>
          </button>
          <button
            type="button"
            title={t('mapEditor.listDrawer.routeList')}
            onClick={() => onOpenTab(openTab === 'routes' ? null : 'routes')}
            className={[
              'pointer-events-auto mt-2 flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'routes' ? TAB_BUTTON_CLASS.routes.active : TAB_BUTTON_CLASS.routes.idle,
            ].join(' ')}
          >
            <GitBranch className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.listDrawer.routeList')}</span>
          </button>

          {onOpenPointTopology || (mapEditMode && onPickPaletteItem && !paletteOpen) ? (
            <div className="pointer-events-auto mt-auto flex flex-col">
              {onOpenPointTopology ? (
                <button
                  type="button"
                  title={t('mapEditor.listDrawer.topology')}
                  onClick={onOpenPointTopology}
                  className="flex w-11 flex-col items-center justify-center gap-1 border border-l-0 border-cyan-700/60 bg-cyan-950/80 py-3 text-[10px] font-medium text-cyan-100 shadow-lg backdrop-blur-sm transition hover:bg-cyan-900/90"
                >
                  <Network className="size-4 shrink-0" />
                  <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.listDrawer.topology')}</span>
                </button>
              ) : null}
              {mapEditMode && onPickPaletteItem && !paletteOpen ? (
                <button
                  type="button"
                  title={t('mapEditor.listDrawer.palette')}
                  onClick={() => onOpenTab('palette')}
                  className={[
                    'flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
                    onOpenPointTopology ? 'mt-2' : '',
                    TAB_BUTTON_CLASS.palette.idle,
                  ].join(' ')}
                >
                  <LayoutGrid className="size-4 shrink-0" />
                  <span style={{ writingMode: 'vertical-rl' }}>{t('mapEditor.listDrawer.palette')}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {panelOpen ? (
          <div className="pointer-events-auto flex h-full w-80 max-w-[min(20rem,100%)] flex-col overflow-hidden border-r border-zinc-700/80 bg-zinc-900/95 shadow-2xl backdrop-blur-sm">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-700/80 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                {panelTitle}
              </p>
              <button
                type="button"
                onClick={() => onOpenTab(null)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                title={t('mapEditor.listDrawer.collapse')}
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {openTab === 'routes' ? (
                <RoutePlanningPanel
                  areas={areas}
                  routeGroups={mapRouteGroups}
                  routes={mapRoutes}
                  pointTopology={pointTopology}
                  editMode={mapEditMode}
                  draft={routePlanningDraft}
                  groupDraft={routeGroupDraft}
                  visibleRouteIds={visibleRouteIds}
                  pickMode={routePickMode}
                  onStartNewRoute={onStartNewRoute}
                  onStartNewGroup={onStartNewGroup}
                  onEditRoute={onEditRoute}
                  onEditGroup={onEditGroup}
                  onDeleteGroup={onDeleteGroup}
                  onToggleRouteVisibility={onToggleRouteVisibility}
                  onToggleGroupRouteVisibility={onToggleGroupRouteVisibility}
                  onCancelDraft={onCancelRouteDraft}
                  onCancelGroupDraft={onCancelGroupDraft}
                  onSaveDraft={onSaveRouteDraft}
                  onSaveGroupDraft={onSaveGroupDraft}
                  onDeleteRoute={onDeleteRoute}
                  onDraftNameChange={onDraftRouteNameChange}
                  onDraftAvgTravelTimeChange={onDraftRouteAvgTravelTimeChange}
                  onDraftMinTravelTimeChange={onDraftRouteMinTravelTimeChange}
                  onGroupDraftNameChange={onGroupDraftNameChange}
                  onRemoveStationAt={onRemoveRouteStationAt}
                  onMoveStation={onMoveRouteStation}
                  onAppendStation={onAppendRouteStation}
                />
              ) : openTab === 'docking' ? (
                <div className="space-y-4">
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    {t('mapEditor.listDrawer.dockingHint')}
                  </p>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400/90">
                      <MapPin className="size-3.5" />
                      {t('mapEditor.listDrawer.docking')}
                    </h4>
                    <SectionBlock
                      title={t('mapEditor.listDrawer.docking')}
                      entries={dockingEntries}
                      selectedAreaId={selectedAreaId}
                      selectedFacilityId={selectedFacilityId}
                      onSelectEntry={onSelectEntry}
                      onEntryDoubleClick={onEntryDoubleClick}
                    />
                  </section>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
                      <MapPin className="size-3.5" />
                      {t('mapEditor.listDrawer.facilityDocking')}
                    </h4>
                    <SectionBlock
                      title={t('mapEditor.listDrawer.facilityDocking')}
                      entries={facilityDockingEntries}
                      selectedAreaId={selectedAreaId}
                      selectedFacilityId={selectedFacilityId}
                      onSelectEntry={onSelectEntry}
                      onEntryDoubleClick={onEntryDoubleClick}
                    />
                  </section>
                </div>
              ) : openTab === 'facility' ? (
                <div className="space-y-3">
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    {t('mapEditor.listDrawer.facilityHint')}
                  </p>
                  <SectionBlock
                    title={t('mapEditor.listDrawer.facility')}
                    entries={facilityEntries}
                    selectedAreaId={selectedAreaId}
                    selectedFacilityId={selectedFacilityId}
                    onSelectEntry={onSelectEntry}
                    onEntryDoubleClick={onEntryDoubleClick}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    {t('mapEditor.listDrawer.equipmentHint')}
                  </p>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                      <Radio className="size-3.5" />
                      {t('mapEditor.listDrawer.trafficLight')}
                    </h4>
                    <SectionBlock
                      title={t('mapEditor.listDrawer.trafficLight')}
                      entries={signalEntries}
                      selectedAreaId={selectedAreaId}
                      selectedFacilityId={selectedFacilityId}
                      onSelectEntry={onSelectEntry}
                      onEntryDoubleClick={onEntryDoubleClick}
                    />
                  </section>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
                      <Zap className="size-3.5" />
                      {t('mapEditor.listDrawer.smartPole')}
                    </h4>
                    <SectionBlock
                      title={t('mapEditor.listDrawer.smartPole')}
                      entries={poleEntries}
                      selectedAreaId={selectedAreaId}
                      selectedFacilityId={selectedFacilityId}
                      onSelectEntry={onSelectEntry}
                      onEntryDoubleClick={onEntryDoubleClick}
                    />
                  </section>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
                      <DoorOpen className="size-3.5" />
                      {t('mapEditor.listDrawer.psd')}
                    </h4>
                    <SectionBlock
                      title={t('mapEditor.listDrawer.psd')}
                      entries={psdEntries}
                      selectedAreaId={selectedAreaId}
                      selectedFacilityId={selectedFacilityId}
                      onSelectEntry={onSelectEntry}
                      onEntryDoubleClick={onEntryDoubleClick}
                    />
                  </section>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {paletteOpen && onPickPaletteItem ? (
        <AssetPaletteBar
          onPick={onPickPaletteItem}
          onToggle={() => onOpenTab(null)}
        />
      ) : null}
    </>
  )
}
