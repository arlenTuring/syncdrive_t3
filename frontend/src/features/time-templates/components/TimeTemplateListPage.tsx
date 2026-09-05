import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackToHomeButton } from '../../../components/BackToHomeButton';
import {
  downloadTimeTemplatesJson,
  deleteTimeTemplate,
  duplicateTimeTemplateDraft,
  exportTimeTemplates,
  fetchTimeTemplateList,
} from '../api/timeTemplatesApi';
import { StatusTag } from '../../../components/StatusTag';
import { CreateTimeTemplateModal } from './CreateTimeTemplateModal';
import { TimeTemplatePreviewModal } from './TimeTemplatePreviewModal';
import {
  PUBLISH_STATUS_OPTIONS,
  PUBLISH_TAG_STYLE,
  USAGE_TAG_STYLE,
  type PublishStatusKey,
  type TimeTemplateListItem,
} from '../types';

type TimeTemplateListPageProps = {
  onBackToHome?: () => void;
};

const PAGE_SIZE = 20;

export function TimeTemplateListPage({ onBackToHome }: TimeTemplateListPageProps) {
  const { t } = useTranslation();
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [publishStatus, setPublishStatus] = useState<PublishStatusKey | 'all'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TimeTemplateListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canSearch = keywordDraft.trim().length > 0;
  const hasSelection = selected.size > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTimeTemplateList({
        keyword,
        publish_status: publishStatus,
        page,
        page_size: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [keyword, publishStatus, page]);

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

  const toggleRow = (templateId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((r) => r.template_id)));
    }
  };

  const applySearch = () => {
    setPage(1);
    setKeyword(keywordDraft.trim());
  };

  const resetFilters = () => {
    setKeywordDraft('');
    setKeyword('');
    setPublishStatus('all');
    setPage(1);
  };

  const handleDownload = async (ids?: string[]) => {
    const targetIds = ids ?? [...selected];
    if (targetIds.length === 0) return;

    setExporting(true);
    try {
      const data = await exportTimeTemplates(targetIds);
      downloadTimeTemplatesJson(
        data,
        targetIds.length === 1 ? `time-template-${targetIds[0]}.json` : 'time-templates.json',
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
      setOpenMenuId(null);
    }
  };

  const handleEdit = (row: TimeTemplateListItem) => {
    setOpenMenuId(null);
    setEditTemplateId(row.template_id);
  };

  const handleDelete = async (row: TimeTemplateListItem) => {
    if (row.usage_status === 'in_use') return;
    const confirmed = window.confirm(t('common.confirmDelete', { name: row.name }));
    if (!confirmed) return;

    setDeletingId(row.template_id);
    setOpenMenuId(null);
    try {
      await deleteTimeTemplate(row.template_id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (row: TimeTemplateListItem) => {
    setDuplicatingId(row.template_id);
    setOpenMenuId(null);
    try {
      await duplicateTimeTemplateDraft(row.template_id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDuplicatingId(null);
    }
  };

  const closeEditor = () => {
    setCreateOpen(false);
    setEditTemplateId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-4">
        <div className="flex items-center gap-3">
          {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
          <FileText className="size-5 text-violet-400" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">{t('timeTemplates.title')}</h1>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 px-6 py-4">
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700"
          title={t('common.resetFiltersTitle')}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t('common.resetFilters')}
        </button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder={t('common.keywordPlaceholder')}
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSearch && applySearch()}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-600 focus:outline-none"
          />
        </div>
        <select
          value={publishStatus}
          onChange={(e) => {
            setPublishStatus(e.target.value as PublishStatusKey | 'all');
            setPage(1);
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {PUBLISH_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value === 'all'
                ? t('common.selectPublishStatus')
                : t(`common.publishStatus.${opt.value}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={applySearch}
          disabled={!canSearch}
          className={`inline-flex size-9 items-center justify-center rounded-lg border transition ${
            canSearch
              ? 'border-violet-600 bg-violet-600/20 text-violet-300 hover:bg-violet-600/30'
              : 'cursor-not-allowed border-zinc-800 bg-zinc-900/50 text-zinc-600'
          }`}
          title={t('common.search')}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={exporting || !hasSelection}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {t('common.download')}
        </button>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="ml-auto inline-flex h-[34px] w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-white transition hover:bg-[#2569e6]"
        >
          <Plus className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
          {t('timeTemplates.create')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
        {error && (
          <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="w-10 py-3 pr-2">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleAll}
                  className="rounded border-zinc-600 bg-zinc-900"
                />
              </th>
              <th className="py-3 pr-4 font-medium">{t('timeTemplates.columns.name')}</th>
              <th className="py-3 pr-4 font-medium">{t('timeTemplates.columns.preview')}</th>
              <th className="py-3 pr-4 font-medium">{t('timeTemplates.columns.usageStatus')}</th>
              <th className="py-3 pr-4 font-medium">{t('timeTemplates.columns.publishStatus')}</th>
              <th className="py-3 pr-4 font-medium">{t('timeTemplates.columns.createdAt')}</th>
              <th className="py-3 pr-4 font-medium">{t('timeTemplates.columns.updatedAt')}</th>
              <th className="w-10 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  {t('common.loading')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  {t('timeTemplates.empty')}
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.template_id}
                  className="border-b border-zinc-800/60 hover:bg-zinc-900/50"
                >
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.template_id)}
                      onChange={() => toggleRow(row.template_id)}
                      className="rounded border-zinc-600 bg-zinc-900"
                    />
                  </td>
                  <td className="py-3 pr-4 font-medium text-zinc-100">{row.name}</td>
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => setPreviewTarget({ id: row.template_id, name: row.name })}
                      className="text-sm text-[#51A2FF] transition hover:text-[#7BB8FF] hover:underline"
                    >
                      {t('timeTemplates.preview')}
                    </button>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(`common.usageStatus.${row.usage_status}`)}
                      style={USAGE_TAG_STYLE[row.usage_status]}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(`common.publishStatus.${row.publish_status}`)}
                      style={PUBLISH_TAG_STYLE[row.publish_status]}
                    />
                  </td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{row.created_at}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{row.updated_at}</td>
                  <td className="relative py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenuId((prev) => (prev === row.template_id ? null : row.template_id))
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title={t('common.moreActions')}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {openMenuId === row.template_id && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                      >
                        <button
                          type="button"
                          onClick={() => void handleDownload([row.template_id])}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                        >
                          <Download className="size-4 text-zinc-400" />
                          {t('common.download')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(row)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                        >
                          <Pencil className="size-4 text-zinc-400" />
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDuplicate(row)}
                          disabled={duplicatingId === row.template_id}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {duplicatingId === row.template_id ? (
                            <Loader2 className="size-4 animate-spin text-zinc-400" />
                          ) : (
                            <Copy className="size-4 text-zinc-400" />
                          )}
                          {t('common.duplicate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          disabled={row.usage_status === 'in_use' || deletingId === row.template_id}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                            row.usage_status === 'in_use'
                              ? 'cursor-not-allowed text-zinc-600'
                              : 'text-zinc-200 hover:bg-zinc-800 hover:text-red-300'
                          }`}
                          title={
                            row.usage_status === 'in_use'
                              ? t('timeTemplates.cannotDeleteInUse')
                              : undefined
                          }
                        >
                          {deletingId === row.template_id ? (
                            <Loader2 className="size-4 animate-spin text-zinc-400" />
                          ) : (
                            <Trash2 className="size-4 text-zinc-400" />
                          )}
                          {t('common.delete')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
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
                ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40'
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

      {(createOpen || editTemplateId) && (
        <CreateTimeTemplateModal
          editTemplateId={editTemplateId ?? undefined}
          onClose={closeEditor}
          onSavedDraft={() => void load()}
        />
      )}

      {previewTarget && (
        <TimeTemplatePreviewModal
          templateId={previewTarget.id}
          fallbackName={previewTarget.name}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}
