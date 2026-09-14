import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VehicleDefinition } from '../../vehicle-editor/types';
import {
  buildStationMileageIndex,
  stationProgressAt,
  type StationProgress,
} from '../utils/trackGenStations';
import { VehicleDefinitionMapView } from '../../vehicle-editor/elements/VehicleDefinitionMapView';
import {
  drawnDirectionAtField,
  rotateDegForDrawnDirection,
} from './resolveVehicleTrackPlacement';
import type { MapAreaObject } from '../types/area';
import {
  areaPositionToCssTopLeft,
} from '../utils/areaCoords';
import {
  buildTrackNetwork,
  isYardVehiclePayload,
  parseYardSlotIdFromPayload,
  resolveVehiclePlacementAcrossAreas,
  resolveTrackCodeForDisplay,
  type VehicleNetworkFix,
  type VehiclePlacementAcrossAreas,
} from './resolveVehicleTrackPlacement';
import {
  readVehicleHeadingRad,
  readVehicleSteeringAngleRad,
  mapVehiclePivotRotateDeg,
  headingRadToClockwiseDeg,
} from './readVehicleHeading';
import { DEFAULT_MAP_VEHICLE_ICON } from './defaultMapVehicleIcon';
import { MapVehicleMarker } from './MapVehicleMarker';
import { resolveMapVehicleBgColor } from './resolveMapVehicleAppearance';
import type { AreaVehicleLive, MapVehicleIconSpec } from './types';
import { MapVehicleDisplaySizer } from '../../dashboard/elements/MapVehicleDisplaySizer';
import {
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

export function MapAreaVehicleOverlay({
  areas,
  vehicles,
  iconSpec = DEFAULT_MAP_VEHICLE_ICON,
  showLabels = true,
  showMqttCoords = true,
  showAnchorDebug = true,
  vehicleDefinition = null,
  vehicleDisplayWidthPx,
  vehicleDisplayHeightPx,
  vehicleFitMode = 'contain',
  vehicleBehavior,
  vehicleEditSizer = null,
  livePositionTweenMs = 0,
}: {
  areas: MapAreaObject[];
  vehicles: AreaVehicleLive[];
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
}) {
  const areaById = useMemo(
    () => new Map(areas.map((a, i) => [a.id, { area: a, stackOrder: i }])),
    [areas],
  );
  const trackNetwork = useMemo(() => buildTrackNetwork(areas), [areas]);
  /*
   * 停靠站的里程表。站是人放的，與軌道之間本來沒有關聯；換算成里程之後，「離下一站
   * 多遠」就只是兩個里程相減，不受簡圖比例尺影響。
   */
  const stationMileage = useMemo(
    () => buildStationMileageIndex(areas, trackNetwork.genIndex),
    [areas, trackNetwork],
  );
  const placementCacheRef = useRef<
    Map<string, { inputKey: string; placement: VehiclePlacementAcrossAreas | null }>
  >(new Map());

  useEffect(() => {
    const activeIds = new Set(vehicles.map((v) => v.vehicleId));
    for (const id of placementCacheRef.current.keys()) {
      if (!activeIds.has(id)) placementCacheRef.current.delete(id);
    }
  }, [vehicles]);

  function resolveCachedPlacement(
    vehicle: AreaVehicleLive,
    network: ReturnType<typeof buildTrackNetwork>,
  ): VehiclePlacementAcrossAreas | null {
    const preferYard = isYardVehiclePayload(vehicle.payload);
    // 朝向會決定挑到上行還是下行，所以要進快取的鍵，不然轉頭之後還會拿到舊的那一條
    const headingRad = readVehicleHeadingRad(vehicle.payload);
    const inputKey = [
      vehicle.xM.toFixed(2),
      vehicle.yM.toFixed(2),
      preferYard ? 'y' : 't',
      headingRad == null ? '-' : headingRad.toFixed(3),
      readLegSnapKey(vehicle.payload ?? {}),
    ].join('|');
    const cached = placementCacheRef.current.get(vehicle.vehicleId);
    if (cached?.inputKey === inputKey) return cached.placement;
    const placement = resolveVehiclePlacementAcrossAreas(
      areas,
      vehicle.xM,
      vehicle.yM,
      network,
      {
        preferYardPlacement: preferYard,
        payload: vehicle.payload,
        headingRad: headingRad ?? undefined,
      },
    );
    placementCacheRef.current.set(vehicle.vehicleId, { inputKey, placement });
    return placement;
  }

  // 判斷「大跳躍（發車／換段／重生）」用：committed=上一個 commit 的座標（render 時唯讀），
  // staging=本次 render 暫存；commit 後才搬進 committed。如此在 StrictMode 雙重 render 下仍正確。
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
        const preferYard = isYardVehiclePayload(vehicle.payload);
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
          ? parseYardSlotIdFromPayload(vehicle.payload)
          : resolveTrackCodeForDisplay(
              areas,
              vehicle.xM,
              vehicle.yM,
              trackNetwork,
            );

        const markerW = vehicleDefinition ? displayW : iconSpec.width;
        const markerH = vehicleDefinition ? displayH : iconSpec.height;

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
        const drawnTrack = placement.placement.trackId
          ? area.facilities.find((f) => f.id === placement.placement.trackId)
          : undefined;
        const drawnDir =
          drawnTrack && headingRad != null
            ? drawnDirectionAtField(
                drawnTrack,
                area,
                vehicle.xM,
                vehicle.yM,
                headingRad,
              )
            : null;
        const containerRotateDeg = drawnDir
          ? rotateDegForDrawnDirection(drawnDir)
          : headingRad != null
            ? mapVehiclePivotRotateDeg(headingRad, landscape, steeringRad) ?? 0
            : 0;
        const rearAxleAnchor = vehicleDefinition
          ? computeVehicleRearAxleAnchorPx(
              vehicleDefinition,
              markerW,
              markerH,
              vehicleFitMode,
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
                vehicleFitMode,
                containerRotateDeg,
                facilityCenterLocal,
              )
            : computeRearAxleAreaLocalForIconBodyCenterAt(
                markerW,
                markerH,
                anchorX,
                anchorY,
                containerRotateDeg,
                facilityCenterLocal,
              )
          : facilityCenterLocal;

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

        // 大跳躍：首幀或班次／站別切換（發車、換 leg）→ 瞬間定位；高倍速行進仍走 CSS 補間
        const prevPos = committedPosRef.current.get(vehicle.vehicleId);
        const legKey = readLegSnapKey(livePayload);
        const prevLeg = committedLegRef.current.get(vehicle.vehicleId);
        const teleported = !prevPos || (prevLeg != null && legKey !== prevLeg && legKey !== '');
        stagingPosRef.current.set(vehicle.vehicleId, { left, top });
        stagingLegRef.current.set(vehicle.vehicleId, legKey);

        const style: CSSProperties = {
          position: 'absolute',
          left: 0,
          top: 0,
          // 以 transform 定位＋補間（GPU/compositor），主執行緒忙碌時動畫仍不中斷，
          // 解決「走一段突然卡住再繼續」。left/top 補間是 layout-bound，會被 re-render/long task 卡住。
          transform: `translate3d(${left}px, ${top}px, 0)`,
          zIndex,
          ...(livePositionTweenMs > 0
            ? teleported
              ? { transition: 'none' }
              : {
                  transition: `transform ${livePositionTweenMs}ms linear`,
                  willChange: 'transform',
                }
            : null),
        };

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
              <div
                style={{ ...style, overflow: 'visible', pointerEvents: showEditSizer ? 'auto' : 'none' }}
              >
                <div className="pointer-events-none">
                  <VehicleDefinitionMapView
                    definition={vehicleDefinition}
                    liveData={liveData}
                    displayWidth={displayW}
                    displayHeight={displayH}
                    fitMode={vehicleFitMode}
                    layoutMode="rear-axle-pivot"
                    livePayloadOnly
                    mapHeadingRad={headingRad}
                    mapSteeringRad={steeringRad}
                  />
                </div>
                {vehicleBehavior ? (
                  <MapVehicleBehaviorOverlay
                    config={vehicleBehavior}
                    vehicleCenterX={displayW / 2}
                    vehicleCenterY={displayH / 2}
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
