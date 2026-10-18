import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { Checkbox } from '../media-groups/widgets';
import type { Weekly } from './api';
import { dayTimeErrors, sortWeekly, WEEKDAYS, weekdayLabel } from './draft';

type Row = { key: number; value: string };
let nextKey = 1;

/**
 * 「設定時間」：週一到週日勾選，每天可新增、修改、刪除多個時間。
 * 在這裡的修改只存在這個對話框；取消全部丟掉，確定才回寫主表單（依時間排序）。
 */
export function WeeklyTimesDialog({ value, onClose, onConfirm }: { value: Weekly; onClose: () => void; onConfirm: (weekly: Weekly) => void }) {
  const [days, setDays] = useState<Record<string, Row[] | undefined>>(() =>
    Object.fromEntries(WEEKDAYS.filter((day) => value[day]?.length).map((day) => [day, value[day].map((time) => ({ key: nextKey++, value: time }))])),
  );
  const [touched, setTouched] = useState(false);
  const enabled = WEEKDAYS.filter((day) => days[day]);
  const errors = Object.fromEntries(enabled.map((day) => [day, dayTimeErrors(days[day]!.map((row) => row.value))]));
  const emptyDay = enabled.find((day) => !days[day]!.length);
  const hasError = !enabled.length || Boolean(emptyDay) || enabled.some((day) => errors[day].some(Boolean));

  const setDay = (day: string, rows: Row[] | undefined) => setDays((current) => ({ ...current, [day]: rows }));
  const confirm = () => {
    setTouched(true);
    if (hasError) return;
    onConfirm(sortWeekly(Object.fromEntries(enabled.map((day) => [day, days[day]!.map((row) => row.value)]))));
  };

  return (
    <Dialog
      title="設定時間"
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>取消</GhostButton>
          <PrimaryButton onClick={confirm} disabled={touched && hasError}>確定</PrimaryButton>
        </>
      }
    >
      <p className="mb-4 text-sm text-zinc-400">勾選播放的星期，每天至少一個時間；同一天的時間不可重複，確定後依時間排序。</p>
      <div className="space-y-3">
        {WEEKDAYS.map((day) => {
          const rows = days[day];
          return (
            <div key={day} className="rounded-xl bg-[#232730] px-4 py-3">
              <div className="flex items-center gap-3">
                <Checkbox checked={Boolean(rows)} onChange={() => setDay(day, rows ? undefined : [{ key: nextKey++, value: '' }])} label={`${weekdayLabel(day)}播放`} />
                <span className="w-12 text-zinc-100">{weekdayLabel(day)}</span>
                {rows ? (
                  <button type="button" onClick={() => setDay(day, [...rows, { key: nextKey++, value: '' }])} className="ml-auto inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300" aria-label={`${weekdayLabel(day)}新增時間`}>
                    <Plus className="size-4" />
                    新增時間
                  </button>
                ) : null}
              </div>
              {rows ? (
                <div className="mt-3 flex flex-wrap gap-3 pl-10">
                  {rows.map((row, index) => {
                    const error = errors[day][index];
                    const show = error && (touched || row.value);
                    return (
                      <div key={row.key} className="flex flex-col">
                        <div className={`flex items-center gap-1 rounded-lg border px-2 ${show ? 'border-red-500' : 'border-zinc-600'}`}>
                          <SiteDateTimeInput
                            type="time"
                            step={60}
                            value={row.value}
                            aria-label={`${weekdayLabel(day)}第 ${index + 1} 個時間`}
                            onChange={(event) => setDay(day, rows.map((item) => (item.key === row.key ? { ...item, value: event.target.value.slice(0, 5) } : item)))}
                            className="h-9 w-24 text-zinc-100"
                          />
                          <button type="button" onClick={() => setDay(day, rows.filter((item) => item.key !== row.key))} aria-label={`刪除${weekdayLabel(day)}第 ${index + 1} 個時間`} className="rounded p-1 text-zinc-400 hover:text-red-400">
                            <X className="size-4" />
                          </button>
                        </div>
                        {show ? <span className="mt-1 text-xs text-red-400" role="alert">{error}</span> : null}
                      </div>
                    );
                  })}
                  {!rows.length ? <span className="text-sm text-red-400">{touched ? '這天至少要有一個時間' : '尚未新增時間'}</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {touched && !enabled.length ? <ErrorLine text="請至少選擇一個星期" /> : null}
    </Dialog>
  );
}
