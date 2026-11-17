import { ArrowLeft, Loader2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMaintenanceTaskDetail } from '../api/maintenanceTasksApi';
import {
  buildMaintenanceTaskDraftFromStored,
  type MaintenanceTaskCreateDraft,
} from '../types/create';
import { MaintenanceTaskPreviewContent } from './MaintenanceTaskPreviewContent';
import { IconButton } from '../../../components/ui';

type MaintenanceTaskResultPreviewPageProps = {
  taskId: string;
  onBack: () => void;
};

export function MaintenanceTaskResultPreviewPage({
  taskId,
  onBack,
}: MaintenanceTaskResultPreviewPageProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<MaintenanceTaskCreateDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchMaintenanceTaskDetail(taskId)
      .then((detail) => {
        if (cancelled) return;
        setDraft(buildMaintenanceTaskDraftFromStored(detail.name, detail.body ?? {}));
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
  }, [taskId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-sub-background text-text-primary">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-quaternary bg-surface-sub-background px-6 py-4">
        <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onBack} title={t('maintenanceTasks.resultPreview.backToList')} label={t('maintenanceTasks.resultPreview.backToList')} icon={<ArrowLeft />} />
        <Wrench className="size-5 text-text-theme-light" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-headline-5">
            {t('maintenanceTasks.preview')}
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
            {t('maintenanceTasks.resultPreview.loading')}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
            {error}
          </div>
        ) : draft ? (
          <div className="mx-auto w-full max-w-4xl">
            <MaintenanceTaskPreviewContent draft={draft} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
