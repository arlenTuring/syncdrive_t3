import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, IconButton } from '../../../components/ui';

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
    <Dialog headerless padded={false} title={t('timeTemplates.fillEmpty.title')} onClose={onClose} widthClassName="w-full max-w-[520px]">
<div className="px-8 py-8 flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="fill-empty-slots-title"
            className="text-headline-5 text-text-primary"
          >
            {t('timeTemplates.fillEmpty.title')}
          </h2>
          <IconButton hierarchy="subordinate" variant="standard" className="shrink-0" onPress={onClose} label={t('common.close')} icon={<X />} />
        </div>

        <p className="mt-4 text-body-s text-text-tertiary">
          {t('timeTemplates.fillEmpty.body', { taskLabel })}
        </p>

        <div className="mt-8 flex justify-end gap-3">
          <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>{t('common.cancel')}</Button>
          <Button onPress={onConfirm}>{t('timeTemplates.fillEmpty.confirm')}</Button>
        </div>
      </div>
</Dialog>
  );
}
