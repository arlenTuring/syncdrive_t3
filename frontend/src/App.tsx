import { useState } from 'react';
import ScheduleManagementApp from './features/schedule-management';
import { AppSettingsModal } from './components/AppSettingsModal';

/**
 * SyncDrive VTMS 根元件：進入即為側欄殼層，預設「班次運行紀錄」。
 * 數據監控／場域／載具軌跡皆由側欄切換。
 */
function App() {
  const [showAppSettings, setShowAppSettings] = useState(false);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ScheduleManagementApp onOpenSettings={() => setShowAppSettings(true)} />
      {showAppSettings ? (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      ) : null}
    </div>
  );
}

export default App;
