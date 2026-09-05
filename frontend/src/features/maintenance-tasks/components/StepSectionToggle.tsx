import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="size-4 shrink-0 rounded border-zinc-600 bg-zinc-900 text-[#2B7FFF] focus:ring-[#2B7FFF]/30"
        />
        <h2 className={`text-base font-medium ${enabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
          {title}
        </h2>
      </label>

      {enabled ? (
        children
      ) : (
        <p className="text-sm text-zinc-600">{t('maintenanceTasks.stepSkipped')}</p>
      )}
    </div>
  );
}
