import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import { StatusTag } from '../../../components/StatusTag';
import { FENCE_ENABLE_STATUS, type FenceListItem } from '../types';

type FenceListPanelProps = {
  fences: FenceListItem[];
  selectedId: string | null;
  hiddenIds: ReadonlySet<string>;
  search: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

export function FenceListPanel({
  fences,
  selectedId,
  hiddenIds,
  search,
  collapsed,
  onCollapsedChange,
  onSearchChange,
  onSelect,
  onToggleVisible,
  onEdit,
  onDelete,
}: FenceListPanelProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuId) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuId]);

  if (collapsed) {
    return (
      <div className="relative z-30 flex h-full w-10 shrink-0 flex-col items-center border-r border-zinc-800/80 bg-[#0a0a0b] pt-3">
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          title="展開清單"
          aria-label="展開清單"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:border-[#2B7FFF]/50 hover:text-[#51A2FF]"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          className="mt-auto mb-6 inline-flex h-16 w-5 items-center justify-center rounded-r-md border border-l-0 border-zinc-700 bg-[#18181b] text-zinc-400 hover:text-[#51A2FF]"
          title="展開清單"
          aria-label="展開清單"
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <aside className="relative z-30 flex h-full min-h-0 w-[300px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#0a0a0b]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 px-3 py-3">
        <label className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <input
            data-fence-list-search
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜尋"
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/80 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-[#2B7FFF]/60"
          />
        </label>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          title="縮合清單"
          aria-label="縮合清單"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:border-[#2B7FFF]/50 hover:text-[#51A2FF]"
        >
          <PanelLeftClose className="size-4" aria-hidden />
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {fences.length === 0 ? (
          <li className="px-3 py-10 text-center text-sm text-zinc-500">
            尚無虛擬圍籬
            <br />
            <span className="text-xs text-zinc-600">請按「建立圍籬」新增</span>
          </li>
        ) : (
          fences.map((fence) => {
            const selected = fence.id === selectedId;
            const visible = !hiddenIds.has(fence.id);
            const status = fence.enabled
              ? FENCE_ENABLE_STATUS.enabled
              : FENCE_ENABLE_STATUS.disabled;
            const menuOpen = menuId === fence.id;
            return (
              <li key={fence.id} className="relative">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setMenuId(null);
                    onSelect(fence.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(fence.id);
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 transition ${
                    selected ? 'bg-[#1a3a5c]/80' : 'hover:bg-zinc-900/80'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm tracking-[0.3px] text-zinc-100">
                      {fence.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      事件警示
                    </p>
                  </div>
                  <StatusTag label={status.label} style={status.style} />
                  <button
                    type="button"
                    title={visible ? '隱藏於圖台' : '顯示於圖台'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisible(fence.id);
                    }}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    {visible ? (
                      <Eye className="size-3.5" aria-hidden />
                    ) : (
                      <EyeOff className="size-3.5" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    title="更多"
                    aria-expanded={menuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId((prev) => (prev === fence.id ? null : fence.id));
                    }}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Ellipsis className="size-3.5" aria-hidden />
                  </button>
                </div>

                {menuOpen ? (
                  <div
                    ref={menuRef}
                    className="absolute right-2 top-11 z-40 min-w-[120px] overflow-hidden rounded-lg border border-zinc-700 bg-[#18181b] py-1 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
                      onClick={() => {
                        setMenuId(null);
                        onEdit(fence.id);
                      }}
                    >
                      <Pencil className="size-3.5 text-zinc-400" aria-hidden />
                      編輯
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800"
                      onClick={() => {
                        setMenuId(null);
                        onDelete(fence.id);
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      刪除
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      <button
        type="button"
        onClick={() => onCollapsedChange(true)}
        title="縮合清單"
        aria-label="縮合清單"
        className="absolute top-1/2 right-0 z-30 flex h-12 w-5 translate-x-full -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-zinc-700 bg-[#18181b] text-zinc-400 transition hover:border-[#2B7FFF]/50 hover:text-[#51A2FF]"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
      </button>
    </aside>
  );
}
