import { Bus, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ShiftDeploymentAction } from '../types';
import { Button } from '../../../components/ui';
import { useAuth } from '../../access-control/AuthContext';


export function VehicleControlSection({
  vehicles,
  onAction,
}: {
  vehicles: string[];
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const [open, setOpen] = useState(true);
  // 權限表「營運管理模組 → 載具控制 → 控制」：沒有就不顯示控制鈕（後端同一個權限擋）
  const canControl = useAuth().can('operations.vehicle-control.control');

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
      {/*
        * 欄數跟著寬度走，能排幾欄就排幾欄：每張卡最窄 194px（兩顆不換行的按鈕＋內距）。
        * 先前用 xl/2xl 斷點，畫面寬 1280–1535 只排 4 欄，12 台車變 3 列、卡片拉寬、底下被切掉。
        */}
      {open ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(194px,1fr))] gap-2.5 px-4 pb-4">
          {vehicles.map((code) => (
            <article
              key={code}
              className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-surface-primary p-2"
            >
              <div className="flex h-8 items-center gap-2 text-body-s-bold text-text-primary">
                <Bus className="size-4 shrink-0 text-text-primary" strokeWidth={1.75} />
                <span className="truncate">{code}</span>
              </div>
              {canControl ? (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button block className="whitespace-nowrap" hierarchy="superior" variant="outlined" onPress={() => onAction({ kind: 'vehicle-stop', vehicleCode: code })}>自駕停駛</Button>
                    <Button block className="whitespace-nowrap" hierarchy="superior" variant="outlined" onPress={() => onAction({ kind: 'vehicle-start', vehicleCode: code })}>自駕啟動</Button>
                  </div>
                  <Button block className="whitespace-nowrap" hierarchy="danger" variant="outlined" onPress={() => onAction({ kind: 'vehicle-reset', vehicleCode: code })}>系統重置</Button>
                </>
              ) : (
                <p className="text-body-xs text-text-quaternary">無控制權限</p>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
