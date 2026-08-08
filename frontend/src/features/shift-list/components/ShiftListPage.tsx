import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  FilePenLine,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackToHomeButton } from '../../../components/BackToHomeButton';
import { StatusTag } from '../../../components/StatusTag';
import {
  deleteOperationShift,
  duplicateOperationShiftAsManualDraft,
  duplicateOperationShiftDraft,
  fetchOperationShiftList,
} from '../api/operationShiftApi';
import {
  CREATION_MODE_LABEL,
  CREATION_MODE_TAG_STYLE,
  USAGE_STATUS_OPTIONS,
  USAGE_TAG_STYLE,
  PUBLISH_TAG_STYLE,
  PUBLISH_CHECK_LABEL,
  PUBLISH_CHECK_TAG_STYLE,
  type CreationModeKey,
  type OperationShiftListItem,
  type UsageStatusKey,
} from '../types';

function resolveCreationMode(row: OperationShiftListItem): CreationModeKey {
  return row.creation_mode === 'manual' ? 'manual' : 'parametric';
}

type ShiftListPageProps = {
  onBackToHome?: () => void;
  onCreateClick?: () => void;
  onEditClick?: (shiftId: string) => void;
  /** 開啟最後一步「整體預覽」唯讀結果 */
  onPreviewClick?: (shiftId: string) => void;
};

const PAGE_SIZE = 20;

export function ShiftListPage({
  onBackToHome,
  onCreateClick,
  onEditClick,
  onPreviewClick,
}: ShiftListPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [usageStatus, setUsageStatus] = useState<UsageStatusKey | 'all'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<OperationShiftListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [copyingAsManualId, setCopyingAsManualId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canSearch = keywordDraft.trim().length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOperationShiftList({
        keyword,
        usage_status: usageStatus,
        page,
        page_size: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [keyword, usageStatus, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenuId]);

  const pageNumbers = useMemo(() => {
    const max = Math.min(5, totalPages);
    const start = Math.max(1, Math.min(page - 2, totalPages - max + 1));
    return Array.from({ length: max }, (_, i) => start + i);
  }, [page, totalPages]);

  const applySearch = () => {
    setPage(1);
    setKeyword(keywordDraft.trim());
  };

  const handleDelete = async (row: OperationShiftListItem) => {
    if (row.usage_status === 'in_use') return;
    const confirmed = window.confirm(`確定要刪除「${row.name}」嗎？此操作無法復原。`);
    if (!confirmed) return;

    setDeletingId(row.shift_id);
    setOpenMenuId(null);
    try {
      await deleteOperationShift(row.shift_id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (row: OperationShiftListItem) => {
    setDuplicatingId(row.shift_id);
    setOpenMenuId(null);
    try {
      const created = await duplicateOperationShiftDraft(row.shift_id);
      await load();
      onEditClick?.(created.shift_id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleCopyAsManual = async (row: OperationShiftListItem) => {
    if (resolveCreationMode(row) !== 'parametric') return;
    setCopyingAsManualId(row.shift_id);
    setOpenMenuId(null);
    try {
      await duplicateOperationShiftAsManualDraft(row.shift_id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingAsManualId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-4">
        <div className="flex items-center gap-3">
          {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
          <ClipboardList className="size-5 text-[#2B7FFF]" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">班表清單管理</h1>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 px-6 py-4">
        <select
          value={usageStatus}
          onChange={(e) => {
            setUsageStatus(e.target.value as UsageStatusKey | 'all');
            setPage(1);
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {USAGE_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder="請輸入關鍵字"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSearch && applySearch()}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[#2B7FFF] focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={applySearch}
          disabled={!canSearch}
          className={`inline-flex size-9 items-center justify-center rounded-lg border transition ${
            canSearch
              ? 'border-[#2B7FFF]/50 bg-[#2B7FFF]/15 text-[#51A2FF] hover:bg-[#2B7FFF]/25'
              : 'cursor-not-allowed border-zinc-800 bg-zinc-900/50 text-zinc-600'
          }`}
          title="搜尋"
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onCreateClick?.()}
          className="ml-auto inline-flex h-[34px] w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-white transition hover:bg-[#2569e6]"
        >
          <Plus className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
          建立班表
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
        {error && (
          <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="py-3 pr-4 font-medium">班表名稱</th>
              <th className="py-3 pr-4 font-medium">班表預覽</th>
              <th className="py-3 pr-4 font-medium">時間模板</th>
              <th className="py-3 pr-4 font-medium">建立方式</th>
              <th className="py-3 pr-4 font-medium">使用狀態</th>
              <th className="py-3 pr-4 font-medium">發布狀態</th>
              <th className="py-3 pr-4 font-medium">檢查狀態</th>
              <th className="py-3 pr-4 font-medium">版本編號</th>
              <th className="w-10 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  載入中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  尚無符合條件的班表
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const creationMode = resolveCreationMode(row);
                return (
                <tr
                  key={row.shift_id}
                  className="border-b border-zinc-800/60 hover:bg-zinc-900/50"
                >
                  <td className="py-3 pr-4 font-medium text-zinc-100">{row.name}</td>
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => onPreviewClick?.(row.shift_id)}
                      className="text-sm text-[#51A2FF] transition hover:text-[#7BB8FF] hover:underline"
                    >
                      班表預覽
                    </button>
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{row.time_template_name}</td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={row.creation_mode_label || CREATION_MODE_LABEL[creationMode]}
                      style={CREATION_MODE_TAG_STYLE[creationMode]}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={row.usage_status_label}
                      style={USAGE_TAG_STYLE[row.usage_status]}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={row.publish_status_label}
                      style={PUBLISH_TAG_STYLE[row.publish_status]}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={
                        row.publish_check_label
                        ?? PUBLISH_CHECK_LABEL[row.publish_check_state ?? 'unchecked']
                      }
                      style={PUBLISH_CHECK_TAG_STYLE[row.publish_check_state ?? 'unchecked']}
                    />
                  </td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{row.version}</td>
                  <td className="relative py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenuId((prev) => (prev === row.shift_id ? null : row.shift_id))
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title="更多操作"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {openMenuId === row.shift_id && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                      >
                        {row.publish_status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              onEditClick?.(row.shift_id);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                          >
                            <Pencil className="size-4 text-zinc-400" />
                            編輯
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          disabled={row.usage_status === 'in_use' || deletingId === row.shift_id}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                            row.usage_status === 'in_use'
                              ? 'cursor-not-allowed text-zinc-600'
                              : 'text-red-400 hover:bg-zinc-800 hover:text-red-300'
                          }`}
                          title={row.usage_status === 'in_use' ? '使用中的班表無法刪除' : undefined}
                        >
                          {deletingId === row.shift_id ? (
                            <Loader2 className="size-4 animate-spin text-zinc-400" />
                          ) : (
                            <Trash2 className="size-4 text-red-400" />
                          )}
                          刪除
                        </button>
                        {creationMode === 'parametric' && (
                          <button
                            type="button"
                            onClick={() => void handleDuplicate(row)}
                            disabled={duplicatingId === row.shift_id}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                          >
                            {duplicatingId === row.shift_id ? (
                              <Loader2 className="size-4 animate-spin text-zinc-400" />
                            ) : (
                              <Copy className="size-4 text-zinc-400" />
                            )}
                            複製成參數生成班表
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void (creationMode === 'parametric'
                              ? handleCopyAsManual(row)
                              : handleDuplicate(row))
                          }
                          disabled={
                            copyingAsManualId === row.shift_id
                            || duplicatingId === row.shift_id
                          }
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                        >
                          {copyingAsManualId === row.shift_id
                          || (creationMode === 'manual' && duplicatingId === row.shift_id) ? (
                            <Loader2 className="size-4 animate-spin text-zinc-400" />
                          ) : (
                            <FilePenLine className="size-4 text-zinc-400" />
                          )}
                          複製成手動製作班表
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-center gap-2 border-t border-zinc-800/80 px-6 py-4">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageNumbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPage(n)}
            className={`inline-flex size-8 items-center justify-center rounded-full text-sm ${
              n === page
                ? 'bg-[#2B7FFF]/20 text-[#51A2FF] ring-1 ring-[#2B7FFF]/40'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </footer>
    </div>
  );
}
