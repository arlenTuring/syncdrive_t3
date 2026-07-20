import { useEffect, useState } from 'react';
import DashboardEditor from '../dashboard';
import MapEditorApp from '../map-editor';
import ShiftRecordsApp from '../shift-records';
import TimeTemplatesApp from '../time-templates';
import MaintenanceTasksApp from '../maintenance-tasks';
import ShiftListApp from '../shift-list';
import type { ShellView } from './types';
import { ScheduleModuleSidebar } from './components/ScheduleModuleSidebar';

type ScheduleManagementAppProps = {
  /** @deprecated 首頁即 VTMS；保留參數以相容舊呼叫 */
  onBackToHome?: () => void;
  initialView?: ShellView;
  onOpenSettings?: () => void;
};

export default function ScheduleManagementApp({
  initialView = 'shift-records',
  onOpenSettings,
}: ScheduleManagementAppProps) {
  const [view, setView] = useState<ShellView>(initialView);
  const [mapMounted, setMapMounted] = useState(initialView === 'map');
  const [trajectoryMounted, setTrajectoryMounted] = useState(initialView === 'trajectory');

  useEffect(() => {
    if (view === 'map') setMapMounted(true);
    if (view === 'trajectory') setTrajectoryMounted(true);
  }, [view]);

  return (
    <div className="flex h-full min-h-0 w-full bg-[#0a0a0b]">
      <ScheduleModuleSidebar
        activeView={view}
        onViewChange={setView}
        onOpenSettings={onOpenSettings}
      />
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {view === 'dashboard' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <DashboardEditor />
          </div>
        ) : null}

        {view === 'shift-records' && <ShiftRecordsApp embedded />}
        {view === 'time-templates' && <TimeTemplatesApp embedded />}
        {view === 'shift-list' && <ShiftListApp embedded />}
        {view === 'maintenance-tasks' && <MaintenanceTasksApp embedded />}

        {mapMounted ? (
          <div
            className="absolute inset-0 flex min-h-0 flex-col bg-[#0a0a0b]"
            style={{ display: view === 'map' ? 'flex' : 'none' }}
          >
            <MapEditorApp workspace="map" />
          </div>
        ) : null}

        {trajectoryMounted ? (
          <div
            className="absolute inset-0 flex min-h-0 flex-col bg-[#0a0a0b]"
            style={{ display: view === 'trajectory' ? 'flex' : 'none' }}
          >
            <MapEditorApp workspace="trajectory" />
          </div>
        ) : null}
      </main>
    </div>
  );
}
