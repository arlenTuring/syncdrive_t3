import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ClipboardList,
  Lightbulb,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkOperationShiftNameUnique,
  completeOperationShift,
  createOperationShiftDraft,
  deleteOperationShift,
  fetchOperationShiftDetail,
  updateOperationShiftDraft,
} from '../api/operationShiftApi';
import { fetchTimeTemplateDetail } from '../../time-templates/api/timeTemplatesApi';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { resolveStrictestTurnaroundLimitSeconds } from '../../time-templates/utils/turnaroundLimitSegments';
import {
  buildShiftScheduleDraftFromStored,
  emptyShiftScheduleCreateDraft,
  isCreateShiftScheduleStepComplete,
  isShiftScheduleStepComplete,
  resolveNextCreateShiftStep,
  resolvePreviousCreateShiftStep,
  resolveShiftScheduleDraftName,
  resolveVisibleCreateShiftSteps,
  serializeShiftScheduleBody,
  isShiftScheduleOutputFresh,
  shouldInvalidateShiftScheduleOutput,
  type CreateShiftScheduleStep,
  type ShiftScheduleCreateDraft,
} from '../types/create';
import { StepShiftActionSettings } from './StepShiftActionSettings';
import { StepShiftMaintenanceTask } from './StepShiftMaintenanceTask';
import { YardEntryAllowancePanel } from './YardEntryAllowancePanel';
import { ScheduleDataCheckPanel } from './ScheduleDataCheckPanel';
import { useScheduleDataCheck } from '../hooks/useScheduleDataCheck';
import { StepShiftRouteGroups } from './StepShiftRouteGroups';
import { StepShiftScheduleAdjust } from './StepShiftScheduleAdjust';
import { StepShiftSchedulePreview } from './StepShiftSchedulePreview';
import { StepShiftTimeTemplate } from './StepShiftTimeTemplate';
import { syncActionSettingsWithSelectedRoutes } from '../utils/actionSettings';
import type { ShiftScheduleStoredOutput } from '../utils/shiftScheduleEngine.types';
import { systemAlert, systemConfirm } from '../../../lib/systemDialog';
import { Button } from '../../../components/ui';

type CreateShiftSchedulePageProps = {
  onBack: () => void;
  onSavedDraft?: () => void;
  editShiftId?: string;
  /** 新建時指定參數生成或手動製作；編輯既有草稿時以 body.creationMode 為準 */
  initialCreationMode?: 'parametric' | 'manual';
};

/** 設計稿：無外框、灰藍底的輸入框 */
const INPUT_CLASS =
  'h-9 w-full rounded-lg border border-transparent bg-surface-secondary px-3 text-body-s text-text-primary placeholder:text-text-quaternary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';

const AUTO_SAVE_DEBOUNCE_MS = 900;

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type NameUniqueState = 'idle' | 'checking' | 'unique' | 'duplicate' | 'error';

function formatAutoSaveTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function AutoSaveDraftBadge({
  status,
  savedAt,
}: {
  status: AutoSaveStatus;
  savedAt: Date | null;
}) {
  const { t, i18n } = useTranslation();
  if (status === 'idle' && !savedAt) return null;

  return (
    <div className="absolute right-8 top-[3.25rem] flex items-center gap-2 text-body-xs text-text-tertiary">
      {status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin text-text-quaternary" />
          {t('shiftList.createWizard.savingDraft')}
        </>
      ) : status === 'saved' && savedAt ? (
        <>
          <span className="size-2 rounded-full bg-status-success" aria-hidden />
          {t('shiftList.createWizard.draftSaved', {
            time: formatAutoSaveTime(savedAt, i18n.language),
          })}
        </>
      ) : status === 'error' ? (
        <span className="text-status-error-emphasis">{t('shiftList.createWizard.autoSaveFailed')}</span>
      ) : null}
    </div>
  );
}

function CreateStepSidebar({
  currentStep,
  maxReachedStep,
  draft,
  nameUniqueOk,
  turnaroundLimitSeconds,
  isScheduleInvalidated,
  onBack,
  onStepClick,
}: {
  currentStep: CreateShiftScheduleStep;
  maxReachedStep: CreateShiftScheduleStep;
  draft: ShiftScheduleCreateDraft;
  nameUniqueOk: boolean;
  turnaroundLimitSeconds: number | null;
  isScheduleInvalidated: boolean;
  onBack: () => void;
  onStepClick: (step: CreateShiftScheduleStep) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-[260px] shrink-0 flex-col rounded-2xl bg-surface-primary px-4 py-5">
      <Button hierarchy="subordinate" variant="standard" leadingIcon={<ArrowLeft />} onPress={onBack}>{t('shiftList.createWizard.backToPlatform')}</Button>
      <div className="mt-4 flex items-center gap-2 border-t border-border-quaternary px-1 pt-5 text-body-m-bold text-text-primary">
        <ClipboardList className="size-5 text-text-secondary" />
        {t('shiftList.createWizard.title')}
      </div>

      <nav className="mt-4 min-h-0 flex-1 overflow-auto">
        <ol className="space-y-1.5">
          {(() => {
            const visibleSteps = resolveVisibleCreateShiftSteps(draft.creationMode);
            return visibleSteps.map((item, index) => {
            const active = item.step === currentStep;
            const priorAndSelfComplete = visibleSteps.slice(0, index + 1).every((entry) =>
              isCreateShiftScheduleStepComplete(
                entry.step,
                draft,
                nameUniqueOk,
                turnaroundLimitSeconds,
              ),
            );
            const completed =
              !active
              && item.step <= maxReachedStep
              && priorAndSelfComplete;
            const unlocked = item.step <= maxReachedStep;
            // 調整班表(6)／整體預覽(7)：班表失效即鎖
            const isStepLockedByInvalidation =
              isScheduleInvalidated
              && item.step >= 6
              && item.step <= maxReachedStep;
            const canClick = unlocked && !isStepLockedByInvalidation;
            const displayIndex = index + 1;

            return (
              <li key={item.step}>
                <button
                  type="button"
                  disabled={!canClick}
                  onClick={() => canClick && onStepClick(item.step)}
                  title={
                    isStepLockedByInvalidation
                      ? t('shiftList.createWizard.scheduleLockedHint')
                      : undefined
                  }
                  aria-current={active ? 'step' : undefined}
                  className={`relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    active
                      ? 'border-[#3d5f8f] bg-[#232a36]'
                      : canClick
                        ? 'border-transparent hover:bg-link-standard'
                        : 'cursor-not-allowed border-transparent'
                  }`}
                >
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full border text-body-s font-medium ${
                      active
                        ? 'border-border-theme bg-link-theme-filled text-text-primary'
                        : isStepLockedByInvalidation
                          ? 'border-status-warning bg-status-warning text-text-invert'
                          : completed
                            ? 'border-status-success bg-status-success-light text-status-success'
                            : 'border-border-quaternary bg-surface-secondary text-text-secondary'
                    }`}
                  >
                    {isStepLockedByInvalidation ? (
                      <AlertTriangle className="size-4" strokeWidth={2.5} aria-hidden />
                    ) : completed ? (
                      <Check className="size-4" strokeWidth={2.5} />
                    ) : (
                      displayIndex
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-xs text-text-tertiary">
                      STEP {displayIndex}
                    </span>
                    <span
                      className={`block truncate text-body-m ${
                        canClick || active ? 'text-text-primary' : 'text-text-secondary'
                      }`}
                    >
                      {t(`shiftList.createWizard.steps.${item.step}`)}
                    </span>
                  </span>
                </button>
              </li>
            );
          });
          })()}
        </ol>
      </nav>

    </aside>
  );
}

function StepBasicInfo({
  draft,
  nameUniqueState,
  onChange,
}: {
  draft: ShiftScheduleCreateDraft['basic'];
  nameUniqueState: NameUniqueState;
  onChange: (next: ShiftScheduleCreateDraft['basic']) => void;
}) {
  const nameHasValue = draft.name.trim().length > 0;
  const nameInvalid = nameHasValue && (nameUniqueState === 'duplicate' || nameUniqueState === 'error');

  return (
    <div className="w-full">
      <h2 className="mb-5 text-headline-5 text-text-primary">設定班表名稱與時間基準</h2>
      <div className="space-y-5">
        <label className="block">
          <span className="mb-2 flex items-center px-1 text-body-s text-text-secondary">
            <span className="text-status-error">*</span>
            班表名稱
          </span>
          <div className="relative">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="請輸入"
              className={`${INPUT_CLASS} ${nameInvalid ? 'border-status-error pr-9 focus:border-status-error focus:ring-status-error-light' : ''}`}
            />
            {nameInvalid && (
              <AlertCircle className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-status-error" />
            )}
            {nameUniqueState === 'checking' && (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-text-quaternary" />
            )}
          </div>
          {nameUniqueState === 'duplicate' && (
            <p className="mt-1 text-body-xs text-status-error">此班表名稱已存在，請重新輸入</p>
          )}
        </label>
        <label className="block">
          <span className="mb-2 flex items-center px-1 text-body-s text-text-secondary">
            <span className="text-status-error">*</span>
            版本編號
          </span>
          <input
            type="text"
            value={draft.version}
            onChange={(e) => onChange({ ...draft, version: e.target.value })}
            placeholder="請輸入"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-2 block px-1 text-body-s text-text-secondary">備註說明</span>
          <input
            type="text"
            value={draft.remarks}
            onChange={(e) => onChange({ ...draft, remarks: e.target.value })}
            placeholder="請輸入"
            className={INPUT_CLASS}
          />
        </label>
      </div>
    </div>
  );
}

export function CreateShiftSchedulePage({
  onBack,
  onSavedDraft,
  editShiftId,
  initialCreationMode = 'parametric',
}: CreateShiftSchedulePageProps) {
  const { t } = useTranslation();
  const isEditing = Boolean(editShiftId);
  const [draft, setDraft] = useState<ShiftScheduleCreateDraft>(() =>
    emptyShiftScheduleCreateDraft(initialCreationMode),
  );
  const [savedShiftId, setSavedShiftId] = useState<string | undefined>(editShiftId);
  const [loading, setLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameUniqueState, setNameUniqueState] = useState<NameUniqueState>('idle');
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(!isEditing);
  const [turnaroundLimitSeconds, setTurnaroundLimitSeconds] = useState<number | null>(null);

  const isDirty = useRef(false);
  const skipAutoSaveOnce = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const savedShiftIdRef = useRef(savedShiftId);

  draftRef.current = draft;
  savedShiftIdRef.current = savedShiftId;

  const persistDraft = useCallback(async (): Promise<string | null> => {
    const currentDraft = draftRef.current;
    const payload = {
      name: resolveShiftScheduleDraftName(currentDraft.basic.name),
      body: serializeShiftScheduleBody(currentDraft),
    };
    const existingId = savedShiftIdRef.current ?? editShiftId;
    if (existingId) {
      await updateOperationShiftDraft(existingId, payload);
      return existingId;
    }
    const created = await createOperationShiftDraft(payload);
    setSavedShiftId(created.shift_id);
    savedShiftIdRef.current = created.shift_id;
    onSavedDraft?.();
    return created.shift_id;
  }, [editShiftId, onSavedDraft]);

  const runAutoSave = useCallback(async () => {
    if (loading || loadError) return;
    if (!isDirty.current) return;
    setAutoSaveStatus('saving');
    setSaveError(null);
    try {
      await persistDraft();
      isDirty.current = false;
      setLastSavedAt(new Date());
      setAutoSaveStatus('saved');
    } catch (e) {
      setAutoSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [loadError, loading, persistDraft]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void runAutoSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, [runAutoSave]);

  const flushAutoSave = useCallback(async () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    await runAutoSave();
  }, [runAutoSave]);

  const updateDraft = useCallback(
    (value: ShiftScheduleCreateDraft | ((prev: ShiftScheduleCreateDraft) => ShiftScheduleCreateDraft)) => {
      isDirty.current = true;
      setHydrated(true);
      setDraft((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        if (
          prev.scheduleOutput?.plan
          && isShiftScheduleOutputFresh({ ...next, scheduleOutput: prev.scheduleOutput })
        ) {
          return { ...next, scheduleOutput: prev.scheduleOutput };
        }
        if (shouldInvalidateShiftScheduleOutput(prev, next)) {
          return { ...next, scheduleOutput: null };
        }
        return next;
      });
    },
    [],
  );

  const handleScheduleOutputReady = useCallback(async (
    output: ShiftScheduleStoredOutput,
    options: { flush?: boolean } = {},
  ) => {
    isDirty.current = true;
    const nextDraft = { ...draftRef.current, scheduleOutput: output };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    if (options.flush) {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      setAutoSaveStatus('saving');
      setSaveError(null);
      try {
        await persistDraft();
        isDirty.current = false;
        setLastSavedAt(new Date());
        setAutoSaveStatus('saved');
      } catch (e) {
        setAutoSaveStatus('error');
        setSaveError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
  }, [persistDraft]);

  useEffect(() => {
    if (!editShiftId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchOperationShiftDetail(editShiftId)
      .then((detail) => {
        if (cancelled) return;
        skipAutoSaveOnce.current = true;
        setDraft(buildShiftScheduleDraftFromStored(detail.name, detail.body ?? {}));
        setSavedShiftId(detail.shift_id);
        savedShiftIdRef.current = detail.shift_id;
        setHydrated(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editShiftId]);

  useEffect(() => {
    if (!hydrated || loading || loadError) return;
    if (skipAutoSaveOnce.current) {
      skipAutoSaveOnce.current = false;
      return;
    }
    scheduleAutoSave();
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [draft, hydrated, loadError, loading, scheduleAutoSave]);

  useEffect(() => {
    const templateId = draft.timeTemplate.templateId.trim();
    if (!templateId) {
      setTurnaroundLimitSeconds(null);
      return;
    }
    let cancelled = false;
    void fetchTimeTemplateDetail(templateId)
      .then((detail) => {
        if (cancelled) return;
        const body = parseStoredTemplateBody(detail.body ?? {});
        setTurnaroundLimitSeconds(
          resolveStrictestTurnaroundLimitSeconds(body.tasks, body.intervals, body.attributes),
        );
      })
      .catch(() => {
        if (!cancelled) setTurnaroundLimitSeconds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.timeTemplate.templateId]);

  useEffect(() => {
    if (draft.currentStep !== 1) return;
    const name = draft.basic.name.trim();
    if (!name) {
      setNameUniqueState('idle');
      return;
    }

    setNameUniqueState('checking');
    const timer = window.setTimeout(() => {
      void checkOperationShiftNameUnique(name, savedShiftId ?? editShiftId)
        .then((unique) => setNameUniqueState(unique ? 'unique' : 'duplicate'))
        .catch(() => setNameUniqueState('error'));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [draft.basic.name, draft.currentStep, editShiftId, savedShiftId]);

  const nameUniqueOk =
    nameUniqueState === 'unique'
    || (nameUniqueState === 'idle'
      && draft.maxReachedStep > 1
      && draft.basic.name.trim().length > 0);

  /** 第 3 步：「正線可壓縮整備開頭」≥ 整備長度的段數（YARD-02：輸入不合法，不能往下） */
  const [allowanceBlockingCount, setAllowanceBlockingCount] = useState(0);
  /** 第 4 步選定的路線組合一輪時間（秒）；長整備的開頭額度用它重算（YARD-04、YARD-06） */
  const lockedRotationSeconds = useMemo(() => {
    const anchors = draft.routeGroups.throughAnchors;
    const preferred = anchors?.preferredThroughCycleId?.trim();
    if (!preferred) return null;
    return anchors?.listedThroughCycles?.find((cycle) => cycle.id === preferred)?.minCycleSeconds ?? null;
  }, [draft.routeGroups.throughAnchors]);

  /** 第 4 步：選圖／改路線當下檢查必要資料（MAP-02～04）；沒過不能往下 */
  const dataCheck = useScheduleDataCheck({
    draft,
    active: draft.currentStep === 4 && draft.creationMode === 'parametric' && hydrated,
    onRecord: (record) =>
      updateDraft((prev) => ({ ...prev, routeGroups: { ...prev.routeGroups, dataCheck: record } })),
  });

  /** 第 4 步底部「檢查」：重新列出路線組合並重跑資料檢查，之後才顯示檢查報告 */
  const [routeCheckSignal, setRouteCheckSignal] = useState(0);
  const [routeChecked, setRouteChecked] = useState(false);

  const canGoNext = useMemo(() => {
    if (loading || loadError) return false;
    const nameUnique = nameUniqueState === 'unique';
    if (draft.currentStep === 3 && draft.creationMode === 'parametric' && allowanceBlockingCount > 0) return false;
    if (draft.currentStep === 4 && draft.creationMode === 'parametric' && !dataCheck.passed) return false;
    return isShiftScheduleStepComplete(draft, nameUnique, turnaroundLimitSeconds);
  }, [allowanceBlockingCount, dataCheck.passed, draft, loadError, loading, nameUniqueState, turnaroundLimitSeconds]);

  const isScheduleInvalidated = useMemo(() => {
    // 手動製作不走引擎重新生成；改設定後不鎖步驟、不顯示黃框失效提示
    if (draft.creationMode === 'manual') return false;
    if (draft.maxReachedStep < 6) return false;
    if (!draft.scheduleOutput?.plan) return true;
    return !isShiftScheduleOutputFresh(draft);
  }, [draft]);

  const showInvalidationChrome =
    isScheduleInvalidated
    && (
      draft.currentStep === 2
      || draft.currentStep === 3
      || draft.currentStep === 4
      || draft.currentStep === 5
    );

  const handleRebuildAndGoToAdjust = async () => {
    setLoading(true);
    try {
      await flushAutoSave();
      // 跳到調整班表（第 6 步）；由該步依失效狀態自動重新生成
      setDraft((prev) => ({
        ...prev,
        currentStep: 6,
        maxReachedStep: Math.max(prev.maxReachedStep, 6) as CreateShiftScheduleStep,
        scheduleOutput: null,
      }));
    } catch (e) {
      void systemAlert('儲存草稿失敗：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  const navigateToStepFromPreview = useCallback((step: CreateShiftScheduleStep) => {
    if (step > draft.maxReachedStep) return;
    if (isScheduleInvalidated && step >= 6) return;
    setDraft((prev) => ({ ...prev, currentStep: step }));
  }, [draft.maxReachedStep, isScheduleInvalidated]);

  const goToStep = useCallback((step: CreateShiftScheduleStep) => {
    void flushAutoSave().finally(() =>
      setDraft((prev) => ({
        ...prev,
        currentStep: step,
        maxReachedStep: Math.max(prev.maxReachedStep, step) as CreateShiftScheduleStep,
        actionSettings:
          step === 5
            ? syncActionSettingsWithSelectedRoutes(
                prev.actionSettings,
                prev.routeGroups.selectedRoutes,
              )
            : prev.actionSettings,
      })),
    );
  }, [flushAutoSave]);

  const handleBack = useCallback(() => {
    if (hydrated && !loading && !loadError && isDirty.current) {
      void flushAutoSave().finally(onBack);
      return;
    }
    onBack();
  }, [flushAutoSave, hydrated, loadError, loading, onBack]);

  const handleDiscard = useCallback(async () => {
    const confirmed = (await systemConfirm(t('shiftList.createWizard.confirmDiscard')));
    if (!confirmed) return;
    const id = savedShiftIdRef.current;
    if (id) {
      try {
        await deleteOperationShift(id);
        onSavedDraft?.();
      } catch (e) {
        void systemAlert(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    onBack();
  }, [onBack, onSavedDraft, t]);

  const handlePrevious = () => {
    const prev = resolvePreviousCreateShiftStep(draft.currentStep, draft.creationMode);
    if (prev == null) return;
    goToStep(prev);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    const next = resolveNextCreateShiftStep(draft.currentStep, draft.creationMode);
    if (next == null) return;
    goToStep(next);
  };

  /** 完成建立：先存檔，再把製作狀態標成「已完成」；後端安全重驗不過就留在草稿區並說明原因 */
  const handleFinish = () => {
    if (!canGoNext || draft.currentStep !== 7) return;
    void (async () => {
      try {
        await flushAutoSave();
        const id = savedShiftIdRef.current ?? editShiftId;
        if (id) await completeOperationShift(id);
        onSavedDraft?.();
      } catch (e) {
        await systemAlert(`班表已存在草稿區，但還不能標成已完成：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        onBack();
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col gap-4 bg-surface-sub-background p-5 pb-4 text-text-primary">
      <div className="flex min-h-0 flex-1 gap-5">
      <CreateStepSidebar
        currentStep={draft.currentStep}
        maxReachedStep={draft.maxReachedStep}
        draft={draft}
        nameUniqueOk={nameUniqueOk}
        turnaroundLimitSeconds={turnaroundLimitSeconds}
        isScheduleInvalidated={isScheduleInvalidated}
        onBack={handleBack}
        onStepClick={(step) => {
          if (step <= draft.maxReachedStep) goToStep(step);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-surface-primary">
          <div
            className={`relative flex min-h-full flex-col rounded-2xl px-7 pb-6 pt-4 ${
              showInvalidationChrome ? 'border-2 border-status-warning' : ''
            }`}
          >
            <p className="mb-3 flex items-center justify-center gap-1.5 text-body-s text-text-tertiary">
              <Lightbulb className="size-4 text-text-tertiary" aria-hidden />
              {t('shiftList.createWizard.stepHint')}
            </p>
            <AutoSaveDraftBadge status={autoSaveStatus} savedAt={lastSavedAt} />
            {showInvalidationChrome && (
              <div className="mb-6 flex shrink-0 items-center justify-center gap-2 px-4 py-1 text-body-s-bold text-status-warning">
                <AlertTriangle className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
                <span>{t('shiftList.createWizard.scheduleInvalidated')}</span>
              </div>
            )}
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-2 text-text-quaternary">
                <Loader2 className="size-6 animate-spin" />
                {t('shiftList.createWizard.loadingDraft')}
              </div>
            ) : loadError ? (
              <div className="flex min-h-[240px] items-center justify-center text-body-s text-status-error-emphasis">
                {loadError}
              </div>
            ) : (
              <>
                {draft.currentStep === 1 && (
                  <StepBasicInfo
                    draft={draft.basic}
                    nameUniqueState={nameUniqueState}
                    onChange={(basic) => updateDraft((prev) => ({ ...prev, basic }))}
                  />
                )}
                {draft.currentStep === 2 && (
                  <StepShiftTimeTemplate
                    draft={draft.timeTemplate}
                    creationMode={draft.creationMode}
                    onChange={(timeTemplate) =>
                      updateDraft((prev) => ({ ...prev, timeTemplate }))
                    }
                  />
                )}
                {draft.currentStep === 3 && (
                  <StepShiftMaintenanceTask
                    draft={draft.maintenanceTask}
                    creationMode={draft.creationMode}
                    templateId={draft.timeTemplate.templateId}
                    lockedRotationSeconds={lockedRotationSeconds}
                    onAllowanceBlockingCountChange={setAllowanceBlockingCount}
                    onChange={(maintenanceTask) =>
                      updateDraft((prev) => ({ ...prev, maintenanceTask }))
                    }
                  />
                )}
                {draft.currentStep === 4 && (
                  <StepShiftRouteGroups
                    draft={draft.routeGroups}
                    timeTemplateId={draft.timeTemplate.templateId}
                    creationMode={draft.creationMode}
                    maintenanceSkipped={draft.maintenanceTask.skipped}
                    maintenanceSectionCodes={draft.maintenanceTask.sectionCodeBySection}
                    maintenanceSectionEnabled={draft.maintenanceTask.sectionEnabled}
                    checkSignal={routeCheckSignal}
                    onChange={(routeGroups) =>
                      updateDraft((prev) => {
                        const nextRouteGroups =
                          typeof routeGroups === 'function'
                            ? routeGroups(prev.routeGroups)
                            : routeGroups;
                        return {
                          ...prev,
                          routeGroups: nextRouteGroups,
                          actionSettings: syncActionSettingsWithSelectedRoutes(
                            prev.actionSettings,
                            nextRouteGroups.selectedRoutes.filter(
                              (route) => !route.backupForInstanceId && !route.backupForRouteId,
                            ),
                          ),
                        };
                      })
                    }
                  />
                )}
                {draft.currentStep === 4 && draft.creationMode === 'parametric' && (routeChecked || canGoNext) ? (
                  <div className="mt-4 shrink-0">
                    <YardEntryAllowancePanel
                      appearance="report"
                      templateId={draft.timeTemplate.templateId}
                      maintenance={draft.maintenanceTask}
                      lockedRotationSeconds={lockedRotationSeconds}
                      skipAllowance={draft.maintenanceTask.skipped || !draft.maintenanceTask.taskId}
                      extra={<ScheduleDataCheckPanel {...dataCheck} embedded />}
                      extraOk={dataCheck.passed && canGoNext}
                    />
                  </div>
                ) : null}
                {draft.currentStep === 5 && (
                  <StepShiftActionSettings
                    draft={draft.actionSettings}
                    selectedRoutes={draft.routeGroups.selectedRoutes}
                    mapId={draft.routeGroups.mapId}
                    onChange={(actionSettings) =>
                      updateDraft((prev) => ({ ...prev, actionSettings }))
                    }
                  />
                )}
                {draft.currentStep === 6 && (
                  <StepShiftScheduleAdjust
                    draft={draft}
                    shiftId={savedShiftId}
                    onScheduleOutputReady={handleScheduleOutputReady}
                  />
                )}
                {draft.currentStep === 7 && (
                  <StepShiftSchedulePreview
                    draft={draft}
                    turnaroundLimitSeconds={turnaroundLimitSeconds}
                    onNavigateToStep={navigateToStepFromPreview}
                  />
                )}
              </>
            )}
          </div>
        </div>

      </div>
      </div>

        <footer className="flex shrink-0 flex-col gap-1 px-2">
          {saveError && <p className="text-right text-body-xs text-status-error-emphasis">{saveError}</p>}
          <div className="flex items-center gap-6">
            <Button hierarchy="danger" variant="outlined" className="mr-auto" leadingIcon={<Trash2 />} onPress={() => void handleDiscard()} disabled={!savedShiftId || loading}>{t('shiftList.createWizard.discardDraft')}</Button>
            <Button variant="text" onPress={handlePrevious} disabled={draft.currentStep <= 1 || loading || Boolean(loadError)}>{t('shiftList.createWizard.previous')}</Button>
            {showInvalidationChrome ? (
              <Button leadingIcon={<RefreshCw />} onPress={() => void handleRebuildAndGoToAdjust()} disabled={loading || Boolean(loadError)}>
                {t('shiftList.createWizard.rebuildSchedule')}
              </Button>
            ) : draft.currentStep === 4 && draft.creationMode === 'parametric' && !canGoNext ? (
              <Button onPress={() => {
                  setRouteCheckSignal((value) => value + 1);
                  dataCheck.recheck();
                  setRouteChecked(true);
                }} disabled={
                  loading
                  || Boolean(loadError)
                  || !draft.routeGroups.mapId.trim()
                  || draft.routeGroups.selectedRoutes.length === 0
                }>檢查</Button>
            ) : (
              <Button onPress={draft.currentStep === 7 ? handleFinish : handleNext} disabled={!canGoNext || loading || Boolean(loadError)}>
                {draft.currentStep === 7
                  ? t('shiftList.createWizard.saveCreate')
                  : draft.currentStep === 6
                    ? t('shiftList.createWizard.saveAndPreview')
                    : t('shiftList.createWizard.next')}
              </Button>
            )}
          </div>
        </footer>
    </div>
  );
}
