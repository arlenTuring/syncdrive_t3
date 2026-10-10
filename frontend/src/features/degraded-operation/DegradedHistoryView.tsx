import {
  ArrowLeft,
  ChevronLeft,
  Clock3,
  MessageSquareText,
  Pause,
  Play,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDegradedHistory,
  fetchDegradedHistoryDetail,
  fetchReplayMeta,
  type HistoryDetail,
  type HistoryItem,
  type ParameterChange,
  type ReplayGap,
  type ReplayMeta,
} from "./api";
import { ImpactMetrics } from "./DegradedIcons";
import { MapViewport } from "./MapViewport";
import { ReplayMapLayer, replayVehicleModelNotice } from "./ReplayMapLayer";
import {
  gapAt,
  parametersAt,
  typicalTelemetryInterval,
  visibleVehicles,
} from "./replayState";
import { REPLAY_SPEEDS, useReplayPlayer, type ReplaySpeed } from "./useReplayPlayer";

const PAGE_SIZE = 20;

/**
 * 歷史降級紀錄：右側列表／詳情，左側當時地圖與回放控制。
 *
 * 列表、詳情、回放共用同一個選取的 execution；在列表與詳情之間切換不影響游標與播放。
 * 換一筆就停止前一筆、清掉它的資料。整頁唯讀：不能執行、調整或解除降級。
 */
export function DegradedHistoryView({ onBack }: { onBack: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"list" | "detail">("list");
  const [detail, setDetail] = useState<{ id: string; value: HistoryDetail | null; error: string | null } | null>(null);
  const [meta, setMeta] = useState<{ id: string; value: ReplayMeta | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!selectedId) return undefined;
    const controller = new AbortController();
    void fetchDegradedHistoryDetail(selectedId, controller.signal)
      .then((value) => setDetail({ id: selectedId, value, error: null }))
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setDetail({ id: selectedId, value: null, error: reason.message });
      });
    void fetchReplayMeta(selectedId, controller.signal)
      .then((value) => setMeta({ id: selectedId, value, error: null }))
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setMeta({ id: selectedId, value: null, error: reason.message });
      });
    return () => controller.abort();
  }, [selectedId]);

  // 回應帶著自己的 id：跟目前選的不同就當作還在載入，不會拿上一筆的資料來顯示
  const currentDetail = detail?.id === selectedId ? detail : null;
  const currentMeta = meta?.id === selectedId ? meta : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-black xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]">
      <section className="relative flex min-h-[420px] min-w-0 flex-col border-b border-zinc-800 p-4 xl:min-h-0 xl:border-r xl:border-b-0">
        <button
          type="button"
          onClick={onBack}
          className="absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 rounded-lg border border-blue-500/70 bg-black/80 px-3 py-1.5 text-sm text-blue-300 hover:bg-blue-500/10"
        >
          <ChevronLeft className="size-4" />
          返回看即時
        </button>
        {/* 以紀錄 id 為 key：換一筆就整個重建，前一筆的播放、請求、資料一起丟掉 */}
        <ReplayStage
          key={selectedId ?? "none"}
          selectedId={selectedId}
          meta={currentMeta}
          detail={currentDetail?.value ?? null}
        />
      </section>
      <aside className="flex min-h-[520px] min-w-0 flex-col bg-[#121214] p-4 xl:min-h-0">
        {panel === "detail" && selectedId ? (
          <HistoryDetailPanel
            detail={currentDetail}
            onBack={() => setPanel("list")}
          />
        ) : (
          <HistoryList
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setPanel("detail");
            }}
          />
        )}
      </aside>
    </div>
  );
}

function HistoryList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  // 哪一次請求已經有結果（成功或失敗）；跟目前要的不同就是載入中
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const requestKey = `${page}:${retry}`;
  const loading = settled?.key !== requestKey;
  const error = settled?.key === requestKey ? settled.error : null;

  useEffect(() => {
    const controller = new AbortController();
    void fetchDegradedHistory({ page, pageSize: PAGE_SIZE }, controller.signal)
      .then((body) => {
        setItems((current) => {
          const seen = new Set(current.map((item) => item.execution_id));
          return page === 1 ? body.items : [...current, ...body.items.filter((item) => !seen.has(item.execution_id))];
        });
        setTotal(body.total);
        setSettled({ key: requestKey, error: null });
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setSettled({ key: requestKey, error: reason.message });
      });
    return () => controller.abort();
  }, [page, requestKey]);

  const hasMore = total != null && items.length < total;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="mb-4 text-lg">歷史降級紀錄</h2>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {error && items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-red-300">
            歷史紀錄載入失敗：{error}
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">
              重試
            </button>
          </div>
        ) : !loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-500">尚無降級紀錄</div>
        ) : (
          <ol className="relative space-y-3 border-l border-zinc-700 pl-6">
            {items.map((item) => (
              <li key={item.execution_id} className="relative">
                <span className="absolute top-1/2 -left-[29px] size-2.5 -translate-y-1/2 rounded-full bg-zinc-500" />
                <button
                  type="button"
                  onClick={() => onSelect(item.execution_id)}
                  className={`w-full rounded-xl border bg-[#1b1d21] p-4 text-left hover:border-blue-500 ${
                    item.execution_id === selectedId ? "border-blue-500" : "border-zinc-700"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <span className={`text-sm ${levelText(item.level)}`}>Level {item.level}</span>
                      <p className="truncate text-base">{item.name}</p>
                      <p className="mt-1 text-sm text-zinc-400">{historyRange(item)}</p>
                      {replayNote(item) ? (
                        <p className="mt-1 text-xs text-amber-300/80">{replayNote(item)}</p>
                      ) : null}
                    </div>
                    <StatusBadge status={item.execution_status} />
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
        {error && items.length > 0 ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        {loading ? <p className="py-4 text-center text-sm text-zinc-500">載入中…</p> : null}
        {hasMore && !loading ? (
          <button
            type="button"
            onClick={() => setPage((value) => value + 1)}
            className="mt-3 w-full rounded-lg border border-zinc-700 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            載入更多（{items.length}／{total}）
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HistoryDetailPanel({
  detail,
  onBack,
}: {
  detail: { value: HistoryDetail | null; error: string | null } | null;
  onBack: () => void;
}) {
  const value = detail?.value ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 self-start text-zinc-200">
        <ArrowLeft className="size-4" />
        降級紀錄詳情
      </button>
      {detail?.error ? (
        <div className="text-red-300">詳情載入失敗：{detail.error}</div>
      ) : !value ? (
        <div className="text-zinc-500">載入中…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <span className="text-sm text-zinc-400">計畫名稱</span>
          <div className="flex items-start gap-3">
            <h3 className="min-w-0 flex-1 text-xl break-words">{value.name}</h3>
            <span className={`shrink-0 rounded px-3 py-1 text-xs ${levelBadge(value.level)}`}>Level {value.level}</span>
          </div>
          <p className="mt-3 flex items-center gap-2 text-zinc-300">
            <Clock3 className="size-4 text-zinc-400" />
            {durationLabel(value)}
          </p>
          <p className="mt-2 flex items-start gap-2 text-zinc-300">
            <MessageSquareText className="mt-0.5 size-4 shrink-0 text-zinc-400" />
            <span className="whitespace-pre-wrap">{value.description || "未填寫說明"}</span>
          </p>
          <ImpactMetrics speedLimitKmh={value.speed_limit_kmh} className="mt-4" />
          <p className="mt-1 text-right text-xs text-zinc-500">本次最終參數</p>
          <h4 className="mt-5 border-t border-zinc-700 pt-4 text-base">參數詳細紀錄</h4>
          {value.parameter_changes.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">沒有參數變更紀錄</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {[...value.parameter_changes].reverse().map((change) => (
                <ParameterChangeRow key={change.event_id} change={change} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  immediate_submitted: "立即執行",
  schedule_submitted: "預約執行",
  schedule_due: "預約生效",
  parameters_adjusted: "調整參數",
  schedule_cancelled: "取消預約",
  degraded_restored: "解除降級",
};

function ParameterChangeRow({ change }: { change: ParameterChange }) {
  const effective = change.effective_at_operating;
  const changedLevel = change.previous_level != null && change.previous_level !== change.level;
  const changedSpeed =
    change.previous_speed_limit_kmh != null && change.previous_speed_limit_kmh !== change.speed_limit_kmh;
  return (
    <li className="border-l-2 border-zinc-600 pl-3">
      <div className="text-lg">{effective != null ? formatClockSeconds(effective) : "—"}</div>
      <div className="text-sm text-zinc-300">
        {ACTION_LABEL[change.action] ?? change.action}
        {change.action === "degraded_restored" && change.speed_limit_kmh != null ? (
          <span className="text-zinc-400">
            （解除前：速限 {change.speed_limit_kmh} km/h・Level {change.level}）
          </span>
        ) : change.action !== "schedule_cancelled" && change.speed_limit_kmh != null ? (
          <>
            　速限 {changedSpeed ? `${change.previous_speed_limit_kmh} → ` : ""}
            <b className="font-normal text-white">{change.speed_limit_kmh}</b> km/h　・　等級{" "}
            {changedLevel ? `Level ${change.previous_level} → ` : ""}
            <b className="font-normal text-white">Level {change.level}</b>
          </>
        ) : null}
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-zinc-500">
        <dt>操作</dt>
        <dd>
          {formatDateTimeSeconds(change.operated_at_real)}（實際時間）・{change.operator_id}
        </dd>
        <dt>生效</dt>
        <dd>{effective != null ? `${formatDateTimeSeconds(effective)}（營運時間）` : "未生效"}</dd>
        <dt>指令</dt>
        <dd>
          {change.control.dispatched_at_real != null
            ? `已下發 ${formatDateTimeSeconds(change.control.dispatched_at_real)}`
            : "未下發（車端控制契約尚未接通）"}
        </dd>
      </dl>
    </li>
  );
}

function ReplayStage({
  selectedId,
  meta,
  detail,
}: {
  selectedId: string | null;
  meta: { value: ReplayMeta | null; error: string | null } | null;
  detail: HistoryDetail | null;
}) {
  const value = meta?.value ?? null;
  const player = useReplayPlayer(selectedId, value);
  const gaps = value?.coverage?.gaps ?? EMPTY_GAPS;
  const visible = useMemo(
    () =>
      player.state && player.cursor != null
        ? visibleVehicles(player.state, player.cursor, gaps, value?.stale_after_ms ?? 5_000)
        : { vehicles: [], hidden: [] },
    [gaps, player.cursor, player.state, value?.stale_after_ms],
  );
  const interval = useMemo(() => typicalTelemetryInterval(player.frames), [player.frames]);
  const tweenMs = interval ? Math.min(2_000, Math.max(0, interval / player.speed)) : 1_000;
  const params = detail && player.cursor != null ? parametersAt(detail.parameter_changes, player.cursor) : null;
  const inGap = player.cursor != null ? gapAt(gaps, player.cursor) : null;

  let body: React.ReactNode;
  if (!selectedId) {
    body = <StageMessage>請從右側選取一筆歷史降級紀錄</StageMessage>;
  } else if (meta?.error) {
    body = <StageMessage tone="error">回放資訊載入失敗：{meta.error}</StageMessage>;
  } else if (!value) {
    body = <StageMessage>載入回放資訊…</StageMessage>;
  } else if (value.availability.state === "not_started") {
    body = <StageMessage>這筆降級沒有正式開始，沒有可回放的時段</StageMessage>;
  } else if (value.availability.state === "none") {
    body = <StageMessage>無歷史資料：這筆降級沒有保存回放資料</StageMessage>;
  } else {
    body = (
      <MapViewport storageKey="history">
        <ReplayMapLayer
          executionId={selectedId}
          mapId={value.map?.map_id ?? null}
          vehicleModel={value.vehicle_model}
          state={player.state}
          vehicles={visible.vehicles}
          jumped={player.jumped || !player.playing}
          tweenMs={tweenMs}
        />
      </MapViewport>
    );
  }

  const window_ = value?.window ?? null;
  const canPlay =
    !!window_ && (value?.availability.state === "complete" || value?.availability.state === "partial" || value?.availability.state === "recording");
  return (
    <>
      <div className="relative mt-12 min-h-0 flex-1 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
        {body}
        {canPlay ? (
          <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[70%] flex-col gap-2 text-xs">
            {params ? (
              <span className="self-start rounded-lg bg-black/75 px-3 py-1.5 text-zinc-200">
                回放時刻參數：Level {params.level}・速限 {params.speedLimitKmh} km/h
              </span>
            ) : null}
            {value?.availability.state === "partial" ? (
              <span className="self-start rounded-lg bg-amber-500/15 px-3 py-1.5 text-amber-200">
                資料不完整：{value.availability.reason}
              </span>
            ) : null}
            {replayVehicleModelNotice(value?.vehicle_model ?? null) ? (
              <span className="self-start rounded-lg bg-amber-500/15 px-3 py-1.5 text-amber-200">
                {replayVehicleModelNotice(value?.vehicle_model ?? null)}
              </span>
            ) : null}
            {inGap ? (
              <span className="self-start rounded-lg bg-red-500/20 px-3 py-1.5 text-red-200">
                資料缺段（{GAP_REASON[inGap.reason] ?? inGap.reason}），此段沒有車輛資料
              </span>
            ) : null}
            {visible.hidden.length > 0 ? (
              <span className="self-start rounded-lg bg-zinc-800/90 px-3 py-1.5 text-zinc-300">
                未顯示：{visible.hidden.map((item) => `${item.code}（${item.reason === "gap" ? "缺段" : "資料過期"}）`).join("、")}
              </span>
            ) : null}
            {player.error ? (
              <span className="self-start rounded-lg bg-red-500/20 px-3 py-1.5 text-red-200">{player.error}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <PlaybackBar
        window_={canPlay ? window_ : null}
        title={detail ? `${detail.name}` : null}
        player={player}
        gaps={gaps}
      />
    </>
  );
}

const GAP_REASON: Record<string, string> = {
  write_failed: "寫入失敗",
  backend_restart: "後端重啟",
  clock_run_changed: "營運時鐘換了另一輪",
  frame_limit: "超過保存上限",
  not_recorded: "當時未保存",
};
const EMPTY_GAPS: ReplayGap[] = [];

function PlaybackBar({
  window_,
  title,
  player,
  gaps,
}: {
  window_: { from_operating: number; to_operating: number; ongoing: boolean } | null;
  title: string | null;
  player: ReturnType<typeof useReplayPlayer>;
  gaps: readonly ReplayGap[];
}) {
  const sliderRef = useRef<HTMLInputElement>(null);
  const span = window_ ? Math.max(1, window_.to_operating - window_.from_operating) : 1;
  const onSlide = useCallback(
    (value: number) => {
      if (window_) player.seek(window_.from_operating + value);
    },
    [player, window_],
  );
  return (
    <div className="mt-3 shrink-0 rounded-2xl border border-zinc-800 bg-[#0f1013] px-5 py-4">
      <h3 className="text-blue-400">歷史降級運轉回放</h3>
      {!window_ ? (
        <p className="mt-2 text-sm text-zinc-500">選取一筆有回放資料的紀錄後可以播放</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-300">
            {title ? `${title}　` : ""}
            {formatDateTime(window_.from_operating)}～{formatClock(window_.to_operating)}
            {window_.ongoing ? "（進行中，載入時為止）" : ""}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={player.playing ? player.pause : player.play}
              disabled={player.cursor == null}
              aria-label={player.playing ? "暫停" : "播放"}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
            >
              {player.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <span className="w-20 shrink-0 font-mono text-sm text-zinc-200">
              {player.cursor != null ? formatClockSeconds(player.cursor) : "—"}
            </span>
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2">
                {gaps
                  .filter((gap) => gap.from_operating != null)
                  .map((gap, index) => {
                    const from = Math.max(0, (gap.from_operating! - window_.from_operating) / span);
                    const to = Math.min(1, ((gap.to_operating ?? window_.to_operating) - window_.from_operating) / span);
                    return (
                      <span
                        key={index}
                        className="absolute h-full rounded bg-red-500/50"
                        style={{ left: `${from * 100}%`, width: `${Math.max(0.5, (to - from) * 100)}%` }}
                        title={GAP_REASON[gap.reason] ?? gap.reason}
                      />
                    );
                  })}
              </div>
              <input
                ref={sliderRef}
                type="range"
                min={0}
                max={span}
                step={1000}
                value={player.cursor != null ? player.cursor - window_.from_operating : 0}
                onChange={(event) => onSlide(Number(event.target.value))}
                aria-label="回放時間軸"
                className="relative w-full accent-blue-500"
              />
            </div>
            <select
              value={player.speed}
              onChange={(event) => player.setSpeed(Number(event.target.value) as ReplaySpeed)}
              aria-label="回放倍速"
              className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1.5 text-sm"
            >
              {REPLAY_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </div>
          {player.buffering ? <p className="mt-2 text-xs text-zinc-500">載入回放資料…</p> : null}
        </>
      )}
    </div>
  );
}

function StageMessage({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className={`flex h-full items-center justify-center px-6 text-center ${tone === "error" ? "text-red-300" : "text-zinc-400"}`}>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: HistoryItem["execution_status"] }) {
  const map: Record<HistoryItem["execution_status"], [string, string]> = {
    ended: ["已解除", "bg-emerald-900/60 text-emerald-200"],
    cancelled: ["已取消預約", "bg-zinc-700 text-zinc-300"],
    active: ["進行中", "bg-red-900/70 text-red-200"],
    activating: ["啟動中", "bg-red-900/70 text-red-200"],
    restoring: ["恢復中", "bg-amber-900/70 text-amber-200"],
    scheduled: ["待執行", "bg-amber-900/70 text-amber-200"],
    failed: ["失敗", "bg-red-950 text-red-300"],
  };
  const [label, className] = map[status] ?? [status, "bg-zinc-700"];
  return <span className={`shrink-0 rounded-md px-3 py-1 text-sm ${className}`}>{label}</span>;
}

function replayNote(item: HistoryItem): string | null {
  switch (item.replay.state) {
    case "none":
      return "無歷史資料";
    case "partial":
      return `資料不完整：${item.replay.reason ?? ""}`;
    default:
      return null;
  }
}

function historyRange(item: HistoryItem): string {
  if (item.started_at_operating == null) {
    return item.scheduled_for_operating != null
      ? `未開始（預約 ${formatDateTime(item.scheduled_for_operating)}）`
      : "未開始";
  }
  const end = item.ended_at_operating != null ? formatClock(item.ended_at_operating) : "進行中";
  return `${formatDateTime(item.started_at_operating)}～${end}`;
}

function durationLabel(item: HistoryItem): string {
  if (item.started_at_operating == null) return "沒有正式開始";
  if (item.ended_at_operating == null) return "進行中";
  const minutes = Math.max(0, Math.round((item.ended_at_operating - item.started_at_operating) / 60_000));
  if (minutes < 60) return `持續 ${minutes} 分`;
  return `持續 ${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function levelText(level: number) {
  return level === 1 ? "text-red-500" : level === 2 ? "text-orange-400" : "text-yellow-400";
}
function levelBadge(level: number) {
  return level === 1 ? "bg-red-900" : level === 2 ? "bg-amber-800" : "bg-yellow-800";
}

const pad = (value: number) => String(value).padStart(2, "0");
function formatDateTime(epoch: number) {
  const date = new Date(epoch);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatDateTimeSeconds(epoch: number) {
  const date = new Date(epoch);
  return `${formatDateTime(epoch)}:${pad(date.getSeconds())}`;
}
function formatClock(epoch: number) {
  const date = new Date(epoch);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatClockSeconds(epoch: number) {
  const date = new Date(epoch);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
