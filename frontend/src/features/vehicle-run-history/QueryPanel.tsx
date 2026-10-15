import { Clock3, Hash, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GAP_REASON } from "../replay-core/replayLabels";
import { epochToZonedInput, formatDateTime, formatDuration, REPLAY_TIME_ZONE } from "../replay-core/time";
import {
  fetchInvestigableVehicles,
  resolveRange,
  resolveShift,
  type Coverage,
  type RangeResolution,
  type ShiftResolution,
  type VehicleOption,
} from "./api";
import { appliedVehicle, checkRangeDraft, draftDiffers, type RangeDraft, type Resolved } from "./queryConditions";
import { VehiclePicker } from "./VehiclePicker";

export type { Resolved } from "./queryConditions";

const TIME_ZONES = [REPLAY_TIME_ZONE, "UTC"] as const;

const RANGE_BASIS: Record<string, string> = {
  actual_start: "車端回報的實際開始時刻",
  first_operation_report: "沒有開始紀錄，改用這次執行的第一筆營運回報",
  actual_end: "實際結束時刻（到站／故障／取消／完成）",
  last_operation_report: "沒有結束紀錄，改用這次執行的最後一筆營運回報",
  now_running: "仍在執行，到查詢當下為止",
};

const SHIFT_TONE: Record<string, string> = {
  complete: "border-emerald-700/60 bg-emerald-500/10 text-emerald-200",
  running: "border-sky-700/60 bg-sky-500/10 text-sky-200",
  partial: "border-amber-700/60 bg-amber-500/10 text-amber-200",
  not_started: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
  no_history: "border-amber-700/60 bg-amber-500/10 text-amber-200",
  no_vehicle: "border-amber-700/60 bg-amber-500/10 text-amber-200",
  multi_vehicle: "border-sky-700/60 bg-sky-500/10 text-sky-200",
  not_found: "border-red-800/60 bg-red-500/10 text-red-200",
  ambiguous: "border-amber-700/60 bg-amber-500/10 text-amber-200",
};

/**
 * 播放條件：調查載具＋時間區間，或班次唯一碼（解析出那次執行實際的車）。
 *
 * 表單是「待查詢條件」；送出成功的結果才是「已套用條件」（resolved），播放、地圖、面板只看後者。
 * 改了表單但還沒重新查詢時，播放中的結果不受影響。送出新查詢時取消上一個還沒回來的，
 * 舊回應不會蓋掉新的。
 */
export function QueryPanel({
  resolved,
  onResolved,
}: {
  resolved: Resolved | null;
  onResolved: (value: Resolved | null) => void;
}) {
  const [mode, setMode] = useState<"range" | "shift">("range");
  const [draft, setDraft] = useState<RangeDraft>(() => ({
    vehicleId: null,
    from: epochToZonedInput(Date.now() - 60 * 60_000),
    to: epochToZonedInput(Date.now()),
    timeZone: REPLAY_TIME_ZONE,
  }));
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<{ items: VehicleOption[]; error: string | null; loading: boolean }>({ items: [], error: null, loading: true });
  const controllerRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchInvestigableVehicles(controller.signal)
      .then((body) => setVehicles({ items: body.items, error: null, loading: false }))
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setVehicles({ items: [], error: reason.message, loading: false });
      });
    return () => controller.abort();
  }, []);

  const run = async (request: (signal: AbortSignal) => Promise<Resolved>) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const value = await request(controller.signal);
      if (controller.signal.aborted) return;
      onResolved(value);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "查詢失敗");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const rangeCheck = checkRangeDraft(draft);
  const submitRange = (event: React.FormEvent) => {
    event.preventDefault();
    if (!rangeCheck.ok) return setError(rangeCheck.error);
    const id = `range:${rangeCheck.vehicleId}:${++sequence.current}`;
    const input = { vehicleId: rangeCheck.vehicleId, from: rangeCheck.fromIso, to: rangeCheck.toIso, tz: draft.timeZone };
    void run(async (signal) => ({ id, kind: "range", value: await resolveRange(input, signal) }));
  };

  const runShift = (value: string, vehicleId: string | null) => {
    const id = `shift:${vehicleId ?? "-"}:${++sequence.current}`;
    void run(async (signal) => ({ id, kind: "shift", value: await resolveShift(value, vehicleId, signal) }));
  };
  const submitShift = (event: React.FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (!value) return setError("請輸入或貼上班次唯一碼");
    runShift(value, null);
  };

  const applied = appliedVehicle(resolved);
  const pending = mode === "range" && resolved != null && draftDiffers(draft, resolved);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
      <AppliedConditions resolved={resolved} />
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 p-1" role="radiogroup" aria-label="查詢方式">
        {(
          [
            ["range", "指定時間區間", Clock3],
            ["shift", "指定班次播放", Hash],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => {
              setMode(id);
              setError(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 ${mode === id ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "range" ? (
        <form onSubmit={submitRange} className="space-y-3" noValidate aria-label="待查詢條件">
          <VehiclePicker
            options={vehicles.items}
            value={draft.vehicleId}
            onChange={(vehicleId) => setDraft((current) => ({ ...current, vehicleId }))}
            loading={vehicles.loading}
            error={vehicles.error}
          />
          <label className="block">
            <span className="mb-1 block text-zinc-400">時區</span>
            <select
              value={draft.timeZone}
              onChange={(event) => setDraft((current) => ({ ...current, timeZone: event.target.value }))}
              className="w-full rounded-lg bg-zinc-800 px-3 py-2"
            >
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone === REPLAY_TIME_ZONE ? `${zone}（台北，UTC+08:00）` : "UTC"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-400">開始</span>
            <input
              type="datetime-local"
              step={1}
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              required
              className="w-full rounded-lg bg-zinc-800 px-3 py-2 font-mono [color-scheme:dark]"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-zinc-400">
              <span>結束</span>
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, to: epochToZonedInput(Date.now(), current.timeZone) }))}
                className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-sky-300 hover:border-sky-500 hover:text-sky-200"
              >
                此刻
              </button>
            </span>
            <input
              type="datetime-local"
              step={1}
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              required
              className="w-full rounded-lg bg-zinc-800 px-3 py-2 font-mono [color-scheme:dark]"
            />
          </label>
          <p className="text-xs text-zinc-500">
            以 {draft.timeZone} 當地時間解讀；一次最多 12 小時。會查詢該載具在此區間內由後端實際收到並保存的全部紀錄，不套用任務或班次起訖。
          </p>
          {!rangeCheck.ok ? <p className="text-xs text-amber-300">{rangeCheck.error}</p> : null}
          {pending && applied ? (
            <p className="rounded-lg border border-sky-800/60 bg-sky-500/10 px-3 py-2 text-xs text-sky-200" role="status">
              待查詢：條件已修改，尚未套用。目前仍在播放 {applied.display_name} 的已套用結果。
            </p>
          ) : null}
          <SubmitButton loading={loading} disabled={!rangeCheck.ok} />
        </form>
      ) : (
        <form onSubmit={submitShift} className="space-y-3" noValidate aria-label="待查詢條件">
          <label className="block">
            <span className="mb-1 block text-zinc-400">班次唯一碼</span>
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="例：261015-E021830@1791000900000"
              spellCheck={false}
              className="w-full rounded-lg bg-zinc-800 px-3 py-2 font-mono"
            />
          </label>
          <p className="text-xs text-zinc-500">
            在「班次運行紀錄 → 運行紀錄」視窗複製。後端解析該次執行實際的載具並固定為調查載具；涉及多台時會先請你選。
          </p>
          <SubmitButton loading={loading} disabled={!code.trim()} />
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-800/60 bg-red-500/10 px-3 py-2 text-red-200">
          {error}
        </p>
      ) : null}

      {resolved ? (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          {resolved.kind === "range" ? (
            <RangeSummary value={resolved.value} />
          ) : (
            <ShiftSummary
              value={resolved.value}
              onPick={(picked) => {
                setCode(picked);
                runShift(picked, null);
              }}
              onPickVehicle={(vehicleId) => runShift(resolved.value.code, vehicleId)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 已套用條件：本次調查對象與範圍（播放、地圖、面板都只看這一份） */
function AppliedConditions({ resolved }: { resolved: Resolved | null }) {
  const vehicle = appliedVehicle(resolved);
  const window_ = resolved?.value.window ?? null;
  if (!resolved || !vehicle || !window_) return null;
  return (
    <section aria-label="已套用條件" className="mb-4 rounded-lg border border-amber-600/50 bg-amber-500/5 px-3 py-2">
      <p className="text-xs text-amber-200/80">已套用條件</p>
      <p className="mt-0.5 text-zinc-100" data-testid="applied-vehicle">
        調查載具：{vehicle.display_name}
        {vehicle.display_name !== vehicle.vehicle_code ? <span className="ml-1.5 font-mono text-xs text-zinc-400">{vehicle.vehicle_code}</span> : null}
        {!vehicle.is_active ? <span className="ml-1.5 rounded bg-zinc-700 px-1 text-[10px]">已停用</span> : null}
      </p>
      <p className="font-mono text-xs text-zinc-300">
        {formatDateTime(window_.from_real)}～{formatDateTime(window_.to_real)}
      </p>
    </section>
  );
}

function SubmitButton({ loading, disabled }: { loading: boolean; disabled: boolean }) {
  return (
    <button
      type="submit"
      // 查詢中仍可送出新條件：新的會取消舊的，舊回應不會蓋掉新的
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-white hover:bg-blue-500 disabled:opacity-50"
    >
      <Search className="size-4" />
      {loading ? "查詢中…" : "查詢"}
    </button>
  );
}

function RangeSummary({ value }: { value: RangeResolution }) {
  return (
    <div className="space-y-3">
      <h3 className="text-zinc-200">查詢結果</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">回放範圍</dt>
        <dd className="font-mono text-zinc-200">
          {formatDateTime(value.window.from_real)}～{formatDateTime(value.window.to_real)}
        </dd>
        {value.window.ongoing ? (
          <>
            <dt className="text-zinc-500">說明</dt>
            <dd className="text-amber-200">結束時間在未來，只回放到查詢當下（{formatDateTime(value.window.to_real)}）</dd>
          </>
        ) : null}
        <dt className="text-zinc-500">時區</dt>
        <dd>{value.timezone}</dd>
      </dl>
      <VehicleRecordsSummary name={value.vehicle.display_name} records={value.vehicle_records} />
      <CoverageSummary coverage={value.coverage} />
      {value.clock_runs.length > 1 ? (
        <p className="rounded-lg border border-amber-700/60 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          此範圍包含 {value.clock_runs.length} 輪營運時鐘；時間軸以後端收到時間為準，營運時間在換輪處不連續，畫面會標示目前所在的輪次。
        </p>
      ) : null}
    </div>
  );
}

function ShiftSummary({
  value,
  onPick,
  onPickVehicle,
}: {
  value: ShiftResolution;
  onPick: (code: string) => void;
  onPickVehicle: (vehicleId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className={`rounded-lg border px-3 py-2 ${SHIFT_TONE[value.state] ?? "border-zinc-700"}`} role="status">
        {value.state_label}
      </div>
      {value.state === "multi_vehicle" && value.vehicle_candidates?.length ? (
        <ul className="space-y-1.5" aria-label="選擇調查載具">
          {value.vehicle_candidates.map((candidate) => (
            <li key={candidate.vehicle_code}>
              <button
                type="button"
                disabled={!candidate.vehicle}
                onClick={() => candidate.vehicle && onPickVehicle(candidate.vehicle.id)}
                className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-left hover:border-amber-500 disabled:opacity-50"
              >
                <span className="text-zinc-100">{candidate.vehicle?.display_name ?? "未註冊的車"}</span>
                <span className="ml-1.5 font-mono text-xs text-zinc-400">{candidate.vehicle_code}</span>
                <span className="block text-xs text-zinc-500">這次執行期間的相關紀錄 {candidate.records} 筆</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.vehicle && value.vehicle_records ? <VehicleRecordsSummary name={value.vehicle.display_name} records={value.vehicle_records} /> : null}
      {value.state === "ambiguous" && value.candidates?.length ? (
        <ul className="space-y-1.5">
          {value.candidates.map((candidate) => (
            <li key={candidate.code}>
              <button
                type="button"
                onClick={() => onPick(candidate.code)}
                className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-left hover:border-blue-500"
              >
                <span className="block font-mono text-xs break-all text-zinc-200">{candidate.code}</span>
                <span className="text-xs text-zinc-400">
                  {candidate.trip_code ?? "—"}・{candidate.vehicle_code ?? "—"}・{candidate.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.state !== "not_found" && value.state !== "ambiguous" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500">班次唯一碼</dt>
          <dd className="font-mono break-all text-zinc-200">{value.code}</dd>
          <dt className="text-zinc-500">營運日</dt>
          <dd>{value.operating_day ?? "—"}</dd>
          <dt className="text-zinc-500">調查載具</dt>
          <dd>
            {value.vehicle ? (
              <>
                {value.vehicle.display_name}
                {value.vehicle.display_name !== value.vehicle.vehicle_code ? <span className="ml-1.5 font-mono text-zinc-500">{value.vehicle.vehicle_code}</span> : null}
              </>
            ) : (
              "尚未固定"
            )}
          </dd>
          <dt className="text-zinc-500">班次代碼</dt>
          <dd className="font-mono">{value.trip_code ?? "—"}</dd>
          <dt className="text-zinc-500">訂單狀態</dt>
          <dd>{value.status ?? "—"}</dd>
          <dt className="text-zinc-500">實際範圍</dt>
          <dd className="font-mono">
            {value.window ? (
              <>
                {formatDateTime(value.window.from_real)}～{formatDateTime(value.window.to_real)}
                <span className="block text-zinc-500">（{formatDuration(value.window.to_real - value.window.from_real)}）</span>
              </>
            ) : (
              "—（沒有實際執行範圍）"
            )}
          </dd>
          {value.range_basis ? (
            <>
              <dt className="text-zinc-500">範圍依據</dt>
              <dd>
                開始：{RANGE_BASIS[value.range_basis.from ?? ""] ?? value.range_basis.from ?? "—"}
                <br />
                結束：{RANGE_BASIS[value.range_basis.to ?? ""] ?? value.range_basis.to ?? "—"}
              </dd>
            </>
          ) : null}
          {value.record_source === "history" ? (
            <>
              <dt className="text-zinc-500">資料來源</dt>
              <dd className="text-amber-200">訂單主檔已不是這一次執行，以歷史中保存的訂單紀錄為準</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {value.coverage ? <CoverageSummary coverage={value.coverage} /> : null}
    </div>
  );
}

function VehicleRecordsSummary({ name, records }: { name: string; records: { count: number; first_real: number | null; last_real: number | null; last_before_real: number | null } }) {
  return (
    <div className="text-xs">
      <h4 className="mb-1 text-zinc-400">調查載具紀錄</h4>
      {records.count > 0 ? (
        <p className="text-zinc-300">
          {name} 在範圍內有 {records.count} 筆紀錄（{formatDateTime(records.first_real!)}～{formatDateTime(records.last_real!)}）
        </p>
      ) : (
        <p className="text-amber-200">
          {name} 在這段範圍內沒有任何保存的紀錄，沒有可逐幀的資料
          {records.last_before_real != null ? `；範圍前最後一筆在 ${formatDateTime(records.last_before_real)}` : ""}
        </p>
      )}
    </div>
  );
}

function CoverageSummary({ coverage }: { coverage: Coverage }) {
  const label = coverage.state === "complete" ? "已完整錄製" : coverage.state === "partial" ? "部分錄製" : "未錄製";
  return (
    <div className="text-xs">
      <h4 className="mb-1 text-zinc-400">
        錄製涵蓋：<span className={coverage.state === "complete" ? "text-emerald-300" : "text-amber-200"}>{label}</span>
      </h4>
      {coverage.gaps.length ? (
        <ul className="space-y-1">
          {coverage.gaps.map((gap, index) => (
            <li key={index} className={`rounded px-2 py-1 ${gap.reason === "not_recorded" ? "bg-zinc-800" : "bg-red-500/10 text-red-200"}`}>
              {GAP_REASON[gap.reason] ?? gap.reason}：{formatDateTime(gap.from_real)}～{formatDateTime(gap.to_real)}
              {gap.count ? `（遺失 ${gap.count} 筆）` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500">範圍內沒有缺段</p>
      )}
      <p className="mt-1 text-zinc-600">
        健康資料內容沒變時每 {Math.round(coverage.health_keepalive_ms / 1000)} 秒保存一筆（降頻），內容有變一定保存；遙測、營運狀態逐筆保存。
      </p>
    </div>
  );
}
