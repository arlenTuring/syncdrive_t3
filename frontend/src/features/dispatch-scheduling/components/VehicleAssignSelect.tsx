import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { VTMS_VEHICLE_POOL } from '../../dashboard/constants/vtmsVehiclePool';
import type { DispatchListItem, DispatchStatusKey } from '../types';

export type VehicleAssignStatus = 'available' | 'reserved';

const BUSY_STATUSES = new Set<DispatchStatusKey>([
  'running',
  'pending',
  'pending_approval',
]);

export function reservedVehicleCodesFromRows(rows: DispatchListItem[]): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => BUSY_STATUSES.has(row.status))
        .map((row) => row.vehicle_code),
    ),
  ];
}

function VehicleStatusPill({ status }: { status: VehicleAssignStatus }) {
  if (status === 'available') {
    return (
      <span className="shrink-0 rounded-full bg-[rgba(0,201,81,0.28)] px-2 py-0.5 text-body-xs-bold tracking-[0.5px] text-text-primary">
        可用
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-[rgba(146,64,14,0.55)] px-2 py-0.5 text-body-xs-bold tracking-[0.5px] text-[#E7C9A3]">
      預約任務
    </span>
  );
}

type VehicleAssignSelectProps = {
  value: string;
  reservedCodes: string[];
  onChange: (value: string) => void;
};

export function VehicleAssignSelect({
  value,
  reservedCodes,
  onChange,
}: VehicleAssignSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const reserved = useMemo(() => new Set(reservedCodes), [reservedCodes]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const statusOf = (code: string): VehicleAssignStatus =>
    reserved.has(code) ? 'reserved' : 'available';

  const selectedStatus = value ? statusOf(value) : null;

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        aria-label="指派載具"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-10 w-full items-center gap-2 rounded-lg border bg-surface-primary px-3 text-left text-body-s focus:outline-none ${
          open
            ? 'border-[#7CB8FF] ring-1 ring-border-theme-light'
            : 'border-border-quaternary focus:border-border-theme focus:ring-1 focus:ring-border-theme-light-trn'
        }`}
      >
        {value ? (
          <>
            <span className="min-w-0 flex-1 truncate tracking-[0.5px] text-text-primary">{value}</span>
            {selectedStatus ? <VehicleStatusPill status={selectedStatus} /> : null}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate tracking-[0.5px] text-[#99A1AF]">請選擇</span>
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 text-text-quaternary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-40 w-full overflow-hidden rounded-xl bg-surface-primary py-1 shadow-lg shadow-black-30"
          role="listbox"
        >
          <div className="max-h-[280px] overflow-y-auto [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
            {VTMS_VEHICLE_POOL.map((code) => {
              const status = statusOf(code);
              const reservedRow = status === 'reserved';
              const active = value === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={reservedRow}
                  onClick={() => {
                    if (reservedRow) return;
                    onChange(code);
                    setOpen(false);
                  }}
                  className={`flex h-10 w-full items-center gap-2 px-3 text-left text-body-s tracking-[0.5px] ${
                    reservedRow
                      ? 'cursor-not-allowed text-text-quaternary'
                      : active
                        ? 'bg-link-standard-hover text-text-primary'
                        : 'text-text-primary hover:bg-link-standard'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{code}</span>
                  <VehicleStatusPill status={status} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
