import { Bus } from 'lucide-react';
import type { VehicleContainerWidget } from '../types';
import { VehicleDefinitionMapView } from '../../vehicle-editor/elements/VehicleDefinitionMapView';
import { resolveVehicleDefinition } from '../../vehicle-editor/storage/vehicleDefinitionStorage';
import { useEditMode } from '../context/EditModeContext';
import { VehicleContainerBehaviorOverlay } from './VehicleContainerBehaviorOverlay';

export function VehicleContainerWidgetView({
  widget,
  isSelected = false,
  editorScale = 1,
  onPatchWidget,
}: {
  widget: VehicleContainerWidget;
  isSelected?: boolean;
  editorScale?: number;
  onPatchWidget?: (patch: Partial<VehicleContainerWidget>) => void;
}) {
  const isEditMode = useEditMode();
  const definition = resolveVehicleDefinition(widget.vehicleDefinitionId);

  return (
    <div className="relative h-full w-full overflow-visible">
      {isEditMode && (
        <span className="pointer-events-none absolute -top-4 left-0 z-30 rounded bg-amber-950/90 px-1.5 py-px text-[8px] font-semibold text-amber-200">
          載具樣板
        </span>
      )}
      {definition ? (
        <VehicleDefinitionMapView
          definition={definition}
          displayWidth={widget.width}
          displayHeight={widget.height}
          fitMode="stretch"
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 rounded bg-[#0a0f1a]/90 text-zinc-500">
          <Bus size={20} className="text-amber-500/60" />
          <span className="text-[10px]">請編輯載具樣式</span>
        </div>
      )}
      <VehicleContainerBehaviorOverlay
        widget={widget}
        vehicleCenterX={widget.width / 2}
        vehicleCenterY={widget.height / 2}
        isSelected={isSelected}
        editorScale={editorScale}
        onPatch={onPatchWidget}
      />
    </div>
  );
}
