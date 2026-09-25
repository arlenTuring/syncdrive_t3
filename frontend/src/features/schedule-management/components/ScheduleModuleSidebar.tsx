import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  FileText,
  Headphones,
  LayoutDashboard,
  List,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pentagon,
  Plus,
  Route,
  Send,
  Settings,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShellView } from '../types';
import { isOperationsView, isSiteView, SIDEBAR_MODULE_GROUPS } from '../types';
import type { ModuleDashboardPage } from '../utils/moduleDashboardPages';
import {
  moduleDashboardViewId,
  parseModuleDashboardViewId,
} from '../utils/moduleDashboardPages';

const SIDEBAR_COLLAPSED_KEY = 'syncdrive_vtms_sidebar_collapsed';
const VTMS_MARK_SRC = '/logo.svg';

type ScheduleModuleSidebarProps = {
  activeView: string;
  onViewChange: (view: ShellView | string) => void;
  onOpenSettings?: () => void;
  adminMode?: boolean;
  moduleDashboardPages?: ModuleDashboardPage[];
  onAddModuleDashboard?: (moduleId: string) => void;
  onRenameModuleDashboard?: (pageId: string, label: string) => void;
  onRemoveModuleDashboard?: (pageId: string) => void;
};

const SUB_ICONS: Partial<Record<ShellView, typeof ClipboardList>> = {
  'shift-deployment': Activity,
  'degraded-operation': AlertTriangle,
  'dispatch-scheduling': Send,
  'psd-control': DoorOpen,
  'virtual-fence': Pentagon,
  map: Map,
  'shift-records': ClipboardList,
  'time-templates': FileText,
  'shift-list': List,
  'maintenance-tasks': Wrench,
  trajectory: Route,
};

function groupIcon(groupId: string) {
  if (groupId === 'schedule') return CalendarDays;
  if (groupId === 'monitor') return Activity;
  if (groupId === 'vehicle') return Route;
  if (groupId === 'site') return Map;
  if (groupId === 'operations') return Activity;
  if (groupId === 'permission') return Settings;
  if (groupId === 'service' || groupId === 'media') {
    return LayoutDashboard;
  }
  return LayoutDashboard;
}

function isBuiltinGroupActive(groupId: string, activeView: string): boolean {
  if (groupId === 'site') return isSiteView(activeView);
  if (groupId === 'vehicle') return activeView === 'trajectory';
  if (groupId === 'operations') return isOperationsView(activeView);
  if (groupId === 'schedule') {
    return (
      activeView === 'shift-records'
      || activeView === 'time-templates'
      || activeView === 'shift-list'
      || activeView === 'maintenance-tasks'
    );
  }
  return false;
}

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore
  }
}

function VtmsMark({ className }: { className?: string }) {
  return (
    <img
      src={VTMS_MARK_SRC}
      alt=""
      className={className}
      width={28}
      height={28}
      draggable={false}
    />
  );
}

export function ScheduleModuleSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  adminMode = false,
  moduleDashboardPages = [],
  onAddModuleDashboard,
  onRenameModuleDashboard,
  onRemoveModuleDashboard,
}: ScheduleModuleSidebarProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    operations: true,
    schedule: true,
    vehicle: true,
    site: true,
  });
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renamingPageId) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renamingPageId]);

  const commitRename = () => {
    if (!renamingPageId) return;
    const next = renameDraft.trim();
    if (next) onRenameModuleDashboard?.(renamingPageId, next);
    setRenamingPageId(null);
  };

  const startRename = (page: ModuleDashboardPage) => {
    setRenamingPageId(page.id);
    setRenameDraft(page.label);
  };

  useEffect(() => {
    writeCollapsedPreference(collapsed);
  }, [collapsed]);

  useEffect(() => {
    if (isOperationsView(activeView)) {
      setExpanded((prev) => ({ ...prev, operations: true }));
    }
    if (isSiteView(activeView)) {
      setExpanded((prev) => ({ ...prev, site: true }));
    }
    if (
      activeView === 'shift-records'
      || activeView === 'time-templates'
      || activeView === 'shift-list'
      || activeView === 'maintenance-tasks'
    ) {
      setExpanded((prev) => ({ ...prev, schedule: true }));
    }
    if (activeView === 'trajectory') {
      setExpanded((prev) => ({ ...prev, vehicle: true }));
    }
    const mdpId = parseModuleDashboardViewId(activeView);
    if (mdpId) {
      const page = moduleDashboardPages.find((item) => item.id === mdpId);
      if (page) {
        setExpanded((prev) => ({ ...prev, [page.moduleId]: true }));
      }
    }
  }, [activeView, moduleDashboardPages]);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  return (
    <aside
      className={`flex shrink-0 flex-col bg-black transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[64px]' : 'w-[240px]'
      }`}
    >
      <div
        className={`flex shrink-0 ${
          collapsed
            ? 'flex-col items-center gap-3 px-2 pt-3 pb-2'
            : 'h-14 items-center gap-2 px-3'
        }`}
      >
        {collapsed ? (
          <>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex size-9 items-center justify-center rounded-md text-zinc-300 transition hover:bg-white/5 hover:text-white"
              title={t('shell.expandSidebar')}
              aria-label={t('shell.expandSidebar')}
              aria-expanded={false}
            >
              <PanelLeftOpen className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => onViewChange('shift-records')}
              className="inline-flex size-9 items-center justify-center rounded-md transition hover:bg-white/5"
              title="SyncDrive VTMS"
            >
              <VtmsMark className="size-7" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onViewChange('shift-records')}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left transition hover:bg-white/5"
              title="SyncDrive VTMS"
            >
              <VtmsMark className="size-7 shrink-0" />
              <span className="truncate text-[17px] font-semibold tracking-wide text-white">
                VTMS
              </span>
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/5 hover:text-white"
              title={t('shell.collapseSidebar')}
              aria-label={t('shell.collapseSidebar')}
              aria-expanded
            >
              <PanelLeftClose className="size-5" />
            </button>
          </>
        )}
      </div>

      <nav
        className={`min-h-0 flex-1 overflow-y-auto py-2 ${
          collapsed ? 'px-1.5' : 'px-2'
        }`}
      >
        {SIDEBAR_MODULE_GROUPS.map((group) => {
          const groupLabel = t(group.label);
          const isOpen = expanded[group.id] ?? false;
          const GroupIcon = groupIcon(group.id);
          const dashPages = moduleDashboardPages.filter((page) => page.moduleId === group.id);
          const hasBuiltinItems = Boolean(group.items?.length);
          const hasDashPages = dashPages.length > 0;
          const hasChildren = hasBuiltinItems || hasDashPages;
          const groupActive =
            isBuiltinGroupActive(group.id, activeView)
            || dashPages.some((page) => activeView === moduleDashboardViewId(page.id));
          const canExpand = hasChildren;
          const rowInteractive = group.enabled || hasDashPages || adminMode;

          return (
            <div key={group.id} className="mb-0.5">
              <div
                className={`flex w-full items-center rounded-lg text-[14px] transition ${
                  collapsed ? 'justify-center' : 'gap-1'
                } ${
                  !rowInteractive
                    ? 'text-zinc-600'
                    : groupActive && (!hasChildren || collapsed)
                      ? 'bg-[#1a3a5c] font-medium text-[#5B9BD5]'
                      : groupActive
                        ? 'text-[#5B9BD5]'
                        : 'text-zinc-200'
                }`}
              >
                <button
                  type="button"
                  disabled={!rowInteractive}
                  onClick={() => {
                    if (!rowInteractive) return;
                    if (collapsed) {
                      if (group.enabled && group.navigateTo) {
                        onViewChange(group.navigateTo);
                        return;
                      }
                      const first = group.items?.find((item) => item.enabled);
                      if (group.enabled && first) {
                        onViewChange(first.id);
                        setExpanded((prev) => ({ ...prev, [group.id]: true }));
                        return;
                      }
                      if (dashPages[0]) {
                        onViewChange(moduleDashboardViewId(dashPages[0].id));
                        setExpanded((prev) => ({ ...prev, [group.id]: true }));
                      }
                      return;
                    }
                    if (group.enabled && group.navigateTo && !hasChildren) {
                      onViewChange(group.navigateTo);
                      return;
                    }
                    if (canExpand) {
                      setExpanded((prev) => ({ ...prev, [group.id]: !isOpen }));
                      return;
                    }
                    if (group.enabled && group.navigateTo) {
                      onViewChange(group.navigateTo);
                    }
                  }}
                  className={`flex min-w-0 flex-1 items-center rounded-lg text-left transition ${
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2.5'
                  } ${
                    !rowInteractive
                      ? 'cursor-not-allowed'
                      : 'hover:bg-white/5'
                  }`}
                  title={groupLabel}
                >
                  <GroupIcon
                    className={`size-[18px] shrink-0 ${
                      groupActive && rowInteractive ? 'opacity-100' : 'opacity-80'
                    }`}
                  />
                  {!collapsed ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">{groupLabel}</span>
                      {canExpand ? (
                        isOpen ? (
                          <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-zinc-500" />
                        )
                      ) : null}
                    </>
                  ) : null}
                </button>

                {!collapsed && adminMode ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddModuleDashboard?.(group.id);
                      setExpanded((prev) => ({ ...prev, [group.id]: true }));
                    }}
                    className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-sky-600/20 hover:text-sky-300"
                    title={t('shell.addModulePage', { module: groupLabel })}
                    aria-label={t('shell.addModulePageAria', { module: groupLabel })}
                  >
                    <Plus className="size-4" />
                  </button>
                ) : null}
              </div>

              {!collapsed && canExpand && isOpen && (
                <div className="mt-0.5 space-y-0.5 pb-1 pl-3">
                  {group.enabled && group.items
                    ? group.items.map((item) => {
                        const Icon = SUB_ICONS[item.id] ?? ClipboardList;
                        const active = activeView === item.id;
                        const itemLabel = t(item.label);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!item.enabled}
                            onClick={() => item.enabled && onViewChange(item.id)}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                              !item.enabled
                                ? 'cursor-not-allowed text-zinc-600'
                                : active
                                  ? 'bg-[#1a3a5c] font-medium text-white'
                                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                            }`}
                            title={!item.enabled ? t('shell.comingSoon') : itemLabel}
                          >
                            <Icon className="size-3.5 shrink-0 opacity-80" />
                            <span className="truncate">{itemLabel}</span>
                          </button>
                        );
                      })
                    : null}

                  {dashPages.map((page) => {
                    const viewId = moduleDashboardViewId(page.id);
                    const active = activeView === viewId;
                    const isRenaming = renamingPageId === page.id;
                    return (
                      <div key={page.id} className="group/item flex items-center gap-0.5">
                        {isRenaming ? (
                          <div
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 ${
                              active ? 'bg-[#1a3a5c]' : 'bg-white/5'
                            }`}
                          >
                            <LayoutDashboard className="size-3.5 shrink-0 text-zinc-300 opacity-80" />
                            <input
                              ref={renameInputRef}
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitRename();
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setRenamingPageId(null);
                                }
                              }}
                              className="min-w-0 flex-1 rounded border border-sky-500/60 bg-zinc-950 px-1.5 py-0.5 text-[13px] text-white outline-none"
                              aria-label={t('shell.renamePageInput')}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onViewChange(viewId)}
                            onDoubleClick={(event) => {
                              if (!adminMode) return;
                              event.preventDefault();
                              startRename(page);
                            }}
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                              active
                                ? 'bg-[#1a3a5c] font-medium text-white'
                                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                            }`}
                            title={
                              adminMode
                                ? t('shell.renamePageHint', { name: page.label })
                                : page.label
                            }
                          >
                            <LayoutDashboard className="size-3.5 shrink-0 opacity-80" />
                            <span className="truncate">{page.label}</span>
                          </button>
                        )}
                        {adminMode && !isRenaming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => startRename(page)}
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 opacity-0 transition hover:bg-sky-600/15 hover:text-sky-300 group-hover/item:opacity-100"
                              title={t('shell.renamePage')}
                              aria-label={t('shell.renamePageAria', {
                                name: page.label,
                              })}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveModuleDashboard?.(page.id)}
                              className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover/item:opacity-100"
                              title={t('shell.removePage')}
                              aria-label={t('shell.removePageAria', {
                                name: page.label,
                              })}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div
        className={`shrink-0 space-y-0.5 border-t border-white/10 py-3 ${
          collapsed ? 'px-1.5' : 'px-2'
        }`}
      >
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className={`flex w-full items-center rounded-lg text-[14px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 ${
              collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
            }`}
            title={t('shell.appSettings')}
          >
            <Settings className="size-[18px] shrink-0" />
            {!collapsed ? <span>{t('shell.appSettings')}</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onViewChange('dashboard')}
          className={`flex w-full items-center rounded-lg text-[14px] transition ${
            collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
          } ${
            activeView === 'dashboard'
              ? 'bg-[#1a3a5c] font-medium text-white'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
          }`}
          title={t('nav.items.dashboard')}
        >
          <LayoutDashboard className="size-[18px] shrink-0" />
          {!collapsed ? <span>{t('nav.items.dashboard')}</span> : null}
        </button>
        <button
          type="button"
          disabled
          className={`flex w-full cursor-not-allowed items-center text-[14px] text-zinc-600 ${
            collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
          }`}
          title={t('shell.comingSoon')}
        >
          <Headphones className="size-[18px] shrink-0" />
          {!collapsed ? <span>{t('shell.comingSoon')}</span> : null}
        </button>
      </div>
    </aside>
  );
}
