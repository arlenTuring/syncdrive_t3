import { ArrowLeft, Check, FileText, Info, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CREATE_TEMPLATE_STEPS,
  TIME_TEMPLATE_PREVIEW_TITLE,
  TIME_TEMPLATE_TITLE_PLACEHOLDER,
  buildEditorDraftFromStored,
  computeCapacityPphpd,
  emptyEditorDraft,
  isCreateTemplateStepComplete,
  isCreateTemplateStepUnlocked,
  isCreateTemplateStep1Complete,
  isCreateTemplateStep2Complete,
  resolveTimeTemplateDraftName,
  serializeEditorDraftBody,
  type CreateTemplateStep,
  type TimeSlotAttribute,
  type TimeTemplateEditorDraft,
} from '../types/editor';
import { StepOverallPreview } from './StepOverallPreview';
import { StepTaskScheduling } from './StepTaskScheduling';
import { TimeSlotAttributesPanel } from './TimeSlotAttributesPanel';
import { TimeSlotIntervalsPanel } from './TimeSlotIntervalsPanel';
import { VehicleCapacitySlider } from './VehicleCapacitySlider';
import {
  createTimeTemplateDraft,
  deleteTimeTemplate,
  fetchTimeTemplateDetail,
  updateTimeTemplateDraft,
} from '../api/timeTemplatesApi';

type CreateTimeTemplateModalProps = {
  onClose: () => void;
  onSavedDraft?: () => void;
  editTemplateId?: string;
};


const BASIC_INFO_FIELD_CLASS =
  'h-9 w-full rounded-lg bg-[rgba(142,197,255,0.08)] px-3 text-sm leading-[18px] tracking-[0.5px] text-[#D1D5DC] placeholder:text-[#99A1AF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/40';

const AUTO_SAVE_DEBOUNCE_MS = 900;

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
    <div className="absolute right-4 top-4 flex items-center gap-2 text-xs text-zinc-400">
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
  collapsed = false,
  onBack,
  onDiscard,
  onStepClick,
}: {
  currentStep: CreateTemplateStep;
  maxReachedStep: CreateTemplateStep;
  draft: TimeTemplateEditorDraft;
  collapsed?: boolean;
  onBack: () => void;
  onDiscard: () => void;
  onStepClick: (step: CreateTemplateStep) => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col border-r border-zinc-800/80 bg-[#08080a]">
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-auto py-4">
          {CREATE_TEMPLATE_STEPS.map((item) => {
            const active = item.step === currentStep;
            const completed =
              !active
              && item.step <= maxReachedStep
              && isCreateTemplateStepComplete(item.step, draft);
            const unlocked = isCreateTemplateStepUnlocked(item.step, maxReachedStep, draft);
            return (
              <button
                key={item.step}
                type="button"
                disabled={!unlocked}
                title={item.label}
                onClick={() => unlocked && onStepClick(item.step)}
                className={`relative flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition ${
                  active
                    ? 'bg-[#2B7FFF] text-white ring-2 ring-[#2B7FFF]/30'
                    : completed
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : unlocked
                        ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        : 'cursor-not-allowed bg-zinc-900 text-zinc-600 opacity-50'
                }`}
              >
                {completed ? <Check className="size-3.5" strokeWidth={2.5} /> : item.step}
              </button>
            );
          })}
        </nav>
      </aside>
    );
  }

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
          <FileText className="size-4 text-[#2B7FFF]" />
          建立時間模板
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <ol className="space-y-1">
          {CREATE_TEMPLATE_STEPS.map((item) => {
            const active = item.step === currentStep;
            const completed =
              !active
              && item.step <= maxReachedStep
              && isCreateTemplateStepComplete(item.step, draft);
            const unlocked = isCreateTemplateStepUnlocked(item.step, maxReachedStep, draft);
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

function StepBasicInfoCard({
  name,
  vehicleCapacity,
  onNameChange,
  onVehicleCapacityChange,
}: {
  name: string;
  vehicleCapacity: number;
  onNameChange: (name: string) => void;
  onVehicleCapacityChange: (value: number) => void;
}) {
  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-[rgba(142,197,255,0.08)]">
      <div className="flex items-center gap-2 border-b border-[rgba(212,212,212,0.1)] px-4 py-2">
        <Info className="size-5 text-[#99A1AF]" strokeWidth={1.75} />
        <h3 className="text-base font-medium text-[#F3F4F6]">基本資料</h3>
      </div>
      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        <label className="block min-w-0">
          <span className="mb-1.5 flex items-center gap-1 text-sm text-[#D1D5DC]">
            <span className="text-red-500">*</span>
            時間模板名稱
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={TIME_TEMPLATE_TITLE_PLACEHOLDER}
            className={BASIC_INFO_FIELD_CLASS}
          />
        </label>
        <div className="block min-w-0">
          <span className="mb-1.5 block text-sm text-[#D1D5DC]">車體載運量</span>
          <VehicleCapacitySlider
            value={vehicleCapacity}
            onChange={onVehicleCapacityChange}
            hideValueSublabel
          />
        </div>
      </div>
    </section>
  );
}

function StepOperatingSlots({
  draft,
  onChange,
}: {
  draft: TimeTemplateEditorDraft;
  onChange: (next: TimeTemplateEditorDraft) => void;
}) {
  const syncAttributes = (attributes: TimeSlotAttribute[]) => {
    const withCapacity = attributes.map((attr) => ({
      ...attr,
      capacityPphpd: computeCapacityPphpd(draft.vehicleCapacity, attr.headwaySeconds),
    }));
    const nextIds = new Set(withCapacity.map((attr) => attr.id));
    const intervals = draft.intervals
      .filter((slot) => nextIds.has(slot.attributeId))
      .map((slot) => {
        const attr = withCapacity.find((a) => a.id === slot.attributeId);
        if (!attr || slot.isDraft) return slot;
        return { ...slot, name: attr.name };
      });
    onChange({ ...draft, attributes: withCapacity, intervals });
  };

  const syncVehicleCapacity = (vehicleCapacity: number) => {
    const attributes = draft.attributes.map((attr) => ({
      ...attr,
      capacityPphpd: computeCapacityPphpd(vehicleCapacity, attr.headwaySeconds),
    }));
    onChange({ ...draft, vehicleCapacity, attributes });
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <h2 className="text-base font-medium text-zinc-100">設定時間模板名稱與時段設定</h2>
      <StepBasicInfoCard
        name={draft.name}
        vehicleCapacity={draft.vehicleCapacity}
        onNameChange={(name) => onChange({ ...draft, name })}
        onVehicleCapacityChange={syncVehicleCapacity}
      />
      <div className="shrink-0">
        <TimeSlotAttributesPanel
          attributes={draft.attributes}
          vehicleCapacity={draft.vehicleCapacity}
          onVehicleCapacityChange={syncVehicleCapacity}
          onChange={syncAttributes}
          showVehicleCapacity={false}
        />
      </div>
      <div className="shrink-0">
        <TimeSlotIntervalsPanel
          attributes={draft.attributes}
          intervals={draft.intervals}
          onChange={(intervals) => onChange({ ...draft, intervals })}
        />
      </div>
    </div>
  );
}

function stepContentTitle(step: CreateTemplateStep): string {
  if (step === 1) return '設定時間模板名稱與時段設定';
  if (step === 2) return '設定各時段的任務排班';
  return TIME_TEMPLATE_PREVIEW_TITLE;
}

export function CreateTimeTemplateModal({
  onClose,
  onSavedDraft,
  editTemplateId,
}: CreateTimeTemplateModalProps) {
  const isEditing = Boolean(editTemplateId);
  const [step, setStep] = useState<CreateTemplateStep>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<CreateTemplateStep>(1);
  const [draft, setDraft] = useState<TimeTemplateEditorDraft>(() => emptyEditorDraft());
  const [savedTemplateId, setSavedTemplateId] = useState<string | undefined>(editTemplateId);
  const [loading, setLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(!isEditing);
  const [scheduleFullscreen, setScheduleFullscreen] = useState(false);
  const skipAutoSaveOnce = useRef(false);
  const isDirty = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const savedTemplateIdRef = useRef(savedTemplateId);

  draftRef.current = draft;
  savedTemplateIdRef.current = savedTemplateId;

  useEffect(() => {
    if (step !== 2) setScheduleFullscreen(false);
  }, [step]);

  const persistDraft = useCallback(async (): Promise<string | null> => {
    const currentDraft = draftRef.current;
    const payload = {
      name: resolveTimeTemplateDraftName(currentDraft.name),
      body: serializeEditorDraftBody(currentDraft),
    };
    const existingId = savedTemplateIdRef.current ?? editTemplateId;
    if (existingId) {
      await updateTimeTemplateDraft(existingId, payload);
      return existingId;
    }
    const created = await createTimeTemplateDraft(payload);
    setSavedTemplateId(created.template_id);
    savedTemplateIdRef.current = created.template_id;
    onSavedDraft?.();
    return created.template_id;
  }, [editTemplateId, onSavedDraft]);

  const runAutoSave = useCallback(async () => {
    if (loading || loadError) return;
    if (!isDirty.current) return;
    setAutoSaveStatus('saving');
    setSaveError(null);
    try {
      await persistDraft();
      isDirty.current = false;
      setAutoSaveStatus('saved');
      setLastSavedAt(new Date());
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
    (value: TimeTemplateEditorDraft | ((prev: TimeTemplateEditorDraft) => TimeTemplateEditorDraft)) => {
      isDirty.current = true;
      setHydrated(true);
      setDraft(value);
    },
    [],
  );

  useEffect(() => {
    if (!editTemplateId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchTimeTemplateDetail(editTemplateId)
      .then((detail) => {
        if (cancelled) return;
        skipAutoSaveOnce.current = true;
        setDraft(buildEditorDraftFromStored(detail.name, detail.body ?? {}));
        setHydrated(true);
        setMaxReachedStep(3);
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
  }, [editTemplateId]);

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
  }, [draft, step, hydrated, loadError, loading, scheduleAutoSave]);

  const goToStep = useCallback((next: CreateTemplateStep) => {
    void flushAutoSave().finally(() => {
      setStep(next);
      setMaxReachedStep((prev) => Math.max(prev, next) as CreateTemplateStep);
    });
  }, [flushAutoSave]);

  const handleBack = useCallback(() => {
    if (hydrated && !loading && !loadError && isDirty.current) {
      void flushAutoSave().finally(onClose);
      return;
    }
    onClose();
  }, [flushAutoSave, hydrated, loadError, loading, onClose]);

  const handleDiscard = useCallback(async () => {
    const confirmed = window.confirm('確定要放棄並清除本次草稿嗎？');
    if (!confirmed) return;
    const id = savedTemplateIdRef.current;
    if (id) {
      try {
        await deleteTimeTemplate(id);
        onSavedDraft?.();
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    onClose();
  }, [onClose, onSavedDraft]);

  const canGoNext = useMemo(() => {
    if (loading || loadError) return false;
    if (step === 1) return isCreateTemplateStep1Complete(draft);
    if (step === 2) return isCreateTemplateStep2Complete(draft);
    return true;
  }, [draft, loadError, loading, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack]);

  const handleSaveDraft = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await flushAutoSave();
      onSavedDraft?.();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handlePrevious = () => {
    if (step <= 1) return;
    goToStep((step - 1) as CreateTemplateStep);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (step < 3) {
      goToStep((step + 1) as CreateTemplateStep);
      return;
    }
    void handleSaveDraft();
  };

  return (
    <div className="fixed inset-0 z-[60] flex bg-[#0a0a0b] text-zinc-100">
      <CreateStepSidebar
        currentStep={step}
        maxReachedStep={maxReachedStep}
        draft={draft}
        collapsed={step === 2 && scheduleFullscreen}
        onBack={handleBack}
        onDiscard={() => void handleDiscard()}
        onStepClick={(next) => {
          if (isCreateTemplateStepUnlocked(next, maxReachedStep, draft)) {
            goToStep(next);
          }
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className={`min-h-0 flex-1 ${
            step === 2
              ? scheduleFullscreen
                ? 'flex flex-col overflow-hidden'
                : 'flex flex-col overflow-hidden px-8 pb-4'
              : 'overflow-auto px-8 pb-8'
          }`}
        >
          <div
            className={`relative flex flex-col ${
              step === 2 && scheduleFullscreen
                ? 'min-h-0 flex-1 overflow-hidden bg-[#111113]'
                : `rounded-2xl border border-zinc-800/80 bg-[#111113] px-6 pb-6 pt-4 ${
                    step === 2 ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-full'
                  }`
            }`}
          >
            {!(step === 2 && scheduleFullscreen) && (
              <AutoSaveDraftBadge status={autoSaveStatus} savedAt={lastSavedAt} />
            )}
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-2 text-zinc-500">
                <Loader2 className="size-6 animate-spin" />
                載入模板中…
              </div>
            ) : loadError ? (
              <div className="flex min-h-[240px] items-center justify-center text-sm text-red-400">
                {loadError}
              </div>
            ) : (
              <>
                {!(step === 2 && scheduleFullscreen) && (
                  <div className="mb-3 shrink-0 pr-28">
                    <p className="text-xs text-zinc-500">
                      提示：可以隨時點擊左側已解鎖的步驟直接修改
                    </p>
                    {step !== 1 && (
                      <h2 className="mt-2 text-base font-medium text-zinc-100">
                        {stepContentTitle(step)}
                        {step === 2 && draft.name.trim() && (
                          <span className="ml-2 font-normal text-zinc-500">
                            · {resolveTimeTemplateDraftName(draft.name)}
                          </span>
                        )}
                      </h2>
                    )}
                  </div>
                )}
                <div
                  className={`min-h-0 flex-1 ${
                    step === 2 || step === 3 ? 'flex flex-col overflow-hidden' : ''
                  } ${step === 2 && scheduleFullscreen ? 'p-4 pt-3' : ''}`}
                >
                  {step === 1 && <StepOperatingSlots draft={draft} onChange={updateDraft} />}
                  {step === 2 && (
                    <StepTaskScheduling
                      intervals={draft.intervals.filter((slot) => !slot.isDraft)}
                      attributes={draft.attributes.filter((attr) => !attr.isDraft)}
                      tasks={draft.tasks}
                      rowCount={draft.scheduleRowCount}
                      fullscreen={scheduleFullscreen}
                      panelTitle={stepContentTitle(2)}
                      onFullscreenChange={setScheduleFullscreen}
                      onRowCountChange={(scheduleRowCount) =>
                        updateDraft((d) => ({ ...d, scheduleRowCount }))
                      }
                      onTasksChange={(tasks) => updateDraft((d) => ({ ...d, tasks }))}
                    />
                  )}
                  {step === 3 && (
                    <StepOverallPreview
                      name={draft.name}
                      intervals={draft.intervals.filter((slot) => !slot.isDraft)}
                      attributes={draft.attributes.filter((attr) => !attr.isDraft)}
                      tasks={draft.tasks}
                      rowCount={draft.scheduleRowCount}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {!(step === 2 && scheduleFullscreen) && (
        <footer className="flex shrink-0 flex-col gap-1 border-t border-zinc-800/80 px-8 py-4">
          {(saveError || autoSaveStatus === 'error') && (
            <p className="text-xs text-red-400">{saveError ?? '自動儲存失敗'}</p>
          )}
          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={step <= 1 || loading || Boolean(loadError)}
              className="text-sm text-[#2B7FFF] transition hover:text-[#5a9aff] disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一步
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext || saving || loading || Boolean(loadError)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                canGoNext && !saving && !loading && !loadError
                  ? 'bg-[#2B7FFF] text-white hover:bg-[#2569e6]'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
              }`}
            >
              {saving ? '儲存中…' : step < 3 ? '下一步' : '確認儲存'}
            </button>
          </div>
        </footer>
        )}
      </div>
    </div>
  );
}
