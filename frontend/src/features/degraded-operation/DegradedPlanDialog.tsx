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
import { Button, Dialog, IconButton } from '../../components/ui';

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
    <Dialog headerless padded={false} title={title} busy={saving} onClose={() => onClose()} widthClassName="w-full max-w-[680px]" heightClassName="max-h-[calc(100vh-2rem)]">
        <div className="flex shrink-0 items-center gap-2 px-6 py-5">
          <h2
            id="degraded-dialog-title"
            className="text-headline-4 text-text-primary"
          >
            {title}
          </h2>
          {kind === "execute" ? (
            <span className="group relative">
              <IconButton hierarchy="subordinate" variant="standard" label="執行降級說明" aria-describedby="degraded-tooltip" onPress={() => setTipOpen((open) => !open)} icon={<Info />} />
              <span
                id="degraded-tooltip"
                role="tooltip"
                className={`${tipOpen ? "block" : "hidden group-hover:block group-focus-within:block"} absolute left-0 top-7 z-10 w-72 rounded-lg border border-border-tertiary bg-surface-primary p-3 text-body-xs text-text-primary shadow-xl`}
              >
                {tooltip}
              </span>
            </span>
          ) : null}
          <IconButton hierarchy="subordinate" variant="standard" className="ml-auto" disabled={saving} onPress={onClose} label="關閉" icon={<X />} />
        </div>
        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-5">
            <section
              className={
                kind === "execute"
                  ? "rounded-2xl border border-border-quaternary p-4"
                  : ""
              }
            >
              {kind === "execute" ? (
                <h3 className="mb-4 text-headline-5 text-text-primary">降級設定</h3>
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
              <section className="rounded-2xl border border-border-quaternary p-4">
                <h3 className="mb-4 text-headline-5 text-text-primary">營運影響預估</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#292f38] p-3 text-center text-text-tertiary">
                    <span className="block text-body-s">影響班次</span>
                    <b className="text-headline-4 font-normal text-text-primary">—</b>
                  </div>
                  <div className="rounded-xl bg-[#292f38] p-3 text-center text-text-tertiary">
                    <span className="block text-body-s">運能損失</span>
                    <b className="text-headline-4 font-normal text-text-primary">— %</b>
                  </div>
                </div>
                <p className="mt-2 text-center text-body-xs text-text-quaternary">
                  影響預估尚未提供
                </p>
              </section>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-border-danger-light bg-status-error-light px-3 py-2 text-body-s text-status-error-emphasis"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-3 border-t border-border-quaternary px-6 py-4">
            <Button hierarchy="subordinate" variant="tonal" disabled={saving} onPress={onClose}>取消</Button>
            <button
              type="submit"
              disabled={
                !payload ||
                saving ||
                (kind === "execute" &&
                  schedule.schedule_mode === "scheduled" &&
                  !schedule.scheduled_time)
              }
              className={`rounded-xl px-5 py-2.5 font-medium text-text-primary disabled:cursor-not-allowed disabled:bg-link-standard-hover disabled:text-text-quaternary ${kind === "execute" ? "bg-red-600 hover:bg-status-error" : "bg-blue-600 hover:bg-blue-500"}`}
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
      </Dialog>
  );
}
