import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VirtualFence } from '../types';

type FenceViewPanelProps = {
  detail: VirtualFence;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-zinc-300">{label}</p>
      <p className="text-sm text-white">{value}</p>
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
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-zinc-800/80 bg-[#0a0a0b]">
      <div className="flex shrink-0 items-center justify-between px-5 py-4">
        <p className="text-sm font-medium text-white">
          {t('virtualFence.view.title')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          title={t('common.close')}
        >
          <X className="size-4" aria-hidden />
        </button>
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
        <button
          type="button"
          onClick={onDelete}
          className="text-sm text-red-500 transition hover:text-red-400"
        >
          {t('common.delete')}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="ml-auto inline-flex h-9 min-w-[96px] items-center justify-center rounded-lg bg-[#3f3f46] px-5 text-sm text-white transition hover:bg-[#52525b]"
        >
          {t('common.edit')}
        </button>
      </div>
    </aside>
  );
}
