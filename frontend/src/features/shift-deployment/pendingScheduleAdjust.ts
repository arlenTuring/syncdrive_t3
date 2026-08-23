import { useSyncExternalStore } from 'react';
import { getDataSourceById } from '../dashboard/store/useDataSourceStore';
import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

/**
 * 班表調整的待核准請求（TP13C §1.4 營運排程 · schedule_adjust_requests）。
 *
 * <strong>為什麼要搬離 localStorage。</strong>這一筆原本只存在瀏覽器
 * <code>syncdrive_vtms_pending_schedule_adjust</code>——而<strong>送出申請的排班人員
 * 與核准的主管通常不是同一台電腦</strong>，請求根本傳不到主管那裡；核准或駁回也沒有
 * 留下任何可稽核的紀錄。這是簽核流程能不能成立的前提，不是效能最佳化。
 *
 * <strong>介面刻意維持原樣。</strong>{@link readPendingScheduleAdjust}、
 * {@link writePendingScheduleAdjust}、{@link usePendingScheduleAdjust} 的簽名與同步
 * 語意都沒變，呼叫端（班表部署對話框）不必改。差別只在背後多了一層後端同步，而
 * localStorage 從「儲存位置」降格為「離線快取」：後端不可用時畫面照常運作。
 */

export type PendingScheduleAdjust = {
  shiftId: string;
  shiftName: string;
  execDate: string;
  execTime: string;
  submittedBy: string;
  submittedAt: number;
};

/** 請求結案時記的狀態；與後端 ScheduleAdjustStatus 同名 */
export type ScheduleAdjustResolution = 'APPROVED' | 'REJECTED' | 'APPLIED' | 'CANCELLED';

const STORAGE_KEY = 'syncdrive_vtms_pending_schedule_adjust';
const ENDPOINT = 'syncdrive-api/schedule-adjust';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function backendUrl(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl);
}

function parsePending(raw: string | null): PendingScheduleAdjust | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PendingScheduleAdjust>;
    return normalizePending(o);
  } catch {
    return null;
  }
}

function normalizePending(o: Partial<PendingScheduleAdjust> | null): PendingScheduleAdjust | null {
  if (!o || !o.shiftId || !o.execDate || !o.execTime) return null;
  return {
    shiftId: String(o.shiftId),
    shiftName: String(o.shiftName ?? ''),
    execDate: String(o.execDate),
    execTime: String(o.execTime),
    submittedBy: String(o.submittedBy ?? ''),
    submittedAt: Number(o.submittedAt) || Date.now(),
  };
}

function writeCache(next: PendingScheduleAdjust | null) {
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota
  }
}

/**
 * 同步讀取——回傳的是快取。
 *
 * <code>useSyncExternalStore</code> 的 getSnapshot 必須是同步且穩定的，不能在裡面
 * 打後端。所以真相由 {@link refreshPendingScheduleAdjust} 定期拉回來寫進快取，
 * 這裡只負責把快取交出去。
 */
export function readPendingScheduleAdjust(): PendingScheduleAdjust | null {
  try {
    return parsePending(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 從後端拉回目前待核准的那一筆，寫入快取並通知訂閱者 */
export async function refreshPendingScheduleAdjust(): Promise<PendingScheduleAdjust | null> {
  try {
    const res = await fetch(`${backendUrl()}/${ENDPOINT}/pending`);
    if (!res.ok) return readPendingScheduleAdjust();
    const row = (await res.json()) as Partial<PendingScheduleAdjust> | null;
    const next = normalizePending(row);
    writeCache(next);
    emit();
    return next;
  } catch {
    // 後端不可用：沿用快取
    return readPendingScheduleAdjust();
  }
}

/**
 * 送出申請（傳物件）或把目前待核准那一筆結案（傳 null）。
 *
 * <strong>傳 null 時預設記為「取消」。</strong>既有呼叫端在「部署完成」與「駁回」
 * 兩條路徑上都是呼叫 <code>writePendingScheduleAdjust(null)</code>，從這裡分不出來。
 * 分不出來時寧可記下「這筆不再待核准」這個事實，也不要捏造一個沒發生過的核准或
 * 駁回——稽核紀錄寫錯比沒寫更糟。知道結果的呼叫端請改用
 * {@link resolvePendingScheduleAdjust}。
 */
export function writePendingScheduleAdjust(next: PendingScheduleAdjust | null) {
  writeCache(next);
  emit();
  if (next) {
    void fetch(`${backendUrl()}/${ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {
      /* 後端暫時不可用：快取已寫入，畫面照常運作 */
    });
    return;
  }
  void resolvePendingScheduleAdjust('CANCELLED');
}

/** 明確帶結果的結案：部署完成記 APPLIED、主管駁回記 REJECTED */
export async function resolvePendingScheduleAdjust(
  status: ScheduleAdjustResolution,
  reviewedBy?: string,
  reviewNote?: string,
): Promise<void> {
  writeCache(null);
  emit();
  try {
    await fetch(`${backendUrl()}/${ENDPOINT}/pending/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewedBy, reviewNote }),
    });
  } catch {
    /* 後端暫時不可用：快取已清掉，下一次 refresh 會以後端為準 */
  }
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
