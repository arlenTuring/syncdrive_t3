import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Button, IconButton, fieldClass, cn } from '../../../components/ui';

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
  const { t } = useTranslation();
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
      <div className="relative z-30 flex h-full w-10 shrink-0 flex-col items-center border-r border-border-quaternary bg-surface-sub-background pt-3">
        <IconButton variant="outlined" onPress={() => onCollapsedChange(false)} title={t('virtualFence.list.expand')} label={t('virtualFence.list.expand')} icon={<PanelLeftOpen />} />
        <IconButton variant="outlined" className="mt-auto mb-6 w-5" onPress={() => onCollapsedChange(false)} title={t('virtualFence.list.expand')} label={t('virtualFence.list.expand')} icon={<ChevronRight />} />
      </div>
    );
  }

  return (
    <aside className="relative z-30 flex h-full min-h-0 w-[300px] shrink-0 flex-col border-r border-border-quaternary bg-surface-sub-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-quaternary px-3 py-3">
        <label className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-quaternary"
            aria-hidden
          />
          <input
            data-fence-list-search
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('common.search')}
            className={cn(fieldClass({ size: 'md', fullWidth: true }), 'pl-8 pr-3')}
          />
        </label>
        <IconButton variant="outlined" className="shrink-0" onPress={() => onCollapsedChange(true)} title={t('virtualFence.list.collapse')} label={t('virtualFence.list.collapse')} icon={<PanelLeftClose />} />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {fences.length === 0 ? (
          <li className="px-3 py-10 text-center text-body-s text-text-quaternary">
            {t('virtualFence.list.empty')}
            <br />
            <span className="text-body-xs text-text-disabled">{t('virtualFence.list.emptyHint')}</span>
          </li>
        ) : (
          fences.map((fence) => {
            const selected = fence.id === selectedId;
            const visible = !hiddenIds.has(fence.id);
            const statusStyle = fence.enabled
              ? FENCE_ENABLE_STATUS.enabled.style
              : FENCE_ENABLE_STATUS.disabled.style;
            const statusLabel = fence.enabled
              ? t('virtualFence.statusEnabled')
              : t('virtualFence.statusDisabled');
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
                    selected ? 'bg-[#1a3a5c]/80' : 'hover:bg-surface-primary'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-s tracking-[0.3px] text-text-primary">
                      {fence.name}
                    </p>
                    <p className="mt-0.5 truncate text-body-xs text-text-quaternary">
                      {t('virtualFence.list.eventAlert')}
                    </p>
                  </div>
                  <StatusTag label={statusLabel} style={statusStyle} />
                  <Button hierarchy="subordinate" variant="text" className="shrink-0" title={
                      visible
                        ? t('virtualFence.list.hideOnMap')
                        : t('virtualFence.list.showOnMap')
                    } onPress={(e) => {
                      e.stopPropagation();
                      onToggleVisible(fence.id);
                    }}>{visible ? (
                      <Eye className="size-3.5" aria-hidden />
                    ) : (
                      <EyeOff className="size-3.5" aria-hidden />
                    )}</Button>
                  <IconButton hierarchy="subordinate" variant="standard" className="shrink-0" title={t('common.moreActions')} aria-expanded={menuOpen} onPress={(e) => {
                      e.stopPropagation();
                      setMenuId((prev) => (prev === fence.id ? null : fence.id));
                    }} label={t('common.moreActions')} icon={<Ellipsis />} />
                </div>

                {menuOpen ? (
                  <div
                    ref={menuRef}
                    className="absolute right-2 top-11 z-40 min-w-[120px] overflow-hidden rounded-lg border border-border-quaternary bg-surface-popup py-1 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button hierarchy="subordinate" variant="standard" className="w-full" onPress={() => {
                        setMenuId(null);
                        onEdit(fence.id);
                      }} leadingIcon={<Pencil />}>{t('common.edit')}</Button>
                    <Button hierarchy="danger" variant="text" className="w-full" onPress={() => {
                        setMenuId(null);
                        onDelete(fence.id);
                      }} leadingIcon={<Trash2 />}>{t('common.delete')}</Button>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      <IconButton variant="outlined" className="absolute top-1/2 right-0 z-30 w-5 translate-x-full -translate-y-1/2" onPress={() => onCollapsedChange(true)} title={t('virtualFence.list.collapse')} label={t('virtualFence.list.collapse')} icon={<ChevronLeft />} />
    </aside>
  );
}
