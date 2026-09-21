import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  Fence,
  MapPin,
  Network,
  Radio,
  Route as RouteIcon,
  Zap,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useMemo, useRef } from 'react'
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
  collectGeofenceEntries,
  collectWaypointEntries,
  type FacilityListEntry,
} from '../utils/facilityListEntries'
import type { RoutePlanningDraft } from '../utils/routePlanning'
export type MapListDrawerTab = 'docking' | 'facility' | 'equipment' | 'routes' | 'geofence' | 'palette' | null

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
  onEditSimRoutePath: (routeId: string) => void
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

/**
 * 左側欄：設計稿的側邊選單。
 * 外層留 8px；主面板 48 寬、1px 半透明框、圓角 12；分頁鈕 28 寬、圓角 8，選取時藍底白字（#2B7FFF），
 * 未選取灰字（#6A7282）；文字直排 14/18、字距 0.5。頂端是展開／收合清單的箭頭，底部是路網拓撲，
 * 主面板外的最底下是元件庫。
 */
// 直排每字 18px 高（設計稿：兩個字 36、四個字 72）：字級 14 + 字距 4
const TAB_TEXT_STYLE = { writingMode: 'vertical-rl', letterSpacing: '4px' } as const

function TabUnit({
  label,
  title,
  Icon,
  active,
  onClick,
}: {
  label: string
  title: string
  Icon: ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={[
        'pointer-events-auto flex w-7 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-2 text-[14px] leading-[18px] transition-colors',
        active
          ? 'bg-[#2B7FFF] font-medium text-white'
          : 'font-normal text-[#6A7282] hover:bg-white/10 hover:text-zinc-200',
      ].join(' ')}
    >
      <Icon className="size-4 shrink-0" />
      <span style={TAB_TEXT_STYLE}>{label}</span>
    </button>
  )
}

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
  onEditSimRoutePath,
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
  const waypointEntries = useMemo(() => collectWaypointEntries(areas), [areas])
  const facilityEntries = useMemo(
    () => collectFacilityEntries(areas),
    [areas],
  )
  const geofenceEntries = useMemo(() => collectGeofenceEntries(areas), [areas])
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
        : openTab === 'geofence'
          ? t('mapEditor.listDrawer.geofenceList')
          : openTab === 'routes'
          ? routePlanningDraft
            ? routePlanningDraft.routeId
              ? t('mapEditor.listDrawer.editRoute')
              : t('mapEditor.listDrawer.createRoute')
            : t('mapEditor.listDrawer.routeList')
          : t('mapEditor.listDrawer.equipmentList')

  /** 頂端箭頭：清單收著就打開上次看的（第一次是點位），開著就收起 */
  const lastTab = useRef<Exclude<MapListDrawerTab, 'palette' | null>>('docking')
  if (openTab && openTab !== 'palette') lastTab.current = openTab
  const toggleTab = (tab: Exclude<MapListDrawerTab, 'palette' | null>) =>
    onOpenTab(openTab === tab ? null : tab)

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-40 flex">
        {/* 僅按鈕與面板可點；空白區不攔截，避免擋住其他左緣 UI */}
        <div
          className={[
            'pointer-events-none flex h-full flex-col items-stretch gap-1 p-2 pt-16',
            // 抽屜開啟時底部留給整塊抽屜，避免雙把手重疊
            paletteOpen ? 'pb-24' : '',
          ].join(' ')}
        >
          <div className="pointer-events-auto flex w-12 min-h-0 flex-1 flex-col items-center gap-1 rounded-xl border border-[rgba(212,212,212,0.15)] bg-[rgba(212,212,216,0.1)] px-1.5 py-2 backdrop-blur-md">
            <button
              type="button"
              title={panelOpen ? t('mapEditor.listDrawer.collapse') : t('mapEditor.listDrawer.expand')}
              aria-label={panelOpen ? t('mapEditor.listDrawer.collapse') : t('mapEditor.listDrawer.expand')}
              onClick={() => onOpenTab(panelOpen ? null : lastTab.current)}
              className="flex size-[34px] shrink-0 items-center justify-center rounded-lg p-0.5 text-[#D1D5DC] transition-colors hover:bg-white/10"
            >
              {panelOpen ? <ChevronLeft className="size-6" /> : <ChevronRight className="size-6" />}
            </button>
            <div className="flex min-h-0 w-7 flex-1 flex-col gap-1 overflow-y-auto">
              <TabUnit
                label={t('mapEditor.listDrawer.tabDocking')}
                title={t('mapEditor.listDrawer.dockingList')}
                Icon={MapPin}
                active={openTab === 'docking'}
                onClick={() => toggleTab('docking')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabFacility')}
                title={t('mapEditor.listDrawer.facilityList')}
                Icon={ClipboardList}
                active={openTab === 'facility'}
                onClick={() => toggleTab('facility')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabEquipment')}
                title={t('mapEditor.listDrawer.equipmentList')}
                Icon={Radio}
                active={openTab === 'equipment'}
                onClick={() => toggleTab('equipment')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabRoutes')}
                title={t('mapEditor.listDrawer.routeList')}
                Icon={RouteIcon}
                active={openTab === 'routes'}
                onClick={() => toggleTab('routes')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabGeofence')}
                title={t('mapEditor.listDrawer.geofenceList')}
                Icon={Fence}
                active={openTab === 'geofence'}
                onClick={() => toggleTab('geofence')}
              />
            </div>
            {onOpenPointTopology ? (
              <TabUnit
                label={t('mapEditor.listDrawer.topology')}
                title={t('mapEditor.listDrawer.topology')}
                Icon={Network}
                active={false}
                onClick={onOpenPointTopology}
              />
            ) : null}
          </div>
          {mapEditMode && onPickPaletteItem && !paletteOpen ? (
            <button
              type="button"
              title={t('mapEditor.listDrawer.palette')}
              onClick={() => onOpenTab('palette')}
              className="pointer-events-auto flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-2 text-[14px] leading-[18px] text-[#6A7282] transition-colors hover:bg-white/10 hover:text-zinc-200"
            >
              <ChevronRight className="size-4 shrink-0" />
              <span style={TAB_TEXT_STYLE}>{t('mapEditor.listDrawer.palette')}</span>
            </button>
          ) : null}
        </div>

        {panelOpen ? (
          <div className="pointer-events-auto my-2 mr-2 mt-16 flex w-80 max-w-[min(20rem,100%)] flex-col overflow-hidden rounded-xl border border-[rgba(212,212,212,0.15)] bg-zinc-900/90 shadow-2xl backdrop-blur-md" style={{ height: 'calc(100% - 4.5rem)' }}>
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
                  onEditSimRoutePath={onEditSimRoutePath}
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
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
                      <MapPin className="size-3.5" />
                      {t('mapEditor.listDrawer.waypoint')}
                    </h4>
                    <SectionBlock
                      title={t('mapEditor.listDrawer.waypoint')}
                      entries={waypointEntries}
                      selectedAreaId={selectedAreaId}
                      selectedFacilityId={selectedFacilityId}
                      onSelectEntry={onSelectEntry}
                      onEntryDoubleClick={onEntryDoubleClick}
                    />
                  </section>
                </div>
              ) : openTab === 'geofence' ? (
                <div className="space-y-3">
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    {t('mapEditor.listDrawer.geofenceHint')}
                  </p>
                  <SectionBlock
                    title={t('mapEditor.listDrawer.geofence')}
                    entries={geofenceEntries}
                    selectedAreaId={selectedAreaId}
                    selectedFacilityId={selectedFacilityId}
                    onSelectEntry={onSelectEntry}
                    onEntryDoubleClick={onEntryDoubleClick}
                  />
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
