import { useCallback, useEffect, useState } from 'react';
import { NavigateToSetupModal } from '../maintenance-tasks/components/NavigateToSetupModal';
import { CreateShiftSchedulePage } from './components/CreateShiftSchedulePage';
import { ShiftListPage } from './components/ShiftListPage';
import {
  leaveShiftListEditor,
  navigateToShiftListCreate,
  navigateToShiftListEdit,
  readShiftListLocation,
  type ShiftListLocation,
} from './navigation';

type ShiftListAppProps = {
  onBackToHome?: () => void;
  embedded?: boolean;
};

export default function ShiftListApp({ onBackToHome, embedded }: ShiftListAppProps) {
  const [location, setLocation] = useState<ShiftListLocation>(() => readShiftListLocation());
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [listReloadKey, setListReloadKey] = useState(0);

  useEffect(() => {
    const onPopState = () => {
      setLocation(readShiftListLocation());
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
    navigateToShiftListCreate();
    setLocation({ screen: 'create' });
  }, []);

  const backToList = useCallback(() => {
    setShowSetupModal(false);
    leaveShiftListEditor();
  }, []);

  const openEdit = useCallback((shiftId: string) => {
    navigateToShiftListEdit(shiftId);
    setLocation({ screen: 'create', editShiftId: shiftId });
  }, []);

  return (
    <>
      {location.screen === 'list' && (
        <ShiftListPage
          key={listReloadKey}
          onBackToHome={embedded ? undefined : onBackToHome}
          onCreateClick={openCreateFlow}
          onEditClick={openEdit}
        />
      )}

      {location.screen === 'create' && (
        <CreateShiftSchedulePage
          editShiftId={location.editShiftId}
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
