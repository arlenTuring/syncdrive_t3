import { Clock, Clock3 } from "lucide-react";
import { useRef, useState } from "react";
import { AnchoredPopover } from "../../lib/AnchoredPopover";
import { TimePickerPanel } from "../time-templates/components/TimeOfDayPicker";
import type { ExecutionSchedule } from "./api";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:MM" → 時、分；不合法就 null（面板從 00:00 開始） */
function parseHm(value: string | undefined): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/**
 * 預約時間：系統的深色時間面板（跟時段模板同一個 TimePickerPanel），24 小時制、只選時與分。
 * 送出的格式跟原本的 <input type="time"> 一樣是 "HH:MM"，後端驗證與營運時鐘語意不變。
 * 面板沒有「此刻」：預約以營運時鐘為準，不能拿瀏覽器的時間。
 */
function ScheduledTimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const openPanel = () => {
    const parsed = parseHm(value);
    setHour(parsed?.hour ?? 0);
    setMinute(parsed?.minute ?? 0);
    setOpen(true);
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="預約開始時間"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`flex w-full items-center rounded-xl bg-[#29303a] px-4 py-3 text-left tabular-nums outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 ${
          open ? "ring-1 ring-blue-500" : ""
        } ${value ? "text-zinc-100" : "text-zinc-400"}`}
      >
        {value || "--:--"}
        <Clock className="ml-auto size-4 text-zinc-400" aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        align="start"
        offset={8}
        role="dialog"
        ariaLabel="選擇預約時間"
      >
        <TimePickerPanel
          hour={hour}
          minute={minute}
          second={0}
          showSeconds={false}
          onHourChange={setHour}
          onMinuteChange={setMinute}
          onConfirm={() => {
            onChange(`${pad2(hour)}:${pad2(minute)}`);
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      </AnchoredPopover>
    </>
  );
}

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
        <div className="mt-4 block">
          <ScheduledTimeField
            value={value.scheduled_time ?? ""}
            onChange={(scheduled_time) => onChange({ ...value, scheduled_time })}
            disabled={disabled}
          />
          <span className="mt-2 block text-xs text-zinc-500">
            以營運時鐘當日為準；已過分鐘會由後端拒絕，不會自動排到隔日。
          </span>
        </div>
      ) : null}
    </section>
  );
}
