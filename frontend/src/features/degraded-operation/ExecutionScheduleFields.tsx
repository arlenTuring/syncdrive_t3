import { Clock3 } from "lucide-react";
import type { ExecutionSchedule } from "./api";

export const immediateSchedule = (): ExecutionSchedule => ({
  schedule_mode: "immediate",
  time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei",
});

export function ExecutionScheduleFields({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionSchedule;
  onChange: (value: ExecutionSchedule) => void;
  disabled?: boolean;
}) {
  const scheduled = value.schedule_mode === "scheduled";
  return (
    <section className="rounded-2xl border border-zinc-700 p-4 text-sm text-zinc-200">
      <div className="flex flex-wrap items-center gap-3">
        <Clock3 className="size-5 text-zinc-400" />
        <span>執行時間</span>
        {!scheduled ? <span className="text-base">當下立即執行</span> : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange(
              scheduled
                ? immediateSchedule()
                : { ...value, schedule_mode: "scheduled", scheduled_time: "" },
            )
          }
          className="ml-auto text-blue-400 hover:text-blue-300"
        >
          {scheduled ? "取消調整／恢復" : "調整執行時間"}
        </button>
      </div>
      {scheduled ? (
        <label className="mt-4 block">
          <span className="sr-only">預約開始時間</span>
          <input
            type="time"
            required
            value={value.scheduled_time ?? ""}
            onChange={(event) =>
              onChange({ ...value, scheduled_time: event.target.value })
            }
            disabled={disabled}
            className="w-full rounded-xl bg-[#29303a] px-4 py-3 text-zinc-100 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="mt-2 block text-xs text-zinc-500">
            以營運時鐘當日為準；已過分鐘會由後端拒絕，不會自動排到隔日。
          </span>
        </label>
      ) : null}
    </section>
  );
}
