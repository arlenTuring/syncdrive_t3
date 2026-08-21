import type { MapAreaObject } from '../map-editor/types/area';
import { collectTrackSegments, verticesFromCoverageTracks } from './fenceModel';
import {
  VIRTUAL_FENCE_KIND,
  VIRTUAL_FENCE_PURPOSE,
  type FenceDraft,
  type FenceVertex,
  type VirtualFence,
} from './types';

const STORAGE_PREFIX = 'syncdrive_vtms_virtual_fences:';
const STORE_VERSION = 2 as const;

type StoreShape = {
  version: typeof STORE_VERSION;
  mapId: string;
  fences: VirtualFence[];
};

function storageKey(mapId: string): string {
  return `${STORAGE_PREFIX}${mapId}`;
}

function parseVertices(raw: unknown): FenceVertex[] {
  if (!Array.isArray(raw)) return [];
  const out: FenceVertex[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const x = Number((item as { x?: unknown }).x);
    const y = Number((item as { y?: unknown }).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
}

function isVirtualFence(value: unknown): value is VirtualFence {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<VirtualFence>;
  return (
    row.kind === VIRTUAL_FENCE_KIND
    && typeof row.id === 'string'
    && typeof row.name === 'string'
    && Array.isArray(row.coverage)
    && !String(row.id).startsWith('vf-seed-')
  );
}

function normalizeFence(
  f: VirtualFence,
  mapId: string,
  tracks: ReturnType<typeof collectTrackSegments>,
): VirtualFence {
  let vertices = parseVertices(f.vertices);
  if (vertices.length < 3 && f.coverage.length > 0) {
    vertices = verticesFromCoverageTracks(tracks, f.coverage);
  }
  return {
    ...f,
    kind: VIRTUAL_FENCE_KIND,
    purpose: VIRTUAL_FENCE_PURPOSE,
    mapId,
    enterBehaviors: Array.isArray(f.enterBehaviors) ? f.enterBehaviors : [],
    leaveBehaviors: Array.isArray(f.leaveBehaviors) ? f.leaveBehaviors : [],
    coverage: f.coverage.map((c) => ({
      trackId: String(c.trackId),
      label: String(c.label),
    })),
    vertices,
  };
}

/** 清除舊版示範／無效資料，只保留使用者建立的虛擬圍籬 */
function readStore(
  mapId: string,
  tracks: ReturnType<typeof collectTrackSegments>,
): VirtualFence[] {
  try {
    const raw = localStorage.getItem(storageKey(mapId));
    if (!raw) {
      writeStore(mapId, []);
      return [];
    }
    const parsed = JSON.parse(raw) as { version?: number; fences?: unknown };
    const list = Array.isArray(parsed.fences) ? parsed.fences : [];
    const fences = list
      .filter(isVirtualFence)
      .map((f) => normalizeFence(f, mapId, tracks));
    // 升版或清掉 seed 後一律寫回，避免假資料殘留
    if (parsed.version !== STORE_VERSION || fences.length !== list.length) {
      writeStore(mapId, fences);
    }
    return fences;
  } catch {
    writeStore(mapId, []);
    return [];
  }
}

function writeStore(mapId: string, fences: VirtualFence[]): void {
  const payload: StoreShape = { version: STORE_VERSION, mapId, fences };
  localStorage.setItem(storageKey(mapId), JSON.stringify(payload));
}

function newId(): string {
  return `vf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 載入指定啟用地圖下的虛擬圍籬（無示範資料；僅使用者建立） */
export function loadVirtualFences(
  mapId: string,
  areas: MapAreaObject[],
): VirtualFence[] {
  const tracks = collectTrackSegments(areas);
  return readStore(mapId, tracks).sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }),
  );
}

/** 清除本機虛擬圍籬快取中的示範假資料（vf-seed-*）；保留使用者建立項目 */
export function clearSeedVirtualFenceLocalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { mapId?: string; fences?: unknown[] };
        const mapId = String(parsed.mapId ?? key.slice(STORAGE_PREFIX.length));
        const list = Array.isArray(parsed.fences) ? parsed.fences : [];
        const kept = list.filter(
          (row) =>
            row
            && typeof row === 'object'
            && !String((row as { id?: string }).id ?? '').startsWith('vf-seed-'),
        ) as VirtualFence[];
        writeStore(mapId, kept);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

export function saveVirtualFences(mapId: string, fences: VirtualFence[]): void {
  writeStore(
    mapId,
    fences.map((f) => ({
      ...f,
      kind: VIRTUAL_FENCE_KIND,
      purpose: VIRTUAL_FENCE_PURPOSE,
      mapId,
    })),
  );
}

export function upsertVirtualFence(
  mapId: string,
  fences: VirtualFence[],
  fenceId: string | null,
  draft: FenceDraft,
): { fences: VirtualFence[]; fenceId: string } {
  const now = Date.now();
  if (fenceId) {
    const next = fences.map((f) =>
      f.id === fenceId
        ? {
            ...f,
            kind: VIRTUAL_FENCE_KIND,
            purpose: VIRTUAL_FENCE_PURPOSE,
            mapId,
            name: draft.name.trim() || f.name,
            enabled: draft.enabled,
            coverage: draft.coverage.map((c) => ({ ...c })),
            vertices: draft.vertices.map((v) => ({ ...v })),
            enterBehaviors: [...draft.enterBehaviors],
            leaveBehaviors: [...draft.leaveBehaviors],
            speedLimitKmh: draft.speedLimitKmh,
            updatedAt: now,
          }
        : f,
    );
    saveVirtualFences(mapId, next);
    return { fences: next, fenceId };
  }

  const id = newId();
  const created: VirtualFence = {
    kind: VIRTUAL_FENCE_KIND,
    purpose: VIRTUAL_FENCE_PURPOSE,
    id,
    mapId,
    name: draft.name.trim() || '未命名圍籬',
    enabled: draft.enabled,
    coverage: draft.coverage.map((c) => ({ ...c })),
    vertices: draft.vertices.map((v) => ({ ...v })),
    enterBehaviors: [...draft.enterBehaviors],
    leaveBehaviors: [...draft.leaveBehaviors],
    speedLimitKmh: draft.speedLimitKmh,
    updatedAt: now,
  };
  const next = [...fences, created].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }),
  );
  saveVirtualFences(mapId, next);
  return { fences: next, fenceId: id };
}

export function deleteVirtualFence(
  mapId: string,
  fences: VirtualFence[],
  fenceId: string,
): VirtualFence[] {
  const next = fences.filter((f) => f.id !== fenceId);
  saveVirtualFences(mapId, next);
  return next;
}
