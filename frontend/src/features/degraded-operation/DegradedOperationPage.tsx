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
import { Button, IconButton } from '../../components/ui';

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
      className={`grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)] ${degraded ? "shadow-[inset_0_0_60px_rgba(220,38,38,.45)]" : ""}`}
    >
      <section className="flex min-h-[420px] min-w-0 flex-col border-b border-border-quaternary xl:min-h-0 xl:border-r xl:border-b-0">
        <div
          className={`flex min-h-16 shrink-0 items-center justify-between gap-4 border-l-4 px-5 ${degraded ? "border-status-error bg-gradient-to-r from-red-950 to-black" : "border-status-success bg-gradient-to-r from-emerald-950/80 to-black"}`}
        >
          <span className="text-body-s text-text-secondary">目前營運模式</span>
          <span
            className={`text-headline-4 ${degraded ? "text-status-error-emphasis" : pending ? "text-status-warning" : unknown ? "text-text-tertiary" : "text-status-success"}`}
          >
            {modeLabel}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4">
          {!degraded ? (
            <>
              <Button hierarchy="subordinate" variant="tonal" leadingIcon={<FileClock />} onPress={() => setView("history")}>歷史降級紀錄</Button>
              <Button hierarchy="danger" leadingIcon={<AlertTriangle />} onPress={() => {
                  setCustomOpen(true);
                  void recordDegradedInteraction("dialog_opened", {
                    draft_key: "custom-execution",
                  });
                }}>執行降級</Button>
            </>
          ) : (
            <>
              <Button hierarchy="danger" variant="outlined" className="ml-auto" onPress={() => setActiveDialog("adjust")}>更換計畫</Button>
              <Button hierarchy="danger" onPress={() => setActiveDialog("restore")}>終止降級並恢復營運</Button>
            </>
          )}
        </div>
        {pending ? (
          <div className="mx-5 mb-3 flex items-center gap-3 rounded-xl border border-status-warning-light bg-status-warning-light px-4 py-3 text-body-s text-status-warning">
            <TimerReset className="size-5" />
            <span>
              待執行：{pending.name}，營運時間{" "}
              {formatClock(Number(pending.scheduled_for_operating))}
            </span>
            <Button hierarchy="subordinate" variant="text" className="ml-auto" onPress={() =>
                void cancelDegradedSchedule(
                  pending.execution_id,
                  pending.version,
                )
                  .then((result) => {
                    setNotice(result.message);
                    reloadStatus();
                  })
                  .catch((error: Error) => setNotice(error.message))
              }>取消預約</Button>
          </div>
        ) : null}
        {notice ? (
          <div
            role="status"
            className="mx-5 mb-3 flex items-center justify-between rounded-lg border border-status-warning-light bg-status-warning-light px-3 py-2 text-body-xs text-status-warning"
          >
            <span>{notice}</span>
            <Button hierarchy="subordinate" variant="tonal" onPress={() => setNotice(null)}>關閉</Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 p-5 pt-1">
          <div className="h-full min-h-[260px] overflow-hidden rounded-2xl border border-border-quaternary bg-surface-sub-background">
            {mapId.loading ? (
              <div className="flex h-full items-center justify-center text-text-quaternary">
                載入場域地圖…
              </div>
            ) : mapId.error || !mapId.value ? (
              <div className="flex h-full items-center justify-center text-status-error-emphasis">
                {mapId.error || "目前沒有啟用的地圖"}
              </div>
            ) : (
              <LiveMap mapId={mapId.value} />
            )}
          </div>
        </div>
      </section>
      <aside
        className={`flex min-h-[520px] min-w-0 flex-col p-4 xl:min-h-0 ${degraded ? "bg-status-error-light" : "bg-surface-primary"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2>降級資訊</h2>
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={reload} label="重新載入" icon={<RefreshCw />} />
        </div>
        {side.kind === "impact" ? (
          <ActiveSummary
            active={side.execution}
            duration={duration}
            onAdjust={() => setActiveDialog("adjust")}
            onContent={() => setActiveDialog("content")}
          />
        ) : side.kind === "loading" ? (
          <div className="mt-4 flex flex-1 items-center justify-center rounded-xl border border-border-quaternary text-text-quaternary">
            讀取營運狀態…
          </div>
        ) : side.kind === "error" ? (
          <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border-danger-light px-6 text-center text-status-error-emphasis">
            <AlertTriangle className="size-6" />
            營運狀態未知：{side.message}
            <Button hierarchy="subordinate" variant="text" onPress={reload}>重新讀取</Button>
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
      <div className="flex items-center gap-3 border-b border-border-quaternary pb-3">
        <h3 className="mr-auto text-body-s">降級計畫清單</h3>
        <span className="text-body-s">Total {plans.value?.total ?? "—"}</span>
        <Button leadingIcon={<Settings2 />} onPress={onManage}>計畫管理</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3">
        {plans.loading ? (
          <div className="flex h-full items-center justify-center text-text-quaternary">
            載入降級計畫…
          </div>
        ) : plans.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-status-error-emphasis">
            降級計畫載入失敗：{plans.error}
            <Button hierarchy="subordinate" variant="text" onPress={onRetry} type="submit">重試</Button>
          </div>
        ) : !plans.value?.items.length ? (
          <div className="flex h-full items-center justify-center text-text-tertiary">
            無計畫
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[470px]:grid-cols-2">
            {plans.value.items.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => onSelect(plan)}
                className="min-w-0 rounded-2xl border border-border-quaternary bg-[#202328] p-3 text-left hover:border-border-theme"
              >
                <span
                  className={`-ml-3 rounded-r px-4 py-1 text-body-xs ${plan.level === 1 ? "bg-status-error-light" : plan.level === 2 ? "bg-status-warning-light" : "bg-status-warning-light"}`}
                >
                  Level {plan.level}
                </span>
                <p className="min-h-12 break-words py-2">{plan.name}</p>
                <div className="flex border-t border-border-tertiary py-2">
                  <Gauge className="mr-2 size-4" />
                  速限
                  <span className="ml-auto">{plan.speed_limit_kmh} km/h</span>
                </div>
                <p className="rounded-full bg-link-standard-hover py-1 text-center text-body-xs text-text-tertiary">
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
      <h3 className="border-b border-border-quaternary pb-3">降級影響範圍</h3>
      <div className="my-5 flex items-center justify-center gap-2 text-headline-4 text-text-secondary">
        <Hourglass className="size-5 text-text-tertiary" />
        持續時間 {duration}
      </div>
      <Button className="mb-3 w-full" leadingIcon={<SlidersHorizontal />} onPress={onAdjust}>調整降級參數</Button>
      <ImpactMetrics speedLimitKmh={active.speed_limit_kmh} />
      <p className="mt-3 rounded-lg border border-status-warning-light bg-status-warning-light p-3 text-body-xs text-status-warning">
        管理狀態已受理；車端控制契約尚未接通，控制結果：未下發。
      </p>
      <Button hierarchy="subordinate" variant="outlined" className="my-4 w-full" leadingIcon={<Pencil />} onPress={onContent}>填寫降級計畫內容</Button>
      <div className="rounded-xl bg-[#1d2024] p-4">
        <span className="text-body-s text-text-tertiary">計畫名稱</span>
        <h4 className="text-headline-5">{active.name}</h4>
        <span className="float-right rounded bg-status-warning-light px-3 py-1 text-body-xs">
          Level {active.level}
        </span>
        <p className="mt-4 whitespace-pre-wrap text-body-s text-text-secondary">
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
          <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-lg bg-status-warning-light px-3 py-1.5 text-body-xs text-status-warning">
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
