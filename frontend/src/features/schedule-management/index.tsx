import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  List,
  Map,
  Route,
  Wrench,
} from 'lucide-react';
import { ViewErrorBoundary } from '../../components/ViewErrorBoundary';
import DashboardEditor from '../dashboard';
import MapEditorApp from '../map-editor';
import ShiftRecordsApp from '../shift-records';
import TimeTemplatesApp from '../time-templates';
import MaintenanceTasksApp from '../maintenance-tasks';
import ShiftListApp from '../shift-list';
import type { ShellView } from './types';
import { SIDEBAR_MODULE_GROUPS } from './types';
import { ScheduleModuleSidebar } from './components/ScheduleModuleSidebar';
import { ShellWorkspaceFrame } from './components/ShellWorkspaceFrame';
import { AttachModuleDashboardDialog } from './components/AttachModuleDashboardDialog';
import { ModuleDashboardRuntimeView } from './components/ModuleDashboardRuntimeView';
import {
  readAdminModePreference,
  writeAdminModePreference,
} from './utils/adminModePreference';
import {
  createModuleDashboardPageId,
  moduleDashboardViewId,
  parseModuleDashboardViewId,
  readModuleDashboardPages,
  writeModuleDashboardPages,
  type ModuleDashboardPage,
} from './utils/moduleDashboardPages';

type ScheduleManagementAppProps = {
  /** @deprecated 首頁即 VTMS；保留參數以相容舊呼叫 */
  onBackToHome?: () => void;
  initialView?: ShellView;
  onOpenSettings?: () => void;
};

function resolveWorkspaceChrome(
  view: string,
  modulePages: ModuleDashboardPage[],
): {
  title: string;
  icon: ReactNode;
} {
  const mdpId = parseModuleDashboardViewId(view);
  if (mdpId) {
    const page = modulePages.find((item) => item.id === mdpId);
    const moduleLabel =
      SIDEBAR_MODULE_GROUPS.find((group) => group.id === page?.moduleId)?.label
      ?? '模組';
    return {
      title: page?.label ? `${moduleLabel} · ${page.label}` : moduleLabel,
      icon: <LayoutDashboard className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'dashboard') {
    return {
      title: '儀表板管理',
      icon: <LayoutDashboard className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'map') {
    return {
      title: '場域管理模組',
      icon: <Map className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'trajectory') {
    return {
      title: '載具管理模組',
      icon: <Route className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'time-templates') {
    return {
      title: '班表管理模組',
      icon: <FileText className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'shift-list') {
    return {
      title: '班表管理模組',
      icon: <List className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'maintenance-tasks') {
    return {
      title: '班表管理模組',
      icon: <Wrench className="size-4 text-sky-400" aria-hidden />,
    };
  }
  return {
    title: '班表管理模組',
    icon: <ClipboardList className="size-4 text-sky-400" aria-hidden />,
  };
}

export default function ScheduleManagementApp({
  initialView = 'shift-records',
  onOpenSettings,
}: ScheduleManagementAppProps) {
  const [view, setView] = useState<string>(initialView);
  const [mapMounted, setMapMounted] = useState(initialView === 'map');
  const [trajectoryMounted, setTrajectoryMounted] = useState(initialView === 'trajectory');
  const [adminMode, setAdminMode] = useState(readAdminModePreference);
  const [modulePages, setModulePages] = useState(readModuleDashboardPages);
  const [attachModuleId, setAttachModuleId] = useState<string | null>(null);

  useEffect(() => {
    if (view === 'map') setMapMounted(true);
    if (view === 'trajectory') setTrajectoryMounted(true);
  }, [view]);

  useEffect(() => {
    writeAdminModePreference(adminMode);
  }, [adminMode]);

  useEffect(() => {
    writeModuleDashboardPages(modulePages);
  }, [modulePages]);

  const chrome = resolveWorkspaceChrome(view, modulePages);
  const activeModulePage = useMemo(() => {
    const id = parseModuleDashboardViewId(view);
    if (!id) return null;
    return modulePages.find((page) => page.id === id) ?? null;
  }, [view, modulePages]);

  const attachModuleLabel =
    SIDEBAR_MODULE_GROUPS.find((group) => group.id === attachModuleId)?.label
    ?? '模組';

  const frameProps = {
    adminMode,
    onAdminModeChange: setAdminMode,
  };

  const scheduleContent = (
    <>
      {view === 'shift-records' && <ShiftRecordsApp embedded />}
      {view === 'time-templates' && <TimeTemplatesApp embedded />}
      {view === 'shift-list' && <ShiftListApp embedded />}
      {view === 'maintenance-tasks' && <MaintenanceTasksApp embedded />}
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full bg-black">
      <ScheduleModuleSidebar
        activeView={view}
        onViewChange={setView}
        onOpenSettings={onOpenSettings}
        adminMode={adminMode}
        moduleDashboardPages={modulePages}
        onAddModuleDashboard={setAttachModuleId}
        onRenameModuleDashboard={(pageId, label) => {
          setModulePages((prev) =>
            prev.map((page) => (page.id === pageId ? { ...page, label } : page)),
          );
        }}
        onRemoveModuleDashboard={(pageId) => {
          setModulePages((prev) => prev.filter((page) => page.id !== pageId));
          if (view === moduleDashboardViewId(pageId)) {
            setView('shift-records');
          }
        }}
      />
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {activeModulePage ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ModuleDashboardRuntimeView
              planeId={activeModulePage.planeId}
              pageLabel={activeModulePage.label}
            />
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'dashboard' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} flush {...frameProps}>
            <DashboardEditor />
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'shift-records'
        || view === 'time-templates'
        || view === 'shift-list'
        || view === 'maintenance-tasks' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            {scheduleContent}
          </ShellWorkspaceFrame>
        ) : null}

        {mapMounted ? (
          <div
            className="absolute inset-0 flex min-h-0 flex-col"
            style={{ display: view === 'map' ? 'flex' : 'none' }}
          >
            <ShellWorkspaceFrame
              title="場域管理模組"
              titleIcon={<Map className="size-4 text-sky-400" aria-hidden />}
              flush
              {...frameProps}
            >
              <ViewErrorBoundary title="場域管理載入失敗">
                <MapEditorApp workspace="map" />
              </ViewErrorBoundary>
            </ShellWorkspaceFrame>
          </div>
        ) : null}

        {trajectoryMounted ? (
          <div
            className="absolute inset-0 flex min-h-0 flex-col"
            style={{ display: view === 'trajectory' ? 'flex' : 'none' }}
          >
            <ShellWorkspaceFrame
              title="載具管理模組"
              titleIcon={<Route className="size-4 text-sky-400" aria-hidden />}
              flush
              {...frameProps}
            >
              <ViewErrorBoundary title="載具軌跡圖台載入失敗">
                <MapEditorApp workspace="trajectory" />
              </ViewErrorBoundary>
            </ShellWorkspaceFrame>
          </div>
        ) : null}
      </main>

      {attachModuleId ? (
        <AttachModuleDashboardDialog
          moduleLabel={attachModuleLabel}
          onCancel={() => setAttachModuleId(null)}
          onConfirm={({ planeId, label }) => {
            const page: ModuleDashboardPage = {
              id: createModuleDashboardPageId(),
              moduleId: attachModuleId,
              label,
              planeId,
              createdAt: Date.now(),
            };
            setModulePages((prev) => [...prev, page]);
            setAttachModuleId(null);
            setView(moduleDashboardViewId(page.id));
          }}
        />
      ) : null}
    </div>
  );
}
