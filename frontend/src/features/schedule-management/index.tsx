import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ClipboardList,
  DoorOpen,
  FileText,
  LayoutDashboard,
  List,
  Map,
  Pentagon,
  Route,
  Send,
  Wrench,
  Activity,
} from 'lucide-react';
import { ViewErrorBoundary } from '../../components/ViewErrorBoundary';
import DashboardEditor from '../dashboard';
import MapEditorApp from '../map-editor';
import ShiftRecordsApp from '../shift-records';
import TimeTemplatesApp from '../time-templates';
import MaintenanceTasksApp from '../maintenance-tasks';
import ShiftListApp from '../shift-list';
import ShiftDeploymentApp from '../shift-deployment';
import DispatchSchedulingApp from '../dispatch-scheduling';
import PsdControlApp from '../psd-control';
import VirtualFenceManagementApp from '../virtual-fence-management';
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
import { useSupervisorApprovalPreference } from './utils/supervisorApprovalPreference';
import {
  createModuleDashboardPageId,
  moduleDashboardViewId,
  parseModuleDashboardViewId,
  readModuleDashboardPages,
  refreshDashboardPlanesCache,
  refreshModuleDashboardPages,
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
  if (view === 'shift-deployment') {
    return {
      title: '班表部署管理',
      icon: <Activity className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'dispatch-scheduling') {
    return {
      title: '派遣調度管理',
      icon: <Send className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'psd-control') {
    return {
      title: '車門月台控制',
      icon: <DoorOpen className="size-4 text-sky-400" aria-hidden />,
    };
  }
  if (view === 'virtual-fence') {
    return {
      title: '虛擬圍籬管理',
      icon: <Pentagon className="size-4 text-sky-400" aria-hidden />,
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
  const [supervisorApproval, setSupervisorApproval] = useSupervisorApprovalPreference();
  const [modulePages, setModulePages] = useState(readModuleDashboardPages);
  const [attachModuleId, setAttachModuleId] = useState<string | null>(null);

  /**
   * 模組頁面對應以後端為準。
   *
   * 這份對應是系統配置而非個人偏好——管理者設定好之後，所有操作人員看到的模組頁面
   * 必須一致。初始 state 先給快取讓畫面立刻有東西，掛載後再用後端覆蓋；後端是空的
   * 或連不上就沿用快取。
   */
  useEffect(() => {
    let cancelled = false;
    void refreshModuleDashboardPages().then((pages) => {
      if (!cancelled) setModulePages(pages);
    });
    // 版面要一起拉。只補對應的話，乾淨的瀏覽器點進子頁會看到「找不到儀表板平面」
    // ——對應查得到、版面還在後端沒進本機快取。
    void refreshDashboardPlanesCache();
    return () => {
      cancelled = true;
    };
  }, []);

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
    supervisorApproval,
    onSupervisorApprovalChange: setSupervisorApproval,
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

        {view === 'shift-deployment' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="班表部署管理載入失敗">
              <ShiftDeploymentApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'dispatch-scheduling' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="派遣調度管理載入失敗">
              <DispatchSchedulingApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'psd-control' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="車門月台控制載入失敗">
              <PsdControlApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'virtual-fence' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="虛擬圍籬管理載入失敗">
              <VirtualFenceManagementApp />
            </ViewErrorBoundary>
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
            className={`absolute inset-0 z-20 flex min-h-0 flex-col ${
              view === 'map' ? '' : 'pointer-events-none hidden'
            }`}
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
            className={`absolute inset-0 z-20 flex min-h-0 flex-col ${
              view === 'trajectory' ? '' : 'pointer-events-none hidden'
            }`}
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
