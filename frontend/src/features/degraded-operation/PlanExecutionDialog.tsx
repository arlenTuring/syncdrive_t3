import { Gauge, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  saveDegradedDraft,
  type DegradedOperationPlan,
  type ExecutionSchedule,
} from "./api";
import {
  ExecutionScheduleFields,
  immediateSchedule,
} from "./ExecutionScheduleFields";

export function PlanExecutionDialog({
  plan,
  onClose,
  onSubmit,
}: {
  plan: DegradedOperationPlan;
  onClose: () => void;
  onSubmit: (schedule: ExecutionSchedule) => Promise<void>;
}) {
  const [schedule, setSchedule] = useState(immediateSchedule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document
      .querySelector<HTMLElement>("[data-plan-execute-dialog] button")
      ?.focus();
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void saveDegradedDraft("plan-execution", {
          source_plan_id: plan.id,
          schedule,
        }).catch(() => undefined),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [plan.id, schedule]);
  const valid =
    schedule.schedule_mode === "immediate" || Boolean(schedule.scheduled_time);
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(schedule);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "執行失敗");
      setSaving(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        data-plan-execute-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-execute-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) onClose();
        }}
        className="w-full max-w-[680px] rounded-3xl border border-zinc-700 bg-[#17181c] shadow-2xl"
      >
        <header className="flex items-center gap-2 px-6 py-5">
          <h2 id="plan-execute-title" className="text-xl font-semibold">
            執行降級
          </h2>
          <Info className="size-5 text-zinc-400" />
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="ml-auto rounded-lg p-1 text-zinc-400 hover:text-white"
            aria-label="關閉"
          >
            <X className="size-6" />
          </button>
        </header>
        <div className="space-y-5 px-6 pb-6">
          <section className="rounded-2xl border border-zinc-700 p-4">
            <h3 className="mb-4 text-lg">{plan.name}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#29303a] p-3 text-center text-zinc-400">
                <span className="block text-sm">等級</span>
                <b className="text-lg font-normal text-yellow-300">
                  Level {plan.level}
                </b>
              </div>
              <div className="rounded-xl bg-[#29303a] p-3 text-center text-zinc-400">
                <span className="block text-sm">限速</span>
                <b className="inline-flex items-center gap-2 text-xl font-normal text-zinc-100">
                  <Gauge className="size-4 text-blue-400" />
                  {plan.speed_limit_kmh} <small>km/h</small>
                </b>
              </div>
            </div>
          </section>
          <ExecutionScheduleFields
            value={schedule}
            onChange={setSchedule}
            disabled={saving}
          />
          <section className="rounded-2xl border border-zinc-700 p-4">
            <h3 className="mb-4 text-lg">營運影響預估</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#29303a] p-3 text-center text-zinc-400">
                影響班次
                <b className="block text-xl font-normal text-white">—</b>
              </div>
              <div className="rounded-xl bg-[#29303a] p-3 text-center text-zinc-400">
                運能損失
                <b className="block text-xl font-normal text-white">— %</b>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-zinc-500">
              影響預估尚未提供
            </p>
          </section>
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200"
            >
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-zinc-700 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-5 py-2.5 hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving}
            className="rounded-xl bg-red-600 px-5 py-2.5 font-medium text-white hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {saving ? "處理中…" : "執行降級"}
          </button>
        </footer>
      </div>
    </div>
  );
}
