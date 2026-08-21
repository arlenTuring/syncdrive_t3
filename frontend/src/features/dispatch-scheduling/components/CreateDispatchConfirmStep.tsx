import { AlertTriangle, MapPin, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchOperationShiftDetail,
  fetchOperationShiftList,
} from '../../shift-list/api/operationShiftApi';
import { buildShiftScheduleDraftFromStored } from '../../shift-list/types/create';
import { resolveGeneratedBlockTripCode } from '../../shift-list/utils/maintenanceSectionCode';
import type { GeneratedSchedulePlan } from '../../shift-list/utils/schedule-engine/types';
import { formatMinutesToTime, parseTimeToMinutes } from '../../time-templates/types/editor';
import { PRIORITY_LABEL, type DispatchPriorityKey, type DispatchStatusKey, DISPATCH_STATUS_TAG_STYLE, STATUS_LABEL } from '../types';
import { StatusTag } from '../../../components/StatusTag';

export type ConfirmStationStop = {
  id: string;
  stationId: string;
  name: string;
  taskLabels: string[];
};

export type DispatchConflict = {
  tripCode: string;
  startLabel: string;
  endLabel: string;
};

const CONFIRM_PHRASE = '確認';

function clockLabel(minutes: number): string {
  return formatMinutesToTime(minutes).slice(0, 5);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function findDispatchConflict(
  plan: GeneratedSchedulePlan | null | undefined,
  startMinute: number,
  endMinute: number,
  stationIds: string[],
): DispatchConflict | null {
  if (!plan || endMinute <= startMinute) return null;
  const stationSet = new Set(stationIds.filter(Boolean));
  const candidates: Array<{ start: number; end: number; tripCode: string; stationHit: boolean }> = [];

  for (const timeline of plan.timelines ?? []) {
    for (const block of timeline.blocks ?? []) {
      if (block.taskType !== 'passenger') continue;
      if (!rangesOverlap(startMinute, endMinute, block.plannedStartMinute, block.plannedEndMinute)) {
        continue;
      }
      const blockStations = (block.stationDwells ?? []).map((d) => d.stationId);
      const stationHit =
        stationSet.size === 0
          ? false
          : blockStations.some((id) => stationSet.has(id));
      candidates.push({
        start: block.plannedStartMinute,
        end: block.plannedEndMinute,
        tripCode: resolveGeneratedBlockTripCode(block),
        stationHit,
      });
    }
  }

  const picked =
    candidates.find((item) => item.stationHit) ??
    candidates.sort((a, b) => a.start - b.start)[0] ??
    null;
  if (!picked) return null;
  return {
    tripCode: picked.tripCode,
    startLabel: clockLabel(picked.start),
    endLabel: clockLabel(picked.end),
  };
}

function resolveExecAt(hm: string): Date {
  const now = new Date();
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  const target = new Date(now);
  if (match) {
    target.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (target.getTime() - now.getTime() < -30_000) {
      target.setDate(target.getDate() + 1);
    }
  }
  return target;
}

function formatDotDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const da = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${mo}.${da} ${hh}:${mm}`;
}

type CreateDispatchConfirmStepProps = {
  execTime: string;
  /** 覆寫執行時間顯示（核准畫面用建立日期＋執行時刻） */
  execDisplay?: string;
  priority: DispatchPriorityKey | '';
  vehicleCode: string;
  tripMinutes: number;
  stations: ConfirmStationStop[];
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  showConfirmField?: boolean;
  confirmLabel?: string;
  confirmPlaceholder?: string;
  /** approval＝主管核准稿；pending＝檢視稿（含派遣狀態） */
  variant?: 'plain' | 'approval' | 'pending';
  dispatchStatus?: DispatchStatusKey;
};

export function CreateDispatchConfirmStep({
  execTime,
  execDisplay,
  priority,
  vehicleCode,
  tripMinutes,
  stations,
  confirmText,
  onConfirmTextChange,
  showConfirmField = true,
  confirmLabel = '輸入確認並建立',
  confirmPlaceholder = '請輸入「確認」',
  variant = 'plain',
  dispatchStatus,
}: CreateDispatchConfirmStepProps) {
  const [conflict, setConflict] = useState<DispatchConflict | null>(null);
  const execAt = useMemo(() => resolveExecAt(execTime), [execTime]);
  const startMinute = useMemo(() => parseTimeToMinutes(execTime) ?? 0, [execTime]);
  const endMinute = startMinute + Math.max(1, tripMinutes);
  const stationIds = useMemo(() => stations.map((s) => s.stationId), [stations]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchOperationShiftList({
          usage_status: 'in_use',
          publish_status: 'all',
          page: 1,
          page_size: 20,
        });
        const current = list.items[0];
        if (!current) {
          if (!cancelled) setConflict(null);
          return;
        }
        const detail = await fetchOperationShiftDetail(current.shift_id);
        const draft = buildShiftScheduleDraftFromStored(detail.name, detail.body ?? {});
        const next = findDispatchConflict(
          draft.scheduleOutput?.plan,
          startMinute,
          endMinute,
          stationIds,
        );
        if (!cancelled) setConflict(next);
      } catch {
        if (!cancelled) setConflict(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startMinute, endMinute, stationIds]);

  const card = variant === 'approval' || variant === 'pending';
  const sectionClass = card
    ? 'mb-3 rounded-xl bg-zinc-900/80 px-4 py-3'
    : 'mb-6';
  const headingClass = card
    ? 'mb-3 text-sm font-medium text-zinc-200'
    : 'mb-3 text-sm font-medium text-zinc-200';

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-2">
      <section className={sectionClass}>
        <h3 className={headingClass}>
          {variant === 'approval' ? '基礎內容設定' : '基本資料'}
        </h3>
        <div className={`grid gap-4 text-sm ${card ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <div>
            <p className="mb-1 text-xs text-zinc-500">執行時間</p>
            <p className="text-zinc-100">{execDisplay ?? formatDotDateTime(execAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">優先等級</p>
            <p className="text-zinc-100">
              {priority ? PRIORITY_LABEL[priority] : '—'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">指派載具</p>
            <p className="text-zinc-100">{vehicleCode || '—'}</p>
          </div>
          {dispatchStatus ? (
            <div>
              <p className="mb-1 text-xs text-zinc-500">派遣狀態</p>
              <StatusTag
                label={STATUS_LABEL[dispatchStatus]}
                style={DISPATCH_STATUS_TAG_STYLE[dispatchStatus]}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={headingClass}>派遣任務規劃</h3>
        <div className="relative pl-1">
          {stations.map((stop, index) => (
            <div key={stop.id} className="relative flex gap-3 pb-5 last:pb-0">
              <div className="relative flex w-4 shrink-0 flex-col items-center">
                <MapPin className="relative z-[1] size-4 text-[#51A2FF]" />
                {index < stations.length - 1 ? (
                  <div className="absolute top-4 bottom-[-4px] border-l border-dashed border-zinc-600" />
                ) : null}
              </div>
              <div className="-mt-0.5">
                <p className="text-sm text-zinc-100">{stop.name}</p>
                {stop.taskLabels.length > 0 ? (
                  <p className="mt-0.5 text-xs text-zinc-500">{stop.taskLabels.join('、')}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {conflict ? (
        <p className="mb-3 flex items-start gap-2 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            警告：此停靠時間將衝突 {conflict.startLabel}-{conflict.endLabel} 的 [班次{' '}
            {conflict.tripCode}]，該班次將被強制取消。
          </span>
        </p>
      ) : null}

      {showConfirmField ? (
        <label className={card ? 'mb-1 block rounded-xl bg-zinc-900/80 px-4 py-3' : 'block'}>
          <span className="mb-1.5 block text-xs text-zinc-400">{confirmLabel}</span>
          <input
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder={confirmPlaceholder}
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-zinc-700/80 bg-zinc-950/40 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF] focus:ring-1 focus:ring-[#2B7FFF]/30"
          />
        </label>
      ) : null}
    </div>
  );
}

export function CreateDispatchConfirmHeader({
  onClose,
  title = '派遣任務雙重確認',
}: {
  onClose: () => void;
  title?: string;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex size-7 items-center justify-center rounded-full bg-[#EFB100] text-sm font-bold text-black"
          aria-hidden
        >
          !
        </span>
        <h2 id="create-dispatch-title" className="text-base font-semibold text-zinc-100">
          {title}
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        aria-label="關閉"
      >
        <X className="size-4" />
      </button>
    </header>
  );
}

export { CONFIRM_PHRASE };
