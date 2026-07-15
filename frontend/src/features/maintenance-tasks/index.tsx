import { useCallback, useEffect, useState } from 'react';
import { CreateMaintenanceTaskPage } from './components/CreateMaintenanceTaskPage';
import { MaintenanceTaskListPage } from './components/MaintenanceTaskListPage';
import { NavigateToSetupModal } from './components/NavigateToSetupModal';
import {
  leaveMaintenanceTaskEditor,
  navigateToMaintenanceTaskCreate,
  navigateToMaintenanceTaskEdit,
  readMaintenanceTaskLocation,
  type MaintenanceTaskLocation,
} from './navigation';

type MaintenanceTasksAppProps = {
  onBackToHome?: () => void;
  embedded?: boolean;
};

export default function MaintenanceTasksApp({ onBackToHome, embedded }: MaintenanceTasksAppProps) {
  const [location, setLocation] = useState<MaintenanceTaskLocation>(() => readMaintenanceTaskLocation());
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [listReloadKey, setListReloadKey] = useState(0);

  useEffect(() => {
    const onPopState = () => {
      setLocation(readMaintenanceTaskLocation());
      setShowSetupModal(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const reloadList = useCallback(() => {
    setListReloadKey((k) => k + 1);
  }, []);

  const openCreateFlow = useCallback(() => {
    setShowSetupModal(true);
  }, []);

  const closeSetupModal = useCallback(() => {
    setShowSetupModal(false);
  }, []);

  const confirmCreateNavigation = useCallback(() => {
    setShowSetupModal(false);
    navigateToMaintenanceTaskCreate();
    setLocation({ screen: 'create' });
  }, []);

  const backToList = useCallback(() => {
    setShowSetupModal(false);
    leaveMaintenanceTaskEditor();
  }, []);

  const openEdit = useCallback((taskId: string) => {
    navigateToMaintenanceTaskEdit(taskId);
    setLocation({ screen: 'create', editTaskId: taskId });
  }, []);

  return (
    <>
      {location.screen === 'list' && (
        <MaintenanceTaskListPage
          key={listReloadKey}
          onBackToHome={embedded ? undefined : onBackToHome}
          onCreateClick={openCreateFlow}
          onEditClick={openEdit}
        />
      )}

      {location.screen === 'create' && (
        <CreateMaintenanceTaskPage
          editTaskId={location.editTaskId}
          onBack={backToList}
          onSavedDraft={reloadList}
        />
      )}

      {showSetupModal && (
        <NavigateToSetupModal onClose={closeSetupModal} onConfirm={confirmCreateNavigation} />
      )}
    </>
  );
}
