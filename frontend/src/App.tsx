import { useEffect } from 'react';
import ScheduleManagementApp from './features/schedule-management';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import { migrateLocalCacheToServer } from './lib/migrateLocalCacheToServer';

/**
 * SyncDrive VTMS 根元件：進入即為側欄殼層，預設「班次運行紀錄」。
 * 儀表板管理位於系統基礎模組的進階管理模式；場域／載具軌跡由側欄模組切換。
 */
function App() {
  /**
   * 圖台版面與載具定義的一次性遷移。
   *
   * 放在根元件而不是各自的編輯器裡——那兩個 hook 只在對應頁面掛載，使用者停在別的
   * 模組時就永遠不會遷移（見 migrateLocalCacheToServer 的說明）。只在伺服器確實是
   * 空的時候推，不會覆蓋已有內容。
   */
  useEffect(() => {
    migrateLocalCacheToServer();
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ViewErrorBoundary title="應用程式載入失敗">
        <ScheduleManagementApp />
      </ViewErrorBoundary>
    </div>
  );
}

export default App;
