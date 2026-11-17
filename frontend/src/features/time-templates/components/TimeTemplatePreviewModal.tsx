import { Loader2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchTimeTemplateDetail } from '../api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../types/editor';
import { StepOverallPreview } from './StepOverallPreview';
import { Dialog, IconButton } from '../../../components/ui';

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
    <Dialog headerless padded={false} title={`${t('timeTemplates.previewModal.titleLabel')} ${name.trim() || fallbackName}`} onClose={onClose} widthClassName="w-[min(1200px,calc(100vw-2rem))] max-w-none" heightClassName="h-[min(900px,calc(100vh-2rem))]">
<div className="pt-5 flex min-h-0 flex-1 flex-col overflow-auto">
        <header className="flex h-[34px] shrink-0 items-center gap-2 px-5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-body-m-bold text-text-primary">
            <span className="font-normal text-text-tertiary">
              {t('timeTemplates.previewModal.titleLabel')}
            </span>{' '}
            {name.trim() || fallbackName}
          </h2>
          <IconButton hierarchy="subordinate" variant="standard" className="shrink-0" onPress={onClose} label={t('common.close')} icon={<X />} />
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-3">
          {loading ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-text-quaternary">
              <Loader2 className="size-6 animate-spin" />
              {t('timeTemplates.previewModal.loading')}
            </div>
          ) : error ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
              <p className="text-body-s text-status-error-emphasis">{error}</p>
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
</Dialog>
  );
}
