import { SiteDateTimeInput } from '../../../components/SiteDateTimeInput';
import { Calendar, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExecutionTimeField,
  formatLocalHm,
  formatLocalYmd,
} from './ExecutionTimeField';
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference';
import { useSupervisorApprovalPreference } from '../../schedule-management/utils/supervisorApprovalPreference';
import {
  deployOperationShift,
  fetchOperationShiftDetail,
  fetchOperationShiftList,
} from '../../shift-list/api/operationShiftApi';
import { StepShiftSchedulePreview } from '../../shift-list/components/StepShiftSchedulePreview';
import { ShiftMenuSelect } from '../../shift-list/components/ShiftMenuSelect';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import {
  buildShiftScheduleDraftFromStored,
  type ShiftScheduleCreateDraft,
} from '../../shift-list/types/create';
import type { OperationShiftListItem } from '../../shift-list/types';
import { ScheduleAdjustDiffStep } from './ScheduleAdjustDiffStep';
import {
  readPendingScheduleAdjust,
  writePendingScheduleAdjust,
  resolvePendingScheduleAdjust,
} from '../pendingScheduleAdjust';
import { systemConfirm } from '../../../lib/systemDialog';
import { Button, Dialog, IconButton } from '../../../components/ui';

type ScheduleAdjustApplyDialogProps = {
  onClose: () => void;
  /** 執行班表卡上的名稱；找不到「使用中」班表時用來對清單名稱兜底 */
  currentScheduleName?: string;
  onApplied?: () => void;
};

const FIELD_LABEL = 'mb-1.5 block text-body-xs text-text-tertiary';
const INPUT =
  'h-10 w-full rounded-lg border border-border-quaternary bg-surface-primary px-3 pr-9 text-body-s text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light-trn [color-scheme:dark]';
const EMPTY_PICKER =
  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0';

export function ScheduleAdjustApplyDialog({
  onClose,
  currentScheduleName = '',
  onApplied,
}: ScheduleAdjustApplyDialogProps) {
  const { t } = useTranslation();
  const approvalPhrase = t('shiftDeployment.adjust.approvalPhrase');
  const [account] = useDemoAccount();
  const [supervisorApproval] = useSupervisorApprovalPreference();
  const showSupervisorApproval = supervisorApproval && account.id === 'supervisor';
  const [step, setStep] = useState<1 | 2>(1);
  const [approvalText, setApprovalText] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [execDate, setExecDate] = useState('');
  const [execTime, setExecTime] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [shifts, setShifts] = useState<OperationShiftListItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShiftScheduleCreateDraft | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<ShiftScheduleCreateDraft | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [missingCurrent, setMissingCurrent] = useState(false);

  useEffect(() => {
    const pending = readPendingScheduleAdjust();
    if (!pending) return;
    setExecDate(pending.execDate);
    setExecTime(pending.execTime);
    setShiftId(pending.shiftId);
    setStep(2);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchOperationShiftList({
      usage_status: 'all',
      publish_status: 'all',
      page: 1,
      page_size: 200,
    })
      .then((res) => {
        if (!cancelled) {
          setShifts(res.items);
          setListError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setShifts([]);
          setListError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shiftId) {
      setDraft(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void fetchOperationShiftDetail(shiftId)
      .then((detail) => {
        if (cancelled) return;
        setDraft(buildShiftScheduleDraftFromStored(detail.name, detail.body ?? {}));
      })
      .catch((err) => {
        if (cancelled) return;
        setDraft(null);
        setPreviewError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  const inUseShiftId = useMemo(() => {
    const deployed =
      shifts.find((item) => item.usage_status === 'in_use')
      ?? (currentScheduleName
        ? shifts.find((item) => item.name === currentScheduleName)
        : undefined);
    return deployed?.shift_id ?? '';
  }, [currentScheduleName, shifts]);

  const options = useMemo(
    () =>
      shifts.map((item) => {
        const inUse =
          item.usage_status === 'in_use'
          || (inUseShiftId !== '' && item.shift_id === inUseShiftId);
        return {
          value: item.shift_id,
          label: item.name,
          disabled: inUse,
          badge: inUse ? t('shiftDeployment.adjust.inUse') : undefined,
        };
      }),
    [inUseShiftId, shifts, t],
  );

  useEffect(() => {
    if (!shiftId || !inUseShiftId) return;
    if (shiftId === inUseShiftId) setShiftId('');
  }, [inUseShiftId, shiftId]);

  const selectedName =
    draft?.basic.name.trim()
    || options.find((item) => item.value === shiftId)?.label
    || '';

  const canNext = Boolean(execDate && execTime && shiftId && draft?.scheduleOutput);

  useEffect(() => {
    if (step !== 2) return;
    const deployed =
      shifts.find((item) => item.usage_status === 'in_use')
      ?? (currentScheduleName
        ? shifts.find((item) => item.name === currentScheduleName)
        : undefined);
    if (!deployed) {
      setCurrentDraft(null);
      setMissingCurrent(true);
      setCurrentError(null);
      setCurrentLoading(false);
      return;
    }
    setMissingCurrent(false);
    if (deployed.shift_id === shiftId && draft) {
      setCurrentDraft(draft);
      setCurrentError(null);
      setCurrentLoading(false);
      return;
    }
    let cancelled = false;
    setCurrentLoading(true);
    setCurrentError(null);
    void fetchOperationShiftDetail(deployed.shift_id)
      .then((detail) => {
        if (cancelled) return;
        setCurrentDraft(buildShiftScheduleDraftFromStored(detail.name, detail.body ?? {}));
      })
      .catch((err) => {
        if (cancelled) return;
        setCurrentDraft(null);
        setCurrentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setCurrentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentScheduleName, draft, shiftId, shifts, step]);

  const deploySelected = async () => {
    if (!shiftId) throw new Error(t('shiftDeployment.adjust.noScheduleSelected'));
    await deployOperationShift(shiftId, { reviewer_name: account.name });
    // 部署成功＝這筆申請已套用至營運，稽核紀錄要記 APPLIED 而不是籠統的「取消」
    await resolvePendingScheduleAdjust('APPLIED', account.name);
  };

  const finishApplied = () => {
    onApplied?.();
    onClose();
  };

  const handleDeployNow = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await deploySelected();
      finishApplied();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitApplication = () => {
    if (!shiftId || !execDate || !execTime) return;
    if (supervisorApproval) {
      writePendingScheduleAdjust({
        shiftId,
        shiftName: selectedName,
        execDate,
        execTime,
        submittedBy: account.name,
        submittedAt: Date.now(),
      });
      finishApplied();
      return;
    }
    void handleDeployNow();
  };

  const handleReject = async () => {
    if (!(await systemConfirm(t('shiftDeployment.adjust.confirmReject'), { tone: 'danger' }))) return;
    // 駁回要留下是誰駁回的；記成「取消」會讓稽核看不出這筆是被否決的
    void resolvePendingScheduleAdjust('REJECTED', account.name, '主管駁回');
    finishApplied();
  };

  return (
    <Dialog headerless padded={false} title={t('shiftDeployment.adjust.title')} onClose={onClose} widthClassName="w-full max-w-6xl" heightClassName="max-h-[92vh]">
        <header className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
          <h2 id="schedule-adjust-title" className="text-body-m-bold text-text-primary">
            {t('shiftDeployment.adjust.title')}
          </h2>
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onClose} label={t('common.close')} icon={<X />} />
        </header>

        {step === 1 ? (
          <>
            <div className="relative z-20 grid shrink-0 grid-cols-3 gap-4 px-6 pb-4">
              <label className="min-w-0">
                <span className={FIELD_LABEL}>
                  <span className="mr-0.5 text-status-error">*</span>
                  {t('shiftDeployment.adjust.execDate')}
                </span>
                <div className="relative">
                  <SiteDateTimeInput
                    type="date"
                    value={execDate}
                    onChange={(e) => setExecDate(e.target.value)}
                    className={`${INPUT} ${EMPTY_PICKER}`}
                  />
                  <Calendar className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-quaternary" />
                </div>
              </label>
              <div className="min-w-0">
                <span className={FIELD_LABEL}>
                  <span className="mr-0.5 text-status-error">*</span>
                  {t('shiftDeployment.adjust.execTime')}
                </span>
                <ExecutionTimeField
                  value={execTime}
                  onChange={setExecTime}
                  onNow={() => {
                    const now = new Date();
                    setExecDate(formatLocalYmd(now));
                    setExecTime(formatLocalHm(now));
                  }}
                />
              </div>
              <div className="min-w-0">
                <span className={FIELD_LABEL}>
                  <span className="mr-0.5 text-status-error">*</span>
                  {t('shiftDeployment.adjust.selectSchedule')}
                </span>
                <ShiftMenuSelect
                  label={t('shiftDeployment.adjust.selectSchedule')}
                  hideLabel
                  value={shiftId}
                  placeholder={t('shiftDeployment.adjust.selectSchedulePlaceholder')}
                  options={options}
                  onChange={setShiftId}
                  widthClass="w-full"
                  panelWidth={360}
                />
                {listError ? (
                  <p className="mt-1 text-body-xs text-status-error-emphasis">{listError}</p>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 pb-3">
              <p className="mb-2 shrink-0 text-body-s text-text-secondary">
                {t('shiftDeployment.adjust.browse')}
              </p>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-quaternary bg-surface-sub-background p-4">
                {previewLoading ? (
                  <div className="flex min-h-[280px] items-center justify-center gap-2 text-text-quaternary">
                    <Loader2 className="size-5 animate-spin" />
                    {t('shiftDeployment.adjust.loadingPreview')}
                  </div>
                ) : previewError ? (
                  <div className="rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
                    {previewError}
                  </div>
                ) : draft ? (
                  <StepShiftSchedulePreview draft={draft} resultView previewBoardOnly />
                ) : (
                  <PanelNoData className="min-h-[280px]" />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <ScheduleAdjustDiffStep
              execDate={execDate}
              execTime={execTime}
              scheduleName={selectedName}
              currentPlan={currentDraft?.scheduleOutput?.plan ?? null}
              nextPlan={draft?.scheduleOutput?.plan ?? null}
              loading={currentLoading}
              error={currentError}
              missingCurrent={missingCurrent}
            />
            {showSupervisorApproval ? (
              <section className="px-6 pb-4">
                <div className="rounded-xl border border-border-quaternary bg-surface-popup p-4">
                  <h3 className="mb-3 text-body-s-bold text-text-primary">
                    {t('shiftDeployment.adjust.approvalSection')}
                  </h3>
                  <input
                    value={approvalText}
                    onChange={(e) => setApprovalText(e.target.value)}
                    placeholder={t('shiftDeployment.adjust.approvalPlaceholder', {
                      phrase: approvalPhrase,
                    })}
                    className="h-10 w-full rounded-lg border border-border-quaternary bg-surface-primary px-3 text-body-s text-text-primary outline-none placeholder:text-text-quaternary focus:border-border-theme"
                  />
                </div>
              </section>
            ) : null}
          </div>
        )}

        <footer className="flex shrink-0 flex-col gap-2 px-6 py-4">
          {actionError ? (
            <p className="text-body-s text-status-error-emphasis">{actionError}</p>
          ) : null}
          <div className="flex items-center justify-between">
          {step === 1 ? (
            <>
              <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>{t('common.cancel')}</Button>
              <Button disabled={!canNext || busy} onPress={() => setStep(2)}>{t('shiftDeployment.adjust.nextWithTemplate')}</Button>
            </>
          ) : showSupervisorApproval ? (
            <>
              <Button hierarchy="danger" variant="outlined" disabled={busy} onPress={handleReject}>{t('shiftDeployment.adjust.reject')}</Button>
              <div className="flex items-center gap-4">
                <Button hierarchy="subordinate" variant="text" disabled={busy} onPress={() => setStep(1)}>{t('shiftDeployment.adjust.previous')}</Button>
                <Button disabled={busy || approvalText.trim() !== approvalPhrase} onPress={() => void handleDeployNow()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('shiftDeployment.adjust.approveAndApply')}</Button>
              </div>
            </>
          ) : (
            <>
              <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>{t('common.cancel')}</Button>
              <div className="flex items-center gap-4">
                <Button hierarchy="subordinate" variant="text" disabled={busy} onPress={() => setStep(1)}>{t('shiftDeployment.adjust.previous')}</Button>
                <Button disabled={busy || !shiftId} onPress={handleSubmitApplication}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {supervisorApproval
                    ? t('shiftDeployment.adjust.submitApplication')
                    : t('shiftDeployment.adjust.deploySchedule')}</Button>
              </div>
            </>
          )}
          </div>
        </footer>
      </Dialog>
  );
}
