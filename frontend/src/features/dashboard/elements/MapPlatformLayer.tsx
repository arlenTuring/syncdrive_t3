/**
 * 圖台渲染層：供「圖台容器」與舊版 map-canvas 子元件共用。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { MapAreaCanvas } from '../../map-editor/components/MapAreaCanvas';
import type { MapAreaObject, MapPixelSize } from '../../map-editor/types/area';
import { DEFAULT_MAP_PIXEL_SIZE } from '../../map-editor/types/area';
import { resolveMapId } from '../../map-editor/constants/builtinMaps';
import { resolveParsedMapForPlatform } from '../../map-editor/utils/mapLibraryStorage';
import { buildTrackNetwork } from '../../map-editor/vehicles/resolveVehicleTrackPlacement';
import { buildDemoAreaVehicles } from '../../map-editor/vehicles/demoAreaVehicles';
import { DEFAULT_MAP_VEHICLE_ICON } from '../../map-editor/vehicles/defaultMapVehicleIcon';
import {
  DEFAULT_MAP_VEHICLE_DISPLAY_HEIGHT_PX,
  DEFAULT_MAP_VEHICLE_DISPLAY_WIDTH_PX,
} from '../../map-editor/vehicles/resolveMapVehicleTrackSizing';
import type { MapVehicleTemplateConfig } from '../utils/resolveMapVehicleTemplate';
import { useMapMqttLive } from './useMapMqttLive';

const NOOP_SELECT_AREA = (_id: string | null) => {};
const NOOP_SELECT_FACILITY = (_areaId: string, _facilityId: string | null) => {};
const NOOP_DRAG = (
  _areaId: string,
  _facilityId: string,
  _update: {
    areaPosition: { x: number; y: number }
    position: { x: number; y: number }
  },
) => {}

export function MapPlatformLayer({
  mapId,
  showDemoVehicles = false,
  showVehicleTelemetry = false,
  vehicleTemplate = null,
  isEditMode = false,
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
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [areas, setAreas] = useState<MapAreaObject[]>([]);
  const [pixelSize, setPixelSize] = useState<MapPixelSize>(DEFAULT_MAP_PIXEL_SIZE);
  const [pixelOrigin, setPixelOrigin] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { liveById, areaVehicles: mqttVehicles } = useMapMqttLive(areas);

  const areaVehicles = useMemo(() => {
    /** 編輯模式：地圖上不顯示車輛，僅保留畫布上的單一載具樣板 */
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
            '地圖缺少軌道參照場域（refField），MQTT 車輛無法定位。請到「應用程式設定 → 還原圖台範例」後重新整理。',
          );
          return;
        }
        setAreas(parsed.areas);
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
      <MapAreaCanvas
        pixelSize={pixelSize}
        pixelOrigin={pixelOrigin}
        areas={areas}
        selectedAreaId={null}
        selectedFacilityIds={[]}
        geofenceSelectedLabelId={null}
        viewportRef={viewportRef}
        displayMode="embedded"
        readOnly
        editMode={false}
        liveById={liveById}
        areaVehicles={areaVehicles}
        showVehicleTelemetry={showVehicleTelemetry}
        vehicleIconSpec={DEFAULT_MAP_VEHICLE_ICON}
        vehicleDefinition={vehicleDefinition}
        vehicleDisplayWidthPx={vehicleDisplayWidthPx}
        vehicleDisplayHeightPx={vehicleDisplayHeightPx}
        vehicleFitMode="stretch"
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
        vehicleEditSizer={null}
        slotPreview={null}
        onSelectArea={NOOP_SELECT_AREA}
        onSelectFacility={NOOP_SELECT_FACILITY}
        onSelectGeofenceLabel={() => {}}
        onDragFacility={NOOP_DRAG}
        onDragSessionStart={() => {}}
      />
    </div>
  );
}
