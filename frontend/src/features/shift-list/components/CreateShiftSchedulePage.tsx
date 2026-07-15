import { AlertCircle, ArrowLeft, Check, ClipboardList, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  CREATE_SHIFT_SCHEDULE_STEPS,
  buildShiftScheduleDraftFromStored,
  emptyShiftScheduleCreateDraft,
  isCreateShiftScheduleStepComplete,
  isShiftScheduleStepComplete,
  resolveShiftScheduleDraftName,
  serializeShiftScheduleBody,
  shouldInvalidateShiftScheduleOutput,
  type CreateShiftScheduleStep,
  type ShiftScheduleCreateDraft,
} from '../types/create';
import { StepShiftMaintenanceTask } from './StepShiftMaintenanceTask';
import { StepShiftRouteGroups } from './StepShiftRouteGroups';
import { StepShiftScheduleAdjust } from './StepShiftScheduleAdjust';
import { StepShiftSchedulePreview } from './StepShiftSchedulePreview';
import { StepShiftTimeTemplate } from './StepShiftTimeTemplate';
import type { ShiftScheduleStoredOutput } from '../utils/shiftScheduleEngine.types';

type CreateShiftSchedulePageProps = {
  onBack: () => void;
  onSavedDraft?: () => void;
  editShiftId?: string;
};

const INPUT_CLASS =
  'h-[42px] w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

const AUTO_SAVE_DEBOUNCE_MS = 900;

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type NameUniqueState = 'idle' | 'checking' | 'unique' | 'duplicate' | 'error';

function formatAutoSaveTime(date: Date): string {
  return date.toLocaleTimeString('zh-TW', {
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
  if (status === 'idle' && !savedAt) return null;

  return (
    <div className="absolute right-6 top-6 flex items-center gap-2 text-xs text-zinc-400">
      {status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin text-zinc-500" />
          草稿儲存中…
        </>
      ) : status === 'saved' && savedAt ? (
        <>
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          草稿已自動儲存 ({formatAutoSaveTime(savedAt)})
        </>
      ) : status === 'error' ? (
        <span className="text-red-400">自動儲存失敗</span>
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
  onBack,
  onDiscard,
  onStepClick,
}: {
  currentStep: CreateShiftScheduleStep;
  maxReachedStep: CreateShiftScheduleStep;
  draft: ShiftScheduleCreateDraft;
  nameUniqueOk: boolean;
  turnaroundLimitSeconds: number | null;
  onBack: () => void;
  onDiscard: () => void;
  onStepClick: (step: CreateShiftScheduleStep) => void;
}) {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#08080a]">
      <div className="border-b border-zinc-800/80 px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          返回平台
        </button>
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <ClipboardList className="size-4 text-[#2B7FFF]" />
          建立正線班表
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <ol className="space-y-1">
          {CREATE_SHIFT_SCHEDULE_STEPS.map((item) => {
            const active = item.step === currentStep;
            const completed =
              !active
              && item.step <= maxReachedStep
              && isCreateShiftScheduleStepComplete(
                item.step,
                draft,
                nameUniqueOk,
                turnaroundLimitSeconds,
              );
            const unlocked = item.step <= maxReachedStep;
            return (
              <li key={item.step}>
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => unlocked && onStepClick(item.step)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    active
                      ? 'bg-[rgba(43,127,255,0.12)]'
                      : unlocked
                        ? 'hover:bg-zinc-900/80'
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
                        : completed
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {completed ? <Check className="size-3.5" strokeWidth={2.5} /> : item.step}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-wider text-zinc-600">
                      STEP {item.step}
                    </span>
                    <span
                      className={`block truncate text-sm ${
                        active ? 'font-medium text-zinc-100' : 'text-zinc-400'
                      }`}
                    >
                      {item.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="border-t border-zinc-800/80 p-4">
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <Trash2 className="size-4" />
          放棄並清除本次草稿
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
}: CreateShiftSchedulePageProps) {
  const isEditing = Boolean(editShiftId);
  const [draft, setDraft] = useState<ShiftScheduleCreateDraft>(() => emptyShiftScheduleCreateDraft());
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

  const canGoNext = useMemo(() => {
    if (loading || loadError) return false;
    const nameUnique = nameUniqueState === 'unique';
    return isShiftScheduleStepComplete(draft, nameUnique, turnaroundLimitSeconds);
  }, [draft, loadError, loading, nameUniqueState, turnaroundLimitSeconds]);

  const goToStep = useCallback((step: CreateShiftScheduleStep) => {
    void flushAutoSave().finally(() =>
      setDraft((prev) => ({
        ...prev,
        currentStep: step,
        maxReachedStep: Math.max(prev.maxReachedStep, step) as CreateShiftScheduleStep,
        ...(step === 5 ? { scheduleOutput: null } : {}),
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
    const confirmed = window.confirm('確定要放棄並清除本次草稿嗎？');
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
  }, [onBack, onSavedDraft]);

  const handlePrevious = () => {
    if (draft.currentStep <= 1) return;
    goToStep((draft.currentStep - 1) as CreateShiftScheduleStep);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (draft.currentStep >= 6) return;
    goToStep((draft.currentStep + 1) as CreateShiftScheduleStep);
  };

  const handleFinish = () => {
    if (!canGoNext || draft.currentStep !== 6) return;
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
        onBack={handleBack}
        onDiscard={() => void handleDiscard()}
        onStepClick={(step) => {
          if (step <= draft.maxReachedStep) goToStep(step);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-zinc-800/60 px-8 py-3 text-center text-xs text-zinc-500">
          提示：可以隨時點擊左側已解鎖的步驟直接修改
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-8">
          <div className="relative flex min-h-full flex-col rounded-2xl border border-zinc-800/80 bg-[#111113] p-8 pt-14">
            <AutoSaveDraftBadge status={autoSaveStatus} savedAt={lastSavedAt} />
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                <Loader2 className="size-6 animate-spin" />
                載入草稿中…
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
                  <StepShiftMaintenanceTask
                    draft={draft.maintenanceTask}
                    onChange={(maintenanceTask) =>
                      updateDraft((prev) => ({ ...prev, maintenanceTask }))
                    }
                  />
                )}
                {draft.currentStep === 3 && (
                  <StepShiftTimeTemplate
                    draft={draft.timeTemplate}
                    onChange={(timeTemplate) =>
                      updateDraft((prev) => ({ ...prev, timeTemplate }))
                    }
                  />
                )}
                {draft.currentStep === 4 && (
                  <StepShiftRouteGroups
                    draft={draft.routeGroups}
                    timeTemplateId={draft.timeTemplate.templateId}
                    onChange={(routeGroups) =>
                      updateDraft((prev) => ({ ...prev, routeGroups }))
                    }
                  />
                )}
                {draft.currentStep === 5 && (
                  <StepShiftScheduleAdjust
                    draft={draft}
                    shiftId={savedShiftId}
                    onScheduleOutputReady={handleScheduleOutputReady}
                  />
                )}
                {draft.currentStep === 6 && (
                  <StepShiftSchedulePreview draft={draft} />
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
              上一步
            </button>
            <button
              type="button"
              onClick={draft.currentStep === 6 ? handleFinish : handleNext}
              disabled={!canGoNext || loading || Boolean(loadError)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                canGoNext && !loading && !loadError
                  ? 'bg-[#2B7FFF] text-white hover:bg-[#2569e6]'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
              }`}
            >
              {draft.currentStep === 6 ? '儲存建立' : '下一步'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
