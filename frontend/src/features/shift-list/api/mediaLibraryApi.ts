import { getDataSourceById } from '../../dashboard/store/useDataSourceStore';

export type MediaLibraryKind = 'media' | 'group';

export type MediaLibraryOption = {
  id: string;
  name: string;
  kind: MediaLibraryKind;
};

export function resolveMediaLibraryBackendUrl(): string {
  return getDataSourceById('default-internal')?.backendUrl ?? 'http://127.0.0.1:3000';
}

export async function fetchMediaLibraryOptions(
  backendUrl = resolveMediaLibraryBackendUrl(),
): Promise<MediaLibraryOption[]> {
  const res = await fetch(`${backendUrl}/syncdrive-api/media-library/options`);
  if (!res.ok) {
    throw new Error(`媒體資料庫載入失敗（${res.status}）`);
  }
  const data = (await res.json()) as { items?: MediaLibraryOption[] };
  return Array.isArray(data.items) ? data.items : [];
}
