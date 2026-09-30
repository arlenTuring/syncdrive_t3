import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ClipboardList,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkOperationShiftNameUnique,
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

type CreateShiftSchedulePageProps = {
  onBack: () => void;
  onSavedDraft?: () => void;
  editShiftId?: string;
  /** 新建時指定參數生成或手動製作；編輯既有草稿時以 body.creationMode 為準 */
  initialCreationMode?: 'parametric' | 'manual';
};

const INPUT_CLASS =
  'h-[42px] w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

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
    <div className="absolute right-6 top-6 flex items-center gap-2 text-xs text-zinc-400">
      {status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin text-zinc-500" />
          {t('shiftList.createWizard.savingDraft')}
        </>
      ) : status === 'saved' && savedAt ? (
        <>
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          {t('shiftList.createWizard.draftSaved', {
            time: formatAutoSaveTime(savedAt, i18n.language),
          })}
        </>
      ) : status === 'error' ? (
        <span className="text-red-400">{t('shiftList.createWizard.autoSaveFailed')}</span>
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
  onDiscard,
  onStepClick,
}: {
  currentStep: CreateShiftScheduleStep;
  maxReachedStep: CreateShiftScheduleStep;
  draft: ShiftScheduleCreateDraft;
  nameUniqueOk: boolean;
  turnaroundLimitSeconds: number | null;
  isScheduleInvalidated: boolean;
  onBack: () => void;
  onDiscard: () => void;
  onStepClick: (step: CreateShiftScheduleStep) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#08080a]">
      <div className="border-b border-zinc-800/80 px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          {t('shiftList.createWizard.backToPlatform')}
        </button>
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <ClipboardList className="size-4 text-[#2B7FFF]" />
          {t('shiftList.createWizard.title')}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <ol className="space-y-1">
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
                  className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    active
                      ? 'bg-[rgba(43,127,255,0.12)]'
                      : canClick
                        ? 'hover:bg-zinc-900/80'
                        : isStepLockedByInvalidation
                          ? 'cursor-not-allowed'
                          : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  {active && (
                    <span
                      className="absolute inset-y-2 left-0 w-1 rounded-r bg-[#2B7FFF]"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                      active
                        ? 'bg-[#2B7FFF] text-white'
                        : isStepLockedByInvalidation
                          ? 'bg-amber-400 text-zinc-950'
                          : completed
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {isStepLockedByInvalidation ? (
                      <AlertTriangle className="size-3.5" strokeWidth={2.5} aria-hidden />
                    ) : completed ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : (
                      displayIndex
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-wider text-zinc-600">
                      STEP {displayIndex}
                    </span>
                    <span
                      className={`block truncate text-sm ${
                        active ? 'font-medium text-zinc-100' : 'text-zinc-400'
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

      <div className="border-t border-zinc-800/80 p-4">
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <Trash2 className="size-4" />
          {t('shiftList.createWizard.discardDraft')}
        </button>
      </div>
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
      <h2 className="mb-6 text-base font-medium text-zinc-100">設定班表名稱與時間基準</h2>
      <div className="space-y-5">
        <label className="block">
          <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
            <span className="text-red-500">*</span>
            班表名稱
          </span>
          <div className="relative">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="請輸入"
              className={`${INPUT_CLASS} ${nameInvalid ? 'border-red-500/80 pr-9 focus:border-red-500 focus:ring-red-500/30' : ''}`}
            />
            {nameInvalid && (
              <AlertCircle className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-red-500" />
            )}
            {nameUniqueState === 'checking' && (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-zinc-500" />
            )}
          </div>
          {nameUniqueState === 'duplicate' && (
            <p className="mt-1 text-xs text-red-500">此班表名稱已存在，請重新輸入</p>
          )}
        </label>
        <label className="block">
          <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
            <span className="text-red-500">*</span>
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
          <span className="mb-2 block text-sm text-zinc-300">備註說明</span>
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
      alert('儲存草稿失敗：' + (e instanceof Error ? e.message : String(e)));
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
    const confirmed = window.confirm(t('shiftList.createWizard.confirmDiscard'));
    if (!confirmed) return;
    const id = savedShiftIdRef.current;
    if (id) {
      try {
        await deleteOperationShift(id);
        onSavedDraft?.();
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
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

  const handleFinish = () => {
    if (!canGoNext || draft.currentStep !== 7) return;
    void flushAutoSave().finally(onBack);
  };

  return (
    <div className="fixed inset-0 z-[60] flex bg-[#0a0a0b] text-zinc-100">
      <CreateStepSidebar
        currentStep={draft.currentStep}
        maxReachedStep={draft.maxReachedStep}
        draft={draft}
        nameUniqueOk={nameUniqueOk}
        turnaroundLimitSeconds={turnaroundLimitSeconds}
        isScheduleInvalidated={isScheduleInvalidated}
        onBack={handleBack}
        onDiscard={() => void handleDiscard()}
        onStepClick={(step) => {
          if (step <= draft.maxReachedStep) goToStep(step);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-zinc-800/60 px-8 py-3 text-center text-xs text-zinc-500">
          {t('shiftList.createWizard.stepHint')}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-8">
          <div
            className={`relative flex min-h-full flex-col rounded-2xl bg-[#111113] p-8 pt-14 ${
              showInvalidationChrome
                ? 'border-2 border-amber-400'
                : 'border border-zinc-800/80'
            }`}
          >
            <AutoSaveDraftBadge status={autoSaveStatus} savedAt={lastSavedAt} />
            {showInvalidationChrome && (
              <div className="mb-6 flex shrink-0 items-center justify-center gap-2 px-4 py-1 text-sm font-medium text-amber-400">
                <AlertTriangle className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
                <span>{t('shiftList.createWizard.scheduleInvalidated')}</span>
              </div>
            )}
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                <Loader2 className="size-6 animate-spin" />
                {t('shiftList.createWizard.loadingDraft')}
              </div>
            ) : loadError ? (
              <div className="flex min-h-[240px] items-center justify-center text-sm text-red-400">
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
                {draft.currentStep === 4 && draft.creationMode === 'parametric' ? (
                  <div className="mt-4 shrink-0">
                    <ScheduleDataCheckPanel {...dataCheck} />
                  </div>
                ) : null}
                {draft.currentStep === 4 && draft.creationMode === 'parametric' && !draft.maintenanceTask.skipped && draft.maintenanceTask.taskId ? (
                  <div className="mt-4 shrink-0">
                    <YardEntryAllowancePanel
                      templateId={draft.timeTemplate.templateId}
                      maintenance={draft.maintenanceTask}
                      lockedRotationSeconds={lockedRotationSeconds}
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

        <footer className="flex shrink-0 flex-col gap-1 border-t border-zinc-800/80 px-8 py-4">
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={draft.currentStep <= 1 || loading || Boolean(loadError)}
              className="text-sm text-[#2B7FFF] transition hover:text-[#5a9aff] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('shiftList.createWizard.previous')}
            </button>
            {showInvalidationChrome ? (
              <button
                type="button"
                onClick={() => void handleRebuildAndGoToAdjust()}
                disabled={loading || Boolean(loadError)}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="size-4" aria-hidden />
                {t('shiftList.createWizard.rebuildSchedule')}
              </button>
            ) : (
              <button
                type="button"
                onClick={draft.currentStep === 7 ? handleFinish : handleNext}
                disabled={!canGoNext || loading || Boolean(loadError)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  canGoNext && !loading && !loadError
                    ? 'bg-[#2B7FFF] text-white hover:bg-[#2569e6]'
                    : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
                }`}
              >
                {draft.currentStep === 7
                  ? t('shiftList.createWizard.saveCreate')
                  : t('shiftList.createWizard.next')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
