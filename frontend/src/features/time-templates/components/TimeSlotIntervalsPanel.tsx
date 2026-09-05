import { Check, ChevronDown, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  createDraftInterval,
  intervalDurationTableLabel,
  INTERVAL_TIMELINE_AXIS_HEIGHT_PX,
  INTERVAL_TIMELINE_BAR_HEIGHT_PX,
  INTERVAL_TIMELINE_HEIGHT_PX,
  INTERVAL_TIMELINE_INNER_HEIGHT_PX,
  INTERVAL_TIMELINE_ROW_HEIGHT_PX,
  INTERVAL_TABLE_ACTION_SIZE_PX,
  INTERVAL_TABLE_FIELD_HEIGHT_PX,
  INTERVAL_TABLE_HEADER_HEIGHT_PX,
  INTERVAL_TABLE_ROW_PADDING_Y_PX,
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';
import { TimeOfDayPicker } from './TimeOfDayPicker';
import { PanelNoData } from './PanelNoData';
import {
  TIME_TEMPLATE_PANEL_HEADER_ROW_CLASS,
  TimeTemplatePanelAddButton,
  TimeTemplatePanelTitle,
} from './TimeTemplatePanelHeader';

const FIELD_CLASS =
  'w-full rounded-lg bg-[rgba(142,197,255,0.08)] px-3 text-sm leading-[18px] tracking-[0.5px] text-[#D1D5DC] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/40';

const FIELD_STYLE = { height: INTERVAL_TABLE_FIELD_HEIGHT_PX };

const TABLE_CELL_CLASS = 'px-3 pr-3';

const TABLE_CELL_STYLE = {
  paddingTop: INTERVAL_TABLE_ROW_PADDING_Y_PX,
  paddingBottom: INTERVAL_TABLE_ROW_PADDING_Y_PX,
};

const ACTION_BUTTON_STYLE = {
  width: INTERVAL_TABLE_ACTION_SIZE_PX,
  height: INTERVAL_TABLE_ACTION_SIZE_PX,
};

const HOUR_TICKS = Array.from({ length: 13 }, (_, i) => i * 2);

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return `rgba(124, 134, 255, ${alpha})`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sortIntervals(intervals: TimeSlotInterval[]): TimeSlotInterval[] {
  return [...intervals].sort((a, b) => {
    const startA = parseIntervalStartMinutes(a.startTime);
    const startB = parseIntervalStartMinutes(b.startTime);
    // Items with no valid startTime (brand new drafts) go to the end
    if (startA == null && startB == null) return 0;
    if (startA == null) return 1;
    if (startB == null) return -1;
    return startA - startB;
  });
}

/** Check if a slot's time range overlaps with any other interval (excluding itself). */
function findOverlap(
  slotId: string,
  startTime: string,
  endTime: string,
  allIntervals: TimeSlotInterval[],
): boolean {
  const start = parseIntervalStartMinutes(startTime);
  const end = parseIntervalEndMinutes(endTime);
  if (start == null || end == null || end <= start) return false;

  return allIntervals.some((other) => {
    if (other.id === slotId) return false;
    // Skip other drafts that don't have valid times yet
    const otherStart = parseIntervalStartMinutes(other.startTime);
    const otherEnd = parseIntervalEndMinutes(other.endTime);
    if (otherStart == null || otherEnd == null || otherEnd <= otherStart) return false;
    // Two ranges [start, end) and [otherStart, otherEnd) overlap when start < otherEnd && otherStart < end
    return start < otherEnd && otherStart < end;
  });
}


function DayTimeline({
  intervals,
  attributes,
}: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
}) {
  const { t } = useTranslation();
  const confirmed = sortIntervals(intervals).filter((slot) => !slot.isDraft);

  return (
    <div className="h-full min-h-0 overflow-x-hidden pb-2">
      <div
        className="flex w-full"
        style={{ height: INTERVAL_TIMELINE_INNER_HEIGHT_PX }}
      >
        <div
          className="flex w-[50px] shrink-0 flex-col"
          style={{ paddingTop: INTERVAL_TIMELINE_AXIS_HEIGHT_PX }}
        >
          <div
            className="flex items-center justify-center gap-2.5 px-1 py-3"
            style={{ height: INTERVAL_TIMELINE_BAR_HEIGHT_PX }}
          >
            <span className="text-center text-sm leading-[18px] tracking-[0.5px] text-[#D1D5DC]">
              {t('timeTemplates.intervals.timelineLine1')}
              <br />
              {t('timeTemplates.intervals.timelineLine2')}
            </span>
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            className="flex flex-col"
            style={{ height: INTERVAL_TIMELINE_INNER_HEIGHT_PX }}
          >
            <div
              className="relative w-full shrink-0"
              style={{ height: INTERVAL_TIMELINE_AXIS_HEIGHT_PX }}
            >
              {HOUR_TICKS.map((h, index) => {
                let alignClass = '-translate-x-1/2';
                if (index === 0) alignClass = 'translate-x-0';
                if (index === HOUR_TICKS.length - 1) alignClass = '-translate-x-full';
                return (
                  <div
                    key={h}
                    className="absolute top-0 flex flex-col items-center"
                    style={{
                      left: `${(index / (HOUR_TICKS.length - 1)) * 100}%`,
                    }}
                  >
                    <span
                      className={`flex items-center justify-center text-sm leading-[18px] tracking-[0.5px] text-[#99A1AF] whitespace-nowrap ${alignClass}`}
                      style={{ height: INTERVAL_TIMELINE_AXIS_HEIGHT_PX }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </span>
                  </div>
                );
              })}
              <div className="absolute bottom-0 left-0 right-0 h-px border-t border-[rgba(212,212,212,0.15)]" />
            </div>
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0 flex">
                {HOUR_TICKS.slice(0, -1).map((h) => (
                  <div
                    key={h}
                    className="flex-1 border-r border-[rgba(212,212,212,0.15)] last:border-r-0"
                  />
                ))}
              </div>
              <div
                className="absolute inset-x-0 top-0"
                style={{ height: INTERVAL_TIMELINE_ROW_HEIGHT_PX }}
              >
                {confirmed.map((slot) => {
                  const start = parseIntervalStartMinutes(slot.startTime);
                  const end = parseIntervalEndMinutes(slot.endTime);
                  if (start == null || end == null || end <= start) return null;
                  const attr = attributes.find((a) => a.id === slot.attributeId);
                  const accent = attr?.color ?? '#7C86FF';
                  const left = (start / (24 * 60)) * 100;
                  const width = ((end - start) / (24 * 60)) * 100;
                  return (
                    <div
                      key={slot.id}
                      className="absolute top-0 flex min-w-0 flex-col items-center justify-center overflow-hidden px-2 py-1"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        height: INTERVAL_TIMELINE_BAR_HEIGHT_PX,
                        backgroundColor: hexToRgba(accent, 0.3),
                      }}
                      title={`${slot.name} ${slot.startTime} - ${slot.endTime}`}
                    >
                      <span
                        className="max-w-full truncate text-sm font-medium leading-[18px] tracking-[0.5px]"
                        style={{ color: accent }}
                      >
                        {slot.name}
                      </span>
                      <span
                        className="max-w-full truncate text-xs leading-4"
                        style={{ color: accent }}
                      >
                        {slot.startTime} - {slot.endTime}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttributeSelect({
  value,
  attributes,
  onChange,
}: {
  value: string;
  attributes: TimeSlotAttribute[];
  onChange: (attributeId: string) => void;
}) {
  const { t } = useTranslation();
  const selected = attributes.find((a) => a.id === value);

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD_CLASS} appearance-none pr-9 ${!value ? 'text-[#99A1AF]' : 'pl-7'}`}
        style={FIELD_STYLE}
      >
        <option value="">{t('timeTemplates.intervals.selectPlaceholder')}</option>
        {attributes.map((attr) => (
          <option key={attr.id} value={attr.id} className="bg-zinc-900 text-zinc-100">
            {attr.name}
          </option>
        ))}
      </select>
      {selected && (
        <span
          className="pointer-events-none absolute left-3 top-1/2 size-2.5 -translate-y-1/2 rounded-sm"
          style={{ backgroundColor: selected.color }}
        />
      )}
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#99A1AF]" />
    </div>
  );
}

type TimeSlotIntervalsPanelProps = {
  attributes: TimeSlotAttribute[];
  intervals: TimeSlotInterval[];
  onChange: (intervals: TimeSlotInterval[]) => void;
};

export function TimeSlotIntervalsPanel({
  attributes,
  intervals,
  onChange,
}: TimeSlotIntervalsPanelProps) {
  const { t } = useTranslation();
  const confirmedAttributes = attributes.filter((attr) => !attr.isDraft);
  const canAddInterval = confirmedAttributes.length > 0;
  const hasDraft = intervals.some((slot) => slot.isDraft);

  const addInterval = () => {
    if (!canAddInterval || hasDraft) return;
    const defaultAttrId = confirmedAttributes[0]?.id ?? '';
    onChange([...intervals, createDraftInterval(defaultAttrId)]);
  };

  const updateInterval = (id: string, patch: Partial<TimeSlotInterval>) => {
    onChange(intervals.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  };

  const confirmInterval = (id: string) => {
    const slot = intervals.find((item) => item.id === id);
    if (!slot) return;
    const attr = confirmedAttributes.find((a) => a.id === slot.attributeId);
    const start = parseIntervalStartMinutes(slot.startTime);
    const end = parseIntervalEndMinutes(slot.endTime);
    if (!attr || start == null || end == null || end <= start) return;
    updateInterval(id, { isDraft: false, name: attr.name });
  };

  const removeInterval = (id: string) => {
    onChange(intervals.filter((slot) => slot.id !== id));
  };

  const startEditInterval = (id: string) => {
    if (hasDraft) return;
    updateInterval(id, { isDraft: true });
  };

  const sortedIntervals = sortIntervals(intervals);

  const renderRow = (slot: TimeSlotInterval, draft: boolean) => {
    const startMin = parseIntervalStartMinutes(slot.startTime);
    const endMin = parseIntervalEndMinutes(slot.endTime);
    const hasValidTime = startMin != null && endMin != null && endMin > startMin;
    const overlaps = hasValidTime && findOverlap(slot.id, slot.startTime, slot.endTime, intervals);

    const canConfirm =
      slot.attributeId.length > 0
      && hasValidTime
      && !overlaps;

    return (
      <>
      <tr
        key={slot.id}
        className={`border-b border-[rgba(212,212,212,0.15)] ${draft && overlaps ? 'bg-red-500/5' : ''}`}
      >
        <td className={TABLE_CELL_CLASS} style={TABLE_CELL_STYLE}>
          {draft ? (
            <AttributeSelect
              value={slot.attributeId}
              attributes={confirmedAttributes}
              onChange={(attributeId) => {
                const attr = confirmedAttributes.find((a) => a.id === attributeId);
                updateInterval(slot.id, {
                  attributeId,
                  name: attr?.name ?? '',
                });
              }}
            />
          ) : (
            <div className="flex items-center gap-2 px-1 text-sm text-[#D1D5DC]">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{
                  backgroundColor:
                    confirmedAttributes.find((a) => a.id === slot.attributeId)?.color ?? '#7C86FF',
                }}
              />
              {slot.name}
            </div>
          )}
        </td>
        <td className={TABLE_CELL_CLASS} style={TABLE_CELL_STYLE}>
          {draft ? (
            <div className={draft && overlaps ? '[&_input]:ring-1 [&_input]:ring-red-400/60' : ''}>
              <TimeOfDayPicker
                value={slot.startTime}
                label={t('timeTemplates.intervals.start')}
                role="start"
                onChange={(startTime) => updateInterval(slot.id, { startTime })}
              />
            </div>
          ) : (
            <span className="px-1 text-sm text-[#D1D5DC]">{slot.startTime}</span>
          )}
        </td>
        <td className={TABLE_CELL_CLASS} style={TABLE_CELL_STYLE}>
          {draft ? (
            <div className={draft && overlaps ? '[&_input]:ring-1 [&_input]:ring-red-400/60' : ''}>
              <TimeOfDayPicker
                value={slot.endTime}
                label={t('timeTemplates.intervals.end')}
                role="end"
                onChange={(endTime) => updateInterval(slot.id, { endTime })}
              />
            </div>
          ) : (
            <span className="px-1 text-sm text-[#D1D5DC]">{slot.endTime}</span>
          )}
        </td>
        <td className={`${TABLE_CELL_CLASS} text-sm text-[#99A1AF]`} style={TABLE_CELL_STYLE}>
          {intervalDurationTableLabel(slot.startTime, slot.endTime)}
        </td>
        <td className="px-3 text-right" style={TABLE_CELL_STYLE}>
          {draft ? (
            <div className="relative">
              <button
                type="button"
                disabled={!canConfirm}
                onClick={() => confirmInterval(slot.id)}
                className="inline-flex items-center justify-center rounded-lg bg-[#2B7FFF] text-white transition hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:opacity-40"
                style={ACTION_BUTTON_STYLE}
                aria-label={t('timeTemplates.intervals.confirmAria')}
                title={overlaps ? t('timeTemplates.intervals.overlapTitle') : undefined}
              >
                <Check className="size-4" strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-0.5">
              <button
                type="button"
                onClick={() => startEditInterval(slot.id)}
                disabled={hasDraft}
                className="inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                style={ACTION_BUTTON_STYLE}
                aria-label={t('timeTemplates.intervals.editAria')}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => removeInterval(slot.id)}
                className="inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                style={ACTION_BUTTON_STYLE}
                aria-label={t('timeTemplates.intervals.deleteAria')}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          )}
        </td>
      </tr>
      {draft && overlaps && (
        <tr key={`${slot.id}-overlap-warning`} className="border-b border-[rgba(212,212,212,0.15)] bg-red-500/5">
          <td colSpan={5} className="px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-red-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>{t('timeTemplates.intervals.overlapWarning')}</span>
            </div>
          </td>
        </tr>
      )}
      </>
    );
  };

  return (
    <section className="flex shrink-0 flex-col gap-2 overflow-hidden rounded-xl bg-[rgba(142,197,255,0.08)] py-3">
      <div className={TIME_TEMPLATE_PANEL_HEADER_ROW_CLASS}>
        <div className="flex min-w-0 flex-1 items-center">
          <TimeTemplatePanelTitle
            icon={<SlidersHorizontal className="size-5" strokeWidth={1.75} />}
            title={t('timeTemplates.intervals.title')}
          />
        </div>
        <TimeTemplatePanelAddButton
          onClick={addInterval}
          disabled={!canAddInterval || hasDraft}
          title={canAddInterval ? undefined : t('timeTemplates.intervals.addDisabledHint')}
        />
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3">
        <div
          className="shrink-0"
          style={{
            height: INTERVAL_TIMELINE_HEIGHT_PX,
            marginTop: -Math.round(INTERVAL_TIMELINE_HEIGHT_PX * 0.1),
          }}
        >
          <DayTimeline intervals={intervals} attributes={attributes} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[rgba(212,212,212,0.1)]">
          <table className="w-full shrink-0 table-fixed text-left text-sm">
            <colgroup>
              <col style={{ width: 400 }} />
              <col style={{ width: 212 }} />
              <col style={{ width: 212 }} />
              <col style={{ width: 212 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead className="bg-[rgba(142,197,255,0.08)]">
              <tr className="border-b border-[rgba(212,212,212,0.15)] text-[#99A1AF]">
                <th
                  className="px-3 py-0.5 text-sm font-normal leading-[18px] tracking-[0.5px]"
                  style={{ height: INTERVAL_TABLE_HEADER_HEIGHT_PX }}
                >
                  {t('timeTemplates.intervals.colName')}
                </th>
                <th
                  className="px-3 py-0.5 text-sm font-normal leading-[18px] tracking-[0.5px]"
                  style={{ height: INTERVAL_TABLE_HEADER_HEIGHT_PX }}
                >
                  {t('timeTemplates.intervals.colStart')}
                </th>
                <th
                  className="px-3 py-0.5 text-sm font-normal leading-[18px] tracking-[0.5px]"
                  style={{ height: INTERVAL_TABLE_HEADER_HEIGHT_PX }}
                >
                  {t('timeTemplates.intervals.colEnd')}
                </th>
                <th
                  className="px-3 py-0.5 text-sm font-normal leading-[18px] tracking-[0.5px]"
                  style={{ height: INTERVAL_TABLE_HEADER_HEIGHT_PX }}
                >
                  {t('timeTemplates.intervals.colDuration')}
                </th>
                <th className="px-3 py-0.5" style={{ height: INTERVAL_TABLE_HEADER_HEIGHT_PX }} />
              </tr>
            </thead>
          </table>
          {intervals.length === 0 ? (
            <PanelNoData className="flex-1" />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col style={{ width: 400 }} />
                  <col style={{ width: 212 }} />
                  <col style={{ width: 212 }} />
                  <col style={{ width: 212 }} />
                  <col style={{ width: 100 }} />
                </colgroup>
                <tbody>
                  {sortedIntervals.map((slot) => renderRow(slot, slot.isDraft))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
