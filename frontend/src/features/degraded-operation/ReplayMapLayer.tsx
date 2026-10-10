import { Map as MapIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPlatformCanvas } from "../dashboard/elements/MapPlatformLayer";
import { createMapMqttIngestPipeline } from "../dashboard/elements/mapMqttIngestPipeline";
import { OrderRouteOverrideContext } from "../dashboard/elements/useOrderRouteStations";
import type { MqttLiveEntry } from "../map-editor/live/mqttLiveTypes";
import type { MapAreaObject, MapPixelSize } from "../map-editor/types/area";
import type { MapPlannedRoute } from "../map-editor/types/mapFile";
import { parseMapDocumentForPlatform } from "../map-editor/utils/mapLibraryStorage";
import { buildTrackNetwork } from "../map-editor/vehicles/resolveVehicleTrackPlacement";
import type { AreaVehicleLive } from "../map-editor/vehicles/types";
import { vehicleDefinitionFromRow } from "../vehicle-editor/api/vehicleDefinitionsApi";
import {
  templateFromResolution,
  useMapVehicleModel,
} from "../vehicle-editor/model/useMapVehicleModel";
import { fetchReplayMap, type ReplayVehicleModelSnapshot } from "./api";
import { orderOverrideFrom, type ReplayState, type ReplayVehicle } from "./replayState";

type ParsedMap = {
  areas: MapAreaObject[];
  routes: MapPlannedRoute[];
  pixelSize: MapPixelSize;
  pixelOrigin: { x: number; y: number };
};

/**
 * 歷史地圖：當時保存的那一版地圖＋回放出來的車輛。
 *
 * 車輛走跟即時圖台同一條路：同一個 ingest pipeline（合併營運欄位、判斷所在區域）、
 * 同一個 MapPlatformCanvas（判位、補間、圖示）。差別只在資料入口：這裡餵的是游標當下
 * 的歷史狀態，不掛任何即時 MQTT、即時訂單 API。
 */
export function ReplayMapLayer({
  executionId,
  mapId,
  vehicleModel,
  state,
  vehicles,
  jumped,
  tweenMs,
}: {
  executionId: string;
  /** 當時的地圖 ID（沒有保存車輛模型的舊紀錄要用它找目前的模型） */
  mapId: string | null;
  /** 降級開始時保存的車輛模型快照；null＝舊紀錄沒有保存 */
  vehicleModel: ReplayVehicleModelSnapshot | null;
  state: ReplayState | null;
  vehicles: ReplayVehicle[];
  /** 這次更新是拖曳／切換得來的：清掉重來、不補間 */
  jumped: boolean;
  tweenMs: number;
}) {
  const [map, setMap] = useState<{ executionId: string; parsed: ParsedMap } | null>(null);
  const [failure, setFailure] = useState<{ executionId: string; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchReplayMap(executionId, controller.signal)
      .then(async (body) => {
        const parsed = await parseMapDocumentForPlatform(body.map_id, body.document);
        if (controller.signal.aborted) return;
        if (buildTrackNetwork(parsed.areas).segments.length === 0) {
          setFailure({ executionId, message: "當時的地圖缺少軌道場域範圍，無法定位車輛" });
          return;
        }
        setMap({
          executionId,
          parsed: {
            areas: parsed.areas,
            routes: parsed.routes ?? [],
            pixelSize: parsed.pixelSize,
            pixelOrigin: parsed.pixelOrigin,
          },
        });
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setFailure({
          executionId,
          message: reason instanceof Error ? reason.message : "無法載入當時的地圖",
        });
      });
    return () => controller.abort();
  }, [executionId]);

  const parsed = map?.executionId === executionId ? map.parsed : null;
  const error = failure?.executionId === executionId ? failure.message : null;
  const { areaVehicles, liveById } = useReplayPipeline(parsed?.areas ?? null, state, vehicles, jumped);
  const override = useMemo(() => (state ? orderOverrideFrom(state) : EMPTY_OVERRIDE), [state?.orders]);
  // 當時的模型快照優先；舊紀錄沒有快照才暫用目前的模型，並在畫面上標出來
  const snapshotTemplate = useMemo(
    () =>
      vehicleModel?.definition && vehicleModel.setting
        ? templateFromResolution({
            setting: vehicleModel.setting,
            definition: vehicleDefinitionFromRow(vehicleModel.definition),
          })
        : null,
    [vehicleModel],
  );
  const current = useMapVehicleModel(vehicleModel ? null : mapId);
  const vehicleTemplate = vehicleModel ? snapshotTemplate : current.template;

  if (error)
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-300">
        {error}
      </div>
    );
  if (!parsed)
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <MapIcon className="mr-2 size-5 animate-pulse" />
        載入當時的地圖…
      </div>
    );
  return (
    <OrderRouteOverrideContext.Provider value={override}>
      <MapPlatformCanvas
        map={parsed}
        vehicles={areaVehicles}
        liveById={liveById}
        tweenMs={jumped ? 0 : tweenMs}
        orderStationsById={override.stationsById}
        vehicleTemplate={vehicleTemplate}
      />
    </OrderRouteOverrideContext.Provider>
  );
}

const EMPTY_OVERRIDE = { stationsById: {}, metaById: {} };

/** 回放的車輛外觀不是當時完整快照時，要在畫面上說清楚 */
export function replayVehicleModelNotice(
  vehicleModel: ReplayVehicleModelSnapshot | null,
): string | null {
  if (!vehicleModel) return "這筆紀錄沒有保存當時的車輛模型，暫用目前地圖的模型顯示";
  if (vehicleModel.missingDefinitionKey)
    return `當時設定的模型 ${vehicleModel.missingDefinitionKey} 已不存在，以圖示顯示`;
  if (vehicleModel.source === "none") return "當時這張地圖沒有設定車輛模型，以圖示顯示";
  return null;
}

/**
 * 回放狀態 → 圖台車輛。用即時圖台同一個 pipeline；資料時刻（now）指定為每一筆的
 * 收到時刻，渲染層判斷斷訊、停站時用的是歷史時間。
 */
function useReplayPipeline(
  areas: MapAreaObject[] | null,
  state: ReplayState | null,
  vehicles: ReplayVehicle[],
  jumped: boolean,
) {
  const [areaVehicles, setAreaVehicles] = useState<AreaVehicleLive[]>([]);
  const [liveById, setLiveById] = useState<Record<string, MqttLiveEntry>>({});
  const clockRef = useRef(0);
  const pipelineRef = useRef<ReturnType<typeof createMapMqttIngestPipeline> | null>(null);
  const fedRef = useRef(new Map<string, { telemetry: number; operation: number | null }>());
  const facilityRef = useRef(new Map<string, number>());

  useEffect(() => {
    const pipeline = createMapMqttIngestPipeline(
      (snapshot) => {
        if (snapshot.liveChanged) setLiveById(snapshot.liveById);
        if (snapshot.vehiclesChanged) setAreaVehicles(snapshot.areaVehicles);
      },
      { now: () => clockRef.current },
    );
    pipelineRef.current = pipeline;
    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (areas) pipelineRef.current?.setAreas(areas);
  }, [areas]);

  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline || !areas) return;
    if (jumped || !state) {
      // 跳轉：清空重建，不讓後面時刻的狀態殘留。pipeline 是外部狀態，清掉後畫面要跟著清，
      // 否則游標當下一台車都沒有時（pipeline 不會再發出空清單）會殘留上一刻的車
      pipeline.reset();
      fedRef.current.clear();
      facilityRef.current.clear();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 跟外部 pipeline 的清空同步
      setAreaVehicles([]);
      setLiveById({});
    }
    if (!state) return;
    const visible = new Set(vehicles.map((vehicle) => vehicle.code));
    for (const code of [...fedRef.current.keys()]) {
      if (visible.has(code)) continue;
      // 這台車在游標當下不該出現（還沒出現、過期或落在缺段）：從圖上拿掉
      pipeline.ingestVtmsFromFleetHub(
        new Map([[code, { vehicle_code: code, map_visible: false }]]),
        new Map(),
      );
      fedRef.current.delete(code);
    }
    for (const vehicle of vehicles) {
      const previous = fedRef.current.get(vehicle.code);
      const operationSeq = vehicle.operation?.seq ?? null;
      if (previous && previous.telemetry === vehicle.telemetry.seq && previous.operation === operationSeq)
        continue;
      clockRef.current = vehicle.telemetry.received_at;
      pipeline.ingestVtmsFromFleetHub(
        new Map([[vehicle.code, vehicle.telemetry.payload]]),
        vehicle.operation ? new Map([[vehicle.code, vehicle.operation.payload]]) : new Map(),
      );
      fedRef.current.set(vehicle.code, { telemetry: vehicle.telemetry.seq, operation: operationSeq });
    }
    for (const [topic, frame] of state.facility) {
      if (facilityRef.current.get(topic) === frame.seq) continue;
      clockRef.current = frame.received_at;
      pipeline.ingest(topic, frame.payload);
      facilityRef.current.set(topic, frame.seq);
    }
  }, [areas, state, vehicles, jumped]);

  return { areaVehicles, liveById };
}
