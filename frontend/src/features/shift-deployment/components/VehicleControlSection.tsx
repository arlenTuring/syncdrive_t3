import { Bus, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ShiftDeploymentAction } from '../types';
import { Button } from '../../../components/ui';


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
      {/* 欄數跟著寬度走：固定 6 欄時每張卡太窄，「自駕停駛」被擠成兩行 */}
      {open ? (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
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
                <Button block className="whitespace-nowrap" hierarchy="superior" variant="outlined" onPress={() => onAction({ kind: 'vehicle-stop', vehicleCode: code })}>自駕停駛</Button>
                <Button block className="whitespace-nowrap" hierarchy="superior" variant="outlined" onPress={() => onAction({ kind: 'vehicle-start', vehicleCode: code })}>自駕啟動</Button>
              </div>
              <Button block className="whitespace-nowrap" hierarchy="danger" variant="outlined" onPress={() => onAction({ kind: 'vehicle-reset', vehicleCode: code })}>系統重置</Button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
