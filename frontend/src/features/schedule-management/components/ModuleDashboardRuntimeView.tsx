import { AlertCircle } from 'lucide-react';
import { useMemo } from 'react';
import { BindingHealthProvider } from '../../dashboard/context/BindingHealthContext';
import { DemoSimulationProvider } from '../../dashboard/context/DemoSimulationContext';
import { VehicleFleetMqttProvider } from '../../dashboard/context/VehicleFleetMqttContext';
import { FormatPainterProvider } from '../../dashboard/context/FormatPainterContext';
import { PlaneWorkspace } from '../../dashboard/PlaneWorkspace';
import { VariableProvider } from '../../dashboard/VariableContext';
import { findStoredDashboardPlane } from '../utils/moduleDashboardPages';

type ModuleDashboardRuntimeViewProps = {
  planeId: string;
  pageLabel: string;
};

const noop = () => undefined;

/**
 * 模組子頁：固定檢視模式載入儀表板平面（無編輯／狀態列）。
 */
export function ModuleDashboardRuntimeView({
  planeId,
  pageLabel,
}: ModuleDashboardRuntimeViewProps) {
  const plane = useMemo(() => findStoredDashboardPlane(planeId), [planeId]);

  if (!plane) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[#0a0a0b] px-6 text-center">
        <AlertCircle className="size-10 text-amber-500/80" />
        <div>
          <p className="text-sm font-medium text-zinc-200">找不到儀表板平面</p>
          <p className="mt-1 text-xs text-zinc-500">
            「{pageLabel}」綁定的平面可能已被刪除，請用管理員模式重新新增子頁。
          </p>
        </div>
      </div>
    );
  }

  return (
    <DemoSimulationProvider>
      <VehicleFleetMqttProvider>
        <BindingHealthProvider plane={plane} enabled>
          <FormatPainterProvider
            value={{
              armed: null,
              arm: noop,
              cancel: noop,
              canApplyTo: () => false,
              apply: () => false,
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
              <VariableProvider variables={{}}>
                <PlaneWorkspace
                  plane={plane}
                  selectedElementId={null}
                  selectedElementIds={[]}
                  selectedChildId={null}
                  selectedChildIds={[]}
                  isEditMode={false}
                  onSelectElement={noop}
                  onSelectElements={noop}
                  onSelectChild={noop}
                  onSelectChildren={noop}
                  onUpdateElement={noop}
                  onBatchUpdateElements={noop}
                  onDeleteElement={noop}
                  onAddChild={noop}
                  onUpdateChild={noop}
                  onBatchUpdateChildren={noop}
                  onDeleteChild={noop}
                  onAddCanvas={noop}
                />
              </VariableProvider>
            </div>
          </FormatPainterProvider>
        </BindingHealthProvider>
      </VehicleFleetMqttProvider>
    </DemoSimulationProvider>
  );
}
