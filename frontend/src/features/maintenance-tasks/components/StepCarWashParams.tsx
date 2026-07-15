import { useEffect, useState } from 'react';
import {
  DEFAULT_MAINTENANCE_MAP_ID,
  fetchCarWashFieldEquipment,
  type FieldEquipmentItem,
} from '../api/fieldEquipmentApi';
import {
  newCarWashEquipmentRowId,
  normalizeCarWashDraft,
  type CarWashEquipmentRow,
  type MaintenanceTaskCarWashDraft,
} from '../types/create';
import { sanitizeIntegerInput } from '../utils/numericInput';
import { FacilityEquipmentRowsEditor } from './FacilityEquipmentRowsEditor';
import { StepSectionToggle } from './StepSectionToggle';
import { TriggerFieldRow } from './TriggerFieldRow';

const INLINE_INPUT_ENABLED =
  'h-[42px] w-[90%] min-w-[180px] flex-1 max-w-[900px] rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type StepCarWashParamsProps = {
  draft: MaintenanceTaskCarWashDraft;
  onChange: (next: MaintenanceTaskCarWashDraft) => void;
};

export function StepCarWashParams({ draft, onChange }: StepCarWashParamsProps) {
  const carWash = normalizeCarWashDraft(draft);
  const patchCarWash = (patch: Partial<MaintenanceTaskCarWashDraft>) =>
    onChange(normalizeCarWashDraft({ ...carWash, ...patch }));

  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEquipment(true);
    setEquipmentError(null);
    void fetchCarWashFieldEquipment(DEFAULT_MAINTENANCE_MAP_ID)
      .then((res) => {
        if (cancelled) return;
        setEquipment(res.items);
      })
      .catch((e) => {
        if (cancelled) return;
        setEquipmentError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingEquipment(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StepSectionToggle
      title="填入洗車任務"
      enabled={carWash.stepEnabled}
      onEnabledChange={(stepEnabled) => patchCarWash({ stepEnabled })}
    >
      <div className="space-y-5">
        <TriggerFieldRow
          label="累積里程觸發值"
          enabled={carWash.mileageDetectionEnabled}
          value={carWash.mileageTriggerKm}
          onEnabledChange={(mileageDetectionEnabled) =>
            patchCarWash({ mileageDetectionEnabled })
          }
          onValueChange={(mileageTriggerKm) => patchCarWash({ mileageTriggerKm })}
          prefixText="每經過"
          suffixText="公里的行駛里程，需進行洗車作業"
          sanitizeValue={sanitizeIntegerInput}
        />

        <TriggerFieldRow
          label="累積時間觸發值"
          enabled={carWash.timeDetectionEnabled}
          value={carWash.timeTriggerHours}
          onEnabledChange={(timeDetectionEnabled) => patchCarWash({ timeDetectionEnabled })}
          onValueChange={(timeTriggerHours) => patchCarWash({ timeTriggerHours })}
          prefixText="每經過"
          suffixText="小時的行駛時數，需進行洗車作業"
          sanitizeValue={sanitizeIntegerInput}
        />

        <div className="block">
          <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
            <span className="text-red-500">*</span>
            單次作業時長
          </span>
          <div className="flex w-full flex-wrap items-center gap-2 text-sm text-zinc-300">
            <span>每次需</span>
            <input
              type="text"
              inputMode="numeric"
              value={carWash.operationDurationMinutes}
              onChange={(e) =>
                patchCarWash({
                  operationDurationMinutes: sanitizeIntegerInput(e.target.value),
                })
              }
              placeholder="請輸入"
              className={INLINE_INPUT_ENABLED}
            />
            <span>分鐘，進行洗車作業</span>
          </div>
        </div>

        <FacilityEquipmentRowsEditor<CarWashEquipmentRow>
          rows={carWash.equipmentRows}
          equipment={equipment}
          loadingEquipment={loadingEquipment}
          equipmentError={equipmentError}
          equipmentHint={
            equipment.length > 0
              ? `可載入最多 ${equipment.length} 座洗車設施（${equipment.map((e) => e.mapCode).join('、')}）`
              : undefined
          }
          newRow={() => ({
            id: newCarWashEquipmentRowId(),
            mapCode: '',
            waypointCode: '',
          })}
          onChange={(equipmentRows) => patchCarWash({ equipmentRows })}
        />
      </div>
    </StepSectionToggle>
  );
}
