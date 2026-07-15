import { ChevronDown } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import {
  TASK_TYPE_OPTIONS,
  findScheduleTaskOverlap,
  formatMinutesToTime,
  isRangeWithinActiveIntervals,
  parseTimeToMinutes,
  type MinuteRange,
  type ScheduleTask,
  type TaskTypeKey,
} from '../types/editor';
import { TimeRangeField } from './TimeRangeField';

const FIELD_CLASS =
  'h-[34px] w-full min-w-0 rounded-lg bg-zinc-900/80 px-3 text-sm leading-[18px] tracking-[0.5px] text-[#D1D5DC] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/40';

const LABEL_CLASS = 'shrink-0 text-sm leading-5 text-zinc-400';

export type TaskSettingsFormHandle = {
  reset: () => void;
};

type TaskSettingsFormProps = {
  formId?: string;
  task: ScheduleTask;
  tasks: ScheduleTask[];
  activeIntervalRanges: MinuteRange[];
  rowCount: number;
  onConfirm: (task: ScheduleTask) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCanConfirmChange?: (canConfirm: boolean) => void;
};

function InactiveZoneWarning() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-500/5 px-3 py-2 text-xs text-red-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="mt-0.5 size-4 shrink-0"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <span>
        時間超出營運時段：任務僅能排定在 Step 1 已設定的營運時段內，請調整開始或結束時間。
      </span>
    </div>
  );
}

function OverlapWarning() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-500/5 px-3 py-2 text-xs text-red-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="mt-0.5 size-4 shrink-0"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <span>
        任務重疊：此任務的時間範圍與同列其他任務重疊，請調整開始或結束時間後再確認。
      </span>
    </div>
  );
}

export const TaskSettingsForm = forwardRef<TaskSettingsFormHandle, TaskSettingsFormProps>(
  function TaskSettingsForm(
    { formId, task, tasks, activeIntervalRanges, rowCount, onConfirm, onDirtyChange, onCanConfirmChange },
    ref,
  ) {
    const [taskType, setTaskType] = useState<TaskTypeKey>(task.taskType);
    const [rowIndex, setRowIndex] = useState(task.rowIndex);
    const [startTime, setStartTime] = useState(formatMinutesToTime(task.startMinute));
    const [endTime, setEndTime] = useState(
      formatMinutesToTime(task.startMinute + task.durationMinutes),
    );
    const [error, setError] = useState<string | null>(null);

    const syncFromTask = () => {
      setTaskType(task.taskType);
      setRowIndex(task.rowIndex);
      setStartTime(formatMinutesToTime(task.startMinute));
      setEndTime(formatMinutesToTime(task.startMinute + task.durationMinutes));
      setError(null);
    };

    useEffect(() => {
      syncFromTask();
    }, [
      task.id,
      task.taskType,
      task.rowIndex,
      task.startMinute,
      task.durationMinutes,
    ]);

    useImperativeHandle(ref, () => ({
      reset: syncFromTask,
    }));

    const startMinute = parseTimeToMinutes(startTime);
    const endMinute = parseTimeToMinutes(endTime);
    const hasValidTime =
      startMinute != null && endMinute != null && endMinute > startMinute;
    const hasValidRow = rowIndex >= 1 && rowIndex <= rowCount;
    const overlaps =
      hasValidTime
      && findScheduleTaskOverlap(
        task.id,
        rowIndex,
        startMinute!,
        endMinute!,
        tasks,
      );
    const outsideActive =
      hasValidTime
      && !isRangeWithinActiveIntervals(startMinute!, endMinute!, activeIntervalRanges);

    const isDirty = useMemo(() => {
      if (taskType !== task.taskType) return true;
      if (rowIndex !== task.rowIndex) return true;
      if (startMinute !== task.startMinute) return true;
      if (hasValidTime && endMinute! - startMinute! !== task.durationMinutes) return true;
      return false;
    }, [
      taskType,
      task.taskType,
      rowIndex,
      task.rowIndex,
      startMinute,
      task.startMinute,
      endMinute,
      task.durationMinutes,
      hasValidTime,
    ]);

    const canConfirm = isDirty && hasValidTime && hasValidRow && !overlaps && !outsideActive;

    useEffect(() => {
      onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    useEffect(() => {
      onCanConfirmChange?.(canConfirm);
    }, [canConfirm, onCanConfirmChange]);

    const submit = () => {
      if (!canConfirm) return;
      const start = startMinute!;
      const end = endMinute!;
      const option = TASK_TYPE_OPTIONS.find((t) => t.key === taskType);
      onConfirm({
        ...task,
        taskType,
        rowIndex,
        startMinute: start,
        durationMinutes: end - start,
        label: option?.label ?? task.label,
      });
      setError(null);
    };

    return (
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-4">
          <span className={LABEL_CLASS}>群組編號</span>
          <input
            type="number"
            min={1}
            max={rowCount}
            value={rowIndex}
            onChange={(e) => setRowIndex(Number(e.target.value))}
            className={`${FIELD_CLASS} tabular-nums`}
          />

          <span className={LABEL_CLASS}>任務類型</span>
          <div className="relative min-w-0">
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskTypeKey)}
              className={`${FIELD_CLASS} appearance-none pr-9`}
            >
              {TASK_TYPE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key} className="bg-zinc-900">
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          </div>

          <span className={`${LABEL_CLASS} self-center`}>時間區段</span>
          <div
            className={
              isDirty && (overlaps || outsideActive)
                ? '[&>div>div]:ring-1 [&>div>div]:ring-red-400/60'
                : ''
            }
          >
            <TimeRangeField
              startTime={startTime}
              endTime={endTime}
              onStartChange={setStartTime}
              onEndChange={setEndTime}
            />
          </div>
        </div>

        {isDirty && outsideActive && <InactiveZoneWarning />}
        {isDirty && overlaps && !outsideActive && <OverlapWarning />}

        {error && !overlaps && !outsideActive && <p className="text-xs text-red-400">{error}</p>}
      </form>
    );
  },
);
