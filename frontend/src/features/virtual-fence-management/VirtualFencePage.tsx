import { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { MapAreaObject, MapPixelSize } from '../map-editor/types/area';
import { DEFAULT_MAP_PIXEL_SIZE } from '../map-editor/types/area';
import { FenceFormPanel } from './components/FenceFormPanel';
import { FenceListPanel } from './components/FenceListPanel';
import { FenceMapPanel } from './components/FenceMapPanel';
import { FenceViewPanel } from './components/FenceViewPanel';
import { toListItem } from './fenceModel';
import { loadActiveMapContext } from './loadActiveMapContext';
import {
  draftFromFence,
  emptyFenceDraft,
  type FenceDraft,
  type FenceEnableFilter,
  type FencePageMode,
  type VirtualFence,
} from './types';
import {
  clearSeedVirtualFenceLocalData,
  deleteVirtualFence,
  loadVirtualFences,
  upsertVirtualFence,
} from './virtualFenceStore';

const SELECT =
  'h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-[#2B7FFF]/60';

export function VirtualFencePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapId, setMapId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [areas, setAreas] = useState<MapAreaObject[]>([]);
  const [pixelSize, setPixelSize] = useState<MapPixelSize>(DEFAULT_MAP_PIXEL_SIZE);
  const [pixelOrigin, setPixelOrigin] = useState({ x: 0, y: 0 });
  const [fences, setFences] = useState<VirtualFence[]>([]);

  const [enableFilter, setEnableFilter] = useState<FenceEnableFilter>('all');
  const [listSearch, setListSearch] = useState('');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [listCollapsed, setListCollapsed] = useState(false);
  const [mode, setMode] = useState<FencePageMode>({ kind: 'browse' });
  const [draft, setDraft] = useState<FenceDraft>(emptyFenceDraft);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    clearSeedVirtualFenceLocalData();
    void loadActiveMapContext()
      .then((result) => {
        if (cancelled) return;
        setMapId(result.mapId);
        setDisplayName(result.displayName);
        setAreas(result.areas);
        setPixelSize(result.pixelSize);
        setPixelOrigin(result.pixelOrigin);
        // loadVirtualFences 會自動剔除 vf-seed-* 示範假資料並升版儲存
        const loaded = loadVirtualFences(result.mapId, result.areas);
        setFences(loaded);
        setMode(
          loaded[0] ? { kind: 'view', fenceId: loaded[0].id } : { kind: 'browse' },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '無法載入啟用地圖');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fenceById = useMemo(() => {
    const map = new Map<string, VirtualFence>();
    for (const f of fences) map.set(f.id, f);
    return map;
  }, [fences]);

  const listItems = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return fences
      .map(toListItem)
      .filter((fence) => {
        if (enableFilter === 'enabled' && !fence.enabled) return false;
        if (enableFilter === 'disabled' && fence.enabled) return false;
        if (!q) return true;
        return fence.name.toLowerCase().includes(q);
      });
  }, [fences, enableFilter, listSearch]);

  const selectedId =
    mode.kind === 'view' || mode.kind === 'edit' ? mode.fenceId : null;
  const viewing = mode.kind === 'view' ? fenceById.get(mode.fenceId) : null;
  const isEditing = mode.kind === 'edit' || mode.kind === 'create';

  /** 眼睛開啟 → 地圖必須畫出該圍籬；編輯中的那筆改由可拖曳覆層顯示 */
  const mapShapes = useMemo(() => {
    const editingId = mode.kind === 'edit' ? mode.fenceId : null;
    return fences
      .filter(
        (f) =>
          !hiddenIds.has(f.id)
          && f.vertices.length >= 3
          && f.id !== editingId,
      )
      .map((f) => ({ id: f.id, vertices: f.vertices }));
  }, [fences, hiddenIds, mode]);

  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openView = (id: string) => setMode({ kind: 'view', fenceId: id });

  const startEdit = (fenceId: string) => {
    const fence = fenceById.get(fenceId);
    if (!fence) return;
    setDraft(draftFromFence(fence));
    setMode({ kind: 'edit', fenceId });
  };

  const startCreate = () => {
    setDraft(emptyFenceDraft());
    setMode({ kind: 'create' });
  };

  const cancelEdit = () => {
    if (mode.kind === 'edit') setMode({ kind: 'view', fenceId: mode.fenceId });
    else setMode({ kind: 'browse' });
  };

  const saveDraft = () => {
    if (!mapId) return;
    try {
      if (mode.kind === 'edit') {
        const result = upsertVirtualFence(mapId, fences, mode.fenceId, draft);
        setFences(result.fences);
        setMode({ kind: 'view', fenceId: result.fenceId });
        return;
      }
      if (mode.kind === 'create') {
        const result = upsertVirtualFence(mapId, fences, null, draft);
        setFences(result.fences);
        setMode({ kind: 'view', fenceId: result.fenceId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
    }
  };

  const removeFence = (fenceId: string) => {
    if (!mapId) return;
    if (!window.confirm('確定刪除此虛擬圍籬？')) return;
    setFences(deleteVirtualFence(mapId, fences, fenceId));
    setMode({ kind: 'browse' });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <div className="relative flex shrink-0 items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
        {!isEditing ? (
          <>
            <select
              value={enableFilter}
              onChange={(e) => setEnableFilter(e.target.value as FenceEnableFilter)}
              className={SELECT}
              aria-label="圍籬啟用狀態"
            >
              <option value="all">圍籬啟用狀態</option>
              <option value="enabled">啟用</option>
              <option value="disabled">未啟用</option>
            </select>
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-[#2B7FFF]/50 bg-[#2B7FFF]/15 text-[#51A2FF] transition hover:bg-[#2B7FFF]/25"
              title="搜尋"
              onClick={() => {
                document
                  .querySelector<HTMLInputElement>('[data-fence-list-search]')
                  ?.focus();
              }}
            >
              <Search className="size-4" />
            </button>
            <div className="ml-auto flex min-w-0 items-center gap-3">
              {mapId ? (
                <p className="hidden truncate text-xs text-zinc-500 sm:block">
                  目前地圖 · {displayName || mapId}
                </p>
              ) : null}
              <button
                type="button"
                onClick={startCreate}
                className="inline-flex h-[34px] w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-white transition hover:bg-[#2569e6]"
              >
                <Plus className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
                建立圍籬
              </button>
            </div>
          </>
        ) : (
          <p className="absolute inset-x-0 text-center text-sm tracking-[0.4px] text-zinc-300">
            正在編輯中...
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {loading ? (
          <p className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            載入啟用地圖…
          </p>
        ) : error ? (
          <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-red-400">
            {error}
          </p>
        ) : (
          <>
            {!isEditing ? (
              <FenceListPanel
                fences={listItems}
                selectedId={selectedId}
                hiddenIds={hiddenIds}
                search={listSearch}
                collapsed={listCollapsed}
                onCollapsedChange={setListCollapsed}
                onSearchChange={setListSearch}
                onSelect={openView}
                onToggleVisible={toggleHidden}
                onEdit={startEdit}
                onDelete={removeFence}
              />
            ) : null}

            <div className="min-h-0 min-w-0 flex-1 p-3">
              <FenceMapPanel
                areas={areas}
                pixelSize={pixelSize}
                pixelOrigin={pixelOrigin}
                mapShapes={mapShapes}
                editing={isEditing}
                coverage={isEditing ? draft.coverage : viewing?.coverage ?? []}
                vertices={isEditing ? draft.vertices : []}
                onShapeChange={
                  isEditing
                    ? (next) =>
                        setDraft((prev) => ({
                          ...prev,
                          coverage: next.coverage,
                          vertices: next.vertices,
                        }))
                    : undefined
                }
              />
            </div>

            {mode.kind === 'view' && viewing ? (
              <FenceViewPanel
                detail={viewing}
                onClose={() => setMode({ kind: 'browse' })}
                onEdit={() => startEdit(viewing.id)}
                onDelete={() => removeFence(viewing.id)}
              />
            ) : null}

            {mode.kind === 'edit' || mode.kind === 'create' ? (
              <FenceFormPanel
                mode={mode.kind}
                draft={draft}
                onChange={setDraft}
                onClose={cancelEdit}
                onCancel={cancelEdit}
                onSubmit={saveDraft}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
