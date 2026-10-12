import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

const BASE = '/syncdrive-api/access-control';
let csrfToken = '';

export type AuthUser = {
  id: string;
  account_name: string;
  display_name: string;
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
};
export type RoleSummary = { id: string; code: string; name: string };
export type AccountRow = { id: string; account_name: string; display_name: string; status: string; roles: RoleSummary[]; created_at: number; updated_at: number };
export type PermissionRow = { id: string; code: string; module: string; name: string; description: string | null };
export type RoleRow = { id: string; role_code: string; display_name: string; description: string; is_system: boolean; user_count: number; permissions: PermissionRow[]; created_at: number; updated_at: number };
export type CatalogPermission = { id: string; code: string; action: string; name: string; requires?: string; grantable: boolean; connected: boolean };
export type CatalogModule = { key: string; name: string; pages: Array<{ key: string; name: string; permissions: CatalogPermission[] }> };
export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const mutating = init.method && !['GET', 'HEAD'].includes(init.method);
  const response = await fetch(`${resolveBrowserApiBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(mutating && csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('、') : body?.message;
    throw new Error(message || `API ${response.status}`);
  }
  return body as T;
}

export async function fetchMe() {
  const result = await request<{ authenticated: boolean; user: AuthUser | null; csrf_token?: string }>('/syncdrive-api/auth/me');
  csrfToken = result.csrf_token ?? '';
  return result;
}
export async function login(account_name: string, password: string) {
  const result = await request<{ user: AuthUser; csrf_token: string }>('/syncdrive-api/auth/login', { method: 'POST', body: JSON.stringify({ account_name, password }) });
  csrfToken = result.csrf_token;
  return result.user;
}
export async function logout() {
  await request('/syncdrive-api/auth/logout', { method: 'POST' });
  csrfToken = '';
}
function queryString(input: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
  return query.toString();
}
export const fetchAccounts = (input: Record<string, string | number | undefined>) => request<Paged<AccountRow>>(`${BASE}/accounts?${queryString(input)}`);
export const createAccount = (input: { account_name: string; display_name: string; password: string; role_ids: string[] }) => request<AccountRow>(`${BASE}/accounts`, { method: 'POST', body: JSON.stringify(input) });
export const resetPassword = (id: string, password: string) => request(`${BASE}/accounts/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
export const deleteAccount = (id: string) => request(`${BASE}/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const updateAccountRoles = (id: string, role_ids: string[]) => request<AccountRow>(`${BASE}/accounts/${encodeURIComponent(id)}/roles`, { method: 'PATCH', body: JSON.stringify({ role_ids }) });
export const fetchRoleOptions = () => request<Array<RoleSummary & { is_system: boolean; permission_codes: string[] }>>(`${BASE}/roles/options`);
export const fetchRoles = (input: Record<string, string | number | undefined>) => request<Paged<RoleRow>>(`${BASE}/roles?${queryString(input)}`);
export const fetchPermissions = () => request<PermissionRow[]>(`${BASE}/permissions`);
export const fetchPermissionCatalog = () => request<CatalogModule[]>(`${BASE}/permissions/catalog`);
export const fetchRole = (id: string) => request<RoleRow>(`${BASE}/roles/${encodeURIComponent(id)}`);
export const createRole = (input: { display_name: string; permission_ids: string[] }) => request<RoleRow>(`${BASE}/roles`, { method: 'POST', body: JSON.stringify(input) });
export const updateRole = (id: string, input: { display_name: string; permission_ids: string[]; expected_updated_at: number }) => request<RoleRow>(`${BASE}/roles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteRole = (id: string) => request(`${BASE}/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
