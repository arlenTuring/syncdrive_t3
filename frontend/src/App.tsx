import { useState } from 'react';
import ScheduleManagementApp from './features/schedule-management';
import { AppSettingsModal } from './components/AppSettingsModal';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';

/**
 * SyncDrive VTMS 根元件：進入即為側欄殼層，預設「班次運行紀錄」。
 * 儀表板管理在側欄底部；場域／載具軌跡由上方模組切換。
 */
function App() {
  const [showAppSettings, setShowAppSettings] = useState(false);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ViewErrorBoundary title="應用程式載入失敗">
        <ScheduleManagementApp onOpenSettings={() => setShowAppSettings(true)} />
      </ViewErrorBoundary>
      {showAppSettings ? (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      ) : null}
    </div>
  );
}

export default App;
