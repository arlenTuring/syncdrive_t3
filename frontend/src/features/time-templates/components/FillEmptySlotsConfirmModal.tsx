import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fill-empty-slots-title"
        className="w-full max-w-[520px] rounded-2xl bg-[#222225] px-8 py-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="fill-empty-slots-title"
            className="text-lg font-semibold leading-7 text-[#F3F4F6]"
          >
            {t('timeTemplates.fillEmpty.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={t('common.close')}
          >
            <X className="size-5" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-zinc-400">
          {t('timeTemplates.fillEmpty.body', { taskLabel })}
        </p>

        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[38px] items-center justify-center rounded-lg px-5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-[38px] items-center justify-center rounded-lg bg-[#2B7FFF] px-5 text-sm font-medium text-white transition hover:bg-[#2569e6]"
          >
            {t('timeTemplates.fillEmpty.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
