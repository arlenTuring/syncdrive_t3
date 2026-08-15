const ADMIN_MODE_STORAGE_KEY = 'syncdrive_vtms_admin_mode';

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
}
