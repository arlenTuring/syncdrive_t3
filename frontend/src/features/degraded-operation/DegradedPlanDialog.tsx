import { Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  saveDegradedDraft,
  type DegradedOperationPlanInput,
  type ExecutionSchedule,
} from "./api";
import {
  DegradedPlanForm,
  emptyPlanDraft,
  planDraftPayload,
  type PlanDraft,
} from "./DegradedPlanForm";
import {
  ExecutionScheduleFields,
  immediateSchedule,
} from "./ExecutionScheduleFields";

type Kind = "create" | "edit" | "execute";
type Props = {
  kind: Kind;
  initial?: PlanDraft;
  onClose: () => void;
  onSubmit: (
    input: DegradedOperationPlanInput,
    schedule?: ExecutionSchedule,
  ) => Promise<void>;
};

const tooltip =
  "設定本次降級的名稱、等級與速限。選擇「停駛」時，速限為 0 km/h；選擇「自定義」可輸入速限。計畫等級不會自動改變速限。影響班次與運能損失預估將於後續提供。";

export function DegradedPlanDialog({
  kind,
  initial,
  onClose,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<PlanDraft>(
    () => initial ?? emptyPlanDraft(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [schedule, setSchedule] =
    useState<ExecutionSchedule>(immediateSchedule);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const payload = planDraftPayload(draft);
  const title =
    kind === "create" ? "新增計畫" : kind === "edit" ? "編輯計畫" : "執行降級";

  useEffect(() => () => returnFocus.current?.focus(), []);
  useEffect(() => {
    if (kind !== "execute") return;
    const timer = window.setTimeout(
      () =>
        void saveDegradedDraft("custom-execution", { draft, schedule }).catch(
          () => undefined,
        ),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [draft, kind, schedule]);

  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !saving) onClose();
    if (event.key !== "Tab") return;
    const nodes = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
      ) ?? []),
    ];
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!payload || saving) return;
    setSaving(true);
    setError(null);
    if (
      kind === "execute" &&
      schedule.schedule_mode === "scheduled" &&
      !schedule.scheduled_time
    ) {
      setSaving(false);
      setError("請選擇有效的執行時間");
      return;
    }
    try {
      await onSubmit(payload, kind === "execute" ? schedule : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失敗");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="degraded-dialog-title"
        onKeyDown={keyDown}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[680px] flex-col overflow-hidden rounded-3xl border border-zinc-700 bg-[#17181c] shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 px-6 py-5">
          <h2
            id="degraded-dialog-title"
            className="text-xl font-semibold text-zinc-100"
          >
            {title}
          </h2>
          {kind === "execute" ? (
            <span className="group relative">
              <button
                type="button"
                aria-label="執行降級說明"
                aria-describedby="degraded-tooltip"
                onClick={() => setTipOpen((open) => !open)}
                className="rounded-full text-zinc-400 hover:text-white focus:text-white"
              >
                <Info className="size-5" />
              </button>
              <span
                id="degraded-tooltip"
                role="tooltip"
                className={`${tipOpen ? "block" : "hidden group-hover:block group-focus-within:block"} absolute left-0 top-7 z-10 w-72 rounded-lg border border-zinc-600 bg-zinc-900 p-3 text-xs leading-5 text-zinc-200 shadow-xl`}
              >
                {tooltip}
              </span>
            </span>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="關閉"
          >
            <X className="size-6" />
          </button>
        </div>
        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-5">
            <section
              className={
                kind === "execute"
                  ? "rounded-2xl border border-zinc-700 p-4"
                  : ""
              }
            >
              {kind === "execute" ? (
                <h3 className="mb-4 text-lg text-zinc-100">降級設定</h3>
              ) : null}
              <DegradedPlanForm
                value={draft}
                onChange={setDraft}
                disabled={saving}
              />
            </section>
            {kind === "execute" ? (
              <ExecutionScheduleFields
                value={schedule}
                onChange={setSchedule}
                disabled={saving}
              />
            ) : null}
            {kind === "execute" ? (
              <section className="rounded-2xl border border-zinc-700 p-4">
                <h3 className="mb-4 text-lg text-zinc-100">營運影響預估</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#292f38] p-3 text-center text-zinc-400">
                    <span className="block text-sm">影響班次</span>
                    <b className="text-xl font-normal text-zinc-100">—</b>
                  </div>
                  <div className="rounded-xl bg-[#292f38] p-3 text-center text-zinc-400">
                    <span className="block text-sm">運能損失</span>
                    <b className="text-xl font-normal text-zinc-100">— %</b>
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-zinc-500">
                  影響預估尚未提供
                </p>
              </section>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-3 border-t border-zinc-700 px-6 py-4">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-xl px-5 py-2.5 text-zinc-200 hover:bg-white/5"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={
                !payload ||
                saving ||
                (kind === "execute" &&
                  schedule.schedule_mode === "scheduled" &&
                  !schedule.scheduled_time)
              }
              className={`rounded-xl px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500 ${kind === "execute" ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"}`}
            >
              {saving
                ? "處理中…"
                : kind === "create"
                  ? "新增"
                  : kind === "edit"
                    ? "儲存"
                    : "執行降級"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
