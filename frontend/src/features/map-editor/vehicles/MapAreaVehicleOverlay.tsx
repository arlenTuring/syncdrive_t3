import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { MapAreaVehiclesContext } from './MapAreaVehiclesContext';
import type { VehicleDefinition } from '../../vehicle-editor/types';
import {
  buildStationMileageIndex,
  stationProgressAt,
  type StationProgress,
} from '../utils/trackGenStations';
import { VehicleDefinitionMapView } from '../../vehicle-editor/elements/VehicleDefinitionMapView';
import {
  drawnDirectionAtField,
  drawnRotateWithSwingDeg,
  rotateDegForDrawnDirection,
} from './resolveVehicleTrackPlacement';
import {
  quantisedTrackCellPlacement,
  trackAlongIsReversed,
} from './quantisedTrackCell';
import { getTrackGenPaths } from '../utils/trackGenPaths';
import { trackCodeFromFacility } from './trackNetwork/scanMap';
import {
  passageProgress,
  resolveRoofIndicatorConfig,
  type TrackPassageState,
  type VehicleRoofIndicatorConfig,
} from './vehicleRoofIndicator';
import { VehicleTrackProgressBadge } from './VehicleTrackProgressBadge';
import {
  trackerNext,
  trackerPrior,
  type BranchTrackState,
  type TrackerFrame,
  type TrackerPrior,
} from './vehicleBranchTracker';
import { locateByField } from '../utils/trackGenLocate';
import {
  isLocateRecording,
  pickLocateRaw,
  publishLocateMap,
  recordLocateFrame,
} from './locateRecorder';
import type { MapAreaObject } from '../types/area';
import {
  areaPositionToCssTopLeft,
} from '../utils/areaCoords';
import {
  buildTrackNetwork,
  resolveVehiclePlacementAcrossAreas,
  resolveTrackCodeForDisplay,
  type VehicleNetworkFix,
  type VehiclePlacementAcrossAreas,
} from './resolveVehicleTrackPlacement';
import {
  readVehicleHeadingRad,
  readVehicleSpeedMps,
  readVehicleSteeringAngleRad,
  mapVehiclePivotRotateDeg,
  headingRadToClockwiseDeg,
} from './readVehicleHeading';
import { useVehiclePathTween } from './useVehiclePathTween';
import { readTelemetrySampleMs } from './pathPlayout';
import { DEFAULT_MAP_VEHICLE_ICON } from './defaultMapVehicleIcon';
import { MapVehicleMarker } from './MapVehicleMarker';
import { resolveMapVehicleBgColor } from './resolveMapVehicleAppearance';
import type { AreaVehicleLive, MapVehicleIconSpec } from './types';
import { MapVehicleDisplaySizer } from '../../dashboard/elements/MapVehicleDisplaySizer';
import {
  computeVehicleBodyCenterOffsetFromRearAxleInDisplayPx,
  computeVehicleRearAxleAnchorPx,
  computeRearAxleAreaLocalForBodyCenterAt,
  computeRearAxleAreaLocalForIconBodyCenterAt,
} from '../../vehicle-editor/utils/vehicleRearAxleAnchor';
import { isLandscapeVehicleDefinition } from '../../vehicle-editor/utils/vehicleContentBounds';
import {
  MapVehicleBehaviorOverlay,
  type MapVehicleBehaviorConfig,
} from '../../dashboard/elements/MapVehicleBehaviorOverlay';
import { readLegSnapKey } from '../../dashboard/utils/simClock';
import { vehicleLastSeenAt } from '../../dashboard/elements/vehicleLastSeen';
import { collectYardSlotFieldBoxes } from '../utils/yardFacilitySlots';
import { withCrossBranchTracks } from '../utils/crossBranches';
import { HEADING_RELIABLE_MPS } from '../utils/trackGenLocate';
import { classifyYardVehicle, type YardDecision } from './yardClassification';
import type { MapPlannedRoute } from '../types/mapFile';
import {
  buildRouteCorridors,
  buildRoutePath,
  readTargetStationId,
  resolveStationPieces,
  routeWindow,
  type RoutePath,
} from './routeCorridor';

/** 每份地圖物件一個識別：換圖時跨時間的分支狀態與路徑快取要失效 */
let mapKeySeq = 0;
const mapKeyOf = new WeakMap<object, string>();
function mapKeyFor(areas: object): string {
  let key = mapKeyOf.get(areas);
  if (!key) {
    mapKeySeq += 1;
    key = `map-${mapKeySeq}`;
    mapKeyOf.set(areas, key);
  }
  return key;
}

function readOrderId(payload: Record<string, unknown> | undefined): string | null {
  const id = payload?.order_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * 沒有載具容器校準尺寸時的後備（區域像素）。
 *
 * 有 vehicle-container／vehicleDisplay*Px 時以校準為準——儀表板編輯器調好的長寬
 * 才是車號可讀性的來源。這裡硬編死會讓本地跟雲端只要平面設定不同就長得不一樣，
 * 而且會把樣板上 20–23px 的車號壓到幾乎看不清。
 */
const FALLBACK_TRACK_VEHICLE_WIDTH_PX = 120;
const FALLBACK_TRACK_VEHICLE_HEIGHT_PX = 42;

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function formatDeg(rad: number | null, digits = 1): string {
  if (rad == null || !Number.isFinite(rad)) return '—';
  return `${radToDeg(rad).toFixed(digits)}°`;
}

function formatHeadingDeg(rad: number | null, digits = 1): string {
  if (rad == null || !Number.isFinite(rad)) return '—';
  return `${headingRadToClockwiseDeg(rad).toFixed(digits)}°`;
}

function MapVehicleMqttCoordLabel({
  xM,
  yM,
  trackCode,
  vehicleId,
  headingRad,
  steeringRad,
  containerRotateDeg,
  networkFix,
  stationProgress,
  left,
  top,
  zIndex,
}: {
  xM: number;
  yM: number;
  trackCode: string | null;
  vehicleId: string;
  headingRad: number | null;
  steeringRad: number | null;
  containerRotateDeg: number | null;
  networkFix: VehicleNetworkFix | null;
  stationProgress: StationProgress | null;
  left: number;
  top: number;
  zIndex: number;
}) {
  const track = trackCode ? ` · ${trackCode}` : '';
  return (
    <div
      className="pointer-events-none absolute rounded px-1.5 py-1 font-mono text-[10px] leading-snug text-white shadow-sm"
      style={{
        left,
        top,
        zIndex,
        transform: 'translate(-50%, calc(-100% - 6px))',
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
      }}
    >
      <div className="whitespace-nowrap">
        {vehicleId} · 場域 {xM.toFixed(1)}, {yM.toFixed(1)} m{track}
      </div>
      <div className="whitespace-nowrap text-cyan-200">
        heading {formatHeadingDeg(headingRad, 1)} · 轉向角 {formatDeg(steeringRad, 1)}
        {containerRotateDeg != null && Number.isFinite(containerRotateDeg)
          ? ` · 旋轉 ${containerRotateDeg.toFixed(1)}°`
          : ''}
      </div>
      {networkFix ? (
        /* 路網位置是本端反查出來的，車端沒有送這幾個值 */
        <div className="whitespace-nowrap text-amber-200">
          road {networkFix.roadId} · lane {networkFix.laneId} · 里程{' '}
          {networkFix.sM.toFixed(1)} m · 偏離 {networkFix.offsetM.toFixed(2)} m
        </div>
      ) : null}
      {stationProgress?.next || stationProgress?.from ? (
        /* 站也換算成里程，所以「還有多遠」就是兩個里程相減 */
        <div className="whitespace-nowrap text-emerald-200">
          {stationProgress.from
            ? `離 ${stationProgress.from.stationName} ${(stationProgress.distanceFromM ?? 0).toFixed(0)} m`
            : '起點'}
          {' · '}
          {stationProgress.next
            ? `下一站 ${stationProgress.next.stationName} ${(stationProgress.distanceToNextM ?? 0).toFixed(0)} m`
            : '本段無下一站'}
        </div>
      ) : null}
    </div>
  );
}

function MapVehicleAnchorDebugMark({
  left,
  top,
  zIndex,
}: {
  left: number;
  top: number;
  zIndex: number;
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left,
        top,
        zIndex,
        width: 12,
        height: 12,
        transform: 'translate(-50%, -50%)',
      }}
      aria-hidden
    >
      <div className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 rounded bg-fuchsia-400/90" />
      <div className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 rounded bg-fuchsia-400/90" />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/60 bg-fuchsia-300" />
    </div>
  );
}

const NO_VEHICLES: AreaVehicleLive[] = [];

export function MapAreaVehicleOverlay({
  areas: sourceAreas,
  vehicles: vehiclesProp,
  iconSpec = DEFAULT_MAP_VEHICLE_ICON,
  showLabels = true,
  showMqttCoords = true,
  showAnchorDebug = true,
  vehicleDefinition = null,
  vehicleDisplayWidthPx,
  vehicleDisplayHeightPx,
  routes,
  vehicleFitMode = 'contain',
  vehicleBehavior,
  vehicleEditSizer = null,
  livePositionTweenMs = 0,
  roofIndicator,
  orderStationsById,
}: {
  areas: MapAreaObject[];
  /** 沒給就讀 MapAreaVehiclesContext */
  vehicles?: AreaVehicleLive[];
  iconSpec?: MapVehicleIconSpec;
  showLabels?: boolean;
  /** 車輛旁顯示場域參照座標（公尺，非圖台 px） */
  showMqttCoords?: boolean;
  /** 顯示系統實際用於判定/定位的錨點 */
  showAnchorDebug?: boolean;
  vehicleDefinition?: VehicleDefinition | null;
  /** 載具橫向顯示尺寸（px，沿軌道） */
  vehicleDisplayWidthPx: number;
  /** 載具縱向顯示尺寸（px，垂直軌道） */
  vehicleDisplayHeightPx: number;
  /** 地圖上的營運路線；有的話用訂單目標站推出走廊，限縮挑塊的候選軌道 */
  routes?: readonly MapPlannedRoute[];
  vehicleFitMode?: 'contain' | 'stretch';
  vehicleBehavior?: MapVehicleBehaviorConfig;
  /** 儀表板編輯：對第一輛預覽載具顯示校準框 */
  vehicleEditSizer?: {
    targetKey: string;
    onSizeChange: (width: number, height: number) => void;
  } | null;
  /**
   * 即時圖台位置補間（毫秒）。> 0 時對車輛標記的 left/top 套用線性 CSS transition，
   * 讓 1Hz 的遙測座標在兩幀之間平滑滑動（避免「一格一格跳」）。0 表示即時定位（編輯器用）。
   */
  livePositionTweenMs?: number;
  /** 車頂軌道進度指標的外觀與顯示項目（存在儀表板圖台元件上） */
  roofIndicator?: VehicleRoofIndicatorConfig | null;
  /** 每張訂單的有序站序（訂單 id → 站代號）：建任務路徑，判位時只在合法的分支之間決定 */
  orderStationsById?: Record<string, readonly string[]>;
}) {
  const vehiclesFromContext = useContext(MapAreaVehiclesContext);
  const vehicles = vehiclesProp ?? vehiclesFromContext ?? NO_VEHICLES;
  const roofConfig = useMemo(() => resolveRoofIndicatorConfig(roofIndicator), [roofIndicator]);
  /** 每台車目前這一次通行的方向（只在記憶體；換軌道就重新判斷） */
  const passageRef = useRef(new Map<string, TrackPassageState>());
  /*
   * 定位用的區域：交叉軌道換成各分支（斜行、直行各自一條中心線），見 crossBranches。
   * 之後所有查詢（挑塊、走廊、里程、畫面座標）都吃這一份，才會對到同一組軌道 id。
   */
  const areas = useMemo(() => withCrossBranchTracks(sourceAreas), [sourceAreas]);
  const areaById = useMemo(
    () => new Map(areas.map((a, i) => [a.id, { area: a, stackOrder: i }])),
    [areas],
  );
  const trackNetwork = useMemo(() => buildTrackNetwork(areas), [areas]);
  // 診斷錄製：記下當時的地圖與路線（原始 areas，不是拆過分支的那一份），離線重播要用同一份
  if (isLocateRecording()) publishLocateMap(sourceAreas, routes ?? []);
  /*
   * 訂單路線的走廊：終點站 → 沿路網走得到的那幾塊軌道。車的 current_leg.target_station_id
   * 就是鍵。沒給路線、站沒放在路網上、目標不是站（進出場入口點）時沒有走廊，等於沒有這條旁證。
   */
  const routeCorridors = useMemo(
    () => buildRouteCorridors(areas, routes ?? [], trackNetwork.genIndex),
    [areas, routes, trackNetwork],
  );
  const mapKey = mapKeyFor(sourceAreas);
  /** 站 → 所在分支（段）；任務路徑用 */
  const stationPieces = useMemo(
    () => (trackNetwork.genIndex ? resolveStationPieces(areas, trackNetwork.genIndex) : new Map<string, number>()),
    [areas, trackNetwork],
  );
  const routePathCacheRef = useRef<Map<string, RoutePath | null>>(new Map());
  /** 訂單 → 有序分支路徑（依地圖與站序快取；換圖自然換 key） */
  const routePathFor = (orderId: string, stations: readonly string[]): RoutePath | null => {
    if (!trackNetwork.genIndex) return null;
    const key = `${mapKey}|${orderId}|${stations.join('>')}`;
    const cache = routePathCacheRef.current;
    if (!cache.has(key)) {
      if (cache.size > 200) cache.clear();
      cache.set(key, buildRoutePath(trackNetwork.genIndex, stationPieces, stations, `${orderId}|${stations.join('>')}`));
    }
    return cache.get(key) ?? null;
  };
  /** 每台車跨時間的分支狀態（見 vehicleBranchTracker） */
  const branchTrackerRef = useRef<Map<string, BranchTrackState>>(new Map());
  /*
   * 停站的車畫面不變、不會重新繪製，跨時間分支狀態的時間就不會往前推，再開動時會被當成斷訊。
   * 每兩秒重看一次，讓還在收資料的車把狀態時間往前推（見 resolveCachedPlacement）。
   */
  const [, setTrackerTick] = useState(0);
  useEffect(() => {
    if (vehicles.length === 0) return undefined;
    const id = window.setInterval(() => setTrackerTick((n) => n + 1), 2_000);
    return () => window.clearInterval(id);
  }, [vehicles.length]);
  const yardSlotBoxes = useMemo(() => collectYardSlotFieldBoxes(areas), [areas]);
  /*
   * 停在格子裡的車就當成場區車，不管它回報什麼。
   *
   * 車端執行任務時不回報格位（協議把格位判定交給中心端），所以正開進充電格的車
   * 在 payload 上看起來跟正線車一樣，會被貼到最近的軌道格——充電區 E1～E3 就在
   * 下行線旁邊，畫面上是好幾台車疊在線上。
   */
  const yardStateRef = useRef<Map<string, { key: string; decision: YardDecision }>>(new Map());
  const yardDecisionOf = useCallback(
    (vehicle: AreaVehicleLive): YardDecision => {
      // 同一筆資料在一次 render 裡會被問好幾次；只推進一次狀態
      const key = `${vehicle.updatedAt}|${vehicle.xM}|${vehicle.yM}`;
      const cached = yardStateRef.current.get(vehicle.vehicleId);
      if (cached?.key === key) return cached.decision;
      const decision = classifyYardVehicle({
        payload: vehicle.payload,
        xM: vehicle.xM,
        yM: vehicle.yM,
        boxes: yardSlotBoxes,
        nowMs: vehicle.updatedAt ?? Date.now(),
        previous: cached?.decision.state,
      });
      yardStateRef.current.set(vehicle.vehicleId, { key, decision });
      return decision;
    },
    [yardSlotBoxes],
  );
  /*
   * 停靠站的里程表。站是人放的，與軌道之間本來沒有關聯；換算成里程之後，「離下一站
   * 多遠」就只是兩個里程相減，不受簡圖比例尺影響。
   */
  const stationMileage = useMemo(
    () => buildStationMileageIndex(areas, trackNetwork.genIndex),
    [areas, trackNetwork],
  );
  /*
   * 軌道上的車沿路徑補間，不在畫面上直線滑。見 pathTween：直線補間走的是兩點的弦，
   * 彎道兩側的兩個點之間會切出軌道。編輯模式（補間 0 毫秒）不補。
   */
  const { resolve: resolvePathPose, prune: prunePathTween, reset: resetPathTween } = useVehiclePathTween(
    trackNetwork.genIndex ?? undefined,
    livePositionTweenMs,
  );
  const placementCacheRef = useRef<
    Map<
      string,
      { inputKey: string; placement: VehiclePlacementAcrossAreas | null; preferYard: boolean }
    >
  >(new Map());

  useEffect(() => {
    const activeIds = new Set(vehicles.map((v) => v.vehicleId));
    for (const id of placementCacheRef.current.keys()) {
      if (!activeIds.has(id)) placementCacheRef.current.delete(id);
    }
    prunePathTween(activeIds);
  }, [vehicles, prunePathTween]);

  function resolveCachedPlacement(
    vehicle: AreaVehicleLive,
    network: ReturnType<typeof buildTrackNetwork>,
  ): VehiclePlacementAcrossAreas | null {
    const yardDecision = yardDecisionOf(vehicle);
    const preferYard = yardDecision.yard;
    // 朝向會決定挑到上行還是下行，所以要進快取的鍵，不然轉頭之後還會拿到舊的那一條
    const headingRad = readVehicleHeadingRad(vehicle.payload);
    // 車速只影響「heading 還可不可信」；分成動與不動兩檔就夠，不要讓每一筆速度都破快取
    const speedMps = readVehicleSpeedMps(vehicle.payload);
    const targetStationId = readTargetStationId(vehicle.payload);
    /*
     * 任務路徑：這張訂單自己的有序站序接成的分支清單。有的話用「目前這一段＋合法後續」；
     * 沒有（還沒拿到站序、不是訂單任務）才退回依目標站推的走廊。
     */
    const orderKey = readOrderId(vehicle.payload);
    const stations = orderKey ? orderStationsById?.[orderKey] : undefined;
    const routePath = orderKey && stations ? routePathFor(orderKey, stations) : null;
    const corridorFacilityIds =
      !routePath && targetStationId ? routeCorridors.byTargetStation.get(targetStationId) : undefined;
    const frame: TrackerFrame = {
      // 最後<strong>收到</strong>遙測的時刻：停站時畫面不變、updatedAt 不動，拿它量斷訊會把停站誤判成斷訊
      t: vehicleLastSeenAt(vehicle.vehicleId) ?? vehicle.updatedAt ?? Date.now(),
      xM: vehicle.xM,
      yM: vehicle.yM,
      orderKey,
      routeKey: routePath?.key ?? null,
      mapKey,
      speedMps: speedMps ?? null,
    };
    const trackerState = branchTrackerRef.current.get(vehicle.vehicleId);
    /*
     * 上一筆確認的分支：只有地圖、任務沒換、沒有斷訊太久、位置沒有跳變時才沿用
     * （見 vehicleBranchTracker）。它只在座標分不開的分支之間起作用，位置明顯在別處時照樣換。
     */
    const prior: TrackerPrior = preferYard
      ? { routeIndex: null, resetReason: 'none' }
      : trackerPrior(trackerState, frame);
    const routeBranchIds = routePath ? routeWindow(routePath, prior.routeIndex) : undefined;
    const inputKey = [
      vehicle.xM.toFixed(2),
      vehicle.yM.toFixed(2),
      preferYard ? `y:${yardDecision.slotId}` : 't',
      headingRad == null ? '-' : headingRad.toFixed(3),
      speedMps == null ? '-' : speedMps < HEADING_RELIABLE_MPS ? 's' : 'm',
      readLegSnapKey(vehicle.payload ?? {}),
      routePath ? `${routePath.key}#${prior.routeIndex ?? '-'}` : corridorFacilityIds ? targetStationId : '-',
      prior.previousBranchId ?? '-',
      mapKey,
    ].join('|');
    const cached = placementCacheRef.current.get(vehicle.vehicleId);
    if (cached?.inputKey === inputKey) {
      // 輸入沒變（停著）但資料還在進來：分支狀態仍然有效，時間往前推，不要被當成斷訊
      if (trackerState && prior.resetReason === null && frame.t > trackerState.t) {
        branchTrackerRef.current.set(vehicle.vehicleId, { ...trackerState, t: frame.t });
      }
      return cached.placement;
    }
    const previousTrackId = prior.previousBranchId;
    const placement = resolveVehiclePlacementAcrossAreas(
      areas,
      vehicle.xM,
      vehicle.yM,
      network,
      {
        preferYardPlacement: preferYard,
        yardSlotId: yardDecision.slotId,
        payload: vehicle.payload,
        headingRad: headingRad ?? undefined,
        speedMps: speedMps ?? undefined,
        previousTrackId,
        corridorFacilityIds,
        routeBranchIds,
      },
    );
    placementCacheRef.current.set(vehicle.vehicleId, { inputKey, placement, preferYard });
    const fix = placement?.placement.network;
    if (preferYard || placement?.placement.source !== 'generated') {
      // 停格、場區移動、沒有有效軌道匹配：不帶著上一條軌道的分支狀態
      branchTrackerRef.current.delete(vehicle.vehicleId);
    } else {
      const next = trackerNext(
        trackerState,
        frame,
        prior,
        placement && fix
          ? {
              branchId: placement.placement.trackId,
              alongFrac: fix.alongFrac,
              confirmed: fix.identity?.status === 'confirmed',
            }
          : null,
        routePath,
      );
      if (next) branchTrackerRef.current.set(vehicle.vehicleId, next);
      else branchTrackerRef.current.delete(vehicle.vehicleId);
    }
    if (isLocateRecording()) {
      // 診斷錄製：同一組輸入再算一次，帶回每個候選的評分拆解（只有重算時才錄，不是每個影格）
      const diag =
        !preferYard && network.genIndex
          ? locateByField(network.genIndex, vehicle.xM, vehicle.yM, {
              headingRad: headingRad ?? undefined,
              speedMps: speedMps ?? undefined,
              previousFacilityId: previousTrackId,
              corridorFacilityIds,
              routeBranchIds,
              collectCandidates: true,
            })
          : null;
      recordLocateFrame({
        t: frame.t,
        vehicleId: vehicle.vehicleId,
        xM: vehicle.xM,
        yM: vehicle.yM,
        headingRad: headingRad ?? null,
        speedMps: speedMps ?? null,
        targetStationId,
        legKey: readLegSnapKey(vehicle.payload ?? {}),
        raw: pickLocateRaw(vehicle.payload),
        preferYard,
        yardSlotId: yardDecision.slotId ?? null,
        previousTrackId: previousTrackId ?? null,
        corridor: corridorFacilityIds ? [...corridorFacilityIds] : null,
        route: routePath
          ? { key: routePath.key, branchIds: routePath.branchIds, index: prior.routeIndex, window: [...(routeBranchIds ?? [])] }
          : null,
        trackerReset: prior.resetReason,
        placement: placement
          ? {
              source: placement.placement.source ?? null,
              trackId: placement.placement.trackId,
              areaId: placement.area.id,
              areaLocalX: placement.placement.areaLocalX,
              areaLocalY: placement.placement.areaLocalY,
            }
          : null,
        result: {
          trackId: placement?.placement.trackId ?? null,
          alongFrac: fix?.alongFrac ?? null,
          offsetM: fix?.offsetM ?? null,
          distanceM: fix?.distanceM ?? null,
          identity: fix?.identity ?? null,
          distanceMarginM: fix != null && Number.isFinite(fix.distanceMarginM) ? (fix.distanceMarginM ?? null) : null,
          scoreMargin: fix != null && Number.isFinite(fix.scoreMargin) ? (fix.scoreMargin ?? null) : null,
          offRoute: fix?.offRoute ?? null,
          headingConflict: fix?.headingConflict ?? null,
        },
        candidates: diag?.candidates ?? null,
      });
    }
    return placement;
  }


  // 判斷「大跳躍（發車／換段／重生）」用：committed=上一個 commit 的座標（render 時唯讀），
  // staging=本次 render 暫存；commit 後才搬進 committed。如此在 StrictMode 雙重 render 下仍正確。
  /** 上一幀每台車落在第幾格，換格遲滯要用 */
  const trackCellRef = useRef<Map<string, number>>(new Map());
  const committedPosRef = useRef<Map<string, { left: number; top: number }>>(new Map());
  const committedLegRef = useRef<Map<string, string>>(new Map());
  const stagingPosRef = useRef<Map<string, { left: number; top: number }>>(new Map());
  const stagingLegRef = useRef<Map<string, string>>(new Map());
  stagingPosRef.current = new Map();
  stagingLegRef.current = new Map();
  useEffect(() => {
    committedPosRef.current = stagingPosRef.current;
    committedLegRef.current = stagingLegRef.current;
  });

  if (vehicles.length === 0) return null;

  const displayW = Math.max(4, vehicleDisplayWidthPx);
  const displayH = Math.max(2, vehicleDisplayHeightPx);

  return (
    <div className="pointer-events-none absolute inset-0 z-[2000]" aria-hidden>
      {vehicles.map((vehicle) => {
        const yardDecision = yardDecisionOf(vehicle);
        const preferYard = yardDecision.yard;
        const placement = resolveCachedPlacement(vehicle, trackNetwork);
        if (!placement) return null;
        const { area, stackOrder } = {
          area: placement.area,
          stackOrder: areaById.get(placement.area.id)?.stackOrder ?? 0,
        };

        const facilityCenterLocal = {
          x: placement.placement.areaLocalX,
          y: placement.placement.areaLocalY,
        };

        const fieldTrackCode = preferYard
          ? yardDecision.slotId
          : resolveTrackCodeForDisplay(
              areas,
              vehicle.xM,
              vehicle.yM,
              trackNetwork,
            );

        const sizingFacility = placement.placement.trackId
          ? area.facilities.find((f) => f.id === placement.placement.trackId)
          : undefined;
        /*
         * 車身尺寸照它所在那一塊的比例尺換算：車的真實長寬是固定的，示意圖各段的比例尺
         * 卻差很多（這張圖沿線 0.52～12.68 px/m），用同一個像素尺寸走遍全圖，在正線剛好，
         * 到場區就塞不進格位。
         */
        /*
         * 位置：定位挑塊時算好的「走了幾成、偏了多少」，補間期間換成補間中的值。
         *
         * 挑塊算一次，之後的位置、方向、偏差全部吃同一組值——不再各自重新投影。
         * 補間走的是沿線位置，每一幀從那一塊的圖面路徑取座標，所以彎道上不會切出軌道。
         */
        const network = placement.placement.network;
        /*
         * 不在有效軌道上（停格、場區移動、區域座標、手工軌道）：清掉這台車的軌道補間、格化與
         * 通行進度，重新進軌道時不會從過時的軌道位置補過去，也不會沿用舊的進度方向。
         */
        const onGeneratedTrack = placement.placement.source === 'generated' && network !== undefined;
        if (!onGeneratedTrack) {
          resetPathTween(vehicle.vehicleId);
          trackCellRef.current.delete(vehicle.vehicleId);
          passageRef.current.delete(vehicle.vehicleId);
        }
        const legKeyNow = readLegSnapKey(
          vehicle.payload as Record<string, unknown> | undefined,
        );
        const prevPosNow = committedPosRef.current.get(vehicle.vehicleId);
        const prevLegNow = committedLegRef.current.get(vehicle.vehicleId);
        // 大跳躍：首幀或班次／站別切換（發車、換 leg）→ 瞬間定位
        const teleported =
          !prevPosNow || (prevLegNow != null && legKeyNow !== prevLegNow && legKeyNow !== '');
        // 只有有效軌道定位才進軌道補間（偏移也只有通過距離檢查的才會進來）
        const pathPose =
          !preferYard && onGeneratedTrack && network && sizingFacility && placement.placement.trackId
            ? resolvePathPose(
                vehicle.vehicleId,
                {
                  trackId: placement.placement.trackId,
                  along: network.alongFrac,
                  side: network.offsetM,
                },
                // 只有首幀瞬移。換 leg（到站、下一段出發）位置是接著的，照樣沿路補；
                // 真的不連續（換單、重新發車）由補間自己判斷——不相連或超過 80 公尺就直接到位
                !prevPosNow,
                // 遙測時間戳：有的話照車端時間緩衝播放，送達時間抖動不會讓車走走停停
                readTelemetrySampleMs(vehicle.payload as Record<string, unknown> | undefined),
              )
            : null;
        const displayFacility =
          pathPose && pathPose.trackId !== placement.placement.trackId
            ? (area.facilities.find((f) => f.id === pathPose.trackId) ?? sizingFacility)
            : sizingFacility;
        const shownProjection = pathPose
          ? { along: pathPose.along, side: pathPose.side }
          : network
            ? { along: network.alongFrac, side: network.offsetM }
            : undefined;
        const quantised =
          !preferYard && onGeneratedTrack && displayFacility
            ? quantisedTrackCellPlacement(
                displayFacility,
                area,
                vehicle.xM,
                vehicle.yM,
                trackCellRef.current.get(vehicle.vehicleId),
                shownProjection,
              )
            : null;
        if (quantised) trackCellRef.current.set(vehicle.vehicleId, quantised.cell);
        /*
         * 位置格化預設關閉（見 QUANTISE_ALONG_POSITION／QUANTISE_LATERAL_POSITION）：
         * 車畫在真實位置上，偏差以數字與顏色呈現，不再被放大成「整台壓在邊緣」。
         */
        const placementLocal = quantised
          ? { x: quantised.x, y: quantised.y }
          : facilityCenterLocal;

        /*
         * 場區格位的車也用同一個固定尺寸（來自儀表板載具容器校準）。
         *
         * 原本格位上的車照格子的比例尺換算，於是同一台車停在充電區是 65×35、停在
         * 整備區是 38×15——而它只是停著。格子代表的現場尺寸不一致（E 格宣稱橫向
         * 只有 2.3 公尺，比車還窄）本身是圖資問題，不該由車的大小去承擔。
         *
         * 尺寸必須吃 vehicleDisplay*Px：那是儀表板上調好的「車號要多大才看得清」。
         * 硬編 72×30 會把樣板字級壓掉，本地／雲端只要平面校準不同就對不齊。
         */
        const markerW = vehicleDefinition
          ? displayW || FALLBACK_TRACK_VEHICLE_WIDTH_PX
          : iconSpec.width;
        const markerH = vehicleDefinition
          ? displayH || FALLBACK_TRACK_VEHICLE_HEIGHT_PX
          : iconSpec.height;
        /*
         * 有比例尺換算時長寬各自代表真實公尺數：沿線與橫向的 px/m 本來就不同（同一格
         * 一個方向壓縮、另一個沒有），用 contain 取兩者小的那個縮放，等於把已經算對的
         * 其中一軸再縮一次。這時只能各軸獨立縮。
         */
        const fitMode = vehicleDefinition ? 'stretch' : vehicleFitMode;

        const headingRad = readVehicleHeadingRad(vehicle.payload);
        const steeringRad = readVehicleSteeringAngleRad(vehicle.payload);
        const landscape = vehicleDefinition
          ? isLandscapeVehicleDefinition(vehicleDefinition)
          : true;
        /*
         * 車頭照<strong>它所在那一塊畫出來的方向</strong>轉，不是照現場的 heading。
         *
         * 示意圖會把同一段路畫成別的方向：T3 支線在現場是南北向，圖上那幾塊卻是橫的
         * 帶子。照 heading 轉，車就會跟它所在的那條帶子交叉——實測正線上的車被畫成
         * 直立的，橫跨整條帶子。圖面與現場的對應每一塊自己帶著，取切線就有答案。
         *
         * 沒有生成路徑的方塊（手工放的、場區格位）退回照 heading 轉。
         */
        // 只有軌道定位才照軌道的方向畫；場區分區、區域座標、格位不拿任何軌道的切線（照 heading）
        const placedFacility = placement.placement.trackId
          ? area.facilities.find((f) => f.id === placement.placement.trackId)
          : undefined;
        const drawnTrack = pathPose
          ? displayFacility
          : onGeneratedTrack || (placement.placement.source === 'manual' && placedFacility?.type === 'Track')
            ? placedFacility
            : undefined;
        // 走了幾成直接帶進去：補間中的位置不對應任何一筆遙測座標，重投影只會投回起點
        const alongHint = pathPose?.along ?? network?.alongFrac;
        // 車頭讀值屬於「定位那一點」，不屬於補間中的位置（見 HeadingReference）
        const headingReference =
          pathPose && network
            ? (() => {
                const track = area.facilities.find((f) => f.id === placement.placement.trackId);
                return track ? { track, along: network.alongFrac } : undefined;
              })()
            : undefined;
        const drawnDir =
          drawnTrack && headingRad != null
            ? drawnDirectionAtField(
                drawnTrack,
                area,
                vehicle.xM,
                vehicle.yM,
                headingRad,
                alongHint,
                headingReference,
              )
            : null;
        /*
         * 順著帶子畫，但把現場的擺動疊上去：基準是這一塊畫出來的方向，再加上
         * 「現場 heading 減去現場切線」那個偏差。轉彎與蛇行看得到，車不會橫跨帶子。
         */
        const swungRotateDeg = drawnTrack
          ? drawnRotateWithSwingDeg(
              drawnTrack,
              area,
              vehicle.xM,
              vehicle.yM,
              headingRad,
              alongHint,
              headingReference,
            )
          : null;
        const containerRotateDeg =
          swungRotateDeg ??
          (drawnDir
            ? rotateDegForDrawnDirection(drawnDir)
            : headingRad != null
              ? mapVehiclePivotRotateDeg(headingRad, landscape, steeringRad) ?? 0
              : 0);
        const rearAxleAnchor = vehicleDefinition
          ? computeVehicleRearAxleAnchorPx(
              vehicleDefinition,
              markerW,
              markerH,
              fitMode,
            )
          : null;
        const anchorX = vehicleDefinition
          ? (rearAxleAnchor?.x ?? markerW / 2) / markerW
          : iconSpec.anchorX;
        const anchorY = vehicleDefinition
          ? (rearAxleAnchor?.y ?? markerH / 2) / markerH
          : iconSpec.anchorY;

        const livePayload = vehicle.payload as Record<string, unknown> | undefined;
        const liveData = livePayload ?? {};

        const anchorLocal = preferYard
          ? vehicleDefinition
            ? computeRearAxleAreaLocalForBodyCenterAt(
                vehicleDefinition,
                markerW,
                markerH,
                fitMode,
                containerRotateDeg,
                placementLocal,
              )
            : computeRearAxleAreaLocalForIconBodyCenterAt(
                markerW,
                markerH,
                anchorX,
                anchorY,
                containerRotateDeg,
                placementLocal,
              )
          : placementLocal;

        const areaPos = {
          x: anchorLocal.x - markerW * anchorX,
          y: anchorLocal.y - markerH * anchorY,
        };
        const css = areaPositionToCssTopLeft(
          areaPos,
          { w: markerW, h: markerH },
          area.layout.hPx,
        );
        const left = area.layout.xPx + css.left;
        const top = area.layout.yPx + css.top;
        const anchorCss = areaPositionToCssTopLeft(
          anchorLocal,
          { w: 0, h: 0 },
          area.layout.hPx,
        );
        const coordLeft = area.layout.xPx + anchorCss.left;
        const coordTop = area.layout.yPx + anchorCss.top;
        const bgColor = resolveMapVehicleBgColor(vehicle);
        const zIndex = 100 + stackOrder;

        // 大跳躍的判斷在上面（teleported）；高倍速行進仍走 CSS 補間
        stagingPosRef.current.set(vehicle.vehicleId, { left, top });
        stagingLegRef.current.set(vehicle.vehicleId, legKeyNow);

        const style: CSSProperties = {
          position: 'absolute',
          left: 0,
          top: 0,
          // 以 transform 定位＋補間（GPU/compositor），主執行緒忙碌時動畫仍不中斷，
          // 解決「走一段突然卡住再繼續」。left/top 補間是 layout-bound，會被 re-render/long task 卡住。
          transform: `translate3d(${left}px, ${top}px, 0)`,
          zIndex,
          ...(livePositionTweenMs > 0
            ? teleported || pathPose
              ? // 沿路徑補間的車位置每一幀由程式算，不能再疊 CSS 補間（會變成雙重補間、
                // 又走回弦的直線）
                { transition: 'none' }
              : {
                  transition: `transform ${livePositionTweenMs}ms linear`,
                  willChange: 'transform',
                }
            : null),
        };

        /*
         * 進度與偏移：不隨車縮放、也不隨車旋轉。
         *
         * 格化之後「在這一塊的第幾格」看不出來了，所以畫成四格。後面那個百分比是
         * <strong>沒有格化的原始偏移</strong>——以半個軌道寬為 100%，跟橫向分級用的
         * 是同一把尺：±15% 以內算在中間，±100% 就是軌道邊界，超過就是整台在外面。
         *
         * 用比例不用公尺：公尺要先知道軌道多寬才知道算不算偏很多，比例本身就說完了。
         *
         * 沿線的百分比拿掉了——四格已經說明在哪一段，數字是多餘的。車號也不放這裡，
         * 它已經畫在車身上。
         */
        /*
         * 標籤要對準<strong>車身</strong>中心，不是容器中心。
         *
         * 車身在容器裡是繞後軸轉的，後軸又在車長約八成的位置，所以容器的中心跟車身
         * 畫出來的中心差很多——掛在容器中心，標籤會飄在車的斜前上方。
         *
         * 後軸的畫面位置是 (coordLeft, coordTop)，加上「後軸到車身中心」那段位移就是
         * 車身中心；再往上退半個車身高度（轉過之後的高度）才貼在車頂上方。
         */
        const bodyOffset = vehicleDefinition
          ? computeVehicleBodyCenterOffsetFromRearAxleInDisplayPx(
              vehicleDefinition,
              markerW,
              markerH,
              fitMode,
              containerRotateDeg,
            )
          : { dx: 0, dy: 0 };
        const rotRad = (containerRotateDeg * Math.PI) / 180;
        const bodyHalfSpanY =
          (Math.abs(markerW * Math.sin(rotRad)) +
            Math.abs(markerH * Math.cos(rotRad))) /
          2;
        const badgeCenterX = coordLeft + bodyOffset.dx;
        const badgeTopY = coordTop + bodyOffset.dy - bodyHalfSpanY - 4;

        /*
         * 車頂軌道進度：只有<strong>有效的軌道定位</strong>、而且進度是有限值時才畫。名稱與
         * 百分比取自同一份判位結果與它判給的那一條軌道（不用補間中的軌道），格位停車、場區
         * 移動沒有對應軌道就不畫——不補 0%，也不拿最近的軌道充數。
         */
        let cellBadge: ReactElement | null = null;
        const fixTrackId = placement.placement.trackId;
        const fixFacility = network ? area.facilities.find((f) => f.id === fixTrackId) : undefined;
        if (!preferYard && network && fixFacility && roofConfig.enabled && Number.isFinite(network.alongFrac)) {
          const realPath = getTrackGenPaths(fixFacility.parameters)?.real;
          const defaultReversed = realPath ? trackAlongIsReversed(fixFacility.parameters, realPath) : false;
          const passage = passageProgress(
            passageRef.current.get(vehicle.vehicleId),
            fixFacility.id,
            network.alongFrac,
            defaultReversed,
          );
          // 分不開的那一筆，along 可能是別條分支的：不拿來更新這台車的通行方向
          if (network.identity?.status !== 'ambiguous') passageRef.current.set(vehicle.vehicleId, passage.state);
          if (Number.isFinite(passage.progress)) {
            cellBadge = (
              <div
                key={`${vehicle.areaId}:${vehicle.vehicleId}:badge`}
                className="pointer-events-none absolute flex items-center rounded px-2 py-[2px] font-mono leading-none"
                style={{
                  left: badgeCenterX,
                  top: badgeTopY,
                  zIndex: zIndex + 1,
                  backgroundColor: roofConfig.backgroundColor,
                  // 自己往左半個、往上整個——貼在車的正上方置中；不隨車身旋轉
                  transform: 'translate(-50%, -100%)',
                  whiteSpace: 'nowrap',
                }}
              >
                <VehicleTrackProgressBadge
                  config={roofConfig}
                  trackName={trackCodeFromFacility(fixFacility)}
                  progress={passage.progress}
                />
              </div>
            );
          }
        }

        const coordLabel = showMqttCoords ? (
          <MapVehicleMqttCoordLabel
            xM={vehicle.xM}
            yM={vehicle.yM}
            trackCode={fieldTrackCode}
            vehicleId={vehicle.vehicleId}
            headingRad={headingRad}
            steeringRad={steeringRad}
            containerRotateDeg={containerRotateDeg}
            networkFix={placement.placement.network ?? null}
            stationProgress={
              placement.placement.network
                ? stationProgressAt(stationMileage, placement.placement.network)
                : null
            }
            left={coordLeft}
            top={coordTop}
            zIndex={zIndex + 1}
          />
        ) : null;
        const anchorDebug = showAnchorDebug ? (
          <MapVehicleAnchorDebugMark
            left={coordLeft}
            top={coordTop}
            zIndex={zIndex + 2}
          />
        ) : null;

        if (vehicleDefinition) {
          const vehicleKey = `${vehicle.areaId}:${vehicle.vehicleId}`;
          const showEditSizer =
            vehicleEditSizer != null && vehicleEditSizer.targetKey === vehicleKey;

          return (
            <div key={vehicleKey}>
              {coordLabel}
              {anchorDebug}
              {cellBadge}
              <div
                style={{ ...style, overflow: 'visible', pointerEvents: showEditSizer ? 'auto' : 'none' }}
              >
                <div className="pointer-events-none">
                  {/*
                    畫出來的尺寸與轉角必須跟上面定位用的同一組值：外層是拿 markerW／markerH
                    和 containerRotateDeg 反算後軸錨點的，這裡若還是用樣板固定尺寸＋現場
                    heading，車就會被畫在錨點以外的地方、還轉錯方向。
                  */}
                  <VehicleDefinitionMapView
                    definition={vehicleDefinition}
                    liveData={liveData}
                    displayWidth={markerW}
                    displayHeight={markerH}
                    fitMode={fitMode}
                    layoutMode="rear-axle-pivot"
                    livePayloadOnly
                    mapHeadingRad={headingRad}
                    mapSteeringRad={steeringRad}
                    mapRotateDeg={containerRotateDeg}
                  />
                </div>
                {vehicleBehavior ? (
                  <MapVehicleBehaviorOverlay
                    config={vehicleBehavior}
                    vehicleCenterX={markerW / 2}
                    vehicleCenterY={markerH / 2}
                    liveData={liveData}
                  />
                ) : null}
                {showEditSizer ? (
                  <div className="absolute left-0 top-0 z-[5]">
                    <MapVehicleDisplaySizer
                      definition={vehicleDefinition}
                      widthPx={displayW}
                      heightPx={displayH}
                      liveData={liveData}
                      overlayOnly
                      onSizeChange={vehicleEditSizer.onSizeChange}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        }

        return (
          <div key={`${vehicle.areaId}:${vehicle.vehicleId}`}>
            {coordLabel}
            {anchorDebug}
            {cellBadge}
            <MapVehicleMarker
              spec={iconSpec}
              vehicleId={vehicle.vehicleId}
              bgColor={bgColor}
              showLabel={showLabels}
              style={style}
            />
          </div>
        );
      })}
    </div>
  );
}
