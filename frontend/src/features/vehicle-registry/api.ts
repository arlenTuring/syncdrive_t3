import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';

export type IntegrationInfo = {
  vehicleCode: string;
  mqtt: { host: string | null; port: number; tls: true; mutualTls: true };
  apiBaseUrl: string | null;
  credentialEndpoint: string;
  wikiUrl: string;
  publishTopics: string[];
  subscribeTopics: string[];
  readiness: 'READY' | 'CONFIG_REQUIRED';
};
export type VehicleRegistration = {
  id: string; vehicleCode?: string; displayName: string; initialMileageKm: number;
  connectionStatus?: 'ONLINE' | 'OFFLINE' | 'NO_DATA'; serviceEnabled: boolean;
  createdAt: number; updatedAt: number | null; version: number; integration?: IntegrationInfo;
};
export type RegistryResponse = { items: VehicleRegistration[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
export type RegistryQuery = { keyword: string; page: number; pageSize: number; sortBy: 'name'|'mileage'|'connection'|'service'|'createdAt'; sortDirection: 'asc'|'desc' };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${resolveBrowserApiBaseUrl()}${path}`, {
    ...init, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.json().catch(() => null) as { message?: string|string[] } | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('、') : body?.message;
    throw new Error(message || `API ${response.status}`);
  }
  return body as T;
}
const query = (value: RegistryQuery) => new URLSearchParams(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))).toString();
export const fetchRegistry = (value: RegistryQuery) => request<RegistryResponse>(`/syncdrive-api/vehicles/registry?${query(value)}`);
export const fetchVehicleRegistration = (id: string) => request<VehicleRegistration>(`/syncdrive-api/vehicles/registry/${encodeURIComponent(id)}`);
export const createVehicleRegistration = (body: { displayName: string; initialMileageKm: number }) => request<VehicleRegistration>('/syncdrive-api/vehicles/registry', { method: 'POST', body: JSON.stringify(body) });
export const updateVehicleRegistration = (id: string, body: { displayName: string; initialMileageKm: number; expectedVersion: number }) => request<VehicleRegistration>(`/syncdrive-api/vehicles/registry/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
export const updateVehicleService = (id: string, body: { serviceEnabled: boolean; expectedVersion: number }) => request<VehicleRegistration>(`/syncdrive-api/vehicles/registry/${encodeURIComponent(id)}/service`, { method: 'PATCH', body: JSON.stringify(body) });

export function integrationText(info: IntegrationInfo) {
  return [
    `通訊身分：${info.vehicleCode}`,
    `MQTT：${info.mqtt.host ? `mqtts://${info.mqtt.host}:${info.mqtt.port}` : '部署環境尚未設定'}`,
    'TLS：雙向憑證驗證（憑證 CN 等於通訊身分，不使用 MQTT 帳密）',
    `REST API：${info.apiBaseUrl ?? '部署環境尚未設定'}`,
    `取得授權與憑證：POST ${info.credentialEndpoint}`,
    `發布 Topic：\n${info.publishTopics.join('\n')}`,
    `訂閱 Topic：\n${info.subscribeTopics.join('\n')}`,
    `Wiki：${info.wikiUrl}`,
  ].join('\n');
}
