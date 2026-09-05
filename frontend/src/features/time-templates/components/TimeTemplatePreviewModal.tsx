import { Loader2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchTimeTemplateDetail } from '../api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../types/editor';
import { StepOverallPreview } from './StepOverallPreview';

type TimeTemplatePreviewModalProps = {
  templateId: string;
  fallbackName: string;
  onClose: () => void;
};

export function TimeTemplatePreviewModal({
  templateId,
  fallbackName,
  onClose,
}: TimeTemplatePreviewModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(fallbackName);
  const [previewData, setPreviewData] = useState(() => parseStoredTemplateBody({}));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchTimeTemplateDetail(templateId)
      .then((detail) => {
        if (cancelled) return;
        setName(detail.name || fallbackName);
        setPreviewData(parseStoredTemplateBody(detail.body ?? {}));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, fallbackName]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-w-full flex-col overflow-hidden rounded-2xl bg-[#18181B] pt-5 shadow-[4px_4px_6px_rgba(10,37,75,0.04),-1px_1px_32px_rgba(10,37,75,0.04),-4px_4px_6px_rgba(16,43,80,0.04),-32px_32px_40px_rgba(8,34,69,0.04)]"
        style={{
          width: 'min(1200px, calc(100vw - 2rem))',
          height: 'min(900px, calc(100vh - 2rem))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-[34px] shrink-0 items-center gap-2 px-5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-medium leading-5 text-[#F3F4F6]">
            <span className="font-normal text-[#99A1AF]">
              {t('timeTemplates.previewModal.titleLabel')}
            </span>{' '}
            {name.trim() || fallbackName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg p-0.5 text-[#D1D5DC] hover:bg-zinc-800"
            aria-label={t('common.close')}
          >
            <X className="size-6 shrink-0" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-3">
          {loading ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-zinc-500">
              <Loader2 className="size-6 animate-spin" />
              {t('timeTemplates.previewModal.loading')}
            </div>
          ) : error ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          ) : (
            <StepOverallPreview
              name={name}
              intervals={previewData.intervals}
              attributes={previewData.attributes}
              tasks={previewData.tasks}
              rowCount={previewData.scheduleRowCount}
              emptyHint={t('timeTemplates.previewModal.empty')}
              readOnly
            />
          )}
        </div>
      </div>
    </div>
  );
}
