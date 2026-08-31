import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { MapEditorToolbar } from './components/MapEditorToolbar'
import { MapLibraryPage } from './components/MapLibraryPage'
import { Inspector } from './components/Inspector'
import { TrajectoryPanel } from './components/TrajectoryPanel'
import { LeaveEditConfirmDialog } from './components/LeaveEditConfirmDialog'
import { PointTopologyEditorDialog } from './components/PointTopologyEditorDialog'
import { MapAreaCanvas } from './components/MapAreaCanvas'
import { MapListDrawer, type MapListDrawerTab } from './components/MapListDrawer'
import { RoutePlanningOverlay, routeColorForIndex } from './components/RoutePlanningOverlay'
import { MapCanvas } from './components/MapCanvas'
import { MapEditorTestDock } from './components/MapEditorTestDock'
import { useTrackConnectivityScan } from './hooks/useTrackConnectivityScan'
import { TrajectoryZoomBar } from './components/TrajectoryZoomBar'
import { ZoomLevelBar } from './components/ZoomLevelBar'
import {
  getLatestTrajectoryEntry,
  getTrajectoryCatalogForVehicle,
  type VehicleTrajectoryEntry,
} from './constants/vehicleTrajectoryCatalog'
import {
  defaultCanvasSizePxForType,
  defaultSizeMetersForType,
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
  meterToAreaLocalPx,
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
import { isAreaPaletteItem, isBasemapPaletteItem } from './utils/paletteDrag'
import {
  flattenAreaFacilities,
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
import { publishMapLibraryEntryToBackend } from './api/mapLibraryApi'
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
import {
  MQTT_DEMO_BLINK_FACILITY_ID,
  MQTT_DEMO_VEHICLE_FACILITY_ID,
} from './live/mqttDemoIds'
import { getMqttEntityId } from './live/mqttEntityId'
import { mergePayloadIntoLive } from './live/mqttPayload'
import type { MqttLiveEntry, MqttLogLine } from './live/mqttLiveTypes'
import { mockMqttSingleton } from './sim/mockMqtt'
import type { PaletteItem } from './constants/palette'
import {
  defaultRectVerticesMeters,
  syncGeofenceFacility,
} from './utils/geofence'
import { sanitizeFacilitiesForEditor } from './utils/sanitizeFacility'
import { normalizeDegrees } from './utils/rotation'
import { applyExampleMapDefaultLabelStyleToAreas } from './utils/facilityLabelStyle'
import {
  applyFacilityFormat,
  canApplyFacilityFormat,
  type FacilityFormatSnapshot,
} from './utils/facilityFormatPainter'
import { defaultRefFieldParametersForType } from './utils/facilityRefFieldBinding'
import { defaultRoadLineParameters } from './utils/roadLineFacility'
import {
  BASEMAP_ABOVE_AREAS_KEY,
  defaultBasemapParameters,
  isBasemapAboveAreas,
  partitionMapBasemaps,
} from './utils/basemapFacility'
import {
  defaultTrackCrossoverParameters,
} from './utils/trackCrossoverFacility'
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

export default function MapEditorApp({
  workspace = 'map',
  onBackToHome,
}: MapEditorAppProps) {
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
  const [liveById, setLiveById] = useState<Record<string, MqttLiveEntry>>({})
  const [mqttLog, setMqttLog] = useState<MqttLogLine[]>([])
  /** Map 像素畫布縮放：1 近、7 遠（一屏看全圖） */
  const [mapZoomLevel, setMapZoomLevel] = useState(MAP_PIXEL_ZOOM_DEFAULT_LEVEL)
  const [showZoomLevelBar, setShowZoomLevelBar] = useState(false)
  const [showTestDock, setShowTestDock] = useState(false)
  const [showFacilityToolbars, setShowFacilityToolbars] = useState(
    readStoredFacilityToolbarsVisible,
  )
  const [showAreaCenterLabels, setShowAreaCenterLabels] = useState(false)
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
  const paletteOpen = mapEditorMode === 'edit' && listDrawerTab === 'palette'
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

  const connectivityScan = useTrackConnectivityScan(areas)

  const onSelectConnectivityIssue = useCallback(
    (trackId: string, areaId: string) => {
      updateSelection(areaId, [trackId])
      setInspectorCollapsed(false)
    },
    [updateSelection],
  )

  const allFacilities = useMemo(
    () => flattenAreaFacilities(areas),
    [areas],
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
    return mockMqttSingleton.subscribe('#', (msg) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(msg.payload)
      } catch {
        return
      }
      const o = parsed as { entityId?: unknown }
      if (typeof o.entityId !== 'string' || !o.entityId.trim()) return
      const entityId = o.entityId.trim()
      setLiveById((prev) => ({
        ...prev,
        [entityId]: mergePayloadIntoLive(
          prev[entityId],
          msg.topic,
          msg.payload,
        ),
      }))
      setMqttLog((prev) =>
        [{ ts: Date.now(), topic: msg.topic, payload: msg.payload }, ...prev].slice(
          0,
          50,
        ),
      )
    })
  }, [])

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
      setMapPixelSize(loaded.pixelSize)
      setMapPixelOrigin(loaded.pixelOrigin)
      setAreas(
        ensureWaypointCodesInAreas(
          ensureDockingPointStationIdsInAreas(
            applyExampleMapDefaultLabelStyleToAreas(loaded.areas, loaded.mapId),
          ),
        ),
      )
      setBasemaps(structuredClone(loaded.basemaps ?? []))
      setNextNumericId(nextNumericIdFromAreas(loaded.areas, loaded.basemaps ?? []))
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
      setLoadedMapMeta({
        libraryId,
        mapId: loaded.mapId,
        displayName: loaded.displayName,
        version: loaded.version || DEFAULT_MAP_VERSION,
        pixelSize: loaded.pixelSize,
        pixelOrigin: loaded.pixelOrigin,
      })
      resetHistory()
      exitMapEditorChromeAfterLoad()
    },
    [resetHistory, exitMapEditorChromeAfterLoad, clearSelection],
  )

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
    void publishAndReport(updated)
  }, [])

  const routePlanningPickMode =
    listDrawerTab === 'routes' &&
    routePlanningDraft !== null &&
    mapEditorMode === 'edit'

  const routeOverlayPreview = useMemo(() => {
    if (routePlanningDraft && routePlanningDraft.stationIds.length > 0) {
      return {
        stationIds: routePlanningDraft.stationIds,
        color: 'rgba(251, 191, 36, 0.95)',
        label: routePlanningDraft.displayName.trim() || '編輯中路線',
        emphasized: true,
        avgTravelTimeSeconds: routePlanningDraft.avgTravelTimeSeconds,
        minTravelTimeSeconds: routePlanningDraft.minTravelTimeSeconds,
      }
    }
    return null
  }, [routePlanningDraft])

  const routeOverlaySaved = useMemo(() => {
    if (routePlanningDraft) return []
    return mapRoutes
      .map((route, index) => ({ route, index }))
      .filter(({ route }) => visibleRouteIds.has(route.routeId))
      .filter(({ route }) =>
        isTopologyRouteCombinationValid(pointTopology, areas, route.stationIds),
      )
      .map(({ route, index }) => ({
        route,
        color: routeColorForIndex(index),
        emphasized: true,
      }))
  }, [mapRoutes, visibleRouteIds, routePlanningDraft, pointTopology, areas])

  const onStartNewRoute = useCallback(
    (groupId: string | null) => {
      if (mapEditorMode !== 'edit') return
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
      if (!window.confirm(`確定刪除路線「${label}」？此動作無法復原。`)) return
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
      const label = group?.displayName ?? '此路線群組'
      if (
        !window.confirm(
          `確定刪除「${label}」？群組內的路線將移至「未分組」，路線本身不會被刪除。`,
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
   * 存到後端，失敗要講。
   *
   * 原本是 void publishMapLibraryEntryToBackend(updated)——射後不理。使用者以為存好了，
   * 其實只進了這台瀏覽器的快取；換一台電腦打開就是舊的，而且沒有任何線索。
   * 本機快取照樣先寫（後端掛掉時畫面仍要能編），但沒送成功一定要說。
   */
  const publishAndReport = useCallback(async (entry: MapLibraryEntry) => {
    const result = await publishMapLibraryEntryToBackend(entry)
    setBackendSyncFailed(!result.ok)
  }, [])

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
        alert('找不到地圖，請重新整理清單。')
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
    setAutosaveTimeLabel('編輯中：變更將自動儲存至地圖庫')
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
      void publishAndReport(updated)
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
    setAutosaveTimeLabel(`已儲存 ${new Date().toLocaleTimeString()}`)
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
    const t = window.setTimeout(() => {
      setAutosaveStatus('saving')
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
        void publishAndReport(updated)
      }
      clearMapDraft(libraryId)
      const savedAt = new Date()
      setAutosaveStatus('saved')
      setAutosaveTimeLabel(
        `已自動儲存 ${savedAt.toLocaleString('zh-TW', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}`,
      )
    }, 900)
    autosaveTimerRef.current = t
    return () => {
      clearTimeout(t)
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
        alert(`載入軌跡失敗：${e instanceof Error ? e.message : String(e)}`)
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
        alert('請先選擇車輛')
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
        alert(`匯入軌跡失敗：${e instanceof Error ? e.message : String(e)}`)
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
          label: '匯入的檔案',
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
      item: Exclude<PaletteItem, { type: 'Area' }>,
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
        const { w, h } = defaultSizeMetersForType('Geofence')
        const centerM = {
          x: positionMeters.x + w / 2,
          y: positionMeters.y + h / 2,
        }
        return syncGeofenceFacility({
          id,
          type: 'Geofence',
          name: 'Geofence',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: 'Normal',
          parameters: {
            verticesMeters: defaultRectVerticesMeters(centerM, w, h),
            strokeStyle: 'solid',
            strokeWidthPx: 3,
            strokeColor: '#22d3ee',
            fillEnabled: false,
            fillColor: '#22d3ee',
            fillOpacity: 0.12,
            labels: [],
            ...defaultRefFieldParametersForType('Geofence'),
          },
        })
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
      if (item.type === 'TrackCrossover') {
        return {
          id,
          type: 'TrackCrossover',
          name: 'TrackCrossover',
          customName: '',
          areaPosition,
          position: positionMeters,
          rotation: 0,
          currentState: getDefaultStateForType('TrackCrossover'),
          parameters: {
            ...defaultTrackCrossoverParameters(
              positionMeters.x,
              positionMeters.y,
            ),
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
      if (isBasemapPaletteItem(item)) {
        pushHistory()
        const id = String(nextNumericId).padStart(3, '0')
        const newBasemap = createBlankBasemap(id, mapCenter)
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
      const w = Math.max(200, ps.width * 0.42)
      const h = Math.max(160, ps.height * 0.38)
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
      const w = 320
      const h = 240
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
    (_item: PaletteItem, mapPointPx: { x: number; y: number }) => {
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      const newBasemap = createBlankBasemap(id, mapPointPx)
      setBasemaps((prev) => [...prev, newBasemap])
      selectedBasemapIdRef.current = id
      setSelectedBasemapId(id)
      updateSelection(null, [])
      setAllAreasSelected(false)
      setNextNumericId((n) => n + 1)
    },
    [pushHistory, nextNumericId, updateSelection],
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
      if (isAreaPaletteItem(item) || isBasemapPaletteItem(item)) return
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area) return
      pushHistory()
      const id = String(nextNumericId).padStart(3, '0')
      const sizePx = defaultCanvasSizePxForType(item.type)
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
      const newFacility = ensureFacilityDualCoords(
        {
          ...facilityFromPaletteItem(item, id, areaPosition, positionMeters),
          areaSizePx: sizePx,
        } as FacilityObject,
        area.domain,
        area.layout,
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
    const pastedFacility =
      newFacility.type === 'Waypoint'
        ? ensureWaypointCode(
            {
              ...newFacility,
              parameters: {
                ...(newFacility.parameters ?? {}),
                waypointCode: generateNextWaypointCode(areasRef.current ?? []),
              },
            },
            areasRef.current ?? [],
          )
        : newFacility.type === 'DockingPoint'
          ? {
              ...newFacility,
              parameters: {
                ...(newFacility.parameters ?? {}),
                stationId: generateNextStationId(areasRef.current ?? []),
              },
            }
          : newFacility
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
    if (!areaId || ids.length <= 1) {
      multiDragStartRef.current = null
      return
    }
    const area = areasRef.current.find((a) => a.id === areaId)
    if (!area) {
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
  }, [pushHistory])

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
        for (const id of Object.keys(session.areaPositions)) {
          const f = area.facilities.find((x) => x.id === id)
          if (!f) continue
          setLiveById((prev) => {
            const eid = getMqttEntityId(f)
            if (!prev[eid]?.positionMeters) return prev
            const next = { ...prev }
            const cur = next[eid]
            if (!cur) return prev
            const { positionMeters: _pm, ...rest } = cur
            next[eid] = rest
            return next
          })
        }
        mapAreaFacilities(areaId, (facilities) =>
          facilities.map((fac) => {
            const origin = session.areaPositions[fac.id]
            if (!origin || fac.type === 'Geofence') return fac
            const nextAreaPos = { x: origin.x + dx, y: origin.y + dy }
            return facilityWithAreaPosition(
              fac,
              nextAreaPos,
              area.domain,
              area.layout,
            )
          }),
        )
        return
      }

      const f = area?.facilities.find((x) => x.id === facilityId)
      if (f) {
        setLiveById((prev) => {
          const eid = getMqttEntityId(f)
          if (!prev[eid]?.positionMeters) return prev
          const next = { ...prev }
          const cur = next[eid]
          if (!cur) return prev
          const { positionMeters: _pm, ...rest } = cur
          next[eid] = rest
          return next
        })
      }
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((fac) => {
          if (fac.id !== facilityId) return fac
          if (fac.type === 'Geofence') return fac
          const area = areasRef.current.find((a) => a.id === areaId)
          if (!area) return fac
          return facilityWithAreaPosition(
            fac,
            update.areaPosition,
            area.domain,
            area.layout,
          )
        }),
      )
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
          facilities.map((f) =>
            selSet.has(f.id) && f.type !== 'Geofence'
              ? nudgeFacilityInArea(f, deltaAreaPx, area.domain, area.layout)
              : f,
          ),
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
            ? nudgeFacilityInArea(f, deltaAreaPx, area.domain, area.layout)
            : f,
        ),
      )
    },
    [mapAreaFacilities],
  )

  const onPatchSelectedParameters = useCallback(
    (patch: Record<string, unknown>) => {
      pushHistory()
      mapSelectedFacility((f) => {
        const merged = { ...(f.parameters ?? {}), ...patch } as Record<
          string,
          unknown
        >
        for (const k of Object.keys(merged)) {
          if (merged[k] === undefined) delete merged[k]
        }
        const next = {
          ...f,
          parameters: Object.keys(merged).length > 0 ? merged : undefined,
        }
        return f.type === 'Geofence'
          ? syncGeofenceFacility(next as GeofenceFacility)
          : (next as FacilityObject)
      })
    },
    [pushHistory, mapSelectedFacility],
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

  const onPatchFacilityParameters = useCallback(
    (areaId: string, facilityId: string, patch: Record<string, unknown>) => {
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) => {
          if (f.id !== facilityId) return f
          const merged = { ...(f.parameters ?? {}), ...patch } as Record<
            string,
            unknown
          >
          for (const k of Object.keys(merged)) {
            if (merged[k] === undefined) delete merged[k]
          }
          return {
            ...f,
            parameters: Object.keys(merged).length > 0 ? merged : undefined,
          }
        }),
      )
    },
    [mapAreaFacilities],
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
    }
  }, [mapEditorMode])

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

  const hasDemoNodes = useMemo(
    () =>
      allFacilities.some((f) => f.id === MQTT_DEMO_BLINK_FACILITY_ID) &&
      allFacilities.some((f) => f.id === MQTT_DEMO_VEHICLE_FACILITY_ID),
    [allFacilities],
  )

  const onAddDemoNodes = useCallback(() => {
    if (hasDemoNodes) return
    const targetArea = areasRef.current[0]
    if (!targetArea) return
    pushHistory()
    const domain = targetArea.domain
    const cx = (domain.xMinM + domain.xMaxM) / 2
    const cy = (domain.yMinM + domain.yMaxM) / 2
    const layout = targetArea.layout
    const blinkPos = { x: cx - 10, y: cy - 5 }
    const vehiclePos = { x: cx + 5, y: cy }
    const blink: FacilityObject = {
      id: MQTT_DEMO_BLINK_FACILITY_ID,
      type: 'Signal',
      name: 'Light',
      customName: 'MQTT 示範·閃爍',
      areaPosition: meterToAreaLocalPx(blinkPos.x, blinkPos.y, domain, layout),
      position: blinkPos,
      rotation: 0,
      currentState: 'Normal',
      parameters: { mqttInstanceId: 'demo-blink' },
    }
    const vehicle: FacilityObject = {
      id: MQTT_DEMO_VEHICLE_FACILITY_ID,
      type: 'Slot',
      name: 'Parking',
      customName: 'MQTT 示範·車輛',
      areaPosition: meterToAreaLocalPx(vehiclePos.x, vehiclePos.y, domain, layout),
      position: vehiclePos,
      rotation: 0,
      slotOccupancy: 'Vacant',
      slotEquipmentState: 'Idle',
      parameters: { mqttInstanceId: 'demo-1' },
    }
    mapAreaFacilities(targetArea.id, (facilities) => [
      ...facilities,
      blink,
      vehicle,
    ])
    setMapEditorMode('edit')
    updateSelection(targetArea.id, [MQTT_DEMO_VEHICLE_FACILITY_ID])
  }, [hasDemoNodes, pushHistory, mapAreaFacilities, updateSelection])

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
      mapAreaFacilities(areaId, (facilities) =>
        facilities.map((f) => {
          if (f.id !== facilityId) return f
          return {
            ...f,
            areaSizePx: { w, h },
          } as FacilityObject
        }),
      )
    },
    [mapAreaFacilities],
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

  const onClearMqttLog = useCallback(() => setMqttLog([]), [])

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

      // 路網拓撲對話框開啟時，快捷鍵由對話框自行處理（避免 Cmd+Z 一次還原整張地圖）
      if (pointTopologyEditorOpenRef.current) return

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

  const mapRulersEnabled = useMemo(() => {
    if (selectedArea) return selectedArea.showRuler
    return areas.some((a) => a.showRuler)
  }, [areas, selectedArea])

  const onToggleMapRulers = useCallback(() => {
    pushHistory()
    const areaId = selectedAreaIdRef.current
    if (areaId) {
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area) return
      updateArea(areaId, { showRuler: !area.showRuler })
      return
    }
    const next = !areasRef.current.some((a) => a.showRuler)
    setAreas((prev) => prev.map((a) => ({ ...a, showRuler: next })))
  }, [pushHistory, updateArea])

  const mapRulersToggleHint = selectedArea
    ? `切換「${selectedArea.customName.trim() || selectedArea.id}」公尺刻度`
    : '切換全部 Area 公尺刻度'

  const onToggleAreaCenterLabels = useCallback(() => {
    setShowAreaCenterLabels((v) => !v)
  }, [])

  const onToggleZoomLevelBar = useCallback(() => {
    setShowZoomLevelBar((v) => !v)
  }, [])

  const onToggleTestDock = useCallback(() => {
    setShowTestDock((prev) => {
      if (prev) connectivityScan.resetScan()
      return !prev
    })
  }, [connectivityScan])

  const onToggleFacilityToolbars = useCallback(() => {
    setShowFacilityToolbars((v) => !v)
  }, [])

  return (
    <MapExtentProvider extent={mapExtentMeters}>
    <div className="flex h-screen min-h-0 flex-col bg-zinc-950 text-zinc-100">
      {isMapWorkspace && mapScreen === 'library' && (
        <MapLibraryPage onOpenMap={openLibraryMap} onBackToHome={onBackToHome} />
      )}
      {isMapWorkspace && mapScreen === 'editor' && backendSyncFailed && (
        <div className="shrink-0 border-b border-amber-800/60 bg-amber-950/50 px-4 py-2 text-xs text-amber-300">
          這張地圖<strong className="text-amber-200">沒有存到伺服器</strong>，目前只在這台瀏覽器裡。
          換一台電腦或清一次快取就會看到舊版本——請確認後端連線，再存一次。
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
          onToggleRulers={onToggleMapRulers}
          rulersToggleHint={mapRulersToggleHint}
          showAreaCenterLabels={showAreaCenterLabels}
          onToggleAreaCenterLabels={onToggleAreaCenterLabels}
          areaCenterLabelsToggleHint="顯示／隱藏全部 Area 中央標示（名稱、場域範圍、像素尺寸）"
          showZoomLevelBar={showZoomLevelBar}
          onToggleZoomLevelBar={onToggleZoomLevelBar}
          zoomLevelBarToggleHint="顯示／隱藏底部圖台縮放列（1 近～7 遠）"
          showTestDock={showTestDock}
          onToggleTestDock={onToggleTestDock}
          testDockToggleHint="顯示／隱藏底部測試器（斷路掃描、MQTT 模擬）"
          mapCanvasResizeActive={mapCropModeActive}
          onToggleMapCanvasResize={
            mapEditorMode === 'edit' ? onToggleCropMode : undefined
          }
          mapCanvasResizeToggleHint="裁減模式：在較大工作區拖曳裁切框調整輸出解析度"
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
          facilityToolbarsToggleHint="顯示／隱藏選取元件的圓形工具列（旋轉、格式複製、刪除）"
        />
      )}
      {isMapWorkspace && mapScreen === 'editor' && (
      <div
        className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 py-1.5 font-mono text-xs text-zinc-400"
        aria-live="polite"
      >
        <span className="truncate text-zinc-300">
          {loadedMapMeta.displayName || '未命名地圖'}
          <span className="text-zinc-600"> · </span>
          {loadedMapMeta.version}
        </span>
        <span className="text-zinc-600" aria-hidden>
          |
        </span>
        <span>
          {activeViewportCenterMeters ? (
            <>
              座標（m）：{activeViewportCenterMeters.x.toFixed(2)},{' '}
              {activeViewportCenterMeters.y.toFixed(2)}
              {selectedFacility
                ? selectedFacilityIds.length > 1
                  ? ` · 已選 ${selectedFacilityIds.length} 個元件（${selectedFacility.customName.trim() || selectedFacility.id}）`
                  : ` · ${selectedFacility.customName.trim() || selectedFacility.id}`
                : selectedArea
                  ? ` · ${selectedArea.customName.trim() || selectedArea.id}`
                  : ''}
            </>
          ) : (
            '選取 Area 或設施以顯示座標（m）'
          )}
        </span>
        <span className="text-zinc-600" aria-hidden>
          |
        </span>
        <span>
          畫布（px）：{mapPixelSize.width}×{mapPixelSize.height}
        </span>
      </div>
      )}
      {isTrajectoryWorkspace && (
      <div
        className="flex shrink-0 items-center gap-3 border-b border-zinc-700/80 bg-zinc-950 px-4 py-2"
        role="toolbar"
        aria-label="軌跡圖台"
      >
        <span className="text-sm font-semibold text-zinc-100">軌跡圖台</span>
      </div>
      )}
      {isTrajectoryWorkspace && (
      <div
        className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 py-1.5 font-mono text-xs text-zinc-400"
        aria-live="polite"
      >
        <span>
          畫面中心（m）：{trajectoryViewportCenterMeters.x.toFixed(2)},{' '}
          {trajectoryViewportCenterMeters.y.toFixed(2)}
        </span>
      </div>
      )}
      {isMapWorkspace && mapScreen === 'editor' && mapEditorMode === 'edit' && (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-4 py-1.5 text-xs text-zinc-400"
          role="status"
          aria-live="polite"
        >
          {autosaveStatus === 'saving' && (
            <Loader2
              className="size-3.5 shrink-0 animate-spin text-cyan-400"
              aria-hidden
            />
          )}
          <span>
            {autosaveStatus === 'saving'
              ? '正在自動儲存…'
              : autosaveTimeLabel || '編輯中：變更將自動儲存至地圖庫'}
          </span>
        </div>
      )}
      {(!isMapWorkspace || mapScreen === 'editor') && (
      <div className="relative flex min-h-0 flex-1">
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={isMapWorkspace ? '地圖編輯' : '軌跡回放'}
        >
          <div className="relative min-h-0 w-full flex-1">
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
                liveById={liveById}
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
                connectivityScan={showTestDock ? connectivityScan.state : null}
                facilityFocusTarget={facilityFocusTarget}
                onFacilityDoubleClick={onFacilityDoubleClick}
                onBasemapDoubleClick={onBasemapDoubleClick}
                routePlanningOverlay={
                  routeOverlayPreview || routeOverlaySaved.length > 0 ? (
                    <RoutePlanningOverlay
                      areas={areas}
                      pointTopology={pointTopology}
                      activePreview={routeOverlayPreview}
                      savedRoutes={routeOverlaySaved}
                    />
                  ) : null
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

          {isMapWorkspace && mapScreen === 'editor' && showZoomLevelBar && (
            <ZoomLevelBar
              level={mapZoomLevel}
              onLevelChange={setMapZoomLevel}
              paletteOpen={mapEditorMode === 'edit' && paletteOpen}
              testDockOffset={showTestDock}
              onDismiss={() => setShowZoomLevelBar(false)}
            />
          )}
          {isMapWorkspace && mapScreen === 'editor' && showTestDock && (
            <MapEditorTestDock
              facilities={allFacilities}
              liveById={liveById}
              mqttLog={mqttLog}
              onClearLog={onClearMqttLog}
              onAddDemoNodes={onAddDemoNodes}
              viewportCenterMeters={activeViewportCenterMeters ?? { x: 0, y: 0 }}
              hasDemoNodes={hasDemoNodes}
              scanState={connectivityScan.state}
              onStartScan={connectivityScan.startScan}
              onContinueScan={connectivityScan.continueScan}
              onStopScan={connectivityScan.stopScan}
              onResetScan={connectivityScan.resetScan}
              onSelectIssue={onSelectConnectivityIssue}
              paletteOpen={mapEditorMode === 'edit' && paletteOpen}
            />
          )}

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

        {isMapWorkspace && mapScreen === 'editor' ? (
          <PointTopologyEditorDialog
            open={pointTopologyEditorOpen}
            areas={areas}
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
                title="收合屬性面板"
                aria-label="收合屬性面板"
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
                    onApplyDockingPoint={
                      readOnlyCanvas ? undefined : onApplyDockingPoint
                    }
                    onApplyWaypoint={
                      readOnlyCanvas ? undefined : onApplyWaypoint
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
                      全選 Area（{areas.length}）
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm text-zinc-400">
                      <p className="leading-relaxed">
                        已選取此圖台上全部 Area。拖曳任意外框的
                        <strong className="text-zinc-200">移動軌道</strong>
                        ，或拖曳 Area 之間的
                        <strong className="text-zinc-200">畫布空白</strong>
                        ，可一次平移所有區域。
                      </p>
                      <p className="mt-3 text-xs text-zinc-600">
                        點選單一 Area 可改為個別編輯；Esc 取消全選；⌘/Ctrl+Z 可復原整體移動。
                      </p>
                    </div>
                  </aside>
                ) : (
                  <aside
                    data-inspector
                    className="flex h-full min-h-0 flex-col bg-zinc-900/50"
                  >
                    <div className="border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      屬性
                    </div>
                    <div className="p-4 text-sm text-zinc-500">
                      <p>
                        {readOnlyCanvas
                          ? '請點選畫布上的物件以檢視屬性（檢視模式無法編輯）。'
                          : '請點選畫布上的物件以編輯屬性；⌘/Ctrl+A 全選 Area；工具列「裁減」進入裁切模式。'}
                      </p>
                      <p className="mt-3 text-xs text-zinc-600">
                        元件可設定參照場域位置；Area 僅作為畫布上的群組容器。
                        {readOnlyCanvas
                          ? ' 按「編輯」後可拖曳、旋轉與修改。'
                          : ' 快捷鍵：⌘/Ctrl+A 全選 Area；工具列「裁減」在較大工作區拖切框。⌘/Ctrl+C／V、Delete、⌘/Ctrl+Z。'}
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
              className="pointer-events-auto absolute right-0 top-1/2 z-40 flex min-h-0 w-11 -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-l-md border border-r-0 border-zinc-700/80 bg-zinc-900/95 py-4 text-[11px] font-medium text-zinc-400 shadow-lg backdrop-blur-sm transition hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              title="展開屬性面板"
              aria-label="展開屬性面板"
            >
              <ChevronLeft className="size-4 shrink-0" aria-hidden />
              <span
                className="text-center leading-tight tracking-wide"
                style={{ writingMode: 'vertical-rl' }}
              >
                屬性
              </span>
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
