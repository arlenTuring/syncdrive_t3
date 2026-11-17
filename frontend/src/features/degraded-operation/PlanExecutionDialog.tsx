import { Gauge, Info } from "lucide-react";
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
import { Button, Dialog } from '../../components/ui';

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
    <Dialog
      padded={false}
      busy={saving}
      title={<span className="inline-flex items-center gap-2">執行降級<Info className="size-5 text-text-tertiary" aria-hidden /></span>}
      onClose={() => onClose()}
      widthClassName="w-full max-w-[680px]"
    >
        <div className="space-y-5 px-6 pb-6">
          <section className="rounded-2xl border border-border-quaternary p-4">
            <h3 className="mb-4 text-headline-5">{plan.name}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-secondary p-3 text-center text-text-tertiary">
                <span className="block text-body-s">等級</span>
                <b className="text-headline-5 font-normal text-yellow-300">
                  Level {plan.level}
                </b>
              </div>
              <div className="rounded-xl bg-surface-secondary p-3 text-center text-text-tertiary">
                <span className="block text-body-s">限速</span>
                <b className="inline-flex items-center gap-2 text-headline-4 font-normal text-text-primary">
                  <Gauge className="size-4 text-text-theme" />
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
          <section className="rounded-2xl border border-border-quaternary p-4">
            <h3 className="mb-4 text-headline-5">營運影響預估</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-secondary p-3 text-center text-text-tertiary">
                影響班次
                <b className="block text-headline-4 font-normal text-text-primary">—</b>
              </div>
              <div className="rounded-xl bg-surface-secondary p-3 text-center text-text-tertiary">
                運能損失
                <b className="block text-headline-4 font-normal text-text-primary">— %</b>
              </div>
            </div>
            <p className="mt-2 text-center text-body-xs text-text-quaternary">
              影響預估尚未提供
            </p>
          </section>
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-status-error-light p-3 text-body-s text-status-error-emphasis"
            >
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4">
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose} disabled={saving}>取消</Button>
          <Button hierarchy="danger" onPress={() => void submit()} disabled={!valid || saving}>{saving ? "處理中…" : "執行降級"}</Button>
        </footer>
      </Dialog>
  );
}
