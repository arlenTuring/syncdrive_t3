import { useSyncExternalStore } from 'react';

const ADMIN_MODE_STORAGE_KEY = 'syncdrive_vtms_admin_mode';

const listeners = new Set<() => void>();

/** 預設開啟管理員模式 */
export function readAdminModePreference(): boolean {
  try {
    const raw = window.localStorage.getItem(ADMIN_MODE_STORAGE_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function writeAdminModePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(ADMIN_MODE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

function subscribeAdminMode(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/** 在設定頁切換後，側欄等使用處立即更新 */
export function useAdminModePreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeAdminMode, readAdminModePreference, readAdminModePreference);
  return [enabled, writeAdminModePreference];
}
