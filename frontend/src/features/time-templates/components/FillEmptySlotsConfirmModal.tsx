import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../../components/ui';

type FillEmptySlotsConfirmModalProps = {
  taskLabel: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function FillEmptySlotsConfirmModal({
  taskLabel,
  onClose,
  onConfirm,
}: FillEmptySlotsConfirmModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Dialog
      title={t('timeTemplates.fillEmpty.title')}
      onClose={onClose}
      widthClassName="w-full max-w-[520px]"
      footer={(
        <>
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>{t('common.cancel')}</Button>
          <Button onPress={onConfirm}>{t('timeTemplates.fillEmpty.confirm')}</Button>
        </>
      )}
    >
      <p className="text-body-s text-text-tertiary">{t('timeTemplates.fillEmpty.body', { taskLabel })}</p>
    </Dialog>
  );
}
