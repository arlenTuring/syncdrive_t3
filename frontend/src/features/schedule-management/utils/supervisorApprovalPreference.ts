import { useSyncExternalStore } from 'react';

const SUPERVISOR_APPROVAL_STORAGE_KEY = 'syncdrive_vtms_supervisor_approval';

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

/** 預設開啟主管簽核（新派遣先進入待核准） */
export function readSupervisorApprovalPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(SUPERVISOR_APPROVAL_STORAGE_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function writeSupervisorApprovalPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(SUPERVISOR_APPROVAL_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  emit();
}

export function subscribeSupervisorApproval(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useSupervisorApprovalPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribeSupervisorApproval,
    readSupervisorApprovalPreference,
    readSupervisorApprovalPreference,
  );
  return [enabled, writeSupervisorApprovalPreference];
}
