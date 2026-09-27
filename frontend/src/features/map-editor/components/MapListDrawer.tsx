import { DoorOpen, Fence, MapPin, Radio, Zap } from 'lucide-react'
import type { ComponentType } from 'react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute, MapRouteGroup } from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import type { PaletteItem } from '../constants/palette'
import { AssetPaletteBar } from './AssetPaletteBar'
import { KeyboardArrowLeft, KeyboardArrowRight } from './MaterialSymbols'
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
  return `${entry.pxX.toFixed(1)} px , ${entry.pxY.toFixed(1)} px`
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
        'flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-[#51A2FF]/70 bg-[rgba(43,127,255,0.12)]'
          : 'border-[rgba(212,212,212,0.15)] bg-[rgba(142,197,255,0.04)] hover:border-[rgba(212,212,212,0.3)] hover:bg-[rgba(142,197,255,0.08)]',
      ].join(' ')}
    >
      <p className="w-full truncate text-sm font-medium leading-[18px] tracking-[0.5px] text-[#F3F4F6]">
        {entry.name}
      </p>
      <p className="w-full truncate text-xs leading-4 text-[#99A1AF]">
        {formatListDescription(entry)}
      </p>
      <p className="w-full truncate text-xs leading-4 text-[#D1D5DC]">
        {t('mapEditor.listDrawer.field', { value: formatRef(entry) })}
      </p>
      <p className="w-full truncate text-xs leading-4 text-[#D1D5DC]">
        {t('mapEditor.listDrawer.pixels', { value: formatPx(entry) })}
      </p>
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
      <p className="rounded-xl border border-dashed border-[rgba(212,212,212,0.15)] px-2 py-3 text-center text-xs text-[#6A7282]">
        {t('mapEditor.listDrawer.emptySection', { title })}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
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
/**
 * 側欄分頁圖示：設計稿給的 SVG（public/map-editor-icons/drawer-icons）。
 * 圖檔本身寫死灰色，選取時要變白——用 CSS mask 把圖形當遮罩、底色吃 currentColor，
 * 顏色就跟著分頁的文字色走。
 */
function drawerIcon(file: string) {
  const url = `url(/map-editor-icons/drawer-icons/${file})`
  return function DrawerIcon({ className }: { className?: string }) {
    return (
      <span
        aria-hidden
        className={`inline-block bg-current ${className ?? ''}`}
        style={{
          maskImage: url,
          WebkitMaskImage: url,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
    )
  }
}

const PointsIcon = drawerIcon('points.svg')
const FacilitiesIcon = drawerIcon('facilities.svg')
const EquipmentsIcon = drawerIcon('equipments.svg')
const RoutesIcon = drawerIcon('routes.svg')
const RouteTopologyIcon = drawerIcon('route-topology.svg')

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

  const PanelIcon =
    openTab === 'docking'
      ? PointsIcon
      : openTab === 'facility'
        ? FacilitiesIcon
        : openTab === 'routes'
          ? RoutesIcon
          : openTab === 'geofence'
            ? Fence
            : EquipmentsIcon

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
            'pointer-events-none flex h-full flex-col items-stretch gap-1 p-2',
            // 抽屜開啟時底部留給整塊抽屜，避免雙把手重疊
            // 元件庫高 105（見 AssetPaletteBar）＋ 8 間距
            paletteOpen ? 'pb-[113px]' : '',
          ].join(' ')}
        >
          {/* 設計稿 rgba(212,212,216,0.1) 是放在黑底上（≈#151516）；這裡疊在地圖上，用等值實色才不會透出軌道 */}
          <div className="pointer-events-auto flex w-12 min-h-0 flex-1 flex-col items-center gap-1 rounded-xl border border-[rgba(212,212,212,0.15)] bg-[#151516] px-1.5 py-2">
            <button
              type="button"
              title={panelOpen ? t('mapEditor.listDrawer.collapse') : t('mapEditor.listDrawer.expand')}
              aria-label={panelOpen ? t('mapEditor.listDrawer.collapse') : t('mapEditor.listDrawer.expand')}
              onClick={() => onOpenTab(panelOpen ? null : lastTab.current)}
              className="flex size-[34px] shrink-0 items-center justify-center rounded-lg p-0.5 text-[#D1D5DC] transition-colors hover:bg-white/10"
            >
              {panelOpen ? <KeyboardArrowLeft className="size-6" /> : <KeyboardArrowRight className="size-6" />}
            </button>
            <div className="flex min-h-0 w-7 flex-1 flex-col gap-1 overflow-y-auto">
              <TabUnit
                label={t('mapEditor.listDrawer.tabDocking')}
                title={t('mapEditor.listDrawer.dockingList')}
                Icon={PointsIcon}
                active={openTab === 'docking'}
                onClick={() => toggleTab('docking')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabFacility')}
                title={t('mapEditor.listDrawer.facilityList')}
                Icon={FacilitiesIcon}
                active={openTab === 'facility'}
                onClick={() => toggleTab('facility')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabEquipment')}
                title={t('mapEditor.listDrawer.equipmentList')}
                Icon={EquipmentsIcon}
                active={openTab === 'equipment'}
                onClick={() => toggleTab('equipment')}
              />
              <TabUnit
                label={t('mapEditor.listDrawer.tabRoutes')}
                title={t('mapEditor.listDrawer.routeList')}
                Icon={RoutesIcon}
                active={openTab === 'routes'}
                onClick={() => toggleTab('routes')}
              />
              {/*
                圍籬有自己的頁面（場域管理模組 → 虛擬圍籬管理），設計稿這裡不放圍籬分頁。
                清單內容（openTab === 'geofence'）保留，其他地方仍可直接打開。
              */}
            </div>
            {onOpenPointTopology ? (
              <TabUnit
                label={t('mapEditor.listDrawer.topology')}
                title={t('mapEditor.listDrawer.topology')}
                Icon={RouteTopologyIcon}
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
              className="pointer-events-auto flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-[rgba(212,212,212,0.15)] bg-[#151516] px-1.5 py-2 text-[14px] leading-[18px] tracking-[0.5px] text-[#6A7282] transition-colors hover:text-[#D1D5DC]"
            >
              <KeyboardArrowRight className="size-4 shrink-0" />
              <span style={TAB_TEXT_STYLE}>{t('mapEditor.listDrawer.palette')}</span>
            </button>
          ) : null}
        </div>

        {panelOpen ? (
          <div className={`pointer-events-auto my-2 mr-2 flex w-60 flex-col ${paletteOpen ? '!mb-[113px]' : ''} gap-3 overflow-hidden rounded-xl border border-[rgba(212,212,212,0.15)] bg-[#151516] px-2 py-3 shadow-2xl`}>
            <div className="flex shrink-0 items-center gap-1 px-2">
              <PanelIcon className="size-4 shrink-0 text-[#99A1AF]" aria-hidden />
              <p className="truncate text-sm leading-[18px] tracking-[0.5px] text-[#F3F4F6]">
                {panelTitle}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
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
                <div className="flex flex-col gap-4">
                  <p className="px-1 text-xs leading-4 text-[#6A7282]">
                    {t('mapEditor.listDrawer.dockingHint')}
                  </p>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium tracking-[0.5px] text-blue-400/90">
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
                    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium tracking-[0.5px] text-emerald-400/90">
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
                    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium tracking-[0.5px] text-sky-400/90">
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
                <div className="flex flex-col gap-3">
                  <p className="px-1 text-xs leading-4 text-[#6A7282]">
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
                <div className="flex flex-col gap-3">
                  <p className="px-1 text-xs leading-4 text-[#6A7282]">
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
                <div className="flex flex-col gap-4">
                  <p className="px-1 text-xs leading-4 text-[#6A7282]">
                    {t('mapEditor.listDrawer.equipmentHint')}
                  </p>
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium tracking-[0.5px] text-amber-400/90">
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
                    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium tracking-[0.5px] text-emerald-400/90">
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
                    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium tracking-[0.5px] text-sky-400/90">
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
