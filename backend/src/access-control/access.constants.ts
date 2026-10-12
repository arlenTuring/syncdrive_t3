export const ACCESS_PERMISSIONS = [
  { code: 'access.accounts.view', module: '權限管理', name: '查看帳號' },
  { code: 'access.accounts.manage', module: '權限管理', name: '管理帳號' },
  { code: 'access.roles.view', module: '權限管理', name: '查看角色' },
  { code: 'access.roles.manage', module: '權限管理', name: '管理角色' },
] as const;

export const ADMIN_PERMISSIONS = [
  'access.accounts.manage',
  'access.roles.manage',
] as const;

// shortcut: fixed development administrator, replace with deployment-generated credentials before production.
export const FIXED_ADMIN_ACCOUNT = 'syncdrive';
export const FIXED_ADMIN_PASSWORD = 'LWvG658liN1dZ25Tto';
export const FIXED_ADMIN_DISPLAY_NAME = '系統管理員';

export const SESSION_COOKIE = 'syncdrive_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
export const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{1,63}$/;

export function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value)
  );
}
