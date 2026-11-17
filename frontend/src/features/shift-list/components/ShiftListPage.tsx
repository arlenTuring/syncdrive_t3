import { SiteSelect } from '../../../components/SiteSelect';
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
import { useTranslation } from 'react-i18next';
import { BackToHomeButton } from '../../../components/BackToHomeButton';
import { StatusTag } from '../../../components/StatusTag';
import {
  deleteOperationShift,
  duplicateOperationShiftAsManualDraft,
  duplicateOperationShiftDraft,
  fetchOperationShiftList,
} from '../api/operationShiftApi';
import {
  CREATION_MODE_TAG_STYLE,
  USAGE_STATUS_OPTIONS,
  USAGE_TAG_STYLE,
  PUBLISH_TAG_STYLE,
  PUBLISH_CHECK_TAG_STYLE,
  type CreationModeKey,
  type OperationShiftListItem,
  type UsageStatusKey,
} from '../types';
import { systemAlert, systemConfirm } from '../../../lib/systemDialog';
import { Button, IconButton } from '../../../components/ui';

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
  const { t } = useTranslation();
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
    const confirmed = (await systemConfirm(t('common.confirmDelete', { name: row.name }), { tone: 'danger' }));
    if (!confirmed) return;

    setDeletingId(row.shift_id);
    setOpenMenuId(null);
    try {
      await deleteOperationShift(row.shift_id);
      await load();
    } catch (e) {
      void systemAlert(e instanceof Error ? e.message : String(e));
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
      void systemAlert(e instanceof Error ? e.message : String(e));
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
      void systemAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingAsManualId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-sub-background text-text-primary">
      <header className="border-b border-border-quaternary bg-surface-sub-background px-6 py-4">
        <div className="flex items-center gap-3">
          {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
          <ClipboardList className="size-5 text-text-theme-light" aria-hidden />
          <h1 className="text-headline-5">{t('shiftList.title')}</h1>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border-quaternary px-6 py-4">
        <SiteSelect
          value={usageStatus}
          onChange={(e) => {
            setUsageStatus(e.target.value as UsageStatusKey | 'all');
            setPage(1);
          }}
          size="md"
        >
          {USAGE_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value === 'all'
                ? t('common.selectUsageStatus')
                : t(`common.usageStatus.${opt.value}`)}
            </option>
          ))}
        </SiteSelect>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-quaternary" />
          <input
            type="search"
            placeholder={t('common.keywordPlaceholder')}
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSearch && applySearch()}
            className="w-full rounded-lg border border-border-quaternary bg-surface-primary py-2 pl-9 pr-3 text-body-s text-text-primary placeholder:text-text-quaternary focus:border-border-theme focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={applySearch}
          disabled={!canSearch}
          className={`inline-flex size-9 items-center justify-center rounded-lg border transition ${
            canSearch
              ? 'border-border-theme-light bg-surface-theme text-text-theme hover:bg-link-tonal-hover'
              : 'cursor-not-allowed border-border-quaternary bg-surface-primary text-text-disabled'
          }`}
          title={t('common.search')}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onCreateClick?.()}
          className="ml-auto inline-flex h-[34px] w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-link-theme-filled px-3.5 py-2 text-body-s-bold leading-[18px] tracking-[0.5px] text-text-primary transition hover:bg-link-theme-filled-hover"
        >
          <Plus className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
          {t('shiftList.create')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
        {error && (
          <div className="mb-3 rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
            {error}
          </div>
        )}
        <table className="w-full min-w-[1080px] border-collapse text-body-s">
          <thead>
            <tr className="border-b border-border-quaternary text-left text-text-quaternary">
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.name')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.preview')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.timeTemplate')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.creationMode')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.usageStatus')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.publishStatus')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.publishCheck')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftList.columns.version')}</th>
              <th className="w-10 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-text-quaternary">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  {t('common.loading')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-text-quaternary">
                  {t('shiftList.empty')}
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const creationMode = resolveCreationMode(row);
                return (
                <tr
                  key={row.shift_id}
                  className="border-b border-border-quaternary hover:bg-surface-primary"
                >
                  <td className="py-3 pr-4 font-medium text-text-primary">{row.name}</td>
                  <td className="py-3 pr-4">
                    <Button variant="text" onPress={() => onPreviewClick?.(row.shift_id)}>{t('shiftList.preview')}</Button>
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">{row.time_template_name}</td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(`shiftList.creationMode.${creationMode}`)}
                      style={CREATION_MODE_TAG_STYLE[creationMode]}
                    />
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
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(
                        `shiftList.publishCheck.${row.publish_check_state ?? 'unchecked'}`,
                      )}
                      style={PUBLISH_CHECK_TAG_STYLE[row.publish_check_state ?? 'unchecked']}
                    />
                  </td>
                  <td className="py-3 pr-4 font-mono text-text-tertiary">{row.version}</td>
                  <td className="relative py-3">
                    <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={() =>
            setOpenMenuId((prev) => (prev === row.shift_id ? null : row.shift_id))
           } title={t('common.moreActions')} label={t('common.moreActions')} icon={<MoreHorizontal />} />
                    {openMenuId === row.shift_id && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-border-quaternary bg-surface-primary py-1 shadow-xl"
                      >
                        {row.publish_status === 'draft' && (
                          <Button hierarchy="subordinate" variant="standard" className="w-full" leadingIcon={<Pencil />} onPress={() => {
                              setOpenMenuId(null);
                              onEditClick?.(row.shift_id);
                            }}>{t('common.edit')}</Button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          disabled={row.usage_status === 'in_use' || deletingId === row.shift_id}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-body-s ${
                            row.usage_status === 'in_use'
                              ? 'cursor-not-allowed text-text-disabled'
                              : 'text-status-error-emphasis hover:bg-link-standard-hover hover:text-status-error-emphasis'
                          }`}
                          title={
                            row.usage_status === 'in_use'
                              ? t('shiftList.cannotDeleteInUse')
                              : undefined
                          }
                        >
                          {deletingId === row.shift_id ? (
                            <Loader2 className="size-4 animate-spin text-text-tertiary" />
                          ) : (
                            <Trash2 className="size-4 text-status-error-emphasis" />
                          )}
                          {t('common.delete')}
                        </button>
                        {creationMode === 'parametric' && (
                          <button
                            type="button"
                            onClick={() => void handleDuplicate(row)}
                            disabled={duplicatingId === row.shift_id}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-s text-text-primary hover:bg-link-standard-hover"
                          >
                            {duplicatingId === row.shift_id ? (
                              <Loader2 className="size-4 animate-spin text-text-tertiary" />
                            ) : (
                              <Copy className="size-4 text-text-tertiary" />
                            )}
                            {t('shiftList.copyAsParametric')}
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
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-s text-text-primary hover:bg-link-standard-hover"
                        >
                          {copyingAsManualId === row.shift_id
                          || (creationMode === 'manual' && duplicatingId === row.shift_id) ? (
                            <Loader2 className="size-4 animate-spin text-text-tertiary" />
                          ) : (
                            <FilePenLine className="size-4 text-text-tertiary" />
                          )}
                          {t('shiftList.copyAsManual')}
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

      <footer className="flex items-center justify-center gap-2 border-t border-border-quaternary px-6 py-4">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-text-quaternary hover:bg-link-standard-hover disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageNumbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPage(n)}
            className={`inline-flex size-8 items-center justify-center rounded-full text-body-s ${
              n === page
                ? 'bg-[#2B7FFF]/20 text-text-theme ring-1 ring-border-theme-light'
                : 'text-text-quaternary hover:bg-link-standard-hover'
            }`}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-text-quaternary hover:bg-link-standard-hover disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </footer>
    </div>
  );
}
