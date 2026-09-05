import { SlidersHorizontal, Tag } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TASK_TYPE_COLORS,
  TASK_TYPE_OPTIONS,
  type TaskTypeKey,
} from '../../time-templates/types/editor';
import { PanelNoData } from '../../time-templates/components/PanelNoData';
import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
  ShiftStationDwellMode,
} from '../types/create';
import {
  formatStationDwellRoleLabel,
  normalizeDwellSlackSeconds,
  resolveStationDwellListRole,
  resolveStationDwellMode,
} from '../types/create';
import type { GeneratedScheduleBlock } from '../utils/schedule-engine/types';
import { formatScheduleClockHms } from '../utils/scheduleDayCycle';
import {
  resolveManualBlockDwellTotalSeconds,
  resolveManualBlockMinDurationMinutes,
  resolveManualBlockTripCode,
} from '../utils/manualScheduleEdit';
import type { MaintenanceSectionCodeBySection } from '../utils/maintenanceSectionCode';

const LABEL_CLASS = 'text-xs text-zinc-400';
const INPUT_CLASS =
  'h-9 w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-2.5 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]';
const SMALL_INPUT_CLASS =
  'h-8 w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-2 text-xs tabular-nums text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]';

function SidebarCard({
  icon,
  title,
  headerAction,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/70 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-sm font-medium text-zinc-100">{title}</h3>
        </div>
        {headerAction}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function TripTypeChip({ taskKey, label }: { taskKey: TaskTypeKey; label: string }) {
  const { t } = useTranslation();
  const colors = TASK_TYPE_COLORS[taskKey];
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-shift-block-type', taskKey);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      className="isolate relative inline-flex h-[32px] cursor-grab items-center justify-center overflow-hidden whitespace-nowrap rounded px-3 text-sm font-normal leading-[18px] tracking-[0.5px] transition select-none hover:brightness-110 active:cursor-grabbing"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      title={t('shiftList.manualSidebar.dragChipTitle', { label })}
    >
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: colors.bar }}
        aria-hidden
      />
      <span className="relative z-[1]">{label}</span>
    </button>
  );
}

function formatMinuteInput(minute: number): string {
  return formatScheduleClockHms(minute);
}

function parseMinuteInput(raw: string): number | null {
  const trimmed = raw.trim();
  const withSeconds = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (withSeconds) {
    const hh = Number(withSeconds[1]);
    const mm = Number(withSeconds[2]);
    const ss = Number(withSeconds[3]);
    if (
      !Number.isFinite(hh)
      || !Number.isFinite(mm)
      || !Number.isFinite(ss)
      || hh > 23
      || mm > 59
      || ss > 59
    ) {
      return null;
    }
    return hh * 60 + mm + ss / 60;
  }
  const hmOnly = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!hmOnly) return null;
  const hh = Number(hmOnly[1]);
  const mm = Number(hmOnly[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

export type ManualBlockApplyPayload = {
  startMinute: number;
  endMinute: number;
  routeId: string | null;
};

export type ManualBlockDwellPayload = {
  stationDwells: ShiftScheduleStationDwell[];
  dwellSlackSeconds: number;
};

function ManualBlockSettingsForm({
  block,
  selectedRoutes,
  sectionCodes,
  onApply,
  onApplyDwells,
}: {
  block: GeneratedScheduleBlock;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  sectionCodes: MaintenanceSectionCodeBySection | null;
  onApply: (next: ManualBlockApplyPayload) => void;
  onApplyDwells: (next: ManualBlockDwellPayload) => void;
}) {
  const { t } = useTranslation();
  const [startText, setStartText] = useState(formatMinuteInput(block.plannedStartMinute));
  const [endText, setEndText] = useState(formatMinuteInput(block.plannedEndMinute));
  const [routeId, setRouteId] = useState(block.routeId ?? '');
  const [stationDwells, setStationDwells] = useState<ShiftScheduleStationDwell[]>(
    () => block.stationDwells ?? [],
  );
  const [dwellSlackText, setDwellSlackText] = useState(
    String(block.dwellSlackSeconds ?? 0),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStartText(formatMinuteInput(block.plannedStartMinute));
    setEndText(formatMinuteInput(block.plannedEndMinute));
    setRouteId(block.routeId ?? '');
    const fromBlock = block.stationDwells ?? [];
    if (fromBlock.length > 0) {
      setStationDwells(fromBlock);
      setDwellSlackText(String(block.dwellSlackSeconds ?? 0));
    } else {
      // 參數生成班次卡可能尚未寫入各站靠站：先從路線群組帶出供編輯
      const route = selectedRoutes.find((item) => item.routeId === (block.routeId ?? ''));
      setStationDwells(route?.stationDwells?.map((dwell) => ({ ...dwell })) ?? []);
      setDwellSlackText(String(route?.dwellSlackSeconds ?? block.dwellSlackSeconds ?? 0));
    }
    setError(null);
  }, [
    block.id,
    block.plannedStartMinute,
    block.plannedEndMinute,
    block.routeId,
    block.stationDwells,
    block.dwellSlackSeconds,
    selectedRoutes,
  ]);

  const tripCode = useMemo(
    () =>
      resolveManualBlockTripCode({
        block: {
          ...block,
          routeCode:
            selectedRoutes.find((route) => route.routeId === routeId)?.routeCode
            ?? block.routeCode,
        },
        sectionCodes,
      }),
    [block, routeId, sectionCodes, selectedRoutes],
  );

  const dwellTotalSeconds = useMemo(
    () =>
      resolveManualBlockDwellTotalSeconds({
        stationDwells,
        dwellSlackSeconds: normalizeDwellSlackSeconds(Number(dwellSlackText) || 0),
        dwellSeconds: 0,
      }),
    [stationDwells, dwellSlackText],
  );

  const minDurationMinutes = useMemo(
    () =>
      resolveManualBlockMinDurationMinutes({
        stationDwells,
        dwellSlackSeconds: normalizeDwellSlackSeconds(Number(dwellSlackText) || 0),
        dwellSeconds: 0,
      }),
    [stationDwells, dwellSlackText],
  );

  const showDwellEditor =
    block.taskType === 'passenger' && Boolean(routeId) && stationDwells.length > 0;

  const blockDurationSeconds = useMemo(() => {
    const startMinute = parseMinuteInput(startText);
    const endMinute = parseMinuteInput(endText);
    if (startMinute == null || endMinute == null || endMinute <= startMinute) {
      return Math.max(
        0,
        Math.round((block.plannedEndMinute - block.plannedStartMinute) * 60),
      );
    }
    return Math.max(0, Math.round((endMinute - startMinute) * 60));
  }, [startText, endText, block.plannedStartMinute, block.plannedEndMinute]);

  const durationShorterThanDwells =
    showDwellEditor
    && dwellTotalSeconds > 0
    && blockDurationSeconds < dwellTotalSeconds;

  const commitDwells = (
    nextDwells: ShiftScheduleStationDwell[],
    nextSlackRaw: string,
  ) => {
    onApplyDwells({
      stationDwells: nextDwells,
      dwellSlackSeconds: normalizeDwellSlackSeconds(
        nextSlackRaw === '' ? 0 : Number(nextSlackRaw.replace(/\D/g, '')),
      ),
    });
  };

  const commitTimes = (nextStartText: string, nextEndText: string) => {
    const startMinute = parseMinuteInput(nextStartText);
    const endMinute = parseMinuteInput(nextEndText);
    if (startMinute == null || endMinute == null) {
      setError(t('shiftList.manualSidebar.errorTimeFormat'));
      return;
    }
    if (endMinute <= startMinute) {
      setError(t('shiftList.manualSidebar.errorEndBeforeStart'));
      return;
    }
    if (endMinute - startMinute < minDurationMinutes) {
      setError(t('shiftList.manualSidebar.errorMinDuration', { seconds: Math.ceil(minDurationMinutes * 60) }));
      return;
    }
    if (
      startMinute === block.plannedStartMinute
      && endMinute === block.plannedEndMinute
    ) {
      setError(null);
      return;
    }
    setError(null);
    onApply({
      startMinute,
      endMinute,
      routeId: block.taskType === 'passenger' ? (routeId || null) : null,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <span className={LABEL_CLASS}>{t('shiftList.manualSidebar.tripCode')}</span>
        <input
          type="text"
          readOnly
          value={tripCode}
          className={`${INPUT_CLASS} cursor-default text-zinc-300`}
          aria-label={t('shiftList.manualSidebar.tripCodeAria')}
        />

        {block.taskType === 'passenger' ? (
          <>
            <span className={LABEL_CLASS}>{t('shiftList.manualSidebar.selectRoute')}</span>
            <select
              value={routeId}
              onChange={(event) => {
                const nextRouteId = event.target.value;
                setRouteId(nextRouteId);
                setError(null);
                onApply({
                  startMinute: block.plannedStartMinute,
                  endMinute: block.plannedEndMinute,
                  routeId: nextRouteId || null,
                });
              }}
              className={INPUT_CLASS}
              aria-label={t('shiftList.manualSidebar.selectRouteAria')}
            >
              <option value="">{t('shiftList.manualSidebar.notSelected')}</option>
              {selectedRoutes.map((route) => (
                <option key={route.routeId} value={route.routeId}>
                  {route.routeName}
                  {route.routeCode ? `（${route.routeCode}）` : ''}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <span className={LABEL_CLASS}>{t('shiftList.manualSidebar.start')}</span>
        <input
          type="text"
          value={startText}
          onChange={(event) => {
            setStartText(event.target.value);
            setError(null);
          }}
          onBlur={() => commitTimes(startText, endText)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="HH:MM:SS"
          className={INPUT_CLASS}
          aria-label={t('shiftList.manualSidebar.startAria')}
        />

        <span className={LABEL_CLASS}>{t('shiftList.manualSidebar.end')}</span>
        <input
          type="text"
          value={endText}
          onChange={(event) => {
            setEndText(event.target.value);
            setError(null);
          }}
          onBlur={() => commitTimes(startText, endText)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="HH:MM:SS"
          className={INPUT_CLASS}
          aria-label={t('shiftList.manualSidebar.endAria')}
        />
      </div>

      {showDwellEditor ? (
        <div className="space-y-2 border-t border-zinc-800/70 pt-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-zinc-200">{t('shiftList.manualSidebar.stationDwells')}</h4>
            <span className="text-[10px] text-zinc-500">
              {t('shiftList.manualSidebar.dwellTotalMin', { total: dwellTotalSeconds, min: Math.ceil(minDurationMinutes * 60) })}
            </span>
          </div>
          <div className="space-y-1.5">
            {stationDwells.map((dwell, index) => {
              const role = resolveStationDwellListRole(dwell, index);
              if (role !== 'editable') {
                return (
                  <div
                    key={dwell.stationId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                  >
                    <span className="truncate text-[11px] text-zinc-400" title={dwell.stationName}>
                      {dwell.stationName || dwell.stationId}
                    </span>
                    <span className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1.5 text-[11px] text-zinc-500">
                      {formatStationDwellRoleLabel(role)}
                    </span>
                  </div>
                );
              }
              const mode = resolveStationDwellMode(dwell);
              return (
                <div
                  key={dwell.stationId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                >
                  <span
                    className="truncate text-[11px] text-zinc-400"
                    title={t('shiftList.manualSidebar.stationPrefix', { name: dwell.stationName || dwell.stationId })}
                  >
                    {t('shiftList.manualSidebar.stationPrefix', { name: dwell.stationName || dwell.stationId })}
                  </span>
                  <div className="flex items-center justify-center gap-1">
                    <select
                      value={mode}
                      className="h-8 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-1 text-center text-[11px] text-zinc-100"
                      aria-label={t('shiftList.manualSidebar.dwellModeAria', { name: dwell.stationName })}
                      onChange={(event) => {
                        const nextMode = event.target.value as ShiftStationDwellMode;
                        // 明示回傳型別，讓兩個分支的 dwellMode 都對著
                        // ShiftScheduleStationDwell 做 contextual typing——沒有這個，
                        // 字面值 'seconds' 在物件字面值裡會被推寬成 string，
                        // 跟 no_stop／line_change 那個分支合成聯集後就不再是
                        // ShiftScheduleStationDwell[] 了。
                        const nextDwells: ShiftScheduleStationDwell[] = stationDwells.map(
                          (item): ShiftScheduleStationDwell => {
                            if (item.stationId !== dwell.stationId) return item;
                            if (nextMode === 'no_stop' || nextMode === 'line_change') {
                              return { ...item, dwellMode: nextMode, dwellSeconds: 0 };
                            }
                            return {
                              ...item,
                              dwellMode: 'seconds',
                              dwellSeconds:
                                item.dwellSeconds != null && item.dwellSeconds > 0
                                  ? item.dwellSeconds
                                  : null,
                            };
                          },
                        );
                        setStationDwells(nextDwells);
                        commitDwells(nextDwells, dwellSlackText);
                      }}
                    >
                      <option value="seconds">{t('shiftList.manualSidebar.dwellSeconds')}</option>
                      <option value="no_stop">{t('shiftList.manualSidebar.noStop')}</option>
                      <option value="line_change">{t('shiftList.manualSidebar.lineChange')}</option>
                    </select>
                    {mode === 'seconds' ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={dwell.dwellSeconds == null ? '' : String(dwell.dwellSeconds)}
                        placeholder={t('shiftList.manualSidebar.required')}
                        className={`${SMALL_INPUT_CLASS} text-center`}
                        aria-label={t('shiftList.manualSidebar.dwellSecondsAria', { name: dwell.stationName })}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/\D/g, '');
                          const nextDwells = stationDwells.map((item) =>
                            item.stationId === dwell.stationId
                              ? {
                                  ...item,
                                  dwellMode: 'seconds' as const,
                                  dwellSeconds:
                                    digits === '' ? null : Math.max(1, Number(digits)),
                                }
                              : item,
                          );
                          setStationDwells(nextDwells);
                          commitDwells(nextDwells, dwellSlackText);
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <label className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2 pt-1">
            <span className="text-[11px] text-zinc-400">{t('shiftList.manualSidebar.dwellSlack')}</span>
            <input
              type="text"
              inputMode="numeric"
              value={dwellSlackText}
              className={SMALL_INPUT_CLASS}
              aria-label={t('shiftList.manualSidebar.dwellSlackAria')}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '');
                setDwellSlackText(digits);
                commitDwells(stationDwells, digits);
              }}
            />
          </label>
          <p className="text-[10px] leading-4 text-zinc-500">
            {t('shiftList.manualSidebar.dwellSlackHint')}
          </p>
          {durationShorterThanDwells ? (
            <p
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-4 text-amber-200"
              role="status"
            >
              {t('shiftList.manualSidebar.durationTooShort', {
                block: blockDurationSeconds,
                dwell: dwellTotalSeconds,
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

export function ManualScheduleEditorSidebar({
  selectedBlock,
  selectedRoutes,
  sectionCodes,
  onApplyBlock,
  onApplyDwells,
}: {
  selectedBlock: GeneratedScheduleBlock | null;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  sectionCodes: MaintenanceSectionCodeBySection | null;
  onApplyBlock: (next: ManualBlockApplyPayload) => void;
  onApplyDwells: (next: ManualBlockDwellPayload) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-3">
      <SidebarCard icon={<Tag className="size-4 text-zinc-400" />} title={t('shiftList.manualSidebar.taskTypes')}>
        <div className="grid grid-cols-2 gap-2">
          {TASK_TYPE_OPTIONS.map((task) => (
            <TripTypeChip
              key={task.key}
              taskKey={task.key}
              label={t(`timeTemplates.taskTypes.${task.key}`)}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-4 text-zinc-500">
          {t('shiftList.manualSidebar.dragHint')}
        </p>
      </SidebarCard>

      <SidebarCard
        icon={<SlidersHorizontal className="size-4 text-zinc-400" />}
        title={t('shiftList.manualSidebar.taskSettings')}
      >
        {selectedBlock && selectedBlock.source === 'template_bar' ? (
          <ManualBlockSettingsForm
            key={selectedBlock.id}
            block={selectedBlock}
            selectedRoutes={selectedRoutes}
            sectionCodes={sectionCodes}
            onApply={onApplyBlock}
            onApplyDwells={onApplyDwells}
          />
        ) : (
          <PanelNoData message={t('shiftList.manualSidebar.nothingSelected')} />
        )}
      </SidebarCard>
    </aside>
  );
}
