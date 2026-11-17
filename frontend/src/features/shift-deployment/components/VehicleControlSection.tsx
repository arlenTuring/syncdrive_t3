import { Bus, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ShiftDeploymentAction } from '../types';

const btnBlue =
  'h-8 rounded-md border border-[#3B82F6] bg-transparent text-body-xs text-[#60A5FA] transition hover:bg-surface-theme';
const btnRed =
  'h-8 w-full rounded-md border border-[#EF4444] bg-transparent text-body-xs text-[#F87171] transition hover:bg-status-error-light';

export function VehicleControlSection({
  vehicles,
  onAction,
}: {
  vehicles: string[];
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-xl bg-surface-popup">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h2 className="text-body-m-bold text-text-primary">載具控制</h2>
        <ChevronUp
          className={`size-4 text-text-tertiary transition ${open ? 'rotate-0' : 'rotate-180'}`}
        />
      </button>
      {open ? (
        <div className="grid grid-cols-6 gap-3 px-4 pb-4">
          {vehicles.map((code) => (
            <article
              key={code}
              className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-surface-primary p-3"
            >
              <div className="flex h-8 items-center gap-2 text-body-s-bold text-text-primary">
                <Bus className="size-4 shrink-0 text-text-primary" strokeWidth={1.75} />
                <span className="truncate">{code}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onAction({ kind: 'vehicle-stop', vehicleCode: code })}
                  className={btnBlue}
                >
                  自駕停駛
                </button>
                <button
                  type="button"
                  onClick={() => onAction({ kind: 'vehicle-start', vehicleCode: code })}
                  className={btnBlue}
                >
                  自駕啟動
                </button>
              </div>
              <button
                type="button"
                onClick={() => onAction({ kind: 'vehicle-reset', vehicleCode: code })}
                className={btnRed}
              >
                系統重置
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
