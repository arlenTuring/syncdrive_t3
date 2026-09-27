import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { MapEditorToolbar } from './components/MapEditorToolbar'
import { MapLibraryPage } from './components/MapLibraryPage'
import { Inspector } from './components/Inspector'
import { TrajectoryPanel } from './components/TrajectoryPanel'
import { LeaveEditConfirmDialog } from './components/LeaveEditConfirmDialog'
import { PointTopologyEditorDialog } from './components/PointTopologyEditorDialog'
import { MapAreaCanvas } from './components/MapAreaCanvas'
import { MapListDrawer, type MapListDrawerTab } from './components/MapListDrawer'
import { SetPrimaryMapDialog } from './components/SetPrimaryMapDialog'
import { RoutePlanningOverlay, routeColorForIndex } from './components/RoutePlanningOverlay'
import {
  SimRoutePathOverlay,
  type EditPoint,
} from './components/SimRoutePathOverlay'
import { MapCanvas } from './components/MapCanvas'
import { useRebuildStaleTracksAfterMove } from './hooks/useRebuildStaleTracksAfterMove'
import { diagnoseTracks } from './utils/trackDiagnostics'
import { TrackDiagnosticsPanel } from './components/TrackDiagnosticsPanel'
import { TrajectoryZoomBar } from './components/TrajectoryZoomBar'
import {
  getLatestTrajectoryEntry,
  getTrajectoryCatalogForVehicle,
  type VehicleTrajectoryEntry,
} from './constants/vehicleTrajectoryCatalog'
import {
  defaultAreaSizePxForDrop,
  defaultMapChromeSizePxForDrop,
  MIN_FACILITY_CANVAS_PX,
} from './constants/facilityDimensions'
import {
  clampMapZoomFactor,
  viewportScalesFromZoomFactors,
} from './constants/map'
import {
  defaultMapExtentMeters,
  mapWorldSizeFromExtent,
  type MapExtentMeters,
} from './constants/mapExtent'
import { MapExtentProvider } from './context/MapExtentContext'
import { AreaInspectorSection } from './components/AreaInspectorSection'
import { BasemapInspectorSection } from './components/BasemapInspectorSection'
import { TrackGenInspectorSection } from './components/TrackGenInspectorSection'
import { MapCropInspectorSection } from './components/MapCropInspectorSection'
import {
  applyMapCrop,
  clampCropRect,
  createCropWorkspace,
  type MapCropRect,
  type MapCropWorkspace,
} from './utils/mapCropMode'
import {
  getDefaultSlotEquipmentState,
  getDefaultSlotOccupancy,
  getDefaultStateForType,
} from './constants/states'
import { useMapHistory } from './hooks/useMapHistory'
import type {
  MapAreaLayout,
  MapAreaObject,
  MapPixelOrigin,
  MapPixelSize,
} from './types/area'
import {
  createBlankArea,
  DEFAULT_MAP_PIXEL_ORIGIN,
  DEFAULT_MAP_PIXEL_SIZE,
} from './types/area'
import { createBlankBasemap, type MapBasemapLayout, type MapBasemapObject } from './types/basemap'
import type { ParsedTrajectory } from './types/trajectoryFile'
import type {
  FacilityObject,
  GeofenceFacility,
  SlotEquipmentState,
  SlotFacility,
  SlotOccupancy,
} from './types/facility'
import { isTextEditingTarget, shouldBlockFacilityDeleteShortcut } from './utils/dom'
import {
  domainHeightM,
  domainWidthM,
  cssTopLeftToAreaPosition,
  normalizeAreaDomain,
  normalizeAreaView,
  type MapAreaPatch,
} from './utils/areaCoords'
import {
  ensureFacilityDualCoords,
  FACILITY_AREA_NUDGE_STEP_PX,
  facilityWithAreaPosition,
  fieldPositionFromArea,
  isAreaLayoutPureMove,
  nudgeFacilityInArea,
  syncAreaFacilitiesAreaCoordsAfterLayoutResize,
  syncAreaFacilitiesFieldCoords,
} from './utils/facilityAreaCoords'
import {
  resolveFacilityFocusPx,
} from './utils/facilityListEntries'
import { ensureDockingPointStationIdsInAreas, generateNextStationId } from './utils/dockingPointStationId'
import {
  applyAutoRefFieldPositionIfUnset,
  ensureAutoRefFieldPositionsInAreas,
  resyncAutoRefFieldPositionsInAreas,
  syncAutoRefFieldPositionFromPlacement,
} from './utils/facilityRefFieldAuto'
import {
  applyAutoRefFieldBoundsIfUnset,
  ensureAutoRefFieldBoundsInAreas,
} from './utils/facilityRefFieldBoundsAuto'
import {
  dropSharedTrackGenIdentityInAreas,
  facilityCopyWithoutTrackGenIdentity,
} from './utils/trackGenIdentity'
import { repairTrackRefFieldBoundsInAreas } from './utils/trackRefFieldBoundsRepair'
import { backfillTrackGenSpansInAreas } from './utils/trackGenSpanBackfill'
import {
  backfillTrackGenLatPerBoxInAreas,
  deriveShapedTrackPathsInAreas,
} from './utils/shapedTrackPaths'
import {
  auditFieldMapping,
  describeFieldMappingAudit,
} from './vehicles/auditFieldMapping'
import { auditMapData, describeMapDataIssues } from './utils/auditMapData'
import { getTrackGenPaths } from './utils/trackGenPaths'
import { cycleMapRulerDisplayMode } from './utils/mapRulerDisplay'
import { ensureWaypointCodesInAreas, generateNextWaypointCode, ensureWaypointCode } from './utils/waypointCode'
import { getDockingPointStationId } from './utils/dockingPointFacility'
import { canAppendStationToTopologyRoute, isTopologyRouteCombinationValid } from './utils/topologyRouteTravel'
import type { MapPlannedRoute, MapRouteGroup } from './types/mapFile'
import { emptyPointTopology, type PointTopology } from './types/pointTopology'
import {
  buildTopologyFacilityFingerprint,
  syncPointTopologyWithAreas,
} from './utils/pointTopology'
import {
  generateNextRouteId,
  isRoutePlanningDraftSavable,
  type RoutePlanningDraft,
} from './utils/routePlanning'
import {
  buildSimRouteSnapTargets,
  editPointsToPathWaypoints,
  isLegacyAutoPathWaypoints,
  isSimRoutePointOnField,
  startSimRouteEditPoints,
} from './utils/simRoutePathEdit'
import {
  assignRouteToGroup,
  ensureRouteGroupsForRoutes,
  findRouteGroupForRoute,
  generateNextRouteGroupId,
  removeRouteFromAllGroups,
} from './utils/routeGroupPlanning'
import type { RouteGroupDraft } from './components/RouteGroupEditorView'
import {
  MAP_PIXEL_ZOOM_DEFAULT_LEVEL,
} from './utils/mapPixelZoom'
import { isAreaPaletteItem, isBasemapPaletteItem, isTrackGenPaletteItem } from './utils/paletteDrag'
import {
  nextNumericIdFromAreas,
  type ParsedMapFile,
} from './utils/mapFileJson'
import {
  clearMapDraft,
} from './utils/mapDraftStorage'
import {
  DEFAULT_MAP_VERSION,
  entryToParsed,
  getMapLibraryEntry,
  hydrateMapLibraryFromBackend,
  readMapLibrary,
  saveEditorStateToLibraryEntry,
  upsertMapLibraryEntry,
  type MapLibraryEntry,
  writeMapLibrary,
} from './utils/mapLibraryStorage'
import {
  fetchMapLibraryBackendStatus,
  isMapLibraryEntryActive,
  publishMapLibraryEntryToBackend,
} from './api/mapLibraryApi'
import {
  type EditSessionSnapshot,
  isEditSessionDirty,
} from './utils/mapEditSession'
import {
  getStoredTrajectoryEntryId,
  setStoredTrajectoryEntryId,
} from './utils/vehicleTrajectoryPreference'
import { parseTrajectoryFileJson } from './utils/trajectoryFileJson'
import {
  preserveViewportWorldCenterOnScaleChange,
  scrollViewportToTrajectoryHead,
  scrollViewportToTrajectoryMeters,
} from './utils/mapViewport'
import type { MqttLiveEntry } from './live/mqttLiveTypes'
import type { PaletteItem } from './constants/palette'
import { syncGeofenceFacility } from './utils/geofence'
import { sanitizeFacilitiesForEditor } from './utils/sanitizeFacility'
import { normalizeDegrees } from './utils/rotation'
import { bakeShapedTrackRotation, isShapedTrackFacility } from './utils/shapedTrackRotation'
import { applyExampleMapDefaultLabelStyleToAreas } from './utils/facilityLabelStyle'
import {
  applyFacilityFormat,
  canApplyFacilityFormat,
  type FacilityFormatSnapshot,
} from './utils/facilityFormatPainter'
import { defaultRefFieldParametersForType } from './utils/facilityRefFieldBinding'
import {
  applyEntranceLinksToAreaFacilities,
  canBelongToParentZone,
  clampFacilityInsideParentZone,
  createFacilityAreaInsideZone,
  ensureZoneChildrenLocalFields,
  resyncZoneChildBoundsInAreas,
  dropDuplicateZoneBindingsInAreas,
  facilityCopyWithoutZoneBinding,
  isZoneEntrance,
  isZonePartition,
  PARENT_ZONE_ID_KEY,
  readParentZoneId,
  readZoneEntranceLinks,
  rematerializeZoneChildrenOntoZoneCanvas,
  sanitizeZoneParameters,
  syncZoneChildFieldFromPlacement,
  ZONE_ENTRANCE_LINKS_KEY,
  ZONE_LOCAL_FIELD_KEY,
  ZONE_PARTITION_ENTRANCE_ID_KEY,
  ZONE_PARTITION_LINK_ID_KEY,
  type ZoneEntranceLink,
} from './utils/zonePartition'
import { defaultRoadLineParameters } from './utils/roadLineFacility'
import {
  BASEMAP_ABOVE_AREAS_KEY,
  defaultBasemapParameters,
  isBasemapAboveAreas,
  partitionMapBasemaps,
} from './utils/basemapFacility'
import {
  defaultTrackGenParameters,
  getTrackGenAreaId,
  TRACKGEN_AREA_ID_KEY,
  isTrackGenComponent,
} from './utils/trackGenFacility'
import {
  CORNER_TRACK_KEY,
  DEFAULT_CORNER_TRACK,
  DEFAULT_TAPER_TRACK,
  TAPER_TRACK_KEY,
} from './utils/trackShapes'
import { buildFacilitiesFromLayout } from './utils/trackGenApply'
import { settleTrackJointsInAreas } from './utils/trackJoints'
import type { TrackGenGroup } from './utils/trackGenGroups'
import type { TrackGenLayout } from './utils/trackGenLayout'
import type { MapWorldBounds } from './utils/mapViewport'

type LoadedMapMeta = EditSessionSnapshot['loadedMapMeta']

type MapEditorScreen = 'library' | 'editor'

export type MapEditorAppProps = {
  workspace?: 'map' | 'trajectory'
  onBackToHome?: () => void
}

function worldBoundsFromExtent(extent: MapExtentMeters): MapWorldBounds {
  const { worldW, worldH } = mapWorldSizeFromExtent(extent)
  return { worldW, worldH }
}

const LS_TRAJECTORY_ZOOM_X = 'syncdrive_trajectory_zoom_factor_x'
const LS_TRAJECTORY_ZOOM_Y = 'syncdrive_trajectory_zoom_factor_y'
const LS_TRAJECTORY_ZOOM_LEGACY = 'syncdrive_trajectory_zoom_factor'
const LS_MAP_FACILITY_TOOLBARS_VISIBLE = 'syncdrive_map_facility_toolbars_visible'

function readStoredFacilityToolbarsVisible(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    const raw = localStorage.getItem(LS_MAP_FACILITY_TOOLBARS_VISIBLE)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* ignore */
  }
  return true
}

function readStoredAxisZoom(
  keyX: string,
  keyY: string,
  legacyKey: string,
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 1, y: 1 }
  try {
    const rawX = localStorage.getItem(keyX)
    const rawY = localStorage.getItem(keyY)
    if (rawX !== null && rawY !== null) {
      return {
        x: clampMapZoomFactor(parseFloat(rawX)),
        y: clampMapZoomFactor(parseFloat(rawY)),
      }
    }
    const legacy = localStorage.getItem(legacyKey)
    if (legacy !== null) {
      const v = clampMapZoomFactor(parseFloat(legacy))
      return { x: v, y: v }
    }
  } catch {
    /* fallthrough */
  }
  return { x: 1, y: 1 }
}

/** 地圖編輯器沒有即時資料來源（原本只有已移除的測試器 MQTT 模擬），固定傳空的 */
const NO_LIVE_ENTRIES: Record<string, MqttLiveEntry> = {}

export default function MapEditorApp({
  workspace = 'map',
  onBackToHome,
}: MapEditorAppProps) {
  const { t } = useTranslation()
  const isMapWorkspace = workspace === 'map'
  const isTrajectoryWorkspace = workspace === 'trajectory'
  const [areas, setAreas] = useState<MapAreaObject[]>([])
  const [basemaps, setBasemaps] = useState<MapBasemapObject[]>([])
  const [mapPixelSize, setMapPixelSize] = useState<MapPixelSize>(
    DEFAULT_MAP_PIXEL_SIZE,
  )
  const [mapPixelOrigin, setMapPixelOrigin] = useState<MapPixelOrigin>(
    DEFAULT_MAP_PIXEL_ORIGIN,
  )
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [selectedBasemapId, setSelectedBasemapId] = useState<string | null>(null)
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<string[]>([])
  const [geofenceSelectedLabelId, setGeofenceSelectedLabelId] = useState<
    string | null
  >(null)
  const [nextNumericId, setNextNumericId] = useState(1)
  /** Map 像素畫布縮放：1 近、7 遠（一屏看全圖） */
  const [mapZoomLevel, setMapZoomLevel] = useState(MAP_PIXEL_ZOOM_DEFAULT_LEVEL)
  const [showFacilityToolbars, setShowFacilityToolbars] = useState(
    readStoredFacilityToolbarsVisible,
  )
  const [showAreaCenterLabels, setShowAreaCenterLabels] = useState(false)
  /** 刻度帶：off → scale（Area domain）→ field（場域實際座標） */
  const [rulerDisplayMode, setRulerDisplayMode] = useState<
    'off' | 'scale' | 'field'
  >('off')
  /** 裁減模式：較大工作區 + 裁切框 */
  const [mapCropModeActive, setMapCropModeActive] = useState(false)
  const [cropWorkspace, setCropWorkspace] = useState<MapCropWorkspace | null>(null)
  /** 點選畫布空白：全選所有 Area，可整體拖曳平移 */
  const [allAreasSelected, setAllAreasSelected] = useState(false)
  const [clipboard, setClipboard] = useState<FacilityObject | null>(null)
  /** 格式複製器（單次貼上） */
  const [formatPaintSnapshot, setFormatPaintSnapshot] =
    useState<FacilityFormatSnapshot | null>(null)
  const [trajectoryViewportSize, setTrajectoryViewportSize] = useState({
    w: 800,
    h: 600,
  })
  /** 軌跡圖台仍使用舊 extent 縮放 */
  const [trajectoryZoomFactorX, setTrajectoryZoomFactorX] = useState(() =>
    readStoredAxisZoom(
      LS_TRAJECTORY_ZOOM_X,
      LS_TRAJECTORY_ZOOM_Y,
      LS_TRAJECTORY_ZOOM_LEGACY,
    ).x,
  )
  const [trajectoryZoomFactorY, setTrajectoryZoomFactorY] = useState(() =>
    readStoredAxisZoom(
      LS_TRAJECTORY_ZOOM_X,
      LS_TRAJECTORY_ZOOM_Y,
      LS_TRAJECTORY_ZOOM_LEGACY,
    ).y,
  )

  const [backendSyncFailed, setBackendSyncFailed] = useState(false)
  /** 正在重送（自動儲存送後端失敗後，使用者按重試） */
  const [retryingSync, setRetryingSync] = useState(false)
  /** 後端回報的「哪一張是主要地圖」：是的話自動儲存就等於直接改系統在讀的那一張 */
  const [primaryMapCheck, setPrimaryMapCheck] = useState<{ libraryId: string; primary: boolean } | null>(null)
  const [primaryDialogEntry, setPrimaryDialogEntry] = useState<MapLibraryEntry | null>(null)
  const [mapScreen, setMapScreen] = useState<MapEditorScreen>('library')
  const [mapExtentMeters] = useState<MapExtentMeters>(defaultMapExtentMeters)
  const [loadedMapMeta, setLoadedMapMeta] = useState<LoadedMapMeta>({
    libraryId: '',
    mapId: '',
    displayName: '',
    version: DEFAULT_MAP_VERSION,
    pixelSize: DEFAULT_MAP_PIXEL_SIZE,
    pixelOrigin: DEFAULT_MAP_PIXEL_ORIGIN,
  })

  const [mapEditorMode, setMapEditorMode] = useState<'view' | 'edit'>('view')
  const [editSessionBaseline, setEditSessionBaseline] =
    useState<EditSessionSnapshot | null>(null)
  const [leaveEditDialogOpen, setLeaveEditDialogOpen] = useState(false)
  const [leaveEditNavigateToLibrary, setLeaveEditNavigateToLibrary] =
    useState(false)
  const [autosaveStatus, setAutosaveStatus] = useState<
    'idle' | 'saving' | 'saved'
  >('idle')
  const [autosaveTimeLabel, setAutosaveTimeLabel] = useState('')

  /** 整備格編輯：圖台預覽（不寫入地圖檔直至「設為預設」） */
  const [slotPreview, setSlotPreview] = useState<{
    facilityId: string
    occupancy: SlotOccupancy
    equipment: SlotEquipmentState
  } | null>(null)

  const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
  const [listDrawerTab, setListDrawerTab] = useState<MapListDrawerTab>(null)
  const [mapRoutes, setMapRoutes] = useState<MapPlannedRoute[]>([])
  const [mapRouteGroups, setMapRouteGroups] = useState<MapRouteGroup[]>([])
  const [pointTopology, setPointTopology] = useState<PointTopology>(() =>
    emptyPointTopology(),
  )
  const [pointTopologyEditorOpen, setPointTopologyEditorOpen] = useState(false)
  /** 已載入路網的點位／設施被刪除或改名時，對帳刷新標籤並移除失效節點 */
  const topologyFacilityFingerprint = useMemo(
    () => buildTopologyFacilityFingerprint(areas),
    [areas],
  )
  useEffect(() => {
    setPointTopology((prev) => {
      const next = syncPointTopologyWithAreas(prev, areas)
      if (
        next.nodes.length === prev.nodes.length
        && next.edges.length === prev.edges.length
        && next.nodes.every((node, i) => {
          const p = prev.nodes[i]
          return (
            p != null
            && p.id === node.id
            && p.kind === node.kind
            && p.label === node.label
            && p.stationId === node.stationId
            && p.x === node.x
            && p.y === node.y
            && p.color === node.color
          )
        })
        && next.edges.every((edge, i) => {
          const p = prev.edges[i]
          return p != null && p.id === edge.id
        })
      ) {
        return prev
      }
      return next
    })
    // areas 經 fingerprint 閘控；此處讀最新 areas 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint 已涵蓋設施增刪／標籤
  }, [topologyFacilityFingerprint])
  const [routePlanningDraft, setRoutePlanningDraft] =
    useState<RoutePlanningDraft | null>(null)
  const [routeGroupDraft, setRouteGroupDraft] = useState<RouteGroupDraft | null>(
    null,
  )
  /** 模擬路線折點編輯中的路線 id；與站序草稿互斥 */
  const [simRouteEditRouteId, setSimRouteEditRouteId] = useState<string | null>(
    null,
  )
  const [simRouteEditPoints, setSimRouteEditPoints] = useState<EditPoint[]>([])
  const [visibleRouteIds, setVisibleRouteIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [facilityFocusTarget, setFacilityFocusTarget] = useState<{
    x: number
    y: number
    token: number
  } | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    null,
  )
  const [selectedTrajectoryEntryId, setSelectedTrajectoryEntryId] = useState<
    string | null
  >(null)
  const [trajectoryImportMode, setTrajectoryImportMode] = useState(false)
  const [loadedTrajectory, setLoadedTrajectory] =
    useState<ParsedTrajectory | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replayHeadIndex, setReplayHeadIndex] = useState<number | null>(null)
  const [trajectoryViewportCenterMeters, setTrajectoryViewportCenterMeters] =
    useState({
      x: 0,
      y: 0,
    })

  const mapViewportRef = useRef<HTMLDivElement>(null)
  const trajectoryViewportRef = useRef<HTMLDivElement>(null)
  const trajectoryScaleXRef = useRef(1)
  const trajectoryScaleYRef = useRef(1)
  const areasRef = useRef(areas)
  const basemapsRef = useRef(basemaps)
  const mapRoutesRef = useRef(mapRoutes)
  const mapRouteGroupsRef = useRef(mapRouteGroups)
  const pointTopologyRef = useRef(pointTopology)
  const selectedAreaIdRef = useRef(selectedAreaId)
  const selectedBasemapIdRef = useRef(selectedBasemapId)
  const selectedFacilityIdsRef = useRef(selectedFacilityIds)
  const multiDragStartRef = useRef<{
    areaId: string
    areaPositions: Record<string, { x: number; y: number }>
  } | null>(null)
  const clipboardRef = useRef<FacilityObject | null>(null)
  const inspectorEditPushedRef = useRef(false)
  const trajectoryLoadSeqRef = useRef(0)
  const loadedMapMetaRef = useRef(loadedMapMeta)
  const mapPixelSizeRef = useRef(mapPixelSize)
  const mapPixelOriginRef = useRef(mapPixelOrigin)
  const mapExtentMetersRef = useRef(mapExtentMeters)
  const mapEditorModeRef = useRef(mapEditorMode)
  const pointTopologyEditorOpenRef = useRef(pointTopologyEditorOpen)
  const workspaceRef = useRef(workspace)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredFacilityRef = useRef<{
    areaId: string
    facilityId: string
  } | null>(null)

  loadedMapMetaRef.current = loadedMapMeta
  mapPixelSizeRef.current = mapPixelSize
  mapPixelOriginRef.current = mapPixelOrigin
  mapExtentMetersRef.current = mapExtentMeters
  mapEditorModeRef.current = mapEditorMode
  pointTopologyEditorOpenRef.current = pointTopologyEditorOpen
  workspaceRef.current = workspace

  useEffect(() => {
    areasRef.current = areas
    basemapsRef.current = basemaps
    mapRoutesRef.current = mapRoutes
    mapRouteGroupsRef.current = mapRouteGroups
    pointTopologyRef.current = pointTopology
    selectedAreaIdRef.current = selectedAreaId
    selectedBasemapIdRef.current = selectedBasemapId
    selectedFacilityIdsRef.current = selectedFacilityIds
    clipboardRef.current = clipboard
  }, [areas, basemaps, mapRoutes, mapRouteGroups, pointTopology, selectedAreaId, selectedBasemapId, selectedFacilityIds, clipboard])

  const updateSelection = useCallback(
    (areaId: string | null, facilityIds: string[] | null) => {
      const ids = facilityIds ?? []
      selectedAreaIdRef.current = areaId
      selectedFacilityIdsRef.current = ids
      setSelectedAreaId(areaId)
      setSelectedFacilityIds(ids)
    },
    [],
  )

  const clearMapSelection = useCallback(() => {
    selectedBasemapIdRef.current = null
    setSelectedBasemapId(null)
    updateSelection(null, null)
  }, [updateSelection])

  const clearSelection = useCallback(() => {
    clearMapSelection()
  }, [clearMapSelection])

  // 軌道複製、移動之後兩端接不上隔壁，就依鄰居重建它的中心線
  useRebuildStaleTracksAfterMove(areas, mapEditorMode === 'edit', setAreas)

  /*
   * 軌道檢查：整張圖的軌道圖面位置與現場座標對不對得上。拖曳時 areas 每一幀都在變，延後到
   * 空閒時再算，不拖慢畫面。
   */
  const deferredAreasForCheck = useDeferredValue(areas)
  const trackDiagnostics = useMemo(
    () => diagnoseTracks(deferredAreasForCheck),
    [deferredAreasForCheck],
  )
  const [trackIssuesOpen, setTrackIssuesOpen] = useState(false)
  const trackDiagnosticsForCanvas = useMemo(
    () => ({ statusById: trackDiagnostics.statusByFacility }),
    [trackDiagnostics],
  )

  /** 設施列表變動後，清除已不存在的選取 */
  useEffect(() => {
    if (selectedAreaId === null) return
    const area = areas.find((a) => a.id === selectedAreaId)
    if (!area) {
      clearSelection()
      return
    }
    if (selectedFacilityIds.length === 0) return
    const remaining = selectedFacilityIds.filter((id) =>
      area.facilities.some((f) => f.id === id),
    )
    if (remaining.length === selectedFacilityIds.length) return
    updateSelection(selectedAreaId, remaining)
  }, [areas, selectedAreaId, selectedFacilityIds, clearSelection, updateSelection])

  /** 取消選取時收合屬性面板；單擊選取不自動展開（需雙擊元件） */
  useEffect(() => {
    if (!isMapWorkspace) return
    if (
      selectedAreaId === null &&
      selectedFacilityIds.length === 0 &&
      selectedBasemapId === null
    ) {
      setInspectorCollapsed(true)
    }
  }, [selectedAreaId, selectedFacilityIds, selectedBasemapId, isMapWorkspace])

  useEffect(() => {
    setSlotPreview(null)
  }, [selectedAreaId, selectedFacilityIds, mapEditorMode])

  /** 修正過小自訂尺寸造成的「鬼元件」（不寫入 undo 歷史） */
  useEffect(() => {
    if (mapEditorMode !== 'edit') return
    setAreas((prev) => {
      const next = prev.map((a) => ({
        ...a,
        facilities: sanitizeFacilitiesForEditor(a.facilities),
      }))
      const changed = next.some(
        (a, i) => a.facilities !== prev[i]?.facilities,
      )
      return changed ? next : prev
    })
  }, [mapEditorMode])

  useEffect(() => {
    inspectorEditPushedRef.current = false
  }, [selectedFacilityIds, selectedAreaId])

  const primarySelectedFacilityId = useMemo(
    () => selectedFacilityIds[selectedFacilityIds.length - 1] ?? null,
    [selectedFacilityIds],
  )

  useEffect(() => {
    const el = trajectoryViewportRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      setTrajectoryViewportSize({ w: cr.width, h: cr.height })
    })
    ro.observe(el)
    setTrajectoryViewportSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const { sx: trajectoryScaleX, sy: trajectoryScaleY } =
    viewportScalesFromZoomFactors(
      trajectoryViewportSize.w,
      trajectoryViewportSize.h,
      trajectoryZoomFactorX,
      trajectoryZoomFactorY,
    )
  trajectoryScaleXRef.current = trajectoryScaleX
  trajectoryScaleYRef.current = trajectoryScaleY

  useEffect(() => {
    localStorage.setItem(LS_TRAJECTORY_ZOOM_X, String(trajectoryZoomFactorX))
    localStorage.setItem(LS_TRAJECTORY_ZOOM_Y, String(trajectoryZoomFactorY))
  }, [trajectoryZoomFactorX, trajectoryZoomFactorY])

  useEffect(() => {
    localStorage.setItem(
      LS_MAP_FACILITY_TOOLBARS_VISIBLE,
      showFacilityToolbars ? '1' : '0',
    )
  }, [showFacilityToolbars])

  const trajPrevSxRef = useRef<number | null>(null)
  const trajPrevSyRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const vp = trajectoryViewportRef.current
    if (!vp) return
    if (!isTrajectoryWorkspace) {
      return
    }
    const prevSx = trajPrevSxRef.current
    const prevSy = trajPrevSyRef.current
    if (prevSx === null || prevSy === null) {
      trajPrevSxRef.current = trajectoryScaleX
      trajPrevSyRef.current = trajectoryScaleY
      return
    }
    preserveViewportWorldCenterOnScaleChange(
      vp,
      prevSx,
      prevSy,
      trajectoryScaleX,
      trajectoryScaleY,
      worldBoundsFromExtent(mapExtentMetersRef.current),
    )
    trajPrevSxRef.current = trajectoryScaleX
    trajPrevSyRef.current = trajectoryScaleY
  }, [trajectoryScaleX, trajectoryScaleY, isTrajectoryWorkspace])

  const mapAreaFacilities = useCallback(
    (
      areaId: string,
      fn: (facilities: FacilityObject[]) => FacilityObject[],
    ) => {
      setAreas((prev) =>
        prev.map((a) =>
          a.id === areaId ? { ...a, facilities: fn(a.facilities) } : a,
        ),
      )
    },
    [],
  )

  const updateArea = useCallback(
    (areaId: string, patch: MapAreaPatch) => {
      setAreas((prev) =>
        prev.map((a) => {
          if (a.id !== areaId) return a
          const merged = { ...a, ...patch }
          if (patch.view !== undefined) {
            merged.view = normalizeAreaView({ ...a.view, ...patch.view })
          }
          if (patch.domain) {
            const domain = normalizeAreaDomain(merged.domain)
            merged.domain = domain
            merged.facilities = syncAreaFacilitiesFieldCoords(
              merged.facilities,
              domain,
              merged.layout,
            )
          } else if (patch.layout) {
            merged.facilities = syncAreaFacilitiesFieldCoords(
              merged.facilities,
              merged.domain,
              merged.layout,
            )
          }
          return { ...merged, view: normalizeAreaView(merged.view) }
        }),
      )
    },
    [],
  )

  const getSnapshot = useCallback(
    () => ({
      areas: structuredClone(areas),
      basemaps: structuredClone(basemaps),
      mapPixelSize: { ...mapPixelSizeRef.current },
      mapPixelOrigin: { ...mapPixelOriginRef.current },
      selectedAreaId,
      selectedFacilityIds,
      selectedBasemapId,
      nextNumericId,
    }),
    [areas, basemaps, selectedAreaId, selectedFacilityIds, selectedBasemapId, nextNumericId],
  )

  const applySnapshot = useCallback(
    (s: {
      areas: MapAreaObject[]
      basemaps: MapBasemapObject[]
      mapPixelSize: MapPixelSize
      mapPixelOrigin: MapPixelOrigin
      selectedAreaId: string | null
      selectedFacilityIds: string[]
      selectedBasemapId: string | null
      nextNumericId: number
    }) => {
      setAreas(s.areas)
      setBasemaps(s.basemaps)
      setMapPixelSize(s.mapPixelSize)
      setMapPixelOrigin(s.mapPixelOrigin)
      updateSelection(s.selectedAreaId, s.selectedFacilityIds)
      selectedBasemapIdRef.current = s.selectedBasemapId
      setSelectedBasemapId(s.selectedBasemapId)
      setNextNumericId(s.nextNumericId)
    },
    [updateSelection],
  )

  const { pushHistory, undo, redo, resetHistory, canUndo, canRedo } =
    useMapHistory({
      getSnapshot,
      applySnapshot,
    })

  const onAreaLayoutSessionStart = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  const exitCropMode = useCallback(() => {
    setMapCropModeActive(false)
    setCropWorkspace(null)
  }, [])

  const enterCropMode = useCallback(() => {
    if (mapEditorMode !== 'edit') return
    clearSelection()
    setAllAreasSelected(false)
    setCropWorkspace(
      createCropWorkspace(
        mapPixelSizeRef.current,
        mapPixelOriginRef.current,
      ),
    )
    setMapCropModeActive(true)
    setInspectorCollapsed(false)
  }, [mapEditorMode, clearSelection])

  const onCropRectChange = useCallback((rect: MapCropRect) => {
    setCropWorkspace((ws) => {
      if (!ws) return ws
      return {
        ...ws,
        cropRect: clampCropRect(rect, ws.workspace),
      }
    })
  }, [])

  const applyCropMode = useCallback(() => {
    if (!cropWorkspace) return
    pushHistory()
    const { pixelSize: nextSize, pixelOrigin: nextOrigin } = applyMapCrop(
      cropWorkspace.cropRect,
      cropWorkspace.mapOffset,
    )
    setMapPixelSize(nextSize)
    setMapPixelOrigin(nextOrigin)
    setLoadedMapMeta((m) => ({
      ...m,
      pixelSize: nextSize,
      pixelOrigin: nextOrigin,
    }))
    exitCropMode()
  }, [cropWorkspace, pushHistory, exitCropMode])

  const cropOutputSize = useMemo(
    () =>
      cropWorkspace
        ? {
            width: cropWorkspace.cropRect.width,
            height: cropWorkspace.cropRect.height,
          }
        : mapPixelSize,
    [cropWorkspace, mapPixelSize],
  )

  const bulkAreaLayoutsRef = useRef<Map<string, MapAreaLayout> | null>(null)

  const onBulkAreasLayoutSessionStart = useCallback(() => {
    if (bulkAreaLayoutsRef.current) return
    pushHistory()
    bulkAreaLayoutsRef.current = new Map(
      areasRef.current.map((a) => [a.id, { ...a.layout }]),
    )
  }, [pushHistory])

  const onBulkAreasLayoutMove = useCallback((dx: number, dy: number) => {
    const start = bulkAreaLayoutsRef.current
    if (!start) return
    const ps = mapPixelSizeRef.current
    setAreas((prev) =>
      prev.map((a) => {
        const base = start.get(a.id) ?? a.layout
        return {
          ...a,
          layout: {
            ...base,
            xPx: Math.max(
              0,
              Math.min(
                ps.width - base.wPx,
                Math.round(base.xPx + dx),
              ),
            ),
            yPx: Math.max(
              0,
              Math.min(
                ps.height - base.hPx,
                Math.round(base.yPx + dy),
              ),
            ),
          },
        }
      }),
    )
  }, [])

  const onBulkAreasLayoutCommit = useCallback(() => {
    bulkAreaLayoutsRef.current = null
  }, [])

  const onPatchAreaLayout = useCallback(
    (areaId: string, layout: MapAreaLayout) => {
      setAreas((prev) =>
        prev.map((a) => {
          if (a.id !== areaId) return a
          const oldLayout = a.layout
          if (isAreaLayoutPureMove(oldLayout, layout)) {
            return { ...a, layout }
          }
          return {
            ...a,
            layout,
            facilities: syncAreaFacilitiesAreaCoordsAfterLayoutResize(
              a.facilities,
              a.domain,
              oldLayout,
              layout,
            ),
          }
        }),
      )
    },
    [],
  )

  /**
   * 載入地圖後：固定為檢視模式並收合資產列。
   * 不清空軌跡分頁狀態，以便從地圖編輯切回軌跡時仍保留車輛、軌跡檔與播放進度。
   */
  const exitMapEditorChromeAfterLoad = useCallback(() => {
    setMapEditorMode('view')
    setEditSessionBaseline(null)
    setListDrawerTab((tab) => (tab === 'palette' ? null : tab))
  }, [])

  /** 由地圖清單載入 */
  const applyLoadedMap = useCallback(
    (loaded: ParsedMapFile, libraryId: string) => {
      const creationMode = loaded.creationMode ?? 'blank'
      setMapPixelSize(loaded.pixelSize)
      setMapPixelOrigin(loaded.pixelOrigin)
      /*
       * 修掉「兩塊宣稱自己是同一段路」的舊資料。
       *
       * 早期的複製貼上會把生成軌道的現場身分一起抄過去。先拿掉後面那幾塊的身分，
       * 再讓底下的 ensureAutoRefFieldBoundsInAreas 照它們實際待的位置重新推算範圍。
       * 這一步只改記憶體裡的內容，要等使用者自己存檔才寫回去。
       */
      const repaired = dropSharedTrackGenIdentityInAreas(
        applyExampleMapDefaultLabelStyleToAreas(loaded.areas, loaded.mapId),
      )
      if (repaired.stripped.length > 0) {
        console.warn(
          `[map] ${repaired.stripped.length} 塊軌道與別塊共用同一條現場中心線，`
          + '已清掉重複的那幾塊的現場身分，改照圖上位置推算：'
          + repaired.stripped.join('、'),
        )
      }
      if (repaired.cleared.length > 0) {
        console.warn(
          `[map] ${repaired.cleared.length} 塊軌道的場域範圍不在路網涵蓋的範圍內，`
          + '已清掉改照圖上位置推算：'
          + repaired.cleared.join('、'),
        )
      }
      /*
       * 分區內設施的場域範圍是<strong>推導</strong>出來的：圖上外框照分區的對應
       * 換算成現場公尺。先前只換算中心、尺寸沿用舊值，換過圖的檔案會留著上一版的
       * 大小（實測充電格畫成橫的、場域範圍卻是直的，比整個分區還高）。載入時重算
       * 一次，之後車端判斷停在哪一格、圖台擺車頭才有正確的長邊。
       */
      /*
       * 一條入口連結只能有一個分區。兩個分區綁同一條時會算出同一塊現場範圍，
       * 裡面的設施疊在一起而且沒有任何跡象——實測這張圖的「整備區」綁在「調度區」
       * 那條連結上。多出來的先解除綁定，等使用者重新接。
       */
      /*
       * 分岔、斜接這種斜的方塊沒有中心線時，照形狀與鄰居推一條出來。
       * 分岔是「主線道一條、分支一條」：進口→直行出口是主線道（就是外框囊括的那條），
       * 進口→岔出出口是分支（斜的，與斜接軌道同一回事）。兩端都在隔壁找得到對應才寫。
       */
      // 缺橫向比例尺的方塊一個點都算不出來，先補起來再推中心線
      const scaled = backfillTrackGenLatPerBoxInAreas(repaired.areas)
      if (scaled.filled.length > 0) {
        console.warn(
          `[map] ${scaled.filled.length} 塊軌道缺橫向比例尺（框裡的點會被隔壁那塊搶去解釋），`
          + '已照最近的同型方塊補上：'
          + scaled.filled.join('、'),
        )
      }
      const shaped = deriveShapedTrackPathsInAreas(scaled.areas)
      if (shaped.derived.length > 0) {
        console.warn(
          `[map] ${shaped.derived.length} 塊斜／彎軌道沒有中心線，已照形狀與鄰居推出來：`
          + shaped.derived.join('、'),
        )
      }
      if (shaped.skipped.length > 0) {
        console.warn(
          `[map] ${shaped.skipped.length} 塊斜／彎軌道推不出中心線（有一端在圖上找不到相接的方塊），`
          + '那幾塊的位置只能照外框估：'
          + shaped.skipped.join('、'),
        )
      }
      /*
       * 有中心線卻沒有里程對應的方塊，照鄰居把里程接回來。
       *
       * 定位主索引開頭就是 if (!spans.length) continue——沒有里程的方塊根本不會
       * 成為候選。它照樣畫在圖上，只是永遠不會被選中，落在它上面的點被判給附近
       * 別的方塊。實測 D18 自己中心線上的九個點，七個被判給對向的 U18／U19。
       */
      // 剛推出中心線的軌道（例如接到分區入口的）也要併進接點
      const spanned = backfillTrackGenSpansInAreas(settleTrackJointsInAreas(shaped.areas).areas)
      if (spanned.reset.length > 0) {
        console.warn(`[map] ${spanned.reset.length} 塊軌道的里程與鄰居對不上，已拿掉照鄰居重算：${spanned.reset.join('、')}`)
      }
      if (spanned.filled.length > 0) {
        console.warn(
          `[map] ${spanned.filled.length} 塊軌道有中心線卻沒有里程對應（不會進定位索引，`
          + '上面的點會被判給隔壁），已照兩端鄰居接回來：'
          + spanned.filled
            .map((f) => `${f.name} road ${f.road} lane ${f.lane} s ${f.s0}→${f.s1}`)
            .join('、'),
        )
      }
      if (spanned.skipped.length > 0) {
        console.warn(
          `[map] ${spanned.skipped.length} 塊軌道沒有里程對應，而且兩端鄰居對不起來（接的不是同一條車道），`
          + '無法補上：'
          + spanned.skipped.join('、'),
        )
      }
      /*
       * 場域範圍對不上自己的真實路徑時，照路徑重算。
       *
       * 方框本來就是從路徑算出來的，但算完就存下來；路徑後來被重新生成、方塊被
       * 重畫，方框沒跟著重算就分家了。分家不報錯，因為每一塊自己的換算仍然自洽，
       * 壞的是別人——方框太大的那一塊會把鄰居範圍內的點吸過去。
       */
      const bounded = repairTrackRefFieldBoundsInAreas(spanned.areas)
      if (bounded.repaired.length > 0) {
        console.warn(
          `[map] ${bounded.repaired.length} 塊軌道的場域範圍與自己的中心線對不上，已照中心線重算：`
          + bounded.repaired
            .map((r) => `${r.name} 差 ${r.worstM} m（${r.fromM} → ${r.toM}）`)
            .join('；'),
        )
      }
      const rebound = dropDuplicateZoneBindingsInAreas(bounded.areas)
      if (rebound.unbound.length > 0) {
        console.warn(
          `[map] ${rebound.unbound.length} 個分區與別的分區綁在同一條入口連結上，`
          + '已解除綁定，請到入口重新接：'
          + rebound.unbound.join('、'),
        )
      }
      const zoneSynced = resyncZoneChildBoundsInAreas(rebound.areas)
      if (zoneSynced.changed.length > 0) {
        console.warn(
          `[map] ${zoneSynced.changed.length} 個分區內設施的場域範圍與圖上外框對不起來，`
          + '已照分區對應重算：'
          + zoneSynced.changed.join('、'),
        )
      }
      /*
       * 停靠點／途經點照目前畫的位置重算場域座標。
       *
       * 那個值是某一刻寫下來的：後來軌道被合併、微調、重放，同一個圖面位置底下的
       * 方塊換了一塊，值就過期了。圖上放在哪裡就是哪裡——那一段的比例被壓縮過，
       * 放進去的元件也該照同一個比例映射。
       */
      const repositioned = resyncAutoRefFieldPositionsInAreas(
        ensureAutoRefFieldBoundsInAreas(
          ensureAutoRefFieldPositionsInAreas(
            ensureWaypointCodesInAreas(
              ensureDockingPointStationIdsInAreas(zoneSynced.areas),
            ),
            loaded.basemaps ?? [],
          ),
          loaded.basemaps ?? [],
        ),
        loaded.basemaps ?? [],
      )
      /*
       * 健檢：沿每一塊的中心線取樣，走完定位那條路再換回現場，看回不回得到原地。
       * 不必看畫面、也不必知道正確答案——比對的是系統自己的兩個方向。
       */
      const audit = auditFieldMapping(repositioned.areas)
      if (audit.overThreshold.length > 0 || audit.blocks.some((b) => b.wrongBlock > 0)) {
        console.warn(describeFieldMappingAudit(audit))
      }
      const dataIssues = auditMapData(repositioned.areas)
      if (dataIssues.length > 0) console.warn(describeMapDataIssues(dataIssues))
      if (repositioned.moved.length > 0) {
        console.warn(
          `[map] ${repositioned.moved.length} 個停靠點／途經點的場域座標與它畫的位置對不上，`
          + '已照畫的位置重算：'
          + repositioned.moved
            .map((m) => `${m.name}（${m.fromM} → ${m.toM}）`)
            .join('、'),
        )
      }
      setAreas(repositioned.areas)
      const nextBasemaps = structuredClone(loaded.basemaps ?? [])
      setBasemaps(nextBasemaps)
      setNextNumericId(nextNumericIdFromAreas(loaded.areas, nextBasemaps))
      setMapRoutes(loaded.routes ?? [])
      setMapRouteGroups(
        ensureRouteGroupsForRoutes(loaded.routes ?? [], loaded.routeGroups ?? []),
      )
      setPointTopology(
        syncPointTopologyWithAreas(loaded.pointTopology, loaded.areas),
      )
      setRoutePlanningDraft(null)
      setRouteGroupDraft(null)
      setVisibleRouteIds(new Set())
      clearSelection()
      const trackGenBasemap =
        creationMode === 'trackGen'
          ? nextBasemaps.find((b) => isTrackGenComponent(b.parameters))
          : undefined
      if (trackGenBasemap) {
        selectedBasemapIdRef.current = trackGenBasemap.id
        setSelectedBasemapId(trackGenBasemap.id)
        setRulerDisplayMode('field')
      } else {
        setRulerDisplayMode('off')
      }
      setLoadedMapMeta({
        libraryId,
        mapId: loaded.mapId,
        displayName: loaded.displayName,
        version: loaded.version || DEFAULT_MAP_VERSION,
        pixelSize: loaded.pixelSize,
        pixelOrigin: loaded.pixelOrigin,
        creationMode,
      })
      resetHistory()
      exitMapEditorChromeAfterLoad()
    },
    [resetHistory, exitMapEditorChromeAfterLoad, clearSelection],
  )

  /**
   * 存到後端，失敗要講。
   *
   * 圖資是<strong>大家共用</strong>的資料，不是這台瀏覽器的偏好設定：使用者存完之後
   * 換一台電腦、或是模擬器、排班引擎來讀，看到的都必須是同一份。所以每一次儲存都
   * 送後端，本機快取只是後端掛掉時仍能繼續編的備援。
   *
   * 「存到後端」與「設為當前使用」是兩件事：這一支只更新這張圖的內容，哪一張是正式
   * 環境在讀的那一張由地圖清單的「設為當前使用」決定。
   */
  const publishAndReport = useCallback(async (entry: MapLibraryEntry) => {
    const result = await publishMapLibraryEntryToBackend(entry)
    // 橫幅講的是「還沒同步到伺服器」，送成功就該消失
    setBackendSyncFailed(!result.ok)
    /*
     * 送成功就記下來。
     *
     * 補水時要靠這個欄位分辨「後端沒有這一張」是被刪掉了還是根本還沒送上去；沒有
     * 這一筆的話，剛建好還來不及發佈的地圖會在下一次重新整理時被當成已刪除清掉。
     */
    writeMapLibrary(
      readMapLibrary().map((e) =>
        e.libraryId === entry.libraryId
          ? { ...e, publishState: result.ok ? ('published' as const) : ('pending' as const) }
          : e,
      ),
    )
  }, [])

  /** 標成「還沒同步到伺服器」；送成功後由 publishAndReport 改回 published */
  const markEntryUnpublished = useCallback((entry: MapLibraryEntry) => {
    writeMapLibrary(
      readMapLibrary().map((e) =>
        e.libraryId === entry.libraryId
          ? { ...e, publishState: 'pending' as const }
          : e,
      ),
    )
  }, [])

  const persistCurrentMapToLibrary = useCallback(() => {
    const meta = loadedMapMetaRef.current
    if (!meta.libraryId) return
    const entry = getMapLibraryEntry(meta.libraryId)
    if (!entry) return
    const updated = saveEditorStateToLibraryEntry(
      entry,
      {
        displayName: meta.displayName,
        version: meta.version,
        pixelSize: mapPixelSizeRef.current,
        pixelOrigin: mapPixelOriginRef.current,
      },
      areasRef.current,
      mapRoutesRef.current,
      mapRouteGroupsRef.current,
      pointTopologyRef.current,
      [],
      basemapsRef.current,
    )
    writeMapLibrary(upsertMapLibraryEntry(readMapLibrary(), updated))
    markEntryUnpublished(updated)
    void publishAndReport(updated)
  }, [markEntryUnpublished, publishAndReport])

  const routePlanningPickMode =
    listDrawerTab === 'routes' &&
    routePlanningDraft !== null &&
    mapEditorMode === 'edit'

  const routeOverlayPreview = useMemo(() => {
    if (routePlanningDraft && routePlanningDraft.stationIds.length > 0) {
      return {
        stationIds: routePlanningDraft.stationIds,
        color: 'rgba(251, 191, 36, 0.95)',
        label: routePlanningDraft.displayName.trim() || t('mapEditor.chrome.editingRoute'),
        emphasized: true,
        avgTravelTimeSeconds: routePlanningDraft.avgTravelTimeSeconds,
        minTravelTimeSeconds: routePlanningDraft.minTravelTimeSeconds,
        // 站序編輯只標停靠點；連線留給「模擬路線」編輯，避免紅虛線誤導
        showConnections: false,
      }
    }
    return null
  }, [routePlanningDraft])

  const routeOverlaySaved = useMemo(() => {
    if (routePlanningDraft) return []
    return mapRoutes
      .map((route, index) => ({ route, index }))
      .filter(({ route }) => visibleRouteIds.has(route.routeId))
      .filter(({ route }) => route.routeId !== simRouteEditRouteId)
      .filter(({ route }) =>
        isTopologyRouteCombinationValid(pointTopology, areas, route.stationIds),
      )
      .map(({ route, index }) => ({
        route,
        color: routeColorForIndex(index),
        emphasized: true,
      }))
  }, [
    mapRoutes,
    visibleRouteIds,
    routePlanningDraft,
    pointTopology,
    areas,
    simRouteEditRouteId,
  ])

  const simRouteSnapTargets = useMemo(
    () => buildSimRouteSnapTargets(areas),
    [areas],
  )

  const simRouteGuideBounds = useMemo(
    () => ({
      left: mapPixelOrigin.x,
      top: mapPixelOrigin.y,
      right: mapPixelOrigin.x + mapPixelSize.width,
      bottom: mapPixelOrigin.y + mapPixelSize.height,
    }),
    [mapPixelOrigin.x, mapPixelOrigin.y, mapPixelSize.width, mapPixelSize.height],
  )

  const persistSimRoutePathPoints = useCallback(
    (routeId: string, points: EditPoint[]) => {
      const pathWaypoints = editPointsToPathWaypoints(areas, points)
      const hasManualBend = pathWaypoints.some((w) => !w.stationId)
      const now = new Date().toISOString()
      setMapRoutes((prev) =>
        prev.map((r) => {
          if (r.routeId !== routeId) return r
          if (!hasManualBend) {
            const { pathWaypoints: _cleared, ...rest } = r
            return { ...rest, updatedAt: now }
          }
          return { ...r, pathWaypoints, updatedAt: now }
        }),
      )
    },
    [areas],
  )

  const onFinishSimRoutePathEdit = useCallback(() => {
    // 折點變更已在 onChange 時寫入 mapRoutes（會觸發自動儲存／同步）
    setSimRouteEditRouteId(null)
    setSimRouteEditPoints([])
  }, [])

  const onEditSimRoutePath = useCallback(
    (routeId: string) => {
      if (mapEditorMode !== 'edit') return
      const route = mapRoutes.find((r) => r.routeId === routeId)
      if (!route || route.stationIds.length < 2) return
      setRoutePlanningDraft(null)
      setRouteGroupDraft(null)
      // 清掉舊版誤種的自動折點，避免一進編輯又長出一堆藍方塊
      if (isLegacyAutoPathWaypoints(areas, pointTopology, route)) {
        const now = new Date().toISOString()
        setMapRoutes((prev) =>
          prev.map((r) => {
            if (r.routeId !== routeId) return r
            const { pathWaypoints: _cleared, ...rest } = r
            return { ...rest, updatedAt: now }
          }),
        )
      }
      const points = startSimRouteEditPoints(areas, pointTopology, route)
      setSimRouteEditRouteId(routeId)
      setSimRouteEditPoints(points)
      setVisibleRouteIds((prev) => {
        if (prev.has(routeId)) return prev
        const next = new Set(prev)
        next.add(routeId)
        return next
      })
      setListDrawerTab('routes')
    },
    [mapEditorMode, mapRoutes, areas, pointTopology],
  )

  const onSimRoutePathPointsChange = useCallback(
    (next: EditPoint[]) => {
      setSimRouteEditPoints(next)
      if (simRouteEditRouteId) {
        persistSimRoutePathPoints(simRouteEditRouteId, next)
      }
    },
    [simRouteEditRouteId, persistSimRoutePathPoints],
  )

  const onStartNewRoute = useCallback(
    (groupId: string | null) => {
      if (mapEditorMode !== 'edit') return
      setSimRouteEditRouteId(null)
      setSimRouteEditPoints([])
      setRouteGroupDraft(null)
      setRoutePlanningDraft({
        routeId: null,
        displayName: '',
        stationIds: [],
        groupId,
        avgTravelTimeSeconds: null,
        minTravelTimeSeconds: null,
      })
      setListDrawerTab('routes')
    },
    [mapEditorMode],
  )

  const onEditRoute = useCallback(
    (routeId: string) => {
      const route = mapRoutes.find((r) => r.routeId === routeId)
      if (!route) return
      setSimRouteEditRouteId(null)
      setSimRouteEditPoints([])
      const group = findRouteGroupForRoute(mapRouteGroups, routeId)
      setRouteGroupDraft(null)
      setRoutePlanningDraft({
        routeId: route.routeId,
        displayName: route.displayName,
        stationIds: [...route.stationIds],
        groupId: group?.groupId ?? null,
        avgTravelTimeSeconds: route.avgTravelTimeSeconds ?? null,
        minTravelTimeSeconds: route.minTravelTimeSeconds ?? null,
      })
      setListDrawerTab('routes')
    },
    [mapRoutes, mapRouteGroups],
  )

  const onCancelRouteDraft = useCallback(() => {
    setRoutePlanningDraft(null)
  }, [])

  const onSaveRouteDraft = useCallback(() => {
    const draft = routePlanningDraft
    if (!draft || !isRoutePlanningDraftSavable(draft)) return
    const displayName = draft.displayName.trim()
    pushHistory()
    const now = new Date().toISOString()
    const groupId = draft.groupId
    const travelTimes = {
      avgTravelTimeSeconds: draft.avgTravelTimeSeconds ?? null,
      minTravelTimeSeconds: draft.minTravelTimeSeconds ?? null,
    }

    if (draft.routeId) {
      const routeId = draft.routeId
      setMapRoutes((prev) =>
        prev.map((r) => {
          if (r.routeId !== routeId) return r
          const { taskType: _legacy, ...routeRest } = r as typeof r & { taskType?: unknown }
          const stationsChanged =
            r.stationIds.length !== draft.stationIds.length ||
            r.stationIds.some((id, i) => id !== draft.stationIds[i])
          if (stationsChanged) {
            const { pathWaypoints: _cleared, ...withoutPath } = routeRest
            return {
              ...withoutPath,
              displayName,
              stationIds: [...draft.stationIds],
              ...travelTimes,
              updatedAt: now,
            }
          }
          return {
            ...routeRest,
            displayName,
            stationIds: [...draft.stationIds],
            ...travelTimes,
            updatedAt: now,
          }
        }),
      )
    } else {
      setMapRoutes((prev) => {
        const routeId = generateNextRouteId(prev)
        setMapRouteGroups((groups) => assignRouteToGroup(groups, routeId, groupId))
        return [
          ...prev,
          {
            routeId,
            displayName,
            stationIds: [...draft.stationIds],
            ...travelTimes,
            createdAt: now,
            updatedAt: now,
          },
        ]
      })
    }
    setRoutePlanningDraft(null)
  }, [routePlanningDraft, pushHistory])

  const onDeleteRoute = useCallback(
    (routeId: string) => {
      const route = mapRoutes.find((r) => r.routeId === routeId)
      const label = route?.displayName ?? routeId
      if (!window.confirm(t('mapEditor.chrome.confirmDeleteRoute', { label }))) return
      pushHistory()
      setMapRoutes((prev) => prev.filter((r) => r.routeId !== routeId))
      setMapRouteGroups((prev) => removeRouteFromAllGroups(prev, routeId))
      setRoutePlanningDraft(null)
      setVisibleRouteIds((prev) => {
        if (!prev.has(routeId)) return prev
        const next = new Set(prev)
        next.delete(routeId)
        return next
      })
    },
    [mapRoutes, pushHistory],
  )

  const onDraftRouteNameChange = useCallback((name: string) => {
    setRoutePlanningDraft((d) => (d ? { ...d, displayName: name } : d))
  }, [])

  const onDraftRouteAvgTravelTimeChange = useCallback((avgTravelTimeSeconds: number | null) => {
    setRoutePlanningDraft((d) => (d ? { ...d, avgTravelTimeSeconds } : d))
  }, [])

  const onDraftRouteMinTravelTimeChange = useCallback((minTravelTimeSeconds: number | null) => {
    setRoutePlanningDraft((d) => (d ? { ...d, minTravelTimeSeconds } : d))
  }, [])

  const onStartNewGroup = useCallback(() => {
    if (mapEditorMode !== 'edit') return
    setRoutePlanningDraft(null)
    setRouteGroupDraft({
      groupId: null,
      displayName: '',
    })
    setListDrawerTab('routes')
  }, [mapEditorMode])

  const onEditGroup = useCallback(
    (groupId: string) => {
      const group = mapRouteGroups.find((g) => g.groupId === groupId)
      if (!group) return
      setRoutePlanningDraft(null)
      setRouteGroupDraft({
        groupId: group.groupId,
        displayName: group.displayName,
      })
      setListDrawerTab('routes')
    },
    [mapRouteGroups],
  )

  const onCancelGroupDraft = useCallback(() => {
    setRouteGroupDraft(null)
  }, [])

  const onSaveGroupDraft = useCallback(() => {
    const draft = routeGroupDraft
    if (!draft) return
    const displayName = draft.displayName.trim()
    if (!displayName) return
    pushHistory()
    const now = new Date().toISOString()
    setMapRouteGroups((prev) => {
      if (draft.groupId) {
        return prev.map((g) =>
          g.groupId === draft.groupId
            ? {
                ...g,
                displayName,
                updatedAt: now,
              }
            : g,
        )
      }
      const groupId = generateNextRouteGroupId(prev)
      return [
        ...prev,
        {
          groupId,
          displayName,
          routeIds: [],
          createdAt: now,
          updatedAt: now,
        },
      ]
    })
    setRouteGroupDraft(null)
  }, [routeGroupDraft, pushHistory])

  const onDeleteGroup = useCallback(
    (groupId: string) => {
      const group = mapRouteGroups.find((g) => g.groupId === groupId)
      const label = group?.displayName ?? t('mapEditor.chrome.thisRouteGroup')
      if (
        !window.confirm(
          t('mapEditor.chrome.confirmDeleteGroup', { label }),
        )
      ) {
        return
      }
      pushHistory()
      setMapRouteGroups((prev) => prev.filter((g) => g.groupId !== groupId))
      setRouteGroupDraft(null)
    },
    [mapRouteGroups, pushHistory],
  )

  const onGroupDraftNameChange = useCallback((name: string) => {
    setRouteGroupDraft((d) => (d ? { ...d, displayName: name } : d))
  }, [])

  const onRemoveRouteStationAt = useCallback((index: number) => {
    setRoutePlanningDraft((d) => {
      if (!d) return d
      return {
        ...d,
        stationIds: d.stationIds.filter((_, i) => i !== index),
      }
    })
  }, [])

  const onMoveRouteStation = useCallback((from: number, to: number) => {
    setRoutePlanningDraft((d) => {
      if (!d || to < 0 || to >= d.stationIds.length) return d
      const next = [...d.stationIds]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return { ...d, stationIds: next }
    })
  }, [])

  const onAppendRouteStation = useCallback((stationId: string) => {
    const id = stationId.trim()
    if (!id) return
    setRoutePlanningDraft((d) => {
      if (!d || d.stationIds.includes(id)) return d
      if (!canAppendStationToTopologyRoute(
        pointTopologyRef.current,
        areasRef.current,
        d.stationIds,
        id,
      )) return d
      return { ...d, stationIds: [...d.stationIds, id] }
    })
  }, [])

  const onToggleRouteVisibility = useCallback((routeId: string) => {
    setVisibleRouteIds((prev) => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      return next
    })
  }, [])

  const onToggleGroupRouteVisibility = useCallback((routeIds: string[]) => {
    if (routeIds.length === 0) return
    setVisibleRouteIds((prev) => {
      const allVisible = routeIds.every((id) => prev.has(id))
      const next = new Set(prev)
      if (allVisible) {
        for (const id of routeIds) next.delete(id)
      } else {
        for (const id of routeIds) next.add(id)
      }
      return next
    })
  }, [])

  /**
   * 自動儲存送後端失敗時重送一次。
   *
   * 沒有「發布到正式環境」這一步：每次儲存都送後端，哪一張是系統在讀的由地圖清單的
   * 「設為主要地圖」決定（會先檢查部署中的班表接不接得上）。
   */
  const retryBackendSync = useCallback(async () => {
    const meta = loadedMapMetaRef.current
    const entry = getMapLibraryEntry(meta.libraryId)
    if (!entry) return
    setRetryingSync(true)
    try {
      await publishAndReport(entry)
    } finally {
      setRetryingSync(false)
    }
  }, [publishAndReport])

  // 開圖時問後端這張是不是主要地圖
  useEffect(() => {
    const libraryId = loadedMapMeta.libraryId
    if (!isMapWorkspace || mapScreen !== 'editor' || !libraryId) return undefined
    let cancelled = false
    void fetchMapLibraryBackendStatus().then((status) => {
      if (cancelled) return
      const entry = getMapLibraryEntry(libraryId)
      setPrimaryMapCheck({
        libraryId,
        primary: Boolean(
          status && entry && isMapLibraryEntryActive(entry, status.activeMapId, status.activeLibraryId),
        ),
      })
    })
    return () => {
      cancelled = true
    }
  }, [isMapWorkspace, mapScreen, loadedMapMeta.libraryId])
  const isPrimaryMap =
    primaryMapCheck?.primary === true && primaryMapCheck.libraryId === loadedMapMeta.libraryId

  const openLibraryMap = useCallback(
    async (libraryId: string) => {
      /*
       * 開圖前先跟後端對一次。
       *
       * getMapLibraryEntry 讀的是 localStorage，那是快取；別台機器改過的內容不在
       * 裡面。不對這一次的話，打開的是這台瀏覽器上次留下的舊版，而且沒有任何提示。
       * 後端連不上就沿用快取——開得起來比開得新重要。
       */
      await hydrateMapLibraryFromBackend()

      let entry = getMapLibraryEntry(libraryId)
      if (!entry) {
        alert(t('mapEditor.chrome.mapNotFound'))
        return
      }
      /*
       * 這裡曾經在開內建地圖時用 public/maps 的內建檔覆蓋一次。已移除：
       * 那份檔案是 7 月的，連 pointTopology 都沒有，覆蓋等於把使用者後來
       * 建的路網拓撲整個抹掉。真相在後端，上面已經補水過了。
       */
      const parsed = entryToParsed(entry)
      applyLoadedMap(parsed, entry.libraryId)
      setMapScreen('editor')
    },
    [applyLoadedMap],
  )

  const enterEditMode = useCallback(() => {
    setEditSessionBaseline({
      areas: structuredClone(areas),
      basemaps: structuredClone(basemaps),
      routeGroups: structuredClone(mapRouteGroups),
      routes: structuredClone(mapRoutes),
      pointTopology: structuredClone(pointTopology),
      nextNumericId,
      loadedMapMeta: { ...loadedMapMeta },
    })
    setMapEditorMode('edit')
    setAllAreasSelected(false)
    exitCropMode()
    resetHistory()
    setAutosaveStatus('idle')
    setAutosaveTimeLabel(t('mapEditor.chrome.editingAutosaveLabel'))
    if (selectedAreaId !== null) {
      const area = areas.find((a) => a.id === selectedAreaId)
      if (
        selectedFacilityIds.length > 0 &&
        !selectedFacilityIds.every((id) =>
          area?.facilities.some((f) => f.id === id),
        )
      ) {
        updateSelection(
          selectedAreaId,
          selectedFacilityIds.filter((id) =>
            area?.facilities.some((f) => f.id === id),
          ),
        )
      }
    } else {
      clearSelection()
    }
  }, [
    areas,
    basemaps,
    mapRouteGroups,
    mapRoutes,
    pointTopology,
    nextNumericId,
    loadedMapMeta,
    resetHistory,
    selectedAreaId,
    selectedFacilityIds,
    updateSelection,
    clearSelection,
  ])

  const requestLeaveEditMode = useCallback(() => {
    setLeaveEditNavigateToLibrary(false)
    if (mapEditorMode !== 'edit') return
    if (
      !editSessionBaseline ||
      !isEditSessionDirty(
        editSessionBaseline,
        areas,
        basemaps,
        mapRouteGroups,
        mapRoutes,
        pointTopology,
        nextNumericId,
        loadedMapMeta,
      )
    ) {
      clearMapDraft(loadedMapMeta.libraryId)
      setMapEditorMode('view')
      setEditSessionBaseline(null)
      setListDrawerTab((tab) => (tab === 'palette' ? null : tab))
      clearSelection()
      setAutosaveStatus('idle')
      setAutosaveTimeLabel('')
      return
    }
    setLeaveEditDialogOpen(true)
  }, [
    mapEditorMode,
    editSessionBaseline,
    areas,
    basemaps,
    mapRouteGroups,
    mapRoutes,
    pointTopology,
    nextNumericId,
    loadedMapMeta,
    clearSelection,
  ])

  const requestBackToLibrary = useCallback(() => {
    if (mapEditorMode === 'edit') {
      if (
        editSessionBaseline &&
        isEditSessionDirty(
          editSessionBaseline,
          areas,
          basemaps,
          mapRouteGroups,
          mapRoutes,
          pointTopology,
          nextNumericId,
          loadedMapMeta,
        )
      ) {
        setLeaveEditNavigateToLibrary(true)
        setLeaveEditDialogOpen(true)
        return
      }
      clearMapDraft(loadedMapMeta.libraryId)
      setMapEditorMode('view')
      setEditSessionBaseline(null)
      setListDrawerTab((tab) => (tab === 'palette' ? null : tab))
      clearSelection()
      setAutosaveStatus('idle')
      setAutosaveTimeLabel('')
    }
    persistCurrentMapToLibrary()
    setMapScreen('library')
  }, [
    mapEditorMode,
    editSessionBaseline,
    areas,
    basemaps,
    mapRoutes,
    mapRouteGroups,
    pointTopology,
    nextNumericId,
    loadedMapMeta,
    clearSelection,
    persistCurrentMapToLibrary,
  ])

  const confirmLeaveSaveAndExit = useCallback(() => {
    const meta = loadedMapMetaRef.current
    const currentAreas = areasRef.current
    const pixelSize = mapPixelSizeRef.current
    const pixelOrigin = mapPixelOriginRef.current
    const entry = getMapLibraryEntry(meta.libraryId)
    if (entry) {
      const updated = saveEditorStateToLibraryEntry(
        entry,
        {
          displayName: meta.displayName,
          version: meta.version,
          pixelSize,
          pixelOrigin,
        },
        currentAreas,
        mapRoutesRef.current,
        mapRouteGroupsRef.current,
        pointTopologyRef.current,
        [],
        basemapsRef.current,
      )
      writeMapLibrary(upsertMapLibraryEntry(readMapLibrary(), updated))
      markEntryUnpublished(updated)
    }
    clearMapDraft(meta.libraryId)
    setMapPixelSize(pixelSize)
    setAreas(
      applyExampleMapDefaultLabelStyleToAreas(currentAreas, meta.mapId),
    )
    setNextNumericId(
      nextNumericIdFromAreas(currentAreas, basemapsRef.current),
    )
    clearSelection()
    setLeaveEditDialogOpen(false)
    setMapEditorMode('view')
    setEditSessionBaseline(null)
    setListDrawerTab((tab) => (tab === 'palette' ? null : tab))
    resetHistory()
    setAutosaveStatus('saved')
    setAutosaveTimeLabel(t('mapEditor.chrome.savedAt', { time: new Date().toLocaleTimeString() }))
    if (leaveEditNavigateToLibrary) {
      setLeaveEditNavigateToLibrary(false)
      setMapScreen('library')
    }
  }, [resetHistory, clearSelection, leaveEditNavigateToLibrary])

  const confirmLeaveDiscardAndExit = useCallback(() => {
    const b = editSessionBaseline
    if (!b) return
    setAreas(structuredClone(b.areas))
    setBasemaps(structuredClone(b.basemaps ?? []))
    setMapRouteGroups(structuredClone(b.routeGroups))
    setMapRoutes(structuredClone(b.routes))
    setPointTopology(structuredClone(b.pointTopology))
    setNextNumericId(b.nextNumericId)
    setLoadedMapMeta({ ...b.loadedMapMeta })
    setMapPixelSize(b.loadedMapMeta.pixelSize)
    setMapPixelOrigin(b.loadedMapMeta.pixelOrigin)
    clearSelection()
    clearMapDraft(b.loadedMapMeta.libraryId)
    resetHistory()
    setLeaveEditDialogOpen(false)
    setMapEditorMode('view')
    setEditSessionBaseline(null)
    setListDrawerTab((tab) => (tab === 'palette' ? null : tab))
    setAutosaveStatus('idle')
    setAutosaveTimeLabel('')
    if (leaveEditNavigateToLibrary) {
      setLeaveEditNavigateToLibrary(false)
      setMapScreen('library')
    }
  }, [
    editSessionBaseline,
    resetHistory,
    clearSelection,
    leaveEditNavigateToLibrary,
  ])

  const cancelLeaveDialog = useCallback(() => {
    setLeaveEditDialogOpen(false)
    setLeaveEditNavigateToLibrary(false)
  }, [])

  /** 編輯中：防抖寫入地圖庫並顯示儲存時間（不寫入 public/maps 內建檔） */
  useEffect(() => {
    if (mapEditorMode !== 'edit') {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
      return
    }
    const libraryId = loadedMapMeta.libraryId
    if (!libraryId) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    const timer = window.setTimeout(() => {
      setAutosaveStatus('saving')
      try {
        const meta = loadedMapMetaRef.current
        const entry = getMapLibraryEntry(meta.libraryId)
        if (entry) {
          const updated = saveEditorStateToLibraryEntry(
            entry,
            {
              displayName: meta.displayName,
              version: meta.version,
              pixelSize: mapPixelSizeRef.current,
              pixelOrigin: mapPixelOriginRef.current,
            },
            areasRef.current,
            mapRoutesRef.current,
            mapRouteGroupsRef.current,
            pointTopologyRef.current,
            [],
            basemapsRef.current,
          )
          writeMapLibrary(upsertMapLibraryEntry(readMapLibrary(), updated))
          markEntryUnpublished(updated)
          /*
           * 自動儲存也送後端。
           *
           * 之前拆自動儲存與發布時把這一段一起拿掉了，結果編輯過程完全不離開瀏覽器
           * ——使用者畫好路線、加好途經點，伺服器上什麼都沒有，模擬器與排班引擎讀到
           * 的還是舊的那一份，而且畫面上看不出來。要防的是「還沒決定好就換掉正式環境
           * 那一張」，那件事由「設為當前使用」把關，不該連存檔都不送。
           */
          void publishAndReport(updated)
        }
        clearMapDraft(libraryId)
        const savedAt = new Date()
        setAutosaveStatus('saved')
        setAutosaveTimeLabel(
          t('mapEditor.chrome.autosavedAt', {
            time: savedAt.toLocaleString(i18n.language === 'en-US' ? 'en-US' : 'zh-TW', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          }),
        )
      } catch (err) {
        // 缺 areaLayoutAnchor 等匯出錯誤曾讓狀態永遠停在 saving
        console.error('[map-editor autosave]', err)
        setAutosaveStatus('idle')
        setAutosaveTimeLabel(t('mapEditor.chrome.editingAutosave'))
      }
    }, 900)
    autosaveTimerRef.current = timer
    return () => {
      clearTimeout(timer)
    }
  }, [
    mapEditorMode,
    areas,
    basemaps,
    mapRouteGroups,
    mapRoutes,
    pointTopology,
    nextNumericId,
    mapPixelSize.width,
    mapPixelSize.height,
    mapPixelOrigin.x,
    mapPixelOrigin.y,
    loadedMapMeta.libraryId,
    loadedMapMeta.displayName,
    loadedMapMeta.version,
  ])

  /** 初次進入：MapAreaCanvas 自行 fit 畫布，無需額外捲動 */

  const loadTrajectoryFromEntry = useCallback(
    async (entry: VehicleTrajectoryEntry) => {
      const seq = ++trajectoryLoadSeqRef.current
      try {
        const url = new URL(entry.path, window.location.origin).href
        const res = await fetch(url)
        if (!res.ok) throw new Error(res.statusText)
        const json = await res.json()
        if (seq !== trajectoryLoadSeqRef.current) return
        const parsed = parseTrajectoryFileJson(json)
        setLoadedTrajectory(parsed)
        setReplayPlaying(false)
        setReplayHeadIndex(null)
      } catch (e) {
        if (seq !== trajectoryLoadSeqRef.current) return
        console.error(e)
        alert(t('mapEditor.chrome.trajectoryLoadFailed', { error: e instanceof Error ? e.message : String(e) }))
        setLoadedTrajectory(null)
      }
    },
    [],
  )

  const handleVehicleChange = useCallback(
    (vehicleId: string) => {
      setSelectedVehicleId(vehicleId)
      setTrajectoryImportMode(false)
      const catalog = getTrajectoryCatalogForVehicle(vehicleId)
      const storedId = getStoredTrajectoryEntryId(vehicleId)
      const fromStored = storedId
        ? catalog.find((e) => e.id === storedId)
        : null
      const pick = fromStored ?? getLatestTrajectoryEntry(vehicleId)
      if (pick) {
        setSelectedTrajectoryEntryId(pick.id)
        void loadTrajectoryFromEntry(pick)
      } else {
        setSelectedTrajectoryEntryId(null)
        setLoadedTrajectory(null)
        setReplayPlaying(false)
        setReplayHeadIndex(null)
      }
    },
    [loadTrajectoryFromEntry],
  )

  const handleTrajectoryEntryChange = useCallback(
    (entryId: string) => {
      if (entryId === '__import__') return
      const vid = selectedVehicleId
      if (!vid) return
      const catalog = getTrajectoryCatalogForVehicle(vid)
      const entry = catalog.find((e) => e.id === entryId)
      if (!entry) return
      setTrajectoryImportMode(false)
      setSelectedTrajectoryEntryId(entryId)
      setStoredTrajectoryEntryId(vid, entryId)
      void loadTrajectoryFromEntry(entry)
    },
    [selectedVehicleId, loadTrajectoryFromEntry],
  )

  const onImportTrajectoryFile = useCallback(
    async (file: File) => {
      if (!selectedVehicleId) {
        alert(t('mapEditor.chrome.selectVehicleFirst'))
        return
      }
      try {
        const raw = await file.text()
        const text = raw.replace(/^\uFEFF/, '')
        const json = JSON.parse(text) as unknown
        const parsed = parseTrajectoryFileJson(json)
        setLoadedTrajectory(parsed)
        setTrajectoryImportMode(true)
        setSelectedTrajectoryEntryId('__import__')
        setReplayPlaying(false)
        setReplayHeadIndex(null)
      } catch (e) {
        console.error(e)
        alert(t('mapEditor.chrome.trajectoryImportFailed', { error: e instanceof Error ? e.message : String(e) }))
      }
    },
    [selectedVehicleId],
  )

  const trajectoryEntriesForPanel = useMemo((): VehicleTrajectoryEntry[] => {
    if (!selectedVehicleId) return []
    const base = getTrajectoryCatalogForVehicle(selectedVehicleId)
    if (trajectoryImportMode) {
      return [
        {
          id: '__import__',
          path: '',
          label: t('mapEditor.chrome.importedFile'),
          updatedAt: new Date().toISOString(),
        },
        ...base,
      ]
    }
    return base
  }, [selectedVehicleId, trajectoryImportMode])

  /** 僅在軌跡工作區時更新 */
  const onTrajectoryViewportCenterMeters = useCallback(
    (m: { x: number; y: number }) => {
      if (workspaceRef.current !== 'trajectory') return
      setTrajectoryViewportCenterMeters(m)
    },
    [],
  )

  const playTrajectory = useCallback(() => {
    if (!loadedTrajectory || loadedTrajectory.points.length === 0) return
    setReplayHeadIndex((idx) => {
      if (idx === null) return 0
      if (idx >= loadedTrajectory.points.length - 1) return 0
      return idx
    })
    setReplayPlaying(true)
  }, [loadedTrajectory])

  const pauseTrajectory = useCallback(() => {
    setReplayPlaying(false)
  }, [])

  /** 點選原始數據列：跳到該點、暫停，之後播放從該點繼續 */
  const seekTrajectoryToIndex = useCallback(
    (index: number) => {
      if (!loadedTrajectory || loadedTrajectory.points.length === 0) return
      if (index < 0 || index >= loadedTrajectory.points.length) return
      setReplayPlaying(false)
      setReplayHeadIndex(index)
      requestAnimationFrame(() => {
        scrollViewportToTrajectoryHead(
          trajectoryViewportRef.current,
          trajectoryScaleXRef.current,
          trajectoryScaleYRef.current,
          loadedTrajectory.points,
          index,
        )
      })
    },
    [loadedTrajectory],
  )

  const rewindTrajectory = useCallback(() => {
    if (!loadedTrajectory || loadedTrajectory.points.length === 0) return
    setReplayPlaying(false)
    setReplayHeadIndex(0)
  }, [loadedTrajectory])

  const locateTrajectoryVehicle = useCallback(() => {
    if (!loadedTrajectory || loadedTrajectory.points.length === 0) return
    requestAnimationFrame(() => {
      scrollViewportToTrajectoryHead(
        trajectoryViewportRef.current,
        trajectoryScaleXRef.current,
        trajectoryScaleYRef.current,
        loadedTrajectory.points,
        replayHeadIndex,
      )
    })
  }, [loadedTrajectory, replayHeadIndex])

  const trajectoryMapMismatch = useMemo(() => {
    if (!loadedTrajectory?.mapId) return false
    return loadedTrajectory.mapId !== loadedMapMeta.mapId
  }, [loadedTrajectory, loadedMapMeta.mapId])

  /**
   * 僅在「載入／更換軌跡檔」且當下在軌跡分頁時自動對準軌跡。
   * 分頁切換不觸發，避免捲動與縮放視角被重設、看起來像中心跑掉或內容消失。
   */
  useEffect(() => {
    if (workspaceRef.current !== 'trajectory') return
    if (!loadedTrajectory || loadedTrajectory.points.length === 0) return
    requestAnimationFrame(() => {
      scrollViewportToTrajectoryMeters(
        trajectoryViewportRef.current,
        trajectoryScaleXRef.current,
        trajectoryScaleYRef.current,
        loadedTrajectory.points,
      )
    })
  }, [loadedTrajectory])

  useEffect(() => {
    if (!replayPlaying || !loadedTrajectory) return
    const n = loadedTrajectory.points.length
    if (n <= 1) {
      setReplayPlaying(false)
      return
    }
    if (replayHeadIndex === null) return
    if (replayHeadIndex >= n - 1) {
      setReplayPlaying(false)
      return
    }
    const cur = loadedTrajectory.points[replayHeadIndex]
    const next = loadedTrajectory.points[replayHeadIndex + 1]
    const dt = Math.max(80, next.tMs - cur.tMs)
    const t = window.setTimeout(() => {
      setReplayHeadIndex((i) => (i === null ? 0 : i + 1))
    }, dt)
    return () => clearTimeout(t)
  }, [replayPlaying, replayHeadIndex, loadedTrajectory])

  const onCenterMap = useCallback(() => {
    mapViewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }, [])

  const onMapDisplayNameChange = useCallback((value: string) => {
    setLoadedMapMeta((m) => ({ ...m, displayName: value }))
  }, [])

  const onMapVersionChange = useCallback((value: string) => {
    setLoadedMapMeta((m) => ({ ...m, version: value }))
  }, [])

  const selectedArea = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  )

  const selectedBasemap = useMemo(
    () => basemaps.find((b) => b.id === selectedBasemapId) ?? null,
    [basemaps, selectedBasemapId],
  )

  const selectedFacility = useMemo(() => {
    if (selectedAreaId === null || primarySelectedFacilityId === null) return null
    const area = areas.find((a) => a.id === selectedAreaId)
    return area?.facilities.find((f) => f.id === primarySelectedFacilityId) ?? null
  }, [areas, selectedAreaId, primarySelectedFacilityId])

  /** 選取停靠點／途經點／軌道且尚未有場域語意時，用圖台映射靜默補齊（不寫 undo） */
  useEffect(() => {
    if (mapEditorMode !== 'edit') return
    if (!selectedFacility || !selectedArea) return
    const seededPos = applyAutoRefFieldPositionIfUnset(
      selectedFacility,
      selectedArea,
      basemaps,
    )
    const seeded = applyAutoRefFieldBoundsIfUnset(
      seededPos,
      selectedArea,
      basemaps,
    )
    /*
     * 軌道：場域座標照<strong>它接到誰</strong>來定，不是照圖台映射猜。
     *
     * 圖台映射是拿「這個像素落在哪一塊的範圍內」反推的，但示意圖各段的比例尺差很多
     * （正線 0.17 公尺/像素、T3 支線 1.25 公尺/像素，差七倍），畫面上隔很遠、被壓得
     * 很扁的那一塊算出來的偏移量反而比正下方那塊小——新放在 T3 轉角的一塊斜接因此
     * 有兩個角被判給正線，座標差了 180 公尺。
     *
     * 軌道是接起來的，端面的意義就是「這裡接上隔壁」，所以答案在隔壁的 .xodr 中心線
     * 端點上。推得出來就用推的，推不出來（兩端都沒有相接的方塊）才留給圖台映射。
     */
    if (seeded.type === 'Track' && !getTrackGenPaths(seeded.parameters)) {
      const probeArea = {
        ...selectedArea,
        facilities: selectedArea.facilities.map((f) =>
          (f.id === seeded.id ? seeded : f),
        ),
      }
      const linked = deriveShapedTrackPathsInAreas([probeArea])
      const got = linked.areas[0]?.facilities.find((f) => f.id === seeded.id)
      if (got && getTrackGenPaths(got.parameters)) {
        mapAreaFacilities(selectedArea.id, (facilities) =>
          facilities.map((f) => (f.id === got.id ? got : f)),
        )
        return
      }
    }
    if (seeded === selectedFacility) return
    mapAreaFacilities(selectedArea.id, (facilities) =>
      facilities.map((f) => (f.id === seeded.id ? seeded : f)),
    )
  }, [mapEditorMode, selectedFacility, selectedArea, basemaps, mapAreaFacilities])

  const selectedAreaDomainMaxM = useMemo(() => {
    if (!selectedArea) return undefined
    return {
      w: domainWidthM(selectedArea.domain),
      h: domainHeightM(selectedArea.domain),
    }
  }, [selectedArea])

  const onInspectorFieldFocus = useCallback(() => {
    if (!inspectorEditPushedRef.current) {
      pushHistory()
      inspectorEditPushedRef.current = true
    }
  }, [pushHistory])

  const onInspectorFieldBlur = useCallback(() => {
    inspectorEditPushedRef.current = false
  }, [])

  const mapSelectedFacility = useCallback(
    (
      fn: (f: FacilityObject, area: MapAreaObject) => FacilityObject,
    ) => {
      const areaId = selectedAreaIdRef.current
      const ids = selectedFacilityIdsRef.current
      const facilityId = ids[ids.length - 1] ?? null
      if (!areaId || !facilityId) return
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) => {
          if (f.id !== facilityId) return f
          const area = areasRef.current.find((a) => a.id === areaId)
          if (!area) return f
          return fn(f, area)
        }),
      )
    },
    [mapAreaFacilities],
  )

  const onChangeAreaId = useCallback(
    (newId: string) => {
      const areaId = selectedAreaIdRef.current
      if (!areaId) return
      pushHistory()
      setAreas((prev) =>
        prev.map((a) => (a.id === areaId ? { ...a, id: newId } : a)),
      )
      updateSelection(newId, selectedFacilityIdsRef.current)
    },
    [pushHistory, updateSelection],
  )

  const onChangeId = useCallback(
    (newId: string) => {
      const areaId = selectedAreaIdRef.current
      const ids = selectedFacilityIdsRef.current
      const facilityId = ids[ids.length - 1] ?? null
      if (!areaId || !facilityId) return
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) => {
          if (f.id !== facilityId) return f
          const base = { ...(f.parameters ?? {}) } as Record<string, unknown>
          delete base.mqttCategory
          const nextParams = { ...base, mqttInstanceId: newId }
          return { ...f, id: newId, parameters: nextParams } as FacilityObject
        }),
      )
      updateSelection(
        areaId,
        selectedFacilityIdsRef.current.map((id) =>
          id === facilityId ? newId : id,
        ),
      )
    },
    [mapAreaFacilities, updateSelection],
  )

  const updateSelected = useCallback(
    (patch: Partial<FacilityObject>) => {
      mapSelectedFacility((f) => ({ ...f, ...patch }) as FacilityObject)
    },
    [mapSelectedFacility],
  )

  const patchSelectedSlot = useCallback(
    (
      patch: Partial<
        Pick<
          SlotFacility,
          | 'slotOccupancy'
          | 'slotEquipmentState'
          | 'slotOccupancyEnabled'
          | 'slotEquipmentEnabled'
        >
      >,
    ) => {
      pushHistory()
      mapSelectedFacility((f) => {
        if (f.type !== 'Slot') return f
        let next: SlotFacility = { ...f }
        if (patch.slotOccupancy !== undefined)
          next.slotOccupancy = patch.slotOccupancy
        if (patch.slotEquipmentState !== undefined)
          next.slotEquipmentState = patch.slotEquipmentState
        if ('slotOccupancyEnabled' in patch) {
          next.slotOccupancyEnabled =
            patch.slotOccupancyEnabled &&
            Object.keys(patch.slotOccupancyEnabled).length > 0
              ? patch.slotOccupancyEnabled
              : undefined
        }
        if ('slotEquipmentEnabled' in patch) {
          next.slotEquipmentEnabled =
            patch.slotEquipmentEnabled &&
            Object.keys(patch.slotEquipmentEnabled).length > 0
              ? patch.slotEquipmentEnabled
              : undefined
        }
        return next as FacilityObject
      })
    },
    [pushHistory, mapSelectedFacility],
  )

  const facilityFromPaletteItem = useCallback(
    (
      // 場域與軌道生成是跟 Area 同層的東西，不會變成設施
      item: Exclude<PaletteItem, { type: 'Area' } | { type: 'TrackGen' }>,
      id: string,
      areaPosition: { x: number; y: number },
      positionMeters: { x: number; y: number },
    ): FacilityObject => {
      if (item.type === 'Slot') {
        return {
          id,
          type: 'Slot',
          name: item.name,
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          slotOccupancy: getDefaultSlotOccupancy(),
          slotEquipmentState: getDefaultSlotEquipmentState(),
        }
      }
      if (item.type === 'Facility') {
        if (item.name === 'ZoneEntrance') {
          return {
            id,
            type: 'Facility',
            name: 'ZoneEntrance',
            customName: '',
            areaPosition,
            position: positionMeters,
            rotation: 0,
            currentState: 'Normal',
            parameters: {
              defaultFillColor: 'transparent',
              strokeWidthPx: 2,
              strokeColor: '#22d3ee',
              strokeStyle: 'dashed',
              [ZONE_ENTRANCE_LINKS_KEY]: [],
              ...defaultRefFieldParametersForType('Facility'),
            },
          }
        }
        if (item.name === 'ZonePartition') {
          return {
            id,
            type: 'Facility',
            name: 'ZonePartition',
            customName: '',
            areaPosition,
            position: positionMeters,
            rotation: 0,
            currentState: 'Normal',
            parameters: {
              defaultFillColor: 'rgba(34, 211, 238, 0.06)',
              strokeWidthPx: 1,
              strokeColor: '#22d3ee',
              strokeStyle: 'solid',
              ...defaultRefFieldParametersForType('Facility'),
            },
          }
        }
        return {
          id,
          type: 'Facility',
          name: 'FacilityArea',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: 'Normal',
          parameters: {
            purpose: '',
            remarks: '',
            defaultFillColor: '#1e293b',
            colorRules: [],
            ...defaultRefFieldParametersForType('Facility'),
          },
        }
      }
      if (item.type === 'Geofence') {
        // 地圖編輯器不再建立電子圍籬（請至虛擬圍籬管理）
        throw new Error('Geofence is not creatable in map editor')
      }
      if (item.type === 'Signal') {
        return {
          id,
          type: 'Signal',
          name: item.name,
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('Signal'),
          parameters: {
            mountDirection: 'down',
            defaultLamp: 'offline',
            iconRules: [],
            ...defaultRefFieldParametersForType('Signal'),
          },
        }
      }
      if (item.type === 'DockingPoint') {
        const stationId = generateNextStationId(areasRef.current ?? [])
        return {
          id,
          type: 'DockingPoint',
          name: 'DockingPoint',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('DockingPoint'),
          parameters: {
            stationId,
            purpose: '',
            ...defaultRefFieldParametersForType('DockingPoint'),
            labelStyle: { visible: false },
          },
        }
      }
      if (item.type === 'Waypoint') {
        const waypointCode = generateNextWaypointCode(areasRef.current ?? [])
        return {
          id,
          type: 'Waypoint',
          name: 'Waypoint',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('Waypoint'),
          parameters: {
            waypointCode,
            ...defaultRefFieldParametersForType('Waypoint'),
            labelStyle: { visible: false },
          },
        }
      }
      if (item.type === 'RoadLine') {
        return {
          id,
          type: 'RoadLine',
          name: 'RoadLine',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('RoadLine'),
          parameters: {
            ...defaultRoadLineParameters(),
          },
        }
      }
      if (item.type === 'Basemap') {
        return {
          id,
          type: 'Basemap',
          name: 'Basemap',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('Basemap'),
          parameters: {
            ...defaultBasemapParameters(),
          },
        }
      }
      if (item.type === 'Track' && item.name === 'RailTaper') {
        return {
          id,
          type: 'Track',
          name: 'RailTaper',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('Track'),
          parameters: {
            ...defaultRefFieldParametersForType('Track'),
            [TAPER_TRACK_KEY]: { ...DEFAULT_TAPER_TRACK },
          },
        }
      }
      if (item.type === 'Track' && item.name === 'RailCorner') {
        return {
          id,
          type: 'Track',
          name: 'RailCorner',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('Track'),
          parameters: {
            ...defaultRefFieldParametersForType('Track'),
            [CORNER_TRACK_KEY]: { ...DEFAULT_CORNER_TRACK },
          },
        }
      }
      return {
        id,
        type: item.type,
        name: item.name,
        customName: '',
        areaPosition,
        position: positionMeters,
        rotation: 0,
        currentState: getDefaultStateForType(item.type),
        parameters: {
          ...defaultRefFieldParametersForType(item.type),
        },
      }
    },
    [],
  )

  const addFromPalette = useCallback(
    (item: PaletteItem) => {
      const ps = mapPixelSizeRef.current
      const mapCenter = { x: ps.width / 2, y: ps.height / 2 }
      if (isBasemapPaletteItem(item) || isTrackGenPaletteItem(item)) {
        pushHistory()
        const id = String(nextNumericId).padStart(3, '0')
        const trackGen = isTrackGenPaletteItem(item)
        const sizePx = defaultMapChromeSizePxForDrop(
          trackGen ? 'trackGen' : 'basemap',
          ps,
        )
        const blank = createBlankBasemap(id, mapCenter, sizePx)
        const newBasemap = trackGen
          ? {
              ...blank,
              customName: t('mapEditor.chrome.trackGenName', { id }),
              parameters: { ...blank.parameters, ...defaultTrackGenParameters() },
            }
          : blank
        setBasemaps((prev) => [...prev, newBasemap])
        selectedBasemapIdRef.current = id
        setSelectedBasemapId(id)
        updateSelection(null, [])
        setAllAreasSelected(false)
        setNextNumericId((n) => n + 1)
        return
      }
      if (!isAreaPaletteItem(item)) return
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      const { w, h } = defaultMapChromeSizePxForDrop('area', ps)
      const newArea: MapAreaObject = {
        ...createBlankArea(id, ps),
        customName: `Area ${id}`,
        layout: {
          xPx: Math.max(0, (ps.width - w) / 2),
          yPx: Math.max(0, (ps.height - h) / 2),
          wPx: w,
          hPx: h,
          borderPx: 0,
          borderColor: 'transparent',
        },
      }
      setAreas((prev) => [...prev, newArea])
      updateSelection(id, [])
      setNextNumericId((n) => n + 1)
    },
    [pushHistory, nextNumericId, updateSelection],
  )

  const onPaletteDropArea = useCallback(
    (_item: PaletteItem, mapPointPx: { x: number; y: number }) => {
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      const ps = mapPixelSizeRef.current
      const { w, h } = defaultMapChromeSizePxForDrop('area', ps)
      const newArea: MapAreaObject = {
        ...createBlankArea(id, ps),
        customName: `Area ${id}`,
        layout: {
          xPx: Math.max(0, Math.min(mapPointPx.x - w / 2, ps.width - w)),
          yPx: Math.max(0, Math.min(mapPointPx.y - h / 2, ps.height - h)),
          wPx: w,
          hPx: h,
          borderPx: 0,
          borderColor: 'transparent',
        },
      }
      setAreas((prev) => [...prev, newArea])
      updateSelection(id, [])
      setNextNumericId((n) => n + 1)
    },
    [pushHistory, nextNumericId, updateSelection],
  )

  const onPaletteDropBasemap = useCallback(
    (item: PaletteItem, mapPointPx: { x: number; y: number }) => {
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      const trackGen = isTrackGenPaletteItem(item)
      const ps = mapPixelSizeRef.current
      const sizePx = defaultMapChromeSizePxForDrop(
        trackGen ? 'trackGen' : 'basemap',
        ps,
      )
      const blank = createBlankBasemap(id, mapPointPx, sizePx)
      const newBasemap = trackGen
        ? {
            ...blank,
            customName: t('mapEditor.chrome.trackGenName', { id }),
            parameters: { ...blank.parameters, ...defaultTrackGenParameters() },
          }
        : blank
      setBasemaps((prev) => [...prev, newBasemap])
      selectedBasemapIdRef.current = id
      setSelectedBasemapId(id)
      updateSelection(null, [])
      setAllAreasSelected(false)
      setNextNumericId((n) => n + 1)
    },
    [pushHistory, nextNumericId, updateSelection],
  )

  /**
   * 把軌道生成的結果變成真正的設施。
   *
   * 產出一個新的 Area 裝它們，而不是塞進既有的 Area：生成的是一整套座標系，
   * 混進別人的 Area 會與那裡既有的設施座標打架。使用者要合併時再自己搬。
   */
  /**
   * 生成軌道：直接在地圖上建出真正的軌道元件。
   *
   * 中間不畫任何示意圖形——使用者要的就是圓角／斜接／一般軌道那些可以個別拉伸、
   * 設屬性、被車輛投影命中的元件。多畫一層藍色示意方塊只是讓人多按一次按鈕。
   *
   * result 由呼叫端直接帶進來：剛算完的結果還沒寫回 state，從參數讀會拿到上一次的。
   */
  const onApplyTrackGen = useCallback(
    (
      basemapId: string,
      /** 對話框排好的版面：預覽與套用吃同一份，不再各排一次 */
      prebuilt?: TrackGenLayout,
      /** 預覽上分好的組：軌道照組的頭字加順序命名、照組的底色上色 */
      groups: TrackGenGroup[] = [],
    ) => {
      const basemap = basemapsRef.current.find((b) => b.id === basemapId)
      if (!basemap || !prebuilt || !prebuilt.shapes.length) return

      pushHistory()
      let seq = nextNumericId
      const built = buildFacilitiesFromLayout(
        prebuilt,
        () => String(seq++).padStart(3, '0'),
        groups,
      )

      const areaId = String(seq++).padStart(3, '0')
      const ps = mapPixelSizeRef.current
      const blank = createBlankArea(areaId, ps)
      const area: MapAreaObject = {
        ...blank,
        customName: t('mapEditor.chrome.trackGenArea', { name: basemap.customName || t('mapEditor.chrome.trackGenDefault') }),
        /*
         * 生成出來的東西<strong>完全沿用軌道生成元件的框</strong>——同位置、同寬、同高。
         *
         * 先前高度是照示意版面的長寬比另外算的：橫向放大 9 倍會讓 ㄩ 形變得又高又
         * 窄，算出來的高度遠超過使用者拉好的框，生成完就整片溢出畫面。
         *
         * 現在寬高就是使用者事先拉好的比例：他把路網拉到滿意的大小，按下生成，軌道
         * 就落在同樣大小的矩形裡。網域對映因此是非等比的（橫向與縱向各自縮放），
         * 與元件裡的中心線畫法一致。
         *
         * 位置也<strong>疊在元件上</strong>——同一個矩形，生成的軌道就直接蓋在原本那張
         * 路網圖上面，兩者對得起來。擺在正下方的話等於另外開一塊，反而看不出對應。
         */
        /*
         * 使用者指定了一塊軌道多大時，Area 直接用<strong>版面本身的像素範圍</strong>。
         *
         * 沿用元件的框會把版面再壓縮一次——實測要 60×20 的軌道，出來是 49×10。
         * 範圍與框相同時對映是 1:1，拉出來多大就是多大。沒有指定時仍沿用元件的框。
         */
        layout: (() => {
          const wPx = Math.max(40, Math.round(built.extentM.wM))
          const hPx = Math.max(40, Math.round(built.extentM.hM))
          /*
           * 疊在元件上，但整塊要留在畫布裡。
           *
           * 生成出來的大小已經由對話框保證塞得進畫布，可是位置是沿用元件的；元件擺在
           * 靠下方時，1647 × 630 的軌道從 y=170 開始就會掉出 640 高的畫布外（實測
           * 底邊到 800）。所以位置往回夾，寬高不動。
           */
          const clamp = (v: number, span: number, limit: number) =>
            Math.max(0, Math.min(v, Math.max(0, limit - span)))
          return {
            ...blank.layout,
            xPx: clamp(basemap.layout.xPx, wPx, ps.width),
            yPx: clamp(basemap.layout.yPx, hPx, ps.height),
            wPx,
            hPx,
          }
        })(),
        domain: {
          xMinM: 0,
          xMaxM: built.extentM.wM,
          yMinM: 0,
          yMaxM: built.extentM.hM,
        },
        facilities: [],
      }

      const facilities = built.facilities.map((f) => {
        const pxPerX = area.layout.wPx / built.extentM.wM
        const pxPerY = area.layout.hPx / built.extentM.hM
        const areaSizePx = {
          w: Math.max(1, f.box.wM * pxPerX),
          h: Math.max(1, f.box.hM * pxPerY),
        }
        // ensureFacilityDualCoords 會補上 areaLayoutAnchor；缺了 autosave 匯出會炸掉
        return ensureFacilityDualCoords(
          {
            id: f.id,
            type: f.type,
            name: f.name,
            customName: f.customName,
            // 版面座標的 y 向下，areaPosition 的原點在左下、y 向上
            areaPosition: {
              x: f.box.xM * pxPerX,
              y: area.layout.hPx - (f.box.yM + f.box.hM) * pxPerY,
            },
            areaSizePx,
            position: {
              x: f.box.xM,
              y: built.extentM.hM - f.box.yM - f.box.hM,
            },
            rotation: f.rotation,
            currentState: null,
            parameters: f.parameters,
          } as unknown as FacilityObject,
          area.domain,
          area.layout,
        )
      })

      /*
       * 重跑時取代上一次生成的那個 Area。
       *
       * 不取代的話每按一次「重新生成」就多一份，畫面上疊成好幾層一樣的軌道，
       * 使用者還得自己去刪。
       */
      const prevAreaId = getTrackGenAreaId(basemap.parameters)
      setAreas((prev) => {
        const kept = prevAreaId ? prev.filter((a) => a.id !== prevAreaId) : prev
        // 新生成的軌道：相接處直接建成接點（現場座標只存一份）
        return [...kept, settleTrackJointsInAreas([{ ...area, facilities }]).areas[0]!]
      })
      setBasemaps((prev) =>
        prev.map((b) =>
          b.id === basemapId
            ? { ...b, parameters: { ...(b.parameters ?? {}), [TRACKGEN_AREA_ID_KEY]: areaId } }
            : b,
        ),
      )
      setNextNumericId(seq)
      /*
       * 生成完<strong>維持選取生成元件</strong>，不要跳去選新的 Area。
       *
       * Area 完全疊在元件上，選取一跳走就再也點不到底下的元件——「重新生成」與
       * 「更換路網」那兩顆按鈕會連同工具列一起消失。留著選取，改完參數可以直接
       * 再按一次。
       */
      clearSelection()
      selectedBasemapIdRef.current = basemapId
      setSelectedBasemapId(basemapId)
    },
    [clearSelection, nextNumericId, pushHistory],
  )

  const onPatchBasemapLayout = useCallback((basemapId: string, layout: MapBasemapLayout) => {
    setBasemaps((prev) =>
      prev.map((b) => (b.id === basemapId ? { ...b, layout } : b)),
    )
  }, [])

  const onPatchBasemapParameters = useCallback(
    (basemapId: string, patch: Record<string, unknown>) => {
      setBasemaps((prev) =>
        prev.map((b) =>
          b.id === basemapId
            ? {
                ...b,
                parameters: { ...(b.parameters ?? {}), ...patch },
              }
            : b,
        ),
      )
    },
    [],
  )

  const onBasemapLayoutSessionStart = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  const onBasemapBringToFront = useCallback(
    (basemapId: string) => {
      pushHistory()
      setBasemaps((prev) => {
        const idx = prev.findIndex((b) => b.id === basemapId)
        if (idx < 0) return prev
        const target = prev[idx]
        const { below, above } = partitionMapBasemaps(prev)
        const alreadyAbove = isBasemapAboveAreas(target.parameters)

        if (!alreadyAbove) {
          return prev.map((b) =>
            b.id === basemapId
              ? {
                  ...b,
                  parameters: {
                    ...b.parameters,
                    [BASEMAP_ABOVE_AREAS_KEY]: true,
                  },
                }
              : b,
          )
        }

        if (above.length <= 1) return prev
        const tierIdx = above.findIndex((b) => b.id === basemapId)
        if (tierIdx < 0 || tierIdx >= above.length - 1) return prev
        const nextAbove = [...above]
        const [item] = nextAbove.splice(tierIdx, 1)
        nextAbove.push(item)
        return [...below, ...nextAbove]
      })
    },
    [pushHistory],
  )

  const onBasemapSendToBack = useCallback(
    (basemapId: string) => {
      pushHistory()
      setBasemaps((prev) => {
        const idx = prev.findIndex((b) => b.id === basemapId)
        if (idx < 0) return prev
        const target = prev[idx]
        const { below, above } = partitionMapBasemaps(prev)
        const alreadyAbove = isBasemapAboveAreas(target.parameters)

        if (alreadyAbove) {
          return prev.map((b) =>
            b.id === basemapId
              ? {
                  ...b,
                  parameters: {
                    ...b.parameters,
                    [BASEMAP_ABOVE_AREAS_KEY]: false,
                  },
                }
              : b,
          )
        }

        if (below.length <= 1) return prev
        const tierIdx = below.findIndex((b) => b.id === basemapId)
        if (tierIdx <= 0) return prev
        const nextBelow = [...below]
        const [item] = nextBelow.splice(tierIdx, 1)
        nextBelow.unshift(item)
        return [...nextBelow, ...above]
      })
    },
    [pushHistory],
  )

  const onPaletteDropFacility = useCallback(
    (
      areaId: string,
      item: PaletteItem,
      areaPositionCenter: { x: number; y: number },
    ) => {
      if (
        isAreaPaletteItem(item) ||
        isBasemapPaletteItem(item) ||
        isTrackGenPaletteItem(item)
      ) {
        return
      }
      // 電子圍籬僅在「虛擬圍籬管理」；地圖編輯器不可新增
      if (item.type === 'Geofence') return
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area) return
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      // 大小照容器換算，不是固定的世界像素——見 defaultAreaSizePxForDrop
      const sizePx = defaultAreaSizePxForDrop(item.type, item.name, area.domain, area.layout)
      const cssTopLeft = {
        left: areaPositionCenter.x - sizePx.w / 2,
        top: areaPositionCenter.y - sizePx.h / 2,
      }
      const areaPosition = cssTopLeftToAreaPosition(
        cssTopLeft,
        sizePx,
        area.layout.hPx,
      )
      const positionMeters = fieldPositionFromArea(
        areaPosition,
        area.domain,
        area.layout,
      )
      const newFacility = applyAutoRefFieldBoundsIfUnset(
        applyAutoRefFieldPositionIfUnset(
          ensureFacilityDualCoords(
            {
              ...facilityFromPaletteItem(item, id, areaPosition, positionMeters),
              areaSizePx: sizePx,
            } as FacilityObject,
            area.domain,
            area.layout,
          ),
          area,
          basemapsRef.current,
        ),
        area,
        basemapsRef.current,
      )
      mapAreaFacilities(areaId, (facilities) => [...facilities, newFacility])
      updateSelection(areaId, [id])
      setNextNumericId((n) => n + 1)
    },
    [
      pushHistory,
      nextNumericId,
      facilityFromPaletteItem,
      mapAreaFacilities,
      updateSelection,
    ],
  )

  const pasteFromClipboard = useCallback(() => {
    const c = clipboardRef.current
    const areaId = selectedAreaIdRef.current ?? areasRef.current[0]?.id
    if (!c || !areaId) return
    pushHistory()
    const id = String(nextNumericId).padStart(3, '0')
    const area = areasRef.current.find((a) => a.id === areaId)
    const newFacility: FacilityObject = area
      ? facilityWithAreaPosition(
          {
            ...structuredClone(c),
            id,
            rotation: normalizeDegrees(c.rotation ?? 0),
            parameters: (() => {
              const p = c.parameters ? { ...c.parameters } : {}
              delete (p as Record<string, unknown>).mqttCategory
              return { ...p, mqttInstanceId: id }
            })(),
          } as FacilityObject,
          { x: c.areaPosition.x + 20, y: c.areaPosition.y + 20 },
          area.domain,
          area.layout,
        )
      : {
          ...structuredClone(c),
          id,
          rotation: normalizeDegrees(c.rotation ?? 0),
          areaPosition: {
            x: c.areaPosition.x + 20,
            y: c.areaPosition.y + 20,
          },
          position: {
            x: c.position.x + 2,
            y: c.position.y + 2,
          },
          parameters: (() => {
            const p = c.parameters ? { ...c.parameters } : {}
            delete (p as Record<string, unknown>).mqttCategory
            return { ...p, mqttInstanceId: id }
          })(),
        }
    /*
     * 複製出來的是「一樣形狀的方塊」，不是「同一段路」。
     * 生成軌道的現場身分留在本尊身上，見 trackGenIdentity。
     */
    const freshFacility = facilityCopyWithoutZoneBinding(
      facilityCopyWithoutTrackGenIdentity(newFacility, areasRef.current ?? []),
    )
    const typedFacility =
      freshFacility.type === 'Waypoint'
        ? ensureWaypointCode(
            {
              ...freshFacility,
              parameters: {
                ...(freshFacility.parameters ?? {}),
                waypointCode: generateNextWaypointCode(areasRef.current ?? []),
              },
            },
            areasRef.current ?? [],
          )
        : freshFacility.type === 'DockingPoint'
          ? {
              ...freshFacility,
              parameters: {
                ...(freshFacility.parameters ?? {}),
                stationId: generateNextStationId(areasRef.current ?? []),
              },
            }
          : freshFacility
    const placedFacility = area
      ? applyAutoRefFieldBoundsIfUnset(
          applyAutoRefFieldPositionIfUnset(typedFacility, area, basemapsRef.current),
          area,
          basemapsRef.current,
        )
      : typedFacility
    /*
     * 貼進分區裡的設施：場域範圍照它<strong>貼到的位置</strong>重算。
     * 沿用來源那一份等於宣稱自己在現場的同一個地方，兩塊會疊在一起。
     */
    const pastedFacility = area
      ? syncZoneChildFieldFromPlacement(placedFacility, {
          ...area,
          facilities: [...area.facilities, placedFacility],
        })
      : placedFacility
    mapAreaFacilities(areaId, (facilities) => [...facilities, pastedFacility])
    updateSelection(areaId, [id])
    setNextNumericId((n) => n + 1)
  }, [nextNumericId, pushHistory, mapAreaFacilities, updateSelection])

  const deleteSelected = useCallback(() => {
    const basemapId = selectedBasemapIdRef.current
    if (basemapId) {
      pushHistory()
      setBasemaps((prev) => prev.filter((b) => b.id !== basemapId))
      selectedBasemapIdRef.current = null
      setSelectedBasemapId(null)
      return
    }
    const areaId = selectedAreaIdRef.current
    const facilityIds = selectedFacilityIdsRef.current
    if (!areaId) return
    pushHistory()
    if (facilityIds.length > 0) {
      const remove = new Set(facilityIds)
      mapAreaFacilities(areaId, (facilities) =>
        facilities.filter((f) => !remove.has(f.id)),
      )
      updateSelection(areaId, [])
      return
    }
    setAreas((prev) => prev.filter((a) => a.id !== areaId))
    clearSelection()
  }, [pushHistory, mapAreaFacilities, updateSelection, clearSelection])

  const onDragSessionStart = useCallback(() => {
    pushHistory()
    const areaId = selectedAreaIdRef.current
    const ids = selectedFacilityIdsRef.current
    if (!areaId) {
      multiDragStartRef.current = null
      return
    }
    const area = areasRef.current.find((a) => a.id === areaId)
    if (!area) {
      multiDragStartRef.current = null
      return
    }
    /** 分區拖曳／縮放前先鎖定子設施相對位置 */
    const zoneIds = ids.filter((id) => {
      const f = area.facilities.find((x) => x.id === id)
      return f != null && isZonePartition(f)
    })
    if (zoneIds.length > 0) {
      mapAreaFacilities(areaId, (facilities) => {
        let next = facilities
        for (const zid of zoneIds) {
          next = ensureZoneChildrenLocalFields(next, zid, {
            ...area,
            facilities: next,
          })
        }
        return next
      })
    }

    if (ids.length <= 1) {
      multiDragStartRef.current = null
      return
    }
    const areaPositions: Record<string, { x: number; y: number }> = {}
    for (const id of ids) {
      const f = area.facilities.find((x) => x.id === id)
      if (f && f.type !== 'Geofence') {
        areaPositions[id] = { x: f.areaPosition.x, y: f.areaPosition.y }
      }
    }
    multiDragStartRef.current =
      Object.keys(areaPositions).length > 1 ? { areaId, areaPositions } : null
  }, [mapAreaFacilities, pushHistory])

  const onDragFacility = useCallback(
    (
      areaId: string,
      facilityId: string,
      update: {
        areaPosition: { x: number; y: number }
        position: { x: number; y: number }
      },
    ) => {
      const area = areasRef.current.find((a) => a.id === areaId)
      const session = multiDragStartRef.current
      const multiDrag =
        session &&
        session.areaId === areaId &&
        session.areaPositions[facilityId] &&
        Object.keys(session.areaPositions).length > 1

      if (multiDrag && area) {
        const start = session.areaPositions[facilityId]!
        const dx = update.areaPosition.x - start.x
        const dy = update.areaPosition.y - start.y
        mapAreaFacilities(areaId, (facilities) => {
          let next = facilities.map((fac) => {
            const origin = session.areaPositions[fac.id]
            if (!origin || fac.type === 'Geofence') return fac
            const nextAreaPos = { x: origin.x + dx, y: origin.y + dy }
            const moved = facilityWithAreaPosition(
              fac,
              nextAreaPos,
              area.domain,
              area.layout,
            )
            return syncZoneChildFieldFromPlacement(
              syncAutoRefFieldPositionFromPlacement(
                clampFacilityInsideParentZone(moved, area),
                area,
                basemapsRef.current,
              ),
              area,
            )
          })
          for (const id of Object.keys(session.areaPositions)) {
            const fac = next.find((x) => x.id === id)
            if (fac && isZonePartition(fac)) {
              next = rematerializeZoneChildrenOntoZoneCanvas(next, id, {
                ...area,
                facilities: next,
              })
            }
          }
          return next
        })
        return
      }

      mapAreaFacilities(areaId, (facilities) => {
        const areaNow = areasRef.current.find((a) => a.id === areaId)
        if (!areaNow) return facilities
        let next = facilities.map((fac) => {
          if (fac.id !== facilityId) return fac
          if (fac.type === 'Geofence') return fac
          return syncZoneChildFieldFromPlacement(
            syncAutoRefFieldPositionFromPlacement(
              clampFacilityInsideParentZone(
                facilityWithAreaPosition(
                  fac,
                  update.areaPosition,
                  areaNow.domain,
                  areaNow.layout,
                ),
                areaNow,
              ),
              areaNow,
              basemapsRef.current,
            ),
            areaNow,
          )
        })
        const moved = next.find((x) => x.id === facilityId)
        if (moved && isZonePartition(moved)) {
          next = rematerializeZoneChildrenOntoZoneCanvas(next, facilityId, {
            ...areaNow,
            facilities: next,
          })
        }
        return next
      })
    },
    [mapAreaFacilities],
  )

  const onFacilityHover = useCallback(
    (areaId: string, facilityId: string, hovered: boolean) => {
      if (hovered) {
        hoveredFacilityRef.current = { areaId, facilityId }
        return
      }
      const cur = hoveredFacilityRef.current
      if (cur?.areaId === areaId && cur.facilityId === facilityId) {
        hoveredFacilityRef.current = null
      }
    },
    [],
  )

  const nudgeHoveredFacility = useCallback(
    (deltaAreaPx: { x: number; y: number }) => {
      // 優先：有選取的設施時，移動所有已選取的設施
      const selAreaId = selectedAreaIdRef.current
      const selIds = selectedFacilityIdsRef.current
      if (selAreaId && selIds.length > 0) {
        const area = areasRef.current.find((a) => a.id === selAreaId)
        if (!area) return
        const selSet = new Set(selIds)
        mapAreaFacilities(selAreaId, (facilities) =>
          facilities.map((f) => {
            if (!selSet.has(f.id) || f.type === 'Geofence') return f
            return syncAutoRefFieldPositionFromPlacement(
              nudgeFacilityInArea(f, deltaAreaPx, area.domain, area.layout),
              area,
              basemapsRef.current,
            )
          }),
        )
        return
      }
      // 後備：僅移動 hover 的設施
      const h = hoveredFacilityRef.current
      if (!h) return
      const area = areasRef.current.find((a) => a.id === h.areaId)
      if (!area) return
      const target = area.facilities.find((f) => f.id === h.facilityId)
      if (!target || target.type === 'Geofence') return
      mapAreaFacilities(h.areaId, (facilities) =>
        facilities.map((f) =>
          f.id === h.facilityId
            ? syncAutoRefFieldPositionFromPlacement(
                nudgeFacilityInArea(f, deltaAreaPx, area.domain, area.layout),
                area,
                basemapsRef.current,
              )
            : f,
        ),
      )
    },
    [mapAreaFacilities],
  )

  const onPatchFacilityParameters = useCallback(
    (areaId: string, facilityId: string, patch: Record<string, unknown>) => {
      mapAreaFacilities(areaId, (facilities) => {
        const target = facilities.find((f) => f.id === facilityId)
        if (
          target &&
          isZoneEntrance(target) &&
          Object.prototype.hasOwnProperty.call(patch, ZONE_ENTRANCE_LINKS_KEY)
        ) {
          const links = readZoneEntranceLinks({
            ...(target.parameters ?? {}),
            ...patch,
          })
          return applyEntranceLinksToAreaFacilities(
            facilities,
            facilityId,
            links,
            areasRef.current.find((a) => a.id === areaId),
          )
        }

        let next = facilities.map((f) => {
          if (f.id !== facilityId) return f
          let effectivePatch = patch
          if (
            Object.prototype.hasOwnProperty.call(patch, PARENT_ZONE_ID_KEY) ||
            Object.prototype.hasOwnProperty.call(patch, ZONE_LOCAL_FIELD_KEY)
          ) {
            if (!canBelongToParentZone(f)) {
              const {
                [PARENT_ZONE_ID_KEY]: _pz,
                [ZONE_LOCAL_FIELD_KEY]: _zl,
                ...rest
              } = patch
              effectivePatch = rest
            }
          }
          if (
            Object.prototype.hasOwnProperty.call(
              effectivePatch,
              ZONE_ENTRANCE_LINKS_KEY,
            ) &&
            !isZoneEntrance(f)
          ) {
            const { [ZONE_ENTRANCE_LINKS_KEY]: _links, ...rest } = effectivePatch
            effectivePatch = rest
          }
          if (
            (Object.prototype.hasOwnProperty.call(
              effectivePatch,
              ZONE_PARTITION_ENTRANCE_ID_KEY,
            ) ||
              Object.prototype.hasOwnProperty.call(
                effectivePatch,
                ZONE_PARTITION_LINK_ID_KEY,
              )) &&
            !isZonePartition(f)
          ) {
            const {
              [ZONE_PARTITION_ENTRANCE_ID_KEY]: _e,
              [ZONE_PARTITION_LINK_ID_KEY]: _l,
              ...rest
            } = effectivePatch
            effectivePatch = rest
          }
          const merged = { ...(f.parameters ?? {}), ...effectivePatch } as Record<
            string,
            unknown
          >
          for (const k of Object.keys(merged)) {
            if (merged[k] === undefined) delete merged[k]
          }
          const updated = {
            ...f,
            parameters: Object.keys(merged).length > 0 ? merged : undefined,
          }
          const sanitized = sanitizeZoneParameters(
            f.type === 'Geofence'
              ? syncGeofenceFacility(updated as GeofenceFacility)
              : (updated as FacilityObject),
          )
          return sanitized
        })

        if (Object.prototype.hasOwnProperty.call(patch, PARENT_ZONE_ID_KEY)) {
          const area = areasRef.current.find((a) => a.id === areaId)
          if (area) {
            next = next.map((f) => {
              if (f.id !== facilityId) return f
              if (!canBelongToParentZone(f)) return f
              if (!readParentZoneId(f.parameters)) return f
              return syncZoneChildFieldFromPlacement(f, {
                ...area,
                facilities: next,
              })
            })
          }
        }

        return next
      })
    },
    [mapAreaFacilities],
  )

  const onPatchSelectedParameters = useCallback(
    (patch: Record<string, unknown>) => {
      const areaId = selectedAreaIdRef.current
      const ids = selectedFacilityIdsRef.current
      const facilityId = ids[ids.length - 1] ?? null
      if (!areaId || !facilityId) return
      pushHistory()
      onPatchFacilityParameters(areaId, facilityId, patch)
    },
    [pushHistory, onPatchFacilityParameters],
  )

  const onCommitZoneEntranceLinks = useCallback(
    (links: ZoneEntranceLink[]) => {
      const areaId = selectedAreaIdRef.current
      const ids = selectedFacilityIdsRef.current
      const facilityId = ids[ids.length - 1] ?? null
      if (!areaId || !facilityId) return
      pushHistory()
      mapAreaFacilities(areaId, (facilities) =>
        applyEntranceLinksToAreaFacilities(
          facilities,
          facilityId,
          links,
          areasRef.current.find((a) => a.id === areaId),
        ),
      )
    },
    [pushHistory, mapAreaFacilities],
  )

  const onApplyDockingPoint = useCallback(
    (facility: FacilityObject) => {
      pushHistory()
      mapSelectedFacility(() => facility)
    },
    [pushHistory, mapSelectedFacility],
  )

  const onApplyWaypoint = useCallback(
    (facility: FacilityObject) => {
      pushHistory()
      mapSelectedFacility(() => facility)
    },
    [pushHistory, mapSelectedFacility],
  )

  const onStartFormatPaint = useCallback((snapshot: FacilityFormatSnapshot) => {
    setFormatPaintSnapshot(snapshot)
  }, [])

  const onCancelFormatPaint = useCallback(() => {
    setFormatPaintSnapshot(null)
  }, [])

  const formatPaintSnapshotRef = useRef<FacilityFormatSnapshot | null>(null)
  useEffect(() => {
    formatPaintSnapshotRef.current = formatPaintSnapshot
  }, [formatPaintSnapshot])

  const onFormatPaintTarget = useCallback(
    (areaId: string, facilityId: string) => {
      const snapshot = formatPaintSnapshotRef.current
      if (!snapshot) return
      const area = areasRef.current.find((a) => a.id === areaId)
      const target = area?.facilities.find((f) => f.id === facilityId)
      if (!area || !target || !canApplyFacilityFormat(snapshot, target)) {
        setFormatPaintSnapshot(null)
        return
      }
      pushHistory()
      const span = {
        w: domainWidthM(area.domain),
        h: domainHeightM(area.domain),
      }
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) =>
          f.id === facilityId
            ? applyFacilityFormat(f, snapshot, area.domain, area.layout, span)
            : f,
        ),
      )
      setFormatPaintSnapshot(null)
    },
    [pushHistory, mapAreaFacilities],
  )

  useEffect(() => {
    if (mapEditorMode !== 'edit') {
      setFormatPaintSnapshot(null)
      setSimRouteEditRouteId(null)
      setSimRouteEditPoints([])
    }
  }, [mapEditorMode])

  useEffect(() => {
    if (!simRouteEditRouteId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return
      }
      e.preventDefault()
      onFinishSimRoutePathEdit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [simRouteEditRouteId, onFinishSimRoutePathEdit])

  useEffect(() => {
    if (!formatPaintSnapshot) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFormatPaintSnapshot(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [formatPaintSnapshot])

  const onSelectBasemap = useCallback(
    (basemapId: string | null) => {
      if (basemapId === null) {
        selectedBasemapIdRef.current = null
        setSelectedBasemapId(null)
        return
      }
      setAllAreasSelected(false)
      selectedBasemapIdRef.current = basemapId
      setSelectedBasemapId(basemapId)
      updateSelection(null, [])
      setGeofenceSelectedLabelId(null)
    },
    [updateSelection],
  )

  const onBasemapDoubleClick = useCallback(
    (basemapId: string) => {
      onSelectBasemap(basemapId)
      setInspectorCollapsed(false)
    },
    [onSelectBasemap],
  )

  const onSelectArea = useCallback(
    (areaId: string | null) => {
      if (areaId === null) {
        clearMapSelection()
        setAllAreasSelected(false)
        setListDrawerTab(null)
        setInspectorCollapsed(true)
        return
      }
      selectedBasemapIdRef.current = null
      setSelectedBasemapId(null)
      setAllAreasSelected(false)
      updateSelection(areaId, [])
      setGeofenceSelectedLabelId(null)
    },
    [clearMapSelection, updateSelection],
  )

  /** 點畫布／Area 空白：收合左側清單與右側屬性抽屜 */
  const onEmptyMapPointerDown = useCallback(() => {
    setListDrawerTab(null)
    setInspectorCollapsed(true)
  }, [])

  const onToggleCropMode = useCallback(() => {
    if (mapEditorMode !== 'edit') return
    if (mapCropModeActive) exitCropMode()
    else enterCropMode()
  }, [mapEditorMode, mapCropModeActive, exitCropMode, enterCropMode])

  const onSelectFacility = useCallback(
    (
      areaId: string,
      facilityId: string | null,
      options?: { additive?: boolean },
    ) => {
      setGeofenceSelectedLabelId(null)
      setAllAreasSelected(false)
      selectedBasemapIdRef.current = null
      setSelectedBasemapId(null)
      if (facilityId === null) {
        updateSelection(areaId, [])
        return
      }

      if (routePlanningPickMode && routePlanningDraft) {
        const area = areasRef.current.find((a) => a.id === areaId)
        const facility = area?.facilities.find((f) => f.id === facilityId)
        if (facility?.type === 'DockingPoint') {
          const stationId = getDockingPointStationId(facility)
          if (
            stationId &&
            canAppendStationToTopologyRoute(
              pointTopologyRef.current,
              areasRef.current,
              routePlanningDraft.stationIds,
              stationId,
            )
          ) {
            setRoutePlanningDraft((d) => {
              if (!d) return d
              if (d.stationIds.includes(stationId)) return d
              return { ...d, stationIds: [...d.stationIds, stationId] }
            })
          }
          updateSelection(areaId, [facilityId])
          return
        }
      }

      const currentArea = selectedAreaIdRef.current
      const currentIds = selectedFacilityIdsRef.current
      if (options?.additive && currentArea === areaId) {
        if (currentIds.includes(facilityId)) {
          updateSelection(
            areaId,
            currentIds.filter((id) => id !== facilityId),
          )
        } else {
          updateSelection(areaId, [...currentIds, facilityId])
        }
        return
      }
      if (
        currentArea === areaId &&
        currentIds.includes(facilityId) &&
        currentIds.length > 1
      ) {
        return
      }
      updateSelection(areaId, [facilityId])
    },
    [updateSelection, routePlanningPickMode, routePlanningDraft],
  )

  const onFacilityDoubleClick = useCallback(
    (areaId: string, facilityId: string) => {
      onSelectFacility(areaId, facilityId)
      setInspectorCollapsed(false)
    },
    [onSelectFacility],
  )

  const onListEntrySelect = useCallback(
    (areaId: string, facilityId: string) => {
      onSelectFacility(areaId, facilityId)
      const px = resolveFacilityFocusPx(areasRef.current, areaId, facilityId)
      if (px) {
        setFacilityFocusTarget({ ...px, token: Date.now() })
      }
    },
    [onSelectFacility],
  )

  const onListEntryDoubleClick = useCallback(
    (areaId: string, facilityId: string) => {
      onListEntrySelect(areaId, facilityId)
      setInspectorCollapsed(false)
    },
    [onListEntrySelect],
  )

  const onSelectFacilities = useCallback(
    (
      areaId: string,
      facilityIds: string[],
      options?: { additive?: boolean },
    ) => {
      setGeofenceSelectedLabelId(null)
      if (options?.additive && selectedAreaIdRef.current === areaId) {
        const merged = new Set([
          ...selectedFacilityIdsRef.current,
          ...facilityIds,
        ])
        updateSelection(areaId, [...merged])
        return
      }
      updateSelection(areaId, facilityIds)
    },
    [updateSelection],
  )

  const applyFacilityAreaSizePx = useCallback(
    (
      areaId: string,
      facilityId: string,
      areaSizePx: { w: number; h: number },
    ) => {
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area) return
      const w = Math.max(
        MIN_FACILITY_CANVAS_PX,
        Math.min(areaSizePx.w, area.layout.wPx),
      )
      const h = Math.max(
        MIN_FACILITY_CANVAS_PX,
        Math.min(areaSizePx.h, area.layout.hPx),
      )
      mapAreaFacilities(areaId, (facilities) => {
        const target = facilities.find((f) => f.id === facilityId)
        const resizingZone = target != null && isZonePartition(target)
        let next = resizingZone
          ? ensureZoneChildrenLocalFields(facilities, facilityId, {
              ...area,
              facilities,
            })
          : facilities
        next = next.map((f) => {
          if (f.id !== facilityId) return f
          const sized = {
            ...f,
            areaSizePx: { w, h },
          } as FacilityObject
          const clamped = clampFacilityInsideParentZone(sized, {
            ...area,
            facilities: next,
          })
          return syncZoneChildFieldFromPlacement(clamped, {
            ...area,
            facilities: next.map((x) =>
              x.id === facilityId ? clamped : x,
            ),
          })
        })
        if (resizingZone) {
          next = rematerializeZoneChildrenOntoZoneCanvas(next, facilityId, {
            ...area,
            facilities: next,
          })
        }
        return next
      })
    },
    [mapAreaFacilities],
  )

  const onAddFacilityInsideZone = useCallback(
    (areaId: string, zoneFacilityId: string) => {
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area) return
      const zone = area.facilities.find((f) => f.id === zoneFacilityId)
      if (!zone) return
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      const created = createFacilityAreaInsideZone(zone, area, id)
      if (!created) return
      mapAreaFacilities(areaId, (facilities) => [...facilities, created])
      setNextNumericId((n) => n + 1)
      updateSelection(areaId, [id])
    },
    [mapAreaFacilities, nextNumericId, pushHistory, updateSelection],
  )

  const onResizeFacility = useCallback(
    (
      areaId: string,
      facilityId: string,
      areaSizePx: { w: number; h: number },
    ) => {
      applyFacilityAreaSizePx(areaId, facilityId, areaSizePx)
    },
    [applyFacilityAreaSizePx],
  )

  const onInspectorChangeAreaSizePx = useCallback(
    (wPx: number, hPx: number) => {
      const areaId = selectedAreaIdRef.current
      const ids = selectedFacilityIdsRef.current
      const facilityId = ids[ids.length - 1] ?? null
      if (!areaId || !facilityId) return
      pushHistory()
      applyFacilityAreaSizePx(areaId, facilityId, { w: wPx, h: hPx })
    },
    [applyFacilityAreaSizePx, pushHistory],
  )

  const applyFacilityRotation = useCallback(
    (areaId: string, facilityId: string, deltaDeg: number) => {
      pushHistory()
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) => {
          if (f.id !== facilityId) return f
          if (isShapedTrackFacility(f)) {
            return bakeShapedTrackRotation(f, deltaDeg)
          }
          return {
            ...f,
            rotation: normalizeDegrees((f.rotation ?? 0) + deltaDeg),
          }
        }),
      )
    },
    [pushHistory, mapAreaFacilities],
  )

  const onRotateLeft90 = useCallback(
    (areaId: string, facilityId: string) => {
      applyFacilityRotation(areaId, facilityId, -90)
    },
    [applyFacilityRotation],
  )

  const onRotateRight90 = useCallback(
    (areaId: string, facilityId: string) => {
      applyFacilityRotation(areaId, facilityId, 90)
    },
    [applyFacilityRotation],
  )

  const onRotateDelta = useCallback(
    (areaId: string, facilityId: string, deltaDeg: number) => {
      applyFacilityRotation(areaId, facilityId, deltaDeg)
    },
    [applyFacilityRotation],
  )

  const onGeofenceEditStart = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  const onTrackCornerEditStart = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  const onUpdateGeofence = useCallback(
    (
      areaId: string,
      facilityId: string,
      update: {
        verticesMeters?: { x: number; y: number }[]
        parameters?: Record<string, unknown>
      },
    ) => {
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) => {
          if (f.id !== facilityId || f.type !== 'Geofence') return f
          const params = {
            ...(f.parameters ?? {}),
            ...update.parameters,
          } as Record<string, unknown>
          if (update.verticesMeters) {
            params.verticesMeters = update.verticesMeters
          }
          return syncGeofenceFacility({
            ...f,
            parameters: params,
          } as GeofenceFacility)
        }),
      )
    },
    [mapAreaFacilities],
  )

  const onDeleteFacility = useCallback(
    (areaId: string, facilityId: string) => {
      pushHistory()
      mapAreaFacilities(areaId, (facilities) =>
        facilities.filter((f) => f.id !== facilityId),
      )
      if (selectedFacilityIdsRef.current.includes(facilityId)) {
        updateSelection(
          areaId,
          selectedFacilityIdsRef.current.filter((id) => id !== facilityId),
        )
      }
      setGeofenceSelectedLabelId(null)
    },
    [pushHistory, mapAreaFacilities, updateSelection],
  )

  const onSelectGeofenceLabel = useCallback(
    (_areaId: string, _facilityId: string, labelId: string | null) => {
      setGeofenceSelectedLabelId(labelId)
    },
    [],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const editOnly = () =>
        mapEditorModeRef.current === 'edit' &&
        workspaceRef.current === 'map'

      if (e.key === 'Escape') {
        if (isTextEditingTarget(e.target)) return
        if (editOnly()) {
          setListDrawerTab((tab) => (tab === 'palette' ? null : tab))
          setAllAreasSelected(false)
          if (mapCropModeActive) {
            exitCropMode()
            e.preventDefault()
          }
        }
        return
      }

      // 路網拓撲／軌道生成對話框開啟時，快捷鍵由對話框自行處理（避免 Cmd+Z 一次還原整張地圖）
      if (pointTopologyEditorOpenRef.current) return
      if (document.querySelector('[data-trackgen-size-dialog]')) return

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'a') {
        if (!editOnly()) return
        if (isTextEditingTarget(e.target)) return
        if (areasRef.current.length === 0) return
        e.preventDefault()
        clearSelection()
        exitCropMode()
        setAllAreasSelected(true)
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (!editOnly()) return
        if (isTextEditingTarget(e.target)) return
        e.preventDefault()
        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (!editOnly()) return
        if (isTextEditingTarget(e.target)) return
        e.preventDefault()
        redo()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!editOnly()) return
        if (shouldBlockFacilityDeleteShortcut(e)) return
        if (
          selectedAreaIdRef.current === null &&
          selectedBasemapIdRef.current === null &&
          selectedFacilityIdsRef.current.length === 0
        ) {
          return
        }
        e.preventDefault()
        deleteSelected()
        return
      }

      if (isTextEditingTarget(e.target)) return

      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        if (!editOnly()) return
        const hasSelection = selectedFacilityIdsRef.current.length > 0
        if (!hoveredFacilityRef.current && !hasSelection) return
        e.preventDefault()
        if (!e.repeat) pushHistory()
        const step = FACILITY_AREA_NUDGE_STEP_PX
        switch (e.key) {
          case 'ArrowLeft':
            nudgeHoveredFacility({ x: -step, y: 0 })
            break
          case 'ArrowRight':
            nudgeHoveredFacility({ x: step, y: 0 })
            break
          case 'ArrowUp':
            nudgeHoveredFacility({ x: 0, y: step })
            break
          case 'ArrowDown':
            nudgeHoveredFacility({ x: 0, y: -step })
            break
        }
        return
      }

      if (mod && e.key.toLowerCase() === 'c') {
        if (!editOnly()) return
        const areaId = selectedAreaIdRef.current
        const ids = selectedFacilityIdsRef.current
        const facilityId = ids[ids.length - 1] ?? null
        if (!areaId || !facilityId) return
        const f = areasRef.current
          .find((a) => a.id === areaId)
          ?.facilities.find((x) => x.id === facilityId)
        if (!f) return
        e.preventDefault()
        setClipboard(structuredClone(f))
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (!editOnly()) return
        if (!clipboardRef.current) return
        e.preventDefault()
        pasteFromClipboard()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    undo,
    redo,
    deleteSelected,
    pushHistory,
    pasteFromClipboard,
    nudgeHoveredFacility,
    clearSelection,
    exitCropMode,
    mapCropModeActive,
  ])

  const readOnlyCanvas =
    mapEditorMode === 'view' || isTrajectoryWorkspace

  const activeViewportCenterMeters = useMemo(() => {
    if (isTrajectoryWorkspace) return trajectoryViewportCenterMeters
    if (selectedFacility) {
      return {
        x: selectedFacility.position.x,
        y: selectedFacility.position.y,
      }
    }
    if (selectedArea) {
      const d = selectedArea.domain
      return {
        x: (d.xMinM + d.xMaxM) / 2,
        y: (d.yMinM + d.yMaxM) / 2,
      }
    }
    return null
  }, [
    isTrajectoryWorkspace,
    trajectoryViewportCenterMeters,
    selectedFacility,
    selectedArea,
  ])

  /** 外框地圖尺：僅「刻度」模式顯示；座標模式只留 Area 場域尺，避免兩套數字並陳 */
  const mapRulersEnabled = rulerDisplayMode === 'scale'

  const onCycleRulerDisplayMode = useCallback(() => {
    pushHistory()
    setRulerDisplayMode((prev) => {
      const next = cycleMapRulerDisplayMode(prev)
      const show = next !== 'off'
      setAreas((areasPrev) => {
        const areaId = selectedAreaIdRef.current
        if (areaId) {
          return areasPrev.map((a) =>
            a.id === areaId ? { ...a, showRuler: show } : a,
          )
        }
        return areasPrev.map((a) => ({ ...a, showRuler: show }))
      })
      return next
    })
  }, [pushHistory])

  const mapRulersToggleHint = selectedArea
    ? t('mapEditor.chrome.rulersToggleOne', { name: selectedArea.customName.trim() || selectedArea.id })
    : t('mapEditor.chrome.rulersToggleAll')

  // 載入地圖時若 Area 已開刻度，預設進入刻度模式
  useEffect(() => {
    if (mapScreen !== 'editor') return
    const anyOn = areas.some((a) => a.showRuler)
    setRulerDisplayMode((prev) => {
      if (prev !== 'off') return prev
      return anyOn ? 'scale' : 'off'
    })
    // 只在載入切換時對齊一次；避免與使用者循環打架
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync on library→editor entry
  }, [mapScreen, loadedMapMeta.libraryId])

  const onToggleAreaCenterLabels = useCallback(() => {
    setShowAreaCenterLabels((v) => !v)
  }, [])

  const onToggleFacilityToolbars = useCallback(() => {
    setShowFacilityToolbars((v) => !v)
  }, [])

  return (
    <MapExtentProvider extent={mapExtentMeters}>
    <div
      className={`flex h-screen min-h-0 flex-col text-zinc-100 ${
        isMapWorkspace ? 'bg-[#18181B]' : 'bg-zinc-950'
      }`}
    >
      {isMapWorkspace && mapScreen === 'library' && (
        <MapLibraryPage onOpenMap={openLibraryMap} onBackToHome={onBackToHome} />
      )}
      {isMapWorkspace && mapScreen === 'editor' && backendSyncFailed && (
        <div className="shrink-0 border-b border-amber-800/60 bg-amber-950/50 px-4 py-2 text-xs text-amber-300">
          {t('mapEditor.unsavedBannerBefore')}
          <strong className="text-amber-200">{t('mapEditor.unsavedBannerStrong')}</strong>
          {t('mapEditor.unsavedBannerAfter')}
        </div>
      )}
      {isMapWorkspace && mapScreen === 'editor' && (
        <MapEditorToolbar
          mapEditorMode={mapEditorMode}
          onEnterEdit={enterEditMode}
          onLeaveEdit={requestLeaveEditMode}
          onBackToLibrary={requestBackToLibrary}
          mapDisplayName={loadedMapMeta.displayName}
          mapVersion={loadedMapMeta.version}
          onMapDisplayNameChange={onMapDisplayNameChange}
          onMapVersionChange={onMapVersionChange}
          onCenterMap={onCenterMap}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          showRulers={mapRulersEnabled}
          rulerDisplayMode={rulerDisplayMode}
          onCycleRulerDisplayMode={onCycleRulerDisplayMode}
          rulersToggleHint={mapRulersToggleHint}
          showAreaCenterLabels={showAreaCenterLabels}
          onToggleAreaCenterLabels={onToggleAreaCenterLabels}
          areaCenterLabelsToggleHint={t('mapEditor.chrome.areaLabelsHint')}
          mapCanvasResizeActive={mapCropModeActive}
          onToggleMapCanvasResize={
            mapEditorMode === 'edit' ? onToggleCropMode : undefined
          }
          mapCanvasResizeToggleHint={t('mapEditor.chrome.cropHint')}
          onApplyMapCrop={
            mapEditorMode === 'edit' && mapCropModeActive
              ? applyCropMode
              : undefined
          }
          onCancelMapCrop={
            mapEditorMode === 'edit' && mapCropModeActive
              ? exitCropMode
              : undefined
          }
          showFacilityToolbars={showFacilityToolbars}
          onToggleFacilityToolbars={
            mapEditorMode === 'edit' ? onToggleFacilityToolbars : undefined
          }
          facilityToolbarsToggleHint={t('mapEditor.chrome.facilityBarsHint')}
          trackIssueCount={trackDiagnostics.issues.length}
          trackIssuesOpen={trackIssuesOpen}
          onToggleTrackIssues={() => setTrackIssuesOpen((v) => !v)}
          coordsText={
            activeViewportCenterMeters
              ? t('mapEditor.chrome.coords', {
                  x: activeViewportCenterMeters.x.toFixed(2),
                  y: activeViewportCenterMeters.y.toFixed(2),
                }) +
                (selectedFacility
                  ? selectedFacilityIds.length > 1
                    ? t('mapEditor.chrome.selectedMany', {
                        count: selectedFacilityIds.length,
                        name: selectedFacility.customName.trim() || selectedFacility.id,
                      })
                    : ` · ${selectedFacility.customName.trim() || selectedFacility.id}`
                  : selectedArea
                    ? ` · ${selectedArea.customName.trim() || selectedArea.id}`
                    : '')
              : t('mapEditor.chrome.selectHint')
          }
          canvasText={t('mapEditor.chrome.canvasPx', {
            w: mapPixelSize.width,
            h: mapPixelSize.height,
          })}
          infoTitle={
            loadedMapMeta.creationMode === 'trackGen'
              ? t('mapEditor.chrome.creationModeTrackGen')
              : t('mapEditor.chrome.creationModeBlank')
          }
          autosaving={autosaveStatus === 'saving'}
          autosaveLabel={
            autosaveStatus === 'saving'
              ? t('mapEditor.chrome.autosaving')
              : autosaveTimeLabel || t('mapEditor.chrome.editingAutosave')
          }
          syncFailed={backendSyncFailed}
          retryingSync={retryingSync}
          onRetrySync={() => void retryBackendSync()}
          isPrimaryMap={isPrimaryMap}
          onSetPrimaryMap={() => {
            const entry = getMapLibraryEntry(loadedMapMetaRef.current.libraryId)
            if (entry) setPrimaryDialogEntry(entry)
          }}
        />
      )}
      {isTrajectoryWorkspace && (
      <div
        className="flex shrink-0 items-center gap-3 border-b border-zinc-700/80 bg-zinc-950 px-4 py-2"
        role="toolbar"
        aria-label={t('mapEditor.trajectoryTitle')}
      >
        <span className="text-sm font-semibold text-zinc-100">{t('mapEditor.trajectoryTitle')}</span>
      </div>
      )}
      {isTrajectoryWorkspace && (
      <div
        className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 py-1.5 font-mono text-xs text-zinc-400"
        aria-live="polite"
      >
        <span>
          {t('mapEditor.chrome.viewCenter', { x: trajectoryViewportCenterMeters.x.toFixed(2), y: trajectoryViewportCenterMeters.y.toFixed(2) })}
        </span>
      </div>
      )}
      {(!isMapWorkspace || mapScreen === 'editor') && (
      <div
        className={`relative flex min-h-0 flex-1 ${
          // 設計稿：地圖放在黑底圓角面板裡，左右下留 12
          isMapWorkspace ? 'mx-3 mb-3 overflow-hidden rounded-xl bg-black' : ''
        }`}
      >
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={isMapWorkspace ? t('mapEditor.chrome.mapEditAria') : t('mapEditor.chrome.trajectoryAria')}
        >
          <div className="relative min-h-0 w-full flex-1">
            {isMapWorkspace && mapScreen === 'editor' && trackIssuesOpen && (
              <TrackDiagnosticsPanel
                diagnostics={trackDiagnostics}
                onLocate={onListEntrySelect}
                onClose={() => setTrackIssuesOpen(false)}
              />
            )}
            <div
              className={`absolute inset-0 flex min-h-0 flex-col ${
                isMapWorkspace && mapScreen === 'editor'
                  ? 'z-10'
                  : 'pointer-events-none invisible z-0'
              }`}
              aria-hidden={!isMapWorkspace || mapScreen !== 'editor'}
            >
              <MapAreaCanvas
                pixelSize={mapPixelSize}
                pixelOrigin={mapPixelOrigin}
                areas={areas}
                basemaps={basemaps}
                selectedAreaId={selectedAreaId}
                selectedBasemapId={selectedBasemapId}
                selectedFacilityIds={selectedFacilityIds}
                geofenceSelectedLabelId={geofenceSelectedLabelId}
                viewportRef={mapViewportRef}
                readOnly={mapEditorMode === 'view'}
                editMode={mapEditorMode === 'edit'}
                liveById={NO_LIVE_ENTRIES}
                wheelZoomMode="mouse"
                slotPreview={slotPreview}
                onSelectArea={onSelectArea}
                onSelectBasemap={onSelectBasemap}
                onSelectFacility={onSelectFacility}
                onSelectFacilities={onSelectFacilities}
                onSelectGeofenceLabel={onSelectGeofenceLabel}
                onEmptyMapPointerDown={onEmptyMapPointerDown}
                onDragFacility={onDragFacility}
                onDragSessionStart={onDragSessionStart}
                onResizeFacility={
                  mapEditorMode === 'edit' ? onResizeFacility : undefined
                }
                onResizeSessionStart={onDragSessionStart}
                onPatchFacilityParameters={
                  mapEditorMode === 'edit' ? onPatchFacilityParameters : undefined
                }
                onRotateLeft90={
                  mapEditorMode === 'edit' ? onRotateLeft90 : undefined
                }
                onRotateRight90={
                  mapEditorMode === 'edit' ? onRotateRight90 : undefined
                }
                onRotateDelta={
                  mapEditorMode === 'edit' ? onRotateDelta : undefined
                }
                onTrackCornerEditStart={
                  mapEditorMode === 'edit' ? onTrackCornerEditStart : undefined
                }
                onDeleteFacility={
                  mapEditorMode === 'edit' ? onDeleteFacility : undefined
                }
                onAddFacilityInsideZone={
                  mapEditorMode === 'edit' ? onAddFacilityInsideZone : undefined
                }
                onUpdateGeofence={
                  mapEditorMode === 'edit' ? onUpdateGeofence : undefined
                }
                onGeofenceEditStart={
                  mapEditorMode === 'edit' ? onGeofenceEditStart : undefined
                }
                onPaletteDropArea={
                  mapEditorMode === 'edit' ? onPaletteDropArea : undefined
                }
                onPaletteDropBasemap={
                  mapEditorMode === 'edit' ? onPaletteDropBasemap : undefined
                }
                onPaletteDropFacility={
                  mapEditorMode === 'edit' ? onPaletteDropFacility : undefined
                }
                onPatchAreaLayout={
                  mapEditorMode === 'edit' ? onPatchAreaLayout : undefined
                }
                onAreaLayoutSessionStart={
                  mapEditorMode === 'edit' ? onAreaLayoutSessionStart : undefined
                }
                onPatchBasemapLayout={
                  mapEditorMode === 'edit' ? onPatchBasemapLayout : undefined
                }
                onPatchBasemapParameters={
                  mapEditorMode === 'edit' ? onPatchBasemapParameters : undefined
                }
                onBasemapLayoutSessionStart={
                  mapEditorMode === 'edit' ? onBasemapLayoutSessionStart : undefined
                }
                onBasemapBringToFront={
                  mapEditorMode === 'edit' ? onBasemapBringToFront : undefined
                }
                onBasemapSendToBack={
                  mapEditorMode === 'edit' ? onBasemapSendToBack : undefined
                }
                onApplyTrackGen={
                  mapEditorMode === 'edit' ? onApplyTrackGen : undefined
                }
                formatPaintSnapshot={
                  mapEditorMode === 'edit' ? formatPaintSnapshot : null
                }
                onStartFormatPaint={
                  mapEditorMode === 'edit' ? onStartFormatPaint : undefined
                }
                onFormatPaintTarget={
                  mapEditorMode === 'edit' ? onFormatPaintTarget : undefined
                }
                onCancelFormatPaint={
                  mapEditorMode === 'edit' ? onCancelFormatPaint : undefined
                }
                onFacilityHover={
                  mapEditorMode === 'edit' ? onFacilityHover : undefined
                }
                showAreaCenterLabels={showAreaCenterLabels}
                rulerDisplayMode={
                  rulerDisplayMode === 'field' ? 'field' : 'scale'
                }
                showFacilityToolbars={showFacilityToolbars}
                zoomLevel={mapZoomLevel}
                onZoomLevelChange={setMapZoomLevel}
                cropMode={
                  mapEditorMode === 'edit' && mapCropModeActive
                    ? cropWorkspace
                    : null
                }
                onCropRectChange={
                  mapEditorMode === 'edit' && mapCropModeActive
                    ? onCropRectChange
                    : undefined
                }
                allAreasSelected={
                  mapEditorMode === 'edit' && allAreasSelected
                }
                onBulkAreasLayoutSessionStart={
                  mapEditorMode === 'edit'
                    ? onBulkAreasLayoutSessionStart
                    : undefined
                }
                onBulkAreasLayoutMove={
                  mapEditorMode === 'edit' ? onBulkAreasLayoutMove : undefined
                }
                onBulkAreasLayoutCommit={
                  mapEditorMode === 'edit' ? onBulkAreasLayoutCommit : undefined
                }
                facilityFocusTarget={facilityFocusTarget}
                trackDiagnostics={trackDiagnosticsForCanvas}
                onFacilityDoubleClick={onFacilityDoubleClick}
                onBasemapDoubleClick={onBasemapDoubleClick}
                routePlanningOverlay={
                  <>
                    {routeOverlayPreview || routeOverlaySaved.length > 0 ? (
                      <RoutePlanningOverlay
                        areas={areas}
                        pointTopology={pointTopology}
                        activePreview={routeOverlayPreview}
                        savedRoutes={routeOverlaySaved}
                      />
                    ) : null}
                    {simRouteEditRouteId && simRouteEditPoints.length >= 2 ? (
                      <SimRoutePathOverlay
                        points={simRouteEditPoints}
                        isOnField={(p) => isSimRoutePointOnField(areas, p)}
                        snapTargets={simRouteSnapTargets}
                        bounds={simRouteGuideBounds}
                        onChange={onSimRoutePathPointsChange}
                      />
                    ) : null}
                  </>
                }
              />
            </div>
            <div
              className={`absolute inset-0 flex min-h-0 flex-col ${
                isTrajectoryWorkspace
                  ? 'z-10'
                  : 'pointer-events-none invisible z-0'
              }`}
              aria-hidden={!isTrajectoryWorkspace}
            >
              <MapCanvas
                facilities={[]}
                selectedId={null}
                viewportRef={trajectoryViewportRef}
                scaleX={trajectoryScaleX}
                scaleY={trajectoryScaleY}
                readOnly
                interactionMode="trajectory"
                trajectory={loadedTrajectory}
                trajectoryReplayHeadIndex={replayHeadIndex}
                onViewportCenterMeters={onTrajectoryViewportCenterMeters}
                onSelect={(_id) => {}}
                onDragFacility={(_id, _pos) => {}}
                onDragSessionStart={onDragSessionStart}
                onRotateLeft90={(_id) => {}}
                onRotateRight90={(_id) => {}}
                onRotateDelta={(_id, _deg) => {}}
              />
            </div>
          </div>

          {isMapWorkspace && mapScreen === 'editor' && simRouteEditRouteId ? (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-[9500] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-sky-500/50 bg-zinc-950/95 px-3 py-2 shadow-xl">
              <p className="max-w-[min(36rem,70vw)] text-[11px] leading-snug text-sky-100">
                {t('mapEditor.chrome.simRoutePathEditing')}
              </p>
              <button
                type="button"
                className="pointer-events-auto shrink-0 rounded-md border border-sky-400/60 bg-sky-600/90 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
                onClick={onFinishSimRoutePathEdit}
              >
                {t('mapEditor.chrome.simRoutePathDone')}
              </button>
            </div>
          ) : null}

          {isTrajectoryWorkspace && (
            <TrajectoryZoomBar
              zoomFactorX={trajectoryZoomFactorX}
              onZoomFactorXChange={setTrajectoryZoomFactorX}
              zoomFactorY={trajectoryZoomFactorY}
              onZoomFactorYChange={setTrajectoryZoomFactorY}
            />
          )}
        </div>

        {isMapWorkspace && mapScreen === 'editor' && (
          <MapListDrawer
            areas={areas}
            openTab={listDrawerTab}
            onOpenTab={setListDrawerTab}
            selectedAreaId={selectedAreaId}
            selectedFacilityId={primarySelectedFacilityId}
            onSelectEntry={onListEntrySelect}
            onEntryDoubleClick={onListEntryDoubleClick}
            mapRoutes={mapRoutes}
            mapRouteGroups={mapRouteGroups}
            mapEditMode={mapEditorMode === 'edit'}
            routePlanningDraft={routePlanningDraft}
            routeGroupDraft={routeGroupDraft}
            visibleRouteIds={visibleRouteIds}
            routePickMode={routePlanningPickMode}
            onStartNewRoute={onStartNewRoute}
            onStartNewGroup={onStartNewGroup}
            onEditRoute={onEditRoute}
            onEditSimRoutePath={onEditSimRoutePath}
            onEditGroup={onEditGroup}
            onDeleteGroup={onDeleteGroup}
            onToggleRouteVisibility={onToggleRouteVisibility}
            onToggleGroupRouteVisibility={onToggleGroupRouteVisibility}
            onCancelRouteDraft={onCancelRouteDraft}
            onCancelGroupDraft={onCancelGroupDraft}
            onSaveRouteDraft={onSaveRouteDraft}
            onSaveGroupDraft={onSaveGroupDraft}
            onDeleteRoute={onDeleteRoute}
            onDraftRouteNameChange={onDraftRouteNameChange}
            onDraftRouteAvgTravelTimeChange={onDraftRouteAvgTravelTimeChange}
            onDraftRouteMinTravelTimeChange={onDraftRouteMinTravelTimeChange}
            onGroupDraftNameChange={onGroupDraftNameChange}
            onRemoveRouteStationAt={onRemoveRouteStationAt}
            onMoveRouteStation={onMoveRouteStation}
            onAppendRouteStation={onAppendRouteStation}
            onOpenPointTopology={() => setPointTopologyEditorOpen(true)}
            pointTopology={pointTopology}
            onPickPaletteItem={mapEditorMode === 'edit' ? addFromPalette : undefined}
          />
        )}

        {isMapWorkspace && mapScreen === 'editor' && primaryDialogEntry ? (
          <SetPrimaryMapDialog
            entry={primaryDialogEntry}
            onClose={() => setPrimaryDialogEntry(null)}
            onActivated={() => {
              setPrimaryMapCheck({ libraryId: primaryDialogEntry.libraryId, primary: true })
              setBackendSyncFailed(false)
              setPrimaryDialogEntry(null)
            }}
          />
        ) : null}

        {isMapWorkspace && mapScreen === 'editor' ? (
          <PointTopologyEditorDialog
            open={pointTopologyEditorOpen}
            areas={areas}
            routes={mapRoutes}
            topology={pointTopology}
            onClose={() => setPointTopologyEditorOpen(false)}
            onApply={(next) => {
              // 拓撲對話框本身即可編輯；套用後進入地圖編輯模式以便儲存
              if (mapEditorMode !== 'edit') setMapEditorMode('edit')
              setPointTopology(next)
              setPointTopologyEditorOpen(false)
            }}
          />
        ) : null}

        {isMapWorkspace && mapScreen === 'editor' &&
          (!inspectorCollapsed ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-40 flex w-72 max-w-[min(18rem,100%)]">
              <button
                type="button"
                onClick={() => setInspectorCollapsed(true)}
                className="pointer-events-auto absolute left-0 top-3 z-20 flex h-10 w-6 -translate-x-full items-center justify-center rounded-l-md border border-r-0 border-zinc-600 bg-zinc-800 text-zinc-300 shadow-sm hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                title={t('mapEditor.chrome.collapseInspector')}
                aria-label={t('mapEditor.chrome.collapseInspector')}
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
              <div className="pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-zinc-700/80 bg-zinc-900/95 shadow-2xl backdrop-blur-sm">
                {mapCropModeActive && cropWorkspace && mapEditorMode === 'edit' ? (
                  <MapCropInspectorSection
                    workspace={cropWorkspace}
                    outputSize={cropOutputSize}
                  />
                ) : selectedFacility ? (
                  <Inspector
                    facility={selectedFacility}
                    readOnly={readOnlyCanvas}
                    domainMaxM={selectedAreaDomainMaxM}
                    areaLayout={selectedArea?.layout}
                    onChangeId={onChangeId}
                    onChangeCustomName={(customName) => updateSelected({ customName })}
                    onChangeNonSlotState={(state) => {
                      pushHistory()
                      updateSelected({ currentState: state })
                    }}
                    slotPreview={
                      selectedFacility.type === 'Slot' &&
                      slotPreview?.facilityId === selectedFacility.id
                        ? {
                            occupancy: slotPreview.occupancy,
                            equipment: slotPreview.equipment,
                          }
                        : null
                    }
                    onSlotPreviewChange={(preview) => {
                      if (!preview) {
                        setSlotPreview(null)
                        return
                      }
                      setSlotPreview({
                        ...preview,
                        facilityId: selectedFacility.id,
                      })
                    }}
                    onPatchSlot={patchSelectedSlot}
                    onPatchParameters={
                      readOnlyCanvas ? undefined : onPatchSelectedParameters
                    }
                    mapAreas={areas}
                    mapBasemaps={basemaps}
                    parentArea={selectedArea}
                    onApplyDockingPoint={
                      readOnlyCanvas ? undefined : onApplyDockingPoint
                    }
                    onApplyWaypoint={
                      readOnlyCanvas ? undefined : onApplyWaypoint
                    }
                    onCommitZoneEntranceLinks={
                      readOnlyCanvas ? undefined : onCommitZoneEntranceLinks
                    }
                    onDelete={() => {
                      deleteSelected()
                    }}
                    onFieldFocus={onInspectorFieldFocus}
                    onFieldBlur={onInspectorFieldBlur}
                    onChangeAreaSizePx={
                      readOnlyCanvas ? undefined : onInspectorChangeAreaSizePx
                    }
                    geofenceSelectedLabelId={geofenceSelectedLabelId}
                    onSelectGeofenceLabel={(_facilityId, labelId) =>
                      setGeofenceSelectedLabelId(labelId)
                    }
                  />
                ) : selectedBasemap && isTrackGenComponent(selectedBasemap.parameters) ? (
                  <TrackGenInspectorSection
                    basemap={selectedBasemap}
                    readOnly={mapEditorMode !== 'edit'}
                    onRename={(customName) => {
                      setBasemaps((prev) =>
                        prev.map((b) =>
                          b.id === selectedBasemap.id ? { ...b, customName } : b,
                        ),
                      )
                    }}
                  />
                ) : selectedBasemap ? (
                  <BasemapInspectorSection
                    basemap={selectedBasemap}
                    readOnly={readOnlyCanvas}
                    onChangeCustomName={(customName) => {
                      setBasemaps((prev) =>
                        prev.map((b) =>
                          b.id === selectedBasemap.id ? { ...b, customName } : b,
                        ),
                      )
                    }}
                    onPatchParameters={(patch) => {
                      onPatchBasemapParameters(selectedBasemap.id, patch)
                    }}
                    onDelete={() => deleteSelected()}
                    onFieldFocus={onInspectorFieldFocus}
                    onFieldBlur={onInspectorFieldBlur}
                  />
                ) : selectedArea && !selectedFacility ? (
                  <AreaInspectorSection
                    area={selectedArea}
                    readOnly={readOnlyCanvas}
                    onChangeId={onChangeAreaId}
                    onChangeCustomName={(customName) => {
                      updateArea(selectedArea.id, { customName })
                    }}
                    onPatchArea={(patch) => {
                      updateArea(selectedArea.id, patch)
                    }}
                    onDelete={() => deleteSelected()}
                    onFieldFocus={onInspectorFieldFocus}
                    onFieldBlur={onInspectorFieldBlur}
                  />
                ) : allAreasSelected && mapEditorMode === 'edit' ? (
                  <aside
                    data-inspector
                    className="flex h-full min-h-0 flex-col bg-zinc-900/50"
                  >
                    <div className="border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-cyan-400/90">
                      {t('mapEditor.chrome.selectAllAreas', { count: areas.length })}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm text-zinc-400">
                      <p className="leading-relaxed">
                        {t('mapEditor.chrome.allAreasSelectedBefore')}
                        <strong className="text-zinc-200">{t('mapEditor.chrome.moveTrack')}</strong>
                        {t('mapEditor.chrome.allAreasSelectedMid')}
                        <strong className="text-zinc-200">{t('mapEditor.chrome.canvasBlank')}</strong>
                        {t('mapEditor.chrome.allAreasSelectedAfter')}
                      </p>
                      <p className="mt-3 text-xs text-zinc-600">
                        {t('mapEditor.chrome.allAreasSelectedHint')}
                      </p>
                    </div>
                  </aside>
                ) : (
                  <aside
                    data-inspector
                    className="flex h-full min-h-0 flex-col bg-zinc-900/50"
                  >
                    <div className="border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {t('mapEditor.chrome.properties')}
                    </div>
                    <div className="p-4 text-sm text-zinc-500">
                      <p>
                        {readOnlyCanvas
                          ? t('mapEditor.chrome.propertiesViewHint')
                          : t('mapEditor.chrome.propertiesEditHint')}
                      </p>
                      <p className="mt-3 text-xs text-zinc-600">
                        {t('mapEditor.chrome.propertiesAreaNote')}
                        {readOnlyCanvas
                          ? t('mapEditor.chrome.propertiesEditExtra')
                          : t('mapEditor.chrome.propertiesShortcuts')}
                      </p>
                    </div>
                  </aside>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setInspectorCollapsed(false)}
              className="pointer-events-auto absolute right-2 top-2 z-40 flex h-12 items-center gap-1 rounded-xl border border-[rgba(212,212,212,0.15)] bg-[rgba(212,212,216,0.1)] px-2 py-3 text-sm leading-[18px] tracking-[0.5px] text-[#F3F4F6] backdrop-blur-md transition hover:bg-[rgba(212,212,216,0.16)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#51A2FF]/60"
              title={t('mapEditor.chrome.expandInspector')}
              aria-label={t('mapEditor.chrome.expandInspector')}
            >
              <span className="flex size-6 items-center justify-center p-0.5">
                <ChevronLeft className="size-[18px] text-[#D1D5DC]" aria-hidden />
              </span>
              <span className="pr-2">{t('mapEditor.chrome.properties')}</span>
            </button>
          ))}
        {isTrajectoryWorkspace && (
          <TrajectoryPanel
            selectedVehicleId={selectedVehicleId}
            onVehicleIdChange={handleVehicleChange}
            trajectoryEntries={trajectoryEntriesForPanel}
            selectedEntryId={selectedTrajectoryEntryId}
            onTrajectoryEntryChange={handleTrajectoryEntryChange}
            hasTrajectory={
              loadedTrajectory !== null && loadedTrajectory.points.length > 0
            }
            loadedTrajectory={loadedTrajectory}
            replayHeadIndex={replayHeadIndex}
            replayPlaying={replayPlaying}
            mapMismatch={trajectoryMapMismatch}
            onPlay={playTrajectory}
            onPause={pauseTrajectory}
            onRewind={rewindTrajectory}
            onImportTrajectory={onImportTrajectoryFile}
            onLocateVehicle={locateTrajectoryVehicle}
            onSeekToIndex={seekTrajectoryToIndex}
          />
        )}
      </div>
      )}

      <LeaveEditConfirmDialog
        open={leaveEditDialogOpen}
        onCancel={cancelLeaveDialog}
        onSave={confirmLeaveSaveAndExit}
        onDiscard={confirmLeaveDiscardAndExit}
      />
    </div>
    </MapExtentProvider>
  )
}
