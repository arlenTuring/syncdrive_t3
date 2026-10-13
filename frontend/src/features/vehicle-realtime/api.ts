import { resolveBrowserApiBaseUrl } from '../../lib/browserApiBase';
import type { VehicleSnapshotResponse } from './types';

export type VehicleSnapshotQuery = {
  keyword: string;
  page: number;
  pageSize: number;
  sortBy: 'name' | 'speed' | 'battery' | 'connection' | 'gear' | 'updatedAt';
  sortDirection: 'asc' | 'desc';
};

export async function fetchVehicleSnapshot(
  query: VehicleSnapshotQuery,
  signal?: AbortSignal,
): Promise<VehicleSnapshotResponse> {
  const params = new URLSearchParams({
    keyword: query.keyword,
    page: String(query.page),
    pageSize: String(query.pageSize),
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  });
  const response = await fetch(
    `${resolveBrowserApiBaseUrl()}/syncdrive-api/vehicles/snapshot?${params}`,
    { signal, credentials: 'include', headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join('、') : body?.message;
    throw new Error(message || `載具快照讀取失敗（HTTP ${response.status}）`);
  }
  return response.json() as Promise<VehicleSnapshotResponse>;
}
