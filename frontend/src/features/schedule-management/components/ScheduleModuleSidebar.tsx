import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  DoorOpen,
  FileText,
  LayoutDashboard,
  List,
  ListChecks,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pentagon,
  Plus,
  Route,
  History,
  Repeat,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  Wrench,
  Volume2,
  BellRing,
  ScrollText,
  Video,
  KeyRound,
  LogIn,
  Film,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ShellView } from "../types";
import {
  isEventsView,
  isLogsView,
  isOperationsView,
  isSiteView,
  SIDEBAR_MODULE_GROUPS,
  permissionSatisfied,
} from "../types";
import type { ModuleDashboardPage } from "../utils/moduleDashboardPages";
import {
  moduleDashboardViewId,
  parseModuleDashboardViewId,
} from "../utils/moduleDashboardPages";
import { ShellClock } from "./ShellClock";
import { useModuleAddModePreference } from "../utils/moduleAddModePreference";
import { IconButton } from '../../../components/ui';

const SIDEBAR_COLLAPSED_KEY = "syncdrive_vtms_sidebar_collapsed";
const VTMS_MARK_SRC = "/logo.svg";

type ScheduleModuleSidebarProps = {
  activeView: string;
  onViewChange: (view: ShellView | string) => void;
  adminMode?: boolean;
  moduleDashboardPages?: ModuleDashboardPage[];
  onAddModuleDashboard?: (moduleId: string) => void;
  onRenameModuleDashboard?: (pageId: string, label: string) => void;
  onRemoveModuleDashboard?: (pageId: string) => void;
  permissions?: string[];
};

const SUB_ICONS: Partial<Record<ShellView, typeof ClipboardList>> = {
  "event-list": BellRing,
  "video-monitor": Video,
  "video-resources": Film,
  "log-system": ScrollText,
  "log-permissions": KeyRound,
  "log-operations": ClipboardList,
  "log-authentication": LogIn,
  "shift-deployment": Activity,
  "degraded-operation": AlertTriangle,
  "dispatch-scheduling": Send,
  "vehicle-rotation": Repeat,
  "scheduled-orders": ListChecks,
  "psd-control": DoorOpen,
  "virtual-fence": Pentagon,
  map: Map,
  "shift-records": ClipboardList,
  "time-templates": FileText,
  "shift-list": List,
  "maintenance-tasks": Wrench,
  "vehicle-realtime": Route,
  "vehicle-registry": Route,
  "vehicle-run-history": History,
  "media-content": Volume2,
  "media-groups": Volume2,
  "media-schedule": Volume2,
  "account-management": UserRoundCog,
  "role-management": ShieldCheck,
};

function groupIcon(groupId: string) {
  if (groupId === "schedule") return CalendarDays;
  if (groupId === "monitor") return Activity;
  if (groupId === "vehicle") return Route;
  if (groupId === "site") return Map;
  if (groupId === "operations") return Activity;
  if (groupId === "permission") return Settings;
  if (groupId === "media") return Volume2;
  if (groupId === "events") return BellRing;
  if (groupId === "logs") return ScrollText;
  if (groupId === "service") {
    return LayoutDashboard;
  }
  return LayoutDashboard;
}

function isBuiltinGroupActive(groupId: string, activeView: string): boolean {
  if (groupId === "site") return isSiteView(activeView);
  if (groupId === "events") return isEventsView(activeView);
  if (groupId === "logs") return isLogsView(activeView);
  if (groupId === "vehicle")
    return (
      activeView === "vehicle-realtime" ||
      activeView === "vehicle-registry" ||
      activeView === "vehicle-run-history"
    );
  if (groupId === "operations") return isOperationsView(activeView);
  if (groupId === "service") return activeView === "scheduled-orders";
  if (groupId === "permission")
    return (
      activeView === "account-management" || activeView === "role-management"
    );
  if (groupId === "media")
    return (
      activeView === "media-content" ||
      activeView === "media-groups" ||
      activeView === "media-schedule"
    );
  if (groupId === "schedule") {
    return (
      activeView === "shift-records" ||
      activeView === "time-templates" ||
      activeView === "shift-list" ||
      activeView === "maintenance-tasks"
    );
  }
  return false;
}

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
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
  adminMode = false,
  moduleDashboardPages = [],
  onAddModuleDashboard,
  onRenameModuleDashboard,
  onRemoveModuleDashboard,
  permissions = [],
}: ScheduleModuleSidebarProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [moduleAddMode] = useModuleAddModePreference();
  // 子頁的新增、改名、移除都只在「模組編輯頁面模式」（儀表介面管理的開關）開啟時可用
  const canEditPages = adminMode && moduleAddMode;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    operations: true,
    service: true,
    schedule: true,
    vehicle: true,
    site: true,
  });
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // 編輯模式關掉時，正在改名的輸入框跟著收起（不送出）
  const editingPageId = canEditPages ? renamingPageId : null;

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
    if (activeView === "scheduled-orders")
      setExpanded((prev) => ({ ...prev, service: true }));
    if (isSiteView(activeView)) {
      setExpanded((prev) => ({ ...prev, site: true }));
    }
    if (
      activeView === "shift-records" ||
      activeView === "time-templates" ||
      activeView === "shift-list" ||
      activeView === "maintenance-tasks"
    ) {
      setExpanded((prev) => ({ ...prev, schedule: true }));
    }
    if (
      activeView === "vehicle-realtime" ||
      activeView === "vehicle-registry" ||
      activeView === "vehicle-run-history"
    ) {
      setExpanded((prev) => ({ ...prev, vehicle: true }));
    }
    if (
      activeView === "media-content" ||
      activeView === "media-groups" ||
      activeView === "media-schedule"
    )
      setExpanded((prev) => ({ ...prev, media: true }));
    if (isEventsView(activeView))
      setExpanded((prev) => ({ ...prev, events: true }));
    if (isLogsView(activeView))
      setExpanded((prev) => ({ ...prev, logs: true }));
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
    // Navigation 規格：展開 280、收合 80；選單狀態見 components/navigation/navigation.css
    <aside className="t3-nav" data-collapsed={collapsed ? "true" : undefined}>
      <div className={collapsed ? "t3-nav__top" : "t3-nav__top"}>
        <div className={collapsed ? "flex flex-col items-center gap-2" : "t3-nav__logo-row"}>
        {collapsed ? (
          <>
            <button type="button" className="t3-nav__toggle" onClick={toggleCollapsed} title={t("shell.expandSidebar")} aria-label={t("shell.expandSidebar")} aria-expanded={false}>
              <PanelLeftOpen />
            </button>
            <button
              type="button"
              onClick={() => onViewChange("shift-records")}
              className="t3-nav__brand"
              title="SyncDrive VTMS"
            >
              <VtmsMark className="size-6" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onViewChange("shift-records")}
              className="t3-nav__brand"
              title="SyncDrive VTMS"
            >
              <VtmsMark className="size-6 shrink-0" />
              <span className="t3-nav__brand-text">VTMS</span>
            </button>
            <button type="button" className="t3-nav__toggle" onClick={toggleCollapsed} title={t("shell.collapseSidebar")} aria-label={t("shell.collapseSidebar")} aria-expanded>
              <PanelLeftClose />
            </button>
          </>
        )}
        </div>
      </div>

      <nav className="t3-nav__menu">
        {SIDEBAR_MODULE_GROUPS.map((group) => {
          const groupLabel = t(group.label);
          const isOpen = expanded[group.id] ?? false;
          const GroupIcon = groupIcon(group.id);
          const dashPages = permissions.includes("dashboard.dashboard.view")
            ? moduleDashboardPages.filter((page) => page.moduleId === group.id)
            : [];
          const visibleItems =
            group.items?.filter(
              (item) =>
                !item.requiredPermission ||
                permissionSatisfied(item.requiredPermission, (p) =>
                  permissions.includes(p),
                ),
            ) ?? [];
          if (
            group.items &&
            visibleItems.length === 0 &&
            dashPages.length === 0
          )
            return null;
          const hasBuiltinItems = visibleItems.length > 0;
          const hasDashPages = dashPages.length > 0;
          const hasChildren = hasBuiltinItems || hasDashPages;
          const groupActive =
            isBuiltinGroupActive(group.id, activeView) ||
            dashPages.some(
              (page) => activeView === moduleDashboardViewId(page.id),
            );
          const canExpand = hasChildren;
          const rowInteractive = group.enabled || hasDashPages || adminMode;

          return (
            <div key={group.id} className="flex flex-col gap-2">
              <div className={`flex w-full items-center ${collapsed ? "justify-center" : "gap-1"}`}>
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
                      const first = visibleItems.find((item) => item.enabled);
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
                  className="t3-nav__item"
                  // 沒有子選單、或收合時：所在群組就是目前選取（On）；有子選單時是所在群組（On-Open／On-Close）
                  data-state={
                    groupActive && (!hasChildren || collapsed)
                      ? "on"
                      : `${groupActive ? "on" : "off"}-${isOpen && canExpand ? "open" : "close"}`
                  }
                  title={groupLabel}
                >
                  <span className="t3-nav__icon"><GroupIcon /></span>
                  {!collapsed ? (
                    <>
                      <span className="t3-nav__label">{groupLabel}</span>
                      {canExpand ? (
                        <span className="t3-nav__arrow" aria-hidden>{isOpen ? <ChevronUp /> : <ChevronDown />}</span>
                      ) : null}
                    </>
                  ) : null}
                </button>

                {/* ＋號只在「模組編輯頁面」模式開啟時出現（儀表介面管理的開關），平常不佔側欄空間 */}
                {!collapsed && canEditPages ? (
                  <IconButton size="small" hierarchy="subordinate" variant="standard" className="mr-1 shrink-0" onPress={(event) => {
           event.stopPropagation();
           onAddModuleDashboard?.(group.id);
           setExpanded((prev) => ({ ...prev, [group.id]: true }));
          }} title={t("shell.addModulePage", { module: groupLabel })} label={t("shell.addModulePageAria", {
           module: groupLabel,
          })} icon={<Plus />} />
                ) : null}
              </div>

              {!collapsed && canExpand && isOpen && (
                <div className="flex flex-col gap-2">
                  {group.enabled && visibleItems.length
                    ? visibleItems.map((item) => {
                        const Icon = SUB_ICONS[item.id] ?? ClipboardList;
                        const active = activeView === item.id;
                        const itemLabel = t(item.label);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!item.enabled}
                            onClick={() =>
                              item.enabled && onViewChange(item.id)
                            }
                            className="t3-nav__item t3-nav__item--sub"
                            data-state={active ? "on" : "off"}
                            title={
                              !item.enabled ? t("shell.comingSoon") : itemLabel
                            }
                          >
                            <span className="t3-nav__icon"><Icon /></span>
                            <span className="t3-nav__label">{itemLabel}</span>
                          </button>
                        );
                      })
                    : null}

                  {dashPages.map((page) => {
                    const viewId = moduleDashboardViewId(page.id);
                    const active = activeView === viewId;
                    const isRenaming = editingPageId === page.id;
                    return (
                      <div
                        key={page.id}
                        className="group/item flex items-center gap-0.5"
                      >
                        {isRenaming ? (
                          <div
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 ${
                              active ? "bg-link-tonal" : "bg-link-standard"
                            }`}
                          >
                            <LayoutDashboard className="size-3.5 shrink-0 text-text-secondary opacity-80" />
                            <input
                              ref={renameInputRef}
                              value={renameDraft}
                              onChange={(event) =>
                                setRenameDraft(event.target.value)
                              }
                              onBlur={commitRename}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitRename();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setRenamingPageId(null);
                                }
                              }}
                              className="min-w-0 flex-1 rounded border border-border-theme-light bg-surface-sub-background px-1.5 py-0.5 text-body-s text-text-primary outline-none"
                              aria-label={t("shell.renamePageInput")}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onViewChange(viewId)}
                            onDoubleClick={(event) => {
                              if (!canEditPages) return;
                              event.preventDefault();
                              startRename(page);
                            }}
                            className="t3-nav__item t3-nav__item--sub min-w-0 flex-1"
                            data-state={active ? "on" : "off"}
                            title={
                              canEditPages
                                ? t("shell.renamePageHint", {
                                    name: page.label,
                                  })
                                : page.label
                            }
                          >
                            <span className="t3-nav__icon"><LayoutDashboard /></span>
                            <span className="t3-nav__label">{page.label}</span>
                          </button>
                        )}
                        {canEditPages && !isRenaming ? (
                          <>
                            <IconButton size="small" hierarchy="subordinate" variant="standard" className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover/item:opacity-100" onPress={() => startRename(page)} title={t("shell.renamePage")} label={t("shell.renamePageAria", {
                name: page.label,
               })} icon={<Pencil />} />
                            <IconButton size="small" hierarchy="danger" variant="standard" className="mr-1 shrink-0 opacity-0 focus-visible:opacity-100 group-hover/item:opacity-100" onPress={() => onRemoveModuleDashboard?.(page.id)} title={t("shell.removePage")} label={t("shell.removePageAria", {
                name: page.label,
               })} icon={<Trash2 />} />
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

      <div className="shrink-0 border-t border-border-quaternary px-4 pt-3">
        <ShellClock compact={collapsed} />
      </div>
    </aside>
  );
}
