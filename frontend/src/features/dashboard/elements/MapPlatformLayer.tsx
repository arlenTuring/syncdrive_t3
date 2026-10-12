/**
 * 圖台渲染層：供「圖台容器」與舊版 map-canvas 子元件共用。
 */
import { subscribeDatasourceInvalidation } from '../utils/datasourceInvalidationBus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { MapAreaObject, MapPixelSize } from '../../map-editor/types/area';
import type { MapPlannedRoute } from '../../map-editor/types/mapFile';
import { DEFAULT_MAP_PIXEL_SIZE } from '../../map-editor/types/area';
import { resolveMapId } from '../../map-editor/constants/builtinMaps';
import { resolveParsedMapForPlatform } from '../../map-editor/utils/mapLibraryStorage';
import { buildTrackNetwork } from '../../map-editor/vehicles/resolveVehicleTrackPlacement';
import { buildDemoAreaVehicles } from '../../map-editor/vehicles/demoAreaVehicles';
import {
  DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX,
  DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX,
} from '../../map-editor/vehicles/resolveMapVehicleTrackSizing';
import type { MapVehicleTemplateConfig } from '../utils/resolveMapVehicleTemplate';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';
import type { MqttLiveEntry } from '../../map-editor/live/mqttLiveTypes';
import { useMapMqttLive } from './useMapMqttLive';
import { useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import { MapSimVehicleMotionBridge } from './MapSimVehicleMotionBridge';
import { useOrderRouteStations } from './useOrderRouteStations';

export function MapPlatformLayer({
  mapId,
  showDemoVehicles = false,
  showVehicleTelemetry = false,
  vehicleTemplate = null,
  isEditMode = false,
  vehicleRoofIndicator = null,
}: {
  mapId: string;
  /** @deprecated 嵌入模式固定依容器等比顯示，不再使用縮放滑桿 */
  zoomFactor?: number;
  /** 無 MQTT 時是否顯示示範車（圖台儀表板預設關閉） */
  showDemoVehicles?: boolean;
  /** 車輛座標／heading 除錯標籤（預設關閉，方便檢視月台門等行為） */
  showVehicleTelemetry?: boolean;
  /** 載具容器定義的樣板（套用至所有即時車輛） */
  vehicleTemplate?: MapVehicleTemplateConfig | null;
  isEditMode?: boolean;
  /** 車頂軌道進度指標設定（圖台元件上存的那一份） */
  vehicleRoofIndicator?: import('../../map-editor/vehicles/vehicleRoofIndicator').VehicleRoofIndicatorConfig | null;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [areas, setAreas] = useState<MapAreaObject[]>([]);
  const [routes, setRoutes] = useState<MapPlannedRoute[]>([]);
  const [pixelSize, setPixelSize] = useState<MapPixelSize>(DEFAULT_MAP_PIXEL_SIZE);
  const [pixelOrigin, setPixelOrigin] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { liveById, areaVehicles: mqttVehicles } = useMapMqttLive(areas);
  const { paused, transportPaused, running, speedMultiplier } = useDemoSimulationPlayback();
  const simPlaybackActive = running && !paused && !transportPaused;
  /*
   * 位置補間的時長（真實遙測）。模擬播放中帶模擬時間欄位的車由模擬時鐘逐幀外推
   * （useSimExtrapolatedVehicles，標 simExtrapolated），渲染層對那些車不補間；其他車一律補間。
   *
   * 不能看整張圖的 running／paused 決定：
   * - 以前寫「沒在播放、又沒暫停才補」，paused 拿到的是預設值 true，補間永遠是 0。
   * - 2026-10-12 之前是「running 就整張圖不補間」。可是營運時鐘停在重播模式（重播結束、暫停）時
   * running 一直是 true、外推卻沒在跑（simPlaybackActive＝false），真車（協力廠商 PMS99，一秒一筆）
   * 兩邊都沒動，每秒瞬移一格；就算重播正在跑，外推也只處理帶模擬時間欄位的車，真車一樣沒補間。
   * 改成逐車判斷：被外推的車標 simExtrapolated，渲染層對它不補間；其他車一律補間。
   */
  const liveTweenMs = 1200;

  const areaVehiclesRaw = useMemo(() => {
    if (isEditMode) return [];
    if (mqttVehicles.length > 0) return mqttVehicles;
    if (showDemoVehicles) return buildDemoAreaVehicles(areas);
    return [];
  }, [mqttVehicles, showDemoVehicles, isEditMode, areas]);
  // 每台車目前任務的有序站序：判位用來知道這張任務接下來該走哪幾條分支
  const orderStationsById = useOrderRouteStations(areaVehiclesRaw);

  const vehicleDefinition = vehicleTemplate?.definition ?? null;
  // 圖台包了 memo：每次車輛更新都給新物件會讓整張圖台重畫
  const vehicleBehavior = useMemo(
    () =>
      vehicleTemplate
        ? {
            actionIconRules: vehicleTemplate.actionIconRules,
            behaviorOffsetX: vehicleTemplate.behaviorOffsetX,
            behaviorOffsetY: vehicleTemplate.behaviorOffsetY,
            behaviorIconSize: vehicleTemplate.behaviorIconSize,
          }
        : undefined,
    [vehicleTemplate],
  );
  const vehicleDisplayWidthPx =
    vehicleTemplate?.displayWidthPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX;
  const vehicleDisplayHeightPx =
    vehicleTemplate?.displayHeightPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX;

  /** 這張圖在別處保存（例如改了站名）：重新載入，不用手動清快取 */
  const [mapRevision, setMapRevision] = useState(0);
  useEffect(() => {
    if (!mapId) return;
    const resolved = resolveMapId(mapId);
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.reason === `map_saved:${resolved}`) setMapRevision((value) => value + 1);
    });
  }, [mapId]);

  useEffect(() => {
    if (!mapId) {
      setAreas([]);
      setRoutes([]);
      setError(null);
      return;
    }

    const resolvedMapId = resolveMapId(mapId);
    let cancelled = false;

    setLoading(true);
    resolveParsedMapForPlatform(resolvedMapId)
      .then((parsed) => {
        if (cancelled) return;
        if (!parsed) {
          setAreas([]);
          setError(`找不到地圖：${mapId}`);
          return;
        }
        const trackSegments = buildTrackNetwork(parsed.areas).segments.length;
        if (trackSegments === 0) {
          setAreas([]);
          setError(
            '地圖缺少軌道場域範圍（refField），MQTT 車輛無法定位。請到「系統基礎模組 → 進階管理模式 → 儀表介面管理」檢查圖台資料。',
          );
          return;
        }
        setAreas(parsed.areas);
        setRoutes(parsed.routes ?? []);
        setPixelSize(parsed.pixelSize);
        setPixelOrigin(parsed.pixelOrigin);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('無法載入地圖');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, mapRevision]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <MapIcon className="mr-2 size-5 animate-pulse" />
        載入地圖…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center bg-zinc-950 px-4 text-center text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (areas.length === 0) {
    return (
      <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 bg-zinc-950 px-4 text-center text-zinc-500">
        <MapIcon className="size-6 opacity-40" aria-hidden />
        <p className="text-xs">圖台尚無 Area 資料（mapId: {mapId || '未設定'}）</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[120px] w-full overflow-hidden bg-zinc-950">
      <MapSimVehicleMotionBridge
        pixelSize={pixelSize}
        pixelOrigin={pixelOrigin}
        areas={areas}
        vehiclesRaw={areaVehiclesRaw}
        simPlaybackActive={simPlaybackActive}
        speedMultiplier={speedMultiplier}
        liveTweenMs={liveTweenMs}
        liveById={liveById}
        showVehicleTelemetry={showVehicleTelemetry}
        vehicleDefinition={vehicleDefinition}
        vehicleDisplayWidthPx={vehicleDisplayWidthPx}
        vehicleDisplayHeightPx={vehicleDisplayHeightPx}
        routes={routes}
        vehicleBehavior={vehicleBehavior}
        vehicleRoofIndicator={vehicleRoofIndicator}
        orderStationsById={orderStationsById}
        viewportRef={viewportRef}
      />
    </div>
  );
}

/**
 * 圖台的純呈現：地圖與車輛都由外部提供，不訂閱任何即時資料。
 *
 * 歷史回放用它畫當時版本的地圖與回放出來的車輛；車輛判位、補間、圖示與即時圖台是
 * 同一套（MapSimVehicleMotionBridge → MapAreaCanvas），只有資料入口不同。
 */
export function MapPlatformCanvas({
  map,
  vehicles,
  liveById,
  tweenMs,
  orderStationsById,
  vehicleTemplate = null,
}: {
  map: {
    areas: MapAreaObject[];
    routes: MapPlannedRoute[];
    pixelSize: MapPixelSize;
    pixelOrigin: { x: number; y: number };
  };
  vehicles: AreaVehicleLive[];
  liveById: Record<string, MqttLiveEntry>;
  tweenMs: number;
  orderStationsById: Record<string, readonly string[]>;
  /** 車輛模型與顯示設定（圖資管理的地圖設定，或回放保存的當時快照） */
  vehicleTemplate?: MapVehicleTemplateConfig | null;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const vehicleBehavior = useMemo(
    () =>
      vehicleTemplate
        ? {
            actionIconRules: vehicleTemplate.actionIconRules,
            behaviorOffsetX: vehicleTemplate.behaviorOffsetX,
            behaviorOffsetY: vehicleTemplate.behaviorOffsetY,
            behaviorIconSize: vehicleTemplate.behaviorIconSize,
          }
        : undefined,
    [vehicleTemplate],
  );
  return (
    <div className="relative h-full min-h-[120px] w-full overflow-hidden bg-zinc-950">
      <MapSimVehicleMotionBridge
        pixelSize={map.pixelSize}
        pixelOrigin={map.pixelOrigin}
        areas={map.areas}
        vehiclesRaw={vehicles}
        simPlaybackActive={false}
        speedMultiplier={1}
        liveTweenMs={tweenMs}
        liveById={liveById}
        showVehicleTelemetry={false}
        vehicleDefinition={vehicleTemplate?.definition ?? null}
        vehicleDisplayWidthPx={vehicleTemplate?.displayWidthPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX}
        vehicleDisplayHeightPx={vehicleTemplate?.displayHeightPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX}
        routes={map.routes}
        vehicleBehavior={vehicleBehavior}
        vehicleRoofIndicator={null}
        orderStationsById={orderStationsById}
        viewportRef={viewportRef}
      />
    </div>
  );
}
