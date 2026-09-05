import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[440px] p-6"
        role="dialog"
        aria-labelledby="group-exit-dialog-title"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/40 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-amber-400" />
            </div>
            <div>
              <h2 id="group-exit-dialog-title" className="text-zinc-100 font-semibold text-base">
                {t('dashboard.groupExit.title')}
              </h2>
              <p className="text-zinc-400 text-sm mt-1 leading-relaxed">
                {t('dashboard.groupExit.body', { label: groupLabel })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 shrink-0"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="px-4 py-2 rounded-lg border border-red-800/60 bg-red-950/40 text-red-300 text-sm font-medium
                       hover:bg-red-900/50 transition-colors"
          >
            {t('dashboard.groupExit.discard')}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-500 transition-colors"
          >
            {t('dashboard.saveAndExit')}
          </button>
        </div>
      </div>
    </div>
  );
}
