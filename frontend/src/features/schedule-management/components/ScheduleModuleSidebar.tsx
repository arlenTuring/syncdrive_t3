import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cpu,
  FileText,
  HelpCircle,
  LayoutDashboard,
  List,
  Map,
  Route,
  Settings,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ShellView } from '../types';
import { SIDEBAR_MODULE_GROUPS } from '../types';

type ScheduleModuleSidebarProps = {
  activeView: ShellView;
  onViewChange: (view: ShellView) => void;
  onOpenSettings?: () => void;
};

const SUB_ICONS: Partial<Record<ShellView, typeof ClipboardList>> = {
  'shift-records': ClipboardList,
  'time-templates': FileText,
  'shift-list': List,
  'maintenance-tasks': Wrench,
  trajectory: Route,
};

function groupIcon(groupId: string) {
  if (groupId === 'schedule') return CalendarDays;
  if (groupId === 'monitor') return LayoutDashboard;
  if (groupId === 'vehicle') return Route;
  if (groupId === 'site') return Map;
  return LayoutDashboard;
}

function isGroupActive(groupId: string, activeView: ShellView): boolean {
  if (groupId === 'monitor') return activeView === 'dashboard';
  if (groupId === 'site') return activeView === 'map';
  if (groupId === 'vehicle') return activeView === 'trajectory';
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

export function ScheduleModuleSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
}: ScheduleModuleSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    schedule: true,
    vehicle: true,
  });

  useEffect(() => {
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
  }, [activeView]);

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#08080a]">
      <button
        type="button"
        onClick={() => onViewChange('shift-records')}
        className="flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-4 text-left transition hover:bg-zinc-900/60"
        title="回到班次運行紀錄"
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
          <Cpu className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">SyncDrive</div>
          <div className="text-[10px] tracking-wider text-zinc-500">VTMS</div>
        </div>
      </button>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {SIDEBAR_MODULE_GROUPS.map((group) => {
          const isOpen = expanded[group.id] ?? false;
          const GroupIcon = groupIcon(group.id);
          const groupActive = isGroupActive(group.id, activeView);
          const hasItems = Boolean(group.items?.length);

          return (
            <div key={group.id} className="mb-1">
              <button
                type="button"
                disabled={!group.enabled}
                onClick={() => {
                  if (!group.enabled) return;
                  if (group.navigateTo) {
                    onViewChange(group.navigateTo);
                    return;
                  }
                  if (hasItems) {
                    setExpanded((prev) => ({ ...prev, [group.id]: !isOpen }));
                  }
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  !group.enabled
                    ? 'cursor-not-allowed text-zinc-600'
                    : groupActive && !hasItems
                      ? 'bg-sky-600/20 font-medium text-sky-300'
                      : groupActive
                        ? 'bg-zinc-900/40 text-zinc-100'
                        : 'text-zinc-200 hover:bg-zinc-900/80'
                }`}
              >
                <GroupIcon className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                {hasItems && group.enabled ? (
                  isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-zinc-500" />
                  )
                ) : null}
              </button>

              {hasItems && group.enabled && isOpen && (
                <div className="ml-2 mt-0.5 space-y-0.5 border-l border-zinc-800/80 pl-2">
                  {group.items!.map((item) => {
                    const Icon = SUB_ICONS[item.id] ?? ClipboardList;
                    const active = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!item.enabled}
                        onClick={() => item.enabled && onViewChange(item.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition ${
                          !item.enabled
                            ? 'cursor-not-allowed text-zinc-600'
                            : active
                              ? 'bg-sky-600/20 font-medium text-sky-300'
                              : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200'
                        }`}
                        title={!item.enabled ? '功能開發中' : undefined}
                      >
                        <Icon className="size-3.5 shrink-0 opacity-80" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-zinc-800/80 px-4 py-3">
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-0 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            title="應用程式設定"
          >
            <Settings className="size-4" />
            應用程式設定
          </button>
        ) : null}
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-2 text-sm text-zinc-600"
          title="說明中心開發中"
        >
          <HelpCircle className="size-4" />
          說明中心
        </button>
      </div>
    </aside>
  );
}
