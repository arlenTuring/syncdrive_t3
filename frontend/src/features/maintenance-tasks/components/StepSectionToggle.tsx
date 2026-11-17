import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '../../../components/ui';

type StepSectionToggleProps = {
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
};

export function StepSectionToggle({
  title,
  enabled,
  onEnabledChange,
  children,
}: StepSectionToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="w-full">
      <label className="mb-6 flex cursor-pointer items-center gap-2">
        <Checkbox checked={enabled} onCheckedChange={(checked) => onEnabledChange(checked)} />
        <h2 className={`text-body-m-bold ${enabled ? 'text-text-primary' : 'text-text-quaternary'}`}>
          {title}
        </h2>
      </label>

      {enabled ? (
        children
      ) : (
        <p className="text-body-s text-text-disabled">{t('maintenanceTasks.stepSkipped')}</p>
      )}
    </div>
  );
}
