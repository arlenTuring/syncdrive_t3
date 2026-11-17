import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchTimeTemplateDetail } from '../api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../types/editor';
import { StepOverallPreview } from './StepOverallPreview';
import { Dialog } from '../../../components/ui';

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
    <Dialog
      padded={false}
      onClose={onClose}
      widthClassName="w-[min(1200px,calc(100vw-2rem))] max-w-none"
      heightClassName="h-[min(900px,calc(100vh-2rem))]"
      title={(
        <>
          <span className="text-text-tertiary">{t('timeTemplates.previewModal.titleLabel')}</span>{' '}
          {name.trim() || fallbackName}
        </>
      )}
    >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-5">
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
    </Dialog>
  );
}
