import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigateToSetupModal } from '../maintenance-tasks/components/NavigateToSetupModal';
import { CreateShiftSchedulePage } from './components/CreateShiftSchedulePage';
import { ShiftListPage } from './components/ShiftListPage';
import { ShiftScheduleResultPreviewPage } from './components/ShiftScheduleResultPreviewPage';
import {
  clearShiftListEditorHash,
  navigateToShiftListCreate,
  navigateToShiftListEdit,
  navigateToShiftListPreview,
  readShiftListLocation,
  type ShiftListLocation,
} from './navigation';
import type { ShiftScheduleCreationMode } from './types/create';

type ShiftListAppProps = {
  onBackToHome?: () => void;
  embedded?: boolean;
};

export default function ShiftListApp({ onBackToHome, embedded }: ShiftListAppProps) {
  const { t } = useTranslation();
  // VTMS 側欄切入時一律從清單開始，不還原上次未關閉的編輯／預覽 hash
  const [location, setLocation] = useState<ShiftListLocation>(() =>
    embedded ? { screen: 'list' } : readShiftListLocation(),
  );
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [listReloadKey, setListReloadKey] = useState(0);
  const [pendingCreationMode, setPendingCreationMode] =
    useState<ShiftScheduleCreationMode>('parametric');

  useEffect(() => {
    if (embedded) {
      clearShiftListEditorHash();
    }
  }, [embedded]);

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

  const startCreate = useCallback((mode: ShiftScheduleCreationMode) => {
    setPendingCreationMode(mode);
    setShowSetupModal(false);
    navigateToShiftListCreate();
    setLocation({ screen: 'create' });
  }, []);

  const backToList = useCallback(() => {
    setShowSetupModal(false);
    clearShiftListEditorHash();
    setLocation({ screen: 'list' });
  }, []);

  const openEdit = useCallback((shiftId: string) => {
    navigateToShiftListEdit(shiftId);
    setLocation({ screen: 'create', editShiftId: shiftId });
  }, []);

  const openPreview = useCallback((shiftId: string) => {
    navigateToShiftListPreview(shiftId);
    setLocation({ screen: 'preview', editShiftId: shiftId });
  }, []);

  return (
    <>
      {location.screen === 'list' && (
        <ShiftListPage
          key={listReloadKey}
          onBackToHome={embedded ? undefined : onBackToHome}
          onCreateClick={openCreateFlow}
          onEditClick={openEdit}
          onPreviewClick={openPreview}
        />
      )}

      {location.screen === 'create' && (
        <CreateShiftSchedulePage
          key={location.editShiftId ?? `new-${pendingCreationMode}`}
          editShiftId={location.editShiftId}
          initialCreationMode={
            location.editShiftId ? 'parametric' : pendingCreationMode
          }
          onBack={backToList}
          onSavedDraft={reloadList}
        />
      )}

      {location.screen === 'preview' && location.editShiftId && (
        <ShiftScheduleResultPreviewPage
          key={`preview-${location.editShiftId}`}
          shiftId={location.editShiftId}
          onBack={backToList}
        />
      )}

      {showSetupModal && (
        <NavigateToSetupModal
          onClose={closeSetupModal}
          onConfirm={() => startCreate('parametric')}
          onSecondary={() => startCreate('manual')}
          primaryLabel={t('shiftList.navigateSetup.parametric')}
          secondaryLabel={t('shiftList.navigateSetup.manual')}
        />
      )}
    </>
  );
}
