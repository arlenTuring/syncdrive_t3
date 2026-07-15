import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchMaintenanceTaskDetail, fetchMaintenanceTaskList } from '../../maintenance-tasks/api/maintenanceTasksApi';
import { MaintenanceTaskPreviewContent } from '../../maintenance-tasks/components/MaintenanceTaskPreviewContent';
import { buildMaintenanceTaskDraftFromStored } from '../../maintenance-tasks/types/create';
import type { MaintenanceTaskListItem } from '../../maintenance-tasks/types';
import type { ShiftScheduleMaintenanceTaskDraft } from '../types/create';
import { ShiftSelectionEmptyState } from './ShiftSelectionEmptyState';

const SELECT_CLASS =
  'h-[42px] w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type StepShiftMaintenanceTaskProps = {
  draft: ShiftScheduleMaintenanceTaskDraft;
  onChange: (next: ShiftScheduleMaintenanceTaskDraft) => void;
};

export function StepShiftMaintenanceTask({ draft, onChange }: StepShiftMaintenanceTaskProps) {
  const [items, setItems] = useState<MaintenanceTaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState(
    () => buildMaintenanceTaskDraftFromStored('', {}),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchMaintenanceTaskList({
      page: 1,
      page_size: 100,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draft.taskId) {
      setPreviewDraft(buildMaintenanceTaskDraftFromStored('', {}));
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void fetchMaintenanceTaskDetail(draft.taskId)
      .then((detail) => {
        if (cancelled) return;
        setPreviewDraft(buildMaintenanceTaskDraftFromStored(detail.name, detail.body ?? {}));
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : String(e));
          setPreviewDraft(buildMaintenanceTaskDraftFromStored('', {}));
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draft.taskId]);

  const handleSelect = (taskId: string) => {
    const item = items.find((row) => row.task_id === taskId);
    onChange({
      taskId,
      taskName: item?.name ?? '',
      skipped: false,
    });
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <h2 className="text-base font-medium text-zinc-100">選擇要套用的整備計畫</h2>
      </div>

      <label className="block max-w-xl shrink-0">
        <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
          <span className="text-red-500">*</span>
          整備任務
        </span>
        {loading ? (
          <div className="flex h-[42px] items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            載入整備任務中…
          </div>
        ) : (
          <select
            value={draft.taskId}
            onChange={(e) => handleSelect(e.target.value)}
            className={SELECT_CLASS}
            disabled={Boolean(error) || items.length === 0}
          >
            <option value="">請選擇</option>
            {items.map((item) => (
              <option key={item.task_id} value={item.task_id}>
                {item.name}
                {item.publish_status === 'draft' ? `（${item.publish_status_label}）` : ''}
              </option>
            ))}
          </select>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="mt-2 text-sm text-zinc-500">
            尚無整備任務可選，請先至「整備任務管理」建立。
          </p>
        )}
      </label>

      <div className="mt-8 min-h-[280px] flex-1 overflow-auto rounded-xl border border-zinc-800/80 bg-zinc-950/40">
        {!draft.taskId ? (
          <ShiftSelectionEmptyState />
        ) : previewLoading ? (
          <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            載入整備任務預覽中…
          </div>
        ) : previewError ? (
          <div className="flex min-h-[280px] items-center justify-center px-6 text-sm text-red-400">
            {previewError}
          </div>
        ) : (
          <div className="p-5">
            <MaintenanceTaskPreviewContent draft={previewDraft} />
          </div>
        )}
      </div>
    </div>
  );
}

