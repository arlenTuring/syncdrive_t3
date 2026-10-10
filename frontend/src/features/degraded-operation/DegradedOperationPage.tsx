import {
  AlertTriangle,
  FileClock,
  Gauge,
  Hourglass,
  Pencil,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  TimerReset,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MapPlatformLayer } from "../dashboard/elements/MapPlatformLayer";
import { VehicleFleetMqttProvider } from "../dashboard/context/VehicleFleetMqttContext";
import { useMapVehicleModel } from "../vehicle-editor/model/useMapVehicleModel";
import { DegradedHistoryView } from "./DegradedHistoryView";
import { ImpactMetrics } from "./DegradedIcons";
import { degradedSidePanel } from "./degradedLifecycle";
import { MapViewport } from "./MapViewport";
import {
  AdjustExecutionDialog,
  ExecutionContentDialog,
  RestoreExecutionDialog,
} from "./ActiveExecutionDialogs";
import {
  adjustDegradedExecution,
  cancelDegradedSchedule,
  executeDegradedOperation,
  fetchActiveMapId,
  fetchDegradedOperationPlans,
  fetchDegradedOperationStatus,
  recordDegradedInteraction,
  restoreDegradedExecution,
  saveDegradedDraft,
  updateDegradedExecutionContent,
  type DegradedOperationPlan,
  type ExecutionSchedule,
  type OperationStatus,
} from "./api";
import { DegradedPlanDialog } from "./DegradedPlanDialog";
import { PlanExecutionDialog } from "./PlanExecutionDialog";
import { PlanManagementView } from "./PlanManagementView";

type LoadState<T> = { loading: boolean; value: T | null; error: string | null };
const loading = <T,>(): LoadState<T> => ({
  loading: true,
  value: null,
  error: null,
});

export function DegradedOperationPage() {
  const [plans, setPlans] =
    useState<LoadState<{ items: DegradedOperationPlan[]; total: number }>>(
      loading,
    );
  const [status, setStatus] = useState<LoadState<OperationStatus>>(loading);
  const [mapId, setMapId] = useState<LoadState<string>>(loading);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"live" | "manage" | "history">("live");
  const [customOpen, setCustomOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] =
    useState<DegradedOperationPlan | null>(null);
  const [activeDialog, setActiveDialog] = useState<
    "adjust" | "content" | "restore" | null
  >(null);

  const reloadPlans = useCallback(() => {
    void fetchDegradedOperationPlans({ pageSize: 100 })
      .then((value) => setPlans({ loading: false, value, error: null }))
      .catch((error: Error) =>
        setPlans({ loading: false, value: null, error: error.message }),
      );
  }, []);
  const reloadStatus = useCallback(() => {
    void fetchDegradedOperationStatus()
      .then((value) => setStatus({ loading: false, value, error: null }))
      .catch((error: Error) =>
        setStatus({ loading: false, value: null, error: error.message }),
      );
  }, []);
  const reload = useCallback(() => {
    reloadPlans();
    reloadStatus();
  }, [reloadPlans, reloadStatus]);

  useEffect(() => {
    reload();
    void fetchActiveMapId()
      .then((value) => setMapId({ loading: false, value, error: null }))
      .catch((error: Error) =>
        setMapId({ loading: false, value: null, error: error.message }),
      );
  }, [reload]);
  // 只有即時頁要每秒更新狀態；在歷史頁、計畫管理時不輪詢，回來時立刻重讀一次
  useEffect(() => {
    if (view !== "live") return undefined;
    reloadStatus();
    const timer = window.setInterval(reloadStatus, 1_000);
    return () => window.clearInterval(timer);
  }, [reloadStatus, view]);

  const submit = async (
    plan: Pick<
      DegradedOperationPlan,
      "id" | "name" | "description" | "level" | "speed_limit_kmh"
    > | null,
    input: {
      name: string;
      description: string;
      level: number;
      speed_limit_kmh: number;
    },
    schedule: ExecutionSchedule,
  ) => {
    const result = await executeDegradedOperation({
      ...input,
      source_plan_id: plan?.id,
      ...schedule,
    });
    await saveDegradedDraft(
      plan ? "plan-execution" : "custom-execution",
      { ...input, ...schedule, source_plan_id: plan?.id },
      "submitted",
    ).catch(() => undefined);
    setSelectedPlan(null);
    setCustomOpen(false);
    setNotice(result.message);
    reloadStatus();
  };
  // 右側顯示什麼完全依後端生命週期決定（見 degradedLifecycle），不給手動切換
  const side = degradedSidePanel(status);
  const active = side.kind === "impact" ? side.execution : null;
  const pending = status.value?.pending;
  const degraded = !!active;
  const unknown = side.kind === "error";
  const modeLabel = status.loading
    ? "讀取中…"
    : unknown
      ? "營運狀態未知"
      : degraded
        ? `降級運轉中　Level ${active.level}`
        : pending
          ? "待執行"
          : "正常營運中";
  const duration = active?.started_at_operating
    ? formatDuration(
        Math.max(
          0,
          (status.value?.operating_now ?? Number(active.started_at_operating)) -
            Number(active.started_at_operating),
        ),
      )
    : "00:00:00";

  if (view === "history")
    return <DegradedHistoryView onBack={() => setView("live")} />;

  if (view === "manage")
    return (
      <PlanManagementView
        onBack={() => {
          setView("live");
          reloadPlans();
        }}
        onChanged={reloadPlans}
      />
    );

  return (
    <div
      className={`grid h-full min-h-0 grid-cols-1 bg-black xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)] ${degraded ? "shadow-[inset_0_0_60px_rgba(220,38,38,.45)]" : ""}`}
    >
      <section className="flex min-h-[420px] min-w-0 flex-col border-b border-zinc-800 xl:min-h-0 xl:border-r xl:border-b-0">
        <div
          className={`flex min-h-16 shrink-0 items-center justify-between gap-4 border-l-4 px-5 ${degraded ? "border-red-500 bg-gradient-to-r from-red-950 to-black" : "border-emerald-400 bg-gradient-to-r from-emerald-950/80 to-black"}`}
        >
          <span className="text-sm text-zinc-300">目前營運模式</span>
          <span
            className={`text-xl font-semibold ${degraded ? "text-red-400" : pending ? "text-amber-300" : unknown ? "text-zinc-400" : "text-emerald-400"}`}
          >
            {modeLabel}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4">
          {!degraded ? (
            <>
              <button
                type="button"
                onClick={() => setView("history")}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm"
              >
                <FileClock className="size-4" />
                歷史降級紀錄
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomOpen(true);
                  void recordDegradedInteraction("dialog_opened", {
                    draft_key: "custom-execution",
                  });
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium"
              >
                <AlertTriangle className="size-4" />
                執行降級
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveDialog("adjust")}
                className="ml-auto rounded-xl border border-red-500 px-4 py-2.5 text-red-300"
              >
                更換計畫
              </button>
              <button
                type="button"
                onClick={() => setActiveDialog("restore")}
                className="rounded-xl bg-red-600 px-4 py-2.5 font-medium"
              >
                終止降級並恢復營運
              </button>
            </>
          )}
        </div>
        {pending ? (
          <div className="mx-5 mb-3 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <TimerReset className="size-5" />
            <span>
              待執行：{pending.name}，營運時間{" "}
              {formatClock(Number(pending.scheduled_for_operating))}
            </span>
            <button
              type="button"
              onClick={() =>
                void cancelDegradedSchedule(
                  pending.execution_id,
                  pending.version,
                )
                  .then((result) => {
                    setNotice(result.message);
                    reloadStatus();
                  })
                  .catch((error: Error) => setNotice(error.message))
              }
              className="ml-auto underline"
            >
              取消預約
            </button>
          </div>
        ) : null}
        {notice ? (
          <div
            role="status"
            className="mx-5 mb-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)}>
              關閉
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 p-5 pt-1">
          <div className="h-full min-h-[260px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
            {mapId.loading ? (
              <div className="flex h-full items-center justify-center text-zinc-500">
                載入場域地圖…
              </div>
            ) : mapId.error || !mapId.value ? (
              <div className="flex h-full items-center justify-center text-red-300">
                {mapId.error || "目前沒有啟用的地圖"}
              </div>
            ) : (
              <LiveMap mapId={mapId.value} />
            )}
          </div>
        </div>
      </section>
      <aside
        className={`flex min-h-[520px] min-w-0 flex-col p-4 xl:min-h-0 ${degraded ? "bg-red-950/20" : "bg-[#121214]"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2>降級資訊</h2>
          <button type="button" onClick={reload} aria-label="重新載入">
            <RefreshCw className="size-4 text-zinc-400" />
          </button>
        </div>
        {side.kind === "impact" ? (
          <ActiveSummary
            active={side.execution}
            duration={duration}
            onAdjust={() => setActiveDialog("adjust")}
            onContent={() => setActiveDialog("content")}
          />
        ) : side.kind === "loading" ? (
          <div className="mt-4 flex flex-1 items-center justify-center rounded-xl border border-zinc-800 text-zinc-500">
            讀取營運狀態…
          </div>
        ) : side.kind === "error" ? (
          <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-900/60 px-6 text-center text-red-300">
            <AlertTriangle className="size-6" />
            營運狀態未知：{side.message}
            <button type="button" onClick={reload} className="text-sm underline">
              重新讀取
            </button>
          </div>
        ) : (
          <PlanCards
            plans={plans}
            onManage={() => setView("manage")}
            onSelect={(plan) => {
              setSelectedPlan(plan);
              void recordDegradedInteraction("plan_selected", {
                plan_id: plan.id,
              });
              void recordDegradedInteraction("dialog_opened", {
                plan_id: plan.id,
              });
            }}
            onRetry={reloadPlans}
          />
        )}
      </aside>
      {selectedPlan ? (
        <PlanExecutionDialog
          plan={selectedPlan}
          onClose={() => {
            void recordDegradedInteraction("dialog_cancelled", {
              plan_id: selectedPlan.id,
            });
            setSelectedPlan(null);
          }}
          onSubmit={(schedule) => submit(selectedPlan, selectedPlan, schedule)}
        />
      ) : null}
      {customOpen ? (
        <DegradedPlanDialog
          kind="execute"
          onClose={() => {
            void recordDegradedInteraction("dialog_cancelled", {
              draft_key: "custom-execution",
            });
            setCustomOpen(false);
          }}
          onSubmit={(input, schedule) => submit(null, input, schedule!)}
        />
      ) : null}
      {active && activeDialog === "adjust" ? (
        <AdjustExecutionDialog
          execution={active}
          onClose={() => setActiveDialog(null)}
          onSubmit={async (level, speed) => {
            const result = await adjustDegradedExecution(active.execution_id, {
              level,
              speed_limit_kmh: speed,
              version: active.version,
            });
            setActiveDialog(null);
            setNotice(result.message);
            reloadStatus();
          }}
        />
      ) : null}
      {active && activeDialog === "content" ? (
        <ExecutionContentDialog
          execution={active}
          onClose={() => setActiveDialog(null)}
          onSubmit={async (name, description) => {
            const result = await updateDegradedExecutionContent(
              active.execution_id,
              { name, description, version: active.version },
            );
            setActiveDialog(null);
            setNotice(result.message);
            reloadStatus();
          }}
        />
      ) : null}
      {active && activeDialog === "restore" ? (
        <RestoreExecutionDialog
          execution={active}
          onClose={() => setActiveDialog(null)}
          onSubmit={async (checks) => {
            const result = await restoreDegradedExecution(active.execution_id, {
              ...checks,
              version: active.version,
            });
            setActiveDialog(null);
            setNotice(result.message);
            reloadStatus();
          }}
        />
      ) : null}
    </div>
  );
}

function PlanCards({
  plans,
  onManage,
  onSelect,
  onRetry,
}: {
  plans: LoadState<{ items: DegradedOperationPlan[]; total: number }>;
  onManage: () => void;
  onSelect: (plan: DegradedOperationPlan) => void;
  onRetry: () => void;
}) {
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-xl bg-[#191c1f] p-4">
      <div className="flex items-center gap-3 border-b border-zinc-700 pb-3">
        <h3 className="mr-auto text-sm">降級計畫清單</h3>
        <span className="text-sm">Total {plans.value?.total ?? "—"}</span>
        <button
          type="button"
          onClick={onManage}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm"
        >
          <Settings2 className="size-4" />
          計畫管理
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3">
        {plans.loading ? (
          <div className="flex h-full items-center justify-center text-zinc-500">
            載入降級計畫…
          </div>
        ) : plans.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-red-300">
            降級計畫載入失敗：{plans.error}
            <button onClick={onRetry}>重試</button>
          </div>
        ) : !plans.value?.items.length ? (
          <div className="flex h-full items-center justify-center text-zinc-400">
            無計畫
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[470px]:grid-cols-2">
            {plans.value.items.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => onSelect(plan)}
                className="min-w-0 rounded-2xl border border-zinc-700 bg-[#202328] p-3 text-left hover:border-blue-500"
              >
                <span
                  className={`-ml-3 rounded-r px-4 py-1 text-xs ${plan.level === 1 ? "bg-red-900" : plan.level === 2 ? "bg-amber-800" : "bg-yellow-800"}`}
                >
                  Level {plan.level}
                </span>
                <p className="min-h-12 break-words py-2">{plan.name}</p>
                <div className="flex border-t border-zinc-600 py-2">
                  <Gauge className="mr-2 size-4" />
                  速限
                  <span className="ml-auto">{plan.speed_limit_kmh} km/h</span>
                </div>
                <p className="rounded-full bg-zinc-700/50 py-1 text-center text-xs text-zinc-400">
                  點擊卡片設定執行
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActiveSummary({
  active,
  duration,
  onAdjust,
  onContent,
}: {
  active: NonNullable<OperationStatus["active_execution"]>;
  duration: string;
  onAdjust: () => void;
  onContent: () => void;
}) {
  return (
    <div className="mt-1 min-h-0 flex-1 overflow-y-auto rounded-xl bg-[#191c1f] p-4">
      <h3 className="border-b border-zinc-700 pb-3">降級影響範圍</h3>
      <div className="my-5 flex items-center justify-center gap-2 text-xl text-zinc-300">
        <Hourglass className="size-5 text-zinc-400" />
        持續時間 {duration}
      </div>
      <button
        type="button"
        onClick={onAdjust}
        className="mb-3 w-full rounded-xl bg-blue-500/20 py-3 text-blue-400"
      >
        <SlidersHorizontal className="mr-2 inline size-4" />
        調整降級參數
      </button>
      <ImpactMetrics speedLimitKmh={active.speed_limit_kmh} />
      <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        管理狀態已受理；車端控制契約尚未接通，控制結果：未下發。
      </p>
      <button
        type="button"
        onClick={onContent}
        className="my-4 w-full rounded-xl border border-zinc-600 py-2.5"
      >
        <Pencil className="mr-2 inline size-4" />
        填寫降級計畫內容
      </button>
      <div className="rounded-xl bg-[#1d2024] p-4">
        <span className="text-sm text-zinc-400">計畫名稱</span>
        <h4 className="text-lg">{active.name}</h4>
        <span className="float-right rounded bg-yellow-800 px-3 py-1 text-xs">
          Level {active.level}
        </span>
        <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-300">
          {active.description || "未填寫說明"}
        </p>
      </div>
    </div>
  );
}

/**
 * 降級頁的即時地圖：接上全車隊 MQTT（跟儀表板同一個 VehicleFleetMqttProvider），
 * 車輛外觀用圖資管理裡這張地圖的模型與顯示尺寸（共用解析，模型一改就更新）。
 * 視角另存一份，不動其他儀表板的縮放設定。
 */
function LiveMap({ mapId }: { mapId: string }) {
  const model = useMapVehicleModel(mapId);
  const notice = vehicleModelNotice(model);
  return (
    <VehicleFleetMqttProvider>
      <div className="relative h-full w-full">
        <MapViewport storageKey="live">
          <MapPlatformLayer mapId={mapId} vehicleTemplate={model.template} />
        </MapViewport>
        {notice ? (
          <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200">
            {notice}
          </span>
        ) : null}
      </div>
    </VehicleFleetMqttProvider>
  );
}

function vehicleModelNotice(model: ReturnType<typeof useMapVehicleModel>): string | null {
  const resolution = model.resolution;
  if (model.status === "error" && !resolution) return `車輛模型讀取失敗：${model.error}`;
  if (!resolution) return null;
  if (resolution.missingDefinitionKey)
    return `設定的車輛模型 ${resolution.missingDefinitionKey} 已不存在，暫以圖示顯示`;
  if (resolution.source === "none") return "這張地圖尚未在圖資管理設定車輛模型，暫以圖示顯示";
  return null;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
function formatClock(epoch: number) {
  return Number.isFinite(epoch)
    ? new Intl.DateTimeFormat("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(epoch)
    : "—";
}
