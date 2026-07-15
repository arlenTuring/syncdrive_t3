import { useState } from 'react';
import ShiftRecordsApp from '../shift-records';
import TimeTemplatesApp from '../time-templates';
import MaintenanceTasksApp from '../maintenance-tasks';
import ShiftListApp from '../shift-list';
import type { ScheduleSubView } from './types';
import { ScheduleModuleSidebar } from './components/ScheduleModuleSidebar';

type ScheduleManagementAppProps = {
  onBackToHome?: () => void;
  initialView?: ScheduleSubView;
};

export default function ScheduleManagementApp({
  onBackToHome,
  initialView = 'shift-records',
}: ScheduleManagementAppProps) {
  const [view, setView] = useState<ScheduleSubView>(initialView);

  return (
    <div className="flex h-full min-h-0 w-full bg-[#0a0a0b]">
      <ScheduleModuleSidebar
        activeView={view}
        onViewChange={setView}
        onBackToHome={onBackToHome}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === 'shift-records' && <ShiftRecordsApp embedded />}
        {view === 'time-templates' && <TimeTemplatesApp embedded />}
        {view === 'shift-list' && <ShiftListApp embedded />}
        {view === 'maintenance-tasks' && <MaintenanceTasksApp embedded />}
      </main>
    </div>
  );
}
