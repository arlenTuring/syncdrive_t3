import { useSyncExternalStore } from 'react';

/**
 * 「模組新增頁面」模式：開啟後側欄每個模組旁才出現＋號，可替模組加入儀表板子頁面。
 * 平常用不到、又佔側欄空間，所以預設關閉；開關在 系統基礎模組 → 進階管理模式 → 儀表介面管理。
 */
const MODULE_ADD_MODE_STORAGE_KEY = 'syncdrive_vtms_module_add_mode';

const listeners = new Set<() => void>();

export function readModuleAddModePreference(): boolean {
  try {
    const raw = window.localStorage.getItem(MODULE_ADD_MODE_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export function writeModuleAddModePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(MODULE_ADD_MODE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 寫不進去時只在這次畫面生效
  }
  listeners.forEach((fn) => fn());
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/** 在儀表介面管理切換後，側欄的＋號立即出現或消失 */
export function useModuleAddModePreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readModuleAddModePreference, () => false);
  return [enabled, writeModuleAddModePreference];
}
