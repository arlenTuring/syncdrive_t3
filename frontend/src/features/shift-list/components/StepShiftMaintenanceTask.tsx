import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fetchMaintenanceTaskDetail, fetchMaintenanceTaskList } from '../../maintenance-tasks/api/maintenanceTasksApi';
import { MaintenanceTaskPreviewContent } from '../../maintenance-tasks/components/MaintenanceTaskPreviewContent';
import { buildMaintenanceTaskDraftFromStored } from '../../maintenance-tasks/types/create';
import type { MaintenanceTaskListItem } from '../../maintenance-tasks/types';
import type {
  ShiftScheduleCreationMode,
  ShiftScheduleMaintenanceTaskDraft,
} from '../types/create';
import {
  emptyMaintenanceEntrySlackBySectionInput,
  normalizeMaintenanceEntrySlackBySectionInput,
  type MaintenanceEntrySlackSectionKey,
} from '../utils/resolveMaintenanceEntrySlackSeconds';
import {
  emptyMaintenanceSectionCodeBySection,
  findMaintenanceSectionCodeIssues,
  normalizeMaintenanceSectionCodeBySection,
  sanitizeMaintenanceSectionCodeInput,
  type MaintenanceSectionCodeKey,
} from '../utils/maintenanceSectionCode';
import { MainlineSlackSecondsField } from './MainlineSlackSecondsField';
import { ShiftSelectionEmptyState } from './ShiftSelectionEmptyState';

const SELECT_CLASS =
  'h-[42px] w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

const CODE_INPUT_CLASS =
  'h-[42px] w-24 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm uppercase tracking-wider text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type StepShiftMaintenanceTaskProps = {
  draft: ShiftScheduleMaintenanceTaskDraft;
  creationMode?: ShiftScheduleCreationMode;
  onChange: (next: ShiftScheduleMaintenanceTaskDraft) => void;
};

function resolveSectionEnabled(
  previewDraft: ReturnType<typeof buildMaintenanceTaskDraftFromStored>,
): ShiftScheduleMaintenanceTaskDraft['sectionEnabled'] {
  return {
    charging: previewDraft.charging.stepEnabled,
    carWash: previewDraft.carWash.stepEnabled,
    maintenance: previewDraft.maintenance.stepEnabled,
    preTrip: previewDraft.preTrip.stepEnabled,
    mobile: previewDraft.mobile.stepEnabled,
    parking: previewDraft.parking.stepEnabled,
  };
}

export function StepShiftMaintenanceTask({
  draft,
  creationMode = 'parametric',
  onChange,
}: StepShiftMaintenanceTaskProps) {
  const [items, setItems] = useState<MaintenanceTaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState(
    () => buildMaintenanceTaskDraftFromStored('', {}),
  );

  const entrySlackBySection = normalizeMaintenanceEntrySlackBySectionInput(
    draft.entrySlackBySection,
  );
  const sectionCodeBySection = normalizeMaintenanceSectionCodeBySection(
    draft.sectionCodeBySection,
  );
  const sectionEnabled = draft.sectionEnabled;
  // 調度（parking）現在跟其他五個整備區塊一樣只有一個代號欄位，
  // 不用再另外組驗證用的 enabled map——sectionEnabled 的鍵本來就對得上。
  const codeIssues = findMaintenanceSectionCodeIssues(
    sectionCodeBySection,
    sectionEnabled,
  );
  const codeIssueByKey = new Map(codeIssues.map((issue) => [issue.key, issue.message]));

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

  const draftRef = useRef(draft);
  draftRef.current = draft;

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
        const nextPreview = buildMaintenanceTaskDraftFromStored(
          detail.name,
          detail.body ?? {},
        );
        setPreviewDraft(nextPreview);
        const enabled = resolveSectionEnabled(nextPreview);
        const current = draftRef.current;
        const same =
          current.sectionEnabled.charging === enabled.charging
          && current.sectionEnabled.carWash === enabled.carWash
          && current.sectionEnabled.maintenance === enabled.maintenance
          && current.sectionEnabled.preTrip === enabled.preTrip
          && current.sectionEnabled.mobile === enabled.mobile
          && current.sectionEnabled.parking === enabled.parking;
        if (!same) {
          onChange({
            ...current,
            sectionEnabled: enabled,
          });
        }
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
    // 僅跟隨 taskId；onChange 以 draftRef 讀最新草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.taskId]);

  const handleSelect = (taskId: string) => {
    const item = items.find((row) => row.task_id === taskId);
    onChange({
      taskId,
      taskName: item?.name ?? '',
      skipped: false,
      entrySlackBySection: emptyMaintenanceEntrySlackBySectionInput(),
      sectionCodeBySection: emptyMaintenanceSectionCodeBySection(),
      sectionEnabled: {
        charging: false,
        carWash: false,
        maintenance: false,
        preTrip: false,
        mobile: false,
        parking: false,
      },
    });
  };

  const patchEntrySlack = (key: MaintenanceEntrySlackSectionKey, value: string) => {
    onChange({
      ...draft,
      entrySlackBySection: {
        ...entrySlackBySection,
        [key]: value,
      },
    });
  };

  const patchSectionCode = (key: MaintenanceSectionCodeKey, value: string) => {
    onChange({
      ...draft,
      sectionCodeBySection: {
        ...sectionCodeBySection,
        [key]: sanitizeMaintenanceSectionCodeInput(value),
      },
    });
  };

  const sectionCodeField = (key: MaintenanceSectionCodeKey) => {
    const issue = codeIssueByKey.get(key);
    return (
      <div className="space-y-1.5">
        <label className="block">
          <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
            <span className="text-red-500">*</span>
            整備代號
          </span>
          <input
            type="text"
            value={sectionCodeBySection[key]}
            onChange={(e) => patchSectionCode(key, e.target.value)}
            placeholder="例：M"
            maxLength={2}
            className={`${CODE_INPUT_CLASS} ${issue ? 'border-red-500/80 focus:border-red-500 focus:ring-red-500/30' : ''}`}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="text-xs text-zinc-500">
          1–2 個大寫英文字母；班次代號＝整備代號＋列碼（A/B/C…）＋開始時刻
        </p>
        {issue ? <p className="text-xs text-red-400">{issue}</p> : null}
      </div>
    );
  };

  const slackField = (key: MaintenanceEntrySlackSectionKey) => (
    <MainlineSlackSecondsField
      label="正線優先讓渡餘裕"
      value={entrySlackBySection[key]}
      onChange={(value) => patchEntrySlack(key, value)}
      prefixText="正線可壓縮整備開頭，最多"
    />
  );

  const sectionExtras = {
    charging: (
      <div className="space-y-4">
        {sectionCodeField('charging')}
        {creationMode === 'parametric' ? slackField('charging') : null}
      </div>
    ),
    carWash: (
      <div className="space-y-4">
        {sectionCodeField('carWash')}
        {creationMode === 'parametric' ? slackField('carWash') : null}
      </div>
    ),
    maintenance: (
      <div className="space-y-4">
        {sectionCodeField('maintenance')}
        {creationMode === 'parametric' ? slackField('maintenance') : null}
      </div>
    ),
    parking: (
      <div className="space-y-4">
        {sectionCodeField('parking')}
      </div>
    ),
    preTrip: (
      <div className="space-y-4">
        {sectionCodeField('preTrip')}
        {creationMode === 'parametric' ? slackField('preTrip') : null}
      </div>
    ),
    mobile: (
      <div className="space-y-4">
        {sectionCodeField('mobile')}
        {creationMode === 'parametric' ? slackField('mobile') : null}
      </div>
    ),
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
            <MaintenanceTaskPreviewContent
              draft={previewDraft}
              sectionExtras={sectionExtras}
            />
          </div>
        )}
      </div>
    </div>
  );
}
