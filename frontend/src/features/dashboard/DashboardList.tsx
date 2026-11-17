import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  CloudDownload,
  FolderOpen,
  Maximize2,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DashboardPlane } from './types';
import { ExportTemplateButton, ImportTemplateDialog } from './components/TemplateFileActions';
import type { TemplateImportResult } from './template/types';
import { systemConfirm } from '../../lib/systemDialog';
import { Button } from '../../components/ui';

interface Props {
  planes: DashboardPlane[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onImportTemplate: (result: TemplateImportResult) => void;
  onUpdatePlane?: (id: string, patch: Partial<Pick<DashboardPlane, 'viewportMode'>>) => void;
}

type SortKey = 'name' | 'resolution' | 'viewportMode' | 'createdAt' | 'updatedAt';

/*
 * 儀表板管理列表：跟圖資資料管理同一種表格（工具列、欄位、排序、每列操作選單），樣式沿用那一頁的
 * class 常數。欄位都取自實際保存的版面資料（名稱、寬高、顯示模式、建立／修改時間），沒有的不補。
 */
const menuItemClass =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-body-s text-text-secondary hover:bg-[rgba(209,213,220,0.08)]';
const headCellClass =
  'h-12 border-b-[0.5px] border-[rgba(212,212,212,0.15)] px-3 py-0.5 text-left text-body-s font-normal leading-[18px] tracking-[0.5px] text-text-tertiary';
const bodyCellClass =
  'h-[52px] border-b-[0.5px] border-[rgba(212,212,212,0.15)] px-3 py-0.5 text-body-s leading-[18px] tracking-[0.5px] text-text-primary';
const fixedLeftClass =
  'sticky left-0 z-10 w-[240px] min-w-[240px] bg-surface-primary shadow-[12px_6px_16px_rgba(2,9,19,0.2)]';
const fixedRightClass =
  'sticky right-0 z-10 w-[58px] min-w-[58px] bg-surface-primary shadow-[-12px_6px_16px_rgba(2,9,19,0.2)]';

export function DashboardList({ planes, onSelect, onCreate, onDelete, onImportTemplate, onUpdatePlane }: Props) {
  const { t, i18n } = useTranslation();
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const rowMenuRef = useRef<HTMLDivElement>(null);

  const formatDate = (ts: number | undefined) => {
    if (!ts || !Number.isFinite(ts)) return '—';
    return new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ts));
  };
  const viewportLabel = (p: DashboardPlane) =>
    (p.viewportMode ?? 'fixed-scale') === 'fit-width'
      ? t('dashboard.listPage.fitWidthStatus')
      : t('dashboard.listPage.fixedScaleStatus');

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenuId]);

  const rows = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const filtered = needle ? planes.filter((p) => p.name.toLowerCase().includes(needle)) : planes;
    if (!sort) return filtered;
    const value = (p: DashboardPlane): string | number => {
      switch (sort.key) {
        case 'name': return p.name;
        case 'resolution': return p.width * p.height;
        case 'viewportMode': return p.viewportMode ?? 'fixed-scale';
        case 'createdAt': return p.createdAt ?? 0;
        case 'updatedAt': return p.updatedAt ?? 0;
      }
    };
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sign;
    });
  }, [planes, keyword, sort]);

  const canSearch = keywordDraft.trim() !== keyword.trim();
  const canReset = keyword !== '' || keywordDraft !== '' || sort != null;

  /** 同一欄：升冪 → 降冪 → 不排序（跟圖資資料管理一樣） */
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };
  const renderSortButton = (key: SortKey) => {
    const active = sort?.key === key;
    const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg p-0.5 transition hover:bg-[rgba(209,213,220,0.08)] ${
          active ? 'text-text-theme' : 'text-text-tertiary'
        }`}
        title={t('mapLibrary.sortTitle')}
        aria-label={t('mapLibrary.sortTitle')}
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
    );
  };

  const columns: Array<{ key: SortKey; label: string; width: string }> = [
    { key: 'resolution', label: t('mapLibrary.columns.resolution'), width: 'min-w-[160px]' },
    { key: 'viewportMode', label: '顯示模式', width: 'min-w-[160px]' },
    { key: 'createdAt', label: t('mapLibrary.columns.createdAt'), width: 'min-w-[180px]' },
    { key: 'updatedAt', label: t('mapLibrary.columns.updatedAt'), width: 'min-w-[180px]' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-surface-primary p-3 text-text-primary">
      {/* 工具列 */}
      <div className="flex shrink-0 flex-wrap items-start gap-3 rounded-2xl p-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="flex h-[34px] w-[200px] items-center rounded-lg bg-[rgba(142,197,255,0.08)] px-3 py-1.5">
            <Search className="mr-1 size-5 shrink-0 text-text-tertiary" aria-hidden />
            <input
              type="search"
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setKeyword(keywordDraft);
              }}
              placeholder="搜尋名稱"
              aria-label="搜尋名稱"
              className="min-w-0 flex-1 bg-transparent py-0.5 text-body-s leading-[18px] tracking-[0.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setKeyword(keywordDraft)}
            disabled={!canSearch}
            className={`inline-flex size-[34px] items-center justify-center rounded-lg p-0.5 transition ${
              canSearch
                ? 'bg-[rgba(43,127,255,0.2)] text-text-theme hover:bg-[rgba(43,127,255,0.3)]'
                : 'cursor-not-allowed bg-[rgba(98,116,142,0.2)] text-[#4A5565]'
            }`}
            title={t('common.search')}
            aria-label={t('common.search')}
          >
            <Search className="size-6" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              setKeywordDraft('');
              setKeyword('');
              setSort(null);
            }}
            disabled={!canReset}
            className={`inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[rgba(212,212,212,0.1)] px-3.5 py-2 text-body-s font-medium leading-[18px] tracking-[0.5px] transition ${
              canReset ? 'text-text-secondary hover:bg-[rgba(209,213,220,0.08)]' : 'cursor-not-allowed text-[#4A5565]'
            }`}
          >
            <RotateCw className="size-[18px]" aria-hidden />
            {t('mapLibrary.reset')}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[rgba(81,162,255,0.5)] px-3.5 py-2 text-body-s-bold leading-[18px] tracking-[0.5px] text-text-theme transition hover:bg-[rgba(81,162,255,0.08)]"
          >
            <CloudDownload className="size-[18px]" aria-hidden />
            匯入儀表板
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-link-theme-filled px-3.5 py-2 text-body-s-bold leading-[18px] tracking-[0.5px] text-text-primary transition hover:bg-link-theme-filled-hover"
          >
            <Plus className="size-[18px]" strokeWidth={2} aria-hidden />
            建立儀表板
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div className="flex min-h-0 flex-1 flex-col px-3">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[960px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 bg-surface-primary">
              <tr>
                <th className={`${headCellClass} ${fixedLeftClass} z-30`}>
                  <div className="flex items-center gap-1">
                    <span className="flex-1">{t('mapLibrary.columns.name')}</span>
                    {renderSortButton('name')}
                  </div>
                </th>
                {columns.map((col) => (
                  <th key={col.key} className={`${headCellClass} ${col.width}`}>
                    <div className="flex items-center gap-1">
                      <span className="flex-1 whitespace-nowrap">{col.label}</span>
                      {renderSortButton(col.key)}
                    </div>
                  </th>
                ))}
                <th className={`${headCellClass} ${fixedRightClass} z-30`} aria-label={t('mapLibrary.columns.actions')} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="py-16 text-center text-body-s text-text-tertiary">
                    {planes.length === 0 ? t('dashboard.listPage.emptyHint') : '沒有符合名稱的儀表板'}
                  </td>
                </tr>
              ) : (
                rows.map((p) => {
                  const fitWidth = p.viewportMode === 'fit-width';
                  return (
                    <tr key={p.id} className="group">
                      <td className={`${bodyCellClass} ${fixedLeftClass} group-hover:bg-[#1f1f23]`}>
                        <Button variant="text" className="w-full" onPress={() => onSelect(p.id)} title="開啟編輯器">{p.name}</Button>
                      </td>
                      <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>{p.width} x {p.height}</td>
                      <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>{viewportLabel(p)}</td>
                      <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>{formatDate(p.createdAt)}</td>
                      <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>{formatDate(p.updatedAt)}</td>
                      <td
                        className={`${bodyCellClass} ${fixedRightClass} group-hover:bg-[#1f1f23] ${
                          openMenuId === p.id ? '!z-[25]' : ''
                        }`}
                      >
                        <div ref={openMenuId === p.id ? rowMenuRef : undefined} className="relative flex justify-center">
                          <button
                            type="button"
                            onClick={() => setOpenMenuId((prev) => (prev === p.id ? null : p.id))}
                            className="inline-flex size-[34px] items-center justify-center rounded-lg p-0.5 text-text-secondary hover:bg-[rgba(209,213,220,0.08)]"
                            title={t('common.moreActions')}
                            aria-label={t('common.moreActions')}
                          >
                            <MoreHorizontal className="size-6" aria-hidden />
                          </button>
                          {openMenuId === p.id && (
                            <div className="absolute right-0 top-full z-40 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-[rgba(212,212,212,0.15)] bg-surface-primary py-1 shadow-xl">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onSelect(p.id);
                                }}
                                className={menuItemClass}
                              >
                                <FolderOpen className="size-4 text-text-tertiary" aria-hidden />
                                開啟編輯
                              </button>
                              {onUpdatePlane && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onUpdatePlane(p.id, { viewportMode: fitWidth ? 'fixed-scale' : 'fit-width' });
                                  }}
                                  className={menuItemClass}
                                  title={fitWidth ? t('dashboard.listPage.fixedScaleTitle') : t('dashboard.listPage.fitWidthTitle')}
                                >
                                  <Maximize2 className="size-4 text-text-tertiary" aria-hidden />
                                  顯示模式改為{fitWidth ? t('dashboard.listPage.fixedScaleStatus') : t('dashboard.listPage.fitWidthStatus')}
                                </button>
                              )}
                              <div onClick={() => setOpenMenuId(null)}>
                                <ExportTemplateButton plane={p} variant="menu-item" />
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  setOpenMenuId(null);
                                  if ((await systemConfirm(t('dashboard.listPage.confirmDelete'), { tone: 'danger' }))) onDelete(p.id);
                                }}
                                className={`${menuItemClass} hover:text-status-error-emphasis`}
                              >
                                <Trash2 className="size-4 text-text-tertiary" aria-hidden />
                                {t('common.delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {importOpen && (
        <ImportTemplateDialog
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            setImportOpen(false);
            onImportTemplate(result);
          }}
        />
      )}
    </div>
  );
}
