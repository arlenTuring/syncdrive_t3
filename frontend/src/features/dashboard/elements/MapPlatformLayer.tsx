/**
 * 圖台渲染層：供「圖台容器」與舊版 map-canvas 子元件共用。
 */
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
import { useMapMqttLive } from './useMapMqttLive';
import { useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import { MapSimVehicleMotionBridge } from './MapSimVehicleMotionBridge';

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
  /** 模擬中：存滿 3 幀 MQTT 後從第 1 幀 lerp 播放；暫停／逐幀瞬間定位；非模擬用 CSS 補間 */
  /*
   * 位置補間的時長。
   *
   * 原本寫成「沒在播放、又沒暫停才補 1200 毫秒」。可是暫停狀態來自示範模擬的播放
   * context，而中心端已經不再啟動示範模擬，沒有任何地方提供這個 context——拿到的是
   * 預設值：paused = true。於是 `paused` 永遠成立，補間永遠是 0，車每秒瞬移一次。
   *
   * 「示範模擬正在跑」才由模擬的時鐘逐幀補（見 useSimExtrapolatedVehicles），補間交給
   * 它；其餘（真實遙測）一律補間，不看 paused。
   */
  const liveTweenMs = running ? 0 : 1200;

  const areaVehiclesRaw = useMemo(() => {
    if (isEditMode) return [];
    if (mqttVehicles.length > 0) return mqttVehicles;
    if (showDemoVehicles) return buildDemoAreaVehicles(areas);
    return [];
  }, [mqttVehicles, showDemoVehicles, isEditMode, areas]);

  const vehicleDefinition = vehicleTemplate?.definition ?? null;
  const vehicleDisplayWidthPx =
    vehicleTemplate?.displayWidthPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX;
  const vehicleDisplayHeightPx =
    vehicleTemplate?.displayHeightPx ?? DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX;

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
            '地圖缺少軌道場域範圍（refField），MQTT 車輛無法定位。請到「應用程式設定 → 還原圖台範例」後重新整理。',
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
  }, [mapId]);

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
        vehicleBehavior={
          vehicleTemplate
            ? {
                actionIconRules: vehicleTemplate.actionIconRules,
                behaviorOffsetX: vehicleTemplate.behaviorOffsetX,
                behaviorOffsetY: vehicleTemplate.behaviorOffsetY,
                behaviorIconSize: vehicleTemplate.behaviorIconSize,
              }
            : undefined
        }
        vehicleRoofIndicator={vehicleRoofIndicator}
        viewportRef={viewportRef}
      />
    </div>
  );
}
