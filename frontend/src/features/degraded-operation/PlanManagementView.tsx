import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  createDegradedOperationPlan,
  deleteDegradedOperationPlan,
  fetchDegradedOperationPlan,
  fetchDegradedOperationPlans,
  updateDegradedOperationPlan,
  type DegradedOperationPlan,
  type PlanListResponse,
} from "./api";
import { DegradedPlanDialog } from "./DegradedPlanDialog";
import { draftFromPlan } from "./DegradedPlanForm";

type SortKey = "name" | "level" | "speed";
const PAGE_SIZE = 10;

export function PlanManagementView({
  onBack,
  onChanged,
}: {
  onBack: () => void;
  onChanged: () => void;
}) {
  const [result, setResult] = useState<PlanListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    { key: "name", direction: "asc" },
  );
  const [dialog, setDialog] = useState<
    { kind: "create" } | { kind: "edit"; plan: DegradedOperationPlan } | null
  >(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchDegradedOperationPlans({
      sortBy: sort.key,
      direction: sort.direction,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(setResult)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [page, sort]);
  // Load only starts an async request; the rule cannot see through this helper.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(load, [load]);

  const changeSort = (key: SortKey) => {
    setPage(1);
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };
  const sortIcon = (key: SortKey) =>
    sort.key !== key ? (
      <ChevronDown className="size-3 opacity-40" />
    ) : sort.direction === "asc" ? (
      <ChevronUp className="size-3" />
    ) : (
      <ChevronDown className="size-3" />
    );
  const changed = () => {
    load();
    onChanged();
  };

  const edit = async (id: string) => {
    setError(null);
    try {
      setDialog({ kind: "edit", plan: await fetchDegradedOperationPlan(id) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "計畫載入失敗");
    }
  };
  const remove = async (plan: DegradedOperationPlan) => {
    if (
      !window.confirm(
        `確定刪除降級計畫「${plan.name}」？\n此操作不會解除正在執行的降級，也不會刪除歷史執行快照。`,
      )
    )
      return;
    try {
      await deleteDegradedOperationPlan(plan.id);
      onChanged();
      if (result?.items.length === 1 && page > 1) setPage((value) => value - 1);
      else load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刪除失敗");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#15161a] p-5 text-zinc-100">
      <div className="mb-6 flex shrink-0 flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-500/70 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/10"
        >
          <ArrowLeft className="size-4" />
          返回看即時
        </button>
        <h2 className="text-lg font-medium">計畫管理</h2>
        <button
          type="button"
          onClick={() => setDialog({ kind: "create" })}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500"
        >
          <Plus className="size-4" />
          新增計畫
        </button>
      </div>
      {error ? (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          <span>{error}</span>
          <button type="button" onClick={load} className="underline">
            重試
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-[#15161a] text-zinc-400">
            <tr className="border-b border-zinc-700">
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => changeSort("name")}
                  className="inline-flex items-center gap-1"
                >
                  降級計畫名稱{sortIcon("name")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => changeSort("level")}
                  className="inline-flex items-center gap-1"
                >
                  降級等級{sortIcon("level")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => changeSort("speed")}
                  className="inline-flex items-center gap-1"
                >
                  速限{sortIcon("speed")}
                </button>
              </th>
              <th className="w-28 px-4 py-3">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              result?.items.map((plan) => (
                <tr key={plan.id} className="border-b border-zinc-800">
                  <td className="px-4 py-4">{plan.name}</td>
                  <td className="px-4 py-4">Level {plan.level}</td>
                  <td className="px-4 py-4">{plan.speed_limit_kmh} km/h</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => void edit(plan.id)}
                        aria-label={`編輯 ${plan.name}`}
                        title="編輯"
                        className="text-zinc-300 hover:text-blue-400"
                      >
                        <Pencil className="size-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(plan)}
                        aria-label={`刪除 ${plan.name}`}
                        title="刪除"
                        className="text-zinc-300 hover:text-red-400"
                      >
                        <Trash2 className="size-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading ? (
          <div className="py-20 text-center text-sm text-zinc-500">
            載入計畫…
          </div>
        ) : !error && result?.items.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">
            目前沒有降級計畫
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex shrink-0 items-center justify-center gap-4 text-sm">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((value) => value - 1)}
          aria-label="上一頁"
          className="rounded p-1 disabled:text-zinc-700"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="rounded-lg border border-blue-500 px-3 py-1 text-blue-300">
          {page}
        </span>
        <button
          type="button"
          disabled={loading || page * PAGE_SIZE >= (result?.total ?? 0)}
          onClick={() => setPage((value) => value + 1)}
          aria-label="下一頁"
          className="rounded p-1 disabled:text-zinc-700"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      {dialog?.kind === "create" ? (
        <DegradedPlanDialog
          kind="create"
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await createDegradedOperationPlan(input);
            setDialog(null);
            changed();
          }}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <DegradedPlanDialog
          kind="edit"
          initial={draftFromPlan(dialog.plan)}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await updateDegradedOperationPlan(
              dialog.plan.id,
              input,
              dialog.plan.version,
            );
            setDialog(null);
            changed();
          }}
        />
      ) : null}
    </div>
  );
}
