import { ListFilter, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusTag } from '../../../components/StatusTag';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import {
  diffSchedulePlans,
  taskTypeLabel,
  type ScheduleDiffKind,
  type ScheduleDiffRow,
} from '../diffScheduleTasks';
import type { GeneratedSchedulePlan } from '../../shift-list/utils/schedule-engine/types';
import type { ScheduleEngineTaskType } from '../../time-templates/types/editor';

type ScheduleAdjustDiffStepProps = {
  execDate: string;
  execTime: string;
  scheduleName: string;
  currentPlan: GeneratedSchedulePlan | null;
  nextPlan: GeneratedSchedulePlan | null;
  loading?: boolean;
  error?: string | null;
  missingCurrent?: boolean;
};

function ColumnFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = value !== 'all';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <th className="relative px-4 py-3 font-medium">
      <div ref={rootRef} className="inline-flex items-center gap-1.5">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`inline-flex size-6 items-center justify-center rounded-md transition ${
            active || open
              ? 'text-text-theme-light'
              : 'text-text-disabled hover:bg-link-standard hover:text-text-secondary'
          }`}
          aria-label={t('shiftDeployment.diff.filterAria', { label })}
          title={t('shiftDeployment.diff.filterAria', { label })}
        >
          <ListFilter className="size-3.5" />
        </button>
        {open ? (
          <div className="absolute left-4 top-full z-20 min-w-[140px] overflow-hidden rounded-lg border border-border-quaternary bg-surface-primary py-1 shadow-lg shadow-black-30">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`flex h-9 w-full items-center px-3 text-left text-body-s ${
                  value === option.value
                    ? 'bg-link-standard-hover text-text-primary'
                    : 'text-text-secondary hover:bg-link-standard'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </th>
  );
}

export function ScheduleAdjustDiffStep({
  execDate,
  execTime,
  scheduleName,
  currentPlan,
  nextPlan,
  loading = false,
  error = null,
  missingCurrent = false,
}: ScheduleAdjustDiffStepProps) {
  const { t } = useTranslation();
  const [kindFilter, setKindFilter] = useState<'all' | ScheduleDiffKind>('all');
  const [taskFilter, setTaskFilter] = useState<'all' | ScheduleEngineTaskType>('all');
  const [newTimeFilter, setNewTimeFilter] = useState('all');
  const [originalTimeFilter, setOriginalTimeFilter] = useState('all');

  const formatExecutionDisplay = (date: string, time: string): string => {
    const hour = Number(time.slice(0, 2));
    const period =
      Number.isFinite(hour) && hour >= 12
        ? t('shiftDeployment.diff.pm')
        : t('shiftDeployment.diff.am');
    return `${date} ${period} ${time}`;
  };

  const rows = useMemo(
    () => diffSchedulePlans(currentPlan, nextPlan),
    [currentPlan, nextPlan],
  );

  const taskOptions = useMemo(() => {
    const seen = new Map<ScheduleEngineTaskType, string>();
    for (const row of rows) {
      if (!seen.has(row.taskType)) seen.set(row.taskType, row.taskLabel);
    }
    return [
      { value: 'all', label: t('shiftDeployment.diff.all') },
      ...[...seen.entries()].map(([value, label]) => ({ value, label })),
    ];
  }, [rows, t]);

  const newTimeOptions = useMemo(() => {
    const times = [...new Set(rows.map((row) => row.newDepartLabel).filter(Boolean))].sort();
    return [
      { value: 'all', label: t('shiftDeployment.diff.all') },
      { value: '__empty', label: t('shiftDeployment.diff.blank') },
      ...times.map((time) => ({ value: time, label: time })),
    ];
  }, [rows, t]);

  const originalTimeOptions = useMemo(() => {
    const times = [...new Set(rows.map((row) => row.originalDepartLabel).filter(Boolean))].sort();
    return [
      { value: 'all', label: t('shiftDeployment.diff.all') },
      { value: '__empty', label: t('shiftDeployment.diff.blank') },
      ...times.map((time) => ({ value: time, label: time })),
    ];
  }, [rows, t]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (kindFilter !== 'all' && row.kind !== kindFilter) return false;
      if (taskFilter !== 'all' && row.taskType !== taskFilter) return false;
      if (newTimeFilter === '__empty' && row.newDepartLabel) return false;
      if (newTimeFilter !== 'all' && newTimeFilter !== '__empty' && row.newDepartLabel !== newTimeFilter) {
        return false;
      }
      if (originalTimeFilter === '__empty' && row.originalDepartLabel) return false;
      if (
        originalTimeFilter !== 'all'
        && originalTimeFilter !== '__empty'
        && row.originalDepartLabel !== originalTimeFilter
      ) {
        return false;
      }
      return true;
    });
  }, [kindFilter, newTimeFilter, originalTimeFilter, rows, taskFilter]);

  return (
    <div className="flex flex-col px-6 pb-3">
      <section className="pb-5">
        <h3 className="mb-3 text-body-m-bold text-text-primary">
          {t('shiftDeployment.diff.applicationContent')}
        </h3>
        <div className="grid grid-cols-2 gap-8 text-body-s">
          <div>
            <p className="mb-1 text-body-xs text-text-quaternary">{t('shiftDeployment.diff.executionTime')}</p>
            <p className="text-text-primary">{formatExecutionDisplay(execDate, execTime)}</p>
          </div>
          <div>
            <p className="mb-1 text-body-xs text-text-quaternary">{t('shiftDeployment.diff.schedule')}</p>
            <p className="text-text-primary">{scheduleName || '—'}</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col">
        <h3 className="mb-3 text-body-m-bold text-text-primary">
          {t('shiftDeployment.diff.impactSummary')}
        </h3>
        {missingCurrent ? (
          <p className="mb-2 text-body-xs text-text-quaternary">
            {t('shiftDeployment.diff.missingCurrent')}
          </p>
        ) : null}
        <div className="overflow-visible rounded-xl border border-border-quaternary bg-surface-sub-background">
          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center gap-2 text-text-quaternary">
              <Loader2 className="size-5 animate-spin" />
              {t('shiftDeployment.diff.comparing')}
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
              {error}
            </div>
          ) : (
            <table className="t3-table w-full min-w-[860px] border-collapse text-body-s">
              <thead>
                <tr className="border-b border-border-quaternary bg-surface-popup text-left text-text-tertiary">
                  <ColumnFilter
                    label={t('shiftDeployment.diff.newDepart')}
                    value={newTimeFilter}
                    options={newTimeOptions}
                    onChange={setNewTimeFilter}
                  />
                  <ColumnFilter
                    label={t('shiftDeployment.diff.changeKind')}
                    value={kindFilter}
                    options={[
                      { value: 'all', label: t('shiftDeployment.diff.all') },
                      { value: 'delete', label: t('shiftDeployment.diff.deleteTask') },
                      { value: 'create', label: t('shiftDeployment.diff.createTask') },
                    ]}
                    onChange={(value) => setKindFilter(value as 'all' | ScheduleDiffKind)}
                  />
                  <ColumnFilter
                    label={t('shiftDeployment.diff.originalDepart')}
                    value={originalTimeFilter}
                    options={originalTimeOptions}
                    onChange={setOriginalTimeFilter}
                  />
                  <ColumnFilter
                    label={t('shiftDeployment.diff.taskItem')}
                    value={taskFilter}
                    options={taskOptions}
                    onChange={(value) => setTaskFilter(value as 'all' | ScheduleEngineTaskType)}
                  />
                  <th className="px-4 py-3 font-medium">{t('shiftDeployment.diff.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10">
                      <PanelNoData
                        className="min-h-[200px]"
                        message={
                          rows.length === 0
                            ? t('shiftDeployment.diff.noDiff')
                            : t('shiftDeployment.diff.noFilterMatch')
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <DiffRow key={row.id} row={row} />
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function DiffRow({ row }: { row: ScheduleDiffRow }) {
  const { t } = useTranslation();
  const isDelete = row.kind === 'delete';
  return (
    <tr className="border-b border-border-quaternary hover:bg-white/[0.02]">
      <td className="px-4 py-3 tabular-nums text-text-primary">{row.newDepartLabel || ''}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-2 text-body-s ${
            isDelete ? 'text-status-error-emphasis' : 'text-status-success'
          }`}
        >
          {isDelete ? <Trash2 className="size-4" /> : <Plus className="size-4" />}
          {isDelete
            ? t('shiftDeployment.diff.deleteTask')
            : t('shiftDeployment.diff.createTask')}
        </span>
      </td>
      <td className="px-4 py-3 tabular-nums text-text-primary">{row.originalDepartLabel || ''}</td>
      <td className="px-4 py-3">
        <StatusTag label={taskTypeLabel(row.taskType)} style={row.tagStyle} />
      </td>
      <td className="px-4 py-3 text-text-tertiary">{row.reason}</td>
    </tr>
  );
}
