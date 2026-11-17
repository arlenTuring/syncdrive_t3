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
import { systemConfirm } from '../../lib/systemDialog';
import { Button, IconButton } from '../../components/ui';

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
      !(await systemConfirm(
        `確定刪除降級計畫「${plan.name}」？\n此操作不會解除正在執行的降級，也不會刪除歷史執行快照。`,
      { tone: 'danger' },))
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
    <div className="flex h-full min-h-0 flex-col bg-[#15161a] p-5 text-text-primary">
      <div className="mb-6 flex shrink-0 flex-wrap items-center gap-4">
        <Button variant="outlined" leadingIcon={<ArrowLeft />} onPress={onBack}>返回看即時</Button>
        <h2 className="text-headline-5">計畫管理</h2>
        <Button className="ml-auto" leadingIcon={<Plus />} onPress={() => setDialog({ kind: "create" })}>新增計畫</Button>
      </div>
      {error ? (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between rounded-lg border border-border-danger-light bg-status-error-light px-3 py-2 text-body-s text-status-error-emphasis"
        >
          <span>{error}</span>
          <Button hierarchy="subordinate" variant="text" onPress={load}>重試</Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-body-s">
          <thead className="sticky top-0 bg-[#15161a] text-text-tertiary">
            <tr className="border-b border-border-quaternary">
              <th className="px-4 py-3">
                <Button hierarchy="subordinate" variant="text" onPress={() => changeSort("name")}>降級計畫名稱{sortIcon("name")}</Button>
              </th>
              <th className="px-4 py-3">
                <Button hierarchy="subordinate" variant="text" onPress={() => changeSort("level")}>降級等級{sortIcon("level")}</Button>
              </th>
              <th className="px-4 py-3">
                <Button hierarchy="subordinate" variant="text" onPress={() => changeSort("speed")}>速限{sortIcon("speed")}</Button>
              </th>
              <th className="w-28 px-4 py-3">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              result?.items.map((plan) => (
                <tr key={plan.id} className="border-b border-border-quaternary">
                  <td className="px-4 py-4">{plan.name}</td>
                  <td className="px-4 py-4">Level {plan.level}</td>
                  <td className="px-4 py-4">{plan.speed_limit_kmh} km/h</td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-3">
                      <IconButton hierarchy="subordinate" variant="standard" onPress={() => void edit(plan.id)} label={`編輯 ${plan.name}`} title="編輯" icon={<Pencil />} />
                      <IconButton hierarchy="danger" variant="standard" onPress={() => void remove(plan)} label={`刪除 ${plan.name}`} title="刪除" icon={<Trash2 />} />
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading ? (
          <div className="py-20 text-center text-body-s text-text-quaternary">
            載入計畫…
          </div>
        ) : !error && result?.items.length === 0 ? (
          <div className="py-20 text-center text-body-s text-text-quaternary">
            目前沒有降級計畫
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex shrink-0 items-center justify-center gap-4 text-body-s">
        <IconButton hierarchy="subordinate" variant="standard" disabled={page <= 1 || loading} onPress={() => setPage((value) => value - 1)} label="上一頁" icon={<ChevronLeft />} />
        <span className="rounded-lg border border-border-theme px-3 py-1 text-text-theme">
          {page}
        </span>
        <IconButton hierarchy="subordinate" variant="standard" disabled={loading || page * PAGE_SIZE >= (result?.total ?? 0)} onPress={() => setPage((value) => value + 1)} label="下一頁" icon={<ChevronRight />} />
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
