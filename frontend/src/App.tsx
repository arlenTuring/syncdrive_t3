import { lazy, Suspense, useEffect } from 'react';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import { useAuth } from './features/access-control/AuthContext';
import { LoginPage } from './features/access-control/LoginPage';
import { SIDEBAR_MODULE_GROUPS, type ShellView } from './features/schedule-management/types';

const ScheduleManagementApp = lazy(() => import('./features/schedule-management'));

/**
 * SyncDrive VTMS 根元件：進入即為側欄殼層，預設「班次運行紀錄」。
 * 儀表板管理位於系統基礎模組的進階管理模式；場域／載具軌跡由側欄模組切換。
 */
function App() {
  const auth = useAuth();
  /**
   * 圖台版面與載具定義的一次性遷移。
   *
   * 放在根元件而不是各自的編輯器裡——那兩個 hook 只在對應頁面掛載，使用者停在別的
   * 模組時就永遠不會遷移（見 migrateLocalCacheToServer 的說明）。只在伺服器確實是
   * 空的時候推，不會覆蓋已有內容。
   */
  useEffect(() => {
    if (auth.user) {
      void import('./lib/migrateLocalCacheToServer')
        .then(({ migrateLocalCacheToServer }) => migrateLocalCacheToServer())
        .catch((error: unknown) => console.warn('背景快取遷移模組載入失敗；不影響頁面使用', error));
    }
  }, [auth.user]);

  if (auth.loading) {
    return <div className="flex h-screen w-screen items-center justify-center bg-black text-zinc-500">正在確認登入狀態…</div>;
  }
  if (!auth.user) return <LoginPage />;
  const initialView = SIDEBAR_MODULE_GROUPS.flatMap((group) => group.items ?? [])
    .find((item) => !item.requiredPermission || auth.user!.permissions.includes(item.requiredPermission))?.id ?? 'shift-records';

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ViewErrorBoundary title="應用程式載入失敗">
        <Suspense fallback={<div className="flex h-full items-center justify-center bg-black text-zinc-500">正在載入工作區…</div>}>
          <ScheduleManagementApp initialView={initialView as ShellView} />
        </Suspense>
      </ViewErrorBoundary>
    </div>
  );
}

export default App;
