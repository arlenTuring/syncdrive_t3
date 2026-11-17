import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../../components/ui';

interface Props {
  groupLabel: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function GroupTemplateExitDialog({ groupLabel, onCancel, onDiscard, onSave }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={<span className="inline-flex items-center gap-2"><AlertTriangle size={20} className="text-status-warning" aria-hidden />{t('dashboard.groupExit.title')}</span>}
      description={t('dashboard.groupExit.body', { label: groupLabel })}
      onClose={() => onCancel()}
      widthClassName="w-[440px]"
      footer={(
        <>
          <Button hierarchy="subordinate" variant="outlined" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button hierarchy="danger" variant="outlined" onPress={onDiscard}>{t('dashboard.groupExit.discard')}</Button>
          <Button onPress={onSave}>{t('dashboard.saveAndExit')}</Button>
        </>
      )}
    />
  );
}
