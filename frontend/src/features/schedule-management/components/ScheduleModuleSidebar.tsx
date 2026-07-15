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
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import type { ScheduleSubView } from '../types';
import { SIDEBAR_MODULE_GROUPS } from '../types';

type ScheduleModuleSidebarProps = {
  activeView: ScheduleSubView;
  onViewChange: (view: ScheduleSubView) => void;
  onBackToHome?: () => void;
};

const SUB_ICONS: Record<ScheduleSubView, typeof ClipboardList> = {
  'shift-records': ClipboardList,
  'time-templates': FileText,
  'shift-list': List,
  'maintenance-tasks': Wrench,
};

export function ScheduleModuleSidebar({
  activeView,
  onViewChange,
  onBackToHome,
}: ScheduleModuleSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ schedule: true });

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#08080a]">
      <button
        type="button"
        onClick={onBackToHome}
        className="flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-4 text-left transition hover:bg-zinc-900/60"
        title="返回首頁"
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
          const isSchedule = group.id === 'schedule';
          const isOpen = expanded[group.id] ?? isSchedule;
          const GroupIcon = isSchedule ? CalendarDays : LayoutDashboard;

          return (
            <div key={group.id} className="mb-1">
              <button
                type="button"
                disabled={!group.enabled}
                onClick={() => {
                  if (!group.enabled) return;
                  setExpanded((prev) => ({ ...prev, [group.id]: !isOpen }));
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  group.enabled
                    ? 'text-zinc-200 hover:bg-zinc-900/80'
                    : 'cursor-not-allowed text-zinc-600'
                } ${isSchedule ? 'bg-zinc-900/40' : ''}`}
              >
                <GroupIcon className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                {group.items && group.enabled ? (
                  isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-zinc-500" />
                  )
                ) : null}
              </button>

              {group.items && group.enabled && isOpen && (
                <div className="ml-2 mt-0.5 space-y-0.5 border-l border-zinc-800/80 pl-2">
                  {group.items.map((item) => {
                    const Icon = SUB_ICONS[item.id];
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

      <div className="border-t border-zinc-800/80 px-4 py-3">
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
