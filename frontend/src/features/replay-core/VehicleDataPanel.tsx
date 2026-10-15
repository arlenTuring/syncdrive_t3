import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReplayCursor } from "./cursor";
import { CATEGORY_LABEL } from "./fieldLabels";
import type { HiddenVehicle, ReplayState } from "./replayState";
import { formatClockMs, formatDateTime } from "./time";
import {
  buildPanelSections,
  countLeaves,
  filterNodes,
  streamStatuses,
  type FieldNode,
} from "./vehiclePanelModel";

export type RelatedRecords = {
  events: Array<Record<string, unknown> & { at: number | null }>;
  commands: Array<Record<string, unknown> & { sent_at: number | null; acked_at: number | null; is_acked: boolean }>;
};

/**
 * 選取車輛的資料面板（一般運行紀錄、歷史降級共用）。
 *
 * 顯示游標當下這台車每個串流最後保存的那一筆，全部欄位攤開分類；巢狀物件可展開、陣列逐項列出，
 * 對照不到中文的欄位照原始路徑顯示。缺少、null、空值、0、false 分開呈現。只讀保存的歷史資料。
 */
export function VehicleDataPanel({
  vehicleCode,
  vehicles,
  investigated,
  state,
  cursor,
  staleAfterMs,
  healthKeepaliveMs,
  hidden,
  onSelect,
  onClose,
  loadRelated,
  timelineLabel = "回放時間",
}: {
  vehicleCode: string;
  /**
   * 兩種用法：
   * - 給 onSelect＋vehicles：可以在面板上切車（歷史降級播放器）
   * - 給 investigated：固定調查載具，唯讀顯示，面板上沒有任何切車的方式（運行管理紀錄）
   */
  vehicles?: readonly string[];
  investigated?: { displayName: string; vehicleCode: string };
  state: ReplayState | null;
  cursor: ReplayCursor | null;
  staleAfterMs: number;
  healthKeepaliveMs?: number;
  hidden: readonly HiddenVehicle[];
  onSelect?: (code: string) => void;
  onClose?: () => void;
  /** 截至游標的事件與指令紀錄（有權限的頁面才提供） */
  loadRelated?: (vehicle: string, to: number, signal: AbortSignal) => Promise<RelatedRecords>;
  timelineLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const cursorT = cursor?.t ?? null;
  const hiddenReason = hidden.find((item) => item.code === vehicleCode)?.reason ?? null;
  const statuses = useMemo(
    () => streamStatuses(state, vehicleCode, cursorT, staleAfterMs, { healthKeepaliveMs, hiddenReason }),
    [cursorT, healthKeepaliveMs, hiddenReason, staleAfterMs, state, vehicleCode],
  );
  const sections = useMemo(() => buildPanelSections(state, vehicleCode), [state, vehicleCode]);
  const filtered = useMemo(
    () => sections.map((section) => ({ ...section, nodes: filterNodes(section.nodes, query) })),
    [query, sections],
  );
  const related = useRelated(loadRelated, vehicleCode, cursorT);
  const options = useMemo(
    () => [...new Set([vehicleCode, ...(vehicles ?? []), ...hidden.map((item) => item.code)])].sort(),
    [hidden, vehicleCode, vehicles],
  );
  const searching = query.trim() !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm" aria-label={`${vehicleCode} 車輛資料`}>
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {onSelect && !investigated ? (
          <>
            <label className="sr-only" htmlFor="replay-vehicle-select">
              選取車輛
            </label>
            <select
              id="replay-vehicle-select"
              value={vehicleCode}
              onChange={(event) => onSelect(event.target.value)}
              className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-2 py-1.5 font-mono"
            >
              {options.map((code) => (
                <option key={code} value={code}>
                  {code}
                  {hidden.some((item) => item.code === code) ? "（地圖未顯示）" : ""}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className="min-w-0 flex-1 truncate" data-testid="investigated-vehicle">
            <span className="text-zinc-400">調查載具：</span>
            <span className="text-zinc-100">{investigated?.displayName ?? vehicleCode}</span>
            {investigated && investigated.displayName !== investigated.vehicleCode ? (
              <span className="ml-1.5 font-mono text-xs text-zinc-500">{investigated.vehicleCode}</span>
            ) : null}
          </p>
        )}
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="關閉車輛資料" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="relative border-b border-zinc-800 px-3 py-2">
        <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋欄位名稱、原始路徑或值"
          aria-label="搜尋欄位"
          className="w-full rounded-lg bg-zinc-900 py-1.5 pr-2 pl-8 text-sm outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <section aria-label="各串流資料時間" className="mb-3 space-y-1.5">
          {statuses.map((status) => (
            <div
              key={status.stream}
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                !status.frame ? "border-zinc-800 text-zinc-500" : status.stale ? "border-amber-600/60 bg-amber-500/5" : "border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-200">{status.label}</span>
                {status.frame ? (
                  status.stale ? (
                    <span className="rounded bg-amber-500/20 px-1.5 text-amber-200">過期</span>
                  ) : (
                    <span className="rounded bg-emerald-500/15 px-1.5 text-emerald-300">有效</span>
                  )
                ) : (
                  <span className="rounded bg-zinc-800 px-1.5">無資料</span>
                )}
                {status.ageMs != null ? <span className="ml-auto text-zinc-500">{(status.ageMs / 1000).toFixed(1)} 秒前</span> : null}
              </div>
              {status.frame ? (
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-zinc-400">
                  <dt>後端收到</dt>
                  <dd className="font-mono">{formatDateTime(status.frame.received_at)}.{String(status.frame.received_at % 1000).padStart(3, "0")}</dd>
                  <dt>車端時間</dt>
                  <dd className="font-mono">
                    {status.frame.vehicle_ts != null ? `${formatClockMs(status.frame.vehicle_ts)}` : "缺少（payload 沒有 timestamp）"}
                  </dd>
                  <dt>營運時間</dt>
                  <dd className="font-mono">{status.frame.operating_at != null ? formatClockMs(status.frame.operating_at) : "—"}</dd>
                  <dt>序號</dt>
                  <dd className="font-mono">{status.frame.seq}</dd>
                </dl>
              ) : null}
              {status.stream === "health" && status.frame && healthKeepaliveMs ? (
                <p className="mt-1 text-zinc-500">健康內容沒變時降頻保存（每 {Math.round(healthKeepaliveMs / 1000)} 秒一筆），內容有變一定保存</p>
              ) : null}
              {status.note ? <p className={`mt-1 ${status.stale ? "text-amber-200" : "text-zinc-500"}`}>{status.note}</p> : null}
            </div>
          ))}
          <p className="text-[11px] text-zinc-600">時間軸：{timelineLabel}。內容只來自游標之前保存的資料，不以即時資料補。</p>
        </section>
        {filtered.map((section) => {
          const relatedHere = section.category === "events" && related ? related : null;
          const count = countLeaves(section.nodes);
          if (searching && count === 0) return null;
          return (
            <details key={section.category} open className="group mb-2 rounded-lg border border-zinc-800">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 select-none">
                <ChevronRight className="size-4 text-zinc-500 transition group-open:rotate-90" />
                <span className="text-zinc-100">{CATEGORY_LABEL[section.category]}</span>
                <span className="ml-auto text-xs text-zinc-500">{count} 欄</span>
              </summary>
              <div className="border-t border-zinc-800 px-2 py-1.5">
                {section.nodes.length === 0 && !relatedHere ? (
                  <p className="px-1 py-1 text-xs text-zinc-500">此分類在游標當下沒有保存的資料</p>
                ) : (
                  <ul className="space-y-0.5">
                    {section.nodes.map((node) => (
                      <FieldItem key={node.id} node={node} depth={0} expand={searching} />
                    ))}
                  </ul>
                )}
                {section.category === "events" ? <RelatedList state={related} vehicle={vehicleCode} cursorT={cursorT} enabled={!!loadRelated} /> : null}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function FieldItem({ node, depth, expand }: { node: FieldNode; depth: number; expand: boolean }) {
  const name = (
    <span className="min-w-0">
      {node.label ? (
        <span className="text-zinc-200">{node.label}</span>
      ) : (
        <span className="rounded bg-zinc-800 px-1 text-[11px] text-amber-200/90">尚無中文對照</span>
      )}
      <span className="ml-1.5 font-mono text-[11px] break-all text-zinc-500">{node.path}</span>
    </span>
  );
  if (node.children.length) {
    return (
      <li>
        <details open={expand || depth < 1} className="group/field">
          <summary className="flex cursor-pointer list-none items-start gap-1 rounded px-1 py-0.5 hover:bg-white/5">
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-zinc-500 transition group-open/field:rotate-90" />
            {name}
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-zinc-500">
              {node.kind === "array" ? `陣列 ${node.children.length} 項` : `物件 ${node.children.length} 欄`}
            </span>
          </summary>
          <ul className="ml-3 border-l border-zinc-800 pl-2">
            {node.children.map((child) => (
              <FieldItem key={child.id} node={child} depth={depth + 1} expand={expand} />
            ))}
          </ul>
        </details>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 rounded px-1 py-0.5 pl-5 hover:bg-white/5">
      {name}
      <span className="ml-auto shrink-0 pl-2 text-right">
        <FieldValue node={node} />
      </span>
    </li>
  );
}

function FieldValue({ node }: { node: FieldNode }) {
  switch (node.kind) {
    case "missing":
      return <span className="text-amber-300">缺少（這筆沒有此欄位）</span>;
    case "null":
      return <span className="font-mono text-zinc-400">null（空值）</span>;
    case "empty-string":
      return <span className="font-mono text-zinc-400">""（空字串）</span>;
    case "empty-array":
      return <span className="font-mono text-zinc-400">[]（空陣列）</span>;
    case "empty-object":
      return <span className="font-mono text-zinc-400">{"{}"}（空物件）</span>;
    case "boolean":
      return (
        <span className="font-mono text-zinc-100">
          {String(node.value)}
          <span className="text-zinc-500">（{node.value ? "是" : "否"}）</span>
        </span>
      );
    case "number": {
      const value = node.value as number;
      if (node.unit === "Unix ms")
        return (
          <span className="font-mono text-zinc-100">
            {value}
            <span className="block text-[11px] text-zinc-500">{formatDateTime(value)}.{String(value % 1000).padStart(3, "0")}</span>
          </span>
        );
      return (
        <span className="font-mono text-zinc-100">
          {value}
          {node.unit ? <span className="ml-1 text-zinc-500">{node.unit}</span> : null}
        </span>
      );
    }
    default:
      return (
        <span className="font-mono break-all text-zinc-100">
          {String(node.value)}
          {node.valueText ? <span className="ml-1 text-zinc-500">（{node.valueText}）</span> : null}
          {node.unit ? <span className="ml-1 text-zinc-500">{node.unit}</span> : null}
        </span>
      );
  }
}

type RelatedState = { key: string; value: RelatedRecords | null; error: string | null } | null;

/** 截至游標的事件與指令：游標停下 400ms 後才查，換車或移動游標時取消前一個請求 */
function useRelated(
  loadRelated: ((vehicle: string, to: number, signal: AbortSignal) => Promise<RelatedRecords>) | undefined,
  vehicle: string,
  cursorT: number | null,
): RelatedState {
  const [result, setResult] = useState<RelatedState>(null);
  const key = `${vehicle}|${cursorT == null ? "" : Math.floor(cursorT / 1000)}`;
  useEffect(() => {
    if (!loadRelated || cursorT == null) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadRelated(vehicle, cursorT, controller.signal)
        .then((value) => setResult({ key, value, error: null }))
        .catch((reason: Error) => {
          if (!controller.signal.aborted) setResult({ key, value: null, error: reason.message });
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以秒為單位重查，避免播放時每一幀都打 API
  }, [key, loadRelated]);
  return result?.key.startsWith(`${vehicle}|`) ? result : null;
}

function RelatedList({
  state,
  vehicle,
  cursorT,
  enabled,
}: {
  state: RelatedState;
  vehicle: string;
  cursorT: number | null;
  enabled: boolean;
}) {
  if (!enabled) {
    return <p className="mt-1 px-1 text-xs text-zinc-500">本播放器只顯示錄進回放的事件與指令回應訊息</p>;
  }
  if (!state) return <p className="mt-1 px-1 text-xs text-zinc-500">載入 {vehicle} 的事件與指令紀錄…</p>;
  if (state.error) return <p className="mt-1 px-1 text-xs text-red-300">事件與指令紀錄載入失敗：{state.error}</p>;
  const events = (state.value?.events ?? []).filter((item) => cursorT == null || (item.at ?? 0) <= cursorT);
  const commands = (state.value?.commands ?? []).filter((item) => cursorT == null || (item.sent_at ?? 0) <= cursorT);
  return (
    <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2 text-xs">
      <div>
        <h4 className="mb-1 text-zinc-300">事件紀錄（截至游標，最近 200 筆）</h4>
        {events.length === 0 ? (
          <p className="text-zinc-500">回放時段內、游標之前沒有事件</p>
        ) : (
          <ul className="space-y-1">
            {events.map((item, index) => (
              <li key={String(item.event_id ?? index)} className="rounded bg-zinc-900 px-2 py-1">
                <span className="font-mono text-zinc-400">{item.at != null ? formatClockMs(item.at) : "—"}</span>{" "}
                <span className="text-zinc-100">{String(item.event_code ?? "")}</span>{" "}
                <span className="text-zinc-500">{String(item.severity ?? "")}</span>
                {item.display_message ? <p className="text-zinc-400">{String(item.display_message)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1 text-zinc-300">下發指令（截至游標）</h4>
        {commands.length === 0 ? (
          <p className="text-zinc-500">回放時段內、游標之前沒有下發指令</p>
        ) : (
          <ul className="space-y-1">
            {commands.map((item, index) => {
              // 回應時刻晚於游標的：游標當下還沒回應（游標往回移時，舊的查詢結果也照這個規則顯示）
              const acked = item.is_acked && item.acked_at != null && cursorT != null && item.acked_at <= cursorT;
              return (
                <li key={String(item.command_id ?? index)} className="rounded bg-zinc-900 px-2 py-1">
                  <span className="font-mono text-zinc-400">{item.sent_at != null ? formatClockMs(item.sent_at) : "—"}</span>{" "}
                  <span className="text-zinc-100">{String(item.action ?? "")}</span>{" "}
                  <span className={acked ? "text-emerald-300" : "text-amber-300"}>
                    {acked ? `已回應 ${formatClockMs(item.acked_at!)}` : "游標當下尚未回應"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
