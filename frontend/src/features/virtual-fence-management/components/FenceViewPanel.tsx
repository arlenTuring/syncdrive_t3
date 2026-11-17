import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VirtualFence } from '../types';
import { Button, IconButton } from '../../../components/ui';

type FenceViewPanelProps = {
  detail: VirtualFence;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-body-s text-text-secondary">{label}</p>
      <p className="text-body-s text-text-primary">{value}</p>
    </div>
  );
}

export function FenceViewPanel({
  detail,
  onClose,
  onEdit,
  onDelete,
}: FenceViewPanelProps) {
  const { t } = useTranslation();
  const coverageText =
    detail.coverage.length > 0
      ? detail.coverage.map((c) => c.label).join('、')
      : t('virtualFence.view.coverageUnset');

  const speedText =
    detail.speedLimitKmh != null
      ? `${detail.speedLimitKmh} ${t('virtualFence.form.speedUnit')}`
      : '—';

  return (
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-border-quaternary bg-surface-sub-background">
      <div className="flex shrink-0 items-center justify-between px-5 py-4">
        <p className="text-body-s-bold text-text-primary">
          {t('virtualFence.view.title')}
        </p>
        <IconButton hierarchy="subordinate" variant="standard" onPress={onClose} title={t('common.close')} label={t('common.close')} icon={<X />} />
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-4">
        <Field label={t('virtualFence.view.name')} value={detail.name} />
        <Field label={t('virtualFence.view.coverage')} value={coverageText} />
        <Field
          label={t('virtualFence.view.enable')}
          value={
            detail.enabled
              ? t('virtualFence.view.yes')
              : t('virtualFence.view.no')
          }
        />
        <Field label={t('virtualFence.view.speedLimit')} value={speedText} />
      </div>

      <div className="flex shrink-0 items-center gap-3 px-5 py-4">
        <Button hierarchy="danger" variant="text" onPress={onDelete}>{t('common.delete')}</Button>
        <Button hierarchy="subordinate" variant="standard" className="ml-auto min-w-[96px]" onPress={onEdit}>{t('common.edit')}</Button>
      </div>
    </aside>
  );
}
