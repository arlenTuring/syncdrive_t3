import type { ShiftRecordListItem } from '../shift-records/types';

export type DwellConflict = {
  tripCode: string;
  windowLabel: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatMinutes(total: number): string {
  const n = ((total % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`;
}

function hmToMinutes(raw: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function tripStartMinutes(item: ShiftRecordListItem): number | null {
  // 只看訂單的計畫發車時刻；沒有就不列入，不從班次代號推
  return hmToMinutes(item.depart_time);
}

function tripEndMinutes(item: ShiftRecordListItem, start: number): number {
  return hmToMinutes(item.end_time) ?? start + 6;
}

export function resolveDwellConflict(
  items: ShiftRecordListItem[],
  now = new Date(),
): DwellConflict | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const ranked = items
    .filter((item) => item.execution_status !== 'completed')
    .map((item) => {
      const start = tripStartMinutes(item);
      if (start == null) return null;
      return {
        item,
        start,
        end: tripEndMinutes(item, start),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.start - b.start);

  if (ranked.length === 0) return null;

  const current =
    ranked.find((row) => row.item.execution_status === 'running' || row.item.execution_status === 'delayed')
    ?? ranked.find((row) => row.start <= nowMin && nowMin < row.end)
    ?? ranked.find((row) => row.start >= nowMin)
    ?? ranked[0];

  const index = ranked.findIndex((row) => row.item.order_id === current.item.order_id);
  const next = index >= 0 ? ranked[index + 1] : undefined;
  if (!next) return null;

  const windowLabel = `${formatMinutes(next.start)}-${formatMinutes(next.end)}`;

  return {
    tripCode: next.item.trip_code,
    windowLabel,
  };
}
