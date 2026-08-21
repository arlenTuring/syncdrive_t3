import { useSyncExternalStore } from 'react';

export type PendingScheduleAdjust = {
  shiftId: string;
  shiftName: string;
  execDate: string;
  execTime: string;
  submittedBy: string;
  submittedAt: number;
};

const STORAGE_KEY = 'syncdrive_vtms_pending_schedule_adjust';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function parsePending(raw: string | null): PendingScheduleAdjust | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PendingScheduleAdjust>;
    if (!o.shiftId || !o.execDate || !o.execTime) return null;
    return {
      shiftId: String(o.shiftId),
      shiftName: String(o.shiftName ?? ''),
      execDate: String(o.execDate),
      execTime: String(o.execTime),
      submittedBy: String(o.submittedBy ?? ''),
      submittedAt: Number(o.submittedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function readPendingScheduleAdjust(): PendingScheduleAdjust | null {
  try {
    return parsePending(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writePendingScheduleAdjust(next: PendingScheduleAdjust | null) {
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

export function subscribePendingScheduleAdjust(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function usePendingScheduleAdjust(): [
  PendingScheduleAdjust | null,
  (next: PendingScheduleAdjust | null) => void,
] {
  const pending = useSyncExternalStore(
    subscribePendingScheduleAdjust,
    readPendingScheduleAdjust,
    () => null,
  );
  return [pending, writePendingScheduleAdjust];
}
