import { Building2, ChevronLeft, GitBranch, LayoutGrid, MapPin, Radio, Zap } from 'lucide-react'
import { useMemo } from 'react'
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
        <span>場域：{formatRef(entry)}</span>
        <span>像素：{formatPx(entry)}</span>
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
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-700/70 px-2 py-3 text-center text-[10px] text-zinc-600">
        此圖台尚無{title}
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
  const dockingEntries = useMemo(
    () => collectDockingPointEntries(areas),
    [areas],
  )
  const facilityEntries = useMemo(
    () => collectFacilityEntries(areas),
    [areas],
  )
  const { signals: signalEntries, poles: poleEntries } = useMemo(
    () => collectEquipmentEntries(areas),
    [areas],
  )
  const panelOpen = openTab !== null && openTab !== 'palette'
  const paletteOpen = openTab === 'palette'

  const panelTitle =
    openTab === 'docking'
      ? '點位清單'
      : openTab === 'facility'
        ? '設施清單'
        : openTab === 'routes'
          ? routePlanningDraft
            ? routePlanningDraft.routeId
              ? '編輯路線'
              : '製作路線'
            : '路線清單'
          : '設備清單'

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
            title="點位清單"
            onClick={() => onOpenTab(openTab === 'docking' ? null : 'docking')}
            className={[
              'pointer-events-auto flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'docking' ? TAB_BUTTON_CLASS.docking.active : TAB_BUTTON_CLASS.docking.idle,
            ].join(' ')}
          >
            <MapPin className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>點位清單</span>
          </button>
          <button
            type="button"
            title="設施清單"
            onClick={() => onOpenTab(openTab === 'facility' ? null : 'facility')}
            className={[
              'pointer-events-auto mt-2 flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'facility' ? TAB_BUTTON_CLASS.facility.active : TAB_BUTTON_CLASS.facility.idle,
            ].join(' ')}
          >
            <Building2 className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>設施清單</span>
          </button>
          <button
            type="button"
            title="設備清單"
            onClick={() => onOpenTab(openTab === 'equipment' ? null : 'equipment')}
            className={[
              'pointer-events-auto mt-2 flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'equipment' ? TAB_BUTTON_CLASS.equipment.active : TAB_BUTTON_CLASS.equipment.idle,
            ].join(' ')}
          >
            <Radio className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>設備清單</span>
          </button>
          <button
            type="button"
            title="路線清單"
            onClick={() => onOpenTab(openTab === 'routes' ? null : 'routes')}
            className={[
              'pointer-events-auto mt-2 flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
              openTab === 'routes' ? TAB_BUTTON_CLASS.routes.active : TAB_BUTTON_CLASS.routes.idle,
            ].join(' ')}
          >
            <GitBranch className="size-4 shrink-0" />
            <span style={{ writingMode: 'vertical-rl' }}>路線清單</span>
          </button>

          {mapEditMode && onPickPaletteItem && !paletteOpen ? (
            <button
              type="button"
              title="元件庫"
              onClick={() => onOpenTab('palette')}
              className={[
                'pointer-events-auto mt-auto flex w-11 flex-col items-center justify-center gap-1 border border-l-0 py-3 text-[10px] font-medium shadow-lg backdrop-blur-sm transition',
                TAB_BUTTON_CLASS.palette.idle,
              ].join(' ')}
            >
              <LayoutGrid className="size-4 shrink-0" />
              <span style={{ writingMode: 'vertical-rl' }}>元件庫</span>
            </button>
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
                title="收合清單"
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
                <div className="space-y-3">
                  {onOpenPointTopology ? (
                    <button
                      type="button"
                      onClick={onOpenPointTopology}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-600/70 bg-cyan-950/50 px-3 py-2 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-900/70"
                    >
                      <GitBranch className="size-3.5 shrink-0" />
                      編輯點位拓撲
                    </button>
                  ) : null}
                  <SectionBlock
                    title="停靠點"
                    entries={dockingEntries}
                    selectedAreaId={selectedAreaId}
                    selectedFacilityId={selectedFacilityId}
                    onSelectEntry={onSelectEntry}
                    onEntryDoubleClick={onEntryDoubleClick}
                  />
                </div>
              ) : openTab === 'facility' ? (
                <SectionBlock
                  title="設施"
                  entries={facilityEntries}
                  selectedAreaId={selectedAreaId}
                  selectedFacilityId={selectedFacilityId}
                  onSelectEntry={onSelectEntry}
                  onEntryDoubleClick={onEntryDoubleClick}
                />
              ) : (
                <div className="space-y-4">
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                      <Radio className="size-3.5" />
                      紅綠燈（Signal）
                    </h4>
                    <SectionBlock
                      title="紅綠燈"
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
                      智慧桿
                    </h4>
                    <SectionBlock
                      title="智慧桿"
                      entries={poleEntries}
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
