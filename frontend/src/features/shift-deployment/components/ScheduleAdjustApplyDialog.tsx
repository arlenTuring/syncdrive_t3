import { Calendar, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
} from '../pendingScheduleAdjust';

type ScheduleAdjustApplyDialogProps = {
  onClose: () => void;
  /** 執行班表卡上的名稱；找不到「使用中」班表時用來對清單名稱兜底 */
  currentScheduleName?: string;
  onApplied?: () => void;
};

const FIELD_LABEL = 'mb-1.5 block text-xs text-zinc-400';
const INPUT =
  'h-10 w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 pr-9 text-sm text-zinc-100 outline-none focus:border-[#2B7FFF] focus:ring-1 focus:ring-[#2B7FFF]/30 [color-scheme:dark]';
const EMPTY_PICKER =
  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0';

const APPROVAL_PHRASE = '核准';

export function ScheduleAdjustApplyDialog({
  onClose,
  currentScheduleName = '',
  onApplied,
}: ScheduleAdjustApplyDialogProps) {
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

  const options = useMemo(
    () => shifts.map((item) => ({ value: item.shift_id, label: item.name })),
    [shifts],
  );

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
    if (!shiftId) throw new Error('尚未選擇班表');
    await deployOperationShift(shiftId, { reviewer_name: account.name });
    writePendingScheduleAdjust(null);
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

  const handleReject = () => {
    if (!window.confirm('確定駁回此班表調整申請？班表不會部署。')) return;
    writePendingScheduleAdjust(null);
    finishApplied();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-labelledby="schedule-adjust-title"
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#18181b] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
          <h2 id="schedule-adjust-title" className="text-base font-semibold text-zinc-100">
            班表調整申請
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/5 hover:text-white"
            aria-label="關閉"
          >
            <X className="size-4" />
          </button>
        </header>

        {step === 1 ? (
          <>
            <div className="relative z-20 grid shrink-0 grid-cols-3 gap-4 px-6 pb-4">
              <label className="min-w-0">
                <span className={FIELD_LABEL}>
                  <span className="mr-0.5 text-red-500">*</span>預計執行日期
                </span>
                <div className="relative">
                  <input
                    type="date"
                    value={execDate}
                    onChange={(e) => setExecDate(e.target.value)}
                    className={`${INPUT} ${EMPTY_PICKER}`}
                  />
                  <Calendar className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                </div>
              </label>
              <div className="min-w-0">
                <span className={FIELD_LABEL}>
                  <span className="mr-0.5 text-red-500">*</span>預計執行時間
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
                  <span className="mr-0.5 text-red-500">*</span>選擇班表
                </span>
                <ShiftMenuSelect
                  label="選擇班表"
                  hideLabel
                  value={shiftId}
                  placeholder="請選擇班表"
                  options={options}
                  onChange={setShiftId}
                  widthClass="w-full"
                  panelWidth={360}
                />
                {listError ? (
                  <p className="mt-1 text-[11px] text-red-400">{listError}</p>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 pb-3">
              <p className="mb-2 shrink-0 text-sm text-zinc-300">班表瀏覽</p>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800/80 bg-[#0c0c0e] p-4">
                {previewLoading ? (
                  <div className="flex min-h-[280px] items-center justify-center gap-2 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                    載入班表預覽…
                  </div>
                ) : previewError ? (
                  <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
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
                <div className="rounded-xl border border-zinc-800 bg-[#141416] p-4">
                  <h3 className="mb-3 text-sm font-medium text-zinc-200">輸入核准並送出生效</h3>
                  <input
                    value={approvalText}
                    onChange={(e) => setApprovalText(e.target.value)}
                    placeholder={`請輸入「${APPROVAL_PHRASE}」`}
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF]"
                  />
                </div>
              </section>
            ) : null}
          </div>
        )}

        <footer className="flex shrink-0 flex-col gap-2 px-6 py-4">
          {actionError ? (
            <p className="text-sm text-red-400">{actionError}</p>
          ) : null}
          <div className="flex items-center justify-between">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-zinc-300 transition hover:text-white"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!canNext || busy}
                onClick={() => setStep(2)}
                className="rounded-lg bg-[#2B7FFF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#256fe6] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                選擇該模板，下一步
              </button>
            </>
          ) : showSupervisorApproval ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleReject}
                className="rounded-lg border border-red-500/70 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                駁回
              </button>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep(1)}
                  className="text-sm text-zinc-300 transition hover:text-white"
                >
                  上一步
                </button>
                <button
                  type="button"
                  disabled={busy || approvalText.trim() !== APPROVAL_PHRASE}
                  onClick={() => void handleDeployNow()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2B7FFF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#256fe6] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  核准並生效
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-zinc-300 transition hover:text-white"
              >
                取消
              </button>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep(1)}
                  className="text-sm text-zinc-300 transition hover:text-white"
                >
                  上一步
                </button>
                <button
                  type="button"
                  disabled={busy || !shiftId}
                  onClick={handleSubmitApplication}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2B7FFF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#256fe6] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {supervisorApproval ? '送出申請' : '部署班表'}
                </button>
              </div>
            </>
          )}
          </div>
        </footer>
      </div>
    </div>
  );
}
