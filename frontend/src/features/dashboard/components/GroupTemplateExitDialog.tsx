import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../../components/ui';

interface Props {
  groupLabel: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function GroupTemplateExitDialog({ groupLabel, onCancel, onDiscard, onSave }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 bg-black-50 flex items-center justify-center z-[60] backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="bg-surface-primary border border-border-quaternary rounded-xl shadow-2xl w-[440px] p-6"
        role="dialog"
        aria-labelledby="group-exit-dialog-title"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-status-warning-light flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-status-warning" />
            </div>
            <div>
              <h2 id="group-exit-dialog-title" className="text-text-primary text-body-m-bold">
                {t('dashboard.groupExit.title')}
              </h2>
              <p className="text-text-tertiary text-body-s mt-1">
                {t('dashboard.groupExit.body', { label: groupLabel })}
              </p>
            </div>
          </div>
          <IconButton hierarchy="subordinate" variant="standard" className="shrink-0" onPress={onCancel} label={t('common.close')} icon={<X />} />
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button hierarchy="subordinate" variant="outlined" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button hierarchy="danger" variant="outlined" onPress={onDiscard}>{t('dashboard.groupExit.discard')}</Button>
          <Button hierarchy="subordinate" variant="standard" onPress={onSave}>{t('dashboard.saveAndExit')}</Button>
        </div>
      </div>
    </div>
  );
}
