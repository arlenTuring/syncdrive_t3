import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ClipboardList,
  DoorOpen,
  FileText,
  LayoutDashboard,
  List,
  Map,
  Pentagon,
  Route,
  Send,
  Settings2,
  Wrench,
  Activity,
  ShieldCheck,
  UserRoundCog,
  Volume2,
} from 'lucide-react';
import { ViewErrorBoundary } from '../../components/ViewErrorBoundary';
import MapEditorApp from '../map-editor';
import ShiftRecordsApp from '../shift-records';
import TimeTemplatesApp from '../time-templates';
import MaintenanceTasksApp from '../maintenance-tasks';
import ShiftListApp from '../shift-list';
import ShiftDeploymentApp from '../shift-deployment';
import DegradedOperationApp from '../degraded-operation';
import DispatchSchedulingApp from '../dispatch-scheduling';
import PsdControlApp from '../psd-control';
import VirtualFenceManagementApp from '../virtual-fence-management';
import SystemFoundationApp from '../system-foundation';
import { AccountManagementPage } from '../access-control/AccountManagementPage';
import { RoleManagementPage } from '../access-control/RoleManagementPage';
import { VehicleRealtimePage } from '../vehicle-realtime/VehicleRealtimePage';
import { VehicleRegistryPage } from '../vehicle-registry/VehicleRegistryPage';
import { RunHistoryPage } from '../vehicle-run-history/RunHistoryPage';
import { MediaContentPage } from '../media-content/MediaContentPage';
import { MediaGroupsPage } from '../media-groups/MediaGroupsPage';
import { MediaSchedulesPage } from '../media-schedules/MediaSchedulesPage';
import { EventListPage } from '../event-management/EventListPage';
import { VideoMonitorPage } from '../event-management/VideoMonitorPage';
import { LogPage } from '../log-management/LogPage';
import { isEventsView, isLogsView } from './types';
import { useAuth } from '../access-control/AuthContext';
import type { ShellView } from './types';
import {
  OPEN_VEHICLE_MODELS_EVENT,
  type OpenVehicleModelsDetail,
} from '../../lib/vehicleModelNavigation';
import { SIDEBAR_MODULE_GROUPS, VIEW_PERMISSIONS } from './types';
import { ScheduleModuleSidebar } from './components/ScheduleModuleSidebar';
import { ShellWorkspaceFrame } from './components/ShellWorkspaceFrame';
import { AttachModuleDashboardDialog } from './components/AttachModuleDashboardDialog';
import { ModuleDashboardRuntimeView } from './components/ModuleDashboardRuntimeView';
import {
  useAdminModePreference,
} from './utils/adminModePreference';
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
};

function useWorkspaceChrome(
  view: string,
  modulePages: ModuleDashboardPage[],
): {
  title: string;
  icon: ReactNode;
} {
  const { t } = useTranslation();

  return useMemo(() => {
    const mdpId = parseModuleDashboardViewId(view);
    if (mdpId) {
      const page = modulePages.find((item) => item.id === mdpId);
      const moduleKey =
        SIDEBAR_MODULE_GROUPS.find((group) => group.id === page?.moduleId)
          ?.label ?? null;
      const moduleLabel = moduleKey ? t(moduleKey) : t('common.module');
      return {
        // 使用者自訂別名 page.label 不翻譯
        title: page?.label ? `${moduleLabel} · ${page.label}` : moduleLabel,
        icon: <LayoutDashboard className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'shift-deployment') {
      return {
        title: t('nav.items.shift-deployment'),
        icon: <Activity className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'degraded-operation') {
      return {
        title: t('nav.items.degraded-operation'),
        icon: <AlertTriangle className="size-4 text-amber-400" aria-hidden />,
      };
    }
    if (view === 'dispatch-scheduling') {
      return {
        title: t('nav.items.dispatch-scheduling'),
        icon: <Send className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'psd-control') {
      return {
        title: t('nav.items.psd-control'),
        icon: <DoorOpen className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'virtual-fence') {
      return {
        title: t('nav.items.virtual-fence'),
        icon: <Pentagon className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'dashboard') {
      return {
        title: t('nav.items.dashboard'),
        icon: <LayoutDashboard className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'map') {
      return {
        title: t('nav.items.map'),
        icon: <Map className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'vehicle-realtime') {
      return {
        title: '載具即時清單',
        icon: <Route className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'vehicle-run-history') {
      return { title: '運行管理紀錄', icon: <Route className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'vehicle-registry') {
      return { title: '載具註冊管理', icon: <Route className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'media-content') {
      return { title: t('nav.items.media-content'), icon: <Volume2 className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'media-groups') {
      return { title: t('nav.items.media-groups'), icon: <Volume2 className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'media-schedule') {
      return { title: t('nav.items.media-schedule'), icon: <Volume2 className="size-4 text-sky-400" aria-hidden /> };
    }
    if (isEventsView(view) || isLogsView(view)) {
      return { title: t(`nav.items.${view}`), icon: <ClipboardList className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'system-foundation') {
      return {
        title: t('nav.modules.system'),
        icon: <Settings2 className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'account-management') {
      return { title: '帳號管理中心', icon: <UserRoundCog className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'role-management') {
      return { title: '角色管理設定', icon: <ShieldCheck className="size-4 text-sky-400" aria-hidden /> };
    }
    if (view === 'time-templates') {
      return {
        title: t('nav.modules.schedule'),
        icon: <FileText className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'shift-list') {
      return {
        title: t('nav.modules.schedule'),
        icon: <List className="size-4 text-sky-400" aria-hidden />,
      };
    }
    if (view === 'maintenance-tasks') {
      return {
        title: t('nav.modules.schedule'),
        icon: <Wrench className="size-4 text-sky-400" aria-hidden />,
      };
    }
    return {
      title: t('nav.modules.schedule'),
      icon: <ClipboardList className="size-4 text-sky-400" aria-hidden />,
    };
  }, [view, modulePages, t]);
}

export default function ScheduleManagementApp({
  initialView = 'shift-records',
}: ScheduleManagementAppProps) {
  const [view, setView] = useState<string>(initialView);
  const auth = useAuth(); const { user } = auth;
  const [mapMounted, setMapMounted] = useState(initialView === 'map');
  const [adminMode] = useAdminModePreference();
  const [modulePages, setModulePages] = useState(readModuleDashboardPages);
  const [attachModuleId, setAttachModuleId] = useState<string | null>(null);
  const [accountRoleFilter,setAccountRoleFilter]=useState<string|null>(null);
  // 後端的對應拉回來之前不能回寫：初始值是這台瀏覽器的舊快取，一掛載就送出去會把
  // 其他人改好的對應（例如重新指定版面）蓋回舊值。
  const modulePagesSyncedRef = useRef(false);

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
      if (cancelled) return;
      modulePagesSyncedRef.current = true;
      setModulePages(pages);
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
  }, [view]);

  // 儀表板「前往圖資管理編輯」：切到圖資資料管理並打開車輛模型（圖資頁可能還沒掛載，所以經 prop 傳過去）
  const [vehicleModelsRequest, setVehicleModelsRequest] = useState<
    (OpenVehicleModelsDetail & { nonce: number }) | null
  >(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenVehicleModelsDetail>).detail ?? {};
      setVehicleModelsRequest({ ...detail, nonce: Date.now() });
      setView('map');
    };
    window.addEventListener(OPEN_VEHICLE_MODELS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VEHICLE_MODELS_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!modulePagesSyncedRef.current) return;
    writeModuleDashboardPages(modulePages);
  }, [modulePages]);

  const chrome = useWorkspaceChrome(view, modulePages);
  const { t } = useTranslation();
  const activeModulePage = useMemo(() => {
    const id = parseModuleDashboardViewId(view);
    if (!id) return null;
    return modulePages.find((page) => page.id === id) ?? null;
  }, [view, modulePages]);

  const attachModuleLabel = (() => {
    const key = SIDEBAR_MODULE_GROUPS.find(
      (group) => group.id === attachModuleId,
    )?.label;
    return key ? t(key) : t('common.module');
  })();

  const frameProps = {
    onOpenSystemFoundation: () => { if (auth.require('system.health.view')) setView('system-foundation'); },
  };
  const requiredPermission = parseModuleDashboardViewId(view) ? 'dashboard.dashboard.view' : VIEW_PERMISSIONS[view as ShellView];
  const viewAllowed = !requiredPermission || auth.can(requiredPermission);

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
        onViewChange={(next) => { const required = parseModuleDashboardViewId(next) ? 'dashboard.dashboard.view' : VIEW_PERMISSIONS[next as ShellView]; if (!required || auth.require(required)) setView(next); }}
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
        permissions={user?.permissions ?? []}
      />
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!viewAllowed ? <div className="flex flex-1 items-center justify-center text-zinc-400">權限不足</div> : null}
        {viewAllowed ? <>
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
            <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.items.shift-deployment') })}>
              <ShiftDeploymentApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'degraded-operation' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} flush {...frameProps}>
            <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.items.degraded-operation') })}>
              <DegradedOperationApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'dispatch-scheduling' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.items.dispatch-scheduling') })}>
              <DispatchSchedulingApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'psd-control' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.items.psd-control') })}>
              <PsdControlApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'virtual-fence' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.items.virtual-fence') })}>
              <VirtualFenceManagementApp />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'system-foundation' || view === 'dashboard' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} flush {...frameProps}>
            <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.modules.system') })}>
              <SystemFoundationApp
                initialTab={view === 'dashboard' ? 'advanced' : 'health'}
                initialAdvancedSection="dashboard"
              />
            </ViewErrorBoundary>
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

        {view === 'account-management' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="帳號管理中心載入失敗">
              <AccountManagementPage onOpenRoles={() => setView('role-management')} roleId={accountRoleFilter} onClearRoleFilter={()=>setAccountRoleFilter(null)} />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'role-management' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="角色管理設定載入失敗"><RoleManagementPage onOpenAccounts={(roleId)=>{setAccountRoleFilter(roleId);setView('account-management');}} /></ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'vehicle-realtime' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="載具即時清單載入失敗">
              <VehicleRealtimePage />
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'vehicle-run-history' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="運行管理紀錄載入失敗"><RunHistoryPage /></ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'vehicle-registry' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="載具註冊管理載入失敗"><VehicleRegistryPage /></ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'media-content' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="媒體內容清單載入失敗"><MediaContentPage /></ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'media-groups' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="媒體分組清單載入失敗"><MediaGroupsPage /></ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {view === 'media-schedule' ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title="媒體排程設定載入失敗"><MediaSchedulesPage /></ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {isEventsView(view) || isLogsView(view) ? (
          <ShellWorkspaceFrame title={chrome.title} titleIcon={chrome.icon} {...frameProps}>
            <ViewErrorBoundary title={`${chrome.title}載入失敗`}>
              {view === 'event-list' ? <EventListPage key="live" mode="live" /> : null}
              {view === 'event-history' ? <EventListPage key="history" mode="history" /> : null}
              {view === 'video-monitor' ? <VideoMonitorPage /> : null}
              {view === 'log-system' ? <LogPage key="system" category="system" /> : null}
              {view === 'log-permissions' ? <LogPage key="permissions" category="permissions" /> : null}
              {view === 'log-operations' ? <LogPage key="operations" category="operations" /> : null}
              {view === 'log-authentication' ? <LogPage key="authentication" category="authentication" /> : null}
            </ViewErrorBoundary>
          </ShellWorkspaceFrame>
        ) : null}

        {mapMounted ? (
          <div
            className={`absolute inset-0 z-20 flex min-h-0 flex-col ${
              view === 'map' ? '' : 'pointer-events-none hidden'
            }`}
          >
            <ShellWorkspaceFrame
              title="圖資資料管理"
              titleIcon={<Map className="size-4 text-sky-400" aria-hidden />}
              flush
              {...frameProps}
            >
              <ViewErrorBoundary title={t('shell.loadFailed', { title: t('nav.items.map') })}>
                <MapEditorApp workspace="map" vehicleModelsRequest={vehicleModelsRequest} />
              </ViewErrorBoundary>
            </ShellWorkspaceFrame>
          </div>
        ) : null}</> : null}
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
