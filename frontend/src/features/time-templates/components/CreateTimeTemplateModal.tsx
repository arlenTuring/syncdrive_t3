import { ArrowLeft, Check, FileText, Info, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CREATE_TEMPLATE_STEPS,
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
import { systemAlert, systemConfirm } from '../../../lib/systemDialog';
import { Button, cn, fieldClass } from '../../../components/ui';

type CreateTimeTemplateModalProps = {
  onClose: () => void;
  onSavedDraft?: () => void;
  editTemplateId?: string;
};


const BASIC_INFO_FIELD_CLASS =
  cn(fieldClass({ size: 'md', fullWidth: true }));

const AUTO_SAVE_DEBOUNCE_MS = 900;

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
    <div className="absolute right-4 top-4 flex items-center gap-2 text-body-xs text-text-tertiary">
      {status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin text-text-quaternary" />
          {t('timeTemplates.createWizard.savingDraft')}
        </>
      ) : status === 'saved' && savedAt ? (
        <>
          <span className="size-2 rounded-full bg-status-success" aria-hidden />
          {t('timeTemplates.createWizard.draftSaved', {
            time: formatAutoSaveTime(savedAt, i18n.language),
          })}
        </>
      ) : status === 'error' ? (
        <span className="text-status-error-emphasis">{t('timeTemplates.createWizard.autoSaveFailed')}</span>
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
  const { t } = useTranslation();
  const stepLabel = (step: CreateTemplateStep) => t(`timeTemplates.createWizard.steps.${step}`);

  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col border-r border-border-quaternary bg-[#08080a]">
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
                title={stepLabel(item.step)}
                onClick={() => unlocked && onStepClick(item.step)}
                className={`relative flex size-9 shrink-0 items-center justify-center rounded-full text-body-xs font-medium transition ${
                  active
                    ? 'bg-link-theme-filled text-text-primary ring-2 ring-link-theme-filled/30'
                    : completed
                      ? 'bg-status-success-light text-status-success'
                      : unlocked
                        ? 'bg-surface-secondary text-text-tertiary hover:bg-link-standard-hover'
                        : 'cursor-not-allowed bg-surface-primary text-text-disabled opacity-50'
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
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border-quaternary bg-[#08080a]">
      <div className="border-b border-border-quaternary px-4 py-4">
        <Button hierarchy="subordinate" variant="text" className="mb-4" leadingIcon={<ArrowLeft />} onPress={onBack}>{t('timeTemplates.createWizard.backToPlatform')}</Button>
        <div className="flex items-center gap-2 text-body-s-bold text-text-primary">
          <FileText className="size-4 text-text-theme-light" />
          {t('timeTemplates.createWizard.title')}
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
                      {stepLabel(item.step)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="border-t border-border-quaternary p-4">
        <Button hierarchy="subordinate" variant="outlined" className="w-full" leadingIcon={<Trash2 />} onPress={onDiscard}>{t('timeTemplates.createWizard.discardDraft')}</Button>
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
  const { t } = useTranslation();
  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-surface-theme">
      <div className="flex items-center gap-2 border-b border-border-quaternary px-4 py-2">
        <Info className="size-5 text-text-tertiary" strokeWidth={1.75} />
        <h3 className="text-body-m-bold text-text-primary">{t('timeTemplates.createWizard.basicInfo')}</h3>
      </div>
      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        <label className="block min-w-0">
          <span className="mb-1.5 flex items-center gap-1 text-body-s text-text-secondary">
            <span className="text-status-error">*</span>
            {t('timeTemplates.createWizard.templateName')}
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('timeTemplates.createWizard.namePlaceholder')}
            className={BASIC_INFO_FIELD_CLASS}
          />
        </label>
        <div className="block min-w-0">
          <span className="mb-1.5 block text-body-s text-text-secondary">{t('timeTemplates.createWizard.vehicleCapacity')}</span>
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
  const { t } = useTranslation();
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
      <h2 className="text-body-m-bold text-text-primary">{t('timeTemplates.createWizard.stepTitle1')}</h2>
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

function stepContentTitle(step: CreateTemplateStep, t: (key: string) => string): string {
  if (step === 1) return t('timeTemplates.createWizard.stepTitle1');
  if (step === 2) return t('timeTemplates.createWizard.stepTitle2');
  return t('timeTemplates.createWizard.stepTitle3');
}

export function CreateTimeTemplateModal({
  onClose,
  onSavedDraft,
  editTemplateId,
}: CreateTimeTemplateModalProps) {
  const { t } = useTranslation();
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
    const confirmed = (await systemConfirm(t('timeTemplates.createWizard.confirmDiscard')));
    if (!confirmed) return;
    const id = savedTemplateIdRef.current;
    if (id) {
      try {
        await deleteTimeTemplate(id);
        onSavedDraft?.();
      } catch (e) {
        void systemAlert(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    onClose();
  }, [onClose, onSavedDraft, t]);

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
    <div className="fixed inset-0 z-[60] flex bg-surface-sub-background text-text-primary">
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
                ? 'min-h-0 flex-1 overflow-hidden bg-surface-sub-background'
                : `rounded-2xl border border-border-quaternary bg-surface-sub-background px-6 pb-6 pt-4 ${
                    step === 2 ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-full'
                  }`
            }`}
          >
            {!(step === 2 && scheduleFullscreen) && (
              <AutoSaveDraftBadge status={autoSaveStatus} savedAt={lastSavedAt} />
            )}
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-2 text-text-quaternary">
                <Loader2 className="size-6 animate-spin" />
                {t('timeTemplates.createWizard.loadingTemplate')}
              </div>
            ) : loadError ? (
              <div className="flex min-h-[240px] items-center justify-center text-body-s text-status-error-emphasis">
                {loadError}
              </div>
            ) : (
              <>
                {!(step === 2 && scheduleFullscreen) && (
                  <div className="mb-3 shrink-0 pr-28">
                    <p className="text-body-xs text-text-quaternary">
                      {t('timeTemplates.createWizard.stepHint')}
                    </p>
                    {step !== 1 && (
                      <h2 className="mt-2 text-body-m-bold text-text-primary">
                        {stepContentTitle(step, t)}
                        {step === 2 && draft.name.trim() && (
                          <span className="ml-2 font-normal text-text-quaternary">
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
                      panelTitle={stepContentTitle(2, t)}
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
        <footer className="flex shrink-0 flex-col gap-1 border-t border-border-quaternary px-8 py-4">
          {(saveError || autoSaveStatus === 'error') && (
            <p className="text-body-xs text-status-error-emphasis">{saveError ?? t('timeTemplates.createWizard.autoSaveFailed')}</p>
          )}
          <div className="flex items-center justify-end gap-4">
            <Button variant="text" onPress={handlePrevious} disabled={step <= 1 || loading || Boolean(loadError)}>{t('timeTemplates.createWizard.previous')}</Button>
            <Button onPress={handleNext} disabled={!canGoNext || saving || loading || Boolean(loadError)}>{saving
                ? t('common.saving')
                : step < 3
                  ? t('timeTemplates.createWizard.next')
                  : t('timeTemplates.createWizard.confirmSave')}</Button>
          </div>
        </footer>
        )}
      </div>
    </div>
  );
}
