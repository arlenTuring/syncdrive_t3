import { cn, fieldClass } from '../../../components/ui';
import { SiteSelect } from '../../../components/SiteSelect';
import { AlertTriangle, Lightbulb, Loader2 } from 'lucide-react';
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
  normalizeMaintenanceEntrySlackBySectionInput,
  type MaintenanceEntrySlackSectionKey,
} from '../utils/resolveMaintenanceEntrySlackSeconds';
import {
  findMaintenanceSectionCodeIssues,
  normalizeMaintenanceSectionCardLabelBySection,
  normalizeMaintenanceSectionCodeBySection,
  sanitizeMaintenanceSectionCardLabelInput,
  sanitizeMaintenanceSectionCodeInput,
  type MaintenanceSectionCodeKey,
} from '../utils/maintenanceSectionCode';
import { sanitizeIntegerInput } from '../../maintenance-tasks/utils/numericInput';
import { ShiftSelectionEmptyState } from './ShiftSelectionEmptyState';
import { YardEntryAllowancePanel } from './YardEntryAllowancePanel';

/** 設計稿：無外框、灰藍底 */
const SELECT_CLASS = fieldClass({ size: 'md', fullWidth: true });

const CODE_INPUT_CLASS =
  cn(fieldClass({ size: 'md', fullWidth: true }), 'uppercase');

/** 機動的整備代號（使用者指定 F，避開保養的 M） */
const MANEUVER_DEFAULT_CODE = 'F';

const SECTION_TITLE: Record<MaintenanceSectionCodeKey, string> = {
  charging: '充電任務',
  carWash: '洗車任務',
  maintenance: '保養任務',
  preTrip: '行檢任務',
  mobile: '待命任務',
  maneuver: '機動任務',
};

type StepShiftMaintenanceTaskProps = {
  draft: ShiftScheduleMaintenanceTaskDraft;
  creationMode?: ShiftScheduleCreationMode;
  onChange: (next: ShiftScheduleMaintenanceTaskDraft) => void;
  /** 第 2 步選的時間模板：用來即時對照「正線可壓縮整備開頭」與整備長度 */
  templateId?: string;
  /** 路線組合已選時的一輪時間（回頭修改時才有） */
  lockedRotationSeconds?: number | null;
  onAllowanceBlockingCountChange?: (count: number) => void;
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
    maneuver: previewDraft.maneuver.stepEnabled,
  };
}

export function StepShiftMaintenanceTask({
  draft,
  creationMode = 'parametric',
  onChange,
  templateId = '',
  lockedRotationSeconds = null,
  onAllowanceBlockingCountChange,
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
  const sectionCardLabelBySection = normalizeMaintenanceSectionCardLabelBySection(
    draft.sectionCardLabelBySection,
  );
  const sectionEnabled = draft.sectionEnabled;
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
          && current.sectionEnabled.maneuver === enabled.maneuver;
        // 機動的代號固定用 F（使用者 2026-11-28 指定；保養已用 M）：啟用機動又還沒填時自動帶入
        const fillManeuverCode = enabled.maneuver && !current.sectionCodeBySection.maneuver;
        if (!same || fillManeuverCode) {
          onChange({
            ...current,
            sectionEnabled: enabled,
            ...(fillManeuverCode
              ? { sectionCodeBySection: { ...current.sectionCodeBySection, maneuver: MANEUVER_DEFAULT_CODE } }
              : {}),
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
    if (taskId === draft.taskId) return;
    const item = items.find((row) => row.task_id === taskId);
    // 整備代號、班次卡標籤、讓渡餘裕是依整備類別（充電、待命…）設定的，不是綁某一份整備任務：
    // 換整備任務時保留已填的值（複製來的班表也不會被清掉）；哪幾類要填由新任務的啟用狀態決定。
    onChange({
      taskId,
      taskName: item?.name ?? '',
      skipped: false,
      entrySlackBySection: draft.entrySlackBySection,
      sectionCodeBySection: draft.sectionCodeBySection,
      sectionCardLabelBySection: draft.sectionCardLabelBySection,
      sectionEnabled: {
        charging: false,
        carWash: false,
        maintenance: false,
        preTrip: false,
        mobile: false,
        maneuver: false,
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

  const patchCardLabel = (key: MaintenanceSectionCodeKey, value: string) => {
    onChange({
      ...draft,
      sectionCardLabelBySection: {
        ...sectionCardLabelBySection,
        [key]: sanitizeMaintenanceSectionCardLabelInput(value),
      },
    });
  };

  const cardLabelField = (key: MaintenanceSectionCodeKey) => (
    <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
      <label className="block">
        <span className="mb-2 block px-1 text-body-s text-text-secondary">班次卡標籤</span>
        <input
          type="text"
          value={sectionCardLabelBySection[key]}
          onChange={(e) => patchCardLabel(key, e.target.value)}
          placeholder="儀表板顯示文字"
          maxLength={12}
          className={SELECT_CLASS}
        />
      </label>
      <p className="self-end pb-2.5 text-body-xs text-text-tertiary">顯示在即時數據儀表板的班次卡左上角。</p>
    </div>
  );

  const sectionCodeField = (key: MaintenanceSectionCodeKey) => {
    const issue = codeIssueByKey.get(key);
    return (
      <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 flex items-center px-1 text-body-s text-text-secondary">
            <span className="text-status-error">*</span>
            整備代號
          </span>
          <input
            type="text"
            value={sectionCodeBySection[key]}
            onChange={(e) => patchSectionCode(key, e.target.value)}
            placeholder={key === 'maneuver' ? `例：${MANEUVER_DEFAULT_CODE}` : '例：M'}
            maxLength={2}
            className={`${CODE_INPUT_CLASS} ${issue ? 'border-status-error focus:border-status-error focus:ring-status-error-light' : ''}`}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="mt-1.5 block px-1 text-body-xs text-text-quaternary">最長 2 字元，僅限英文字母</span>
          {issue ? <span className="mt-1 block px-1 text-body-xs text-status-error-emphasis">{issue}</span> : null}
        </label>
        <p className="flex items-center gap-1.5 self-start pt-[2.1rem] text-body-xs text-text-tertiary">
          <Lightbulb className="size-3.5 shrink-0" aria-hidden />
          預覽班次代號 {'{整備代號}{列碼}{開始時刻}'}
        </p>
      </div>
    );
  };

  const slackField = (key: MaintenanceEntrySlackSectionKey) => (
    <div>
      <span className="mb-2 flex items-center px-1 text-body-s text-text-secondary">
        <span className="text-status-error">*</span>
        正線優先讓渡餘裕
      </span>
      <div className="grid items-center gap-x-6 gap-y-2 md:grid-cols-2">
        <label className="flex items-center gap-3 text-body-s text-text-secondary">
          <span className="shrink-0">正線可壓縮整備開頭，最多</span>
          <span className="relative min-w-0 flex-1">
            <input
              type="text"
              inputMode="numeric"
              value={entrySlackBySection[key]}
              onChange={(e) => patchEntrySlack(key, sanitizeIntegerInput(e.target.value))}
              aria-label={`${SECTION_TITLE[key]}正線可壓縮整備開頭秒數`}
              className={`${SELECT_CLASS} pr-10`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body-s text-text-tertiary">秒</span>
          </span>
        </label>
        <p className="flex items-center gap-1.5 text-body-xs text-status-warning">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          超出此秒數上限時，系統將判定衝突不予排班
        </p>
      </div>
    </div>
  );

  const sectionExtras = {
    charging: (
      <div className="space-y-4">
        {sectionCodeField('charging')}
        {cardLabelField('charging')}
        {creationMode === 'parametric' ? slackField('charging') : null}
      </div>
    ),
    carWash: (
      <div className="space-y-4">
        {sectionCodeField('carWash')}
        {cardLabelField('carWash')}
        {creationMode === 'parametric' ? slackField('carWash') : null}
      </div>
    ),
    maintenance: (
      <div className="space-y-4">
        {sectionCodeField('maintenance')}
        {cardLabelField('maintenance')}
        {creationMode === 'parametric' ? slackField('maintenance') : null}
      </div>
    ),
    preTrip: (
      <div className="space-y-4">
        {sectionCodeField('preTrip')}
        {cardLabelField('preTrip')}
        {creationMode === 'parametric' ? slackField('preTrip') : null}
      </div>
    ),
    mobile: (
      <div className="space-y-4">
        {sectionCodeField('mobile')}
        {cardLabelField('mobile')}
        {creationMode === 'parametric' ? slackField('mobile') : null}
      </div>
    ),
    maneuver: (
      <div className="space-y-4">
        {sectionCodeField('maneuver')}
        {cardLabelField('maneuver')}
        {creationMode === 'parametric' ? slackField('maneuver') : null}
      </div>
    ),
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mb-5 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <h2 className="text-headline-5 text-text-primary">選擇要套用的整備計畫</h2>
      </div>

      <label className="block shrink-0">
        <span className="mb-2 flex items-center px-1 text-body-s text-text-secondary">
          <span className="text-status-error">*</span>
          整備任務
        </span>
        {loading ? (
          <div className="flex h-[42px] items-center gap-2 text-body-s text-text-quaternary">
            <Loader2 className="size-4 animate-spin" />
            載入整備任務中…
          </div>
        ) : (
          <SiteSelect
            value={draft.taskId}
            onChange={(e) => handleSelect(e.target.value)}
            className={SELECT_CLASS}
            disabled={Boolean(error) || items.length === 0}
          >
            <option value="">請選擇</option>
            {items.map((item) => (
              <option key={item.task_id} value={item.task_id}>
                {item.name}
              </option>
            ))}
          </SiteSelect>
        )}
        {error && <p className="mt-2 text-body-s text-status-error-emphasis">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="mt-2 text-body-s text-text-quaternary">
            尚無整備任務可選，請先至「整備任務管理」建立。
          </p>
        )}
      </label>

      <div className={`mt-6 min-h-[280px] flex-1 ${draft.taskId && !previewLoading && !previewError ? '' : 'overflow-auto rounded-xl border border-border-quaternary bg-black-30'}`}>
        {!draft.taskId ? (
          <ShiftSelectionEmptyState />
        ) : previewLoading ? (
          <div className="flex min-h-[280px] items-center justify-center gap-2 text-body-s text-text-quaternary">
            <Loader2 className="size-4 animate-spin" />
            載入整備任務預覽中…
          </div>
        ) : previewError ? (
          <div className="flex min-h-[280px] items-center justify-center px-6 text-body-s text-status-error-emphasis">
            {previewError}
          </div>
        ) : (
          <div className="space-y-4">
            <MaintenanceTaskPreviewContent
              draft={previewDraft}
              sectionExtras={sectionExtras}
              appearance="wizard"
            />
            {creationMode === 'parametric' && !draft.skipped ? (
              <YardEntryAllowancePanel
                templateId={templateId}
                maintenance={draft}
                lockedRotationSeconds={lockedRotationSeconds}
                onBlockingCountChange={onAllowanceBlockingCountChange}
                appearance="report"
                sections={(Object.keys(SECTION_TITLE) as MaintenanceSectionCodeKey[])
                  .filter((key) => sectionEnabled[key])
                  .map((key) => ({
                    label: SECTION_TITLE[key],
                    filled: Boolean(sectionCodeBySection[key]) && !codeIssueByKey.has(key)
                      && (creationMode !== 'parametric' || String(entrySlackBySection[key as MaintenanceEntrySlackSectionKey] ?? '').trim() !== ''),
                  }))}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
