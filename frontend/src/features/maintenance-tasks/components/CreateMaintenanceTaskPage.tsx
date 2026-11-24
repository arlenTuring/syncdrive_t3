import { AlertCircle, ArrowLeft, Check, ClipboardList, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkMaintenanceTaskNameUnique,
  createMaintenanceTaskDraft,
  deleteMaintenanceTask,
  fetchMaintenanceTaskDetail,
  updateMaintenanceTaskDraft,
} from '../api/maintenanceTasksApi';
import {
  CREATE_MAINTENANCE_TASK_STEPS,
  buildMaintenanceTaskDraftFromStored,
  emptyMaintenanceTaskCreateDraft,
  isCarWashStepComplete,
  isCreateMaintenanceTaskStepComplete,
  createMaintenanceTaskStepIncompleteReason,
  isMaintenanceStepComplete,
  MAINTENANCE_STEP_COUNT,
  isChargingStepComplete,
  isPreTripStepComplete,
  isMobileStepComplete,
  resolveMaintenanceTaskDraftName,
  serializeMaintenanceTaskBody,
  type CreateMaintenanceTaskStep,
  type MaintenanceTaskCreateDraft,
} from '../types/create';
import { StepChargingParams } from './StepChargingParams';
import { StepCarWashParams } from './StepCarWashParams';
import { StepMaintenanceParams } from './StepMaintenanceParams';
import { StepPreTripParams } from './StepPreTripParams';
import { StepMobileParams } from './StepMobileParams';
import { StepSchedulePreview } from './StepSchedulePreview';
import { systemAlert, systemConfirm } from '../../../lib/systemDialog';
import { Button, cn, fieldClass } from '../../../components/ui';

type CreateMaintenanceTaskPageProps = {
  onBack: () => void;
  onSavedDraft?: () => void;
  editTaskId?: string;
};

const INPUT_CLASS =
  cn(fieldClass({ size: 'md', fullWidth: true }));

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
    <div className="absolute right-6 top-6 flex items-center gap-2 text-body-xs text-text-tertiary">
      {status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin text-text-quaternary" />
          {t('maintenanceTasks.createWizard.savingDraft')}
        </>
      ) : status === 'saved' && savedAt ? (
        <>
          <span className="size-2 rounded-full bg-status-success" aria-hidden />
          {t('maintenanceTasks.createWizard.draftSaved', {
            time: formatAutoSaveTime(savedAt, i18n.language),
          })}
        </>
      ) : status === 'error' ? (
        <span className="text-status-error-emphasis">{t('maintenanceTasks.createWizard.autoSaveFailed')}</span>
      ) : null}
    </div>
  );
}

function CreateStepSidebar({
  currentStep,
  maxReachedStep,
  draft,
  nameUniqueOk,
  onBack,
  onDiscard,
  onStepClick,
}: {
  currentStep: CreateMaintenanceTaskStep;
  maxReachedStep: CreateMaintenanceTaskStep;
  draft: MaintenanceTaskCreateDraft;
  nameUniqueOk: boolean;
  onBack: () => void;
  onDiscard: () => void;
  onStepClick: (step: CreateMaintenanceTaskStep) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border-quaternary bg-[#08080a]">
      <div className="border-b border-border-quaternary px-4 py-4">
        <Button hierarchy="subordinate" variant="text" className="mb-4" leadingIcon={<ArrowLeft />} onPress={onBack}>{t('maintenanceTasks.createWizard.backToPlatform')}</Button>
        <div className="flex items-center gap-2 text-body-s-bold text-text-primary">
          <ClipboardList className="size-4 text-violet-400" />
          {t('maintenanceTasks.createWizard.title')}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <ol className="space-y-1">
          {CREATE_MAINTENANCE_TASK_STEPS.map((item) => {
            const active = item.step === currentStep;
            const completed =
              !active
              && item.step <= maxReachedStep
              && isCreateMaintenanceTaskStepComplete(item.step, draft, { nameUniqueOk });
            const unlocked = item.step <= maxReachedStep;
            return (
              <li key={item.step}>
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => unlocked && onStepClick(item.step)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    active
                      ? 'bg-link-tonal'
                      : unlocked
                        ? 'hover:bg-surface-primary'
                        : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  {active && (
                    <span
                      className="absolute inset-y-2 left-0 w-1 rounded-r bg-link-theme-filled"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-body-xs font-medium ${
                      active
                        ? 'bg-link-theme-filled text-text-primary'
                        : completed
                          ? 'bg-status-success-light text-status-success'
                          : 'bg-surface-secondary text-text-quaternary'
                    }`}
                  >
                    {completed ? <Check className="size-3.5" strokeWidth={2.5} /> : item.step}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption-2 uppercase text-text-disabled">
                      STEP {item.step}
                    </span>
                    <span
                      className={`block truncate text-body-s ${
                        active ? 'font-medium text-text-primary' : 'text-text-tertiary'
                      }`}
                    >
                      {t(`maintenanceTasks.createWizard.steps.${item.step}`)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="border-t border-border-quaternary p-4">
        <Button hierarchy="subordinate" variant="outlined" className="w-full" leadingIcon={<Trash2 />} onPress={onDiscard}>{t('maintenanceTasks.createWizard.discardDraft')}</Button>
      </div>
    </aside>
  );
}

function StepBasicInfo({
  draft,
  nameUniqueState,
  onChange,
}: {
  draft: MaintenanceTaskCreateDraft['basic'];
  nameUniqueState: NameUniqueState;
  onChange: (next: MaintenanceTaskCreateDraft['basic']) => void;
}) {
  const { t } = useTranslation();
  const nameHasValue = draft.name.trim().length > 0;
  const nameInvalid = nameHasValue && (nameUniqueState === 'duplicate' || nameUniqueState === 'error');

  return (
    <div className="w-full">
      <h2 className="mb-6 text-body-m-bold text-text-primary">{t('maintenanceTasks.createWizard.setNameTitle')}</h2>
      <div className="space-y-5">
        <label className="block">
          <span className="mb-2 flex items-center gap-1 text-body-s text-text-secondary">
            <span className="text-status-error">*</span>
            {t('maintenanceTasks.createWizard.scheduleName')}
          </span>
          <div className="relative">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder={t('maintenanceTasks.createWizard.placeholder')}
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
            <p className="mt-1 text-body-xs text-status-error">{t('maintenanceTasks.createWizard.nameDuplicate')}</p>
          )}
          {nameUniqueState === 'error' && (
            <p className="mt-1 text-body-xs text-status-error">{t('maintenanceTasks.createWizard.nameCheckFailed')}</p>
          )}
        </label>
        <label className="block">
          <span className="mb-2 flex items-center gap-1 text-body-s text-text-secondary">
            <span className="text-status-error">*</span>
            {t('maintenanceTasks.createWizard.version')}
          </span>
          <input
            type="text"
            value={draft.version}
            onChange={(e) => onChange({ ...draft, version: e.target.value })}
            placeholder={t('maintenanceTasks.createWizard.placeholder')}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-body-s text-text-secondary">{t('maintenanceTasks.createWizard.remarks')}</span>
          <input
            type="text"
            value={draft.remarks}
            onChange={(e) => onChange({ ...draft, remarks: e.target.value })}
            placeholder={t('maintenanceTasks.createWizard.placeholder')}
            className={INPUT_CLASS}
          />
        </label>
      </div>
    </div>
  );
}

export function CreateMaintenanceTaskPage({
  onBack,
  onSavedDraft,
  editTaskId,
}: CreateMaintenanceTaskPageProps) {
  const { t } = useTranslation();
  const isEditing = Boolean(editTaskId);
  const [draft, setDraft] = useState<MaintenanceTaskCreateDraft>(() => emptyMaintenanceTaskCreateDraft());
  const [savedTaskId, setSavedTaskId] = useState<string | undefined>(editTaskId);
  const [loading, setLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameUniqueState, setNameUniqueState] = useState<NameUniqueState>('idle');
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(!isEditing);
  const [previewReachedBottom, setPreviewReachedBottom] = useState(false);
  const [completing, setCompleting] = useState(false);

  const previewScrollRef = useRef<HTMLDivElement>(null);

  const isDirty = useRef(false);
  const skipAutoSaveOnce = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const savedTaskIdRef = useRef(savedTaskId);

  draftRef.current = draft;
  savedTaskIdRef.current = savedTaskId;

  /**
   * 存檔一律排隊、照呼叫順序送出：每一次送的是呼叫當下那份草稿。以前自動存檔與「完成」可能同時在飛，
   * 晚回來的舊內容會蓋掉剛存好的完成狀態。
   */
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const persistDraft = useCallback(async (snapshot?: MaintenanceTaskCreateDraft): Promise<string | null> => {
    const currentDraft = snapshot ?? draftRef.current;
    const payload = {
      name: resolveMaintenanceTaskDraftName(currentDraft.basic.name),
      body: serializeMaintenanceTaskBody(currentDraft),
    };
    const run = async () => {
      const existingId = savedTaskIdRef.current ?? editTaskId;
      if (existingId) {
        await updateMaintenanceTaskDraft(existingId, payload);
        return existingId;
      }
      const created = await createMaintenanceTaskDraft(payload);
      setSavedTaskId(created.task_id);
      savedTaskIdRef.current = created.task_id;
      onSavedDraft?.();
      return created.task_id;
    };
    const next = saveQueue.current.catch(() => undefined).then(run);
    saveQueue.current = next;
    return next;
  }, [editTaskId, onSavedDraft]);

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
    (value: MaintenanceTaskCreateDraft | ((prev: MaintenanceTaskCreateDraft) => MaintenanceTaskCreateDraft)) => {
      isDirty.current = true;
      setHydrated(true);
      // 改了設定內容：之前的「完成建立」不再代表目前內容，要重新走到檢視按完成
      setDraft((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        return next === prev || !next.editorCompletedAt ? next : { ...next, editorCompletedAt: null };
      });
    },
    [],
  );

  useEffect(() => {
    if (!editTaskId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchMaintenanceTaskDetail(editTaskId)
      .then((detail) => {
        if (cancelled) return;
        skipAutoSaveOnce.current = true;
        setDraft(buildMaintenanceTaskDraftFromStored(detail.name, detail.body ?? {}));
        setSavedTaskId(detail.task_id);
        savedTaskIdRef.current = detail.task_id;
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
  }, [editTaskId]);

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
    if (draft.currentStep !== 1) return;
    const name = draft.basic.name.trim();
    if (!name) {
      setNameUniqueState('idle');
      return;
    }

    setNameUniqueState('checking');
    const timer = window.setTimeout(() => {
      void checkMaintenanceTaskNameUnique(name, savedTaskId ?? editTaskId)
        .then((unique) => setNameUniqueState(unique ? 'unique' : 'duplicate'))
        .catch(() => setNameUniqueState('error'));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [draft.basic.name, draft.currentStep, editTaskId, savedTaskId]);

  useEffect(() => {
    if (draft.currentStep !== 7) {
      setPreviewReachedBottom(false);
    }
  }, [draft.currentStep]);

  const canGoNext = useMemo(() => {
    if (loading || loadError) return false;
    if (draft.currentStep === 1) {
      const hasRequired = draft.basic.name.trim().length > 0 && draft.basic.version.trim().length > 0;
      return hasRequired && nameUniqueState === 'unique';
    }
    if (draft.currentStep === 2) {
      return isChargingStepComplete(draft.charging);
    }
    if (draft.currentStep === 3) {
      return isCarWashStepComplete(draft.carWash);
    }
    if (draft.currentStep === 4) {
      return isMaintenanceStepComplete(draft.maintenance);
    }
    if (draft.currentStep === 5) {
      return isPreTripStepComplete(draft.preTrip);
    }
    if (draft.currentStep === 6) {
      return isMobileStepComplete(draft.mobile);
    }
    return true;
  }, [
    draft.basic.name,
    draft.basic.version,
    draft.carWash,
    draft.charging,
    draft.maintenance,
    draft.preTrip,
    draft.mobile,
    draft.currentStep,
    loadError,
    loading,
    nameUniqueState,
  ]);

  const goToStep = useCallback((step: CreateMaintenanceTaskStep) => {
    void flushAutoSave().finally(() =>
      setDraft((prev) => ({
        ...prev,
        currentStep: step,
        maxReachedStep: Math.max(prev.maxReachedStep, step) as CreateMaintenanceTaskStep,
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
    const confirmed = (await systemConfirm(t('maintenanceTasks.createWizard.confirmDiscard')));
    if (!confirmed) return;
    const id = savedTaskIdRef.current;
    if (id) {
      try {
        await deleteMaintenanceTask(id);
        onSavedDraft?.();
      } catch (e) {
        void systemAlert(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    onBack();
  }, [onBack, onSavedDraft, t]);

  const handlePrevious = () => {
    if (draft.currentStep <= 1) return;
    goToStep((draft.currentStep - 1) as CreateMaintenanceTaskStep);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (draft.currentStep >= MAINTENANCE_STEP_COUNT) return;
    goToStep((draft.currentStep + 1) as CreateMaintenanceTaskStep);
  };

  /** 每一步都完整才能完成建立；不完整時指出第幾步缺什麼 */
  const firstIncompleteStep = (current: MaintenanceTaskCreateDraft) => {
    for (const item of CREATE_MAINTENANCE_TASK_STEPS) {
      if (item.step === MAINTENANCE_STEP_COUNT) continue;
      const reason = createMaintenanceTaskStepIncompleteReason(item.step, current, { nameUniqueOk: true });
      if (reason) return { step: item.step, reason };
    }
    return null;
  };

  /**
   * 完成建立：把「完成」連同完整內容明確存進後端，存成功才返回。
   * 存檔失敗就留在這一頁顯示錯誤，不宣稱完成。這是表單設定完成，不是車輛整備完成。
   */
  const handleComplete = useCallback(async () => {
    if (!previewReachedBottom || loading || loadError || completing) return;
    const incomplete = firstIncompleteStep(draftRef.current);
    if (incomplete) {
      setSaveError(`第 ${incomplete.step} 步：${incomplete.reason}`);
      return;
    }
    setCompleting(true);
    setSaveError(null);
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    const completed: MaintenanceTaskCreateDraft = {
      ...draftRef.current,
      currentStep: MAINTENANCE_STEP_COUNT as CreateMaintenanceTaskStep,
      maxReachedStep: MAINTENANCE_STEP_COUNT as CreateMaintenanceTaskStep,
      editorCompletedAt: new Date().toISOString(),
    };
    try {
      await persistDraft(completed);
      skipAutoSaveOnce.current = true;
      setDraft(completed);
      isDirty.current = false;
      setLastSavedAt(new Date());
      setAutoSaveStatus('saved');
      onSavedDraft?.();
      onBack();
    } catch (e) {
      setAutoSaveStatus('error');
      setSaveError(`完成建立沒有存進去：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCompleting(false);
    }
  }, [completing, loadError, loading, onBack, onSavedDraft, persistDraft, previewReachedBottom]);

  /** 目前這一步不能前進的原因（顯示在下一步按鈕旁，不只是把按鈕變灰） */
  const currentStepReason =
    draft.currentStep < MAINTENANCE_STEP_COUNT && !loading && !loadError && !canGoNext
      ? draft.currentStep === 1 && nameUniqueState === 'duplicate'
        ? '名稱已存在，請換一個'
        : createMaintenanceTaskStepIncompleteReason(draft.currentStep, draft, {
            nameUniqueOk: nameUniqueState !== 'duplicate',
          })
      : null;

  const nameUniqueOk =
    nameUniqueState === 'unique'
    || (nameUniqueState === 'idle'
      && draft.maxReachedStep > 1
      && draft.basic.name.trim().length > 0);

  const isLastStep = draft.currentStep === MAINTENANCE_STEP_COUNT;
  const primaryActionEnabled = isLastStep
    ? previewReachedBottom && !loading && !loadError && !completing
    : canGoNext;

  return (
    <div className="fixed inset-0 z-[60] flex bg-surface-sub-background text-text-primary">
      <CreateStepSidebar
        currentStep={draft.currentStep}
        maxReachedStep={draft.maxReachedStep}
        draft={draft}
        nameUniqueOk={nameUniqueOk}
        onBack={handleBack}
        onDiscard={() => void handleDiscard()}
        onStepClick={(step) => {
          if (step <= draft.maxReachedStep) goToStep(step);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-border-quaternary px-8 py-3 text-center text-body-xs text-text-quaternary">
          {t('maintenanceTasks.createWizard.stepHint')}
        </div>

        <div ref={previewScrollRef} className="min-h-0 flex-1 overflow-auto p-8">
          <div className="relative min-h-full rounded-2xl border border-border-quaternary bg-surface-sub-background p-8 pt-14">
            <AutoSaveDraftBadge status={autoSaveStatus} savedAt={lastSavedAt} />
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-2 text-text-quaternary">
                <Loader2 className="size-6 animate-spin" />
                {t('maintenanceTasks.createWizard.loadingDraft')}
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
                  <StepChargingParams
                    draft={draft.charging}
                    onChange={(charging) => updateDraft((prev) => ({ ...prev, charging }))}
                  />
                )}
                {draft.currentStep === 3 && (
                  <StepCarWashParams
                    draft={draft.carWash}
                    onChange={(carWash) => updateDraft((prev) => ({ ...prev, carWash }))}
                  />
                )}
                {draft.currentStep === 4 && (
                  <StepMaintenanceParams
                    draft={draft.maintenance}
                    onChange={(maintenance) => updateDraft((prev) => ({ ...prev, maintenance }))}
                  />
                )}
                {draft.currentStep === 5 && (
                  <StepPreTripParams
                    draft={draft.preTrip}
                    onChange={(preTrip) => updateDraft((prev) => ({ ...prev, preTrip }))}
                  />
                )}
                {draft.currentStep === 6 && (
                  <StepMobileParams
                    draft={draft.mobile}
                    onChange={(mobile) => updateDraft((prev) => ({ ...prev, mobile }))}
                  />
                )}
                {draft.currentStep === MAINTENANCE_STEP_COUNT && (
                  <StepSchedulePreview
                    draft={draft}
                    scrollRootRef={previewScrollRef}
                    onReachedBottom={setPreviewReachedBottom}
                    onEditStep={(step) => {
                      if (step >= 1 && step < MAINTENANCE_STEP_COUNT) goToStep(step);
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-1 border-t border-border-quaternary px-8 py-4">
          {saveError && <p className="text-body-xs text-status-error-emphasis">{saveError}</p>}
          {!saveError && currentStepReason && <p className="text-body-xs text-status-warning">{currentStepReason}</p>}
          <div className="flex items-center justify-end gap-4">
            <Button variant="text" onPress={handlePrevious} disabled={draft.currentStep <= 1 || loading || Boolean(loadError)}>{t('maintenanceTasks.createWizard.previous')}</Button>
            <Button
              onPress={() => (isLastStep ? void handleComplete() : handleNext())}
              disabled={!primaryActionEnabled}
              leadingIcon={completing ? <Loader2 className="animate-spin" /> : undefined}
            >
              {completing
                ? t('common.saving')
                : isLastStep
                  ? t('maintenanceTasks.createWizard.finish')
                  : t('maintenanceTasks.createWizard.next')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
