import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchOperationShiftDetail } from '../api/operationShiftApi';
import {
  buildShiftScheduleDraftFromStored,
  type ShiftScheduleCreateDraft,
} from '../types/create';
import { StepShiftSchedulePreview } from './StepShiftSchedulePreview';
import { IconButton } from '../../../components/ui';

type ShiftScheduleResultPreviewPageProps = {
  shiftId: string;
  onBack: () => void;
};

export function ShiftScheduleResultPreviewPage({
  shiftId,
  onBack,
}: ShiftScheduleResultPreviewPageProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ShiftScheduleCreateDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchOperationShiftDetail(shiftId)
      .then((detail) => {
        if (cancelled) return;
        setDraft(buildShiftScheduleDraftFromStored(detail.name, detail.body ?? {}));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setDraft(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-text-primary">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-quaternary bg-surface-sub-background px-6 py-4">
        <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onBack} title={t('shiftList.resultPreview.backToList')} label={t('shiftList.resultPreview.backToList')} icon={<ArrowLeft />} />
        <ClipboardList className="size-5 text-text-theme-light" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-headline-5">
            {t('shiftList.preview')}
          </h1>
          {draft?.basic.name ? (
            <p className="truncate text-body-xs text-text-quaternary">{draft.basic.name}</p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center gap-2 text-text-quaternary">
            <Loader2 className="size-5 animate-spin" />
            {t('shiftList.resultPreview.loading')}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
            {error}
          </div>
        ) : draft ? (
          <div className="mx-auto w-full max-w-6xl">
            <StepShiftSchedulePreview draft={draft} resultView />
          </div>
        ) : null}
      </div>
    </div>
  );
}
