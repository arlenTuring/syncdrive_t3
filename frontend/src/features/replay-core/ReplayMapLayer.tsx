import { Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPlatformCanvas } from "../dashboard/elements/MapPlatformLayer";
import { createMapMqttIngestPipeline } from "../dashboard/elements/mapMqttIngestPipeline";
import { OrderRouteOverrideContext } from "../dashboard/elements/useOrderRouteStations";
import type { MqttLiveEntry } from "../map-editor/live/mqttLiveTypes";
import type { MapAreaObject, MapPixelSize } from "../map-editor/types/area";
import type { MapPlannedRoute } from "../map-editor/types/mapFile";
import { parseMapDocumentForPlatform } from "../map-editor/utils/mapLibraryStorage";
import { buildTrackNetwork } from "../map-editor/vehicles/resolveVehicleTrackPlacement";
import type { AreaVehicleLive } from "../map-editor/vehicles/types";
import {
  vehicleDefinitionFromRow,
  type VehicleDefinitionRow,
} from "../vehicle-editor/api/vehicleDefinitionsApi";
import type { MapVehicleSetting } from "../vehicle-editor/model/mapVehicleSettingsApi";
import {
  templateFromResolution,
  useMapVehicleModel,
} from "../vehicle-editor/model/useMapVehicleModel";
import { orderOverrideFrom, type ReplayFrame, type ReplayState, type ReplayVehicle } from "./replayState";

/** 當時保存的車輛模型（模型內容＋地圖顯示設定） */
export type ReplayVehicleModelSnapshot = {
  capturedAt: number;
  source: "map" | "default" | "none";
  setting: MapVehicleSetting | null;
  missingDefinitionKey: string | null;
  definition: VehicleDefinitionRow | null;
};

export type ReplayMapDocument = { map_id: string; document: unknown };

type ParsedMap = {
  areas: MapAreaObject[];
  routes: MapPlannedRoute[];
  pixelSize: MapPixelSize;
  pixelOrigin: { x: number; y: number };
};

/** 點選判定：車身外框外擴這麼多像素內都算點到（小車也點得到） */
const PICK_SLOP_PX = 10;

/**
 * 歷史地圖：當時保存的那一版地圖＋回放出來的車輛（一般運行紀錄、歷史降級共用）。
 *
 * 車輛走跟即時圖台同一條路：同一個 ingest pipeline（合併營運欄位、判斷所在區域）、
 * 同一個 MapPlatformCanvas（判位、車身比例、補間、圖示）。差別只在資料入口：這裡餵的是
 * 游標當下的歷史狀態，不掛任何即時 MQTT、即時訂單 API。
 *
 * 選取的車以顯示用的複本標記（__selected），不改歷史資料本身。
 */
export function ReplayMapLayer({
  mapKey,
  loadMap,
  mapId,
  vehicleModel,
  state,
  vehicles,
  jumped,
  tweenMs,
  selectedVehicle = null,
  highlight = "selected",
  onSelectVehicle,
}: {
  /** 地圖身分（例如內容雜湊）：換了才重新載入 */
  mapKey: string;
  loadMap: (signal: AbortSignal) => Promise<ReplayMapDocument>;
  /** 當時的地圖 ID（沒有保存車輛模型時要用它找目前的模型） */
  mapId: string | null;
  /** 當時保存的車輛模型快照；null＝沒有保存 */
  vehicleModel: ReplayVehicleModelSnapshot | null;
  state: ReplayState | null;
  vehicles: ReplayVehicle[];
  /** 這次更新是拖曳、逐幀、切換得來的：清掉重來、不補間 */
  jumped: boolean;
  tweenMs: number;
  selectedVehicle?: string | null;
  /** selected：使用者點選的車（降級頁）；investigated：查詢條件固定的調查載具（另一種顏色與標籤） */
  highlight?: "selected" | "investigated";
  /** 不給就沒有點選：點地圖上的車不會有任何作用 */
  onSelectVehicle?: (code: string | null) => void;
}) {
  const [map, setMap] = useState<{ key: string; parsed: ParsedMap } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const loadRef = useRef(loadMap);
  useEffect(() => {
    loadRef.current = loadMap;
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadRef
      .current(controller.signal)
      .then(async (body) => {
        const parsed = await parseMapDocumentForPlatform(body.map_id, body.document);
        if (controller.signal.aborted) return;
        if (buildTrackNetwork(parsed.areas).segments.length === 0) {
          setFailure({ key: mapKey, message: "當時的地圖缺少軌道場域範圍，無法定位車輛" });
          return;
        }
        setMap({
          key: mapKey,
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
          key: mapKey,
          message: reason instanceof Error ? reason.message : "無法載入當時的地圖",
        });
      });
    return () => controller.abort();
  }, [mapKey]);

  const parsed = map?.key === mapKey ? map.parsed : null;
  const error = failure?.key === mapKey ? failure.message : null;
  const { areaVehicles, liveById } = useReplayPipeline(parsed?.areas ?? null, state, vehicles, jumped);
  const displayVehicles = useMemo(
    () =>
      selectedVehicle
        ? areaVehicles.map((vehicle) =>
            vehicle.vehicleId === selectedVehicle
              ? { ...vehicle, payload: { ...vehicle.payload, __selected: true, __highlight: highlight } }
              : vehicle,
          )
        : areaVehicles,
    [areaVehicles, highlight, selectedVehicle],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟著訂單快照變
  const override = useMemo(() => (state ? orderOverrideFrom(state) : EMPTY_OVERRIDE), [state?.orders]);
  // 當時的模型快照優先；沒有快照才暫用目前的模型，並在畫面上標出來
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

  // 圖台的車是 pointer-events: none（不擋拖曳地圖）；用點擊位置對照車身外框判斷點到哪台
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSelectVehicle) return;
      const nodes = event.currentTarget.querySelectorAll<HTMLElement>("[data-vehicle-id]");
      let picked: { code: string; distance: number } | null = null;
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (distance > PICK_SLOP_PX) continue;
        const code = node.dataset.vehicleId ?? "";
        if (code && (!picked || distance < picked.distance)) picked = { code, distance };
      }
      if (picked) onSelectVehicle(picked.code);
    },
    [onSelectVehicle],
  );

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
      <div className="h-full w-full" onClick={onSelectVehicle ? onClick : undefined}>
        <MapPlatformCanvas
          map={parsed}
          vehicles={displayVehicles}
          liveById={liveById}
          tweenMs={jumped ? 0 : tweenMs}
          orderStationsById={override.stationsById}
          vehicleTemplate={vehicleTemplate}
        />
      </div>
    </OrderRouteOverrideContext.Provider>
  );
}

const EMPTY_OVERRIDE = { stationsById: {}, metaById: {} };

const DERIVED_LOCATION_FIELDS = ["segment_label", "location_kind", "location_object_id"] as const;

/**
 * 當時中心端的位置判定 → 圖台用的欄位。原始內容裡同名的欄位（車端自報）一律不採用；
 * 沒有保存判定的舊紀錄就不帶，照「不在格位」畫，不拿現在的地圖重算。
 */
function derivedLocationFields(frame: ReplayFrame): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(DERIVED_LOCATION_FIELDS.map((key) => [key, undefined]));
  const location = frame.derived && typeof frame.derived === "object" ? (frame.derived as { location?: unknown }).location : null;
  if (!location || typeof location !== "object") {
    // 降級自己保存的舊格式（沒有來源欄位）：存的就是當時送給畫面、已帶中心端判定的副本
    if (frame.source === undefined) for (const key of DERIVED_LOCATION_FIELDS) out[key] = frame.payload[key];
    return out;
  }
  const value = location as { label?: unknown; kind?: unknown; objectId?: unknown };
  out.segment_label = value.label ?? null;
  out.location_kind = value.kind ?? null;
  out.location_object_id = value.objectId ?? null;
  return out;
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
  const fedRef = useRef(new Map<string, { telemetry: string; operation: string | null }>());
  const facilityRef = useRef(new Map<string, string>());

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
      // 跳轉、逐幀：清空重建，不讓後面時刻的狀態殘留。pipeline 是外部狀態，清掉後畫面要跟著清，
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
      // 保存的是車端原始內容（車號可能是 PMS-05 這種寫法）；顯示用複本統一成正規車號，
      // 並帶上當時中心端對這一筆的位置判定（與即時圖台相同的欄位）
      pipeline.ingestVtmsFromFleetHub(
        new Map([[vehicle.code, { ...vehicle.telemetry.payload, ...derivedLocationFields(vehicle.telemetry), vehicle_code: vehicle.code }]]),
        vehicle.operation
          ? new Map([[vehicle.code, { ...vehicle.operation.payload, vehicle_code: vehicle.code }]])
          : new Map(),
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
