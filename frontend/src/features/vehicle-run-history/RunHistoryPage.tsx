import { AlertTriangle, PanelRightOpen, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchActiveMapId } from "../degraded-operation/api";
import { MapViewport } from "../degraded-operation/MapViewport";
import { fetchPublishedMapDocument } from "../map-editor/api/mapLibraryApi";
import { investigatedPositionReason, mergeDisplayState } from "../replay-core/investigation";
import { PlaybackControls } from "../replay-core/PlaybackControls";
import { GAP_REASON } from "../replay-core/replayLabels";
import { ReplayMapLayer, type ReplayVehicleModelSnapshot } from "../replay-core/ReplayMapLayer";
import { gapAt, typicalTelemetryInterval, visibleVehicles, type TimelineGap } from "../replay-core/replayState";
import { formatDateTime } from "../replay-core/time";
import { useBackgroundState, type BackgroundSource } from "../replay-core/useBackgroundState";
import { useReplayPlayer } from "../replay-core/useReplayPlayer";
import { VehicleDataPanel } from "../replay-core/VehicleDataPanel";
import { fetchHistoryMap, fetchVehicleRelated, type Coverage, type InvestigatedVehicle, type VehicleRecords } from "./api";
import { historySource, type Window } from "./historySource";
import { QueryPanel } from "./QueryPanel";
import { appliedVehicle, type Resolved } from "./queryConditions";

/**
 * 載具管理模組 → 運行管理紀錄：固定一台調查載具，回放它在指定期間（或某次班次執行）的歷史。
 *
 * - 調查載具只來自「已套用的查詢條件」：面板、逐幀序列、高亮都以它為準；換車只能重新查詢。
 * - 逐幀只走調查載具自己的紀錄（後端依車篩選後分頁），其他車再怎麼更新都不增加幀數。
 * - 地圖保留背景車隊：以調查游標另外重建，不讀游標之後的資料，也不進入調查序列。
 * - 整頁唯讀：不改營運時鐘、不送 MQTT、不寫訂單、不注入即時 Hub；沒錄到的標「未錄製」。
 */
export function RunHistoryPage() {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [tab, setTab] = useState<"query" | "vehicle">("query");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null);
  const investigated = appliedVehicle(resolved);

  const onResolved = useCallback((value: Resolved | null) => setResolved(value), []);

  return (
    <div className="relative grid h-full min-h-0 grid-cols-1 bg-black xl:grid-cols-[minmax(0,1.7fr)_minmax(380px,1fr)]">
      <section className="relative flex min-h-[420px] min-w-0 flex-col p-4 xl:min-h-0 xl:border-r xl:border-zinc-800">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-black/80 px-3 py-1.5 text-sm text-zinc-200 xl:hidden"
        >
          <PanelRightOpen className="size-4" />
          條件與車輛資料
        </button>
        {/* 以查詢 id（含調查載具）為 key：換一次查詢就整個重建，舊播放、請求、緩衝、游標一起丟掉 */}
        <ReplayStage key={resolved?.id ?? "none"} resolved={resolved} panelSlot={panelSlot} />
      </section>
      {/* 右側：窄螢幕時是抽屜；查詢表單不隨查詢重建（待查詢條件保留） */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 flex w-[min(420px,92vw)] flex-col border-l border-zinc-800 bg-[#121214] shadow-2xl transition-transform xl:static xl:z-auto xl:min-h-0 xl:w-auto xl:translate-x-0 xl:shadow-none ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="回放條件與車輛資料"
      >
        <div className="flex shrink-0 items-center border-b border-zinc-800 px-3" role="tablist">
          {(
            [
              ["query", "播放條件"],
              ["vehicle", "車輛資料"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-4 py-3 text-sm ${tab === id ? "border-blue-500 text-blue-300" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
            >
              {label}
              {id === "vehicle" && investigated ? <span className="ml-1.5 text-xs text-amber-300">{investigated.display_name}</span> : null}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="收合"
            className="ml-auto rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 xl:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
        <div role="tabpanel" className={`min-h-0 flex-1 flex-col ${tab === "query" ? "flex" : "hidden"}`}>
          <QueryPanel resolved={resolved} onResolved={onResolved} />
        </div>
        <div role="tabpanel" ref={setPanelSlot} className={`min-h-0 flex-1 flex-col ${tab === "vehicle" ? "flex" : "hidden"}`} />
      </aside>
    </div>
  );
}

function replayWindow(resolved: Resolved | null): Window | null {
  if (!resolved) return null;
  const window_ = resolved.value.window;
  if (!window_) return null;
  return { from: window_.from_real, to: window_.to_real, ongoing: window_.ongoing };
}

function coverageOf(resolved: Resolved | null): Coverage | null {
  if (!resolved) return null;
  return resolved.kind === "range" ? resolved.value.coverage : (resolved.value.coverage ?? null);
}

function recordsOf(resolved: Resolved | null): VehicleRecords | null {
  if (!resolved) return null;
  return resolved.kind === "range" ? resolved.value.vehicle_records : (resolved.value.vehicle_records ?? null);
}

const ONE = new Set<string>();

function ReplayStage({ resolved, panelSlot }: { resolved: Resolved | null; panelSlot: HTMLElement | null }) {
  const vehicle = appliedVehicle(resolved);
  const window_ = useMemo(() => replayWindow(resolved), [resolved]);
  const coverage = coverageOf(resolved);
  const records = recordsOf(resolved);
  const nothingRecorded = coverage?.state === "none";
  // 調查載具在範圍內沒有任何紀錄：沒有可逐幀的資料，不建立播放器，不拿其他車的資料充數
  const noVehicleRecords = records != null && records.count === 0;
  const playable = !!resolved && !!vehicle && !!window_ && !nothingRecorded && !noVehicleRecords;
  const source = useMemo(
    () => (playable ? historySource(resolved!.id, vehicle!, "vehicle", window_!) : null),
    [playable, resolved, vehicle, window_],
  );
  const backgroundSource = useMemo<BackgroundSource | null>(
    () => (playable ? historySource(resolved!.id, vehicle!, "background", window_!) : null),
    [playable, resolved, vehicle, window_],
  );
  const player = useReplayPlayer(source);
  const background = useBackgroundState(backgroundSource, player.cursor);
  const gaps = useMemo<TimelineGap[]>(
    () => (coverage?.gaps ?? []).map((gap) => ({ from: gap.from_real, to: gap.to_real, reason: gap.reason, count: gap.count })),
    [coverage],
  );
  const staleAfterMs = resolved?.value.stale_after_ms ?? 5_000;
  const at = player.cursor?.t ?? null;
  const code = vehicle?.vehicle_code ?? "";
  const only = useMemo(() => (code ? new Set([code]) : ONE), [code]);
  // 時間軸就是後端收到時間：過期一律跟游標比，不跟「其他資料收到得多晚」比
  const investigatedVisible = useMemo(
    () => (player.state && at != null ? visibleVehicles(player.state, at, gaps, staleAfterMs, { referenceAt: at, only }) : { vehicles: [], hidden: [] }),
    [at, gaps, only, player.state, staleAfterMs],
  );
  const backgroundVisible = useMemo(
    () => (background.state && at != null ? visibleVehicles(background.state, at, gaps, staleAfterMs, { referenceAt: at, exclude: only }) : { vehicles: [], hidden: [] }),
    [at, background.state, gaps, only, staleAfterMs],
  );
  const displayState = useMemo(() => mergeDisplayState(player.state, background.state, code), [background.state, code, player.state]);
  const mapVehicles = useMemo(
    () => [...backgroundVisible.vehicles, ...investigatedVisible.vehicles],
    [backgroundVisible.vehicles, investigatedVisible.vehicles],
  );
  const interval = useMemo(() => typicalTelemetryInterval(player.frames), [player.frames]);
  const tweenMs = interval ? Math.min(2_000, Math.max(0, interval / player.speed)) : 1_000;
  const inGap = at != null ? gapAt(gaps, at) : null;
  const position = investigatedPositionReason(
    player.state,
    code,
    investigatedVisible.vehicles.length > 0,
    investigatedVisible.hidden[0]?.reason ?? null,
  );

  // 當時的地圖與車輛模型：游標當下最後一筆版本紀錄（背景跟著游標；還沒載入時用起點快照附的參照）
  const mapFrame = displayState?.byKey.get("map|active") ?? null;
  const modelFrame = displayState?.byKey.get("model|active") ?? null;
  const mapHash = typeof mapFrame?.payload.map_hash === "string" ? mapFrame.payload.map_hash : null;
  const mapId = typeof mapFrame?.payload.map_id === "string" ? mapFrame.payload.map_id : null;
  const vehicleModel = (modelFrame?.payload.snapshot ?? null) as ReplayVehicleModelSnapshot | null;
  const loadMap = useCallback(
    async (signal: AbortSignal) => {
      if (mapHash) return fetchHistoryMap(mapHash, signal);
      // 沒有錄到當時的地圖版本：暫用目前啟用的地圖，畫面上標示
      const activeId = await fetchActiveMapId();
      const document = await fetchPublishedMapDocument(activeId);
      if (!document) throw new Error("沒有當時的地圖版本，也讀不到目前啟用的地圖");
      return { map_id: activeId, document };
    },
    [mapHash],
  );
  const vehicleId = vehicle?.id ?? null;
  const loadRelated = useCallback(
    (_code: string, to: number, signal: AbortSignal) =>
      fetchVehicleRelated({ vehicleId: vehicleId!, from: window_?.from ?? to, to }, signal),
    [vehicleId, window_?.from],
  );

  let body: React.ReactNode;
  if (!resolved) {
    body = <StageMessage>請在右側「播放條件」選擇調查載具與時間區間，或輸入班次唯一碼</StageMessage>;
  } else if (!vehicle) {
    body = <StageMessage tone="warn">{resolved.kind === "shift" ? resolved.value.state_label : "尚未固定調查載具"}</StageMessage>;
  } else if (!window_) {
    body = <StageMessage tone="warn">{resolved.kind === "shift" ? resolved.value.state_label : "沒有可回放的範圍"}</StageMessage>;
  } else if (nothingRecorded) {
    body = (
      <StageMessage tone="warn">
        未錄製：這段期間沒有保存運行紀錄（功能上線前，或後端當時沒有運作）。不以目前狀態或班表推算。
      </StageMessage>
    );
  } else if (noVehicleRecords) {
    body = (
      <StageMessage tone="warn">
        {vehicle.display_name}（{vehicle.vehicle_code}）在這段範圍內沒有任何保存的紀錄，沒有可逐幀的資料。
        {records?.last_before_real != null ? `範圍前最後一筆在 ${formatDateTime(records.last_before_real)}。` : ""}
      </StageMessage>
    );
  } else if (!player.state) {
    body = <StageMessage>{player.error ? `回放資料載入失敗：${player.error}` : "載入起點狀態…"}</StageMessage>;
  } else {
    body = (
      <MapViewport storageKey="run-history">
        {/* 沒有點選：點地圖上的任何車都不會換調查對象 */}
        <ReplayMapLayer
          mapKey={mapHash ?? "active-fallback"}
          loadMap={loadMap}
          mapId={mapId}
          vehicleModel={vehicleModel}
          state={displayState}
          vehicles={mapVehicles}
          jumped={player.jumped || !player.playing}
          tweenMs={tweenMs}
          selectedVehicle={code}
          highlight="investigated"
        />
      </MapViewport>
    );
  }

  const panel = vehicle ? (
    <VehicleDataPanel
      vehicleCode={code}
      investigated={{ displayName: vehicle.display_name, vehicleCode: code }}
      state={player.state}
      cursor={player.cursor}
      staleAfterMs={staleAfterMs}
      healthKeepaliveMs={coverage?.health_keepalive_ms}
      hidden={investigatedVisible.hidden}
      loadRelated={source ? loadRelated : undefined}
      timelineLabel="後端收到時間"
    />
  ) : (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500">
      查詢成功後，這裡只顯示該次調查載具的資料
    </div>
  );

  const shift = resolved?.kind === "shift" ? resolved.value : null;
  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 max-xl:mt-10">
        {body}
        {source && vehicle ? (
          <div className="pointer-events-none absolute top-3 left-3 z-10 text-xs">
            <span
              className="inline-block rounded-lg border border-amber-500/70 bg-black/80 px-3 py-1.5 text-amber-100"
              data-testid="stage-investigated"
              title={position.state === "missing" ? `調查載具無有效位置：${position.reason}` : undefined}
            >
              調查載具：<VehicleName vehicle={vehicle} />
              {position.state === "missing" ? <span className="ml-2 text-red-200">（無有效位置：{position.reason}）</span> : null}
            </span>
          </div>
        ) : null}
        {source && inGap ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div
              className={`rounded-2xl px-6 py-4 text-center ${inGap.reason === "not_recorded" ? "bg-zinc-900/90 text-zinc-200" : "bg-red-950/85 text-red-100"}`}
            >
              <div className="flex items-center justify-center gap-2 text-lg">
                <AlertTriangle className="size-5" />
                {inGap.reason === "not_recorded" ? "未錄製" : `資料缺段：${GAP_REASON[inGap.reason] ?? inGap.reason}`}
              </div>
              <p className="mt-1 text-xs opacity-80">
                {inGap.from != null ? formatDateTime(inGap.from) : "—"}～{inGap.to != null ? formatDateTime(inGap.to) : "—"}
                {inGap.count ? `・遺失 ${inGap.count} 筆` : ""}・此段沒有車輛資料，不補畫
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <PlaybackControls
        heading={vehicle ? `運行管理紀錄回放・${vehicle.display_name}` : "運行管理紀錄回放"}
        subtitle={shift ? `${shift.trip_code ?? ""}`.trim() || null : null}
        window_={source?.window ?? null}
        player={player}
        gaps={gaps}
        timelineLabel="後端收到時間・逐幀只走調查載具的紀錄"
        emptyMessage="選擇調查載具並查詢到有紀錄的範圍後可以播放"
      />
      {panelSlot ? createPortal(panel, panelSlot) : null}
    </>
  );
}

/** 名稱與通訊代號相同時只寫一次 */
function VehicleName({ vehicle }: { vehicle: InvestigatedVehicle }) {
  return (
    <>
      {vehicle.display_name}
      {vehicle.display_name !== vehicle.vehicle_code ? <span className="ml-1.5 font-mono opacity-70">{vehicle.vehicle_code}</span> : null}
    </>
  );
}

function StageMessage({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={`flex h-full items-center justify-center px-6 text-center ${tone === "warn" ? "text-amber-200" : "text-zinc-400"}`}>
      {children}
    </div>
  );
}
