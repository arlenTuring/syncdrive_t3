import { ArrowLeft, Loader2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchMaintenanceTaskDetail } from '../api/maintenanceTasksApi';
import {
  buildMaintenanceTaskDraftFromStored,
  type MaintenanceTaskCreateDraft,
} from '../types/create';
import { MaintenanceTaskPreviewContent } from './MaintenanceTaskPreviewContent';

type MaintenanceTaskResultPreviewPageProps = {
  taskId: string;
  onBack: () => void;
};

export function MaintenanceTaskResultPreviewPage({
  taskId,
  onBack,
}: MaintenanceTaskResultPreviewPageProps) {
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
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
          title="返回清單"
        >
          <ArrowLeft className="size-4" />
        </button>
        <Wrench className="size-5 text-[#2B7FFF]" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">任務檢視</h1>
          {draft?.basic.name ? (
            <p className="truncate text-xs text-zinc-500">{draft.basic.name}</p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
            <Loader2 className="size-5 animate-spin" />
            載入中…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
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
